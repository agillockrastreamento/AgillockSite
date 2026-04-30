'use strict';

(function () {

  // ── Estado global ──────────────────────────────────────────────────────────
  var geocercas = [];
  var todosDispositivos = [];
  var editandoId = null;
  var mapaIniciado = false;
  var mapa = null;

  // Desenho
  var modoDesenho = null;      // 'poligono' | 'circulo' | 'linha' | null
  var pontosDesenho = [];      // [{lat, lng}]
  var camadaDesenho = null;    // Leaflet layer atual
  var guiaDesenho = null;      // linha tracejada de guia
  var circuloCenter = null;    // {lat, lng} do centro
  var areaWkt = null;          // WKT final da área desenhada
  var tipoForma = null;        // 'circulo' | 'poligono' | 'linha'

  // Anti double-click para modos polígono/linha
  var ultimoClickMs = 0;
  var ultimoClickLat = 0;
  var ultimoClickLng = 0;

  // Dispositivos selecionados no form
  var dispositivosSelecionados = [];

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    bindEvents();
    carregarGeocercas();
    carregarTodosDispositivos();
  }

  // ── Eventos fixos ──────────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('btn-nova-geocerca').addEventListener('click', abrirFormNovo);
    document.getElementById('btn-cancelar-geo').addEventListener('click', fecharForm);
    document.getElementById('btn-cancelar-geo2').addEventListener('click', fecharForm);
    document.getElementById('btn-salvar-geo').addEventListener('click', salvarGeocerca);

    document.getElementById('btn-draw-polygon').addEventListener('click', function () { ativarModo('poligono'); });
    document.getElementById('btn-draw-circle').addEventListener('click', function () { ativarModo('circulo'); });
    document.getElementById('btn-draw-line').addEventListener('click', function () { ativarModo('linha'); });
    document.getElementById('btn-draw-clear').addEventListener('click', limparTudo);
    document.getElementById('btn-circle-aplicar').addEventListener('click', aplicarRaioCirculo);

    document.getElementById('geo-notificar-cliente').addEventListener('change', function () {
      document.getElementById('geo-notif-sistemas').classList.toggle('visivel', this.checked);
    });

    var searchTimer = null;
    document.getElementById('geo-devices-search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (!q) { document.getElementById('geo-devices-results').style.display = 'none'; return; }
      searchTimer = setTimeout(function () { pesquisarDispositivos(q); }, 200);
    });
    document.getElementById('geo-devices-search').addEventListener('blur', function () {
      setTimeout(function () { document.getElementById('geo-devices-results').style.display = 'none'; }, 200);
    });
  }

  // ── Carregar lista ─────────────────────────────────────────────────────────
  function carregarGeocercas() {
    AL.apiGet('/api/rastreamento/geocercas').then(function (data) {
      geocercas = data || [];
      renderizarLista();
    }).catch(function (err) {
      AL.showAlert('Erro ao carregar geocercas: ' + err.message, 'danger');
    });
  }

  function renderizarLista() {
    var body = document.getElementById('geo-list-body');
    var empty = document.getElementById('geo-empty');

    body.querySelectorAll('.geo-item').forEach(function (el) { el.remove(); });

    if (!geocercas.length) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    var TIPO_LABEL = { circulo: 'Círculo', poligono: 'Polígono', linha: 'Linha' };

    geocercas.forEach(function (g) {
      var el = document.createElement('div');
      el.className = 'geo-item' + (editandoId === g.id ? ' ativo' : '');
      el.dataset.id = g.id;

      var tipoLabel = TIPO_LABEL[g.tipo] || g.tipo;
      var qtd = g.dispositivos ? g.dispositivos.length : 0;
      var dispLabel = qtd === 0 ? 'Sem dispositivos' : qtd === 1 ? '1 dispositivo' : qtd + ' dispositivos';

      el.innerHTML =
        '<div class="geo-item-nome">' + esc(g.nome) + '</div>' +
        '<div class="geo-item-meta">' +
          '<span class="geo-badge geo-badge-tipo">' + tipoLabel + '</span>' +
          (g.visivelCliente ? '<span class="geo-badge geo-badge-visivel">Visível ao cliente</span>' : '') +
          (!g.ativa ? '<span class="geo-badge geo-badge-inativa">Inativa</span>' : '') +
        '</div>' +
        '<div class="geo-item-devices"><i class="fa fa-car" style="margin-right:4px;opacity:.6"></i>' + esc(dispLabel) + '</div>' +
        '<div class="geo-item-actions">' +
          '<button class="geo-btn-action btn-editar-geo"><i class="fa fa-pencil"></i> Editar</button>' +
          '<button class="geo-btn-action geo-btn-danger btn-excluir-geo"><i class="fa fa-trash"></i> Excluir</button>' +
        '</div>';

      el.querySelector('.btn-editar-geo').addEventListener('click', function (e) {
        e.stopPropagation();
        editarGeocerca(g.id);
      });
      el.querySelector('.btn-excluir-geo').addEventListener('click', function (e) {
        e.stopPropagation();
        excluirGeocerca(g.id);
      });
      el.addEventListener('click', function () { editarGeocerca(g.id); });

      body.appendChild(el);
    });
  }

  // ── Dispositivos (cache) ───────────────────────────────────────────────────
  function carregarTodosDispositivos() {
    AL.apiGet('/api/rastreamento/posicoes').then(function (data) {
      todosDispositivos = (data || []).map(function (d) {
        return { id: d.dispositivoId, nome: d.nome || '', placa: d.placa || '', identificador: d.identificador || '' };
      });
    }).catch(function () { /* silently fail */ });
  }

  // ── Abrir form novo / editar ───────────────────────────────────────────────
  function abrirFormNovo() {
    editandoId = null;
    limparForm();
    document.getElementById('geo-form-titulo').textContent = 'Nova Geocerca';
    mostrarForm();
  }

  function editarGeocerca(id) {
    var geo = geocercas.find(function (g) { return g.id === id; });
    if (!geo) return;

    editandoId = id;
    limparForm();

    document.getElementById('geo-nome').value = geo.nome || '';
    document.getElementById('geo-descricao').value = geo.descricao || '';

    if (geo.dataInicio) {
      var dt = new Date(geo.dataInicio);
      var fmt =
        dt.getFullYear() + '-' +
        pad(dt.getMonth() + 1) + '-' +
        pad(dt.getDate()) + 'T' +
        pad(dt.getHours()) + ':' +
        pad(dt.getMinutes());
      document.getElementById('geo-data-inicio').value = fmt;
    }

    dispositivosSelecionados = (geo.dispositivos || []).map(function (d) {
      return { id: d.id, nome: d.nome || '', placa: d.placa || '' };
    });
    renderizarTagsDispositivos();

    document.getElementById('geo-visivel-cliente').checked = !!geo.visivelCliente;
    document.getElementById('geo-notificar-cliente').checked = !!geo.notificarCliente;
    document.getElementById('geo-notif-sistemas').classList.toggle('visivel', !!geo.notificarCliente);

    var sn = (geo.sistemasNotif && typeof geo.sistemasNotif === 'object') ? geo.sistemasNotif : {};
    document.getElementById('geo-notif-email').checked = sn.email !== false;
    document.getElementById('geo-notif-whatsapp').checked = !!sn.whatsapp;
    document.getElementById('geo-notif-app').checked = sn.app !== false;

    document.getElementById('geo-form-titulo').textContent = 'Editar Geocerca';
    mostrarForm();

    if (geo.area) {
      setTimeout(function () { desenharAreaExistente(geo.area, geo.tipo); }, 300);
    }

    document.querySelectorAll('.geo-item').forEach(function (el) {
      el.classList.toggle('ativo', el.dataset.id === id);
    });
  }

  function mostrarForm() {
    document.getElementById('geo-empty-state').style.display = 'none';
    document.getElementById('geo-form-wrap').classList.add('ativo');
    iniciarMapa();
  }

  function fecharForm() {
    editandoId = null;
    document.getElementById('geo-form-wrap').classList.remove('ativo');
    document.getElementById('geo-empty-state').style.display = '';
    limparTudo();
    document.querySelectorAll('.geo-item').forEach(function (el) { el.classList.remove('ativo'); });
  }

  function limparForm() {
    document.getElementById('geo-nome').value = '';
    document.getElementById('geo-descricao').value = '';
    document.getElementById('geo-data-inicio').value = '';
    document.getElementById('geo-devices-search').value = '';
    document.getElementById('geo-devices-results').style.display = 'none';
    dispositivosSelecionados = [];
    renderizarTagsDispositivos();
    document.getElementById('geo-visivel-cliente').checked = false;
    document.getElementById('geo-notificar-cliente').checked = false;
    document.getElementById('geo-notif-sistemas').classList.remove('visivel');
    document.getElementById('geo-notif-email').checked = true;
    document.getElementById('geo-notif-whatsapp').checked = false;
    document.getElementById('geo-notif-app').checked = true;
    limparTudo();
  }

  // ── Mapa ───────────────────────────────────────────────────────────────────
  function iniciarMapa() {
    if (mapaIniciado) {
      setTimeout(function () { if (mapa) mapa.invalidateSize(); }, 150);
      return;
    }
    mapaIniciado = true;

    mapa = L.map('geo-mapa', { zoomControl: true, doubleClickZoom: false })
             .setView([-15.788, -47.879], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(mapa);

    mapa.on('click', onMapClick);
    mapa.on('dblclick', onMapDblClick);
    mapa.on('mousemove', onMapMouseMove);

    setTimeout(function () { if (mapa) mapa.invalidateSize(); }, 300);
  }

  // ── Modos de desenho ───────────────────────────────────────────────────────
  function ativarModo(modo) {
    // Clear previous drawing state but keep existing WKT only if just switching modes
    limparCamadas();
    pontosDesenho = [];
    circuloCenter = null;
    areaWkt = null;
    tipoForma = null;
    ultimoClickMs = 0;

    modoDesenho = modo;

    document.getElementById('btn-draw-polygon').classList.toggle('ativo', modo === 'poligono');
    document.getElementById('btn-draw-circle').classList.toggle('ativo', modo === 'circulo');
    document.getElementById('btn-draw-line').classList.toggle('ativo', modo === 'linha');

    var dicas = {
      poligono: 'Clique para adicionar vértices · Duplo-clique para fechar',
      circulo:  'Clique no mapa para definir o centro do círculo',
      linha:    'Clique para adicionar pontos · Duplo-clique para finalizar',
    };
    document.getElementById('geo-draw-hint').textContent = dicas[modo] || '';
    document.getElementById('geo-circle-raio-wrap').style.display = modo === 'circulo' ? '' : 'none';
  }

  function limparCamadas() {
    if (camadaDesenho) { if (mapa) mapa.removeLayer(camadaDesenho); camadaDesenho = null; }
    if (guiaDesenho)   { if (mapa) mapa.removeLayer(guiaDesenho);   guiaDesenho = null; }
  }

  function limparTudo() {
    limparCamadas();
    pontosDesenho = [];
    circuloCenter = null;
    areaWkt = null;
    tipoForma = null;
    modoDesenho = null;
    ultimoClickMs = 0;
    ['btn-draw-polygon', 'btn-draw-circle', 'btn-draw-line'].forEach(function (id) {
      document.getElementById(id).classList.remove('ativo');
    });
    document.getElementById('geo-draw-hint').textContent = '';
    document.getElementById('geo-circle-raio-wrap').style.display = 'none';
    document.getElementById('geo-circle-raio').value = '500';
  }

  // ── Handlers do mapa ───────────────────────────────────────────────────────
  function onMapClick(e) {
    if (!modoDesenho) return;
    var lat = e.latlng.lat;
    var lng = e.latlng.lng;

    if (modoDesenho === 'circulo') {
      circuloCenter = { lat: lat, lng: lng };
      var raio = parseInt(document.getElementById('geo-circle-raio').value) || 500;
      limparCamadas();
      camadaDesenho = L.circle([lat, lng], { radius: raio, color: '#2980b9', fillOpacity: 0.18 }).addTo(mapa);
      mapa.panTo([lat, lng]);
      document.getElementById('geo-draw-hint').textContent = 'Centro definido. Ajuste o raio e clique em Aplicar, ou clique para mover o centro.';
      finalizarCirculo(raio);
      return;
    }

    // Anti-duplo-clique: ignora o segundo click de um dblclick
    var agora = Date.now();
    var distLat = Math.abs(lat - ultimoClickLat);
    var distLng = Math.abs(lng - ultimoClickLng);
    if (agora - ultimoClickMs < 350 && distLat < 0.0005 && distLng < 0.0005) {
      ultimoClickMs = agora;
      return;
    }
    ultimoClickMs = agora;
    ultimoClickLat = lat;
    ultimoClickLng = lng;

    if (modoDesenho === 'poligono') {
      pontosDesenho.push({ lat: lat, lng: lng });
      atualizarDesenhoPoligono();
      document.getElementById('geo-draw-hint').textContent =
        pontosDesenho.length < 3
          ? 'Adicione mais ' + (3 - pontosDesenho.length) + ' ponto(s) · Duplo-clique para fechar'
          : 'Duplo-clique para fechar (' + pontosDesenho.length + ' vértices)';

    } else if (modoDesenho === 'linha') {
      pontosDesenho.push({ lat: lat, lng: lng });
      atualizarDesenhoLinha();
      document.getElementById('geo-draw-hint').textContent =
        pontosDesenho.length < 2
          ? 'Adicione mais 1 ponto · Duplo-clique para finalizar'
          : 'Duplo-clique para finalizar (' + pontosDesenho.length + ' pontos)';
    }
  }

  function onMapDblClick(e) {
    ultimoClickMs = 0;
    if (!modoDesenho) return;
    if (modoDesenho === 'circulo') return;

    if (modoDesenho === 'poligono') {
      if (pontosDesenho.length < 3) {
        AL.showAlert('Um polígono precisa de pelo menos 3 vértices.', 'warning');
        return;
      }
      finalizarPoligono();
    } else if (modoDesenho === 'linha') {
      if (pontosDesenho.length < 2) {
        AL.showAlert('Uma linha precisa de pelo menos 2 pontos.', 'warning');
        return;
      }
      finalizarLinha();
    }
  }

  function onMapMouseMove(e) {
    if (!modoDesenho || modoDesenho === 'circulo' || !pontosDesenho.length) return;
    var lat = e.latlng.lat;
    var lng = e.latlng.lng;
    var guia = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    guia.push([lat, lng]);
    if (guiaDesenho) mapa.removeLayer(guiaDesenho);
    guiaDesenho = L.polyline(guia, { color: '#2980b9', dashArray: '6 6', weight: 2, opacity: 0.65 }).addTo(mapa);
  }

  // ── Atualização visual durante desenho ─────────────────────────────────────
  function atualizarDesenhoPoligono() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    if (pts.length === 1) {
      camadaDesenho = L.circleMarker(pts[0], { radius: 5, color: '#2980b9', fillOpacity: 1 }).addTo(mapa);
    } else {
      camadaDesenho = L.polygon(pts, { color: '#2980b9', fillOpacity: 0.12, weight: 2 }).addTo(mapa);
    }
  }

  function atualizarDesenhoLinha() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    camadaDesenho = L.polyline(pts, { color: '#2980b9', weight: 3 }).addTo(mapa);
  }

  // ── Finalização das formas ─────────────────────────────────────────────────
  function finalizarPoligono() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    camadaDesenho = L.polygon(pts, { color: '#27ae60', fillOpacity: 0.2, weight: 2 }).addTo(mapa);
    mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });

    // WKT POLYGON: (lon lat, ...) — fecha o anel repetindo o primeiro ponto
    var ring = pontosDesenho.concat([pontosDesenho[0]]);
    areaWkt = 'POLYGON ((' + ring.map(function (p) { return p.lng + ' ' + p.lat; }).join(', ') + '))';
    tipoForma = 'poligono';
    modoDesenho = null;
    desativarBotoesDraw();
    document.getElementById('geo-draw-hint').textContent = '✓ Polígono desenhado. Clique Polígono para redesenhar.';
  }

  function finalizarCirculo(raio) {
    // WKT Traccar: CIRCLE (lat lon, radius)
    areaWkt = 'CIRCLE (' + circuloCenter.lat + ' ' + circuloCenter.lng + ', ' + raio + ')';
    tipoForma = 'circulo';
  }

  function finalizarLinha() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    camadaDesenho = L.polyline(pts, { color: '#27ae60', weight: 3 }).addTo(mapa);
    mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });

    // WKT LINESTRING: (lon lat, ...)
    areaWkt = 'LINESTRING (' + pontosDesenho.map(function (p) { return p.lng + ' ' + p.lat; }).join(', ') + ')';
    tipoForma = 'linha';
    modoDesenho = null;
    desativarBotoesDraw();
    document.getElementById('geo-draw-hint').textContent = '✓ Linha desenhada. Clique Linha para redesenhar.';
  }

  function desativarBotoesDraw() {
    ['btn-draw-polygon', 'btn-draw-circle', 'btn-draw-line'].forEach(function (id) {
      document.getElementById(id).classList.remove('ativo');
    });
  }

  // ── Aplicar raio do círculo ────────────────────────────────────────────────
  function aplicarRaioCirculo() {
    if (!circuloCenter) {
      AL.showAlert('Clique no mapa primeiro para definir o centro.', 'warning');
      return;
    }
    var raio = parseInt(document.getElementById('geo-circle-raio').value) || 500;
    limparCamadas();
    camadaDesenho = L.circle([circuloCenter.lat, circuloCenter.lng], {
      radius: raio, color: '#27ae60', fillOpacity: 0.2,
    }).addTo(mapa);
    finalizarCirculo(raio);
    document.getElementById('geo-draw-hint').textContent = '✓ Círculo atualizado (raio: ' + raio + ' m).';
  }

  // ── Desenhar área existente ao editar ─────────────────────────────────────
  function desenharAreaExistente(area, tipo) {
    limparCamadas();
    areaWkt = null;
    tipoForma = null;
    pontosDesenho = [];
    circuloCenter = null;

    try {
      if (tipo === 'circulo' || /^CIRCLE/i.test(area)) {
        var m = area.match(/CIRCLE\s*\(\s*([\d.\-]+)\s+([\d.\-]+)\s*,\s*([\d.\-]+)\s*\)/i);
        if (!m) return;
        var lat = parseFloat(m[1]), lng = parseFloat(m[2]), raio = parseFloat(m[3]);
        circuloCenter = { lat: lat, lng: lng };
        document.getElementById('geo-circle-raio').value = Math.round(raio);
        camadaDesenho = L.circle([lat, lng], { radius: raio, color: '#27ae60', fillOpacity: 0.2 }).addTo(mapa);
        mapa.setView([lat, lng], 13);
        areaWkt = area;
        tipoForma = 'circulo';
        document.getElementById('geo-circle-raio-wrap').style.display = '';
        document.getElementById('geo-draw-hint').textContent = '✓ Círculo carregado. Ajuste o raio e clique Aplicar se necessário.';

      } else if (tipo === 'poligono' || /^POLYGON/i.test(area)) {
        var inner = area.match(/POLYGON\s*\(\((.+?)\)\)/i);
        if (!inner) return;
        var pts = inner[1].trim().split(',').map(function (pair) {
          var parts = pair.trim().split(/\s+/);
          return [parseFloat(parts[1]), parseFloat(parts[0])]; // [lat, lng]
        });
        // Remove ponto de fechamento se duplicado
        if (pts.length > 1) {
          var last = pts[pts.length - 1], first = pts[0];
          if (Math.abs(last[0] - first[0]) < 0.000001 && Math.abs(last[1] - first[1]) < 0.000001) {
            pts = pts.slice(0, -1);
          }
        }
        pontosDesenho = pts.map(function (p) { return { lat: p[0], lng: p[1] }; });
        camadaDesenho = L.polygon(pts, { color: '#27ae60', fillOpacity: 0.2 }).addTo(mapa);
        mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });
        areaWkt = area;
        tipoForma = 'poligono';
        document.getElementById('geo-draw-hint').textContent = '✓ Polígono carregado. Clique Polígono para redesenhar.';

      } else if (tipo === 'linha' || /^LINESTRING/i.test(area)) {
        var linner = area.match(/LINESTRING\s*\((.+?)\)/i);
        if (!linner) return;
        var lpts = linner[1].trim().split(',').map(function (pair) {
          var parts = pair.trim().split(/\s+/);
          return [parseFloat(parts[1]), parseFloat(parts[0])]; // [lat, lng]
        });
        pontosDesenho = lpts.map(function (p) { return { lat: p[0], lng: p[1] }; });
        camadaDesenho = L.polyline(lpts, { color: '#27ae60', weight: 3 }).addTo(mapa);
        mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });
        areaWkt = area;
        tipoForma = 'linha';
        document.getElementById('geo-draw-hint').textContent = '✓ Linha carregada. Clique Linha para redesenhar.';
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // ── Pesquisa de dispositivos ───────────────────────────────────────────────
  function pesquisarDispositivos(q) {
    var lower = q.toLowerCase();
    var filtrados = todosDispositivos.filter(function (d) {
      return (
        (d.nome && d.nome.toLowerCase().indexOf(lower) !== -1) ||
        (d.placa && d.placa.toLowerCase().indexOf(lower) !== -1) ||
        (d.identificador && d.identificador.toLowerCase().indexOf(lower) !== -1)
      );
    }).filter(function (d) {
      return !dispositivosSelecionados.find(function (s) { return s.id === d.id; });
    }).slice(0, 8);

    var results = document.getElementById('geo-devices-results');
    if (!filtrados.length) { results.style.display = 'none'; return; }

    results.innerHTML = filtrados.map(function (d) {
      return '<div class="geo-device-result" data-id="' + d.id + '">' +
        '<i class="fa fa-car" style="opacity:.5"></i>' +
        '<span>' + esc(d.nome) + (d.placa ? ' <span style="opacity:.65">(' + esc(d.placa) + ')</span>' : '') + '</span>' +
        '</div>';
    }).join('');

    results.querySelectorAll('.geo-device-result').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var id = this.dataset.id;
        var dispo = todosDispositivos.find(function (d) { return d.id === id; });
        if (dispo && !dispositivosSelecionados.find(function (s) { return s.id === id; })) {
          dispositivosSelecionados.push(dispo);
          renderizarTagsDispositivos();
        }
        document.getElementById('geo-devices-search').value = '';
        results.style.display = 'none';
      });
    });

    results.style.display = '';
  }

  function renderizarTagsDispositivos() {
    var container = document.getElementById('geo-devices-selected');
    var empty = document.getElementById('geo-devices-empty');

    container.innerHTML = dispositivosSelecionados.map(function (d) {
      return '<span class="geo-device-tag" data-id="' + d.id + '">' +
        esc(d.nome) + (d.placa ? ' (' + esc(d.placa) + ')' : '') +
        '<button type="button" title="Remover"><i class="fa fa-times"></i></button>' +
        '</span>';
    }).join('');

    container.querySelectorAll('.geo-device-tag button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.closest('.geo-device-tag').dataset.id;
        dispositivosSelecionados = dispositivosSelecionados.filter(function (d) { return d.id !== id; });
        renderizarTagsDispositivos();
      });
    });

    empty.style.display = dispositivosSelecionados.length ? 'none' : '';
  }

  // ── Salvar ─────────────────────────────────────────────────────────────────
  function salvarGeocerca() {
    var nome = document.getElementById('geo-nome').value.trim();
    if (!nome) { AL.showAlert('O nome da geocerca é obrigatório.', 'warning'); return; }
    if (!areaWkt) { AL.showAlert('Desenhe uma área no mapa antes de salvar.', 'warning'); return; }

    var payload = {
      nome: nome,
      area: areaWkt,
      tipo: tipoForma || 'poligono',
      dispositivos: dispositivosSelecionados.map(function (d) { return d.id; }),
      visivelCliente: document.getElementById('geo-visivel-cliente').checked,
      notificarCliente: document.getElementById('geo-notificar-cliente').checked,
      sistemasNotif: {
        email: document.getElementById('geo-notif-email').checked,
        whatsapp: document.getElementById('geo-notif-whatsapp').checked,
        app: document.getElementById('geo-notif-app').checked,
      },
    };

    var descricao = document.getElementById('geo-descricao').value.trim();
    if (descricao) payload.descricao = descricao;

    var dataInicio = document.getElementById('geo-data-inicio').value;
    if (dataInicio) payload.dataInicio = dataInicio;

    var btn = document.getElementById('btn-salvar-geo');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';

    var req = editandoId
      ? AL.apiPut('/api/rastreamento/geocercas/' + editandoId, payload)
      : AL.apiPost('/api/rastreamento/geocercas', payload);

    req.then(function () {
      AL.showAlert(editandoId ? 'Geocerca atualizada!' : 'Geocerca criada!', 'success');
      fecharForm();
      carregarGeocercas();
    }).catch(function (err) {
      AL.showAlert('Erro ao salvar: ' + err.message, 'danger');
    }).finally(function () {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-check"></i> Salvar Geocerca';
    });
  }

  // ── Excluir ────────────────────────────────────────────────────────────────
  function excluirGeocerca(id) {
    var geo = geocercas.find(function (g) { return g.id === id; });
    if (!geo) return;
    if (!confirm('Excluir a geocerca "' + geo.nome + '"?\nEsta ação não pode ser desfeita.')) return;

    AL.apiDelete('/api/rastreamento/geocercas/' + id).then(function () {
      AL.showAlert('Geocerca excluída.', 'success');
      if (editandoId === id) fecharForm();
      carregarGeocercas();
    }).catch(function (err) {
      AL.showAlert('Erro ao excluir: ' + err.message, 'danger');
    });
  }

  // ── Utilitários ────────────────────────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // ── Start ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
