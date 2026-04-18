'use strict';

let map;
const marcadores = {};      // dispositivoId → L.Marker individual
const _clusterBadges = {};  // coordKey → L.Marker (badge com contador)
const _clusterGrupos = {};  // coordKey → { ids: [...], lat, lng }
let veiculosMap = {};
let traccarIdParaDispositivoId = {};
let boundsAjustados = false;

const CACHE_KEY = 'rastr_pos_v1';

let ws = null;
let wsReconectando = false;
let wsReconectTimer = null;
let ativoId = null;
let modoFoco = false;
const marcadoresIconeKey = {};
const _estadoSince = {}; // dispositivoId → { emMovimento, desde (ms) }

// Spider state (expansão de cluster)
const _spider = { markers: [], linhas: [], chave: null };

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  inicializarMapa();
  carregarPosicoes();
  document.getElementById('filtro').addEventListener('input', renderBuscaResultados);

  // Re-renderiza o card aberto quando o tema muda (para atualizar cores do velocímetro SVG)
  new MutationObserver(function () {
    if (ativoId) mostrarCardDispositivo(ativoId);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);

  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21 }
  );

  tilesCartoDB.addTo(map);

  L.control.layers(
    { 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // ── CSS do controle de toggle ─────────────────────────────────────────────
  (function () {
    const s = document.createElement('style');
    s.textContent = `
      .popup-toggle-ctrl { position: relative; }
      .popup-toggle-ctrl .pt-header { width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:default; }
      .popup-toggle-ctrl .pt-panel { display:none;position:absolute;right:0;top:0;background:#fff;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.4);padding:6px 0;min-width:130px;z-index:10; }
      .popup-toggle-ctrl:hover .pt-panel { display:block; }
      .dark-theme .popup-toggle-ctrl .pt-panel { background:#2d3748;color:#e2e8f0; }
      .pt-option { display:flex;align-items:center;gap:7px;padding:5px 12px;cursor:pointer;font-size:12px;white-space:nowrap; }
      .pt-option:hover { background:rgba(41,128,185,0.1); }
      .pt-radio { width:10px;height:10px;border:2px solid #aaa;border-radius:50%;flex-shrink:0; }
      .pt-radio.active { border-color:#2980b9;background:#2980b9; }
      .leaflet-control-layers-list { min-width:130px !important; }
    `;
    document.head.appendChild(s);
  })();

  let _popupToggleEl = null;
  function _sincRadiosPopup() {
    if (!_popupToggleEl) return;
    _popupToggleEl.querySelectorAll('.pt-option').forEach(function (el) {
      const ok = (el.dataset.val === '1') === _mostrarPopup;
      el.querySelector('.pt-radio').className = 'pt-radio' + (ok ? ' active' : '');
    });
  }

  const BtnPopupToggle = L.Control.extend({
    onAdd() {
      const c = L.DomUtil.create('div', 'leaflet-bar leaflet-control popup-toggle-ctrl');
      c.innerHTML = `
        <div class="pt-header"><i class="fa fa-tag" style="font-size:14px"></i></div>
        <div class="pt-panel">
          <div class="pt-option" data-val="1"><span class="pt-radio active"></span> Mostrar placa</div>
          <div class="pt-option" data-val="0"><span class="pt-radio"></span> Ocultar placa</div>
        </div>`;
      L.DomEvent.disableClickPropagation(c);
      _popupToggleEl = c;
      c.querySelectorAll('.pt-option').forEach(function (el) {
        L.DomEvent.on(el, 'click', function () {
          const novo = el.dataset.val === '1';
          if (novo === _mostrarPopup) return;
          _mostrarPopup = novo;
          _atualizarBindingsPopup();
          _sincRadiosPopup();
        });
      });
      return c;
    },
    onRemove() {},
  });
  new BtnPopupToggle({ position: 'topright' }).addTo(map);

  // ── Botão de localização do usuário (esquerda, abaixo do zoom) ─────────────
  let _marcadorUser = null;
  const BtnLoc = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control leaflet-loc-btn');
      btn.title = 'Minha localização';
      btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#000000;"></i>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function () {
        if (!navigator.geolocation) return;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size:11px;color:#2980b9;"></i>';
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            if (_marcadorUser) map.removeLayer(_marcadorUser);
            _marcadorUser = L.marker(latlng, { icon: L.divIcon({
              html: '<div style="width:14px;height:14px;background:#2980b9;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(41,128,185,0.25);"></div>',
              className: '', iconSize: [14,14], iconAnchor: [7,7],
            }) }).addTo(map).bindTooltip('Sua localização');
            map.setView(latlng, 16);
            btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>';
          },
          function () { btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>'; }
        );
      });
      return btn;
    },
    onRemove() {},
  });
  new BtnLoc({ position: 'topleft' }).addTo(map);

  // Fecha card quando popup do marcador ativo é fechado pelo X do Leaflet
  map.on('popupclose', function (e) {
    if (_togglingPopup) return;
    if (ativoId && marcadores[ativoId] && e.popup === marcadores[ativoId].getPopup()) {
      fecharCardDispositivo(true);
    }
  });

  // Clique fora de marcador fecha spider
  map.on('click', function () { _fecharSpider(); });

  // Re-agrupa por pixel ao mudar o zoom
  map.on('zoomend', function () {
    _fecharSpider();
    if (!modoFoco) renderMarcadores();
  });
}

// ── Snapshot inicial via REST ─────────────────────────────────────────────────

async function carregarPosicoes() {
  // 1. Renderizar cache instantaneamente enquanto o REST carrega
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const lista = JSON.parse(raw);
      lista.forEach(v => {
        veiculosMap[v.dispositivoId] = v;
        if (v.traccarId) traccarIdParaDispositivoId[v.traccarId] = v.dispositivoId;
      });
      renderMarcadores();
      renderSidebar();
      ajustarBounds();
      boundsAjustados = true;
    }
  } catch {}

  // 2. Conectar WebSocket imediatamente (já tem o mapeamento do cache)
  conectarWebSocket();

  // 3. Buscar dados frescos em segundo plano
  try {
    const lista = await window.AL.apiGet('/api/rastreamento/posicoes');

    // Remove marcadores de dispositivos que não existem mais
    Object.keys(marcadores).forEach(id => {
      if (!lista.find(v => v.dispositivoId === id)) {
        if (map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
        delete marcadores[id];
        delete marcadoresIconeKey[id];
      }
    });
    // Limpa todos os badges de cluster (serão recriados pelo renderMarcadores)
    Object.keys(_clusterBadges).forEach(chave => {
      if (map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]);
      delete _clusterBadges[chave];
    });
    Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);

    veiculosMap = {};
    traccarIdParaDispositivoId = {};
    lista.forEach(v => {
      veiculosMap[v.dispositivoId] = v;
      if (v.traccarId) traccarIdParaDispositivoId[v.traccarId] = v.dispositivoId;
      if (v.posicao && !_estadoSince[v.dispositivoId]) {
        _estadoSince[v.dispositivoId] = {
          emMovimento: v.posicao.emMovimento ?? null,
          desde: v.posicao.fixTime ? new Date(v.posicao.fixTime).getTime() : Date.now(),
        };
      }
    });

    try { localStorage.setItem(CACHE_KEY, JSON.stringify(lista)); } catch {}

    renderMarcadores();
    renderSidebar();
    if (!boundsAjustados) { ajustarBounds(); boundsAjustados = true; }
  } catch (err) {
    console.error('Erro ao carregar posições:', err);
    if (!Object.keys(veiculosMap).length) {
      document.getElementById('sidebar-counters').innerHTML =
        '<span style="color:#e74c3c"><i class="fa fa-exclamation-triangle"></i> Erro ao carregar</span>';
    }
  }
}

// ── WebSocket — atualizações em tempo real ────────────────────────────────────

function conectarWebSocket() {
  if (ws && ws.readyState < 2) return;

  const apiBase = window.API_URL || 'http://localhost:3000';
  const wsUrl = `${apiBase.replace(/^http/, 'ws')}/ws/rastreamento`;

  const token = localStorage.getItem('al_token');
  const url = token ? `${wsUrl}?token=${token}` : wsUrl;

  ws = new WebSocket(url);
  setWsStatus('reconectando', 'Conectando...');

  ws.onopen = () => {
    wsReconectando = false;
    setWsStatus('conectado', 'Tempo real ativo');
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    processarMensagemWs(msg);
  };

  ws.onclose = () => {
    setWsStatus('desconectado', 'Reconectando...');
    if (!wsReconectando) {
      wsReconectando = true;
      wsReconectTimer = setTimeout(conectarWebSocket, 5000);
    }
  };

  ws.onerror = () => ws.close();
}

function processarMensagemWs(msg) {
  if (msg.positions?.length) {
    msg.positions.forEach(pos => {
      const dispositivoId = traccarIdParaDispositivoId[pos.deviceId];
      if (!dispositivoId || !veiculosMap[dispositivoId]) return;

      const _emMov = pos.emMovimento ?? null;
      const _est = _estadoSince[dispositivoId];
      if (!_est || _est.emMovimento !== _emMov) {
        _estadoSince[dispositivoId] = { emMovimento: _emMov, desde: Date.now() };
      }

      veiculosMap[dispositivoId].posicao = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        velocidade: pos.velocidade,
        curso: pos.curso,
        altitude: pos.altitude,
        fixTime: pos.fixTime,
        deviceTime: pos.deviceTime,
        serverTime: pos.serverTime,
        valida: pos.valida,
        ignicao: pos.ignicao,
        emMovimento: pos.emMovimento,
        satelites: pos.satelites,
        bateria_nivel: pos.bateria_nivel,
        alarme: pos.alarme,
        alarme_codigo: pos.alarme_codigo,
        tensao: pos.tensao,
        sinal: pos.sinal,
        odometro: pos.odometro,
        horas_motor: pos.horas_motor,
        bloqueado: pos.bloqueado,
        endereco: pos.endereco,
      };

      atualizarMarcador(dispositivoId);
      atualizarCardAtivo(dispositivoId);
    });
  }

  if (msg.devices?.length) {
    msg.devices.forEach(d => {
      const dispositivoId = traccarIdParaDispositivoId[d.traccarId];
      if (!dispositivoId || !veiculosMap[dispositivoId]) return;

      veiculosMap[dispositivoId].status = d.status;
      veiculosMap[dispositivoId].lastUpdate = d.lastUpdate;

      atualizarMarcador(dispositivoId);
      atualizarCardAtivo(dispositivoId);
    });
  }

  renderSidebar(); // atualiza contadores
}

function setWsStatus(estado, texto) {
  const el = document.getElementById('ws-status');
  el.className = estado;
  el.innerHTML = `<i class="fa fa-circle"></i> ${texto}`;
}

// ── Cluster customizado ───────────────────────────────────────────────────────

const CLUSTER_PX = 40; // pixels — adapta ao zoom automaticamente

// Agrupa markers por proximidade visual (pixels na tela), não por distância geográfica fixa.
// Resultado: { chave → { ids: [...], lat, lng } }
function _agruparPorPixel() {
  const ids = Object.keys(veiculosMap).filter(id => veiculosMap[id]?.posicao);
  const visitados = new Set();
  const grupos = {};

  ids.forEach(id => {
    if (visitados.has(id)) return;
    const v = veiculosMap[id];
    const pt = map.latLngToContainerPoint([v.posicao.latitude, v.posicao.longitude]);

    const grupo = [id];
    visitados.add(id);

    ids.forEach(id2 => {
      if (visitados.has(id2)) return;
      const v2 = veiculosMap[id2];
      const pt2 = map.latLngToContainerPoint([v2.posicao.latitude, v2.posicao.longitude]);
      if (Math.hypot(pt.x - pt2.x, pt.y - pt2.y) <= CLUSTER_PX) {
        grupo.push(id2);
        visitados.add(id2);
      }
    });

    // Centróide do grupo
    const lat = grupo.reduce((s, i) => s + veiculosMap[i].posicao.latitude,  0) / grupo.length;
    const lng = grupo.reduce((s, i) => s + veiculosMap[i].posicao.longitude, 0) / grupo.length;
    const chave = [...grupo].sort().join('|');
    grupos[chave] = { ids: grupo, lat, lng };
  });

  return grupos;
}

function _criarIconeCluster(count) {
  return L.divIcon({
    html: `<div style="
      width:38px;height:38px;background:#8e44ad;
      border-radius:50%;border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:13px;font-weight:700;
    ">${count}</div>`,
    className: '', iconSize: [42, 42], iconAnchor: [21, 21],
  });
}

function _fecharSpider() {
  _spider.markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
  _spider.linhas.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  _spider.markers.length = 0;
  _spider.linhas.length = 0;
  _spider.chave = null;
}

function _abrirSpider(chave, centroLatLng) {
  if (_spider.chave === chave) { _fecharSpider(); return; } // toggle
  _fecharSpider();
  _spider.chave = chave;
  const ids = _clusterGrupos[chave]?.ids || [];
  const total = ids.length;
  ids.forEach((id, index) => {
    const v = veiculosMap[id];
    if (!v?.posicao) return;
    const centro = map.latLngToContainerPoint(centroLatLng);
    const raio = 55;
    const ang = (2 * Math.PI * index / total) - Math.PI / 2;
    const spiderLatLng = map.containerPointToLatLng([
      centro.x + raio * Math.cos(ang),
      centro.y + raio * Math.sin(ang),
    ]);
    const linha = L.polyline([centroLatLng, spiderLatLng], {
      color: '#666', weight: 1.5, opacity: 0.6, dashArray: '4,4',
    }).addTo(map);
    _spider.linhas.push(linha);
    const sm = L.marker(spiderLatLng, { icon: criarIcone(v), zIndexOffset: 1000 });
    if (_mostrarPopup) sm.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
    sm.on('click', function (e) {
      L.DomEvent.stopPropagation(e); // evita fechar spider pelo map.on('click')
      _fecharSpider();
      focar(id);
    });
    sm.addTo(map);
    _spider.markers.push(sm);
  });
}

// ── Marcadores no mapa ────────────────────────────────────────────────────────

function renderMarcadores() {
  const grupos = _agruparPorPixel(); // { chave → { ids, lat, lng } }

  // Atualiza estado global de grupos
  Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);
  Object.assign(_clusterGrupos, grupos);

  // Remove badges de clusters que deixaram de existir ou que se desfizeram
  Object.keys(_clusterBadges).forEach(chave => {
    if (!grupos[chave] || grupos[chave].ids.length < 2) {
      if (map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]);
      delete _clusterBadges[chave];
    }
  });

  Object.entries(grupos).forEach(([chave, { ids, lat, lng }]) => {
    const isCluster = ids.length > 1;

    // Marcadores individuais
    ids.forEach(id => {
      const v = veiculosMap[id];
      const { latitude, longitude } = v.posicao;
      // Visível no mapa quando: não está em cluster E (não está em modo foco OU é o ativo)
      const visivel = !isCluster && (!modoFoco || id === ativoId);

      if (!marcadores[id]) {
        const icone = criarIcone(v);
        marcadoresIconeKey[id] = _iconeKey(v);
        const marker = L.marker([latitude, longitude], { icon: icone });
        if (_mostrarPopup) marker.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
        marker.on('click', function (e) { L.DomEvent.stopPropagation(e); focar(id); });
        marcadores[id] = marker;
        if (visivel) marker.addTo(map);
      } else {
        marcadores[id].setLatLng([latitude, longitude]);
        const iconKey = _iconeKey(v);
        if (marcadoresIconeKey[id] !== iconKey) {
          marcadores[id].setIcon(criarIcone(v));
          marcadoresIconeKey[id] = iconKey;
        }
        if (visivel && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
        else if (!visivel && map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
      }
    });

    // Badge de cluster
    if (isCluster) {
      if (modoFoco) {
        if (_clusterBadges[chave] && map.hasLayer(_clusterBadges[chave])) {
          map.removeLayer(_clusterBadges[chave]);
        }
        return;
      }
      if (_clusterBadges[chave]) {
        _clusterBadges[chave].setLatLng([lat, lng]);
        _clusterBadges[chave].setIcon(_criarIconeCluster(ids.length));
        if (!map.hasLayer(_clusterBadges[chave])) _clusterBadges[chave].addTo(map);
      } else {
        const badge = L.marker([lat, lng], { icon: _criarIconeCluster(ids.length), zIndexOffset: 500 });
        badge.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          _abrirSpider(chave, badge.getLatLng());
        });
        _clusterBadges[chave] = badge;
        badge.addTo(map);
      }
    }
  });
}

function atualizarMarcador(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v?.posicao) return;

  const { latitude, longitude } = v.posicao;

  if (!marcadores[dispositivoId]) {
    renderMarcadores();
    return;
  }

  marcadores[dispositivoId].setLatLng([latitude, longitude]);

  const iconKey = _iconeKey(v);
  if (marcadoresIconeKey[dispositivoId] !== iconKey) {
    marcadores[dispositivoId].setIcon(criarIcone(v));
    marcadoresIconeKey[dispositivoId] = iconKey;
  }

  if (_mostrarPopup && marcadores[dispositivoId].getPopup()?.isOpen()) {
    marcadores[dispositivoId].getPopup().setContent(criarPopupSimples(v));
  }
}

function _corMarcador(v) {
  if (!v.posicao || v.status !== 'online') return '#95a5a6'; // cinza: offline ou sem dados
  if (v.limiteVelocidade && v.posicao.velocidade > v.limiteVelocidade) return '#e74c3c'; // vermelho: excesso
  if (v.posicao.emMovimento || v.posicao.ignicao === true) return '#2980b9'; // azul: em movimento ou ignição ligada
  return '#27ae60'; // verde: parado / ignição desligada
}

function _iconeKey(v) {
  const course = v.posicao ? Math.round(v.posicao.curso / 5) * 5 : 0; // Agrupa de 5 em 5 graus para evitar re-renders excessivos
  return `${_corMarcador(v)}|${v.categoria}|${course}`;
}

// ── Mapeamento categoria → ícone 3D ──────────────────────────────────────────

function criarIcone(v) {
  const cor = _corMarcador(v);
  const course = v.posicao ? v.posicao.curso : 0;
  const html = AL_ICONS_3D.getSvgHtml(v.categoria, cor, course);
  return L.divIcon({ html, className: '', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -14] });
}

// ── Popup simplificado (apenas placa) ────────────────────────────────────────

let _mostrarPopup = true;
let _togglingPopup = false;

function criarPopupSimples(v) {
  const txt = v.placa || v.nome;
  return `<div style="padding:3px 8px;font-size:12px;font-weight:700;letter-spacing:0.5px">${txt}</div>`;
}

function _atualizarBindingsPopup() {
  _togglingPopup = true;
  Object.entries(marcadores).forEach(([id, m]) => {
    if (_mostrarPopup) {
      const v = veiculosMap[id];
      if (v) m.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
    } else {
      m.closePopup();
      m.unbindPopup();
    }
  });
  _togglingPopup = false;
  if (_mostrarPopup && ativoId && marcadores[ativoId] && map.hasLayer(marcadores[ativoId])) {
    marcadores[ativoId].openPopup();
  }
}

// ── Velocímetro SVG ───────────────────────────────────────────────────────────

function svgVelocimetro(velocidade, limite) {
  if (velocidade == null) return '';
  const isDark = document.documentElement.classList.contains('dark-theme');
  const numColor = isDark ? '#f0f2f5' : '#333';
  const lblColor = isDark ? '#adb5bd' : '#555';
  const trackColor = isDark ? '#2d3748' : '#e9ecef';
  const max = Math.max(limite || 120, 120);
  const f = Math.min(velocidade / max, 1);
  const angRad = Math.PI * (1 - f);
  const ex = (40 + 30 * Math.cos(angRad)).toFixed(1);
  const ey = (45 - 30 * Math.sin(angRad)).toFixed(1);
  const largeArc = f > 0.5 ? 1 : 0;
  const cor = limite && velocidade > limite ? '#e74c3c' : velocidade > 80 ? '#f39c12' : '#27ae60';
  const arc = f > 0.01
    ? `<path d="M 10 45 A 30 30 0 ${largeArc} 1 ${ex} ${ey}" fill="none" stroke="${cor}" stroke-width="7" stroke-linecap="round"/>`
    : '';
  return `<svg width="90" height="54" viewBox="0 0 90 54" style="display:block;margin:4px auto 8px">
    <path d="M 10 45 A 30 30 0 0 1 70 45" fill="none" stroke="${trackColor}" stroke-width="7" stroke-linecap="round"/>
    ${arc}
    <text x="40" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="${numColor}">${velocidade}</text>
    <text x="40" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="${lblColor}">km/h</text>
  </svg>`;
}

function fmtGPSTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtGPSTimeSec(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTempoDecorrido(iso) {
  if (!iso) return '';
  return fmtTempoDecorridoMs(new Date(iso).getTime());
}

function fmtTempoDecorridoMs(ms) {
  if (!ms) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const dias = Math.floor(hrs / 24);
  return `${dias} dia${dias > 1 ? 's' : ''}`;
}

// ── Sidebar — contadores ──────────────────────────────────────────────────────

function renderSidebar() {
  const todos = Object.values(veiculosMap);
  const online  = todos.filter(v => v.status === 'online').length;
  const offline = todos.filter(v => v.status !== 'online').length;
  const semPos  = todos.filter(v => !v.posicao).length;

  document.getElementById('sidebar-counters').innerHTML =
    `<span class="dot-moving">●</span> ${online} online &nbsp;·&nbsp;
     <span class="dot-offline">●</span> ${offline} offline
     ${semPos ? `&nbsp;·&nbsp; <span style="color:#e67e22">${semPos} sem posição</span>` : ''}`;
}

// ── Resultados de busca ───────────────────────────────────────────────────────

function renderBuscaResultados() {
  const filtro = (document.getElementById('filtro').value || '').toLowerCase().trim();
  const el = document.getElementById('lista-resultados-busca');

  if (!filtro) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const todos = Object.values(veiculosMap);
  const filtrados = todos.filter(v =>
    v.nome.toLowerCase().includes(filtro) ||
    (v.placa && v.placa.toLowerCase().includes(filtro)) ||
    (v.cliente?.nome.toLowerCase().includes(filtro))
  ).slice(0, 8);

  if (!filtrados.length) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#aaa;font-size:12px">Nenhum resultado.</div>';
    el.style.display = 'block';
    return;
  }

  filtrados.sort((a, b) => pesoStatus(a) - pesoStatus(b));

  el.innerHTML = filtrados.map(v => {
    const p = v.posicao;
    const refTime = p?.fixTime || p?.serverTime || v.lastUpdate;
    const tempoStr = refTime ? ` · há ${fmtTempoDecorrido(refTime)}` : '';
    let dotClass = p ? 'dot-lastpos' : 'dot-offline', txtStatus = `Offline${tempoStr}`;
    if (v.status === 'online' && p?.emMovimento) { dotClass = 'dot-moving'; txtStatus = `Em movimento · ${p.velocidade} km/h${tempoStr}`; }
    else if (v.status === 'online') { dotClass = 'dot-online'; txtStatus = `Parado${tempoStr}`; }

    return `<div class="veiculo-item${v.dispositivoId === ativoId ? ' ativo' : ''}" onclick="selecionarDaBusca('${v.dispositivoId}')">
      <div class="v-nome">${v.nome}${v.placa ? `&nbsp;<span class="v-placa">${v.placa}</span>` : ''}</div>
      <div class="v-status"><i class="fa fa-circle ${dotClass}"></i> ${txtStatus}</div>
    </div>`;
  }).join('');

  el.style.display = 'block';
}

window.selecionarDaBusca = function (id) {
  document.getElementById('filtro').value = '';
  document.getElementById('lista-resultados-busca').style.display = 'none';
  focar(id);
};

function pesoStatus(v) {
  if (v.status !== 'online') return 2;
  if (v.posicao?.motion) return 0;
  return 1;
}

// ── Card do dispositivo selecionado ───────────────────────────────────────────

function mostrarCardDispositivo(id) {
  const v = veiculosMap[id];
  if (!v) return;

  ativoId = id;
  const p = v.posicao;
  const isOnline = v.status === 'online';
  const isMoving = isOnline && p?.emMovimento;

  const corStatus = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
  const txtStatus = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');

  const apiBase = window.API_URL || '';
  const addrId = `dcard-addr-${id}`;

  const estadoDesde = _estadoSince[id]?.desde
    || (p?.fixTime ? new Date(p.fixTime).getTime() : null)
    || (v.lastUpdate ? new Date(v.lastUpdate).getTime() : null);
  const tempoSufixo = estadoDesde ? ` — há ${fmtTempoDecorridoMs(estadoDesde)}` : '';

  const bat = p?.bateria_nivel != null ? p.bateria_nivel : null;
  const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
  const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';

  const cacheKey = p ? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}` : null;
  const hasCached = cacheKey != null && cacheKey in _geocodeCache;
  const cachedAddr = hasCached ? _geocodeCache[cacheKey] : null;
  const coords = p ? `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})` : '';
  const addrTxt = hasCached ? (cachedAddr ? `${cachedAddr} ${coords}` : coords) : (p ? 'Buscando...' : '—');

  const imgHtml = v.imagemUrl
    ? `<img src="${apiBase}${v.imagemUrl}" style="width:100%;height:140px;object-fit:cover;display:block" onerror="this.style.display='none'" />`
    : '';

  // Monta itens de status — exibe apenas os que o dispositivo enviou
  const si = [];
  if (p?.ignicao === true)  si.push(`<span style="color:#27ae60"><i class="fa fa-key"></i> Ignição: Ligado</span>`);
  if (p?.ignicao === false) si.push(`<span style="color:#bdc3c7"><i class="fa fa-key"></i> Ignição: Desligado</span>`);
  if (bat != null)          si.push(`<span style="color:${batCor}"><i class="fa ${batFa}"></i> Bateria: ${bat}%</span>`);
  if (p?.tensao != null)    si.push(`<span style="color:#8e44ad"><i class="fa fa-bolt"></i> Tensão: ${p.tensao.toFixed(1)} V</span>`);
  if (p?.odometro != null)  si.push(`<span><i class="fa fa-tachometer" style="color:#7f8c8d"></i> Odômetro: ${Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km</span>`);
  if (p?.horas_motor != null) si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h</span>`);
  if (p?.motorista_id)      si.push(`<span><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> Motorista: ${p.motorista_id}</span>`);
  if (p?.bloqueado != null) si.push(`<span style="color:${p.bloqueado ? '#e74c3c' : '#27ae60'}"><i class="fa fa-${p.bloqueado ? 'lock' : 'unlock'}"></i> ${p.bloqueado ? 'Bloqueado' : 'Desbloqueado'}</span>`);

  // Três horários com data + hora + segundos
  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';
  const horasHtml = p ? `
    <div class="dcard-section dcard-val">
      <div style="margin-bottom:2px"><i class="fa fa-server" style="${ico}"></i> <span class="dcard-lbl">Servidor:</span> <span id="dcard-ts-srv">${fmtGPSTimeSec(p.serverTime)}</span></div>
      <div style="margin-bottom:2px"><i class="fa fa-mobile" style="${ico}"></i> <span class="dcard-lbl">Dispositivo:</span> <span id="dcard-ts-dev">${fmtGPSTimeSec(p.deviceTime)}</span></div>
      <div><i class="fa fa-crosshairs" style="${ico}"></i> <span class="dcard-lbl">GPS:</span> <span id="dcard-ts-gps">${fmtGPSTimeSec(p.fixTime)}</span></div>
    </div>` : '';

  const card = document.getElementById('device-detail-card');
  card.innerHTML = `
    ${imgHtml}
    <div class="dcard-header">
      <div style="flex:1;min-width:0">
        <div class="v-nome">${v.nome}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          ${v.placa ? `<span class="v-placa">${v.placa}</span>` : '<span></span>'}
          ${v.identificador ? `<span class="v-placa" style="font-family:monospace">${v.identificador}</span>` : ''}
        </div>
      </div>
      <button class="dcard-fechar" onclick="fecharCardDispositivo()" title="Fechar" style="margin-left:6px;flex-shrink:0">×</button>
    </div>
    <div class="dcard-body">
      ${v.cliente ? `<div style="font-size:12px;color:#888;margin-bottom:4px"><i class="fa fa-user" style="color:#2980b9;width:13px"></i> ${v.cliente.nome}</div>` : ''}
      <div style="margin-bottom:6px">
        <span id="dcard-status-line" style="color:${corStatus}"><i class="fa fa-circle" style="font-size:9px;vertical-align:middle"></i> ${txtStatus}${tempoSufixo}</span>
        ${!p ? '&nbsp;<span style="color:#e67e22;font-size:11px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : ''}
      </div>
      <div id="dcard-velocimetro">${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}</div>
      <hr id="dcard-divider-speed" style="margin:2px 0 6px;border:none;border-top:1px solid rgba(128,128,128,0.15)${p?.velocidade != null ? '' : ';display:none'}">
      <div id="dcard-status-items" style="font-size:12px;display:flex;flex-direction:column;gap:3px;margin-bottom:8px">${si.join('')}</div>
      ${horasHtml}
      ${p ? `<div class="dcard-section dcard-val" style="line-height:1.4">
          <i class="fa fa-map-pin" style="color:#e74c3c;width:13px"></i>
          <span id="${addrId}" data-lat="${p.latitude}" data-lng="${p.longitude}">${addrTxt}</span>
        </div>` : ''}
      <div style="margin-top:10px;display:flex;gap:6px">
        <a href="relatorio.html?id=${v.dispositivoId}" class="btn btn-xs btn-primary" style="flex:1;text-align:center;color:#fff">
          <i class="fa fa-bar-chart"></i> Relatório
        </a>
        <a href="rastreamento-detalhe.html?id=${v.dispositivoId}" class="btn btn-xs btn-default" style="flex:1;text-align:center">
          <i class="fa fa-history"></i> Histórico
        </a>
      </div>
    </div>
  `;

  card.style.display = 'block';

  // Auto-geocodifica se não estiver em cache
  if (p && !hasCached) {
    geocodificarCoordenadas(p.latitude, p.longitude, addrId);
  }
}

window.fecharCardDispositivo = function (skipClosePopup) {
  if (modoFoco) desativarFoco();
  document.getElementById('device-detail-card').style.display = 'none';
  ativoId = null;
  if (!skipClosePopup) map.closePopup();
};

function atualizarCardAtivo(dispositivoId) {
  if (dispositivoId !== ativoId) return;
  const card = document.getElementById('device-detail-card');
  if (!card || card.style.display === 'none') return;

  const v = veiculosMap[dispositivoId];
  if (!v) return;
  const p = v.posicao;

  const elSt = document.getElementById('dcard-status-line');
  if (elSt) {
    const isOnline = v.status === 'online', isMoving = isOnline && p?.emMovimento;
    const cor = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
    const txt = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');
    const desde = _estadoSince[dispositivoId]?.desde || null;
    const sufixo = desde ? ` — há ${fmtTempoDecorridoMs(desde)}` : '';
    elSt.style.color = cor;
    elSt.innerHTML = `<i class="fa fa-circle" style="font-size:9px;vertical-align:middle"></i> ${txt}${sufixo}`;
  }

  const elVel = document.getElementById('dcard-velocimetro');
  if (elVel) elVel.innerHTML = p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : '';

  const elDiv = document.getElementById('dcard-divider-speed');
  if (elDiv) elDiv.style.display = p?.velocidade != null ? '' : 'none';

  const elSI = document.getElementById('dcard-status-items');
  if (elSI) {
    const bat = p?.bateria_nivel != null ? p.bateria_nivel : null;
    const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
    const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';
    const si = [];
    if (p?.ignicao === true)  si.push(`<span style="color:#27ae60"><i class="fa fa-key"></i> Ignição: Ligado</span>`);
    if (p?.ignicao === false) si.push(`<span style="color:#bdc3c7"><i class="fa fa-key"></i> Ignição: Desligado</span>`);
    if (bat != null)          si.push(`<span style="color:${batCor}"><i class="fa ${batFa}"></i> Bateria: ${bat}%</span>`);
    if (p?.tensao != null)    si.push(`<span style="color:#8e44ad"><i class="fa fa-bolt"></i> Tensão: ${p.tensao.toFixed(1)} V</span>`);
    if (p?.odometro != null)  si.push(`<span><i class="fa fa-tachometer" style="color:#7f8c8d"></i> Odômetro: ${Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km</span>`);
    if (p?.horas_motor != null) si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h</span>`);
    if (p?.motorista_id)      si.push(`<span><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> Motorista: ${p.motorista_id}</span>`);
    if (p?.bloqueado != null) si.push(`<span style="color:${p.bloqueado ? '#e74c3c' : '#27ae60'}"><i class="fa fa-${p.bloqueado ? 'lock' : 'unlock'}"></i> ${p.bloqueado ? 'Bloqueado' : 'Desbloqueado'}</span>`);
    elSI.innerHTML = si.join('');
  }

  const tsSrv = document.getElementById('dcard-ts-srv');
  const tsDev = document.getElementById('dcard-ts-dev');
  const tsGps = document.getElementById('dcard-ts-gps');
  if (tsSrv && p) tsSrv.textContent = fmtGPSTimeSec(p.serverTime);
  if (tsDev && p) tsDev.textContent = fmtGPSTimeSec(p.deviceTime);
  if (tsGps && p) tsGps.textContent = fmtGPSTimeSec(p.fixTime);

  if (modoFoco && v?.posicao) {
    map.panTo([v.posicao.latitude, v.posicao.longitude], { animate: true, duration: 0.5 });
  }
}

// ── Modo foco ─────────────────────────────────────────────────────────────────

function ativarFoco(id) {
  modoFoco = true;
  _fecharSpider();
  // Oculta todos os badges de cluster
  Object.values(_clusterBadges).forEach(b => { if (map.hasLayer(b)) map.removeLayer(b); });
  // Oculta todos os marcadores individuais exceto o ativo
  Object.keys(marcadores).forEach(mid => {
    if (mid !== id && map.hasLayer(marcadores[mid])) map.removeLayer(marcadores[mid]);
  });
  // Garante que o ativo está visível
  if (marcadores[id] && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
}

function desativarFoco() {
  modoFoco = false;
  _fecharSpider();
  renderMarcadores(); // reconstrói todos os marcadores e badges
}

// ── Interações ────────────────────────────────────────────────────────────────

window.focar = function (dispositivoId) {
  mostrarCardDispositivo(dispositivoId);

  const v = veiculosMap[dispositivoId];
  if (!v?.posicao) return; // sem posição: abre card apenas

  ativarFoco(dispositivoId);
  const { latitude, longitude } = v.posicao;
  map.flyTo([latitude, longitude], 16, { animate: true, duration: 0.8 });

  // Abre popup no marcador após a animação (para navegação via busca)
  setTimeout(() => {
    if (_mostrarPopup && marcadores[dispositivoId] && map.hasLayer(marcadores[dispositivoId])) {
      marcadores[dispositivoId].openPopup();
    }
  }, 900);
};

function ajustarBounds() {
  const comPosicao = Object.values(veiculosMap).filter(v => v.posicao);
  if (!comPosicao.length) return;

  if (comPosicao.length === 1) {
    const { latitude, longitude } = comPosicao[0].posicao;
    map.setView([latitude, longitude], 13);
    return;
  }

  const group = new L.FeatureGroup(
    comPosicao.map(v => L.marker([v.posicao.latitude, v.posicao.longitude]))
  );
  map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 14 });
}

// ── Geocodificação reversa (Nominatim) ────────────────────────────────────────

const _geocodeCache = {};

function _formatarEndereco(a) {
  const partes = [];
  if (a.amenity)  partes.push(a.amenity);
  if (a.road)     partes.push(a.house_number ? `${a.road}, ${a.house_number}` : a.road);
  const bairro = a.suburb || a.neighbourhood || a.quarter;
  if (bairro)     partes.push(bairro);
  const cidade = a.city || a.town || a.village || a.municipality;
  if (cidade)     partes.push(cidade);
  if (a.state)    partes.push(a.state);
  if (a.postcode) partes.push(a.postcode);
  if (a.country)  partes.push(a.country);
  return partes.join(', ');
}

window.geocodificarCoordenadas = async function (lat, lng, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const coords = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;

  if (cacheKey in _geocodeCache) {
    const cached = _geocodeCache[cacheKey];
    el.textContent = cached ? `${cached} ${coords}` : coords;
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR`;
    const res = await fetch(url);
    const data = await res.json();
    const end = data.address ? _formatarEndereco(data.address) : '';
    _geocodeCache[cacheKey] = end;
    el.textContent = end ? `${end} ${coords}` : coords;
  } catch {
    el.textContent = coords;
  }
};
