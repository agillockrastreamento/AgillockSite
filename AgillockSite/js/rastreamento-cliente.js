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
const _focusOffsetPx = 0;
const _eventPopupOffsetPx = 60;

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

// ── Eventos (cliente: expandido) ─────────────────────────────────────────────
const TIPOS_EVENTO_CLIENTE = [
  { tipo: 'ignitionOn',    label: 'Ignição Ligada',              css: 'tipo-ignition' },
  { tipo: 'ignitionOff',   label: 'Ignição Desligada',           css: 'tipo-ignition' },
  { tipo: 'geofenceEnter', label: 'Entrada na Cerca',            css: 'tipo-geofence' },
  { tipo: 'geofenceExit',  label: 'Saída da Cerca',              css: 'tipo-geofence' },
  { tipo: 'overspeed',     label: 'Excesso de Velocidade',       css: 'tipo-overspeed' },
  { tipo: 'powerCut',      label: 'Alimentação Cortada',         css: 'tipo-alarm' },
  { tipo: 'alarm',         label: 'Alarme',                      css: 'tipo-alarm' },
  { tipo: 'deviceLocked',  label: 'Veículo Bloqueado',           css: 'tipo-alarm' },
  { tipo: 'deviceUnlocked',label: 'Veículo Desbloqueado',        css: 'tipo-ignition' },
  { tipo: 'kmExcedida',    label: 'Km Excedida (Período)',       css: 'tipo-overspeed' },
  { tipo: 'kmReduzida',    label: 'Km Reduzida (Período)',       css: 'tipo-geofence' },
  { tipo: 'manutencaoAlerta',  label: 'Alerta de Manutenção',     css: 'tipo-manutencao-alerta' },
  { tipo: 'manutencaoAtrasada',label: 'Manutenção Atrasada',      css: 'tipo-manutencao-atrasada' },
  { tipo: 'manutencaoFeita',   label: 'Manutenção Realizada',     css: 'tipo-ignition' },
];
const TIPOS_EVENTO_CLIENTE_FILTRO = TIPOS_EVENTO_CLIENTE.filter(t => t.tipo !== 'manutencao');

let _evtFiltros = new Set();
let _evtNotif = true;
let _evtPlacaFiltro = '';
const _eventos = [];
const MAX_EVENTOS = 100;
const EVENTOS_PANEL_STORAGE_KEY = 'rastreamento_cliente_eventos_min';
const BARRA_VEICULOS_STORAGE_KEY = 'rastreamento_cliente_barra_min';
const TOPBAR_BUSCA_STORAGE_KEY = 'rastreamento_cliente_topbar_busca_min';
let _eventoPopupAtualIdx = null;
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

function _urlGoogleMaps(lat, lng, endereco) {
  const query = endereco ? endereco : `${lat},${lng}`;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}`;
}

function _htmlBotaoGoogleMaps(lat, lng, endereco) {
  return `<a href="${_urlGoogleMaps(lat, lng, endereco)}" target="_blank" rel="noopener noreferrer" class="dcard-maps-btn" title="Abrir no Google Maps" id="btn-maps-${lat}-${lng}"><i class="fa fa-map-pin" style="color:#e74c3c"></i></a>`;
}

function _htmlBotaoStreetView(lat, lng) {
  return `<a href="${_urlStreetView(lat, lng)}" target="_blank" rel="noopener noreferrer" class="dcard-streetview-btn" title="Abrir no Street View"><i class="fa fa-street-view"></i></a>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _getCardApelido(dispositivoId) {
  return String(veiculosMap[dispositivoId]?.apelidoCliente || '').trim();
}

function _isMobileTracking() { return window.innerWidth <= 700; }

let _trackingDrawerAberta = false;
let _trackingDrawerDragY = null;
let _trackingDrawerStartHeight = null;
let _trackingDrawerGlobalReady = false;
let _trackingDrawerMoved = false;

function _abrirTrackingDrawer() {
  const card = document.getElementById('device-detail-card');
  if (!card) return;
  _trackingDrawerAberta = true;
  card.classList.add('drawer-aberta');
  if (map) setTimeout(function () { map.invalidateSize(); }, 280);
}

function _fecharTrackingDrawer() {
  const card = document.getElementById('device-detail-card');
  if (!card) return;
  _trackingDrawerAberta = false;
  card.classList.remove('drawer-aberta');
  if (map) setTimeout(function () { map.invalidateSize(); }, 280);
}

function _prepararTrackingDrawer() {
  const card = document.getElementById('device-detail-card');
  const handle = document.getElementById('tracking-drawer-handle');
  if (!card || !handle || handle.dataset.drawerReady === '1') return;
  handle.dataset.drawerReady = '1';
  const dragTargets = [handle, card.querySelector('.dcard-header')].filter(Boolean);

  function toggleDrawer() {
    if (!_isMobileTracking()) return;
    if (_trackingDrawerMoved) {
      _trackingDrawerMoved = false;
      return;
    }
    if (_trackingDrawerAberta) _fecharTrackingDrawer();
    else _abrirTrackingDrawer();
  }
  function startDrag(clientY) {
    if (!_isMobileTracking()) return;
    _trackingDrawerDragY = clientY;
    _trackingDrawerStartHeight = card.getBoundingClientRect().height;
    _trackingDrawerMoved = false;
    card.style.transition = 'none';
  }
  function moveDrag(clientY) {
    if (_trackingDrawerDragY === null || !_isMobileTracking()) return;
    const dy = _trackingDrawerDragY - clientY;
    if (Math.abs(dy) > 8) _trackingDrawerMoved = true;
    const nextHeight = Math.min(Math.max(_trackingDrawerStartHeight + dy, window.innerHeight * 0.22), window.innerHeight * 0.82);
    card.style.height = `${nextHeight}px`;
  }
  function endDrag() {
    if (_trackingDrawerDragY === null || !_isMobileTracking()) return;
    card.style.transition = '';
    const h = card.getBoundingClientRect().height;
    if (h > window.innerHeight * 0.42) _abrirTrackingDrawer();
    else _fecharTrackingDrawer();
    card.style.height = '';
    _trackingDrawerDragY = null;
  }

  dragTargets.forEach(function (target) {
    target.addEventListener('click', toggleDrawer);
    target.addEventListener('touchstart', function (e) {
      startDrag(e.touches[0].clientY);
    }, { passive: true });
    target.addEventListener('touchmove', function (e) {
      if (_trackingDrawerDragY === null || !_isMobileTracking()) return;
      e.preventDefault();
      moveDrag(e.touches[0].clientY);
    }, { passive: false });
    target.addEventListener('touchend', endDrag, { passive: true });
    target.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      startDrag(e.clientY);
    });
  });
  if (!_trackingDrawerGlobalReady) {
    _trackingDrawerGlobalReady = true;
    document.addEventListener('pointermove', function (e) {
      if (_trackingDrawerDragY === null || !_isMobileTracking()) return;
      moveDrag(e.clientY);
    });
    document.addEventListener('pointerup', endDrag);
  }
}

function _instalarMobileOutsideClick() {
  document.addEventListener('click', function (e) {
    const busca = document.getElementById('filtro');
    const buscaWrap = document.getElementById('topbar-busca-wrap');
    if (busca && buscaWrap && !buscaWrap.contains(e.target)) busca.blur();
    if (!_isMobileTracking() || !ativoId) return;
    const card = document.getElementById('device-detail-card');
    if (!card || card.style.display === 'none') return;
    const ignorar = e.target.closest('#device-detail-card, .leaflet-control, .admin-topbar, #eventos-panel, #dlg-cerca, .modal, .modal-backdrop, #barra-veiculos-wrap');
    if (!ignorar) fecharCardDispositivo(true);
  }, true);
}

function _ajustarAlturaCardDispositivo() {
  const card = document.getElementById('device-detail-card');
  const mapaEl = document.getElementById('mapa');
  const area = document.getElementById('mapa-area') || mapaEl;
  if (!card || !mapaEl || !area || card.style.display === 'none') return;
  if (_isMobileTracking()) {
    card.style.top = '';
    card.style.maxHeight = '';
    return;
  }
  const mapRect = mapaEl.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  const topGap = 12;
  const escalaClearance = 28;
  const top = Math.max(topGap, mapRect.top - areaRect.top + topGap);
  const maxHeight = Math.max(220, mapRect.height - topGap - escalaClearance);
  card.style.top = `${top}px`;
  card.style.maxHeight = `${maxHeight}px`;
}

// ── Inicialização ─────────────────────────────────────────────────────────────

let _cercasPermitidas = new Set();

document.addEventListener('DOMContentLoaded', function () {
  AL_CLIENTE.apiGet('/api/cliente/rastreamento/cercas').then(cercas => {
    cercas.forEach(c => _cercasPermitidas.add(c.id));
  }).catch(() => {});

  verificarAcesso().then(function (bloqueado) {
    if (bloqueado) return;
    inicializarMapa();
    _aplicarPreferenciasOverlay();
    carregarUltimaLeituraCliente().finally(function () { inicializarEventosPanel(); });
    inicializarBarraVeiculos();
    inicializarTopbarBusca();
    carregarPosicoes();
    _instalarMobileOutsideClick();
    document.getElementById('filtro').addEventListener('input', renderBuscaResultados);
    new MutationObserver(function () {
      if (ativoId) atualizarCardAtivo(ativoId);
      renderEventosLista();
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

    const btnOverlayExportar = document.getElementById('btn-overlay-exportar');
    if (btnOverlayExportar) {
      btnOverlayExportar.addEventListener('click', function () {
        const iframe = document.getElementById('overlay-iframe');
        const abrirModal = iframe?.contentWindow?.abrirModalExportarRelatorioCliente;
        if (typeof abrirModal === 'function') abrirModal();
      });
    }
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

let _panelAbertoCliente = false;

let _ultimaLeituraCliente = 0;
let _eventosLimposAteCliente = 0;
let _eventosLimposRangesCliente = [];
let _periodoEventosCliente = { periodo: 'hoje', de: null, ate: null };

async function carregarUltimaLeituraCliente() {
  try {
    _ultimaLeituraCliente = parseInt(localStorage.getItem('al_last_notif_client') || '0', 10) || 0;
    _eventosLimposAteCliente = parseInt(localStorage.getItem('al_clear_notif_client') || '0', 10) || 0;
    _eventosLimposRangesCliente = JSON.parse(localStorage.getItem('al_clear_notif_client_ranges') || '[]') || [];
  } catch (e) {}
  try {
    const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/prefs');
    if (data && data.prefs && data.prefs.al_last_notif_client) {
      _ultimaLeituraCliente = parseInt(data.prefs.al_last_notif_client, 10) || 0;
    }
    if (data && data.prefs && data.prefs.al_clear_notif_client) {
      _eventosLimposAteCliente = parseInt(data.prefs.al_clear_notif_client, 10) || 0;
    }
    if (data && data.prefs && data.prefs.al_clear_notif_client_ranges) {
      _eventosLimposRangesCliente = JSON.parse(data.prefs.al_clear_notif_client_ranges) || [];
    }
  } catch (e) {}
  _atualizarBadgeNotificacoesCliente();
}

function _getUltimaLeituraCliente() {
  return _ultimaLeituraCliente;
}

function _maxEventoTsCliente() {
  return Math.max(Date.now(), ..._eventos.map(e => new Date(e.serverTime || Date.now()).getTime()).filter(Number.isFinite));
}

function _rotuloTipoEventoCliente(tipo) {
  const item = TIPOS_EVENTO_CLIENTE_FILTRO.find(t => t.tipo === tipo);
  return item ? item.label : tipo;
}

function _normalizarEventoCliente(evt) {
  if (!evt) return evt;
  if (evt.tipo === 'deviceOverspeed') evt = { ...evt, tipo: 'overspeed' };
  if (!evt.tipoLabel || evt.tipoLabel === evt.tipo || evt.tipoLabel === 'Limite de Velocidade') {
    evt = { ...evt, tipoLabel: _rotuloTipoEventoCliente(evt.tipo) };
  }
  return evt;
}

function _intervaloPeriodoEventosCliente(cutoff) {
  const periodo = _periodoEventosCliente.periodo || 'hoje';
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  if (periodo === 'ontem') return { de: inicioHoje - 86400000, ate: inicioHoje - 1 };
  if (periodo === '7dias') return { de: inicioHoje - 7 * 86400000, ate: cutoff };
  if (periodo === 'custom' && _periodoEventosCliente.de && _periodoEventosCliente.ate) {
    const de = new Date(_periodoEventosCliente.de + 'T00:00:00').getTime();
    const ate = new Date(_periodoEventosCliente.ate + 'T23:59:59').getTime();
    return { de, ate: Math.min(ate, cutoff) };
  }
  return { de: inicioHoje, ate: cutoff };
}

function _eventoLimpoCliente(evt) {
  const time = new Date(evt.serverTime || Date.now()).getTime();
  return _eventosLimposRangesCliente.some(r => time >= Number(r.de) && time <= Number(r.ate));
}

function _setUltimaLeituraCliente(ts) {
  const now = Number.isFinite(ts) ? ts : _maxEventoTsCliente();
  _ultimaLeituraCliente = now;
  try {
    localStorage.setItem('al_last_notif_client', String(now));
    AL_CLIENTE.apiPost('/api/cliente/rastreamento/prefs/merge', { prefs: { al_last_notif_client: now } });
  } catch (e) {}
}

function _atualizarBadgeNotificacoesCliente() {
  const btn = document.getElementById('map-btn-notif-cliente');
  if (!btn) return;
  const badge = btn.querySelector('.badge-count');
  if (!badge) return;
  
  if (_panelAbertoCliente) {
    _setUltimaLeituraCliente();
    badge.classList.remove('has-notifications');
    return;
  }

  const ultimaLeitura = _getUltimaLeituraCliente();
  let countUnread = 0;
  for (let i = 0; i < _eventos.length; i++) {
    const time = new Date(_eventos[i].serverTime || Date.now()).getTime();
    if (time > ultimaLeitura) countUnread++;
  }

  if (countUnread > 0) {
    badge.textContent = countUnread > 99 ? '99+' : countUnread;
    badge.classList.add('has-notifications');
  } else {
    badge.classList.remove('has-notifications');
  }
}

function inicializarEventosPanel() {
  // O painel inicia minimizado (Display none controlado via class)
  const panel = document.getElementById('eventos-panel');
  if (panel) panel.classList.add('minimizado');
  _injetarFiltroPlacaEventosCliente();

  const dropdown = document.getElementById('evt-tipo-dropdown');
  dropdown.innerHTML = _htmlAcoesFiltroTipoEventos() + TIPOS_EVENTO_CLIENTE_FILTRO.map(t =>
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

  dropdown.querySelector('[data-evt-tipos="todos"]')?.addEventListener('click', function () {
    dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
    _atualizarFiltrosTipo();
    renderEventosLista();
  });

  dropdown.querySelector('[data-evt-tipos="nenhum"]')?.addEventListener('click', function () {
    dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    _atualizarFiltrosTipo();
    renderEventosLista();
  });

  const buscaTipo = dropdown.querySelector('[data-evt-tipos-busca]');
  buscaTipo?.addEventListener('input', function () {
    const termo = _normalizarTextoBuscaTipo(this.value);
    dropdown.querySelectorAll('.evt-tipo-item').forEach(item => {
      const texto = _normalizarTextoBuscaTipo(item.textContent || '');
      item.style.display = !termo || texto.includes(termo) ? '' : 'none';
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
    const cutoff = _maxEventoTsCliente();
    const range = _intervaloPeriodoEventosCliente(cutoff);
    _eventosLimposRangesCliente.push(range);
    try {
      localStorage.setItem('al_clear_notif_client_ranges', JSON.stringify(_eventosLimposRangesCliente));
      localStorage.setItem('al_last_notif_client', String(cutoff));
      AL_CLIENTE.apiPost('/api/cliente/rastreamento/prefs/merge', {
        prefs: { al_clear_notif_client_ranges: JSON.stringify(_eventosLimposRangesCliente), al_last_notif_client: cutoff },
      });
    } catch (e) {}
    for (let i = _eventos.length - 1; i >= 0; i--) {
      if (_eventoLimpoCliente(_eventos[i])) _eventos.splice(i, 1);
    }
    _setUltimaLeituraCliente(cutoff);
    _atualizarBadgeNotificacoesCliente();
    renderEventosLista();
  });

  // Listeners para botões de período de eventos
  document.querySelectorAll('.btn-evt-periodo').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.btn-evt-periodo').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const periodo = this.dataset.periodo;
      const customRange = document.getElementById('evt-custom-range');
      if (periodo === 'custom') {
        customRange.style.display = 'block';
        const hoje = new Date().toISOString().slice(0, 10);
        const deInput = document.getElementById('evt-custom-de');
        const ateInput = document.getElementById('evt-custom-ate');
        if (!deInput.value) deInput.value = hoje;
        if (!ateInput.value) ateInput.value = hoje;
      } else {
        customRange.style.display = 'none';
        carregarHistoricoEventos(periodo);
      }
    });
  });

  // Carregar 'hoje' por padrão ao iniciar
  const btnHoje = document.querySelector('.btn-evt-periodo[data-periodo="hoje"]');
  if (btnHoje) btnHoje.classList.add('active');
  carregarHistoricoEventos('hoje');

  document.getElementById('evt-custom-buscar').addEventListener('click', function() {
    const de = document.getElementById('evt-custom-de').value;
    const ate = document.getElementById('evt-custom-ate').value;
    if (!de || !ate) {
      AL_CLIENTE.showAlert('Preencha as duas datas.', 'warning');
      return;
    }
    carregarHistoricoEventos('custom', de, ate);
  });
}

async function carregarHistoricoEventos(periodo, de, ate) {
  _periodoEventosCliente = { periodo: periodo || 'hoje', de: de || null, ate: ate || null };
  const lista = document.getElementById('eventos-lista');
  lista.innerHTML = '<div style="padding:20px;text-align:center;color:#999"><i class="fa fa-spinner fa-spin"></i> Carregando...</div>';

  try {
    let url = `/api/cliente/notificacoes/eventos?periodo=${periodo}`;
    if (periodo === 'custom' && de && ate) url += `&de=${de}&ate=${ate}`;
    const data = await AL_CLIENTE.apiGet(url);
    _eventos.length = 0;
    if (data && data.length) {
      data.forEach(e => {
        e = _normalizarEventoCliente(e);
        const time = new Date(e.serverTime || Date.now()).getTime();
        const tiposPermitidos = TIPOS_EVENTO_CLIENTE_FILTRO.map(t => t.tipo);
        if (_eventoLimpoCliente(e) || !tiposPermitidos.includes(e.tipo)) return;
        _eventos.push(e);
      });
    }
    renderEventosLista();
  } catch (err) {
    console.error('Erro ao carregar histórico de eventos', err);
    lista.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c">Erro ao carregar histórico.</div>';
  }
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

function _normalizarPlacaFiltro(valor) {
  return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function _htmlAcoesFiltroTipoEventos() {
  return `
    <div style="padding:8px;border-bottom:1px solid rgba(128,128,128,.18);position:sticky;top:0;background:inherit;z-index:1">
      <div style="position:relative;margin-bottom:7px">
        <i class="fa fa-search" style="position:absolute;left:7px;top:50%;transform:translateY(-50%);font-size:10px;color:#8a94a6"></i>
        <input type="text" data-evt-tipos-busca class="form-control input-xs" placeholder="Buscar tipo" autocomplete="off" style="height:24px;font-size:11px;padding:3px 7px 3px 23px;border-radius:6px;">
      </div>
      <div style="display:flex;gap:6px">
        <button type="button" data-evt-tipos="todos" class="btn btn-default btn-xs" style="flex:1;font-size:10px;padding:4px 6px">Marcar todos</button>
        <button type="button" data-evt-tipos="nenhum" class="btn btn-default btn-xs" style="flex:1;font-size:10px;padding:4px 6px">Desmarcar todos</button>
      </div>
    </div>
  `;
}

function _normalizarTextoBuscaTipo(valor) {
  return String(valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function _placaEventoCliente(e) {
  const v = veiculosMap[e.dispositivoId];
  return v?.placa || e.placa || e.devicePlate || e.devicePlaca || '';
}

function _injetarFiltroPlacaEventosCliente() {
  const header = document.getElementById('eventos-header');
  const filtros = document.getElementById('eventos-filtros');
  if (!header || !filtros || document.getElementById('evt-placa-filtro')) return;
  if (!document.getElementById('evt-placa-filtro-style')) {
    const style = document.createElement('style');
    style.id = 'evt-placa-filtro-style';
    style.textContent = '#eventos-panel.minimizado #evt-placa-filtro-wrap{display:none!important}';
    document.head.appendChild(style);
  }
  const wrap = document.createElement('div');
  wrap.id = 'evt-placa-filtro-wrap';
  wrap.style.cssText = 'position:relative;margin-bottom:8px;';
  wrap.innerHTML = `
    <i class="fa fa-search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;color:#8a94a6"></i>
    <input type="text" id="evt-placa-filtro" class="form-control input-sm" placeholder="Buscar por placa" autocomplete="off" style="height:28px;font-size:12px;padding:4px 26px 4px 26px;border-radius:7px;">
    <button type="button" id="evt-placa-limpar" title="Limpar busca" style="display:none;position:absolute;right:5px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#8a94a6;padding:2px 5px;line-height:1"><i class="fa fa-times"></i></button>
  `;
  header.insertBefore(wrap, filtros);
  const input = wrap.querySelector('#evt-placa-filtro');
  const limpar = wrap.querySelector('#evt-placa-limpar');
  input.addEventListener('input', function () {
    _evtPlacaFiltro = this.value || '';
    limpar.style.display = _evtPlacaFiltro ? 'block' : 'none';
    renderEventosLista();
  });
  limpar.addEventListener('click', function () {
    input.value = '';
    _evtPlacaFiltro = '';
    limpar.style.display = 'none';
    input.focus();
    renderEventosLista();
  });
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
    if (map) setTimeout(() => {
      map.invalidateSize();
      _ajustarAlturaCardDispositivo();
    }, 220);
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

function inicializarTopbarBusca() {
  _aplicarEstadoTopbarBusca();
  const btn = document.getElementById('topbar-busca-toggle');
  const topbar = document.querySelector('.admin-topbar');
  if (!btn || !topbar) return;

  btn.addEventListener('click', function () {
    topbar.classList.toggle('busca-fechada');
    const fechada = topbar.classList.contains('busca-fechada');
    try { localStorage.setItem(TOPBAR_BUSCA_STORAGE_KEY, fechada ? '1' : '0'); } catch {}
    btn.title = fechada ? 'Mostrar busca' : 'Ocultar busca';
    if (fechada) {
      const filtro = document.getElementById('filtro');
      const lista = document.getElementById('lista-resultados-busca');
      if (filtro) filtro.value = '';
      if (lista) { lista.style.display = 'none'; lista.innerHTML = ''; }
    }
  });
}

function _aplicarEstadoTopbarBusca() {
  const topbar = document.querySelector('.admin-topbar');
  const btn = document.getElementById('topbar-busca-toggle');
  if (!topbar || !btn) return;
  let fechada = false;
  try { fechada = localStorage.getItem(TOPBAR_BUSCA_STORAGE_KEY) === '1'; } catch {}
  topbar.classList.toggle('busca-fechada', fechada);
  btn.title = fechada ? 'Mostrar busca' : 'Ocultar busca';
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
    const ativas = TIPOS_EVENTO_CLIENTE_FILTRO.length - _evtFiltros.size;
    label.textContent = `Tipo (${ativas}/${TIPOS_EVENTO_CLIENTE_FILTRO.length})`;
  }
}

function adicionarEvento(evt) {
  evt = _normalizarEventoCliente(evt);
  const time = new Date(evt.serverTime || Date.now()).getTime();
  const tiposPermitidos = TIPOS_EVENTO_CLIENTE_FILTRO.map(t => t.tipo);
  if (evt.adminEvento === true) return;
  if (evt.origemTipo === 'ADMIN' && evt.notificarCliente === false) return;
  if (evt.origemTipo === 'CLIENTE' && window.AL_CLIENTE && AL_CLIENTE.getUser) {
    const user = AL_CLIENTE.getUser() || {};
    if (evt.clienteId && user.clienteId && evt.clienteId !== user.clienteId) return;
    if (evt.clienteLoginId && user.sub && evt.clienteLoginId !== user.sub) return;
  }
  if (_eventoLimpoCliente(evt) || !tiposPermitidos.includes(evt.tipo)) return;
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
  const placaFiltro = _normalizarPlacaFiltro(_evtPlacaFiltro);
  const filtrados = _eventos.filter(e => {
    if (_evtFiltros.has(e.tipo)) return false;
    if (!placaFiltro) return true;
    return _normalizarPlacaFiltro(_placaEventoCliente(e)).includes(placaFiltro);
  });

  if (!filtrados.length) {
    lista.innerHTML = `<div id="eventos-vazio">
      <i class="fa fa-bell-o" style="font-size:28px;display:block;margin-bottom:8px;color:#ddd"></i>
      ${placaFiltro ? 'Nenhum evento para esta placa.' : 'Aguardando eventos...'}
    </div>`;
    return;
  }

  const getEventoStyle = (tipo) => {
    switch (tipo) {
      case 'ignitionOn': case 'deviceUnlocked': return { cls: 'success', color: '#27ae60', icon: 'fa-key' };
      case 'ignitionOff': return { cls: 'warning', color: '#e67e22', icon: 'fa-power-off' };
      case 'overspeed': case 'powerCut': case 'alarm': case 'deviceLocked': case 'kmExcedida': return { cls: 'danger', color: '#e74c3c', icon: 'fa-exclamation-triangle' };
      case 'geofenceEnter': case 'kmReduzida': return { cls: 'info', color: '#2980b9', icon: 'fa-sign-in' };
      case 'geofenceExit': return { cls: 'warning', color: '#e67e22', icon: 'fa-sign-out' };
      case 'manutencao': case 'manutencaoAlerta': return { cls: 'warning', color: '#e67e22', icon: 'fa-wrench' };
      case 'manutencaoAtrasada': return { cls: 'danger', color: '#e74c3c', icon: 'fa-wrench' };
      case 'manutencaoFeita': return { cls: 'success', color: '#27ae60', icon: 'fa-check-circle' };
      default: return { cls: 'info', color: '#2980b9', icon: 'fa-bell' };
    }
  };

  const isDark = document.documentElement.classList.contains('dark-theme');
  const descColor = isDark ? '#f4f7fb' : '#555';
  const hexToRgba = (hex, alpha) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };

  lista.innerHTML = filtrados.map(function (e) {
    const style = getEventoStyle(e.tipo);
    const tempo = fmtTempoDecorrido(e.serverTime);
    const v = veiculosMap[e.dispositivoId];
    const nomeDev = v ? v.nome : (e.dispositivoId || '—');
    const placaDev = v?.placa ? `(${v.placa})` : '';
    const textoMensagem = e.mensagem || e.tipoLabel || e.tipo;

    return `<div class="evento-item" style="border-left:none !important; --evt-color:${style.color}; --evt-hover-bg:${hexToRgba(style.color, isDark ? 0.24 : 0.12)};" onclick="clicarEvento(${_eventos.indexOf(e)})">
      <div class="evt-icon-wrap" style="color: ${style.color}"><i class="fa ${style.icon}"></i></div>
      <div class="evt-content">
        <div class="evt-dispositivo" style="color: ${style.color}; font-weight: 700;">${nomeDev} ${placaDev}</div>
        <div class="evt-desc" style="color: ${descColor}; font-size: 11px; margin: 2px 0;">${textoMensagem}</div>
        <div class="evt-footer" style="display:flex; justify-content: space-between; align-items: center;">
          <span class="evt-tempo" style="font-size: 10px; color: #999;">há ${tempo}</span>
          <i class="fa fa-map-marker" style="color: ${style.color}; font-size: 12px;"></i>
        </div>
      </div>
    </div>`;
  }).join('');

  _atualizarBadgeNotificacoesCliente();
}

function _latLngComOffset(posicao, offsetOverride, targetZoom, offsetY) {
  const offset = Number.isFinite(offsetOverride) ? offsetOverride : _focusOffsetPx;
  const oy = Number.isFinite(offsetY) ? offsetY : 0;
  if (!map || !posicao) return [posicao.latitude, posicao.longitude];
  const zoom = Number.isFinite(targetZoom) ? targetZoom : (map.getZoom() || 16);
  const point = map.project([posicao.latitude, posicao.longitude], zoom);
  const centerPoint = L.point(point.x - offset, point.y - oy);
  const target = map.unproject(centerPoint, zoom);
  return [target.lat, target.lng];
}

function _centralizarDispositivo(posicao, zoom = 16, offsetPx = 0, animate = true, offsetY = 0) {
  if (!map || !posicao) return;
  const destino = (offsetPx || offsetY) ? _latLngComOffset(posicao, offsetPx, zoom, offsetY) : [posicao.latitude, posicao.longitude];
  map.stop();
  map.invalidateSize();
  if (animate) map.flyTo(destino, zoom, { animate: true, duration: 0.45 });
  else map.setView(destino, zoom, { animate: false });
}

function _restaurarPopupVeiculoCliente(did) {
  const marker = marcadores[did];
  const v = veiculosMap[did];
  if (!marker || !v) return;
  marker._eventPopupAberto = false;
  marker._eventOriginalPopup = null;
  marker._eventPopupToken = null;
  if (_mostrarPopup) {
    marker.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
  } else {
    marker.unbindPopup();
  }
}

window.clicarEvento = function (idx) {
  const e = _eventos[idx];
  if (!e) return;
  _eventoPopupAtualIdx = idx;

  const style = (() => {
    switch (e.tipo) {
      case 'ignitionOn': case 'deviceUnlocked': return { color: '#27ae60' };
      case 'ignitionOff': return { color: '#e67e22' };
      case 'overspeed': case 'powerCut': case 'alarm': case 'deviceLocked': case 'kmExcedida': case 'manutencaoAtrasada': return { color: '#e74c3c' };
      case 'manutencaoAlerta': return { color: '#e67e22' };
      case 'manutencaoFeita': return { color: '#27ae60' };
      default: return { color: '#2980b9' };
    }
  })();

  const v = veiculosMap[e.dispositivoId];
  if (v?.posicao) {
    const barraWrap = document.getElementById('barra-veiculos-wrap');
    const barraExpandida = !!document.getElementById('barra-veiculos')?.classList.contains('expandida');
    const offsetBarraY = barraExpandida ? Math.round((barraWrap?.offsetHeight || 80) / 2) : 0;
    focar(e.dispositivoId, { abrirPopup: false, offsetPx: _eventPopupOffsetPx, offsetY: offsetBarraY });

    if (!marcadores[e.dispositivoId]) renderMarcadores();
    const marker = marcadores[e.dispositivoId];
    if (marker) {
      _restaurarPopupVeiculoCliente(e.dispositivoId);

      const addrId = `evt-addr-${idx}`;
      const eventoLat = e.lat != null ? Number(e.lat) : v.posicao.latitude;
      const eventoLng = e.lng != null ? Number(e.lng) : v.posicao.longitude;
      const eventoTemCoords = Number.isFinite(eventoLat) && Number.isFinite(eventoLng);
      const mesmaPosicaoAtual = eventoTemCoords
        && Math.abs(eventoLat - v.posicao.latitude) < 0.00001
        && Math.abs(eventoLng - v.posicao.longitude) < 0.00001;
      const enderecoInicial = e.endereco || (mesmaPosicaoAtual ? (v.posicao.endereco || v.endereco || '') : '');
      const enderecoHtml = enderecoInicial
        ? `<i class="fa fa-map-marker"></i> ${esc(enderecoInicial)}`
        : eventoTemCoords
          ? '<i class="fa fa-map-marker"></i> Buscando endereco...'
          : '<i class="fa fa-map-marker"></i> Localizacao do evento indisponivel';
      const coordsHtml = eventoTemCoords
        ? `Lat: ${eventoLat.toFixed(5)} | Lng: ${eventoLng.toFixed(5)}`
        : 'Sem coordenadas do evento';
      const acoesMapaHtml = eventoTemCoords ? `
          <div style="display: flex; gap: 6px; margin-bottom: 6px;">
            <a href="${_urlGoogleMaps(eventoLat, eventoLng, enderecoInicial)}" target="_blank" class="btn btn-xs btn-default evt-popup-maps-btn" style="flex:1; font-size: 9px; padding: 4px;" id="btn-maps-${eventoLat}-${eventoLng}"><i class="fa fa-google"></i> Maps</a>
            <a href="${_urlStreetView(eventoLat, eventoLng)}" target="_blank" class="btn btn-xs btn-primary" style="flex:1; font-size: 9px; padding: 4px; color: #fff !important;"><i class="fa fa-street-view"></i> StreetView</a>
          </div>` : '';
      const isDark = document.documentElement.classList.contains('dark-theme');
      const bgAddr = isDark ? '#172033' : '#f8f9fa';
      const colorMain = isDark ? '#f8fafc' : '#333';
      const colorMuted = isDark ? '#d7dde6' : '#666';
      const coordColor = isDark ? '#aab4c0' : '#777';
      const borderCol = isDark ? '#334155' : '#eee';

      const content = `
        <div class="evt-popup-content" style="padding: 4px; min-width: 200px;">
          <h6 style="margin: 0 0 6px; color: ${style.color}; font-weight: 700; font-size: 13px; border-bottom: 1px solid ${borderCol}; padding-bottom: 4px;">${e.tipoLabel || 'Notificação'}</h6>
          <div style="font-size: 11px; color: ${colorMain}; line-height: 1.4; margin-bottom: 8px; font-weight: 500;">${esc(e.mensagem || '')}</div>
          
          <div class="evt-popup-address" style="background: ${bgAddr}; border: 1px solid ${borderCol}; border-radius: 6px; padding: 6px; margin-bottom: 8px;">
            <div id="${addrId}" style="font-size: 10px; color: ${colorMuted}; margin-bottom: 4px;">${enderecoHtml}</div>
            ${enderecoInicial ? '' : `<div id="${addrId}-coords" style="font-size: 9px; color: ${coordColor};">${coordsHtml}</div>`}
          </div>
          ${acoesMapaHtml}

          <div style="font-size: 9px; color: ${coordColor}; text-align: right;">
            <i class="fa fa-clock-o"></i> ${fmtGPSTimeSec(e.serverTime)}
          </div>
        </div>
      `;

      const popupToken = Date.now() + '-' + idx;
      marker._eventPopupAberto = true;
      marker._eventPopupToken = popupToken;
      marker.bindPopup(content, {
        className: `popup-evento-moderno${barraExpandida ? ' popup-evento-rodape-aberto' : ''}`,
        offset: [0, -10],
        maxWidth: 250,
      });
      setTimeout(function() {
        if (marker._eventPopupToken === popupToken && map.hasLayer(marker)) {
          marker.openPopup();
          if (!enderecoInicial && eventoTemCoords) geocodificarCoordenadas(eventoLat, eventoLng, addrId);
        }
      }, 500);

      marker.once('popupclose', function() {
        _restaurarPopupVeiculoCliente(e.dispositivoId);
        _eventoPopupAtualIdx = null;
      });
    }
  } else if (e.lat != null && e.lng != null) {
    map.flyTo([e.lat, e.lng], 16, { animate: true, duration: 0.8 });
  }
};

// ── Mapa ──────────────────────────────────────────────────────────────────────

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: false, maxZoom: 21 }).setView([-15.78, -47.93], 5);

  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
  );
  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
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

  // ── Botão Global de Notificações (BtnNotif) ──
  const BtnNotif = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-control map-btn-notif');
      btn.id = 'map-btn-notif-cliente';
      btn.title = 'Notificações / Eventos';
      btn.innerHTML = `
        <i class="fa fa-bell"></i>
        <span class="badge-count">0</span>
      `;
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function () {
        const panel = document.getElementById('eventos-panel');
        if (!panel) return;
        const estaAberto = !panel.classList.contains('minimizado');
        _panelAbertoCliente = !estaAberto;
        
        if (_panelAbertoCliente) {
          panel.classList.remove('minimizado');
          btn.classList.add('ativo');
        } else {
          panel.classList.add('minimizado');
          btn.classList.remove('ativo');
        }
        _atualizarBadgeNotificacoesCliente();
        if (map) setTimeout(() => map.invalidateSize(), 220);
      });
      return btn;
    },
    onRemove() {}
  });
  new BtnNotif({ position: 'topright' }).addTo(map);

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
    const className = e.popup?.options?.className || '';
    if (className.includes('popup-evento-moderno')) return;
    if (_togglingPopup || _modoDesenho) return;
    if (ativoId && marcadores[ativoId] && e.popup === marcadores[ativoId].getPopup()) {
      if (_isMobileTracking()) _fecharTrackingDrawer();
      else fecharCardDispositivo(true);
    }
  });
  map.on('baselayerchange', function () {
    _atualizarControleTipoGoogle();
  });
  map.on('click', function () {
    if (!_modoDesenho) {
      _fecharSpider();
      if (ativoId) {
        if (_isMobileTracking()) _fecharTrackingDrawer();
        else fecharCardDispositivo(true);
      }
    }
  });
  map.on('zoomend', function () { _fecharSpider(); if (!modoFoco) renderMarcadores(); });

  requestAnimationFrame(function () {
    map.invalidateSize();
    setTimeout(function () { map.invalidateSize(); }, 120);
    setTimeout(function () { map.invalidateSize(); }, 320);
  });
  window.addEventListener('resize', function () {
    if (map) map.invalidateSize();
    _ajustarAlturaCardDispositivo();
  });
}

function _criarCamadasGoogle() {
  const scale = window.devicePixelRatio > 1 ? 2 : 1;
  const opts = {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: 'Map data © Google',
    maxNativeZoom: 20,
    maxZoom: 21,
    tileSize: 256,
    zoomOffset: 0,
    updateWhenIdle: false,
    updateWhenZooming: false,
  };
  return Object.keys(GOOGLE_MAP_TYPES).reduce(function (acc, tipo) {
    acc[tipo] = L.tileLayer(
      'https://{s}.google.com/vt/lyrs=' + GOOGLE_MAP_TYPES[tipo].lyrs + '&x={x}&y={y}&z={z}&scale=' + scale,
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

// ── Persistência de preferências de overlay ───────────────────────────────────

function _salvarPreferenciasOverlay() {
  try {
    localStorage.setItem('al-overlay-pref', JSON.stringify({
      labels: _overlay.labels, cercas: _overlay.cercas,
      rastro: _overlay.rastro, alarmes: _overlay.alarmes,
    }));
  } catch(e) {}
}

function _aplicarPreferenciasOverlay() {
  try {
    const pref = JSON.parse(localStorage.getItem('al-overlay-pref') || '{}');
    if (pref.labels  !== undefined) { _overlay.labels  = pref.labels;  _mostrarPopup = _overlay.labels; }
    if (pref.cercas  !== undefined)   _overlay.cercas  = pref.cercas;
    if (pref.rastro  !== undefined)   _overlay.rastro  = pref.rastro;
    if (pref.alarmes !== undefined)   _overlay.alarmes = pref.alarmes;
    document.getElementById('ml-labels') ?.classList.toggle('ativo', _overlay.labels);
    document.getElementById('ml-cercas') ?.classList.toggle('ativo', _overlay.cercas);
    document.getElementById('ml-rastro') ?.classList.toggle('ativo', _overlay.rastro);
    document.getElementById('ml-alarmes')?.classList.toggle('ativo', _overlay.alarmes);
    if (_overlay.cercas) carregarCercas().then(mostrarCercas);
  } catch(e) {}
}

// ── Botões de camadas ─────────────────────────────────────────────────────────

function _adicionarBotoesCamadas() {
  const tray = document.getElementById('mapa-tray');
  if (!tray) return;

  let _toggleBtn = null;
  function posicionarTrayCamadas() {
    if (!_toggleBtn) return;
    const area = document.getElementById('mapa-area');
    if (!area) return;
    const areaRect = area.getBoundingClientRect();
    const btnRect = _toggleBtn.getBoundingClientRect();
    const top = Math.max(10, btnRect.top - areaRect.top);
    const right = Math.max(10, areaRect.right - btnRect.left + 9);
    tray.style.top = `${top}px`;
    tray.style.right = `${right}px`;
  }
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
        const abrindo = !tray.classList.contains('aberta');
        if (abrindo) posicionarTrayCamadas();
        const aberta = tray.classList.toggle('aberta', abrindo);
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
  window.addEventListener('resize', function () {
    if (tray.classList.contains('aberta')) posicionarTrayCamadas();
  });

  document.getElementById('ml-alarmes').addEventListener('click', function () {
    _overlay.alarmes = !_overlay.alarmes;
    this.classList.toggle('ativo', _overlay.alarmes);
    _atualizarAlarmeBadges();
    _salvarPreferenciasOverlay();
  });

  document.getElementById('ml-dispositivos').addEventListener('click', function () {
    this.classList.toggle('ativo');
  });

  document.getElementById('ml-labels').addEventListener('click', function () {
    _overlay.labels = !_overlay.labels;
    this.classList.toggle('ativo', _overlay.labels);
    _mostrarPopup = _overlay.labels;
    _atualizarBindingsPopup();
    _salvarPreferenciasOverlay();
  });

  document.getElementById('ml-cercas').addEventListener('click', function () {
    _overlay.cercas = !_overlay.cercas;
    this.classList.toggle('ativo', _overlay.cercas);
    if (_overlay.cercas) carregarCercas().then(mostrarCercas); else ocultarCercas();
    _salvarPreferenciasOverlay();
  });

  document.getElementById('ml-rastro').addEventListener('click', function () {
    _overlay.rastro = !_overlay.rastro;
    this.classList.toggle('ativo', _overlay.rastro);
    if (_overlay.rastro) _carregarRastros(); else _limparRastros();
    _salvarPreferenciasOverlay();
  });
}

// ── Rastros ───────────────────────────────────────────────────────────────────

function _limparRastros() {
  Object.values(_rastros).forEach(r => {
    if (r.linha && map.hasLayer(r.linha)) map.removeLayer(r.linha);
    (r.setas || []).forEach(s => { if (map.hasLayer(s)) map.removeLayer(s); });
  });
  Object.keys(_rastros).forEach(k => delete _rastros[k]);
}

async function _carregarRastros() {
  const ids = Object.keys(veiculosMap).filter(id => veiculosMap[id]?.posicao);
  for (const id of ids) {
    if (!_overlay.rastro) break;
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
      const hist = await AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${id}/historico?from=${from}&to=${now.toISOString()}`);
      if (!_overlay.rastro) break;
      const pontos = (hist.posicoes || []).map(p => [p.latitude, p.longitude]);
      if (pontos.length >= 2) {
        const linha = L.polyline(pontos, {
          color: '#2980b9', weight: 3, opacity: 0.75,
        }).addTo(map);
        const setas = _criarSetasNoRastro(pontos, '#2980b9');
        _rastros[id] = { linha, setas };
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
  //setWsStatus('reconectando', 'Conectando...');

  ws.onopen = () => { 
    wsReconectando = false; 
    //setWsStatus('conectado', 'Tempo real ativo'); 
  };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    processarMensagemWs(msg);
  };
  ws.onclose = () => {
    //setWsStatus('desconectado', 'Reconectando...');
    if (!wsReconectando) { wsReconectando = true; wsReconectTimer = setTimeout(conectarWebSocket, 5000); }
  };
  ws.onerror = () => ws.close();
}

function processarMensagemWs(msg) {
  if (msg.positions?.length) {
    msg.positions.forEach(pos => {
      const did = traccarIdParaDispositivoId[pos.deviceId];
      if (!did || !veiculosMap[did]) return;
      const v = veiculosMap[did];
      const antiga = v.posicao || {};
      
      const _emMov = pos.emMovimento ?? null;
      const _est = _estadoSince[did];
      if (!_est || _est.emMovimento !== _emMov) {
        _estadoSince[did] = { emMovimento: _emMov, desde: Date.now() };
      }
      
      v.posicao = {
        latitude: pos.latitude, longitude: pos.longitude, velocidade: pos.velocidade,
        curso: pos.curso, altitude: pos.altitude, fixTime: pos.fixTime,
        deviceTime: pos.deviceTime, serverTime: pos.serverTime, valida: pos.valida,
        ignicao: pos.ignicao !== null ? pos.ignicao : (antiga.ignicao ?? null), 
        emMovimento: pos.emMovimento, 
        satelites: pos.satelites ?? (antiga.satelites ?? null),
        bateria_nivel: pos.bateria_nivel ?? (antiga.bateria_nivel ?? null), 
        alarme: pos.alarme ?? (antiga.alarme ?? null), 
        alarme_codigo: pos.alarme_codigo ?? (antiga.alarme_codigo ?? null),
        tensao: pos.tensao ?? (antiga.tensao ?? null), 
        sinal: pos.sinal ?? (antiga.sinal ?? null), 
        odometro: pos.odometro ?? (antiga.odometro ?? null),
        horas_motor: pos.horas_motor ?? (antiga.horas_motor ?? null), 
        bloqueado: pos.bloqueado !== null ? pos.bloqueado : (antiga.bloqueado ?? null), 
        endereco: pos.endereco ?? (antiga.endereco ?? null),
      };
      atualizarMarcador(did); atualizarCardAtivo(did); atualizarCardBarra(did);
      if (_overlay.alarmes) _renderAlarmeBadge(did, veiculosMap[did]);
      if (_overlay.rastro && _rastros[did]) _rastros[did].linha.addLatLng([pos.latitude, pos.longitude]);
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
      // Trava de segurança: só processa o evento se o veículo estiver no mapa deste cliente
      if (!did || !veiculosMap[did]) return;

      // Filtrar eventos de geofence: mostrar só cercas que o cliente tem permissão
      if ((e.type === 'geofenceEnter' || e.type === 'geofenceExit') && e.geofenceId) {
        if (!_cercasPermitidas.has(e.geofenceId)) return;
      }

      const pos = veiculosMap[did]?.posicao;
      adicionarEvento({
        dispositivoId: did || null,
        tipo: e.type,
        tipoLabel: e.tipoLabel,
        mensagem: e.mensagem, // Garante o uso da mensagem detalhada
        serverTime: e.serverTime,
        lat: e.lat ?? pos?.latitude ?? null,
        lng: e.lng ?? pos?.longitude ?? null,
        endereco: e.endereco ?? null,
        geofenceId: e.geofenceId,
        origemTipo: e.origemTipo,
        origemId: e.origemId,
        clienteId: e.clienteId,
        clienteLoginId: e.clienteLoginId,
        notificarCliente: e.notificarCliente,
        adminEvento: e.adminEvento,
      });
    });
  }
  renderSidebar();
}

// function setWsStatus(estado, texto) {
//   const el = document.getElementById('ws-status');
//  if (el) {
//    el.className = estado;
//    el.innerHTML = `<i class="fa fa-circle"></i> ${texto}`;
//  }
// }

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
    if (_overlay.labels) _bindLabelVeiculo(sm, _textoLabelVeiculo(v));
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
        if (_overlay.labels) _bindLabelVeiculo(m, _textoLabelVeiculo(v));
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
  
  const isOpen = marcadores[did].getPopup()?.isOpen();
  const isEventPopup = (marcadores[did].getPopup()?.options?.className || '').includes('popup-evento-moderno');
  if (_mostrarPopup && isOpen && !isEventPopup) {
    marcadores[did].getPopup().setContent(criarPopupSimples(v));
  }
}

// ── Injeção de estilos para tema escuro ─────────────────────────────────────
(function injectTrackingDarkStyles() {
  const id = 'tracking-dark-styles';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.innerHTML = `
    .leaflet-tooltip.label-veiculo-clean {
      box-shadow: none !important;
      filter: none !important;
      text-shadow: none !important;
      -webkit-filter: none !important;
      will-change: transform;
    }
    #eventos-lista .evento-item { transition: background-color .18s ease, border-color .18s ease, transform .18s ease; }
    #eventos-lista .evento-item:hover { background: var(--evt-hover-bg) !important; border-color: var(--evt-color) !important; }
    #eventos-lista .evt-icon-wrap,
    #eventos-lista .evento-item:hover .evt-icon-wrap { background: transparent !important; }
    #eventos-lista .evt-desc { color: #555 !important; }
    #eventos-lista .evt-tempo { color: #999 !important; }
    .popup-evento-moderno .leaflet-popup-content-wrapper,
    .popup-evento-moderno .leaflet-popup-tip { background: #fff !important; color: #333 !important; }
    .popup-evento-rodape-aberto { margin-top: 76px !important; }
    .popup-evento-moderno .leaflet-popup-content { color: #333 !important; }
    .popup-evento-moderno .evt-popup-content div { color: #333 !important; }
    .popup-evento-moderno .evt-popup-address { background: #f8f9fa !important; border-color: #eee !important; }
    .popup-evento-moderno .evt-popup-maps-btn { background: #fff !important; color: #333 !important; border-color: #ccc !important; }
    .popup-evento-moderno .btn-primary { color: #fff !important; }
    .popup-evento-moderno .leaflet-popup-close-button { color: #333 !important; }
    .popup-evento-moderno .evt-popup-content h6 { border-bottom-color: #eee !important; }
    .dark-theme .btn-evt-periodo { background: #2d3748 !important; color: #adb5bd !important; border-color: #4a5568 !important; }
    .dark-theme .btn-evt-periodo.active { background: #2980b9 !important; color: #fff !important; border-color: #2980b9 !important; }
    .dark-theme #eventos-lista .evento-item { background: #111827 !important; border-color: #263244 !important; color: #e6edf3 !important; }
    .dark-theme #eventos-lista .evento-item:hover { background: var(--evt-hover-bg) !important; border-color: var(--evt-color) !important; }
    .dark-theme #eventos-lista .evt-desc { color: #f8fafc !important; }
    .dark-theme #eventos-lista .evt-tempo { color: #b8c1cc !important; }
    .dark-theme #eventos-vazio { color: #d7dde6 !important; }
    .dark-theme #eventos-vazio .fa { color: #d7dde6 !important; }
    .dark-theme #evt-tipo-btn, .dark-theme #evt-btn-notif, .dark-theme #evt-btn-limpar { background: #2d3748; color: #d7dde6; border: 1px solid #4a5568; }
    .dark-theme #evt-btn-notif.ativo { background: #f39c12 !important; color: #fff !important; border-color: #f39c12 !important; }
    .dark-theme #evt-btn-notif.ativo .fa { color: #fff !important; }
    .dark-theme .evt-tipo-dropdown { background: #1a202c; border-color: #2d3748; }
    .dark-theme .evt-tipo-item { color: #c9d1d9; }
    .dark-theme .evt-tipo-item:hover { background: #2d3748; }
    .card-veiculo .cv-apelido-row { position: absolute; left: 20px; right: 20px; bottom: 4px; min-height: 17px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
    .card-veiculo .cv-apelido-text { min-width: 0; max-width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 1.2; color: #4b5563; font-weight: 700; text-align: center; }
    .dark-theme .card-veiculo .cv-apelido-text { color: #d7dde6; }
    .card-veiculo .btn-editar-apelido { position: absolute; right: 6px; bottom: 6px; z-index: 6; width: 18px; height: 18px; border: 0; border-radius: 50%; background: #fab32c; color: #fff; display: inline-flex; align-items: center; justify-content: center; padding: 0; font-size: 9px; opacity: 0; transition: opacity .2s, background .15s; }
    .card-veiculo:hover .btn-editar-apelido { opacity: 1; }
    .card-veiculo .btn-editar-apelido:hover { background: #e0a025; }
    #modal-apelido-card .modal-content { border-radius: 8px; }
    html.dark-theme #modal-apelido-card .modal-content { background: #1f2937; color: #f8fafc; }
    html.dark-theme #modal-apelido-card .form-control { background: #111827; border-color: #374151; color: #f8fafc; }
    html.dark-theme .popup-evento-moderno .leaflet-popup-content-wrapper,
    html.dark-theme .popup-evento-moderno .leaflet-popup-tip,
    .dark-theme .popup-evento-moderno .leaflet-popup-content-wrapper,
    .dark-theme .popup-evento-moderno .leaflet-popup-tip { background: #0f172a !important; color: #f8fafc !important; }
    html.dark-theme .popup-evento-moderno .leaflet-popup-content,
    .dark-theme .popup-evento-moderno .leaflet-popup-content { color: #f8fafc !important; }
    html.dark-theme .popup-evento-moderno .evt-popup-content div,
    .dark-theme .popup-evento-moderno .evt-popup-content div { color: #f8fafc !important; }
    html.dark-theme .popup-evento-moderno .evt-popup-address,
    .dark-theme .popup-evento-moderno .evt-popup-address { background: #172033 !important; border-color: #334155 !important; }
    html.dark-theme .popup-evento-moderno .evt-popup-maps-btn,
    .dark-theme .popup-evento-moderno .evt-popup-maps-btn { background: #243044 !important; color: #f8fafc !important; border-color: #3d4b63 !important; }
    html.dark-theme .popup-evento-moderno .btn-primary,
    .dark-theme .popup-evento-moderno .btn-primary { color: #fff !important; }
    html.dark-theme .popup-evento-moderno .leaflet-popup-close-button,
    .dark-theme .popup-evento-moderno .leaflet-popup-close-button { color: #d7dde6 !important; }
    html.dark-theme .popup-evento-moderno .evt-popup-content h6,
    .dark-theme .popup-evento-moderno .evt-popup-content h6 { border-bottom-color: #334155 !important; }
  `;
  document.head.appendChild(style);
})();

function _corMarcador(v) {
  if (!v.posicao || v.status !== 'online') return '#fab32c'; // amarelo: offline ou sem dados
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
  const txt = _textoLabelVeiculo(v);
  return `<div style="padding:3px 8px;font-size:12px;font-weight:700;letter-spacing:0.5px">${txt}</div>`;
}

function _textoLabelVeiculo(v) {
  if (!v) return '';
  return [v.nome, v.placa].filter(Boolean).join(' | ') || v.dispositivoId || '';
}

function _bindLabelVeiculo(marker, texto) {
  if (!marker) return;
  if (marker.getTooltip()) {
    marker.closeTooltip();
    marker.unbindTooltip();
  }
  marker.bindTooltip(texto, {
    permanent: true,
    direction: 'top',
    className: 'label-veiculo label-veiculo-clean',
    offset: [0, -14],
  });
}

function _removerLabelVeiculo(marker) {
  if (!marker || !marker.getTooltip()) return;
  marker.closeTooltip();
  marker.unbindTooltip();
}

function _atualizarBindingsPopup() {
  _togglingPopup = true;
  Object.entries(marcadores).forEach(([id, m]) => {
    const v = veiculosMap[id];
    if (_overlay.labels && v) {
      _bindLabelVeiculo(m, _textoLabelVeiculo(v));
      if (id === ativoId) m.closeTooltip();
    } else {
      if (m.getTooltip()) { m.closeTooltip(); m.unbindTooltip(); }
    }
    if (_mostrarPopup && v) {
      m.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 180 });
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
  if (el) el.innerHTML = ``;
}

function renderBuscaResultados() {
  const filtro = (document.getElementById('filtro').value || '').toLowerCase().trim();
  const el = document.getElementById('lista-resultados-busca');
  if (!el) return;
  if (!filtro) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const filtrados = Object.values(veiculosMap).filter(v =>
    v.nome.toLowerCase().includes(filtro) ||
    (v.placa && v.placa.toLowerCase().includes(filtro)) ||
    (v.apelidoCliente && v.apelidoCliente.toLowerCase().includes(filtro)) ||
    (v.cliente?.nome?.toLowerCase().includes(filtro))
  ).slice(0, 8);

  if (!filtrados.length) { el.innerHTML = '<div style="padding:12px;text-align:center;color:#aaa;font-size:12px">Nenhum resultado.</div>'; el.style.display = 'block'; return; }

  filtrados.sort((a, b) => pesoStatus(a) - pesoStatus(b));
  el.innerHTML = filtrados.map(v => {
    const p = v.posicao;
    const apelido = v.apelidoCliente ? `<span style="color:#fab32c;font-size:11px;font-weight:700;">&nbsp;· ${esc(v.apelidoCliente)}</span>` : '';
    return `<div class="veiculo-item${v.dispositivoId === ativoId ? ' ativo' : ''}" onclick="selecionarDaBusca('${v.dispositivoId}')">
      <div class="v-nome">${v.nome}${v.placa ? `&nbsp;<span class="v-placa">${v.placa}</span>` : ''}${apelido}</div>
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
      if (e.target.closest('.btn-upload-foto, .btn-editar-apelido')) return;
      focarCliente(this.dataset.did);
    });
  });
  barra.querySelectorAll('.btn-upload-foto').forEach(function (btn) {
    bindUploadFoto(btn.closest('.card-veiculo'));
  });
  barra.querySelectorAll('.btn-editar-apelido').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      abrirModalApelidoCard(this.closest('.card-veiculo')?.dataset.did);
    });
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

  //const isOnline = v.status === 'online';
  //const isMoving = isOnline && v.posicao?.emMovimento;
  //const statusTxt = isMoving ? `${v.posicao?.velocidade ?? 0} km/h` : isOnline ? 'Parado' : 'Offline';
  //const dotCls = isMoving ? 'dot-moving' : isOnline ? 'dot-online' : 'dot-offline';
  const marcaModelo = [v.marca, v.modeloVeiculo].filter(Boolean).join(' ');
  const apelido = _getCardApelido(v.dispositivoId);

  return `<div class="card-veiculo${v.dispositivoId === ativoId ? ' ativo' : ''}" data-did="${v.dispositivoId}" style="position:relative">
    <div class="btn-foto-wrap">
      ${mediaHtml}
    </div>
    <button type="button" class="btn-upload-foto" title="Alterar foto" style="position:absolute;top:6px;right:6px;z-index:6"><i class="fa fa-camera"></i></button>
    ${v.placa ? `<span class="cv-placa">${v.placa}</span>` : ''}
    <span class="cv-modelo" title="${marcaModelo || v.nome}">${marcaModelo || v.nome}</span>
    <div class="cv-apelido-row">
      <span class="cv-apelido-text" title="${esc(apelido)}">${apelido ? esc(apelido) : '&nbsp;'}</span>
    </div>
    <button type="button" class="btn-editar-apelido" title="Editar identificação"><i class="fa fa-pencil"></i></button>
  </div>`;
}

function garantirModalApelidoCard() {
  if (document.getElementById('modal-apelido-card')) return;
  const modal = document.createElement('div');
  modal.className = 'modal fade';
  modal.id = 'modal-apelido-card';
  modal.tabIndex = -1;
  modal.innerHTML = `
    <div class="modal-dialog modal-sm">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal">&times;</button>
          <h4 class="modal-title">Identificação do veículo</h4>
        </div>
        <div class="modal-body">
          <input type="hidden" id="modal-apelido-card-did">
          <input type="text" id="modal-apelido-card-texto" class="form-control" maxlength="40" placeholder="Nome da pessoa">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-default" data-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btn-salvar-apelido-card"><i class="fa fa-save"></i> Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('btn-salvar-apelido-card').addEventListener('click', salvarApelidoCard);
  document.getElementById('modal-apelido-card-texto').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') salvarApelidoCard();
  });
}

window.abrirModalApelidoCard = function (dispositivoId) {
  if (!dispositivoId) return;
  garantirModalApelidoCard();
  document.getElementById('modal-apelido-card-did').value = dispositivoId;
  document.getElementById('modal-apelido-card-texto').value = _getCardApelido(dispositivoId);
  $('#modal-apelido-card').modal('show');
  setTimeout(() => document.getElementById('modal-apelido-card-texto')?.focus(), 180);
};

function salvarApelidoCard() {
  const did = document.getElementById('modal-apelido-card-did')?.value;
  if (!did) return;
  const texto = document.getElementById('modal-apelido-card-texto')?.value || '';
  const btn = document.getElementById('btn-salvar-apelido-card');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...'; }
  AL_CLIENTE.apiPatch(`/api/cliente/dispositivos/${did}/apelido`, { apelidoCliente: texto })
    .then(function (data) {
      if (veiculosMap[did]) veiculosMap[did].apelidoCliente = data.apelidoCliente || '';
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.values(veiculosMap))); } catch (e) {}
      atualizarCardBarra(did);
      $('#modal-apelido-card').modal('hide');
      AL_CLIENTE.showAlert('Identificação atualizada.', 'success');
    })
    .catch(function (err) { AL_CLIENTE.showAlert(err.message); })
    .finally(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    });
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
  const apelidoEl = card.querySelector('.cv-apelido-text');
  if (apelidoEl) {
    const apelido = _getCardApelido(did);
    apelidoEl.innerHTML = apelido ? esc(apelido) : '&nbsp;';
    apelidoEl.title = apelido;
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

function buildStatusHtmlCliente(p, bat, batFa, batCor, v) {
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

function buildOleoStatusHtml(p, v) {
  if (!p || p.odometro == null) return '';
  const recs = v?._recorrencias;
  if (!recs || !recs.length) return '';
  const podeGerenciar = !!v?.podeGerenciarManutencao;
  const odoKm = p.odometro / 1000;
  const isDark = document.documentElement.classList.contains('dark-theme');
  const btnBg = isDark ? '#2d3748' : '#e9ecef';
  const btnBd = isDark ? '#4a5568' : '#ccc';
  const btnClr = isDark ? '#cbd5e0' : '#555';
  const btnStyle = `background:${btnBg};border:1px solid ${btnBd};border-radius:4px;padding:2px 6px;cursor:pointer;color:${btnClr};font-size:10px;line-height:1;`;
  const visibles = recs.filter(r => {
    const kmPercorrido = odoKm - r.kmBase;
    const kmRestante = Math.round(r.intervaloKm - kmPercorrido);
    return kmRestante <= 100; // shows when ≤100km remaining OR past due
  });
  if (!visibles.length) return '';
  return visibles.map(r => {
    const kmPercorrido = odoKm - r.kmBase;
    const kmRestante = Math.round(r.intervaloKm - kmPercorrido);
    const pastDue = kmRestante < 0;
    const kmAbs = Math.abs(kmRestante);
    const cor = pastDue ? '#e74c3c' : '#f39c12';
    const texto = pastDue
      ? `Ultrapassou ${kmAbs.toLocaleString('pt-BR')} kms da(o) ${r.titulo}`
      : `Faltam ${kmAbs.toLocaleString('pt-BR')} kms para ${r.titulo}`;
    const btn = podeGerenciar ? `<button onclick="abrirModalFeitoCard('${r.id}','${r.titulo.replace(/'/g, "\\'")}')" style="${btnStyle};margin-left:4px;" title="Marcar como feito"><i class="fa fa-check"></i></button>` : '';
    return `<span style="color:${cor};display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-bottom:2px;"><i class="fa fa-wrench" style="flex-shrink:0;"></i>${texto}${btn}</span>`;
  }).join('<br>');
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

function _carregarKmConfig(id) {
  const v = veiculosMap[id]; if (!v) return;
  if (v._recorrenciasCarregadas) return;
  v._recorrenciasCarregadas = true;
  AL_CLIENTE.apiGet('/api/cliente/manutencoes/recorrencias?dispositivoId=' + id).then(function (data) {
    v._recorrencias = (data || []).filter(function(r) { return r.ativa !== false; });
    const elOleo = document.getElementById('dcard-oleo-status');
    if (elOleo && ativoId === id) elOleo.innerHTML = buildOleoStatusHtml(v.posicao, v);
  }).catch(function () { v._recorrenciasCarregadas = false; });
}

window.abrirModalFeitoCard = function(recId, titulo) {
  const el = document.getElementById('modal-feito-card-titulo');
  if (el) el.textContent = titulo || 'esta manutenção';
  const btn = document.getElementById('btn-modal-feito-card-confirmar');
  if (btn) btn.onclick = function() { window._executarFeitoCard(recId); };
  $('#modalFeitoCard').modal('show');
};

window._executarFeitoCard = function(recId) {
  $('#modalFeitoCard').modal('hide');
  AL_CLIENTE.apiPost('/api/cliente/manutencoes/recorrencias/' + recId + '/feito', {})
    .then(function() {
      AL_CLIENTE.showAlert('Manutenção confirmada! Contador reiniciado.', 'success');
      if (ativoId) {
        const v = veiculosMap[ativoId];
        if (v) { v._recorrenciasCarregadas = false; _carregarKmConfig(ativoId); }
      }
    })
    .catch(function(err) { AL_CLIENTE.showAlert('Erro: ' + (err.message || 'tente novamente.')); });
};


function mostrarCardDispositivo(id) {
  const v = veiculosMap[id]; if (!v) return;
  ativoId = id;
  _salvarFocoCliente(id);
  _carregarKmConfig(id);
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
  const cachedAddr = hasCached ? _geocodeCache[cacheKey] : null;
  const addrTxt = hasCached ? (cachedAddr || `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`) : (p ? 'Buscando...' : '—');

  const imgHtml = v.imagemUrlCliente
    ? `<img src="${API_BASE}${v.imagemUrlCliente}" style="width:100%;height:130px;object-fit:cover;display:block;border-radius:12px 12px 0 0" onerror="this.style.display='none'" />`
    : '';

  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';
  const horasHtml = `
    <div class="dcard-section dcard-val" style="font-size:10px">
      <div class="dcard-section-title">Última Atualização</div>
      ${p ? `
        <div style="margin-bottom:2px; margin-left:-4px"><i class="fa fa-mobile" style="${ico}"></i> <span style="margin-left:-2px" class="dcard-lbl">Dispositivo:</span> <span id="dcard-ts-dev">${fmtGPSTimeSec(p.deviceTime)}</span></div>
      ` : ''}
    </div>`;

  const card = document.getElementById('device-detail-card');
  card.innerHTML = `
    <div id="tracking-drawer-handle"></div>
    ${imgHtml}
    <div class="dcard-header">
      <div style="flex:1;min-width:0">
        <div class="v-nome" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${v.nome}
          ${v.placa ? `<span class="v-placa" style="margin:0">${v.placa}</span>` : ''}
        </div>
      </div>
      <button class="dcard-fechar" onclick="fecharCardDispositivo()" title="Fechar">×</button>
    </div>
    <div class="dcard-body">
      <div class="dcard-section-title">Informações do Dispositivo</div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:4px">
        <div id="dcard-status" style="font-size:12px;display:flex;flex-direction:column;gap:3px;flex:1;min-width:0">${buildStatusHtmlCliente(p, bat, batFa, batCor, v)}</div>
        <div id="dcard-velocimetro" style="flex-shrink:0;margin-top:-4px">${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}</div>
      </div>
      <div id="dcard-oleo-status" style="margin-bottom:6px">${buildOleoStatusHtml(p, v)}</div>
      <div id="dcard-horas">${horasHtml}</div>
      ${p ? `<div class="dcard-section dcard-val" style="line-height:1.4">
        <div class="dcard-section-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          Endereço
          <div style="display:flex;gap:4px">
            ${_htmlBotaoGoogleMaps(p.latitude, p.longitude, hasCached ? cachedAddr : null)}
            ${_htmlBotaoStreetView(p.latitude, p.longitude)}
          </div>
        </div>
        <div id="${addrId}" style="font-size:11px">${addrTxt}</div>
      </div>` : ''}
      <div id="dcard-comandos-${id}" class="dcard-section" style="display:none;padding-top:12px;border-top:1px solid rgba(128,128,128,0.1)">
        <div id="dcard-comandos-grid-${id}" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
      </div>
      ${_htmlAcoesCard(id)}
      <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
        <div class= "dcard-section-title-title">RESUMO DE HOJE</div>
        <div id="dcard-resumo-hoje-${id}"><div style="font-size:11px;color:#999;text-align:center;padding:6px 0">Carregando...</div></div>
        <div style="margin-top:10px">
          <button onclick="abrirOverlay('${id}', 'historico')" class="btn btn-xs btn-warning" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;width:100%;text-align:center;">
            <i class="fa fa-history"></i> Ver Mais
          </button>
        </div>
      </div>
    </div>
  `;
  
  card.style.display = 'flex';
  _fecharTrackingDrawer();
  _prepararTrackingDrawer();
  _ajustarAlturaCardDispositivo();
  if (p && !hasCached) geocodificarCoordenadas(p.latitude, p.longitude, addrId);
  _carregarResumoHojeCliente(id);

  // Verifica cercas para ativar o botão visualmente
  AL_CLIENTE.apiGet(`/api/cliente/rastreamento/dispositivos/${id}/cercas`).then(cercas => {
    const btnCerca = card.querySelector('.dcard-acao[data-acao="cerca"]');
    if (btnCerca) btnCerca.classList.toggle('ativo', !!(cercas && cercas.length > 0));
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
    if (tipo === 'engineStop' || tipo === 'engineResume') {
      const evtTipo = tipo === 'engineStop' ? 'deviceLocked' : 'deviceUnlocked';
      adicionarEvento({
        dispositivoId: did,
        tipo: evtTipo,
        tipoLabel: tipo === 'engineStop' ? 'Veículo Bloqueado' : 'Veículo Desbloqueado',
        serverTime: new Date().toISOString(),
        lat: veiculosMap[did]?.posicao?.latitude ?? null,
        lng: veiculosMap[did]?.posicao?.longitude ?? null,
      });
    }
  } catch (err) { AL_CLIENTE.showAlert('Erro: ' + err.message, 'danger'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; } }
};

window.fecharCardDispositivo = function (skipClosePopup) {
  if (_overlay.labels && ativoId && marcadores[ativoId]) {
    const mf = marcadores[ativoId];
    const v = veiculosMap[ativoId];
    if (v) _bindLabelVeiculo(mf, _textoLabelVeiculo(v));
    if (mf.getTooltip()) mf.openTooltip();
  }
  if (modoFoco) desativarFoco();
  _cancelarDesenhoCirculo();
  const detailCard = document.getElementById('device-detail-card');
  detailCard.classList.remove('drawer-aberta');
  detailCard.style.display = 'none';
  _trackingDrawerAberta = false;
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
    elStatus.innerHTML = `<i class="fa fa-circle" style="font-size:8px;vertical-align:middle"></i> ${txtStatus}${desde ? ` — há ${fmtTempoDecorridoMs(desde)}` : ''}`;
  }
  const elStatusWarning = document.getElementById('dcard-status-warning');
  if (elStatusWarning) {
    elStatusWarning.innerHTML = !p ? '&nbsp;<span style="color:#e67e22;font-size:10px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : '';
  }
  const elVel = document.getElementById('dcard-velocimetro');
  if (elVel) elVel.innerHTML = p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : '';
  const elStatusItems = document.getElementById('dcard-status');
  if (elStatusItems) {
    const bat2 = p?.bateria_nivel != null ? p.bateria_nivel : null;
    const batCor2 = bat2 >= 40 ? '#27ae60' : bat2 >= 20 ? '#f39c12' : '#e74c3c';
    const batFa2 = bat2 >= 80 ? 'fa-battery-full' : bat2 >= 60 ? 'fa-battery-3' : bat2 >= 40 ? 'fa-battery-2' : bat2 >= 20 ? 'fa-battery-1' : 'fa-battery-0';
    elStatusItems.innerHTML = buildStatusHtmlCliente(p, bat2, batFa2, batCor2, v);
    const elOleo = document.getElementById('dcard-oleo-status');
    if (elOleo) elOleo.innerHTML = buildOleoStatusHtml(p, v);
  }
  const tsSrv = document.getElementById('dcard-ts-srv'), tsDev = document.getElementById('dcard-ts-dev'), tsGps = document.getElementById('dcard-ts-gps');
  if (tsSrv && p) tsSrv.textContent = fmtGPSTimeSec(p.serverTime);
  if (tsDev && p) tsDev.textContent = fmtGPSTimeSec(p.deviceTime);
  if (tsGps && p) tsGps.textContent = fmtGPSTimeSec(p.fixTime);

  if (modoFoco && v?.posicao) {
    const trackOff = _eventoPopupAtualIdx !== null ? _eventPopupOffsetPx : 0;
    const barraWrap = document.getElementById('barra-veiculos-wrap');
    const barraExpandida = !!document.getElementById('barra-veiculos')?.classList.contains('expandida');
    const trackOffY = (_eventoPopupAtualIdx !== null && barraExpandida) ? Math.round((barraWrap?.offsetHeight || 80) / 2) : 0;
    map.panTo(_latLngComOffset(v.posicao, trackOff, 16, trackOffY), { animate: true, duration: 0.5 });
  }
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
  return `<svg width="90" height="54" viewBox="0 0 90 54" style="display:block;margin:0"><path d="M 10 45 A 30 30 0 0 1 70 45" fill="none" stroke="${tr}" stroke-width="7" stroke-linecap="round"/>${arc}<text x="40" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="${nc}">${vel}</text><text x="40" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="${lc}">km/h</text></svg>`;
}

function fmtGPSTimeSec(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const tz = 'America/Sao_Paulo';
  return d.toLocaleDateString('pt-BR', { timeZone: tz }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz });
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

  const updateLink = (endereco) => {
    const btnMaps = document.getElementById(`btn-maps-${lat}-${lng}`);
    if (btnMaps) btnMaps.href = _urlGoogleMaps(lat, lng, endereco);
  };
  const hideCoords = () => {
    const coordsEl = document.getElementById(elementId + '-coords');
    if (coordsEl) coordsEl.style.display = 'none';
  };

  if (ck in _geocodeCache) {
    const end = _geocodeCache[ck];
    el.innerHTML = `<i class="fa fa-map-marker"></i> ${end || coords}`;
    if (end) hideCoords();
    updateLink(end);
    return;
  }
  try {
    const data = await AL_CLIENTE.apiGet(`/api/cliente/rastreamento/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`);
    const end = data.endereco || '';
    _geocodeCache[ck] = end;
    el.innerHTML = `<i class="fa fa-map-marker"></i> ${end || coords}`;
    if (end) hideCoords();
    updateLink(end);
  } catch { el.innerHTML = `<i class="fa fa-map-marker"></i> ${coords}`; updateLink(null); }
};

function ativarFoco(id) {
  modoFoco = true; _fecharSpider();
  Object.values(_clusterBadges).forEach(b => { if (map.hasLayer(b)) map.removeLayer(b); });
  Object.keys(marcadores).forEach(mid => { if (mid !== id && map.hasLayer(marcadores[mid])) map.removeLayer(marcadores[mid]); });
  if (!marcadores[id]) renderMarcadores();
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

window.focar = function (did, opts = {}) {
  const prevAtivoId = ativoId;
  _salvarFocoCliente(did);
  mostrarCardDispositivo(did); moverCardParaInicio(did);

  if (_overlay.labels && prevAtivoId && prevAtivoId !== did && marcadores[prevAtivoId]) {
    const mp = marcadores[prevAtivoId];
    const vp = veiculosMap[prevAtivoId];
    if (vp) _bindLabelVeiculo(mp, _textoLabelVeiculo(vp));
    if (mp.getTooltip()) mp.openTooltip();
  }
  if (_overlay.labels && marcadores[did]) {
    _removerLabelVeiculo(marcadores[did]);
  }

  document.querySelectorAll('.card-veiculo').forEach(el => el.classList.toggle('ativo', el.dataset.did === did));
  const v = veiculosMap[did]; if (!v?.posicao) return;
  ativarFoco(did);
  if (_overlay.labels) _removerLabelVeiculo(marcadores[did]);
  _centralizarDispositivo(v.posicao, 16, opts.offsetPx || 0, true, opts.offsetY || 0);
  setTimeout(() => {
    if (opts.abrirPopup === false) return;
    if (_mostrarPopup && marcadores[did] && map.hasLayer(marcadores[did])) {
      const marker = marcadores[did];
      const className = marker.getPopup()?.options?.className || '';
      if (className.includes('popup-evento-moderno')) {
        _restaurarPopupVeiculoCliente(did);
      }
      marker.openPopup();
    }
  }, 900);
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
  if (tipo === 'relatorio') {
    window.location.href = `relatorio.html?id=${encodeURIComponent(did)}`;
    return;
  }
  document.getElementById('overlay-titulo').textContent = `${v.nome}${v.placa ? ` — ${v.placa}` : ''}`;
  const base = window.location.href.replace(/\/cliente\/rastreamento\.html.*/, '');
  const token = AL_CLIENTE.getToken();
  let iframeSrc = `${base}/cliente/detalhe-iframe.html?id=${did}&token=${token}&modo=historico`;
  const btnExportar = document.getElementById('btn-overlay-exportar');
  if (btnExportar) btnExportar.style.display = tipo === 'relatorio' ? 'inline-flex' : 'none';
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

        const notificar = document.getElementById('cerca-notificar')?.checked;
        if (notificar && devId) {
          await AL_CLIENTE.apiPost('/api/cliente/notificacoes/preferencias', {
            dispositivoId: devId,
            preferencias: {
              geofenceEnter: { web: true, app: true, email: true },
              geofenceExit:  { web: true, app: true, email: true },
            },
          }).catch(() => {});
        }

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
  if (acao === 'seguir') {
    const v = veiculosMap[dispositivoId];
    if (!v?.posicao) {
      AL_CLIENTE.showAlert('Posição do veículo indisponível.', 'warning');
      return;
    }
    ativarFoco(dispositivoId);
    _centralizarDispositivo(v.posicao, 16, 0, true);
    return;
  }
  if (acao === 'rota') { ativarRota(dispositivoId); return; }
  if (acao === 'compartilhar') { compartilharDispositivoCliente(dispositivoId); return; }
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
      <div class= "dcard-section-title-title">AÇÕES</div>
      <div style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap">
        <button class="dcard-acao" data-acao="seguir" onclick="acaoDispositivoCliente('seguir','${dispositivoId}')" title="Seguir veículo">
          <span class="dcard-acao-icon"><i class="fa fa-location-arrow"></i></span>
          <span>Seguir</span>
        </button>
        <button class="dcard-acao${rotaAtiva ? ' ativo' : ''}" data-acao="rota" onclick="acaoDispositivoCliente('rota','${dispositivoId}')" title="Rota">
          <span class="dcard-acao-icon"><i class="fa fa-road"></i></span>
          <span>Rota</span>
        </button>
        <button class="dcard-acao" data-acao="compartilhar" onclick="acaoDispositivoCliente('compartilhar','${dispositivoId}')" title="Compartilhar link de acompanhamento">
          <span class="dcard-acao-icon"><i class="fa fa-share-alt"></i></span>
          <span>Compartilhar</span>
        </button>
        <button class="dcard-acao" data-acao="cerca" onclick="acaoDispositivoCliente('cerca','${dispositivoId}')" title="Criar Cerca">
          <span class="dcard-acao-icon"><i class="fa fa-circle-o"></i></span>
          <span>Cerca</span>
        </button>
      </div>
    </div>`;
}

async function compartilharDispositivoCliente(dispositivoId) {
  const btn = document.querySelector('.dcard-acao[data-acao="compartilhar"]');
  if (btn) { btn.disabled = true; btn.querySelector('i').className = 'fa fa-spinner fa-spin'; }
  try {
    const data = await AL_CLIENTE.apiPost('/api/compartilhamento/gerar', { dispositivoId });
    const siteBase = window.location.pathname.replace(/\/(?:admin|cliente|colaborador)\/[^/]+$/, '/');
    const link = `${window.location.origin}${siteBase}rastreamento-publico.html?token=${data.token}`;
    try {
      await navigator.clipboard.writeText(link);
      AL_CLIENTE.showAlert('Link de acompanhamento copiado!', 'success');
    } catch {
      prompt('Copie o link de acompanhamento:', link);
    }
  } catch (err) {
    AL_CLIENTE.showAlert('Erro ao gerar link: ' + (err.message || 'Tente novamente.'), 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('i').className = 'fa fa-share-alt'; }
  }
}

setInterval(() => { AL_CLIENTE.apiGet('/api/cliente/rastreamento/status-acesso').catch(() => {}); }, 60000);

window.fecharOverlay = function () {
  document.getElementById('overlay-historico').classList.remove('ativo');
  document.getElementById('overlay-iframe').src = '';
  const btnExportar = document.getElementById('btn-overlay-exportar');
  if (btnExportar) btnExportar.style.display = 'none';
  if (history.state?.overlay) history.back();
};

window.addEventListener('popstate', (e) => {
  const overlay = document.getElementById('overlay-historico');
  if (overlay && overlay.classList.contains('ativo')) {
    overlay.classList.remove('ativo');
    const btnExportar = document.getElementById('btn-overlay-exportar');
    if (btnExportar) btnExportar.style.display = 'none';
  }
});

