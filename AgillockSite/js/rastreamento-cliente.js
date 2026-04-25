'use strict';

// ── Estado ────────────────────────────────────────────────────────────────────

let map;
const marcadores  = {};
const _clusterBadges = {};
const _clusterGrupos = {};
const marcadoresIconeKey = {};
const _estadoSince = {};
let veiculosMap = {};
let traccarIdParaDispositivoId = {};
let boundsAjustados = false;
const _spider = { markers: [], linhas: [], chave: null };
const CACHE_KEY = 'rastr_cli_pos_v1';
const CLUSTER_PX = 40;

let ws = null;
let wsReconectando = false;
let wsReconectTimer = null;
let ativoId = null;
let modoFoco = false;
const _geocodeCache = {};
const _resumoHojeClienteCache = {};
const _resumoHojeClientePendentes = {};
const CLIENT_FOCUS_STORAGE_KEY = 'rastreamento_cliente_foco';

// ── Camadas de overlay ────────────────────────────────────────────────────────
const _overlay = {
  alarmes: true,
  labels: true,
  cercas: false,
  rastro: false,
};
const _rastros = {};
const _alarmeBadges = {};
const _rotasIndividuais = {};
let _cercasLayer = null;
let _modoDesenho = null; // null | { dispositivoId, circle }
let _cercaPendente = { ponto: null, dispositivoId: null };

function _intervaloHojeCliente() {
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1000);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

function _salvarFocoCliente(dispositivoId) {
  if (!dispositivoId) return;
  try { sessionStorage.setItem(CLIENT_FOCUS_STORAGE_KEY, dispositivoId); } catch {}
}

function _limparFocoCliente() {
  try { sessionStorage.removeItem(CLIENT_FOCUS_STORAGE_KEY); } catch {}
}

function _restaurarFocoCliente() {
  if (ativoId) return;
  const focusUrl = new URLSearchParams(window.location.search).get('focus');
  let dispositivoId = focusUrl;
  if (!dispositivoId) {
    try { dispositivoId = sessionStorage.getItem(CLIENT_FOCUS_STORAGE_KEY); } catch {}
  }
  if (!dispositivoId || !veiculosMap[dispositivoId]) return;
  focarCliente(dispositivoId);
}

// ── Eventos (cliente: apenas 4 tipos) ────────────────────────────────────────
const TIPOS_EVENTO_CLIENTE = [
  { tipo: 'ignitionOn',   label: 'Ignição Ligada',          css: 'tipo-ignition' },
  { tipo: 'ignitionOff',  label: 'Ignição Desligada',        css: 'tipo-ignition' },
  { tipo: 'geofenceEnter',label: 'Entrada na Cerca Virtual', css: 'tipo-geofence' },
  { tipo: 'geofenceExit', label: 'Saída da Cerca Virtual',   css: 'tipo-geofence' },
];

let _evtFiltros = new Set();
let _evtNotif = true;
const _eventos = [];
const MAX_EVENTOS = 100;
const EVENTOS_PANEL_STORAGE_KEY = 'rastreamento_cliente_eventos_min';
const BARRA_VEICULOS_STORAGE_KEY = 'rastreamento_cliente_barra_min';
let _googleMapLayers = {};
let _googleMapType = 'roadmap';
let _googleMapTypeControl = null;
let _baseMapControlLayers = {};

const GOOGLE_MAP_TYPES = {
  roadmap: { label: 'Mapa', icon: 'fa-map-o', lyrs: 'm' },
  satellite: { label: 'Satélite', icon: 'fa-globe', lyrs: 's' },
  hybrid: { label: 'Híbrido', icon: 'fa-clone', lyrs: 'y' },
  terrain: { label: 'Terreno', icon: 'fa-area-chart', lyrs: 'p' },
};

function _urlStreetView(lat, lng) {
  return `https://www.google.com/maps?q=&layer=c&cbll=${encodeURIComponent(`${lat},${lng}`)}`;
}

function _htmlBotaoStreetView(lat, lng) {
  return `<a href="${_urlStreetView(lat, lng)}" target="_blank" rel="noopener noreferrer" class="dcard-streetview-btn" title="Abrir no Street View"><i class="fa fa-street-view"></i></a>`;
}

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  verificarAcesso().then(function (bloqueado) {
    if (bloqueado) return;
    inicializarMapa();
    inicializarEventosPanel();
    inicializarBarraVeiculos();
    carregarPosicoes();
    document.getElementById('filtro').addEventListener('input', renderBuscaResultados);
    new MutationObserver(function () {
      if (ativoId) atualizarCardAtivo(ativoId);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Fechar busca ao clicar fora
    document.addEventListener('click', function (e) {
      const wrap = document.getElementById('topbar-busca-wrap');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('lista-resultados-busca').style.display = 'none';
      }
    });

    // Fechar popup de evento
    document.getElementById('btn-fechar-evt-popup').addEventListener('click', function () {
      document.getElementById('evento-popup-mapa').style.display = 'none';
    });
  });
});

// ── Verificação de bloqueio ───────────────────────────────────────────────────

async function verificarAcesso() {
  try {
    const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/status-acesso');
    if (data && data.bloqueado) {
      const msg = data.diasAtraso
        ? `Existe um boleto em atraso há ${data.diasAtraso} dias. Regularize o pagamento para voltar a acessar.`
        : 'Existe um boleto em atraso. Regularize o pagamento para voltar a acessar.';
      document.getElementById('bloqueio-msg').textContent = msg;
      $('#modal-bloqueio').modal('show');
      return true;
    }
  } catch (e) { /* ignora erros de rede */ }
  return false;
}

// ── Painel de Eventos ─────────────────────────────────────────────────────────

function inicializarEventosPanel() {
  _aplicarEstadoPainelEventos();
  const dropdown = document.getElementById('evt-tipo-dropdown');
  dropdown.innerHTML = TIPOS_EVENTO_CLIENTE.map(t =>
    `<label class="evt-tipo-item">
      <input type="checkbox" data-tipo="${t.tipo}" checked>
      ${t.label}
    </label>`
  ).join('');

  dropdown.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      _atualizarFiltrosTipo();
      renderEventosLista();
    });
  });

  document.getElementById('evt-tipo-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.getElementById('evt-btn-notif').addEventListener('click', function () {
    _evtNotif = !_evtNotif;
    this.classList.toggle('ativo', _evtNotif);
  });

  document.getElementById('evt-btn-limpar').addEventListener('click', function () {
    _eventos.length = 0;
    renderEventosLista();
  });

  document.getElementById('evt-btn-toggle').addEventListener('click', function () {
    const panel = document.getElementById('eventos-panel');
    if (!panel) return;
    panel.classList.toggle('minimizado');
    try { localStorage.setItem(EVENTOS_PANEL_STORAGE_KEY, panel.classList.contains('minimizado') ? '1' : '0'); } catch {}
    this.title = panel.classList.contains('minimizado') ? 'Expandir eventos' : 'Minimizar eventos';
    if (map) setTimeout(() => map.invalidateSize(), 220);
  });
}

function _aplicarEstadoPainelEventos() {
  const panel = document.getElementById('eventos-panel');
  const btn = document.getElementById('evt-btn-toggle');
  if (!panel || !btn) return;
  let minimizado = false;
  try { minimizado = localStorage.getItem(EVENTOS_PANEL_STORAGE_KEY) === '1'; } catch {}
  panel.classList.toggle('minimizado', minimizado);
  btn.title = minimizado ? 'Expandir eventos' : 'Minimizar eventos';
}

function inicializarBarraVeiculos() {
  _aplicarEstadoBarraVeiculos();
  const btn = document.getElementById('barra-veiculos-toggle');
  const wrap = document.getElementById('barra-veiculos-wrap');
  if (!btn || !wrap) return;

  btn.addEventListener('click', function () {
    wrap.classList.toggle('minimizada');
    const minimizada = wrap.classList.contains('minimizada');
    try { localStorage.setItem(BARRA_VEICULOS_STORAGE_KEY, minimizada ? '1' : '0'); } catch {}
    btn.title = minimizada ? 'Expandir dispositivos' : 'Minimizar dispositivos';
    if (!minimizada) {
      const barra = document.getElementById('barra-veiculos');
      if (barra && barra.scrollTop < 0) barra.scrollTop = 0;
    }
    if (map) setTimeout(() => map.invalidateSize(), 220);
  });
}

function _aplicarEstadoBarraVeiculos() {
  const wrap = document.getElementById('barra-veiculos-wrap');
  const btn = document.getElementById('barra-veiculos-toggle');
  if (!wrap || !btn) return;
  let minimizada = false;
  try { minimizada = localStorage.getItem(BARRA_VEICULOS_STORAGE_KEY) === '1'; } catch {}
  wrap.classList.toggle('minimizada', minimizada);
  btn.title = minimizada ? 'Expandir dispositivos' : 'Minimizar dispositivos';
}

function _atualizarFiltrosTipo() {
  const checkboxes = document.querySelectorAll('#evt-tipo-dropdown input[type=checkbox]');
  _evtFiltros.clear();
  let todas = true;
  checkboxes.forEach(function (cb) {
    if (!cb.checked) { _evtFiltros.add(cb.dataset.tipo); todas = false; }
  });
  const label = document.getElementById('evt-tipo-label');
  if (todas) {
    label.textContent = 'Tipo';
  } else {
    const ativas = TIPOS_EVENTO_CLIENTE.length - _evtFiltros.size;
    label.textContent = `Tipo (${ativas}/${TIPOS_EVENTO_CLIENTE.length})`;
  }
}

function adicionarEvento(evt) {
  // Filtra apenas os tipos permitidos para cliente
  const tiposPermitidos = TIPOS_EVENTO_CLIENTE.map(t => t.tipo);
  if (!tiposPermitidos.includes(evt.tipo)) return;
  _eventos.unshift(evt);
  if (_eventos.length > MAX_EVENTOS) _eventos.length = MAX_EVENTOS;
  renderEventosLista();
  if (_evtNotif) _tocarSomEvento(evt.tipo);
}

function _tocarSomEvento(tipo) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tipo === 'geofenceEnter' || tipo === 'geofenceExit' ? 880 : 660, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

function renderEventosLista() {
  const lista = document.getElementById('eventos-lista');
  const filtrados = _eventos.filter(e => !_evtFiltros.has(e.tipo));

  if (!filtrados.length) {
    lista.innerHTML = `<div id="eventos-vazio">
      <i class="fa fa-bell-o" style="font-size:28px;display:block;margin-bottom:8px;color:#ddd"></i>
      Aguardando eventos...
    </div>`;
    return;
  }

  lista.innerHTML = filtrados.map(function (e) {
    const css = (e.tipo === 'geofenceEnter' || e.tipo === 'geofenceExit') ? 'tipo-geofence' : 'tipo-ignition';
    const tempo = fmtTempoDecorrido(e.serverTime);
    const nomeDev = _nomeDispositivo(e.dispositivoId);
    return `<div class="evento-item ${css}" onclick="clicarEvento(${_eventos.indexOf(e)})">
      <div class="evt-dispositivo">${nomeDev}</div>
      <div class="evt-desc">${e.tipoLabel || e.tipo}</div>
      <div class="evt-footer">
        <span class="evt-tempo">há ${tempo}</span>
        <i class="fa fa-map-marker evt-ico-pin"></i>
      </div>
    </div>`;
  }).join('');
}

function _nomeDispositivo(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v) return dispositivoId || '—';
  return v.placa ? `${v.nome} ${v.placa}` : v.nome;
}

window.clicarEvento = function (idx) {
  const e = _eventos[idx];
  if (!e) return;

  if (e.dispositivoId && veiculosMap[e.dispositivoId]?.posicao) {
    focar(e.dispositivoId);
  } else if (e.lat != null && e.lng != null) {
    map.flyTo([e.lat, e.lng], 16, { animate: true, duration: 0.8 });
  }

  const popup = document.getElementById('evento-popup-mapa');
  document.getElementById('ep-titulo').textContent = e.tipoLabel || e.tipo;

  const dt = e.serverTime ? new Date(e.serverTime) : null;
  document.getElementById('ep-data').textContent = dt
    ? `${dt.toLocaleDateString('pt-BR')} | ${dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`
    : '';

  const pos = veiculosMap[e.dispositivoId]?.posicao;
  if (pos) {
    const addrId = 'ep-end-addr';
    document.getElementById('ep-end').id = addrId;
    document.getElementById('ep-end').textContent = 'Buscando endereço...';
    geocodificarCoordenadas(pos.latitude, pos.longitude, addrId);
  } else {
    document.getElementById('ep-end').textContent = _nomeDispositivo(e.dispositivoId);
  }

  popup.style.display = 'block';
};

// ── Mapa ──────────────────────────────────────────────────────────────────────

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: false, maxZoom: 21 }).setView([-15.78, -47.93], 5);

  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 21 }
  );
  _googleMapLayers = _criarCamadasGoogle();
  _baseMapControlLayers = {
    google: _googleMapLayers.roadmap,
    carto: tilesCartoDB,
    osm: tilesOsm,
    esri: tilesEsri,
  };
  _googleMapLayers.roadmap.addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.layers(
    { 'Google Maps': _googleMapLayers.roadmap, 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {}, { position: 'topright', collapsed: true }
  ).addTo(map);
  _adicionarControleTipoGoogle();
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Localização primeiro → tray toggle fica abaixo
  _adicionarBotaoLocalizacao(map);
  _adicionarBotoesCamadas();

  map.on('popupclose', function (e) {
    if (_togglingPopup || _modoDesenho) return;
    if (ativoId && marcadores[ativoId] && e.popup === marcadores[ativoId].getPopup()) fecharCardDispositivo(true);
  });
  map.on('baselayerchange', function () {
    _atualizarControleTipoGoogle();
  });
  map.on('click', function () { if (!_modoDesenho) _fecharSpider(); });
  map.on('zoomend', function () { _fecharSpider(); if (!modoFoco) renderMarcadores(); });

  requestAnimationFrame(function () {
    map.invalidateSize();
    setTimeout(function () { map.invalidateSize(); }, 120);
    setTimeout(function () { map.invalidateSize(); }, 320);
  });
  window.addEventListener('resize', function () { if (map) map.invalidateSize(); });
}

function _criarCamadasGoogle() {
  const opts = {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: 'Map data © Google',
    maxNativeZoom: 20,
    maxZoom: 21,
  };
  return Object.keys(GOOGLE_MAP_TYPES).reduce(function (acc, tipo) {
    acc[tipo] = L.tileLayer(
      'https://{s}.google.com/vt/lyrs=' + GOOGLE_MAP_TYPES[tipo].lyrs + '&x={x}&y={y}&z={z}',
      opts
    );
    return acc;
  }, {});
}

function _camadaGoogleAtiva() {
  return Object.keys(_googleMapLayers).some(function (tipo) {
    return map && map.hasLayer(_googleMapLayers[tipo]);
  });
}

function _trocarTipoGoogle(tipo) {
  if (!_googleMapLayers[tipo] || tipo === _googleMapType) return;
  const anterior = _googleMapLayers[_googleMapType];
  if (anterior && map.hasLayer(anterior)) map.removeLayer(anterior);
  _googleMapType = tipo;
  _googleMapLayers[tipo].addTo(map);
  _atualizarControleTipoGoogle();
}

function _ativarMapaGoogle() {
  if (!map) return;
  Object.keys(_baseMapControlLayers).forEach(function (key) {
    const layer = _baseMapControlLayers[key];
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
  });
  _googleMapLayers[_googleMapType].addTo(map);
  _atualizarControleTipoGoogle();
}

function _adicionarControleTipoGoogle() {
  const GoogleTypeControl = L.Control.extend({
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-control google-map-type-control');
      wrap.style.cssText = 'position:relative;';
      wrap.innerHTML = `
        <button type="button" class="map-control-btn map-control-btn--google" title="Tipos de mapa">
          <i class="fa fa-map" style="font-size:13px;"></i>
        </button>
        <div class="map-control-drawer google-map-type-menu" style="display:none">
          ${Object.keys(GOOGLE_MAP_TYPES).map(function (tipo) {
            return `<button type="button" class="map-control-option" data-google-map-type="${tipo}" title="${GOOGLE_MAP_TYPES[tipo].label}">
              <i class="fa ${GOOGLE_MAP_TYPES[tipo].icon}"></i>
              <span>${GOOGLE_MAP_TYPES[tipo].label}</span>
            </button>`;
          }).join('')}
        </div>`;
      const btn = wrap.querySelector('button');
      const menu = wrap.querySelector('.google-map-type-menu');
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      L.DomEvent.on(btn, 'click', function (e) {
        L.DomEvent.stop(e);
        const abrindo = menu.style.display === 'none';
        menu.style.display = abrindo ? 'flex' : 'none';
        btn.classList.toggle('ativo', abrindo);
      });
      wrap.querySelectorAll('[data-google-map-type]').forEach(function (item) {
        L.DomEvent.on(item, 'click', function (e) {
          L.DomEvent.stop(e);
          _trocarTipoGoogle(item.getAttribute('data-google-map-type'));
          menu.style.display = 'none';
          btn.classList.remove('ativo');
        });
      });
      document.addEventListener('click', function () { menu.style.display = 'none'; btn.classList.remove('ativo'); });
      _googleMapTypeControl = wrap;
      setTimeout(_atualizarControleTipoGoogle, 0);
      return wrap;
    },
    onRemove() {},
  });
  new GoogleTypeControl({ position: 'topright' }).addTo(map);
}

function _atualizarControleTipoGoogle() {
  if (!_googleMapTypeControl) return;
  const ativo = _camadaGoogleAtiva();
  _googleMapTypeControl.style.display = ativo ? 'flex' : 'none';
  _googleMapTypeControl.querySelectorAll('[data-google-map-type]').forEach(function (item) {
    const selecionado = item.getAttribute('data-google-map-type') === _googleMapType;
    item.classList.toggle('ativo', selecionado);
  });
}

// ── Botões de camadas ─────────────────────────────────────────────────────────

function _adicionarBotoesCamadas() {
  const tray = document.getElementById('mapa-tray');
  if (!tray) return;

  let _toggleBtn = null;
  const BtnTray = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-control map-control-btn map-control-btn--tray');
      btn.id = 'mapa-tray-toggle';
      btn.title = 'Camadas do mapa';
      btn.innerHTML = '<i class="fa fa-database"></i>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.disableScrollPropagation(btn);
      L.DomEvent.on(btn, 'click', function (e) {
        L.DomEvent.stop(e);
        const aberta = tray.classList.toggle('aberta');
        btn.classList.toggle('ativo', aberta);
      });
      _toggleBtn = btn;
      return btn;
    },
    onRemove() {},
  });
  new BtnTray({ position: 'topright' }).addTo(map);

  L.DomEvent.disableClickPropagation(tray);

  document.addEventListener('click', function (e) {
    if (!tray.contains(e.target) && (!_toggleBtn || !_toggleBtn.contains(e.target))) {
      tray.classList.remove('aberta');
      if (_toggleBtn) _toggleBtn.classList.remove('ativo');
    }
  });

  document.getElementById('ml-alarmes').addEventListener('click', function () {
    _overlay.alarmes = !_overlay.alarmes;
    this.classList.toggle('ativo', _overlay.alarmes);
    _atualizarAlarmeBadges();
  });

  document.getElementById('ml-dispositivos').addEventListener('click', function () {
    this.classList.toggle('ativo');
  });

  document.getElementById('ml-labels').addEventListener('click', function () {
    _overlay.labels = !_overlay.labels;
    this.classList.toggle('ativo', _overlay.labels);
    _mostrarPopup = _overlay.labels;
    _atualizarBindingsPopup();
  });

  document.getElementById('ml-cercas').addEventListener('click', function () {
    _overlay.cercas = !_overlay.cercas;
    this.classList.toggle('ativo', _overlay.cercas);
    if (_overlay.cercas) carregarCercas().then(mostrarCercas); else ocultarCercas();
  });

  document.getElementById('ml-rastro').addEventListener('click', function () {
    _overlay.rastro = !_overlay.rastro;
    this.classList.toggle('ativo', _overlay.rastro);
    if (_overlay.rastro) _carregarRastros(); else _limparRastros();
  });
}

// ── Rastros ───────────────────────────────────────────────────────────────────

function _limparRastros() {
  Object.values(_rastros).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  Object.keys(_rastros).forEach(k => delete _rastros[k]);
}

async function _carregarRastros() {
  const ids = Object.keys(veiculosMap).filter(id => veiculosMap[id]?.posicao);
  for (const id of ids) {
    if (!_overlay.rastro) break;
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const hist = await AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${id}/historico?from=${from}&to=${now.toISOString()}`);
      if (!_overlay.rastro) break;
      const pontos = (hist.posicoes || []).map(p => [p.latitude, p.longitude]);
      if (pontos.length >= 2) {
        const linha = L.polyline(pontos, {
          color: '#2980b9', weight: 3, opacity: 0.7, dashArray: '6,4',
        }).addTo(map);
        _rastros[id] = linha;
      }
    } catch {}
  }
}

// ── Badges de alarme ──────────────────────────────────────────────────────────

function _atualizarAlarmeBadges() {
  Object.keys(veiculosMap).forEach(id => {
    const v = veiculosMap[id];
    if (!v?.posicao) return;
    _renderAlarmeBadge(id, v);
  });
}

function _renderAlarmeBadge(id, v) {
  if (_alarmeBadges[id]) {
    if (map.hasLayer(_alarmeBadges[id])) map.removeLayer(_alarmeBadges[id]);
    delete _alarmeBadges[id];
  }
  if (!_overlay.alarmes || !v?.posicao?.alarme) return;
  const badge = L.marker([v.posicao.latitude, v.posicao.longitude], {
    icon: L.divIcon({
      html: `<div style="background:#e74c3c;color:#fff;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;gap:4px;"><i class="fa fa-bell" style="font-size:9px"></i> ${v.posicao.alarme}</div>`,
      className: '', iconAnchor: [0, 36], iconSize: null,
    }),
    zIndexOffset: 800, interactive: false,
  });
  badge.addTo(map);
  _alarmeBadges[id] = badge;
}

function _adicionarBotaoLocalizacao(mapInst) {
  let _marcadorUser = null;
  const BtnLoc = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-control leaflet-loc-btn map-control-btn map-control-btn--loc');
      btn.title = 'Minha localização';
      btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;"></i>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function () {
        if (!navigator.geolocation) return;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size:11px;color:#2980b9;"></i>';
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            if (_marcadorUser) mapInst.removeLayer(_marcadorUser);
            _marcadorUser = L.marker(latlng, { icon: L.divIcon({
              html: '<div style="width:14px;height:14px;background:#2980b9;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(41,128,185,0.25);"></div>',
              className: '', iconSize: [14,14], iconAnchor: [7,7],
            }) }).addTo(mapInst).bindTooltip('Sua localização');
            mapInst.setView(latlng, 16);
            btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>';
          },
          function () { btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>'; }
        );
      });
      return btn;
    },
    onRemove() {},
  });
  new BtnLoc({ position: 'topright' }).addTo(mapInst);
}

// ── Carga de posições ─────────────────────────────────────────────────────────

async function carregarPosicoes() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const lista = JSON.parse(raw);
      lista.forEach(v => {
        veiculosMap[v.dispositivoId] = v;
        if (v.traccarId) traccarIdParaDispositivoId[v.traccarId] = v.dispositivoId;
      });
      renderMarcadores(); renderSidebar(); renderBarraVeiculos(); 
      if (ajustarBounds()) boundsAjustados = true;
      _restaurarFocoCliente();
    }
  } catch {}

  conectarWebSocket();

  try {
    const lista = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/posicoes');

    Object.keys(marcadores).forEach(id => {
      if (!lista.find(v => v.dispositivoId === id)) {
        if (map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
        delete marcadores[id]; delete marcadoresIconeKey[id];
      }
    });
    Object.keys(_clusterBadges).forEach(k => { if (map.hasLayer(_clusterBadges[k])) map.removeLayer(_clusterBadges[k]); delete _clusterBadges[k]; });
    Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);

    veiculosMap = {}; traccarIdParaDispositivoId = {};
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
    renderMarcadores(); renderSidebar(); renderBarraVeiculos();
    if (!boundsAjustados) {
      if (ajustarBounds()) boundsAjustados = true;
    }
    _restaurarFocoCliente();
    if (_overlay.alarmes) _atualizarAlarmeBadges();
    if (_overlay.rastro) _carregarRastros();
  } catch (err) {
    if (err.message === 'acesso_bloqueado') { verificarAcesso(); return; }
    if (!Object.keys(veiculosMap).length) {
      const counters = document.getElementById('topbar-counters');
      if (counters) counters.innerHTML = '<span style="color:#e74c3c"><i class="fa fa-exclamation-triangle"></i> Erro ao carregar</span>';
    }
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function conectarWebSocket() {
  if (ws && ws.readyState < 2) return;
  const apiBase = window.API_URL || 'http://localhost:3000';
  const wsUrl = `${apiBase.replace(/^http/, 'ws')}/ws/rastreamento`;
  const token = AL_CLIENTE.getToken();
  ws = new WebSocket(token ? `${wsUrl}?token=${token}` : wsUrl);
  setWsStatus('reconectando', 'Conectando...');

  ws.onopen = () => { wsReconectando = false; setWsStatus('conectado', 'Tempo real ativo'); };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    processarMensagemWs(msg);
  };
  ws.onclose = () => {
    setWsStatus('desconectado', 'Reconectando...');
    if (!wsReconectando) { wsReconectando = true; wsReconectTimer = setTimeout(conectarWebSocket, 5000); }
  };
  ws.onerror = () => ws.close();
}

function processarMensagemWs(msg) {
  if (msg.positions?.length) {
    msg.positions.forEach(pos => {
      const did = traccarIdParaDispositivoId[pos.deviceId];
      if (!did || !veiculosMap[did]) return;
      const _emMov = pos.emMovimento ?? null;
      const _est = _estadoSince[did];
      if (!_est || _est.emMovimento !== _emMov) {
        _estadoSince[did] = { emMovimento: _emMov, desde: Date.now() };
      }
      veiculosMap[did].posicao = {
        latitude: pos.latitude, longitude: pos.longitude, velocidade: pos.velocidade,
        curso: pos.curso, altitude: pos.altitude, fixTime: pos.fixTime,
        deviceTime: pos.deviceTime, serverTime: pos.serverTime, valida: pos.valida,
        ignicao: pos.ignicao, emMovimento: pos.emMovimento, satelites: pos.satelites,
        bateria_nivel: pos.bateria_nivel, alarme: pos.alarme, alarme_codigo: pos.alarme_codigo,
        tensao: pos.tensao, sinal: pos.sinal, odometro: pos.odometro,
        horas_motor: pos.horas_motor, bloqueado: pos.bloqueado, endereco: pos.endereco,
      };
      atualizarMarcador(did); atualizarCardAtivo(did); atualizarCardBarra(did);
      if (_overlay.alarmes) _renderAlarmeBadge(did, veiculosMap[did]);
      if (_overlay.rastro && _rastros[did]) _rastros[did].addLatLng([pos.latitude, pos.longitude]);
      if (_rotasIndividuais[did]) _rotasIndividuais[did].polyline.addLatLng([pos.latitude, pos.longitude]);
    });
  }
  if (msg.devices?.length) {
    msg.devices.forEach(d => {
      const did = traccarIdParaDispositivoId[d.traccarId];
      if (!did || !veiculosMap[did]) return;
      veiculosMap[did].status = d.status; veiculosMap[did].lastUpdate = d.lastUpdate;
      atualizarMarcador(did); atualizarCardAtivo(did); atualizarCardBarra(did);
    });
  }
  if (msg.events?.length) {
    msg.events.forEach(function (e) {
      const did = traccarIdParaDispositivoId[e.deviceId];
      const pos = did ? veiculosMap[did]?.posicao : null;
      adicionarEvento({
        dispositivoId: did || null,
        tipo: e.type,
        tipoLabel: e.tipoLabel,
        serverTime: e.serverTime,
        lat: pos?.latitude ?? null,
        lng: pos?.longitude ?? null,
      });
    });
  }
  renderSidebar();
}

function setWsStatus(estado, texto) {
  const el = document.getElementById('ws-status');
  if (el) {
    el.className = estado;
    el.innerHTML = `<i class="fa fa-circle"></i> ${texto}`;
  }
}

// ── Cluster / Spider ─────────────────────────────────────────────────────────

function _agruparPorPixel() {
  const ids = Object.keys(veiculosMap).filter(id => veiculosMap[id]?.posicao);
  const visitados = new Set(); const grupos = {};
  ids.forEach(id => {
    if (visitados.has(id)) return;
    const v = veiculosMap[id];
    const pt = map.latLngToContainerPoint([v.posicao.latitude, v.posicao.longitude]);
    const grupo = [id]; visitados.add(id);
    ids.forEach(id2 => {
      if (visitados.has(id2)) return;
      const v2 = veiculosMap[id2];
      const pt2 = map.latLngToContainerPoint([v2.posicao.latitude, v2.posicao.longitude]);
      if (Math.hypot(pt.x - pt2.x, pt.y - pt2.y) <= CLUSTER_PX) { grupo.push(id2); visitados.add(id2); }
    });
    const lat = grupo.reduce((s, i) => s + veiculosMap[i].posicao.latitude, 0) / grupo.length;
    const lng = grupo.reduce((s, i) => s + veiculosMap[i].posicao.longitude, 0) / grupo.length;
    const chave = [...grupo].sort().join('|');
    grupos[chave] = { ids: grupo, lat, lng };
  });
  return grupos;
}

function _criarIconeCluster(count) {
  return L.divIcon({ html: `<div style="width:42px;height:42px;background:#8e44ad;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;">${count}</div>`, className: '', iconSize: [42, 42], iconAnchor: [21, 21] });
}

function _fecharSpider() {
  _spider.markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
  _spider.linhas.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  _spider.markers.length = 0; _spider.linhas.length = 0; _spider.chave = null;
}

function _abrirSpider(chave, centroLatLng) {
  if (_spider.chave === chave) { _fecharSpider(); return; }
  _fecharSpider(); _spider.chave = chave;
  const ids = _clusterGrupos[chave]?.ids || [];
  ids.forEach((id, index) => {
    const v = veiculosMap[id]; if (!v?.posicao) return;
    const centro = map.latLngToContainerPoint(centroLatLng);
    const ang = (2 * Math.PI * index / ids.length) - Math.PI / 2;
    const sp = map.containerPointToLatLng([centro.x + 55 * Math.cos(ang), centro.y + 55 * Math.sin(ang)]);
    const linha = L.polyline([centroLatLng, sp], { color: '#666', weight: 1.5, opacity: 0.6, dashArray: '4,4' }).addTo(map);
    _spider.linhas.push(linha);
    const sm = L.marker(sp, { icon: criarIcone(v), zIndexOffset: 1000 });
    if (_mostrarPopup) sm.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
    sm.on('click', function (e) { L.DomEvent.stopPropagation(e); _fecharSpider(); focar(id); });
    sm.addTo(map); _spider.markers.push(sm);
  });
}

// ── Marcadores ────────────────────────────────────────────────────────────────

function renderMarcadores() {
  const grupos = _agruparPorPixel();
  Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);
  Object.assign(_clusterGrupos, grupos);

  Object.keys(_clusterBadges).forEach(chave => {
    if (!grupos[chave] || grupos[chave].ids.length < 2) { if (map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]); delete _clusterBadges[chave]; }
  });

  Object.entries(grupos).forEach(([chave, { ids, lat, lng }]) => {
    const isCluster = ids.length > 1;
    ids.forEach(id => {
      const v = veiculosMap[id]; const { latitude, longitude } = v.posicao;
      const visivel = modoFoco ? id === ativoId : !isCluster;
      if (!marcadores[id]) {
        const m = L.marker([latitude, longitude], { icon: criarIcone(v) });
        if (_mostrarPopup) m.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
        m.on('click', function (e) { L.DomEvent.stopPropagation(e); focar(id); });
        marcadores[id] = m; marcadoresIconeKey[id] = _iconeKey(id);
        if (visivel) m.addTo(map);
      } else {
        marcadores[id].setLatLng([latitude, longitude]);
        const ik = _iconeKey(id);
        if (marcadoresIconeKey[id] !== ik) { marcadores[id].setIcon(criarIcone(v)); marcadoresIconeKey[id] = ik; }
        if (visivel && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
        else if (!visivel && map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
      }
    });
    if (isCluster) {
      if (modoFoco) { if (_clusterBadges[chave] && map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]); return; }
      if (_clusterBadges[chave]) { _clusterBadges[chave].setLatLng([lat, lng]); _clusterBadges[chave].setIcon(_criarIconeCluster(ids.length)); if (!map.hasLayer(_clusterBadges[chave])) _clusterBadges[chave].addTo(map); }
      else {
        const badge = L.marker([lat, lng], { icon: _criarIconeCluster(ids.length), zIndexOffset: 500 });
        badge.on('click', function (e) { L.DomEvent.stopPropagation(e); _abrirSpider(chave, badge.getLatLng()); });
        _clusterBadges[chave] = badge; badge.addTo(map);
      }
    }
  });
}

function atualizarMarcador(did) {
  const v = veiculosMap[did]; if (!v?.posicao) return;
  if (!marcadores[did]) { renderMarcadores(); return; }
  const { latitude, longitude } = v.posicao;
  marcadores[did].setLatLng([latitude, longitude]);
  const ik = _iconeKey(did);
  if (marcadoresIconeKey[did] !== ik) { marcadores[did].setIcon(criarIcone(v)); marcadoresIconeKey[did] = ik; }
  if (_mostrarPopup && marcadores[did].getPopup()?.isOpen()) marcadores[did].getPopup().setContent(criarPopupSimples(v));
}

function _corMarcador(v) {
  if (!v.posicao || v.status !== 'online') return '#95a5a6'; // cinza: offline ou sem dados
  if (v.limiteVelocidade && v.posicao.velocidade > v.limiteVelocidade) return '#e74c3c'; // vermelho: excesso
  if (v.posicao.emMovimento || v.posicao.ignicao === true) return '#2980b9'; // azul: em movimento ou ignição ligada
  return '#27ae60'; // verde: parado / ignição desligada
}

function _iconeKey(did) {
  const v = veiculosMap[did]; if (!v) return '';
  const course = v.posicao ? Math.round(v.posicao.curso / 5) * 5 : 0;
  return `${_corMarcador(v)}|${v.categoria}|${course}`; 
}

function criarIcone(v) {
  const cor = _corMarcador(v);
  const course = v.posicao ? v.posicao.curso : 0;
  const html = AL_ICONS_3D.getSvgHtml(v.categoria, cor, course);
  return L.divIcon({ html, className: '', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -14] });
}

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

// ── Contadores ────────────────────────────────────────────────────────────────

function renderSidebar() {
  const todos = Object.values(veiculosMap);
  const online = todos.filter(v => v.status === 'online').length;
  const offline = todos.length - online;
  const semPos = todos.filter(v => !v.posicao).length;
  const el = document.getElementById('topbar-counters');
  if (el) el.innerHTML = `<span class="dot-moving">●</span> ${online} online &nbsp;·&nbsp; <span class="dot-offline">●</span> ${offline} offline${semPos ? `&nbsp;·&nbsp;<span style="color:#e67e22">${semPos} sem pos.</span>` : ''}`;
}

function renderBuscaResultados() {
  const filtro = (document.getElementById('filtro').value || '').toLowerCase().trim();
  const el = document.getElementById('lista-resultados-busca');
  if (!el) return;
  if (!filtro) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const filtrados = Object.values(veiculosMap).filter(v =>
    v.nome.toLowerCase().includes(filtro) ||
    (v.placa && v.placa.toLowerCase().includes(filtro)) ||
    (v.cliente?.nome?.toLowerCase().includes(filtro))
  ).slice(0, 8);

  if (!filtrados.length) { el.innerHTML = '<div style="padding:12px;text-align:center;color:#aaa;font-size:12px">Nenhum resultado.</div>'; el.style.display = 'block'; return; }

  filtrados.sort((a, b) => pesoStatus(a) - pesoStatus(b));
  el.innerHTML = filtrados.map(v => {
    const p = v.posicao;
    let dot = 'dot-offline', txt = 'Offline';
    if (v.status === 'online' && p?.emMovimento) { dot = 'dot-moving'; txt = `Em movimento · ${p.velocidade} km/h`; }
    else if (v.status === 'online') { dot = 'dot-online'; txt = 'Parado'; }
    return `<div class="veiculo-item${v.dispositivoId === ativoId ? ' ativo' : ''}" onclick="selecionarDaBusca('${v.dispositivoId}')">
      <div class="v-nome">${v.nome}${v.placa ? `&nbsp;<span class="v-placa">${v.placa}</span>` : ''}</div>
      <div class="v-status"><i class="fa fa-circle ${dot}"></i> ${txt}</div>
    </div>`;
  }).join('');
  el.style.display = 'block';
}

window.selecionarDaBusca = function (id) {
  document.getElementById('filtro').value = '';
  document.getElementById('lista-resultados-busca').style.display = 'none';
  focar(id);
};

function pesoStatus(v) { if (v.status !== 'online') return 2; if (v.posicao?.emMovimento) return 0; return 1; }

// ── Barra de veículos ─────────────────────────────────────────────────────────

const API_BASE = window.API_URL || 'http://localhost:3000';

function renderBarraVeiculos() {
  const barra = document.getElementById('barra-veiculos');
  if (!barra) return;
  const veiculos = Object.values(veiculosMap);

  if (!veiculos.length) { barra.innerHTML = ''; return; }

  barra.classList.remove('expandida');
  barra.innerHTML = veiculos.map(v => cardVeiculoHtml(v)).join('');
  barra.style.justifyContent = veiculos.length <= 5 ? 'center' : 'flex-start';

  _bindBarraScroll(barra);
  bindCardsBarra();

  requestAnimationFrame(function () {
    if (barra.scrollHeight > barra.clientHeight) {
      barra.classList.add('expandida');
    }
  });
}

function _bindBarraScroll(barra) {
  if (barra._onWheel) barra.removeEventListener('wheel', barra._onWheel);
  if (barra._onScroll) barra.removeEventListener('scroll', barra._onScroll);

  barra._onWheel = function (e) {
    if (e.deltaY > 0 && !barra.classList.contains('expandida') && barra.scrollHeight > barra.clientHeight) {
      barra.classList.add('expandida');
    } else if (e.deltaY < 0 && barra.classList.contains('expandida') && barra.scrollTop === 0) {
      barra.classList.remove('expandida');
    }
  };

  barra._onScroll = function () {
    if (barra.classList.contains('expandida') && barra.scrollTop === 0) {
      barra.classList.remove('expandida');
    }
  };

  barra.addEventListener('wheel', barra._onWheel, { passive: true });
  barra.addEventListener('scroll', barra._onScroll, { passive: true });
}

function bindCardsBarra() {
  const barra = document.getElementById('barra-veiculos');
  if (!barra) return;
  barra.querySelectorAll('.card-veiculo').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('.btn-upload-foto')) return;
      focarCliente(this.dataset.did);
    });
  });
  barra.querySelectorAll('.btn-upload-foto').forEach(function (btn) {
    bindUploadFoto(btn.closest('.card-veiculo'));
  });
}

function bindUploadFoto(card) {
  if (!card) return;
  const did = card.dataset.did;
  const btn = card.querySelector('.btn-upload-foto');
  if (!btn || btn._uploadBound) return;
  btn._uploadBound = true;

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = function () {
      if (!this.files[0]) return;
      const file = this.files[0];
      const cardAtual = document.querySelector(`.card-veiculo[data-did="${did}"]`);
      if (!cardAtual) return;
      const fotoWrap = cardAtual.querySelector('.btn-foto-wrap');
      if (fotoWrap) {
        let spinner = document.createElement('div');
        spinner.className = 'cv-spinner';
        spinner.style.cssText = 'position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;pointer-events:none;z-index:5;';
        spinner.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
        fotoWrap.style.position = 'relative';
        fotoWrap.appendChild(spinner);
      }
      AL_CLIENTE.uploadFoto(`/api/cliente/dispositivos/${did}/foto`, file)
        .then(function (data) {
          veiculosMap[did].imagemUrlCliente = data.imagemUrlCliente;
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.values(veiculosMap))); } catch (e) {}
          const newSrc = `${API_BASE}${data.imagemUrlCliente}`;
          const preload = new Image();
            preload.onload = preload.onerror = function () {
            const cc = document.querySelector(`.card-veiculo[data-did="${did}"]`);
            if (cc) {
              const fw = cc.querySelector('.btn-foto-wrap');
              if (fw) {
                const sp = fw.querySelector('.cv-spinner'); if (sp) sp.remove();
                let img = fw.querySelector('img.cv-foto');
                if (img) {
                  img.src = newSrc;
                  img.style.display = 'block';
                  const ico = fw.querySelector('.cv-icone');
                  if (ico) ico.style.display = 'none';
                } else {
                  const icone = fw.querySelector('.cv-icone');
                  img = document.createElement('img');
                  img.className = 'cv-foto';
                  img.src = newSrc;
                  if (icone) {
                    icone.style.display = 'none';
                    fw.insertBefore(img, icone);
                  } else fw.prepend(img);
                }
              }
            }
            
            // ATUALIZAÇÃO CRUCIAL:
            if (veiculosMap[did]) {
              veiculosMap[did].imagemUrlCliente = data.imagemUrlCliente;
            }
            if (ativoId === did) {
              mostrarCardDispositivo(did); // Redesenha o card flutuante com a nova foto
            }
            
            AL_CLIENTE.showAlert('Foto atualizada!', 'success');
          };
          preload.src = newSrc;
        })
        .catch(function (err) {
          const cc = document.querySelector(`.card-veiculo[data-did="${did}"]`);
          if (cc) { const sp = cc.querySelector('.cv-spinner'); if (sp) sp.remove(); }
          AL_CLIENTE.showAlert(err.message);
        });
    };
    inp.click();
  });
}

function cardVeiculoHtml(v) {
  const cor = _corMarcador(v);
  const fotoSrc = v.imagemUrlCliente ? `${API_BASE}${v.imagemUrlCliente}` : null;
  
  let mediaHtml;
  if (fotoSrc) {
    mediaHtml = `<img src="${fotoSrc}" class="cv-foto" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                 <div class="cv-icone" style="display:none;background:#f0f2f5;align-items:center;justify-content:center;">${_getSvgPlaceholder(v.categoria, cor)}</div>`;
  } else {
    mediaHtml = `<div class="cv-icone" style="display:flex;background:#f0f2f5;align-items:center;justify-content:center;">${_getSvgPlaceholder(v.categoria, cor)}</div>`;
  }

  const isOnline = v.status === 'online';
  const isMoving = isOnline && v.posicao?.emMovimento;
  const statusTxt = isMoving ? `${v.posicao?.velocidade ?? 0} km/h` : isOnline ? 'Parado' : 'Offline';
  const dotCls = isMoving ? 'dot-moving' : isOnline ? 'dot-online' : 'dot-offline';
  const marcaModelo = [v.marca, v.modeloVeiculo].filter(Boolean).join(' ');

  return `<div class="card-veiculo${v.dispositivoId === ativoId ? ' ativo' : ''}" data-did="${v.dispositivoId}" onclick="focarCliente('${v.dispositivoId}')">
    <div class="btn-foto-wrap" onclick="event.stopPropagation()">
      ${mediaHtml}
      <button class="btn-upload-foto" onclick="handleUploadFoto('${v.dispositivoId}')" title="Alterar foto"><i class="fa fa-camera"></i></button>
    </div>
    ${v.placa ? `<span class="cv-placa">${v.placa}</span>` : ''}
    <span class="cv-modelo" title="${marcaModelo || v.nome}">${marcaModelo || v.nome}</span>
    <span class="cv-status ${dotCls}">● ${statusTxt}</span>
  </div>`;
}

function _getSvgPlaceholder(cat, cor) {
  let svg = AL_ICONS_3D.getSvgHtml(cat, cor, 0);
  return svg.replace('width="42"', 'width="28"').replace('height="42"', 'height="28"');
}

function atualizarCardBarra(did) {
  const card = document.querySelector(`.card-veiculo[data-did="${did}"]`);
  if (!card) return;
  const v = veiculosMap[did];
  const statusEl = card.querySelector('.cv-status');
  if (statusEl) {
    const isOnline = v.status === 'online', isMoving = isOnline && v.posicao?.emMovimento;
    const txt = isMoving ? `${v.posicao?.velocidade ?? 0} km/h` : isOnline ? 'Parado' : 'Offline';
    statusEl.className = `cv-status ${isMoving ? 'dot-moving' : isOnline ? 'dot-online' : 'dot-offline'}`;
    statusEl.textContent = `● ${txt}`;
  }
  if (!v.imagemUrlCliente) {
    const icone = card.querySelector('.cv-icone');
    if (icone) {
      let svg = AL_ICONS_3D.getSvgHtml(v.categoria, _corMarcador(v), 0);
      svg = svg.replace('width="42"', 'width="28"').replace('height="42"', 'height="28"');
      icone.innerHTML = svg;
    }
  }
  card.classList.toggle('ativo', did === ativoId);
}

// ── Card do dispositivo (sidebar) ─────────────────────────────────────────────

const _CMD_CONFIG = {
  engineStop:         { label: 'Bloquear',           icon: 'fa-lock',                style: 'danger',  confirm: 'Bloquear o motor do veículo?' },
  engineResume:       { label: 'Desbloquear',        icon: 'fa-unlock',              style: 'success' },
  positionSingle:     { label: 'Solicitar posição',        icon: 'fa-map-marker',          style: 'info' },
  positionPeriodic:   { label: 'Rastreamento periódico',   icon: 'fa-refresh',             style: 'info',    atributos: { frequency: 60 } },
  positionStop:       { label: 'Parar rastreamento',       icon: 'fa-stop-circle',         style: 'neutral' },
  alarmSos:           { label: 'Alarme SOS',               icon: 'fa-exclamation-triangle', style: 'warn' },
  silenceAlarm:       { label: 'Silenciar alarme',         icon: 'fa-bell-slash',          style: 'neutral' },
  rebootDevice:       { label: 'Reiniciar dispositivo',    icon: 'fa-power-off',           style: 'neutral', confirm: 'Reiniciar o dispositivo?' },
  factoryReset:       { label: 'Reset de fábrica',         icon: 'fa-warning',             style: 'block',   confirm: 'ATENÇÃO: apagará todas as configurações do dispositivo. Continuar?' },
  outputControl:      { label: 'Controle de saída',        icon: 'fa-toggle-on',           style: 'warn' },
  setTimezone:        { label: 'Definir fuso horário',     icon: 'fa-clock-o',             style: 'info',    atributos: { timezone: 'America/Sao_Paulo' } },
  setSpeed:           { label: 'Definir velocidade limite', icon: 'fa-tachometer',         style: 'warn',    atributos: { speed: 100 } },
  sendSms:            { label: 'Enviar SMS',               icon: 'fa-comment',             style: 'info' },
  voiceMonitoring:    { label: 'Monitoramento de voz',     icon: 'fa-microphone',          style: 'info' },
  requestPhoto:       { label: 'Solicitar foto',           icon: 'fa-camera',              style: 'info' },
  alarmArm:           { label: 'Armar alarme',             icon: 'fa-shield',              style: 'warn' },
  alarmDisarm:        { label: 'Desarmar alarme',          icon: 'fa-shield',              style: 'neutral' },
  alarmRemove:        { label: 'Remover alarme',           icon: 'fa-times-circle',        style: 'neutral' },
  immobilize:         { label: 'Imobilizar veículo',       icon: 'fa-ban',                 style: 'block',   confirm: 'Imobilizar o veículo?' },
  driverUnique:       { label: 'Identificação de motorista', icon: 'fa-id-card',           style: 'info' },
  message:            { label: 'Enviar mensagem',          icon: 'fa-envelope',            style: 'info' },
  configuration:      { label: 'Configurar dispositivo',   icon: 'fa-wrench',              style: 'neutral' },
  getVersion:         { label: 'Versão do firmware',       icon: 'fa-code',                style: 'neutral' },
  custom:             { label: 'Personalizado',            icon: 'fa-terminal',            style: 'neutral' },
};

function buildStatusHtmlCliente(p, bat, batFa, batCor) {
  if (!p) return '';
  const si = [];
  if (p.ignicao === true)  si.push(`<span style="color:#27ae60"><i class="fa fa-key"></i> Ignição: Ligado</span>`);
  if (p.ignicao === false) si.push(`<span style="color:#bdc3c7"><i class="fa fa-key"></i> Ignição: Desligado</span>`);
  if (bat != null)         si.push(`<span style="color:${batCor}"><i class="fa ${batFa}"></i> Bateria: ${bat}%</span>`);
  if (p.tensao != null)    si.push(`<span style="color:#8e44ad"><i class="fa fa-bolt"></i> Tensão: ${p.tensao.toFixed(1)} V</span>`);
  
  if (p.odometro != null) {
    const km = Math.round(p.odometro / 1000).toLocaleString('pt-BR');
    si.push(`<span><i class="fa fa-dashboard" style="color:#7f8c8d"></i> Odômetro: ${km} km</span>`);
  }
  if (p.horas_motor != null) {
    si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h</span>`);
  }
  
  if (p.bloqueado != null) si.push(`<span style="color:${p.bloqueado ? '#e74c3c' : '#27ae60'}"><i class="fa fa-${p.bloqueado ? 'lock' : 'unlock'}"></i> ${p.bloqueado ? 'Bloqueado' : 'Desbloqueado'}</span>`);
  return si.join('');
}

function _fmtResumoDurCliente(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m}min` : `${m}min`;
}

function _renderResumoHojeCliente(id) {
  const el = document.getElementById(`dcard-resumo-hoje-${id}`);
  if (!el) return;
  const resumo = _resumoHojeClienteCache[id];
  if (!resumo) {
    el.innerHTML = '<div style="font-size:11px;color:#999;text-align:center;padding:6px 0">Carregando...</div>';
    return;
  }
  el.innerHTML = `
    <div class="dcard-summary-grid">
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.km}</div><div class="dcard-summary-lbl">Distância</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.velMax}</div><div class="dcard-summary-lbl">Vel. Máxima</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.tempo}</div><div class="dcard-summary-lbl">Em Movimento</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.viagens}</div><div class="dcard-summary-lbl">Viagens</div></div>
    </div>
  `;
}

function _carregarResumoHojeCliente(id) {
  if (_resumoHojeClienteCache[id]) {
    _renderResumoHojeCliente(id);
    return;
  }
  if (_resumoHojeClientePendentes[id]) return;
  _resumoHojeClientePendentes[id] = true;
  const { inicio, fim } = _intervaloHojeCliente();
  AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${id}/viagens?from=${encodeURIComponent(inicio)}&to=${encodeURIComponent(fim)}`)
    .then(viagens => {
      const lista = Array.isArray(viagens) ? viagens : [];
      const km = lista.reduce((s, v) => s + (v.distancia || 0), 0);
      const velMax = lista.reduce((m, v) => Math.max(m, v.velocidadeMaxima || 0), 0);
      const min = lista.reduce((s, v) => s + (v.duracao || 0), 0);
      _resumoHojeClienteCache[id] = {
        km: km ? `${km.toFixed(1)} km` : '—',
        velMax: velMax ? `${velMax} km/h` : '—',
        tempo: min ? _fmtResumoDurCliente(min) : '—',
        viagens: String(lista.length || 0),
      };
      _renderResumoHojeCliente(id);
    })
    .catch(() => {
      _resumoHojeClienteCache[id] = { km: '—', velMax: '—', tempo: '—', viagens: '0' };
      _renderResumoHojeCliente(id);
    })
    .finally(() => {
      delete _resumoHojeClientePendentes[id];
    });
}

function mostrarCardDispositivo(id) {
  const v = veiculosMap[id]; if (!v) return;
  ativoId = id;
  _salvarFocoCliente(id);
  const p = v.posicao;
  const isOnline = v.status === 'online', isMoving = isOnline && p?.emMovimento;
  const corStatus = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
  const txtStatus = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');
  const estadoDesde = _estadoSince[id]?.desde
    || (p?.fixTime ? new Date(p.fixTime).getTime() : null)
    || (v.lastUpdate ? new Date(v.lastUpdate).getTime() : null);
  const tempoSufixo = estadoDesde ? ` — há ${fmtTempoDecorridoMs(estadoDesde)}` : '';
  const bat = p?.bateria_nivel != null ? p.bateria_nivel : null;
  const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
  const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';
  const addrId = `dcard-addr-${id}`;
  const cacheKey = p ? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}` : null;
  const hasCached = cacheKey != null && cacheKey in _geocodeCache;
  const addrTxt = hasCached ? (_geocodeCache[cacheKey] || `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`) : (p ? 'Buscando...' : '—');

  const imgHtml = v.imagemUrlCliente
    ? `<img src="${API_BASE}${v.imagemUrlCliente}" style="width:100%;height:140px;object-fit:cover;display:block;border-radius:12px 12px 0 0" onerror="this.style.display='none'" />`
    : '';

  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';
  const horasHtml = p ? `
    <div class="dcard-section dcard-val" style="font-size:10px">
      <div class="dcard-section-title">Última Atualização</div>
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
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          ${v.placa ? `<span class="v-placa">${v.placa}</span>` : ''}
        </div>
      </div>
      <button class="dcard-fechar" onclick="fecharCardDispositivo()" title="Fechar">×</button>
    </div>
    <div class="dcard-body">
      <div style="margin-bottom:6px">
        <span id="dcard-status-text" style="color:${corStatus}"><i class="fa fa-circle" style="font-size:9px;vertical-align:middle"></i> ${txtStatus}${tempoSufixo}</span>
        <span id="dcard-status-warning">${!p ? '&nbsp;<span style="color:#e67e22;font-size:11px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : ''}</span>
      </div>
      <div id="dcard-velocimetro">${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}</div>
      ${p?.velocidade != null ? `<hr style="margin:2px 0 6px;border:none;border-top:1px solid rgba(128,128,128,0.15)">` : ''}
      <div class="dcard-section-title">Informações do Dispositivo</div>
      <div id="dcard-status" style="font-size:12px;display:flex;flex-direction:column;gap:3px;margin-bottom:4px">${buildStatusHtmlCliente(p, bat, batFa, batCor)}</div>
      <div id="dcard-horas">${horasHtml}</div>
      ${p ? `<div class="dcard-section dcard-val" style="line-height:1.4">
        <div class="dcard-section-title">Endereço</div>
        <div style="display:flex;align-items:flex-start;gap:6px">
          <i class="fa fa-map-pin" style="color:#e74c3c;width:13px;flex:0 0 auto;margin-top:2px"></i>
          <span id="${addrId}" style="flex:1 1 auto">${addrTxt}</span>
          ${_htmlBotaoStreetView(p.latitude, p.longitude)}
        </div>
      </div>` : ''}
      <div id="dcard-comandos-${id}" class="dcard-section" style="display:none;padding-top:12px;border-top:1px solid rgba(128,128,128,0.1)">
        <div id="dcard-comandos-grid-${id}" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:6px">
        <button onclick="abrirOverlay('${id}', 'relatorio')" class="btn btn-xs btn-primary" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;flex:1"><i class="fa fa-bar-chart"></i> Relatório</button>
        <button onclick="abrirOverlay('${id}', 'historico')" class="btn btn-xs btn-warning" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;flex:1"><i class="fa fa-history"></i> Histórico</button>
      </div>
      ${_htmlAcoesCard(id)}
      <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
        <div style="font-size:11px;font-weight:700;color:#888;margin-bottom:8px;text-align:center;letter-spacing:.5px">RESUMO DE HOJE</div>
        <div id="dcard-resumo-hoje-${id}"><div style="font-size:11px;color:#999;text-align:center;padding:6px 0">Carregando...</div></div>
      </div>
    </div>
  `;
  
  card.style.display = 'flex';
  if (p && !hasCached) geocodificarCoordenadas(p.latitude, p.longitude, addrId);
  _carregarResumoHojeCliente(id);

  // Verifica cercas para ativar o botão visualmente
  AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${id}/cercas`).then(cercas => {
    const btnCerca = card.querySelector('.dcard-acao[data-acao="cerca"]');
    if (btnCerca) btnCerca.classList.toggle('ativo', !!(cercas && cercas.length > 0));
    if (cercas && cercas.length > 0 && !_overlay.cercas) {
      _overlay.cercas = true;
      const btnCercas = document.getElementById('ml-cercas');
      if (btnCercas) btnCercas.classList.add('ativo');
      mostrarCercas();
    }
  }).catch(() => {});

  // Carrega tipos de comandos (Bloqueio/Desbloqueio)
  AL_CLIENTE.apiGet(`/api/cliente/dispositivos/${id}/tipos-comandos`).then(tipos => {
    const permitidos = ['engineStop', 'engineResume'];
    const suportados = Array.isArray(tipos) ? tipos.map(t => (typeof t === 'string' ? t : t.type)).filter(t => permitidos.includes(t)) : [];
    if (suportados.length > 0) {
      const grid = document.getElementById(`dcard-comandos-grid-${id}`);
      if (grid) {
        document.getElementById(`dcard-comandos-${id}`).style.display = 'block';
        grid.innerHTML = suportados.map(t => {
          const cfg = _CMD_CONFIG[t];
          const btnClass = t === 'engineStop' ? 'btn-danger' : 'btn-success';
          return `<button class="btn btn-xs ${btnClass} cmd-btn" data-tipo="${t}" onclick="enviarComandoDaSidebar('${id}', '${t}')" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;"><i class="fa ${cfg.icon}"></i> ${cfg.label}</button>`;
        }).join('');
      }
    }
  }).catch(() => {});
}

window.enviarComandoDaSidebar = async function(did, tipo) {
  const cfg = _CMD_CONFIG[tipo] || { label: tipo, icon: 'fa-terminal', style: 'neutral' };
  if (cfg.confirm && !confirm(cfg.confirm)) return;
  const btn = document.querySelector(`.cmd-btn[data-tipo="${tipo}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Aguarde...'; }
  try {
    await AL_CLIENTE.apiPost(`/api/cliente/dispositivos/${did}/comandos`, { tipo, atributos: cfg.atributos || {} });
    AL_CLIENTE.showAlert('Comando enviado!', 'success');
  } catch (err) { AL_CLIENTE.showAlert('Erro: ' + err.message, 'danger'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; } }
};

window.fecharCardDispositivo = function (skipClosePopup) {
  if (modoFoco) desativarFoco();
  _cancelarDesenhoCirculo();
  document.getElementById('device-detail-card').style.display = 'none';
  ativoId = null;
  _limparFocoCliente();
  document.querySelectorAll('.card-veiculo').forEach(el => el.classList.remove('ativo'));
  if (!skipClosePopup) map.closePopup();
};

function atualizarCardAtivo(did) {
  if (did !== ativoId) return;
  const card = document.getElementById('device-detail-card');
  if (card && card.style.display === 'none') return;
  const v = veiculosMap[did]; if (!v) return;
  _salvarFocoCliente(did);
  const p = v.posicao;

  const elStatus = document.getElementById('dcard-status-text');
  if (elStatus) {
    const isOnline = v.status === 'online', isMoving = isOnline && p?.emMovimento;
    const corStatus = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
    const txtStatus = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');
    const desde = _estadoSince[did]?.desde || null;
    elStatus.style.color = corStatus;
    elStatus.innerHTML = `<i class="fa fa-circle" style="font-size:9px;vertical-align:middle"></i> ${txtStatus}${desde ? ` — há ${fmtTempoDecorridoMs(desde)}` : ''}`;
  }
  const elVel = document.getElementById('dcard-velocimetro');
  if (elVel) elVel.innerHTML = p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : '';
  const elStatusItems = document.getElementById('dcard-status');
  if (elStatusItems) {
    const bat2 = p?.bateria_nivel != null ? p.bateria_nivel : null;
    const batCor2 = bat2 >= 40 ? '#27ae60' : bat2 >= 20 ? '#f39c12' : '#e74c3c';
    const batFa2 = bat2 >= 80 ? 'fa-battery-full' : bat2 >= 60 ? 'fa-battery-3' : bat2 >= 40 ? 'fa-battery-2' : bat2 >= 20 ? 'fa-battery-1' : 'fa-battery-0';
    elStatusItems.innerHTML = buildStatusHtmlCliente(p, bat2, batFa2, batCor2);
  }
  const tsSrv = document.getElementById('dcard-ts-srv'), tsDev = document.getElementById('dcard-ts-dev'), tsGps = document.getElementById('dcard-ts-gps');
  if (tsSrv && p) tsSrv.textContent = fmtGPSTimeSec(p.serverTime);
  if (tsDev && p) tsDev.textContent = fmtGPSTimeSec(p.deviceTime);
  if (tsGps && p) tsGps.textContent = fmtGPSTimeSec(p.fixTime);

  if (modoFoco && v?.posicao) map.panTo([v.posicao.latitude, v.posicao.longitude], { animate: true, duration: 0.5 });
}

function svgVelocimetro(vel, limite) {
  if (vel == null) return '';
  const isDark = document.documentElement.classList.contains('dark-theme');
  const max = Math.max(limite || 120, 120);
  const f = Math.min(vel / max, 1);
  const ang = Math.PI * (1 - f);
  const ex = (40 + 30 * Math.cos(ang)).toFixed(1), ey = (45 - 30 * Math.sin(ang)).toFixed(1);
  const cor = limite && vel > limite ? '#e74c3c' : vel > 80 ? '#f39c12' : '#27ae60';
  const tr = isDark ? '#2d3748' : '#e9ecef', nc = isDark ? '#f0f2f5' : '#333', lc = isDark ? '#adb5bd' : '#555';
  const arc = f > 0.01 ? `<path d="M 10 45 A 30 30 0 ${f>0.5?1:0} 1 ${ex} ${ey}" fill="none" stroke="${cor}" stroke-width="7" stroke-linecap="round"/>` : '';
  return `<svg width="90" height="54" viewBox="0 0 90 54" style="display:block;margin:4px auto 8px"><path d="M 10 45 A 30 30 0 0 1 70 45" fill="none" stroke="${tr}" stroke-width="7" stroke-linecap="round"/>${arc}<text x="40" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="${nc}">${vel}</text><text x="40" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="${lc}">km/h</text></svg>`;
}

function fmtGPSTimeSec(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTempoDecorridoMs(ms) {
  if (!ms) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)} dia(s)`;
}

function fmtTempoDecorrido(iso) {
  if (!iso) return '';
  return fmtTempoDecorridoMs(new Date(iso).getTime());
}

window.geocodificarCoordenadas = async function (lat, lng, elementId) {
  const el = document.getElementById(elementId); if (!el) return;
  const coords = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  const ck = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (ck in _geocodeCache) { el.textContent = _geocodeCache[ck] ? `${_geocodeCache[ck]} ${coords}` : coords; return; }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR`);
    const data = await res.json();
    const a = data.address || {};
    const partes = [];
    if (a.road) partes.push(a.house_number ? `${a.road}, ${a.house_number}` : a.road);
    const bairro = a.suburb || a.neighbourhood;
    if (bairro) partes.push(bairro);
    const cidade = a.city || a.town || a.village;
    if (cidade) partes.push(cidade);
    const end = partes.join(', ');
    _geocodeCache[ck] = end;
    el.textContent = end ? `${end} ${coords}` : coords;
  } catch { el.textContent = coords; }
};

function ativarFoco(id) {
  modoFoco = true; _fecharSpider();
  Object.values(_clusterBadges).forEach(b => { if (map.hasLayer(b)) map.removeLayer(b); });
  Object.keys(marcadores).forEach(mid => { if (mid !== id && map.hasLayer(marcadores[mid])) map.removeLayer(marcadores[mid]); });
  if (marcadores[id] && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
}

function desativarFoco() { modoFoco = false; _fecharSpider(); renderMarcadores(); }

function moverCardParaInicio(did) {
  const barra = document.getElementById('barra-veiculos');
  if (!barra || !barra.classList.contains('expandida')) return;
  const card = barra.querySelector(`.card-veiculo[data-did="${did}"]`), primeiro = barra.firstElementChild;
  if (!card || !primeiro || card === primeiro) return;
  if (card.offsetTop <= primeiro.offsetTop) return;
  barra.insertBefore(card, primeiro);
  barra.scrollTop = 0;
}

window.focar = function (did) {
  _salvarFocoCliente(did);
  mostrarCardDispositivo(did); moverCardParaInicio(did);
  document.querySelectorAll('.card-veiculo').forEach(el => el.classList.toggle('ativo', el.dataset.did === did));
  const v = veiculosMap[did]; if (!v?.posicao) return;
  ativarFoco(did);
  map.flyTo([v.posicao.latitude, v.posicao.longitude], 16, { animate: true, duration: 0.8 });
  setTimeout(() => { if (_mostrarPopup && marcadores[did] && map.hasLayer(marcadores[did])) marcadores[did].openPopup(); }, 900);
};

window.focarCliente = function (did) {
  const barra = document.getElementById('barra-veiculos');
  moverCardParaInicio(did);
  if (barra) { barra.classList.remove('expandida'); barra.scrollTop = 0; }
  focar(did);
};

function ajustarBounds() {
  if (map) map.invalidateSize();
  const comPos = Object.values(veiculosMap).filter(v => v.posicao);
  if (!comPos.length) return false;
  if (comPos.length === 1) { 
    map.setView([comPos[0].posicao.latitude, comPos[0].posicao.longitude], 13); 
    return true; 
  }
  const group = new L.FeatureGroup(comPos.map(v => L.marker([v.posicao.latitude, v.posicao.longitude])));
  map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 14 });
  return true;
}

window.abrirOverlay = function (did, tipo) {
  const v = veiculosMap[did]; if (!v) return;
  document.getElementById('overlay-titulo').textContent = `${v.nome}${v.placa ? ` — ${v.placa}` : ''}`;
  const base = window.location.href.replace(/\/cliente\/rastreamento\.html.*/, '');
  const token = AL_CLIENTE.getToken();
  let iframeSrc = tipo === 'relatorio' ? `${base}/cliente/relatorio-iframe.html?id=${did}&token=${encodeURIComponent(token)}` : `${base}/cliente/detalhe-iframe.html?id=${did}&token=${token}&modo=historico`;
  document.getElementById('overlay-iframe').src = iframeSrc;
  document.getElementById('overlay-historico').classList.add('ativo');
  history.pushState({ overlay: true }, '');
};

// ── Rota individual do dispositivo ────────────────────────────────────────────

function _criarSetasNoRastro(pontos, cor) {
  const setas = [];
  const step = Math.max(1, Math.floor(pontos.length / 8));
  for (let i = step; i < pontos.length - 1; i += step) {
    const p1 = pontos[i - 1], p2 = pontos[i];
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI;
    const seta = L.marker([p2[0], p2[1]], {
      icon: L.divIcon({
        html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid ${cor};transform:rotate(${ang}deg);transform-origin:center"></div>`,
        className: '', iconSize: [10, 10], iconAnchor: [5, 5],
      }),
      interactive: false, zIndexOffset: 200,
    }).addTo(map);
    setas.push(seta);
  }
  return setas;
}

async function _carregarRastroDispositivo(id) {
  const btn = document.querySelector(`.dcard-acao[data-acao="rota"]`);
  if (btn) { btn.classList.add('carregando'); btn.querySelector('i').className = 'fa fa-spinner fa-spin'; }

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(); // 5 horas
    const hist = await AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${id}/historico?from=${from}&to=${now.toISOString()}`);
    const pontos = (hist.posicoes || []).map(p => [p.latitude, p.longitude]);
    
    if (pontos.length >= 2) {
      const cor = '#e74c3c';
      const polyline = L.polyline(pontos, { color: cor, weight: 4, opacity: 0.85 }).addTo(map);
      const setas = _criarSetasNoRastro(pontos, cor);
      _rotasIndividuais[id] = { polyline, setas };
      
      const bounds = polyline.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
      if (btn) { btn.classList.remove('carregando'); btn.classList.add('ativo'); btn.querySelector('i').className = 'fa fa-road'; }
    } else {
      AL_CLIENTE.showAlert('Sem histórico de posição nas últimas 5h.', 'warning');
      if (btn) { btn.classList.remove('carregando'); btn.querySelector('i').className = 'fa fa-road'; }
    }
  } catch (err) {
    if (btn) { btn.classList.remove('carregando'); btn.querySelector('i').className = 'fa fa-road'; }
  }
}

window.ativarRota = function (dispositivoId) {
  const btn = document.querySelector(`.dcard-acao[data-acao="rota"]`);
  if (_rotasIndividuais[dispositivoId]) {
    const { polyline, setas } = _rotasIndividuais[dispositivoId];
    if (map.hasLayer(polyline)) map.removeLayer(polyline);
    setas.forEach(s => { if (map.hasLayer(s)) map.removeLayer(s); });
    delete _rotasIndividuais[dispositivoId];
    if (btn) {
      btn.classList.remove('ativo');
      btn.querySelector('i').className = 'fa fa-road';
    }
  } else {
    _carregarRastroDispositivo(dispositivoId);
  }
};

// ── Cercas (Geofences) ────────────────────────────────────────────────────────

function _parsearAreaTraccar(area) {
  if (!area) return null;
  const circleMatch = area.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (circleMatch) return { tipo: 'circle', lat: parseFloat(circleMatch[1]), lng: parseFloat(circleMatch[2]), raio: parseFloat(circleMatch[3]) };
  const polyMatch = area.match(/POLYGON\s*\(\((.*)\)\)/i);
  if (polyMatch) {
    const coords = polyMatch[1].trim().split(',').map(p => { const [lng, lat] = p.trim().split(/\s+/); return [parseFloat(lat), parseFloat(lng)]; });
    return { tipo: 'polygon', coords };
  }
  return null;
}

function _criarCamadaCerca(cerca) {
  const parsed = _parsearAreaTraccar(cerca.area);
  if (!parsed) return null;
  const cor = '#27ae60';
  const opcoes = { color: cor, weight: 2, fillOpacity: 0.08, fillColor: cor };
  let camada;
  if (parsed.tipo === 'circle') {
    camada = L.circle([parsed.lat, parsed.lng], { ...opcoes, radius: parsed.raio });
  } else {
    camada = L.polygon(parsed.coords, opcoes);
  }
  
  camada.bindTooltip(`<b>${cerca.name || 'Cerca'}</b><br>Clique para remover`, { className: 'cerca-tooltip', sticky: true });
  
  camada.on('mouseover', function () { this.setStyle({ fillOpacity: 0.2, weight: 3 }); });
  camada.on('mouseout', function () { this.setStyle({ fillOpacity: 0.08, weight: 2 }); });

  camada.on('click', function (e) {
    L.DomEvent.stopPropagation(e);
    if (confirm(`Remover a cerca "${cerca.name}"?`)) removerCerca(cerca.id);
  });
  return camada;
}

async function carregarCercas() {
  const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/cercas');
  return Array.isArray(data) ? data : (data.cercas || []);
}

function mostrarCercas() {
  carregarCercas().then(function (cercas) {
    ocultarCercas();
    _cercasLayer = L.layerGroup();
    cercas.forEach(function (c) {
      const camada = _criarCamadaCerca(c);
      if (camada) _cercasLayer.addLayer(camada);
    });
    _cercasLayer.addTo(map);
  }).catch(function () {});
}

function ocultarCercas() {
  if (_cercasLayer && map.hasLayer(_cercasLayer)) map.removeLayer(_cercasLayer);
  _cercasLayer = null;
  _cancelarDesenhoCirculo();
}

async function removerCerca(id) {
  try {
    await AL_CLIENTE.apiDelete(`/api/cliente/rastreamento/cercas/${id}`);
    if (_overlay.cercas) mostrarCercas();
    AL_CLIENTE.showAlert('Cerca removida.', 'success');
    
    // Se removeu, verifica se o botão no card deve ser desativado
    if (ativoId) {
       AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${ativoId}/cercas`).then(c => {
         if (c.length === 0) {
           const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
           if (btn) btn.classList.remove('ativo');
         }
       }).catch(() => {});
    }
  } catch (err) {
    AL_CLIENTE.showAlert('Erro ao remover cerca: ' + err.message);
  }
}

window.iniciarDesenhoCirculo = function (dispositivoId) {
  _cancelarDesenhoCirculo();
  const v = veiculosMap[dispositivoId];
  if (!v || !v.posicao) {
    AL_CLIENTE.showAlert('Veículo sem posição para criar cerca.', 'warning');
    return;
  }

  const latlng = L.latLng(v.posicao.latitude, v.posicao.longitude);
  _modoDesenho = { dispositivoId, circle: null };
  _cercaPendente = { ponto: latlng, dispositivoId: dispositivoId };

  const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
  if (btn) btn.classList.add('ativo');

  _modoDesenho.circle = L.circle(latlng, {
    radius: 200, color: '#e67e22', fillColor: '#e67e22',
    fillOpacity: 0.12, weight: 2, dashArray: '6,4',
  }).addTo(map);

  _mostrarDialogoCerca();
};

function _mostrarDialogoCerca() {
  const dlg = document.getElementById('dlg-cerca');
  if (!dlg) return;
  const v = _modoDesenho?.dispositivoId ? veiculosMap[_modoDesenho.dispositivoId] : null;
  const nomeInput = document.getElementById('cerca-nome');
  if (nomeInput) nomeInput.value = v ? `Cerca — ${v.placa || v.nome}` : '';
  const raioInput = document.getElementById('cerca-raio');
  if (raioInput) {
    raioInput.value = '200';
    raioInput.oninput = function () {
      const r = parseInt(this.value) || 200;
      if (_modoDesenho?.circle) _modoDesenho.circle.setRadius(r);
    };
  }
  dlg.style.display = 'block';

  const confirmar = document.getElementById('btn-cerca-confirmar');
  if (confirmar) {
    confirmar.onclick = async function () {
      const nome = (document.getElementById('cerca-nome')?.value || '').trim();
      const raio = parseInt(document.getElementById('cerca-raio')?.value) || 200;
      const ponto = _cercaPendente.ponto;
      const devId = _cercaPendente.dispositivoId;
      if (!nome) { AL_CLIENTE.showAlert('Informe um nome para a cerca.'); return; }
      if (!ponto) { _cancelarDesenhoCirculo(); return; }
      
      const area = `CIRCLE (${ponto.lat.toFixed(6)} ${ponto.lng.toFixed(6)}, ${raio})`;
      const btnCriar = this;
      btnCriar.disabled = true; 
      btnCriar.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      
      try {
        await AL_CLIENTE.apiPost('/api/cliente/rastreamento/cercas', { nome, area, dispositivoId: devId });
        _cancelarDesenhoCirculo();
        AL_CLIENTE.showAlert('Cerca criada!', 'success');
        
        // Ativa a visualização de cercas globalmente se estiver desligada
        if (!_overlay.cercas) {
          _overlay.cercas = true;
          const btnCercas = document.getElementById('ml-cercas');
          if (btnCercas) btnCercas.classList.add('ativo');
        }
        
        // Garante que o botão do card fique ativo
        const btnCard = document.querySelector('.dcard-acao[data-acao="cerca"]');
        if (btnCard) btnCard.classList.add('ativo');

        mostrarCercas();
      } catch (err) {
        AL_CLIENTE.showAlert('Erro ao criar cerca: ' + err.message);
      } finally {
        btnCriar.disabled = false;
        btnCriar.innerHTML = '<i class="fa fa-check"></i> Criar';
      }
    };
  }
  
  const cancelar = document.getElementById('btn-cerca-cancelar');
  if (cancelar) {
    cancelar.onclick = _cancelarDesenhoCirculo;
  }
}

function _cancelarDesenhoCirculo() {
  if (_modoDesenho?.circle && map.hasLayer(_modoDesenho.circle)) map.removeLayer(_modoDesenho.circle);
  _modoDesenho = null;
  _cercaPendente = { ponto: null, dispositivoId: null };
  if (map) map.getContainer().style.cursor = '';
  const banner = document.getElementById('mapa-instrucao');
  if (banner) banner.style.display = 'none';
  const dlg = document.getElementById('dlg-cerca');
  if (dlg) { dlg.style.display = 'none'; const btn = document.getElementById('btn-cerca-confirmar'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-check"></i> Criar'; } }
}

// ── Botões de ação do card de dispositivo ─────────────────────────────────────

window.acaoDispositivoCliente = async function(acao, dispositivoId) {
  if (acao === 'rota') { ativarRota(dispositivoId); return; }
  if (acao === 'cerca') {
    const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
    if (btn && btn.classList.contains('ativo')) {
      if (confirm('Deseja remover as cercas vinculadas a este dispositivo?')) {
        try {
          const cercas = await AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${dispositivoId}/cercas`);
          for (const c of cercas) {
            await removerCerca(c.id);
          }
          btn.classList.remove('ativo');
        } catch (err) {
          AL_CLIENTE.showAlert('Erro ao remover cercas.', 'danger');
        }
      }
      return;
    }
    iniciarDesenhoCirculo(dispositivoId);
  }
};

function _htmlAcoesCard(dispositivoId) {
  const rotaAtiva = !!_rotasIndividuais[dispositivoId];
  return `
    <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
      <div style="font-size:11px;font-weight:700;color:#888;margin-bottom:8px;text-align:center;letter-spacing:.5px">AÇÕES</div>
      <div style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap">
        <button class="dcard-acao${rotaAtiva ? ' ativo' : ''}" data-acao="rota" onclick="acaoDispositivoCliente('rota','${dispositivoId}')" title="Rota">
          <span class="dcard-acao-icon"><i class="fa fa-road"></i></span>
          <span>Rota</span>
        </button>
        <button class="dcard-acao" data-acao="cerca" onclick="acaoDispositivoCliente('cerca','${dispositivoId}')" title="Criar Cerca">
          <span class="dcard-acao-icon"><i class="fa fa-circle-o"></i></span>
          <span>Cerca</span>
        </button>
      </div>
    </div>`;
}

setInterval(() => { AL_CLIENTE.apiGet('/api/cliente/rastreamento/status-acesso').catch(() => {}); }, 60000);

window.fecharOverlay = function () {
  document.getElementById('overlay-historico').classList.remove('ativo');
  document.getElementById('overlay-iframe').src = '';
  if (history.state?.overlay) history.back();
};

window.addEventListener('popstate', (e) => {
  const overlay = document.getElementById('overlay-historico');
  if (overlay && overlay.classList.contains('ativo')) overlay.classList.remove('ativo');
});
