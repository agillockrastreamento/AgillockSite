'use strict';
(function () {

  var mapa = null, mapaIniciado = false;
  var tileAtual = null, tileGoogle = null, tileSat = null, tileCarto = null;
  var modoDesenho = null;
  var pontosDesenho = [];
  var camadaDesenho = null;
  var guiaDesenho = null;
  var circuloCenter = null;
  var areaWkt = null;
  var tipoForma = null;

  var ultimoClickMs = 0;
  var ultimoClickLat = 0;
  var ultimoClickLng = 0;

  var dispositivosSelecionados = [];
  var todosDispositivos = [];
  var filtroDispositivos = '';
  var editandoId = null;
  var areaPendenteEdicao = null;

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    var params = new URLSearchParams(window.location.search);
    editandoId = params.get('id') || null;

    document.getElementById('geo-titulo').textContent = editandoId ? 'Editar Geocerca' : 'Nova Geocerca';
    document.title = (editandoId ? 'Editar Geocerca' : 'Nova Geocerca') + ' — AgilLock';

    Promise.all([
      carregarDispositivos(),
      editandoId ? carregarGeocerca(editandoId) : Promise.resolve()
    ]).then(function () {
      renderizarDispositivos();
    }).catch(function (e) {
      AL_CLIENTE.showAlert('Erro ao carregar dados: ' + e.message, 'danger');
    });

    iniciarMapa();
    bindEventos();
  }

  function carregarDispositivos() {
    return AL_CLIENTE.apiGet('/api/cliente/rastreamento/geocercas/dispositivos').then(function (data) {
      todosDispositivos = (data || []).map(function (d) {
        return {
          id: d.dispositivoId || d.id,
          nome: d.nome || '',
          placa: d.placa || '',
          identificador: d.identificador || ''
        };
      });
    }).catch(function () {});
  }

  function carregarGeocerca(id) {
    return AL_CLIENTE.apiGet('/api/cliente/rastreamento/geocercas/' + id).then(function (geo) {
      if (!geo) { AL_CLIENTE.showAlert('Geocerca não encontrada.', 'danger'); return; }

      document.getElementById('geo-nome').value = geo.nome || '';
      document.getElementById('geo-descricao').value = geo.descricao || '';

      if (geo.dataInicio) {
        var dt = new Date(geo.dataInicio);
        document.getElementById('geo-data-inicio').value =
          dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) +
          'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
      }

      dispositivosSelecionados = (geo.dispositivos || []).map(function (d) {
        return { id: d.id, nome: d.nome || '', placa: d.placa || '', identificador: '' };
      });
      renderizarDispositivos();

      setChecked('geo-notificar-cliente', !!geo.notificarCliente);
      var notifSistemas = document.getElementById('geo-notif-sistemas');
      if (notifSistemas) notifSistemas.classList.toggle('visivel', !!geo.notificarCliente);

      var sn = (geo.sistemasNotif && typeof geo.sistemasNotif === 'object') ? geo.sistemasNotif : {};
      setChecked('geo-notif-email', sn.email !== false);
      setChecked('geo-notif-app', sn.app !== false);

      if (geo.area) {
        agendarDesenhoAreaExistente(geo.area, geo.tipo);
      }
    });
  }

  // ── Bind eventos ───────────────────────────────────────────────────────────
  function bindEventos() {
    document.getElementById('btn-salvar').addEventListener('click', salvar);
    document.getElementById('btn-draw-polygon').addEventListener('click', function () { ativarModo('poligono'); });
    document.getElementById('btn-draw-circle').addEventListener('click', function () { ativarModo('circulo'); });
    document.getElementById('btn-draw-line').addEventListener('click', function () { ativarModo('linha'); });
    document.getElementById('btn-draw-clear').addEventListener('click', limparTudo);
    document.getElementById('btn-circle-aplicar').addEventListener('click', aplicarRaioCirculo);

    document.querySelectorAll('.tile-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tile-btn').forEach(function (b) { b.classList.remove('ativo'); });
        btn.classList.add('ativo');
        trocarTile(btn.dataset.tile);
      });
    });

    document.getElementById('geo-notificar-cliente').addEventListener('change', function () {
      document.getElementById('geo-notif-sistemas').classList.toggle('visivel', this.checked);
    });

    var searchEl = document.getElementById('geo-devices-search');

    searchEl.addEventListener('input', function () {
      filtroDispositivos = this.value || '';
      renderizarDispositivos();
    });

    // Enter habilita todos os dispositivos que estão aparecendo na busca atual.
    searchEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var filtrados = dispositivosFiltrados();
      if (!filtrados.length) return;
      adicionarDispositivos(filtrados);
    });

    document.getElementById('btn-add-todos').addEventListener('click', function () {
      adicionarDispositivos(dispositivosFiltrados());
    });
    document.getElementById('btn-rem-todos').addEventListener('click', function () {
      removerDispositivos(dispositivosFiltrados());
    });
  }

  // ── Mapa Leaflet ───────────────────────────────────────────────────────────
  function iniciarMapa() {
    if (mapaIniciado) {
      setTimeout(function () { if (mapa) mapa.invalidateSize(); }, 150);
      return;
    }
    mapaIniciado = true;

    mapa = L.map('geo-mapa', { zoomControl: true, doubleClickZoom: false })
             .setView([-15.788, -47.879], 5);

    tileGoogle = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Maps'
    });
    tileSat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Satellite'
    });
    tileCarto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, attribution: '© CartoDB'
    });

    tileGoogle.addTo(mapa);
    tileAtual = tileGoogle;

    mapa.on('click', onMapClick);
    mapa.on('dblclick', onMapDblClick);
    mapa.on('mousemove', onMapMouseMove);

    var marcadorLocalizacao = null;
    var LocateControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        var link = L.DomUtil.create('a', '', container);
        link.href = '#'; link.title = 'Minha localização';
        link.setAttribute('role', 'button');
        link.innerHTML = '<i class="fa fa-location-arrow" style="font-size:13px;"></i>';
        link.style.display = 'flex'; link.style.alignItems = 'center'; link.style.justifyContent = 'center';

        L.DomEvent.on(link, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          link.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size:13px;color:#fab32c;"></i>';
          map.locate({ setView: true, maxZoom: 15 });
        });
        map.on('locationfound', function (e) {
          link.innerHTML = '<i class="fa fa-location-arrow" style="font-size:13px;color:#fab32c;"></i>';
          if (marcadorLocalizacao) map.removeLayer(marcadorLocalizacao);
          marcadorLocalizacao = L.circleMarker(e.latlng, {
            radius: 8, color: '#fff', fillColor: '#2980b9', fillOpacity: 1, weight: 3
          }).addTo(map).bindPopup('Você está aqui').openPopup();
        });
        map.on('locationerror', function () {
          link.innerHTML = '<i class="fa fa-location-arrow" style="font-size:13px;"></i>';
          AL_CLIENTE.showAlert('Não foi possível obter sua localização.', 'warning');
        });
        return container;
      }
    });
    new LocateControl().addTo(mapa);

    setTimeout(function () { if (mapa) mapa.invalidateSize(); }, 300);
    if (areaPendenteEdicao) agendarDesenhoAreaExistente(areaPendenteEdicao.area, areaPendenteEdicao.tipo);
  }

  function agendarDesenhoAreaExistente(area, tipo, tentativa) {
    areaPendenteEdicao = { area: area, tipo: tipo };
    tentativa = tentativa || 0;
    if (!mapa || !mapaIniciado) {
      if (tentativa < 20) setTimeout(function () { agendarDesenhoAreaExistente(area, tipo, tentativa + 1); }, 150);
      return;
    }
    setTimeout(function () {
      try { mapa.invalidateSize(); } catch (e) {}
      if (desenharAreaExistente(area, tipo)) {
        areaPendenteEdicao = null;
      } else if (tentativa < 20) {
        agendarDesenhoAreaExistente(area, tipo, tentativa + 1);
      } else {
        AL_CLIENTE.showAlert('Não foi possível desenhar a área salva desta geocerca.', 'warning');
      }
    }, 120);
  }

  function trocarTile(nome) {
    if (!mapa) return;
    if (tileAtual) mapa.removeLayer(tileAtual);
    if (nome === 'google-mapa') { tileGoogle.addTo(mapa); tileAtual = tileGoogle; }
    else if (nome === 'google-sat') { tileSat.addTo(mapa); tileAtual = tileSat; }
    else if (nome === 'carto') { tileCarto.addTo(mapa); tileAtual = tileCarto; }
  }

  // ── Modos de desenho ───────────────────────────────────────────────────────
  function ativarModo(modo) {
    limparCamadas();
    pontosDesenho = []; circuloCenter = null; areaWkt = null; tipoForma = null; ultimoClickMs = 0;
    modoDesenho = modo;

    document.getElementById('btn-draw-polygon').classList.toggle('ativo', modo === 'poligono');
    document.getElementById('btn-draw-circle').classList.toggle('ativo', modo === 'circulo');
    document.getElementById('btn-draw-line').classList.toggle('ativo', modo === 'linha');

    var dicas = {
      poligono: 'Clique para adicionar vértices · Duplo-clique para fechar o polígono',
      circulo:  'Clique no mapa para definir o centro do círculo',
      linha:    'Clique para adicionar pontos · Duplo-clique para finalizar a linha'
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
    pontosDesenho = []; circuloCenter = null; areaWkt = null; tipoForma = null; modoDesenho = null; ultimoClickMs = 0;
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
    var lat = e.latlng.lat, lng = e.latlng.lng;

    if (modoDesenho === 'circulo') {
      circuloCenter = { lat: lat, lng: lng };
      var raio = parseInt(document.getElementById('geo-circle-raio').value) || 500;
      limparCamadas();
      camadaDesenho = L.circle([lat, lng], { radius: raio, color: '#fab32c', fillColor: '#fab32c', fillOpacity: 0.18, weight: 2 }).addTo(mapa);
      mapa.panTo([lat, lng]);
      document.getElementById('geo-draw-hint').textContent = 'Centro definido. Ajuste o raio e clique em Aplicar, ou clique para mover o centro.';
      finalizarCirculo(raio);
      return;
    }

    var agora = Date.now();
    var distLat = Math.abs(lat - ultimoClickLat);
    var distLng = Math.abs(lng - ultimoClickLng);
    if (agora - ultimoClickMs < 350 && distLat < 0.0005 && distLng < 0.0005) { ultimoClickMs = agora; return; }
    ultimoClickMs = agora; ultimoClickLat = lat; ultimoClickLng = lng;

    if (modoDesenho === 'poligono') {
      pontosDesenho.push({ lat: lat, lng: lng });
      atualizarDesenhoPoligono();
      document.getElementById('geo-draw-hint').textContent =
        pontosDesenho.length < 3 ? 'Adicione mais ' + (3 - pontosDesenho.length) + ' ponto(s) · Duplo-clique para fechar'
                                  : 'Duplo-clique para fechar (' + pontosDesenho.length + ' vértices)';
    } else if (modoDesenho === 'linha') {
      pontosDesenho.push({ lat: lat, lng: lng });
      atualizarDesenhoLinha();
      document.getElementById('geo-draw-hint').textContent =
        pontosDesenho.length < 2 ? 'Adicione mais 1 ponto · Duplo-clique para finalizar'
                                  : 'Duplo-clique para finalizar (' + pontosDesenho.length + ' pontos)';
    }
  }

  function onMapDblClick(e) {
    ultimoClickMs = 0;
    if (!modoDesenho || modoDesenho === 'circulo') return;
    if (modoDesenho === 'poligono') {
      if (pontosDesenho.length < 3) { AL_CLIENTE.showAlert('Um polígono precisa de pelo menos 3 vértices.', 'warning'); return; }
      finalizarPoligono();
    } else if (modoDesenho === 'linha') {
      if (pontosDesenho.length < 2) { AL_CLIENTE.showAlert('Uma linha precisa de pelo menos 2 pontos.', 'warning'); return; }
      finalizarLinha();
    }
  }

  function onMapMouseMove(e) {
    if (!modoDesenho || modoDesenho === 'circulo' || !pontosDesenho.length) return;
    var guia = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    guia.push([e.latlng.lat, e.latlng.lng]);
    if (guiaDesenho) mapa.removeLayer(guiaDesenho);
    guiaDesenho = L.polyline(guia, { color: '#fab32c', dashArray: '7 6', weight: 2, opacity: 0.7 }).addTo(mapa);
  }

  function atualizarDesenhoPoligono() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    if (pts.length === 1) {
      camadaDesenho = L.circleMarker(pts[0], { radius: 5, color: '#fab32c', fillColor: '#fab32c', fillOpacity: 1, weight: 2 }).addTo(mapa);
    } else {
      camadaDesenho = L.polygon(pts, { color: '#fab32c', fillColor: '#fab32c', fillOpacity: 0.12, weight: 2 }).addTo(mapa);
    }
  }

  function atualizarDesenhoLinha() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    camadaDesenho = L.polyline(pts, { color: '#fab32c', weight: 3 }).addTo(mapa);
  }

  function finalizarPoligono() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    camadaDesenho = L.polygon(pts, { color: '#27ae60', fillColor: '#27ae60', fillOpacity: 0.2, weight: 2 }).addTo(mapa);
    mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });
    var ring = pontosDesenho.concat([pontosDesenho[0]]);
    areaWkt = 'POLYGON ((' + ring.map(function (p) { return p.lng + ' ' + p.lat; }).join(', ') + '))';
    tipoForma = 'poligono'; modoDesenho = null; desativarBotoesDraw();
    document.getElementById('geo-draw-hint').textContent = 'Polígono desenhado. Clique Polígono para redesenhar.';
  }

  function finalizarCirculo(raio) {
    areaWkt = 'CIRCLE (' + circuloCenter.lat + ' ' + circuloCenter.lng + ', ' + raio + ')';
    tipoForma = 'circulo';
  }

  function finalizarLinha() {
    limparCamadas();
    var pts = pontosDesenho.map(function (p) { return [p.lat, p.lng]; });
    camadaDesenho = L.polyline(pts, { color: '#27ae60', weight: 3 }).addTo(mapa);
    mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });
    areaWkt = 'LINESTRING (' + pontosDesenho.map(function (p) { return p.lng + ' ' + p.lat; }).join(', ') + ')';
    tipoForma = 'linha'; modoDesenho = null; desativarBotoesDraw();
    document.getElementById('geo-draw-hint').textContent = 'Linha desenhada. Clique Linha para redesenhar.';
  }

  function desativarBotoesDraw() {
    ['btn-draw-polygon', 'btn-draw-circle', 'btn-draw-line'].forEach(function (id) {
      document.getElementById(id).classList.remove('ativo');
    });
  }

  function aplicarRaioCirculo() {
    if (!circuloCenter) { AL_CLIENTE.showAlert('Clique no mapa primeiro para definir o centro do círculo.', 'warning'); return; }
    var raio = parseInt(document.getElementById('geo-circle-raio').value) || 500;
    limparCamadas();
    camadaDesenho = L.circle([circuloCenter.lat, circuloCenter.lng], {
      radius: raio, color: '#27ae60', fillColor: '#27ae60', fillOpacity: 0.2, weight: 2
    }).addTo(mapa);
    finalizarCirculo(raio);
    document.getElementById('geo-draw-hint').textContent = 'Círculo atualizado (raio: ' + raio + ' m).';
  }

  function desenharAreaExistente(area, tipo) {
    limparCamadas(); areaWkt = null; tipoForma = null; pontosDesenho = []; circuloCenter = null;
    try {
      if (tipo === 'circulo' || /^CIRCLE/i.test(area)) {
        var mc = area.match(/CIRCLE\s*\(\s*([\d.\-]+)\s+([\d.\-]+)\s*,\s*([\d.\-]+)\s*\)/i);
        if (!mc) return false;
        var clat = parseFloat(mc[1]), clng = parseFloat(mc[2]), craio = parseFloat(mc[3]);
        circuloCenter = { lat: clat, lng: clng };
        document.getElementById('geo-circle-raio').value = Math.round(craio);
        camadaDesenho = L.circle([clat, clng], { radius: craio, color: '#27ae60', fillColor: '#27ae60', fillOpacity: 0.2, weight: 2 }).addTo(mapa);
        mapa.setView([clat, clng], 13);
        areaWkt = area; tipoForma = 'circulo';
        document.getElementById('geo-circle-raio-wrap').style.display = '';
        document.getElementById('geo-draw-hint').textContent = 'Círculo carregado.';
      } else if (tipo === 'poligono' || /^POLYGON/i.test(area)) {
        var inner = area.match(/POLYGON\s*\(\(([\s\S]+?)\)\)/i);
        if (!inner) return false;
        var pts = inner[1].trim().split(',').map(function (pair) {
          var parts = pair.trim().split(/\s+/);
          return [parseFloat(parts[1]), parseFloat(parts[0])];
        });
        if (pts.length > 1) {
          var last = pts[pts.length - 1], first = pts[0];
          if (Math.abs(last[0] - first[0]) < 0.000001 && Math.abs(last[1] - first[1]) < 0.000001) pts = pts.slice(0, -1);
        }
        pontosDesenho = pts.map(function (p) { return { lat: p[0], lng: p[1] }; });
        camadaDesenho = L.polygon(pts, { color: '#27ae60', fillColor: '#27ae60', fillOpacity: 0.2, weight: 2 }).addTo(mapa);
        mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });
        areaWkt = area; tipoForma = 'poligono';
        document.getElementById('geo-draw-hint').textContent = 'Polígono carregado.';
      } else if (tipo === 'linha' || /^LINESTRING/i.test(area)) {
        var li = area.match(/LINESTRING\s*\(([\s\S]+?)\)/i);
        if (!li) return false;
        var lpts = li[1].trim().split(',').map(function (pair) {
          var parts = pair.trim().split(/\s+/);
          return [parseFloat(parts[1]), parseFloat(parts[0])];
        });
        pontosDesenho = lpts.map(function (p) { return { lat: p[0], lng: p[1] }; });
        camadaDesenho = L.polyline(lpts, { color: '#27ae60', weight: 3 }).addTo(mapa);
        mapa.fitBounds(camadaDesenho.getBounds(), { padding: [24, 24] });
        areaWkt = area; tipoForma = 'linha';
        document.getElementById('geo-draw-hint').textContent = 'Linha carregada.';
      }
    } catch (e) { console.warn('Erro ao desenhar geocerca existente:', e); }
    return !!areaWkt;
  }

  // ── Lista de dispositivos com switch ───────────────────────────────────────
  function estaSelecionado(id) {
    return !!dispositivosSelecionados.find(function (s) { return s.id === id; });
  }

  // Dispositivos que batem com a busca atual (ou todos, se a busca está vazia).
  function dispositivosFiltrados() {
    var lower = filtroDispositivos.trim().toLowerCase();
    if (!lower) return todosDispositivos.slice();
    return todosDispositivos.filter(function (d) {
      return (d.nome && d.nome.toLowerCase().indexOf(lower) !== -1) ||
             (d.placa && d.placa.toLowerCase().indexOf(lower) !== -1) ||
             (d.identificador && d.identificador.toLowerCase().indexOf(lower) !== -1);
    });
  }

  function adicionarDispositivos(lista) {
    lista.forEach(function (d) {
      if (!estaSelecionado(d.id)) dispositivosSelecionados.push(d);
    });
    sincronizarSwitches();
  }

  function removerDispositivos(lista) {
    var ids = lista.map(function (d) { return d.id; });
    dispositivosSelecionados = dispositivosSelecionados.filter(function (d) {
      return ids.indexOf(d.id) === -1;
    });
    sincronizarSwitches();
  }

  // Atualiza os switches já renderizados sem reconstruir a lista inteira.
  // A animação é desligada durante o lote: muitas transições simultâneas dos
  // sliders apagavam a camada de composição do mapa Leaflet logo abaixo.
  function sincronizarSwitches() {
    var lista = document.getElementById('geo-devices-list');
    if (lista) {
      lista.classList.add('gf-no-anim');
      lista.querySelectorAll('.gf-device-row').forEach(function (row) {
        var input = row.querySelector('.gf-device-toggle');
        if (input) input.checked = estaSelecionado(row.dataset.id);
      });
      void lista.offsetHeight; // aplica o estado sem animar
      requestAnimationFrame(function () { lista.classList.remove('gf-no-anim'); });
    }
    atualizarContador();
    revalidarMapa();
  }

  // Força o navegador a recompor a camada do mapa após uma mutação grande na
  // lista ao lado (invalidateSize/redraw não recuperam o "branco"; alternar uma
  // transform descarta e recria a camada GPU).
  function revalidarMapa() {
    if (!mapa) return;
    var el = document.getElementById('geo-mapa');
    if (!el) return;
    el.style.transform = 'translateZ(0)';
    requestAnimationFrame(function () {
      try {
        el.style.transform = '';
        mapa.invalidateSize();
      } catch (e) {}
    });
  }

  function atualizarContador() {
    var countEl = document.getElementById('geo-devices-count');
    if (!countEl) return;
    var n = dispositivosSelecionados.length;
    countEl.textContent = n ? (n + ' selecionado' + (n > 1 ? 's' : '')) : 'Nenhum selecionado';
  }

  function renderizarDispositivos() {
    var lista = document.getElementById('geo-devices-list');
    var empty = document.getElementById('geo-devices-empty');
    if (!lista || !empty) return;

    var filtrados = dispositivosFiltrados();

    if (!todosDispositivos.length) {
      lista.innerHTML = '';
      empty.textContent = 'Nenhum dispositivo disponível';
      empty.style.display = '';
    } else if (!filtrados.length) {
      lista.innerHTML = '';
      empty.textContent = 'Nenhum dispositivo encontrado para a busca';
      empty.style.display = '';
    } else {
      empty.style.display = 'none';
      lista.innerHTML = filtrados.map(function (d) {
        var on = estaSelecionado(d.id);
        return '<div class="gf-device-row" data-id="' + esc(d.id) + '">' +
          '<div class="gf-device-info">' +
            '<div class="gf-device-nome"><i class="fa fa-car" style="opacity:.45;color:#fab32c;margin-right:6px;"></i>' + esc(d.nome || '(sem nome)') + '</div>' +
            (d.placa ? '<div class="gf-device-meta"><i class="fa fa-id-card-o"></i> ' + esc(d.placa) + '</div>' : '') +
          '</div>' +
          '<label class="gf-switch">' +
            '<input type="checkbox" class="gf-device-toggle"' + (on ? ' checked' : '') + ' />' +
            '<span class="gf-slider"></span>' +
          '</label>' +
        '</div>';
      }).join('');

      lista.querySelectorAll('.gf-device-toggle').forEach(function (input) {
        input.addEventListener('change', function () {
          var id = input.closest('.gf-device-row').dataset.id;
          if (input.checked) {
            if (!estaSelecionado(id)) {
              var dispo = todosDispositivos.find(function (d) { return d.id === id; });
              if (dispo) dispositivosSelecionados.push(dispo);
            }
          } else {
            dispositivosSelecionados = dispositivosSelecionados.filter(function (d) { return d.id !== id; });
          }
          atualizarContador();
        });
      });
    }

    atualizarContador();
    revalidarMapa();
  }

  // ── Salvar ─────────────────────────────────────────────────────────────────
  function salvar() {
    var nome = (document.getElementById('geo-nome').value || '').trim();
    if (!nome) { AL_CLIENTE.showAlert('O nome da geocerca é obrigatório.', 'warning'); document.getElementById('geo-nome').focus(); return; }
    if (!areaWkt) { AL_CLIENTE.showAlert('Desenhe uma área no mapa antes de salvar.', 'warning'); document.getElementById('geo-mapa').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    var payload = {
      nome: nome,
      area: areaWkt,
      tipo: tipoForma || 'poligono',
      dispositivos: dispositivosSelecionados.map(function (d) { return d.id; }),
      notificarCliente: document.getElementById('geo-notificar-cliente').checked,
      sistemasNotif: {
        email:    getChecked('geo-notif-email'),
        app:      getChecked('geo-notif-app')
      }
    };

    var descricao = (document.getElementById('geo-descricao').value || '').trim();
    if (descricao) payload.descricao = descricao;

    var dataInicio = document.getElementById('geo-data-inicio').value;
    if (dataInicio) payload.dataInicio = dataInicio;

    var btn = document.getElementById('btn-salvar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';

    var req = editandoId
      ? AL_CLIENTE.apiPut('/api/cliente/rastreamento/geocercas/' + editandoId, payload)
      : AL_CLIENTE.apiPost('/api/cliente/rastreamento/geocercas', payload);

    req.then(function () {
      AL_CLIENTE.showAlert(editandoId ? 'Geocerca atualizada!' : 'Geocerca criada!', 'success');
      setTimeout(function () { window.location.href = 'geocercas.html'; }, 900);
    }).catch(function (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message, 'danger');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-check"></i> Salvar Geocerca';
    });
  }

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function setChecked(id, value) {
    var el = document.getElementById(id);
    if (el) el.checked = !!value;
  }
  function getChecked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
