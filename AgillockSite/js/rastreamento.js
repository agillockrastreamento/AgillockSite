'use strict';

let map;
const marcadores = {};
const _clusterBadges = {};
const _clusterGrupos = {};
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
const _estadoSince = {};

const _spider = { markers: [], linhas: [], chave: null };

// ── Camadas de overlay ────────────────────────────────────────────────────────
const _overlay = {
  alarmes: true,    // mostrar badge de alarme sobre dispositivos
  labels: true,     // mostrar placa/nome sobre dispositivos
  cercas: false,    // mostrar cercas geovirtual
  rastro: false,    // mostrar rastro da última hora
};

// Rastros: dispositivoId → { linha: L.Polyline, setas: L.Marker[] }
const _rastros = {};

// Marcadores de alarme: dispositivoId → L.Marker (badge flutuante)
const _alarmeBadges = {};

// Cercas: geofenceId → { camada: L.Layer, dados: {...} }
const _cercasLayer = {};
let _cercasCarregadas = false;
// IDs Traccar das cercas que o admin tem permissão de ver (filtra eventos WS)
let _cercasPermitidas = new Set();

// Modo desenho de cerca
let _modoDesenho = null; // null | { dispositivoId, etapa: 'centro'|'confirmar', circle, center }

// Rota individual: dispositivoId → { linha: L.Polyline, setas: L.Marker[] }
const _rotasIndividuais = {};

// Modal de comando
let _cmdDispositivoId = null;
let _medidoresDispositivoId = null;
const _usuarioRastreamento = (window.AL && typeof window.AL.getUser === 'function') ? window.AL.getUser() : null;
const _podeEditarMedidores = !!(_usuarioRastreamento && _usuarioRastreamento.role === 'ADMIN');
const _cardAdminExpandido = _podeEditarMedidores;
const _cardFocusOffsetPx = _cardAdminExpandido ? 310 : 0;
const _focusOffsetPx = 0;
const _eventPopupOffsetPx = 70;
const _detalheDispositivoCache = {};
const _detalheDispositivoPendentes = {};
const _detalheAtributosThrottle = {};
const _resumoHojeCache = {};
const _resumoHojePendentes = {};
const _ociosoHojeCache = {};
const _ociosoHojePendentes = {};
const _manutencoesAdminCache = {};
const _manutencoesAdminPendentes = {};
const _manutencoesDataAdminCache = {};
const _manutencoesDataAdminPendentes = {};
const ADMIN_FOCUS_STORAGE_KEY = 'rastreamento_admin_foco';
let _attrsTrayOpen = false;
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
const ATTR_INFO_CARD = {
  ignition: ['ignition', 'Ignição'],
  motion: ['motion', 'Em movimento'],
  alarm: ['alarm', 'Alarme'],
  blocked: ['blocked', 'Bloqueado'],
  charge: ['charge', 'Carregando'],
  rssi: ['rssi', 'Sinal GSM (dBm)'],
  sat: ['sat', 'Satélites GPS'],
  power: ['power', 'Tensão veículo (V)'],
  battery: ['battery', 'Tensão bateria (V)'],
  batteryLevel: ['batteryLevel', 'Nível bateria (%)'],
  distance: ['distance', 'Distância segmento (m)'],
  totalDistance: ['totalDistance', 'Odômetro total (m)'],
  hours: ['hours', 'Horas de motor (ms)'],
  fuel: ['fuel', 'Combustível'],
  fuelUsed: ['fuelUsed', 'Combustível gasto'],
  input: ['input', 'Entrada digital'],
  output: ['output', 'Saída digital'],
  driverUniqueId: ['driverUniqueId', 'ID Motorista'],
  pdop: ['pdop', 'PDOP'],
  hdop: ['hdop', 'HDOP'],
  vdop: ['vdop', 'VDOP'],
  index: ['index', 'Índice de mensagem'],
  protocol: ['protocol', 'Protocolo'],
  deviceId: ['deviceId', 'ID Dispositivo (Traccar)'],
  raw: ['raw', 'Dados brutos'],
  result: ['result', 'Resultado de comando'],
};

function _intervaloHoje() {
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1000);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

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
    const ignorar = e.target.closest('#device-detail-card, .leaflet-control, .admin-topbar, #eventos-panel, #dlg-cerca, .modal, .modal-backdrop');
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

function _salvarFocoAdmin(dispositivoId) {
  if (!dispositivoId) return;
  try { sessionStorage.setItem(ADMIN_FOCUS_STORAGE_KEY, dispositivoId); } catch {}
}

function _limparFocoAdmin() {
  try { sessionStorage.removeItem(ADMIN_FOCUS_STORAGE_KEY); } catch {}
}

function _obterFocoAdminPendente() {
  const focusUrl = new URLSearchParams(window.location.search).get('focus');
  if (focusUrl) return focusUrl;
  try { return sessionStorage.getItem(ADMIN_FOCUS_STORAGE_KEY); } catch { return null; }
}

function _restaurarFocoAdmin() {
  if (ativoId) return;
  const dispositivoId = _obterFocoAdminPendente();
  if (!dispositivoId || !veiculosMap[dispositivoId]) return;
  focar(dispositivoId);
}

function _urlDetalheRastreamentoAdmin(dispositivoId) {
  const back = `rastreamento.html?focus=${encodeURIComponent(dispositivoId)}`;
  return `rastreamento-detalhe.html?id=${encodeURIComponent(dispositivoId)}&back=${encodeURIComponent(back)}`;
}

function _aplicarEstadoTrayAtributos() {
  const attrsCard = document.getElementById('device-attrs-card');
  const sideToggle = document.getElementById('dcard-tray-side-toggle');
  if (!attrsCard) return;
  const cardAberto = !!(ativoId && document.getElementById('device-detail-card')?.style.display !== 'none');
  const aberta = !!(_cardAdminExpandido && cardAberto && ativoId && _attrsTrayOpen);
  attrsCard.classList.toggle('aberto', aberta);
  attrsCard.style.display = aberta ? 'block' : 'none';
  if (sideToggle) {
    sideToggle.style.display = _cardAdminExpandido && cardAberto && ativoId && !aberta ? 'inline-flex' : 'none';
    _posicionarBotaoTrayAtributos();
  }
}

function _posicionarBotaoTrayAtributos() {
  const card = document.getElementById('device-detail-card');
  const sideToggle = document.getElementById('dcard-tray-side-toggle');
  if (!card || !sideToggle || sideToggle.style.display === 'none') return;
  const alturaBotao = sideToggle.offsetHeight || 56;
  sideToggle.style.top = `${card.offsetTop + Math.max(18, (card.offsetHeight / 2) - (alturaBotao / 2))}px`;
  sideToggle.style.left = `${card.offsetLeft + card.offsetWidth - 2}px`;
}

window.toggleAtributosTray = function () {
  if (!_cardAdminExpandido || !ativoId) return;
  _attrsTrayOpen = !_attrsTrayOpen;
  if (_attrsTrayOpen) _carregarAtributosCard(ativoId, false);
  _aplicarEstadoTrayAtributos();
  const v = veiculosMap[ativoId];
  if (modoFoco && v?.posicao) {
    map.panTo(_latLngComOffset(v.posicao), { animate: true, duration: 0.35 });
  }
};

// ── Eventos ───────────────────────────────────────────────────────────────────
const TIPOS_EVENTO_ADMIN = [
  { tipo: 'commandResult',  label: 'Resultado do Comando',       css: 'tipo-command'  },
  { tipo: 'commandQueued',  label: 'Comando na Fila/Enviado',    css: 'tipo-command'  },
  { tipo: 'ignitionOn',     label: 'Ignição Ligada',             css: 'tipo-ignition' },
  { tipo: 'ignitionOff',    label: 'Ignição Desligada',          css: 'tipo-ignition' },
  { tipo: 'deviceOverspeed',label: 'Excedido o Limite de Velocidade', css: 'tipo-overspeed' },
  { tipo: 'powerCut',       label: 'Alimentação Cortada',        css: 'tipo-alarm' },
  { tipo: 'deviceLocked',   label: 'Veículo Bloqueado',          css: 'tipo-alarm' },
  { tipo: 'deviceUnlocked', label: 'Veículo Desbloqueado',       css: 'tipo-ignition' },
  { tipo: 'deviceFuelDrop', label: 'Queda de Combustível',       css: 'tipo-fuel'     },
  { tipo: 'deviceFuelIncrease', label: 'Aumento de Combustível', css: 'tipo-fuel'     },
  { tipo: 'geofenceEnter',  label: 'Entrada na Zona de Segurança',   css: 'tipo-geofence' },
  { tipo: 'geofenceExit',   label: 'Saída da Zona de Segurança',     css: 'tipo-geofence' },
  { tipo: 'alarm',          label: 'Alarme',                     css: 'tipo-alarm'    },
  { tipo: 'textMessage',    label: 'Mensagem de Texto Recebida', css: 'tipo-text'     },
  { tipo: 'driverChanged',  label: 'Condutor Alterado',          css: 'tipo-driver'   },
  { tipo: 'manutencaoAlerta',       label: 'Alerta de Manutenção',        css: 'tipo-fuel'      },
  { tipo: 'manutencaoAtrasada',     label: 'Manutenção Atrasada',         css: 'tipo-overspeed' },
  { tipo: 'kmExcedida',             label: 'Km Excedida (Período)',       css: 'tipo-overspeed' },
  { tipo: 'kmReduzida',             label: 'Km Reduzida (Período)',       css: 'tipo-geofence'  },
  { tipo: 'manutencaoFeita',        label: 'Manutenção Realizada',        css: 'tipo-ignition'  },
  { tipo: 'recorrenciaDataAlerta',   label: 'Alerta de Recorrência Data',  css: 'tipo-fuel'      },
  { tipo: 'recorrenciaDataNaoFeita', label: 'Recorrência Data Atrasada',   css: 'tipo-overspeed' },
  { tipo: 'recorrenciaDataFeita',    label: 'Recorrência Data Realizada',  css: 'tipo-ignition'  },
];
const TIPOS_EVENTO_ADMIN_FILTRO = TIPOS_EVENTO_ADMIN
  .filter(t => t.tipo !== 'manutencao')
  .map(t => t.tipo === 'deviceOverspeed' ? { ...t, tipo: 'overspeed' } : t);

// Filtros ativos (null = todos)
let _evtFiltros = new Set(); // vazio = sem filtro de tipo
let _evtNotif = true;        // notificação sonora ativa

// Lista de eventos recebidos: { dispositivoId, tipo, tipoLabel, serverTime, lat, lng, positionId }
let _evtPlacaFiltro = '';
const _eventos = [];
const MAX_EVENTOS = 200;
const EVENTOS_PANEL_STORAGE_KEY = 'rastreamento_admin_eventos_min';
let _eventoPopupAtualIdx = null;

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  inicializarMapa();
  _aplicarPreferenciasOverlay();
  carregarUltimaLeituraAdmin().finally(function () { inicializarEventosPanel(); });
  carregarPosicoes();
  _instalarMobileOutsideClick();
  document.getElementById('filtro').addEventListener('input', renderBuscaResultados);

  new MutationObserver(function () {
    if (ativoId) mostrarCardDispositivo(ativoId);
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

  // Modal de comando — fechar
  document.getElementById('btn-fechar-modal-cmd').addEventListener('click', fecharModalComando);
  document.getElementById('modal-cmd-overlay').addEventListener('click', function (e) {
    if (e.target === this) fecharModalComando();
  });
  document.getElementById('btn-enviar-cmd').addEventListener('click', enviarComandoDoModal);
  document.getElementById('cmd-tipo-select').addEventListener('change', function () {
    document.getElementById('btn-enviar-cmd').disabled = !this.value;
    const isCustom = this.value === 'custom';
    const wrap = document.getElementById('cmd-custom-wrap');
    if (wrap) { wrap.style.display = isCustom ? 'block' : 'none'; }
  });

  inicializarModalMedidores();
});

// ── Painel de Eventos — inicialização ─────────────────────────────────────────

let _panelAbertoAdmin = false;

let _ultimaLeituraAdmin = 0;
let _eventosLimposAteAdmin = 0;
let _eventosLimposRangesAdmin = [];
let _periodoEventosAdmin = { periodo: 'hoje', de: null, ate: null };
let _adminNotifPrefs = {};

async function carregarUltimaLeituraAdmin() {
  try {
    _ultimaLeituraAdmin = parseInt(localStorage.getItem('al_last_notif_admin') || '0', 10) || 0;
    _eventosLimposAteAdmin = parseInt(localStorage.getItem('al_clear_notif_admin') || '0', 10) || 0;
    _eventosLimposRangesAdmin = JSON.parse(localStorage.getItem('al_clear_notif_admin_ranges') || '[]') || [];
  } catch (e) {}
  try {
    const data = await window.AL.apiGet('/api/notificacoes-admin/admin-prefs');
    if (data && data.prefs) {
      _adminNotifPrefs = data.prefs || {};
    }
    if (data && data.prefs && data.prefs.al_last_notif_admin) {
      _ultimaLeituraAdmin = parseInt(data.prefs.al_last_notif_admin, 10) || 0;
    }
    if (data && data.prefs && data.prefs.al_clear_notif_admin) {
      _eventosLimposAteAdmin = parseInt(data.prefs.al_clear_notif_admin, 10) || 0;
    }
    if (data && data.prefs && data.prefs.al_clear_notif_admin_ranges) {
      _eventosLimposRangesAdmin = JSON.parse(data.prefs.al_clear_notif_admin_ranges) || [];
    }
  } catch (e) {}
  _atualizarBadgeNotificacoesAdmin();
}

function _getUltimaLeituraAdmin() {
  return _ultimaLeituraAdmin;
}

function _maxEventoTsAdmin() {
  return Math.max(Date.now(), ..._eventos.map(e => new Date(e.serverTime || Date.now()).getTime()).filter(Number.isFinite));
}

function _rotuloTipoEventoAdmin(tipo) {
  const item = TIPOS_EVENTO_ADMIN_FILTRO.find(t => t.tipo === tipo);
  return item ? item.label : tipo;
}

function _normalizarEventoAdmin(evt) {
  if (!evt) return evt;
  if (evt.tipo === 'deviceOverspeed') evt = { ...evt, tipo: 'overspeed' };
  if (!evt.tipoLabel || evt.tipoLabel === evt.tipo || evt.tipoLabel === 'Limite de Velocidade') {
    evt = { ...evt, tipoLabel: _rotuloTipoEventoAdmin(evt.tipo) };
  }
  return evt;
}

function _tipoPreferenciaAdmin(tipo) {
  if (tipo === 'manutencaoAlerta' || tipo === 'manutencaoAtrasada' || tipo === 'manutencaoFeita') return 'manutencao';
  if (tipo === 'recorrenciaDataAlerta' || tipo === 'recorrenciaDataNaoFeita' || tipo === 'recorrenciaDataFeita') return 'recorrenciaData';
  return tipo;
}

function _eventoPermitidoParaAdmin(evt) {
  if (!evt || evt.origemTipo !== 'CLIENTE') return true;
  if (evt.adminEvento === false) return false;
  return !!_adminNotifPrefs[_tipoPreferenciaAdmin(evt.tipo)];
}

function _intervaloPeriodoEventosAdmin(cutoff) {
  const periodo = _periodoEventosAdmin.periodo || 'hoje';
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  if (periodo === 'ontem') return { de: inicioHoje - 86400000, ate: inicioHoje - 1 };
  if (periodo === '7dias') return { de: inicioHoje - 7 * 86400000, ate: cutoff };
  if (periodo === 'custom' && _periodoEventosAdmin.de && _periodoEventosAdmin.ate) {
    const de = new Date(_periodoEventosAdmin.de + 'T00:00:00').getTime();
    const ate = new Date(_periodoEventosAdmin.ate + 'T23:59:59').getTime();
    return { de, ate: Math.min(ate, cutoff) };
  }
  return { de: inicioHoje, ate: cutoff };
}

function _eventoLimpoAdmin(evt) {
  const time = new Date(evt.serverTime || Date.now()).getTime();
  return _eventosLimposRangesAdmin.some(r => time >= Number(r.de) && time <= Number(r.ate));
}

function _setUltimaLeituraAdmin(ts) {
  const now = Number.isFinite(ts) ? ts : _maxEventoTsAdmin();
  _ultimaLeituraAdmin = now;
  try {
    localStorage.setItem('al_last_notif_admin', String(now));
    window.AL.apiPost('/api/notificacoes-admin/admin-prefs/merge', { prefs: { al_last_notif_admin: now } });
  } catch (e) {}
}

function _atualizarBadgeNotificacoesAdmin() {
  const btn = document.getElementById('map-btn-notif');
  if (!btn) return;
  const badge = btn.querySelector('.badge-count');
  if (!badge) return;
  
  if (_panelAbertoAdmin) {
    _setUltimaLeituraAdmin();
    badge.classList.remove('has-notifications');
    return;
  }

  const ultimaLeitura = _getUltimaLeituraAdmin();
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
  _injetarFiltroPlacaEventosAdmin();

  const dropdown = document.getElementById('evt-tipo-dropdown');
  dropdown.innerHTML = _htmlAcoesFiltroTipoEventos() + TIPOS_EVENTO_ADMIN_FILTRO.map(t =>
    `<label class="evt-tipo-item">
      <input type="checkbox" data-tipo="${t.tipo}" checked>
      ${t.label}
    </label>`
  ).join('');

  // Ao desmarcar/marcar, atualiza filtros
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

  // Toggle do dropdown
  document.getElementById('evt-tipo-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Notificação sonora
  document.getElementById('evt-btn-notif').addEventListener('click', function () {
    _evtNotif = !_evtNotif;
    this.classList.toggle('ativo', _evtNotif);
  });

  // Limpar eventos
  document.getElementById('evt-btn-limpar').addEventListener('click', function () {
    const cutoff = _maxEventoTsAdmin();
    const range = _intervaloPeriodoEventosAdmin(cutoff);
    _eventosLimposRangesAdmin.push(range);
    try {
      localStorage.setItem('al_clear_notif_admin_ranges', JSON.stringify(_eventosLimposRangesAdmin));
      localStorage.setItem('al_last_notif_admin', String(cutoff));
      window.AL.apiPost('/api/notificacoes-admin/admin-prefs/merge', {
        prefs: { al_clear_notif_admin_ranges: JSON.stringify(_eventosLimposRangesAdmin), al_last_notif_admin: cutoff },
      });
    } catch (e) {}
    for (let i = _eventos.length - 1; i >= 0; i--) {
      if (_eventoLimpoAdmin(_eventos[i])) _eventos.splice(i, 1);
    }
    _setUltimaLeituraAdmin(cutoff);
    _atualizarBadgeNotificacoesAdmin();
    renderEventosLista();
  });

  // Listeners dos botões de período
  document.querySelectorAll('.btn-evt-periodo').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.btn-evt-periodo').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const periodo = this.dataset.periodo;
      const customRange = document.getElementById('evt-custom-range');
      if (periodo === 'custom') {
        customRange.style.display = 'block';
        const hoje = new Date().toISOString().slice(0, 10);
        const deInput  = document.getElementById('evt-custom-de');
        const ateInput = document.getElementById('evt-custom-ate');
        if (!deInput.value)  deInput.value  = hoje;
        if (!ateInput.value) ateInput.value = hoje;
      } else {
        customRange.style.display = 'none';
        carregarHistoricoEventos(periodo);
      }
    });
  });

  document.getElementById('evt-custom-buscar').addEventListener('click', function () {
    const de  = document.getElementById('evt-custom-de').value;
    const ate = document.getElementById('evt-custom-ate').value;
    if (!de || !ate) { AL.showAlert('Preencha as duas datas.', 'warning'); return; }
    carregarHistoricoEventos('custom', de, ate);
  });

  // Carregar hoje por padrão
  carregarHistoricoEventos('hoje');
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

function _placaEventoAdmin(e) {
  const v = veiculosMap[e.dispositivoId];
  return v?.placa || e.placa || e.devicePlate || e.devicePlaca || '';
}

function _injetarFiltroPlacaEventosAdmin() {
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

async function carregarHistoricoEventos(periodo, de, ate) {
  _periodoEventosAdmin = { periodo: periodo || 'hoje', de: de || null, ate: ate || null };
  const lista = document.getElementById('eventos-lista');
  lista.innerHTML = '<div style="padding:20px;text-align:center;color:#999"><i class="fa fa-spinner fa-spin"></i> Carregando...</div>';
  try {
    let url = `/api/notificacoes-admin/eventos?periodo=${periodo}`;
    if (periodo === 'custom' && de && ate) url += `&de=${de}&ate=${ate}`;
    const data = await AL.apiGet(url);
    _eventos.length = 0;
    if (data && data.length) data.forEach(e => {
      e = _normalizarEventoAdmin(e);
      const time = new Date(e.serverTime || Date.now()).getTime();
      const tiposPermitidos = TIPOS_EVENTO_ADMIN_FILTRO.map(t => t.tipo);
      if (_eventoLimpoAdmin(e) || !tiposPermitidos.includes(e.tipo)) return;
      _eventos.push(e);
    });
    renderEventosLista();
  } catch (err) {
    console.error('Erro ao carregar histórico de eventos', err);
    lista.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c">Erro ao carregar histórico.</div>';
  }
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
    const ativas = TIPOS_EVENTO_ADMIN_FILTRO.length - _evtFiltros.size;
    label.textContent = `Tipo (${ativas}/${TIPOS_EVENTO_ADMIN_FILTRO.length})`;
  }
}

function adicionarEvento(evt) {
  evt = _normalizarEventoAdmin(evt);
  const time = new Date(evt.serverTime || Date.now()).getTime();
  const tiposPermitidos = TIPOS_EVENTO_ADMIN_FILTRO.map(t => t.tipo);
  if (_eventoLimpoAdmin(evt) || !_eventoPermitidoParaAdmin(evt) || !tiposPermitidos.includes(evt.tipo)) return;
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
    osc.frequency.setValueAtTime(tipo === 'alarm' ? 880 : 660, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

function _cssEvento(tipo) {
  if (tipo === 'geofenceEnter' || tipo === 'geofenceExit') return 'tipo-geofence';
  if (tipo === 'deviceOverspeed' || tipo === 'overspeed') return 'tipo-overspeed';
  if (tipo === 'commandResult' || tipo === 'commandQueued') return 'tipo-command';
  if (tipo === 'deviceFuelDrop' || tipo === 'deviceFuelIncrease') return 'tipo-fuel';
  if (tipo === 'ignitionOn' || tipo === 'ignitionOff') return 'tipo-ignition';
  if (tipo === 'driverChanged') return 'tipo-driver';
  if (tipo === 'textMessage') return 'tipo-text';
  return '';
}

function renderEventosLista() {
  const lista = document.getElementById('eventos-lista');
  const placaFiltro = _normalizarPlacaFiltro(_evtPlacaFiltro);
  const filtrados = _eventos.filter(e => {
    if (_evtFiltros.has(e.tipo)) return false;
    if (!placaFiltro) return true;
    return _normalizarPlacaFiltro(_placaEventoAdmin(e)).includes(placaFiltro);
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
      case 'ignitionOn': case 'deviceUnlocked': return { color: '#27ae60', icon: 'fa-key' };
      case 'ignitionOff': return { color: '#e67e22', icon: 'fa-power-off' };
      case 'overspeed': case 'deviceOverspeed': case 'powerCut': case 'alarm': case 'deviceLocked': case 'kmExcedida': return { color: '#e74c3c', icon: 'fa-exclamation-triangle' };
      case 'geofenceEnter': case 'kmReduzida': return { color: '#2980b9', icon: 'fa-sign-in' };
      case 'geofenceExit': case 'manutencaoAlerta': return { color: '#e67e22', icon: tipo === 'manutencaoAlerta' ? 'fa-wrench' : 'fa-sign-out' };
      case 'manutencaoAtrasada': return { color: '#e74c3c', icon: 'fa-exclamation-triangle' };
      case 'manutencaoFeita': return { color: '#27ae60', icon: 'fa-check-circle' };
      default: return { color: '#2980b9', icon: 'fa-bell' };
    }
  };

  const isDark = document.documentElement.classList.contains('dark-theme');
  const descColor = isDark ? '#f4f7fb' : '#555';
  const timeColor = isDark ? '#b8c1cc' : '#999';
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

  _atualizarBadgeNotificacoesAdmin();
}

function _nomeDispositivo(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v) return dispositivoId || '—';
  return v.placa ? `${v.nome} (${v.placa})` : v.nome;
}

function _restaurarPopupVeiculoAdmin(dispositivoId) {
  const marker = marcadores[dispositivoId];
  const v = veiculosMap[dispositivoId];
  if (!marker || !v) return;
  marker._eventPopupAberto = false;
  marker._eventOriginalPopup = null;
  marker._eventPopupToken = null;
  if (_mostrarPopup) {
    marker.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 240 });
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
      case 'overspeed': case 'deviceOverspeed': case 'powerCut': case 'alarm': case 'deviceLocked': case 'kmExcedida': case 'manutencaoAtrasada': return { color: '#e74c3c' };
      case 'manutencaoAlerta': return { color: '#e67e22' };
      case 'manutencaoFeita': return { color: '#27ae60' };
      default: return { color: '#2980b9' };
    }
  })();

  // Focar no dispositivo se tiver posição
  if (e.dispositivoId && veiculosMap[e.dispositivoId]?.posicao) {
    focar(e.dispositivoId, { abrirPopup: false, offsetPx: _eventPopupOffsetPx });

    // Criar popup nativo do Leaflet que segue o marcador
    if (!marcadores[e.dispositivoId]) renderMarcadores();
    const marker = marcadores[e.dispositivoId];
    if (marker) {
      _restaurarPopupVeiculoAdmin(e.dispositivoId);

      const addrId = `evt-addr-admin-${idx}`;
      const v = veiculosMap[e.dispositivoId];
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
        <div class="evt-popup-content" style="padding: 4px; min-width: 220px;">
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
      marker.bindPopup(content, { className: 'popup-evento-moderno', offset: [0, -10], maxWidth: 280 });
      setTimeout(function() {
        if (marker._eventPopupToken === popupToken && map.hasLayer(marker)) {
          marker.openPopup();
          if (!enderecoInicial && eventoTemCoords) geocodificarCoordenadas(eventoLat, eventoLng, addrId);
        }
      }, 500);

      marker.once('popupclose', function() {
        _restaurarPopupVeiculoAdmin(e.dispositivoId);
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

  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
  );
  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
  );

  _googleMapLayers = _criarCamadasGoogle();
  _baseMapControlLayers = {
    google: _googleMapLayers.roadmap,
    carto: tilesCartoDB,
    osm: tilesOsm,
    esri: tilesEsri,
  };
  _googleMapLayers.roadmap.addTo(map);

  // Zoom e camadas de tile — todos à direita
  L.control.zoom({ position: 'topright' }).addTo(map);

  // ── Botão Global de Notificações (BtnNotif) ──
  const BtnNotif = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-control map-btn-notif');
      btn.id = 'map-btn-notif';
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
        _panelAbertoAdmin = !estaAberto;
        
        if (_panelAbertoAdmin) {
          panel.classList.remove('minimizado');
          btn.classList.add('ativo');
        } else {
          panel.classList.add('minimizado');
          btn.classList.remove('ativo');
        }
        _atualizarBadgeNotificacoesAdmin();
        if (map) setTimeout(() => map.invalidateSize(), 220);
      });
      return btn;
    },
    onRemove() {}
  });
  new BtnNotif({ position: 'topright' }).addTo(map);

  L.control.layers(
    { 'Google Maps': _googleMapLayers.roadmap, 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);
  _adicionarControleTipoGoogle();

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Localização primeiro (topright) → tray toggle fica abaixo dela
  _adicionarBotaoLocalizacao();
  _adicionarBotoesCamadas();

  map.on('popupclose', function (e) {
    const className = e.popup?.options?.className || '';
    if (className.includes('popup-evento-moderno')) return;
    if (_togglingPopup || _modoDesenho) return; // Não fecha o card se estiver desenhando a cerca
    if (ativoId && marcadores[ativoId] && e.popup === marcadores[ativoId].getPopup()) {
      if (_isMobileTracking()) _fecharTrackingDrawer();
      else fecharCardDispositivo(true);
    }
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

  map.on('zoomend', function () {
    _fecharSpider();
    if (!modoFoco) renderMarcadores();
  });
  map.on('baselayerchange', function () {
    _atualizarControleTipoGoogle();
  });
  requestAnimationFrame(function () {
    map.invalidateSize();
    setTimeout(function () { map.invalidateSize(); }, 120);
    setTimeout(function () { map.invalidateSize(); }, 320);
  });
  window.addEventListener('resize', function () {
    if (map) map.invalidateSize();
    _ajustarAlturaCardDispositivo();
    _posicionarBotaoTrayAtributos();
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
  } catch(e) {}
}

// ── Botões de camadas sobre o mapa ────────────────────────────────────────────

function _adicionarBotoesCamadas() {
  const tray = document.getElementById('mapa-tray');
  if (!tray) return;

  // Toggle criado como Leaflet control para ficar abaixo do botão de localização
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

  // Fechar bandeja ao clicar fora
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

// ── Botão de localização ──────────────────────────────────────────────────────

function _adicionarBotaoLocalizacao() {
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
  new BtnLoc({ position: 'topright' }).addTo(map);
}

// ── Rastros ───────────────────────────────────────────────────────────────────

function _limparRastros() {
  Object.values(_rastros).forEach(function (r) {
    if (r.linha && map.hasLayer(r.linha)) map.removeLayer(r.linha);
    (r.setas || []).forEach(s => { if (map.hasLayer(s)) map.removeLayer(s); });
  });
  Object.keys(_rastros).forEach(k => delete _rastros[k]);
}

function _criarSetasNoRastro(pontos, cor) {
  const setas = [];
  const intervalo = Math.max(1, Math.floor(pontos.length / 8)); // até 8 setas
  for (let i = intervalo; i < pontos.length - 1; i += intervalo) {
    const p1 = pontos[i - 1], p2 = pontos[i];
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI;
    const seta = L.marker(p2, {
      icon: L.divIcon({
        html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${cor};transform:rotate(${90 - ang}deg);transform-origin:center center;opacity:0.85"></div>`,
        className: '', iconSize: [10, 9], iconAnchor: [5, 4],
      }),
      interactive: false,
      zIndexOffset: -100,
    });
    setas.push(seta);
    seta.addTo(map);
  }
  return setas;
}

async function _carregarRastros() {
  const ids = Object.keys(veiculosMap).filter(id => veiculosMap[id]?.posicao);
  for (const id of ids) {
    if (!_overlay.rastro) break;
    await _carregarRastroDispositivo(id, '/api/rastreamento/dispositivos');
  }
}

async function _carregarRastroDispositivo(id, baseUrl) {
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const hist = await window.AL.apiGet(`${baseUrl}/${id}/historico?from=${from}&to=${now.toISOString()}`);
    const pontos = (hist.posicoes || []).map(p => [p.latitude, p.longitude]);
    if (pontos.length >= 2) {
      const cor = '#2980b9';
      const linha = L.polyline(pontos, { color: cor, weight: 3, opacity: 0.7 }).addTo(map);
      const setas = _criarSetasNoRastro(pontos, cor);
      _rastros[id] = { linha, setas };
    }
  } catch {}
}

// ── Rota individual (botão Rota no card) ──────────────────────────────────────

async function ativarRota(dispositivoId) {
  // Toggle: se já existe, remove
  if (_rotasIndividuais[dispositivoId]) {
    const r = _rotasIndividuais[dispositivoId];
    if (r.linha && map.hasLayer(r.linha)) map.removeLayer(r.linha);
    (r.setas || []).forEach(s => { if (map.hasLayer(s)) map.removeLayer(s); });
    delete _rotasIndividuais[dispositivoId];
    const btn = document.querySelector('.dcard-acao[data-acao="rota"]');
    if (btn) btn.classList.remove('ativo');
    return;
  }

  const btn = document.querySelector('.dcard-acao[data-acao="rota"]');
  if (btn) { btn.classList.add('carregando'); btn.querySelector('i').className = 'fa fa-spinner fa-spin'; }

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    const hist = await window.AL.apiGet(`/api/rastreamento/dispositivos/${dispositivoId}/historico?from=${from}&to=${now.toISOString()}`);
    const pontos = (hist.posicoes || []).map(p => [p.latitude, p.longitude]);

    if (pontos.length >= 2) {
      const cor = '#e74c3c';
      const linha = L.polyline(pontos, { color: cor, weight: 4, opacity: 0.85 }).addTo(map);
      const setas = _criarSetasNoRastro(pontos, cor);
      _rotasIndividuais[dispositivoId] = { linha, setas };
      
      const bounds = linha.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));

      if (btn) { btn.classList.remove('carregando'); btn.classList.add('ativo'); btn.querySelector('i').className = 'fa fa-road'; }
    } else {
      AL.showAlert('Sem histórico de posição nas últimas 24h.', 'warning');
      if (btn) { btn.classList.remove('carregando'); btn.querySelector('i').className = 'fa fa-road'; }
    }
  } catch (err) {
    console.error('Erro rota:', err);
    AL.showAlert('Erro ao carregar rota.', 'danger');
    if (btn) { btn.classList.remove('carregando'); btn.querySelector('i').className = 'fa fa-road'; }
  }
}

window.acaoDispositivo = async function (acao, dispositivoId) {
  if (acao === 'seguir') {
    const v = veiculosMap[dispositivoId];
    if (!v?.posicao) {
      AL.showAlert('Posição do veículo indisponível.', 'warning');
      return;
    }
    ativarFoco(dispositivoId);
    _centralizarDispositivo(v.posicao, 16, 0, true);
    return;
  }
  if (acao === 'rota') { ativarRota(dispositivoId); return; }
  if (acao === 'compartilhar') { compartilharDispositivo(dispositivoId); return; }
  if (acao === 'comando') { abrirModalComando(dispositivoId); return; }
  if (acao === 'cerca') {
    const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
    if (btn && btn.classList.contains('ativo')) {
      // Se já está ativo, oferece remover
      if (confirm('Deseja remover as cercas vinculadas a este dispositivo?')) {
        try {
          // Busca cercas deste dispositivo para remover
          const cercas = await window.AL.apiGet(`/api/rastreamento/dispositivos/${dispositivoId}/cercas`);
          if (cercas.length === 0) {
             AL.showAlert('Nenhuma cerca vinculada encontrada.', 'info');
             btn.classList.remove('ativo');
             return;
          }
          for (const c of cercas) {
            await removerCerca(c.id);
          }
          AL.showAlert('Cercas removidas.', 'success');
          btn.classList.remove('ativo');
        } catch (err) {
          AL.showAlert('Erro ao remover cercas.', 'danger');
        }
      }
      return;
    }
    iniciarDesenhoCirculo(dispositivoId); 
    return; 
  }
};

// ── Modal de Comando ──────────────────────────────────────────────────────────

async function abrirModalComando(dispositivoId) {
  _cmdDispositivoId = dispositivoId;
  const v = veiculosMap[dispositivoId];
  const modal = document.getElementById('modal-cmd-overlay');
  document.getElementById('modal-cmd-titulo').textContent = v ? `Comando — ${v.nome}` : 'Comando';
  document.getElementById('cmd-tipo-select').innerHTML = '<option value="">Carregando...</option>';
  document.getElementById('btn-enviar-cmd').disabled = true;
  document.getElementById('cmd-resultado').textContent = '';
  modal.style.display = 'flex';

  try {
    const tipos = await window.AL.apiGet(`/api/rastreamento/dispositivos/${dispositivoId}/tipos-comandos`);
    const CMD_LABELS = {
      engineStop: 'Desligar Motor', engineResume: 'Religar Motor',
      custom: 'Comando personalizado', positionSingle: 'Solicitar posição',
      positionPeriodic: 'Rastreamento periódico', positionStop: 'Parar rastreamento',
      alarmArm: 'Ativar Alarme', alarmDisarm: 'Desativar Alarme',
      outputControl: 'Controle de saída', rebootDevice: 'Reiniciar dispositivo',
      silenceAlarm: 'Silenciar alarme', factoryReset: 'Reset de fábrica',
      setTimezone: 'Definir fuso horário', setSpeed: 'Velocidade limite',
      sendSms: 'Enviar SMS', message: 'Enviar mensagem',
      requestPhoto: 'Solicitar foto', voiceMonitoring: 'Monitoramento de voz',
      immobilize: 'Imobilizar veículo', driverUnique: 'Identificação motorista',
      configuration: 'Configurar dispositivo', getVersion: 'Versão firmware',
    };
    const lista = Array.isArray(tipos) ? tipos.map(t => typeof t === 'string' ? t : t.type) : [];
    if (!lista.length) {
      document.getElementById('cmd-tipo-select').innerHTML = '<option value="">Nenhum comando suportado</option>';
      return;
    }
    document.getElementById('cmd-tipo-select').innerHTML =
      '<option value="">Selecione o tipo...</option>' +
      lista.map(t => `<option value="${t}">${CMD_LABELS[t] || t}</option>`).join('');
  } catch {
    document.getElementById('cmd-tipo-select').innerHTML = '<option value="">Erro ao carregar tipos</option>';
  }
}

function fecharModalComando() {
  document.getElementById('modal-cmd-overlay').style.display = 'none';
  _cmdDispositivoId = null;
  fecharModalComando_resetCustom();
}

async function enviarComandoDoModal() {
  const tipo = document.getElementById('cmd-tipo-select').value;
  if (!tipo || !_cmdDispositivoId) return;

  if (tipo === 'custom') {
    const customData = (document.getElementById('cmd-custom-data')?.value || '').trim();
    if (!customData) {
      const res = document.getElementById('cmd-resultado');
      res.textContent = 'Digite o comando personalizado.';
      res.style.color = '#e74c3c';
      return;
    }
  }

  const btn = document.getElementById('btn-enviar-cmd');
  const res = document.getElementById('cmd-resultado');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando...';
  res.textContent = '';
  res.style.color = '';

  const payload = { tipo };
  if (tipo === 'custom') {
    payload.atributos = { data: document.getElementById('cmd-custom-data').value.trim() };
  }

  try {
    await window.AL.apiPost(`/api/rastreamento/dispositivos/${_cmdDispositivoId}/comandos`, payload);
    res.textContent = 'Comando enviado com sucesso!';
    res.style.color = '#27ae60';
    setTimeout(fecharModalComando, 1500);
  } catch (err) {
    res.textContent = 'Erro: ' + (err.message || 'Falha ao enviar.');
    res.style.color = '#e74c3c';
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-paper-plane"></i> Enviar';
  }
}

function fecharModalComando_resetCustom() {
  const wrap = document.getElementById('cmd-custom-wrap');
  if (wrap) wrap.style.display = 'none';
  const input = document.getElementById('cmd-custom-data');
  if (input) input.value = '';
}

// ── Cercas (Geofences) ────────────────────────────────────────────────────────

function inicializarModalMedidores() {
  if (document.getElementById('modal-medidores-overlay')) return;
  const wrap = document.createElement('div');
  wrap.id = 'modal-medidores-overlay';
  wrap.innerHTML = `
    <div id="modal-medidores">
      <div id="modal-medidores-header">
        <span id="modal-medidores-titulo"><i class="fa fa-pencil-square-o" style="margin-right:6px"></i> Editar medidores</span>
        <button type="button" id="btn-fechar-modal-medidores" title="Fechar">&times;</button>
      </div>
      <div id="modal-medidores-body">
        <div class="form-group">
          <label for="medidores-odometro">Odômetro (km)</label>
          <input type="number" class="form-control" id="medidores-odometro" min="0" step="0.1" />
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label for="medidores-horimetro">Motor (h)</label>
          <input type="number" class="form-control" id="medidores-horimetro" min="0" step="0.1" />
        </div>
        <div id="medidores-resultado"></div>
      </div>
      <div id="modal-medidores-footer">
        <button type="button" class="btn btn-default btn-sm" id="btn-cancelar-modal-medidores">Cancelar</button>
        <button type="button" id="btn-salvar-medidores"><i class="fa fa-save"></i> Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  document.getElementById('btn-fechar-modal-medidores').addEventListener('click', fecharModalMedidores);
  document.getElementById('btn-cancelar-modal-medidores').addEventListener('click', fecharModalMedidores);
  document.getElementById('btn-salvar-medidores').addEventListener('click', salvarMedidoresDoModal);
  wrap.addEventListener('click', function (e) {
    if (e.target === wrap) fecharModalMedidores();
  });
}

function abrirModalMedidores(dispositivoId) {
  if (!_podeEditarMedidores) return;
  const v = veiculosMap[dispositivoId];
  if (!v) return;
  _medidoresDispositivoId = dispositivoId;
  document.getElementById('modal-medidores-titulo').textContent = `Editar medidores - ${v.nome}`;
  document.getElementById('medidores-odometro').value = v.posicao?.odometro != null ? (v.posicao.odometro / 1000).toFixed(1) : '';
  document.getElementById('medidores-horimetro').value = v.posicao?.horas_motor != null ? v.posicao.horas_motor : 0;
  document.getElementById('medidores-resultado').textContent = '';
  document.getElementById('modal-medidores-overlay').style.display = 'flex';
}

function fecharModalMedidores() {
  const wrap = document.getElementById('modal-medidores-overlay');
  if (wrap) wrap.style.display = 'none';
  _medidoresDispositivoId = null;
}

async function salvarMedidoresDoModal() {
  if (!_medidoresDispositivoId) return;
  const btn = document.getElementById('btn-salvar-medidores');
  const resultado = document.getElementById('medidores-resultado');
  const odometroRaw = document.getElementById('medidores-odometro').value.trim();
  const horimetroRaw = document.getElementById('medidores-horimetro').value.trim();

  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';
  resultado.textContent = '';

  try {
    const data = await window.AL.apiPatch(`/api/rastreamento/dispositivos/${_medidoresDispositivoId}/medidores`, {
      odometro: odometroRaw === '' ? null : Number(odometroRaw),
      horimetro: horimetroRaw === '' ? 0 : Number(horimetroRaw),
    });

    const veiculo = veiculosMap[_medidoresDispositivoId];
    if (veiculo && veiculo.posicao) {
      veiculo.posicao.odometro = data.odometro != null ? Math.round(data.odometro * 1000) : null;
      veiculo.posicao.horas_motor = data.horimetro;
    }

    resultado.style.color = '#27ae60';
    resultado.textContent = 'Medidores atualizados.';
    mostrarCardDispositivo(_medidoresDispositivoId);
    setTimeout(fecharModalMedidores, 700);
  } catch (err) {
    resultado.style.color = '#e74c3c';
    resultado.textContent = 'Erro: ' + (err.message || 'Falha ao salvar.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-save"></i> Salvar';
  }
}

window.abrirModalMedidores = abrirModalMedidores;

function _parsearAreaTraccar(area) {
  if (!area) return null;
  // CIRCLE (lat lon, radius)
  const circleMatch = area.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (circleMatch) {
    return { tipo: 'circulo', lat: parseFloat(circleMatch[1]), lng: parseFloat(circleMatch[2]), raio: parseFloat(circleMatch[3]) };
  }
  // POLYGON ((lon lat, lon lat, ...))
  const polyMatch = area.match(/POLYGON\s*\(\s*\(\s*(.+?)\s*\)\s*\)/i);
  if (polyMatch) {
    const pontos = polyMatch[1].split(',').map(p => {
      const [lng, lat] = p.trim().split(/\s+/).map(Number);
      return [lat, lng];
    });
    return { tipo: 'poligono', pontos };
  }
  return null;
}

function _criarCamadaCerca(cerca) {
  const geo = _parsearAreaTraccar(cerca.area);
  if (!geo) return null;
  let camada;
  const cor = '#27ae60';
  // A cerca é apenas um overlay visual: não recebe eventos de clique/toque
  // (a exclusão é feita pelo card do dispositivo e pela tela de geocercas).
  if (geo.tipo === 'circulo') {
    camada = L.circle([geo.lat, geo.lng], {
      radius: geo.raio, color: cor, fillColor: cor,
      fillOpacity: 0.08, weight: 2, dashArray: '6,4', interactive: false,
    });
  } else {
    camada = L.polygon(geo.pontos, {
      color: cor, fillColor: cor,
      fillOpacity: 0.08, weight: 2, dashArray: '6,4', interactive: false,
    });
  }

  return camada;
}

async function carregarCercas() {
  if (_cercasCarregadas && _overlay.cercas) return;
  try {
    const cercas = await window.AL.apiGet('/api/rastreamento/cercas');
    cercas.forEach(function (c) {
      if (c.id) _cercasPermitidas.add(c.id); // c.id = traccarId numérico
      if (_cercasLayer[c.id]) return;
      const camada = _criarCamadaCerca(c);
      if (camada) {
        _cercasLayer[c.id] = { camada, dados: c };
        if (_overlay.cercas) camada.addTo(map);
      }
    });
    _cercasCarregadas = true;
  } catch {}
}

function mostrarCercas() {
  Object.values(_cercasLayer).forEach(function (c) {
    if (!map.hasLayer(c.camada)) c.camada.addTo(map);
  });
}

function ocultarCercas() {
  Object.values(_cercasLayer).forEach(function (c) {
    if (map.hasLayer(c.camada)) map.removeLayer(c.camada);
  });
  // Remove também a cerca em desenho
  _cancelarDesenhoCirculo();
}

async function removerCerca(geofenceId) {
  try {
    await window.AL.apiDelete(`/api/rastreamento/cercas/${geofenceId}`);
    const entry = _cercasLayer[geofenceId];
    if (entry) {
      if (map.hasLayer(entry.camada)) map.removeLayer(entry.camada);
      delete _cercasLayer[geofenceId];
    }
  } catch (err) {
    AL.showAlert('Erro ao remover cerca: ' + (err.message || ''), 'danger');
  }
}

// ── Desenho de cerca (círculo) ────────────────────────────────────────────────

function iniciarDesenhoCirculo(dispositivoId) {
  _cancelarDesenhoCirculo();
  const v = veiculosMap[dispositivoId];
  if (!v || !v.posicao) {
    AL.showAlert('Veículo sem posição para criar cerca.', 'warning');
    return;
  }

  const latlng = L.latLng(v.posicao.latitude, v.posicao.longitude);
  _modoDesenho = { dispositivoId, etapa: 'raio', circle: null, center: latlng };
  
  // Ativa visualmente o botão no card
  const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
  if (btn) btn.classList.add('ativo');

  // Cria círculo inicial (500m) automaticamente sobre o veículo
  _modoDesenho.circle = L.circle(latlng, {
    radius: 500, color: '#f39c12', fillColor: '#f39c12',
    fillOpacity: 0.12, weight: 2, dashArray: '6,4',
  }).addTo(map);

  _mostrarDialogoCerca(dispositivoId, latlng);
}

function _mostrarDialogoCerca(dispositivoId, latlng) {
  const v = veiculosMap[dispositivoId];
  const nomeSugerido = v ? `Cerca — ${v.placa || v.nome}` : 'Nova Cerca';

  const dlg = document.getElementById('dlg-cerca');
  document.getElementById('cerca-nome-input').value = nomeSugerido;
  document.getElementById('cerca-raio-input').value = '500';
  dlg.style.display = 'flex';

  document.getElementById('cerca-raio-input').oninput = function () {
    const r = parseInt(this.value) || 500;
    if (_modoDesenho?.circle) _modoDesenho.circle.setRadius(r);
  };

  document.getElementById('btn-cerca-confirmar').onclick = async function () {
    const nome = document.getElementById('cerca-nome-input').value.trim() || nomeSugerido;
    const raio = parseInt(document.getElementById('cerca-raio-input').value) || 500;
    const area = `CIRCLE (${latlng.lat.toFixed(6)} ${latlng.lng.toFixed(6)}, ${raio})`;

    const btnCriar = this;
    btnCriar.disabled = true;
    btnCriar.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';

    try {
      const cerca = await window.AL.apiPost('/api/rastreamento/cercas', {
        nome, area, dispositivoId,
      });

      if (_modoDesenho?.circle && map.hasLayer(_modoDesenho.circle)) {
        map.removeLayer(_modoDesenho.circle);
      }
      _modoDesenho = null;
      dlg.style.display = 'none';

      const camada = _criarCamadaCerca(cerca);
      if (camada) {
        _cercasLayer[cerca.id] = { camada, dados: cerca };
        camada.addTo(map);
        if (!_overlay.cercas) {
          const btnCercas = document.getElementById('ml-cercas');
          if (btnCercas) { btnCercas.classList.add('ativo'); _overlay.cercas = true; }
        }
      }
      AL.showAlert('Cerca criada!', 'success');
    } catch (err) {
      AL.showAlert('Erro ao criar cerca: ' + (err.message || ''), 'danger');
    } finally {
      btnCriar.disabled = false;
      btnCriar.innerHTML = '<i class="fa fa-check"></i> Criar';
    }
  };

  document.getElementById('btn-cerca-cancelar').onclick = _cancelarDesenhoCirculo;
}

function _cancelarDesenhoCirculo() {
  if (_modoDesenho?.circle && map.hasLayer(_modoDesenho.circle)) {
    map.removeLayer(_modoDesenho.circle);
  }
  _modoDesenho = null;
  map.getContainer().style.cursor = '';
  const banner = document.getElementById('mapa-instrucao');
  if (banner) banner.style.display = 'none';
  const dlg = document.getElementById('dlg-cerca');
  if (dlg) dlg.style.display = 'none';
  
  // Garante que o botão de confirmar volte ao estado normal
  const btnConfirmar = document.getElementById('btn-cerca-confirmar');
  if (btnConfirmar) {
    btnConfirmar.disabled = false;
    btnConfirmar.innerHTML = '<i class="fa fa-check"></i> Criar';
  }

  // Remove o estado ativo do botão no card
  const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
  if (btn) btn.classList.remove('ativo');
}

// ── Badges de alarme sobre marcadores ────────────────────────────────────────

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
  if (!_overlay.alarmes) return;
  if (!v?.posicao?.alarme) return;

  const badge = L.marker([v.posicao.latitude, v.posicao.longitude], {
    icon: L.divIcon({
      html: `<div style="
        background:#e74c3c;color:#fff;
        border-radius:20px;padding:2px 8px;
        font-size:10px;font-weight:700;
        white-space:nowrap;
        box-shadow:0 2px 6px rgba(0,0,0,0.3);
        display:flex;align-items:center;gap:4px;
      "><i class="fa fa-bell" style="font-size:9px"></i> ${v.posicao.alarme}</div>`,
      className: '',
      iconAnchor: [0, 36],
      iconSize: null,
    }),
    zIndexOffset: 800,
    interactive: false,
  });
  badge.addTo(map);
  _alarmeBadges[id] = badge;
}

// ── Snapshot inicial via REST ─────────────────────────────────────────────────

async function carregarPosicoes() {
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
      _restaurarFocoAdmin();
    }
  } catch {}

  conectarWebSocket();

  try {
    const lista = await window.AL.apiGet('/api/rastreamento/posicoes');

    Object.keys(marcadores).forEach(id => {
      if (!lista.find(v => v.dispositivoId === id)) {
        if (map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
        delete marcadores[id];
        delete marcadoresIconeKey[id];
      }
    });
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
    _restaurarFocoAdmin();

    if (_overlay.alarmes) _atualizarAlarmeBadges();
    if (_overlay.rastro) _carregarRastros();
    if (_overlay.cercas) carregarCercas().then(mostrarCercas);
  } catch (err) {
    console.error('Erro ao carregar posições:', err);
    if (!Object.keys(veiculosMap).length) {
      document.getElementById('topbar-counters').innerHTML =
        '<span style="color:#e74c3c"><i class="fa fa-exclamation-triangle"></i> Erro ao carregar</span>';
    }
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function conectarWebSocket() {
  if (ws && ws.readyState < 2) return;

  const apiBase = window.API_URL || 'http://localhost:3000';
  const wsUrl = `${apiBase.replace(/^http/, 'ws')}/ws/rastreamento`;

  const token = localStorage.getItem('al_token');
  const url = token ? `${wsUrl}?token=${token}` : wsUrl;

  ws = new WebSocket(url);
  // setWsStatus('reconectando', 'Conectando...');

  ws.onopen = () => {
    wsReconectando = false;
    // setWsStatus('conectado', 'Tempo real ativo');
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    processarMensagemWs(msg);
  };

  ws.onclose = () => {
    // setWsStatus('desconectado', 'Reconectando...');
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
      _agendarAtualizacaoAtributos(dispositivoId);

      // Atualiza badge de alarme
      if (_overlay.alarmes) _renderAlarmeBadge(dispositivoId, veiculosMap[dispositivoId]);

      // Atualiza rastro global em tempo real
      if (_overlay.rastro && _rastros[dispositivoId]?.linha) {
        _rastros[dispositivoId].linha.addLatLng([pos.latitude, pos.longitude]);
      }
      // Atualiza rota individual em tempo real
      if (_rotasIndividuais[dispositivoId]?.linha) {
        _rotasIndividuais[dispositivoId].linha.addLatLng([pos.latitude, pos.longitude]);
      }
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

  if (msg.events?.length) {
    msg.events.forEach(function (e) {
      const dispositivoId = traccarIdParaDispositivoId[e.deviceId];
      const pos = dispositivoId ? veiculosMap[dispositivoId]?.posicao : null;

      if ((e.type === 'geofenceEnter' || e.type === 'geofenceExit') && e.geofenceId) {
        if (!_cercasPermitidas.has(e.geofenceId)) return;
      }

      adicionarEvento({
        dispositivoId: dispositivoId || null,
        tipo: e.type,
        tipoLabel: e.tipoLabel,
        mensagem: e.mensagem,
        serverTime: e.serverTime,
        positionId: e.positionId,
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

//function setWsStatus(estado, texto) {
//  const el = document.getElementById('ws-status');
//  el.className = estado;
//  el.innerHTML = `<i class="fa fa-circle"></i> ${texto}`;
//}

// ── Cluster ───────────────────────────────────────────────────────────────────

const CLUSTER_PX = 40;

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
  if (_spider.chave === chave) { _fecharSpider(); return; }
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
    if (_mostrarPopup) sm.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 240 });
    if (_overlay.labels) _bindLabelVeiculo(sm, _textoLabelVeiculo(v));
    sm.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      _fecharSpider();
      focar(id);
    });
    sm.addTo(map);
    _spider.markers.push(sm);
  });
}

// ── Marcadores ────────────────────────────────────────────────────────────────

function renderMarcadores() {
  const grupos = _agruparPorPixel();

  Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);
  Object.assign(_clusterGrupos, grupos);

  Object.keys(_clusterBadges).forEach(chave => {
    if (!grupos[chave] || grupos[chave].ids.length < 2) {
      if (map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]);
      delete _clusterBadges[chave];
    }
  });

  Object.entries(grupos).forEach(([chave, { ids, lat, lng }]) => {
    const isCluster = ids.length > 1;

    ids.forEach(id => {
      const v = veiculosMap[id];
      const { latitude, longitude } = v.posicao;
      const visivel = modoFoco ? id === ativoId : !isCluster;

      if (!marcadores[id]) {
        const icone = criarIcone(v);
        marcadoresIconeKey[id] = _iconeKey(v);
        const marker = L.marker([latitude, longitude], { icon: icone });
        if (_mostrarPopup) marker.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 240 });
        if (_overlay.labels) _bindLabelVeiculo(marker, _textoLabelVeiculo(v));
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

  const isOpen = marcadores[dispositivoId].getPopup()?.isOpen();
  const isEventPopup = (marcadores[dispositivoId].getPopup()?.options?.className || '').includes('popup-evento-moderno');
  if (_mostrarPopup && isOpen && !isEventPopup) {
    marcadores[dispositivoId].getPopup().setContent(criarPopupSimples(v));
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
  if (!v.posicao || v.status !== 'online') return '#fab32c';
  if (v.limiteVelocidade && v.posicao.velocidade > v.limiteVelocidade) return '#e74c3c';
  if (v.posicao.emMovimento || v.posicao.ignicao === true) return '#2980b9';
  return '#27ae60';
}

function _iconeKey(v) {
  const course = v.posicao ? Math.round(v.posicao.curso / 5) * 5 : 0;
  return `${_corMarcador(v)}|${v.categoria}|${course}`;
}

function criarIcone(v) {
  const cor = _corMarcador(v);
  const course = v.posicao ? v.posicao.curso : 0;
  const html = AL_ICONS_3D.getSvgHtml(v.categoria, cor, course);
  return L.divIcon({ html, className: '', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -14] });
}

// ── Popup simplificado ────────────────────────────────────────────────────────

let _mostrarPopup = true;
let _togglingPopup = false;

function criarPopupSimples(v) {
  const txt = _textoLabelVeiculo(v);
  return `<div style="padding:4px 9px;font-size:13px;font-weight:700;letter-spacing:0.5px;white-space:nowrap">${txt}</div>`;
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
      m.bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', closeButton: false, maxWidth: 240 });
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
  const tz = 'America/Sao_Paulo';
  return d.toLocaleDateString('pt-BR', { timeZone: tz }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz });
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

  const el = document.getElementById('topbar-counters');
  if (el) {
    el.innerHTML =
      `<span class="dot-moving">●</span> ${online} online &nbsp;·&nbsp;
       <span class="dot-offline">●</span> ${offline} offline
       ${semPos ? `&nbsp;·&nbsp;<span style="color:#e67e22">${semPos} sem pos.</span>` : ''}`;
  }
}

// ── Busca ─────────────────────────────────────────────────────────────────────

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
    (v.identificador && v.identificador.toLowerCase().includes(filtro)) ||
    (v.marca && v.marca.toLowerCase().includes(filtro)) ||
    (v.modeloVeiculo && v.modeloVeiculo.toLowerCase().includes(filtro)) ||
    (v.cliente?.nome.toLowerCase().includes(filtro))
  );

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

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmtAtributoCard(valor) {
  if (valor == null) return '<span style="color:#bbb">—</span>';
  if (typeof valor === 'boolean') {
    return valor
      ? '<span style="color:#27ae60"><i class="fa fa-check"></i> Sim</span>'
      : '<span style="color:#e74c3c"><i class="fa fa-times"></i> Não</span>';
  }
  if (typeof valor === 'object') {
    return `<code style="font-size:11px">${esc(String(JSON.stringify(valor)))}</code>`;
  }
  return esc(String(valor));
}

function _renderAtributosCard(dispositivoId, data) {
  if (!_cardAdminExpandido) return;
  const card = document.getElementById('device-attrs-card');
  if (!card || ativoId !== dispositivoId) return;

  const attrs = data?.posicao?.atributos || {};
  const linhas = [];
  Object.keys(ATTR_INFO_CARD).forEach(k => {
    if (attrs[k] !== undefined) linhas.push([k, ATTR_INFO_CARD[k][1], attrs[k]]);
  });
  Object.keys(attrs).forEach(k => {
    if (!ATTR_INFO_CARD[k]) linhas.push([k, k, attrs[k]]);
  });

  card.innerHTML = `
    <div class="dattrs-header">
      <span><i class="fa fa-list-alt fa-fw"></i> Atributos Da Posição</span>
      <button type="button" class="dcard-tray-toggle dattrs-toggle" onclick="toggleAtributosTray()" title="Fechar bandeja de atributos">
        <i class="fa fa-chevron-left"></i> Fechar
      </button>
    </div>
    <div class="dattrs-body">
      ${linhas.length ? `
        <table class="dattrs-table">
          <tbody>
            ${linhas.map(l => `<tr><td>${esc(l[0])}</td><td>${esc(l[1])}</td><td>${_fmtAtributoCard(l[2])}</td></tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="dattrs-empty">Sem atributos de posição para exibir.</div>'}
    </div>
  `;
  _aplicarEstadoTrayAtributos();
}

function _carregarAtributosCard(dispositivoId, force) {
  if (!_cardAdminExpandido) return;
  const card = document.getElementById('device-attrs-card');
  if (!card) return;

  if (!force && _detalheDispositivoCache[dispositivoId]) {
    _renderAtributosCard(dispositivoId, _detalheDispositivoCache[dispositivoId]);
    return;
  }
  if (_detalheDispositivoPendentes[dispositivoId]) return;

  if (!_detalheDispositivoCache[dispositivoId] && _attrsTrayOpen) {
    card.innerHTML = `
      <div class="dattrs-header">
        <span><i class="fa fa-list-alt fa-fw"></i> Atributos Da Posição</span>
        <button type="button" class="dcard-tray-toggle dattrs-toggle" onclick="toggleAtributosTray()" title="Fechar bandeja de atributos">
          <i class="fa fa-chevron-left"></i> Fechar
        </button>
      </div>
      <div class="dattrs-body"><div class="dattrs-empty"><i class="fa fa-spinner fa-spin"></i> Carregando atributos...</div></div>
    `;
    _aplicarEstadoTrayAtributos();
  }

  _detalheDispositivoPendentes[dispositivoId] = true;
  window.AL.apiGet(`/api/rastreamento/dispositivos/${dispositivoId}/detalhe`)
    .then(data => {
      _detalheDispositivoCache[dispositivoId] = data;
      _renderAtributosCard(dispositivoId, data);
    })
    .catch(() => {
      if (ativoId !== dispositivoId || _detalheDispositivoCache[dispositivoId]) return;
      card.innerHTML = `
        <div class="dattrs-header">
          <span><i class="fa fa-list-alt fa-fw"></i> Atributos Da Posição</span>
          <button type="button" class="dcard-tray-toggle dattrs-toggle" onclick="toggleAtributosTray()" title="Fechar bandeja de atributos">
            <i class="fa fa-chevron-left"></i> Fechar
          </button>
        </div>
        <div class="dattrs-body"><div class="dattrs-empty">Não foi possível carregar os atributos da posição.</div></div>
      `;
      _aplicarEstadoTrayAtributos();
    })
    .finally(() => {
      delete _detalheDispositivoPendentes[dispositivoId];
    });
}

function _agendarAtualizacaoAtributos(dispositivoId) {
  if (!_cardAdminExpandido || ativoId !== dispositivoId || !_attrsTrayOpen) return;
  clearTimeout(_detalheAtributosThrottle[dispositivoId]);
  _detalheAtributosThrottle[dispositivoId] = setTimeout(() => {
    _carregarAtributosCard(dispositivoId, true);
  }, 1200);
}

function _latLngComOffset(posicao, offsetOverride, targetZoom) {
  let offset = 0;
  if (ativoId) {
    offset = Number.isFinite(offsetOverride) ? offsetOverride : ((_cardAdminExpandido && _attrsTrayOpen) ? _cardFocusOffsetPx : _focusOffsetPx);
  }
  if (!offset || !map || !posicao) return [posicao.latitude, posicao.longitude];
  const zoom = Number.isFinite(targetZoom) ? targetZoom : (map.getZoom() || 16);
  const point = map.project([posicao.latitude, posicao.longitude], zoom);
  const centerPoint = L.point(point.x - offset, point.y);
  const target = map.unproject(centerPoint, zoom);
  return [target.lat, target.lng];
}

function _centralizarDispositivo(posicao, zoom = 16, offsetPx = 0, animate = true) {
  if (!map || !posicao) return;
  const destino = offsetPx ? _latLngComOffset(posicao, offsetPx, zoom) : [posicao.latitude, posicao.longitude];
  map.stop();
  map.invalidateSize();
  if (animate) map.flyTo(destino, zoom, { animate: true, duration: 0.45 });
  else map.setView(destino, zoom, { animate: false });
}

function _fmtResumoDuracao(minutos) {
  if (!minutos) return '—';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h ? `${h}h ${m}min` : `${m}min`;
}

function _renderResumoHojeAdmin(dispositivoId) {
  const alvo = document.getElementById(`dcard-resumo-hoje-${dispositivoId}`);
  if (!alvo) return;
  const resumo = _resumoHojeCache[dispositivoId];
  if (!resumo) {
    alvo.innerHTML = '<div style="font-size:11px;color:#999;text-align:center;padding:6px 0">Carregando...</div>';
    return;
  }
  alvo.innerHTML = `
    <div class="dcard-summary-grid">
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.km}</div><div class="dcard-summary-lbl">Distância</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.velMax}</div><div class="dcard-summary-lbl">Vel. Máxima</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.tempo}</div><div class="dcard-summary-lbl">Em Movimento</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${resumo.viagens}</div><div class="dcard-summary-lbl">Viagens</div></div>
    </div>
  `;
  _posicionarBotaoTrayAtributos();
}

function _carregarResumoHojeAdmin(dispositivoId) {
  if (_resumoHojeCache[dispositivoId]) {
    _renderResumoHojeAdmin(dispositivoId);
    return;
  }
  if (_resumoHojePendentes[dispositivoId]) return;
  _resumoHojePendentes[dispositivoId] = true;
  const { inicio, fim } = _intervaloHoje();
  window.AL.apiGet(`/api/rastreamento/dispositivos/${dispositivoId}/viagens?from=${encodeURIComponent(inicio)}&to=${encodeURIComponent(fim)}`)
    .then(viagens => {
      const lista = Array.isArray(viagens) ? viagens : [];
      const totalKm = lista.reduce((s, v) => s + (v.distancia || 0), 0);
      const velMax = lista.reduce((m, v) => Math.max(m, v.velocidadeMaxima || 0), 0);
      const totalMin = lista.reduce((s, v) => s + (v.duracao || 0), 0);
      _resumoHojeCache[dispositivoId] = {
        km: totalKm ? `${totalKm.toFixed(1)} km` : '—',
        velMax: velMax ? `${velMax} km/h` : '—',
        tempo: totalMin ? _fmtResumoDuracao(totalMin) : '—',
        viagens: String(lista.length || 0),
      };
      _renderResumoHojeAdmin(dispositivoId);
    })
    .catch(() => {
      _resumoHojeCache[dispositivoId] = { km: '—', velMax: '—', tempo: '—', viagens: '0' };
      _renderResumoHojeAdmin(dispositivoId);
    })
    .finally(() => {
      delete _resumoHojePendentes[dispositivoId];
    });
}

// Cards de motor ocioso (motor ligado + veículo parado) — pontos com mais de
// 5 min ociosos e tempo total ocioso de hoje.
function _renderOciosoHojeAdmin(dispositivoId) {
  const alvo = document.getElementById(`dcard-ocioso-hoje-${dispositivoId}`);
  if (!alvo) return;
  const dados = _ociosoHojeCache[dispositivoId];
  // Enquanto carrega (cache indefinido) não renderiza nada.
  if (!dados) { alvo.innerHTML = ''; return; }
  const min = dados.minutos;
  alvo.innerHTML = `
    <div class="dcard-summary-grid">
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${dados.paradas}</div><div class="dcard-summary-lbl">Pontos Ocioso &gt; 5min</div></div>
      <div class="dcard-summary-stat"><div class="dcard-summary-val">${min ? `${min} min` : '—'}</div><div class="dcard-summary-lbl">Tempo Motor Ocioso</div></div>
    </div>`;
  _posicionarBotaoTrayAtributos();
}

function _carregarOciosoHojeAdmin(dispositivoId) {
  if (_ociosoHojeCache[dispositivoId] != null) {
    _renderOciosoHojeAdmin(dispositivoId);
    return;
  }
  if (_ociosoHojePendentes[dispositivoId]) return;
  _ociosoHojePendentes[dispositivoId] = true;
  const { inicio, fim } = _intervaloHoje();
  window.AL.apiGet(`/api/rastreamento/dispositivos/${dispositivoId}/ocioso?from=${encodeURIComponent(inicio)}&to=${encodeURIComponent(fim)}`)
    .then(data => {
      const segs = Array.isArray(data?.segmentos) ? data.segmentos : [];
      const paradas = segs.filter(s => (Number(s.duracaoMin) || 0) > 5).length;
      _ociosoHojeCache[dispositivoId] = { minutos: Number(data?.totalMinutos) || 0, paradas };
      _renderOciosoHojeAdmin(dispositivoId);
    })
    .catch(() => {
      _ociosoHojeCache[dispositivoId] = { minutos: 0, paradas: 0 };
      _renderOciosoHojeAdmin(dispositivoId);
    })
    .finally(() => {
      delete _ociosoHojePendentes[dispositivoId];
    });
}

// ── Card do dispositivo (flutuante sobre o mapa) ──────────────────────────────

function _buildManutencoesAdminHtml(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  const recs = _manutencoesAdminCache[dispositivoId] || [];
  if (!recs.length) return '';

  const isDark = document.documentElement.classList.contains('dark-theme');
  const btnBg = isDark ? '#2d3748' : '#e9ecef';
  const btnBd = isDark ? '#4a5568' : '#ccc';
  const btnClr = isDark ? '#cbd5e0' : '#555';
  const btnStyle = `background:${btnBg};border:1px solid ${btnBd};border-radius:4px;padding:2px 6px;cursor:pointer;color:${btnClr};font-size:10px;line-height:1;`;
  const p = v?.posicao;
  const visiveis = recs.filter(r => {
    if (r.ativa === false) return false;
    const odometroM = r.dispositivo?.odometroSistemaMetros ?? (p?.odometro ?? null);
    if (odometroM == null) return false;
    const kmRestante = Math.round(r.intervaloKm - (odometroM / 1000 - r.kmBase));
    return kmRestante <= 1000;
  });
  if (!visiveis.length) return '';

  return `
    <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
      <div class="dcard-section-title">Manutenções</div>
      ${visiveis.map(r => {
        const odometroM = r.dispositivo?.odometroSistemaMetros ?? (p?.odometro ?? 0);
        const kmRestante = Math.round(r.intervaloKm - (odometroM / 1000 - r.kmBase));
        const atrasada = kmRestante < 0;
        const kmAbs = Math.abs(kmRestante);
        const cor = atrasada ? '#e74c3c' : '#f39c12';
        const texto = atrasada
          ? `Ultrapassou ${kmAbs.toLocaleString('pt-BR')} km da(o) ${esc(r.titulo)}`
          : `Faltam ${kmAbs.toLocaleString('pt-BR')} km para ${esc(r.titulo)}`;
        return `<span style="color:${cor};display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-bottom:2px;"><i class="fa fa-wrench" style="flex-shrink:0;"></i>${texto}<button onclick="abrirModalFeitoCardAdmin('${r.id}','${String(r.titulo || '').replace(/'/g, "\\'")}')" style="${btnStyle};margin-left:4px;" title="Confirmar manutencao"><i class="fa fa-check"></i></button></span>`;
      }).join('<br>')}
    </div>`;
}

function _renderManutencoesCardAdmin(dispositivoId) {
  const alvo = document.getElementById(`dcard-manutencoes-wrap-${dispositivoId}`);
  if (!alvo) return;
  alvo.innerHTML = _buildManutencoesAdminHtml(dispositivoId);
  _posicionarBotaoTrayAtributos();
}

function _carregarManutencoesCardAdmin(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v?.clienteLoginId) return;
  if (_manutencoesAdminCache[dispositivoId]) {
    _renderManutencoesCardAdmin(dispositivoId);
    return;
  }
  if (_manutencoesAdminPendentes[dispositivoId]) return;
  _manutencoesAdminPendentes[dispositivoId] = true;
  window.AL.apiGet(`/api/manutencoes-admin/clientes/${encodeURIComponent(v.clienteLoginId)}/recorrencias?dispositivoId=${encodeURIComponent(dispositivoId)}`)
    .then(data => {
      _manutencoesAdminCache[dispositivoId] = (data || []).filter(r => r.ativa !== false);
      _renderManutencoesCardAdmin(dispositivoId);
    })
    .catch(() => {
      _manutencoesAdminCache[dispositivoId] = [];
      _renderManutencoesCardAdmin(dispositivoId);
    })
    .finally(() => {
      delete _manutencoesAdminPendentes[dispositivoId];
    });
}

window.abrirModalFeitoCardAdmin = function(recId, titulo) {
  const el = document.getElementById('modal-feito-card-titulo');
  if (el) el.textContent = titulo || 'esta manutenção';
  const header = document.querySelector('#modalFeitoCard .modal-header');
  if (header) header.style.background = '#27ae60';
  const titleEl = document.querySelector('#modalFeitoCard .modal-title');
  if (titleEl) titleEl.innerHTML = '<i class="fa fa-check-circle"></i> Confirmar Manutenção';
  const warnP = document.querySelector('#modalFeitoCard .modal-body p:nth-child(2)');
  if (warnP) warnP.innerHTML = '<i class="fa fa-exclamation-triangle"></i> O contador será reiniciado a partir do odômetro atual.';
  const btn = document.getElementById('btn-modal-feito-card-confirmar');
  if (btn) btn.onclick = function() { window._executarFeitoCardAdmin(recId); };
  $('#modalFeitoCard').modal('show');
};

window._executarFeitoCardAdmin = function(recId) {
  const dispositivoId = ativoId;
  const v = dispositivoId ? veiculosMap[dispositivoId] : null;
  if (!v?.clienteLoginId) return;
  $('#modalFeitoCard').modal('hide');
  window.AL.apiPost(`/api/manutencoes-admin/clientes/${encodeURIComponent(v.clienteLoginId)}/recorrencias/${encodeURIComponent(recId)}/feito`, {})
    .then(function() {
      window.AL.showAlert('Manutencao confirmada! Contador reiniciado.', 'success');
      delete _manutencoesAdminCache[dispositivoId];
      _carregarManutencoesCardAdmin(dispositivoId);
    })
    .catch(function(err) { window.AL.showAlert('Erro: ' + (err.message || 'tente novamente.')); });
};

function _buildManutencoesDataAdminHtml(dispositivoId) {
  const recs = _manutencoesDataAdminCache[dispositivoId] || [];
  const isDark = document.documentElement.classList.contains('dark-theme');
  const btnBg = isDark ? '#2d3748' : '#e9ecef';
  const btnBd = isDark ? '#4a5568' : '#ccc';
  const btnClr = isDark ? '#cbd5e0' : '#555';
  const btnStyle = `background:${btnBg};border:1px solid ${btnBd};border-radius:4px;padding:2px 6px;cursor:pointer;color:${btnClr};font-size:10px;line-height:1;`;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const visibles = recs.filter(r => {
    if (r.ativa === false) return false;
    const dp = String(r.dataReferencia).slice(0, 10).split('-');
    const dataRec = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]));
    return dataRec <= hoje;
  });
  if (!visibles.length) return '';
  return `
    <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
      <div class="dcard-section-title">Recorrências por Data</div>
      ${visibles.map(r => {
        const _dpR = String(r.dataReferencia).slice(0, 10).split('-');
        const dataRec = new Date(Number(_dpR[0]), Number(_dpR[1]) - 1, Number(_dpR[2]));
        const atrasada = dataRec < hoje;
        const cor = atrasada ? '#e74c3c' : '#8e44ad';
        const fmtData = _dpR[2] + '/' + _dpR[1];
        const texto = atrasada
          ? `Atrasada: ${esc(r.titulo)} (${fmtData})`
          : `Hoje: ${esc(r.titulo)}`;
        return `<span style="color:${cor};display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-bottom:2px;"><i class="fa fa-calendar" style="flex-shrink:0;"></i>${texto}<button onclick="abrirModalFeitoCardDataAdmin('${r.id}','${String(r.titulo || '').replace(/'/g, "\\'")}')" style="${btnStyle};margin-left:4px;" title="Confirmar manutenção"><i class="fa fa-check"></i></button></span>`;
      }).join('<br>')}
    </div>`;
}

function _renderManutencoesDataCardAdmin(dispositivoId) {
  const alvo = document.getElementById(`dcard-manutencoes-data-wrap-${dispositivoId}`);
  if (!alvo) return;
  alvo.innerHTML = _buildManutencoesDataAdminHtml(dispositivoId);
  _posicionarBotaoTrayAtributos();
}

function _carregarManutencoesDataCardAdmin(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v?.clienteLoginId) return;
  if (_manutencoesDataAdminCache[dispositivoId]) {
    _renderManutencoesDataCardAdmin(dispositivoId);
    return;
  }
  if (_manutencoesDataAdminPendentes[dispositivoId]) return;
  _manutencoesDataAdminPendentes[dispositivoId] = true;
  window.AL.apiGet(`/api/manutencoes-admin/clientes/${encodeURIComponent(v.clienteLoginId)}/recorrencias-data?dispositivoId=${encodeURIComponent(dispositivoId)}`)
    .then(data => {
      _manutencoesDataAdminCache[dispositivoId] = (data || []).filter(r => r.ativa !== false);
      _renderManutencoesDataCardAdmin(dispositivoId);
    })
    .catch(() => {
      _manutencoesDataAdminCache[dispositivoId] = [];
      _renderManutencoesDataCardAdmin(dispositivoId);
    })
    .finally(() => {
      delete _manutencoesDataAdminPendentes[dispositivoId];
    });
}

window.abrirModalFeitoCardDataAdmin = function(recId, titulo) {
  const el = document.getElementById('modal-feito-card-titulo');
  if (el) el.textContent = titulo || 'esta recorrência';
  const header = document.querySelector('#modalFeitoCard .modal-header');
  if (header) header.style.background = '#8e44ad';
  const titleEl = document.querySelector('#modalFeitoCard .modal-title');
  if (titleEl) titleEl.innerHTML = '<i class="fa fa-calendar-check-o"></i> Confirmar Recorrência por Data';
  const warnP = document.querySelector('#modalFeitoCard .modal-body p:nth-child(2)');
  if (warnP) warnP.innerHTML = '<i class="fa fa-calendar"></i> A próxima ocorrência será agendada automaticamente.';
  const btn = document.getElementById('btn-modal-feito-card-confirmar');
  if (btn) btn.onclick = function() { window._executarFeitoCardDataAdmin(recId); };
  $('#modalFeitoCard').modal('show');
};

window._executarFeitoCardDataAdmin = function(recId) {
  const dispositivoId = ativoId;
  const v = dispositivoId ? veiculosMap[dispositivoId] : null;
  if (!v?.clienteLoginId) return;
  $('#modalFeitoCard').modal('hide');
  window.AL.apiPost(`/api/manutencoes-admin/clientes/${encodeURIComponent(v.clienteLoginId)}/recorrencias-data/${encodeURIComponent(recId)}/feito`, {})
    .then(function() {
      window.AL.showAlert('Manutenção por data confirmada!', 'success');
      delete _manutencoesDataAdminCache[dispositivoId];
      _carregarManutencoesDataCardAdmin(dispositivoId);
    })
    .catch(function(err) { window.AL.showAlert('Erro: ' + (err.message || 'tente novamente.')); });
};

function mostrarCardDispositivo(id) {
  const v = veiculosMap[id];
  if (!v) return;

  const mesmoDispositivo = ativoId === id;
  ativoId = id;
  if (!mesmoDispositivo) _attrsTrayOpen = false;
  _salvarFocoAdmin(id);
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
    ? `<img src="${apiBase}${v.imagemUrl}" style="width:100%;height:120px;object-fit:cover;display:block;border-radius:10px 10px 0 0" onerror="this.style.display='none'" />`
    : '';
  const rastreadorInfo = [];
  if (v.telefoneRastreador) rastreadorInfo.push(`<span><i class="fa fa-phone"></i> ${esc(v.telefoneRastreador)}</span>`);
  if (v.operadora) rastreadorInfo.push(`<span><i class="fa fa-signal"></i> ${esc(v.operadora)}</span>`);

  const si = [];
  if (p?.ignicao === true)  si.push(`<span style="color:#27ae60"><i class="fa fa-key"></i> Ignição: Ligado</span>`);
  if (p?.ignicao === false) si.push(`<span style="color:#bdc3c7"><i class="fa fa-key"></i> Ignição: Desligado</span>`);
  if (bat != null)          si.push(`<span style="color:${batCor}"><i class="fa ${batFa}"></i> Bateria: ${bat}%</span>`);
  if (p?.tensao != null)    si.push(`<span style="color:#8e44ad"><i class="fa fa-bolt"></i> Tensão: ${p.tensao.toFixed(1)} V</span>`);
  if (p?.odometro != null)  si.push(`<span><i class="fa fa-tachometer" style="color:#7f8c8d"></i> Odômetro: ${Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km${_podeEditarMedidores ? ` <button type="button" onclick="abrirModalMedidores('${v.dispositivoId}')" title="Editar odômetro e motor" style="border:none;background:none;color:#2980b9;padding:0 0 0 6px"><i class="fa fa-pencil"></i></button>` : ''}</span>`);
  if (p?.horas_motor != null) si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h${_podeEditarMedidores ? ` <button type="button" onclick="abrirModalMedidores('${v.dispositivoId}')" title="Editar odômetro e motor" style="border:none;background:none;color:#2980b9;padding:0 0 0 6px"><i class="fa fa-pencil"></i></button>` : ''}</span>`);
  if (v?.motorista?.nome) si.push(`<span><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> Motorista: ${v.motorista.nome}</span>`);
  else if (p?.motorista_id) si.push(`<span><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> Motorista ID: ${p.motorista_id}</span>`);
  if (p?.bloqueado != null) si.push(`<span style="color:${p.bloqueado ? '#e74c3c' : '#27ae60'}"><i class="fa fa-${p.bloqueado ? 'lock' : 'unlock'}"></i> ${p.bloqueado ? 'Bloqueado' : 'Desbloqueado'}</span>`);

  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';
  const horasHtml = p ? `
    <div class="dcard-section dcard-val">
      <div class="dcard-section-title">Última Atualização</div>
      <div style="margin-bottom:2px"><i class="fa fa-server" style="${ico}"></i> <span class="dcard-lbl">Servidor:</span> <span id="dcard-ts-srv">${fmtGPSTimeSec(p.serverTime)}</span></div>
      <div style="margin-bottom:2px"><i class="fa fa-mobile" style="${ico}"></i> <span class="dcard-lbl">Dispositivo:</span> <span id="dcard-ts-dev">${fmtGPSTimeSec(p.deviceTime)}</span></div>
      <div><i class="fa fa-crosshairs" style="${ico}"></i> <span class="dcard-lbl">GPS:</span> <span id="dcard-ts-gps">${fmtGPSTimeSec(p.fixTime)}</span></div>
    </div>` : '';

  const card = document.getElementById('device-detail-card');
  const isDark = document.documentElement.classList.contains('dark-theme');
  const tagBg = isDark ? '#2d3748' : '#f0f2f5';
  const tagColor = isDark ? '#adb5bd' : '#666';

  card.innerHTML = `
    <div id="tracking-drawer-handle"></div>
    ${imgHtml}
    <div class="dcard-header">
      <div style="flex:1;min-width:0">
        <div class="v-nome">${v.nome}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          ${v.placa ? `<span class="v-placa">${v.placa}</span>` : ''}
          ${v.identificador ? `<span class="v-placa" style="font-family:monospace;background:${tagBg};color:${tagColor}">${v.identificador}</span>` : ''}
          <a href="dispositivo-detalhe.html?id=${v.dispositivoId}" title="Mais detalhes" style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;background:#e8f4fd;border-radius:50%;color:#2980b9;font-size:11px;text-decoration:none;" class="btn-dcard-gear">
            <i class="fa fa-cog"></i>
          </a>
        </div>
      </div>
      <button class="dcard-fechar" onclick="fecharCardDispositivo()" title="Fechar">×</button>
    </div>
    <div class="dcard-body">
      ${v.cliente ? `<div style="font-size:12px;color:#888;margin-bottom:4px"><i class="fa fa-user" style="color:#2980b9;width:13px"></i> ${v.cliente.nome}</div>` : ''}
      ${rastreadorInfo.length ? `<div class="dcard-tracker-meta">${rastreadorInfo.join('')}</div>` : ''}
      <div style="margin-bottom:6px">
        <span id="dcard-status-line" style="color:${corStatus}"><i class="fa fa-circle" style="font-size:9px;vertical-align:middle"></i> ${txtStatus}${tempoSufixo}</span>
        ${!p ? '&nbsp;<span style="color:#e67e22;font-size:11px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : ''}
      </div>
      <div id="dcard-velocimetro">${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}</div>
      <hr id="dcard-divider-speed" style="margin:2px 0 6px;border:none;border-top:1px solid rgba(128,128,128,0.15)${p?.velocidade != null ? '' : ';display:none'}">
      <div class="dcard-section-title">Informações do Dispositivo</div>
      <div id="dcard-status-items" style="font-size:12px;display:flex;flex-direction:column;gap:3px;margin-bottom:8px">${si.join('')}</div>
      ${horasHtml}
      ${v.clienteLoginId ? `<div id="dcard-manutencoes-wrap-${id}"></div>` : ''}
      ${v.clienteLoginId ? `<div id="dcard-manutencoes-data-wrap-${id}"></div>` : ''}
      ${p ? `<div class="dcard-section dcard-val" style="line-height:1.4">
            <div class="dcard-section-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              Endereço
              <div id="dcard-addr-actions-${id}" style="display:flex;gap:4px">
                ${_htmlBotaoGoogleMaps(p.latitude, p.longitude, hasCached ? cachedAddr : null)}
                ${_htmlBotaoStreetView(p.latitude, p.longitude)}
              </div>
            </div>
            <div id="${addrId}" data-lat="${p.latitude}" data-lng="${p.longitude}" data-cache-key="${cacheKey || ''}" style="font-size:11px">${addrTxt}</div>
          </div>` : ''}
      <div style="margin-top:10px;display:flex;gap:6px">
        <a href="relatorio.html?id=${v.dispositivoId}" class="btn btn-xs btn-primary" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;width:100%;text-align:center;">
          <i class="fa fa-bar-chart"></i>  Relatório
        </a>
        <a href="${_urlDetalheRastreamentoAdmin(v.dispositivoId)}" class="btn btn-xs btn-default" style="flex:1;text-align:center; border-radius:10px;">
          <i class="fa fa-history"></i> Histórico
        </a>
      </div>
      ${_htmlAcoesCard(v.dispositivoId)}
    </div>
  `;

  card.style.display = 'block';
  card.style.display = 'flex';
  _fecharTrackingDrawer();
  _prepararTrackingDrawer();
  _ajustarAlturaCardDispositivo();
 
  if (_cardAdminExpandido) {
    const body = card.querySelector('.dcard-body');
    const acoesRapidas = body ? Array.from(body.children).find(el => el.tagName === 'DIV' && el.getAttribute('style') && el.getAttribute('style').indexOf('display:flex;gap:6px') !== -1) : null;
    if (acoesRapidas) {
      acoesRapidas.outerHTML = `<a href="relatorio.html?id=${v.dispositivoId}" class="btn btn-xs btn-primary" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;width:100%;text-align:center;"><i class="fa fa-bar-chart"></i>  Relatório</a>`;
    }
    const acoesSection = body ? Array.from(body.children).find(el => el.innerHTML && el.innerHTML.indexOf('A') !== -1 && el.innerHTML.indexOf('dcard-acao') !== -1) : null;
    if (acoesSection && !body.querySelector(`#dcard-resumo-hoje-${id}`)) {
      acoesSection.insertAdjacentHTML('afterend', `
        <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
          <div class= "dcard-section-title-title">RESUMO DE HOJE</div>
          <div id="dcard-resumo-hoje-${id}"><div style="font-size:11px;color:#999;text-align:center;padding:6px 0">Carregando...</div></div>
          <div id="dcard-ocioso-hoje-${id}"></div>
          <div style="margin-top:10px">
            <a href="${_urlDetalheRastreamentoAdmin(v.dispositivoId)}" class="btn btn-xs btn-warning" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;width:100%;text-align:center;">
              <i class="fa fa-history"></i> Ver Mais
            </a>
          </div>
        </div>
      `);
    }
  }
  if (_attrsTrayOpen) _carregarAtributosCard(id, false);
  _aplicarEstadoTrayAtributos();
  _posicionarBotaoTrayAtributos();
  _carregarResumoHojeAdmin(id);
  _carregarOciosoHojeAdmin(id);
  _carregarManutencoesCardAdmin(id);
  _carregarManutencoesDataCardAdmin(id);

  if (p && !hasCached) {
    geocodificarCoordenadas(p.latitude, p.longitude, addrId);
  }

  // Verifica se tem cerca para ativar o botão
  window.AL.apiGet(`/api/rastreamento/dispositivos/${id}/cercas`).then(cercas => {
    const btn = document.querySelector('.dcard-acao[data-acao="cerca"]');
    if (btn) btn.classList.toggle('ativo', cercas.length > 0);
  }).catch(() => {});
}

function _htmlAcoesCard(dispositivoId) {
  const temRota = !!_rotasIndividuais[dispositivoId];
  return `
    <div style="border-top:1px solid rgba(128,128,128,.15);margin-top:10px;padding-top:10px">
      <div class= "dcard-section-title-title">AÇÕES</div>
      <div style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap">
        <button class="dcard-acao" data-acao="seguir" onclick="acaoDispositivo('seguir','${dispositivoId}')" title="Seguir veículo">
          <div class="dcard-acao-icon"><i class="fa fa-location-arrow"></i></div>
          <span>Seguir</span>
        </button>
        <button class="dcard-acao${temRota ? ' ativo' : ''}" data-acao="rota" onclick="acaoDispositivo('rota','${dispositivoId}')" title="Rota">
          <div class="dcard-acao-icon"><i class="fa fa-road"></i></div>
          <span>Rota</span>
        </button>
        <button class="dcard-acao" data-acao="compartilhar" onclick="acaoDispositivo('compartilhar','${dispositivoId}')" title="Compartilhar link de acompanhamento">
          <div class="dcard-acao-icon"><i class="fa fa-share-alt"></i></div>
          <span>Compartilhar</span>
        </button>
        <button class="dcard-acao" data-acao="comando" onclick="acaoDispositivo('comando','${dispositivoId}')" title="Comando">
          <div class="dcard-acao-icon"><i class="fa fa-terminal"></i></div>
          <span>Comando</span>
        </button>
        <button class="dcard-acao" data-acao="cerca" onclick="acaoDispositivo('cerca','${dispositivoId}')" title="Criar Cerca">
          <div class="dcard-acao-icon"><i class="fa fa-circle-o"></i></div>
          <span>Cerca</span>
        </button>
      </div>
    </div>`;
}

async function compartilharDispositivo(dispositivoId) {
  const btn = document.querySelector('.dcard-acao[data-acao="compartilhar"]');
  if (btn) { btn.disabled = true; btn.querySelector('i').className = 'fa fa-spinner fa-spin'; }
  try {
    const data = await window.AL.apiPost('/api/compartilhamento/gerar', { dispositivoId });
    const siteBase = window.location.pathname.replace(/\/(?:admin|cliente|colaborador)\/[^/]+$/, '/');
    const link = `${window.location.origin}${siteBase}rastreamento-publico.html?token=${data.token}`;
    try {
      await navigator.clipboard.writeText(link);
      window.AL.showAlert('Link de acompanhamento copiado!', 'success');
    } catch {
      prompt('Copie o link de acompanhamento:', link);
    }
  } catch (err) {
    window.AL.showAlert('Erro ao gerar link: ' + (err.message || 'Tente novamente.'), 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('i').className = 'fa fa-share-alt'; }
  }
}

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
  const attrsCard = document.getElementById('device-attrs-card');
  _attrsTrayOpen = false;
  if (attrsCard) {
    attrsCard.classList.remove('aberto');
    attrsCard.style.display = 'none';
  }
  ativoId = null;
  _limparFocoAdmin();
  _aplicarEstadoTrayAtributos();
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
    if (p?.odometro != null)  si.push(`<span><i class="fa fa-tachometer" style="color:#7f8c8d"></i> Odômetro: ${Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km${_podeEditarMedidores ? ` <button type="button" onclick="abrirModalMedidores('${v.dispositivoId}')" title="Editar odômetro e motor" style="border:none;background:none;color:#2980b9;padding:0 0 0 6px"><i class="fa fa-pencil"></i></button>` : ''}</span>`);
    if (p?.horas_motor != null) si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h${_podeEditarMedidores ? ` <button type="button" onclick="abrirModalMedidores('${v.dispositivoId}')" title="Editar odômetro e motor" style="border:none;background:none;color:#2980b9;padding:0 0 0 6px"><i class="fa fa-pencil"></i></button>` : ''}</span>`);
    if (v?.motorista?.nome) si.push(`<span><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> Motorista: ${v.motorista.nome}</span>`);
    else if (p?.motorista_id) si.push(`<span><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> Motorista ID: ${p.motorista_id}</span>`);
    if (p?.bloqueado != null) si.push(`<span style="color:${p.bloqueado ? '#e74c3c' : '#27ae60'}"><i class="fa fa-${p.bloqueado ? 'lock' : 'unlock'}"></i> ${p.bloqueado ? 'Bloqueado' : 'Desbloqueado'}</span>`);
    elSI.innerHTML = si.join('');
  }

  const tsSrv = document.getElementById('dcard-ts-srv');
  const tsDev = document.getElementById('dcard-ts-dev');
  const tsGps = document.getElementById('dcard-ts-gps');
  if (tsSrv && p) tsSrv.textContent = fmtGPSTimeSec(p.serverTime);
  if (tsDev && p) tsDev.textContent = fmtGPSTimeSec(p.deviceTime);
  if (tsGps && p) tsGps.textContent = fmtGPSTimeSec(p.fixTime);

  _atualizarEnderecoCardAtivo(dispositivoId, p);

  if (modoFoco && v?.posicao) {
    const trackOff = _eventoPopupAtualIdx !== null ? _eventPopupOffsetPx : undefined;
    map.panTo(_latLngComOffset(v.posicao, trackOff, 16), { animate: true, duration: 0.5 });
  }
  _posicionarBotaoTrayAtributos();
  _agendarAtualizacaoAtributos(dispositivoId);
  _renderManutencoesCardAdmin(dispositivoId);
}

function _atualizarEnderecoCardAtivo(dispositivoId, p) {
  if (!p) return;
  const addrEl = document.getElementById(`dcard-addr-${dispositivoId}`);
  if (!addrEl) return;
  const cacheKey = `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
  if (addrEl.dataset.cacheKey === cacheKey && !p.endereco) return;

  addrEl.dataset.lat = p.latitude;
  addrEl.dataset.lng = p.longitude;
  addrEl.dataset.cacheKey = cacheKey;

  const actionsEl = document.getElementById(`dcard-addr-actions-${dispositivoId}`);
  if (actionsEl) {
    const cachedNow = p.endereco || _geocodeCache[cacheKey] || null;
    actionsEl.innerHTML = _htmlBotaoGoogleMaps(p.latitude, p.longitude, cachedNow)
      + _htmlBotaoStreetView(p.latitude, p.longitude);
  }

  if (p.endereco) {
    _geocodeCache[cacheKey] = p.endereco;
    addrEl.innerHTML = `<i class="fa fa-map-marker"></i> ${p.endereco}`;
  } else if (cacheKey in _geocodeCache) {
    const cached = _geocodeCache[cacheKey];
    const coords = `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`;
    addrEl.innerHTML = `<i class="fa fa-map-marker"></i> ${cached || coords}`;
  } else {
    geocodificarCoordenadas(p.latitude, p.longitude, `dcard-addr-${dispositivoId}`);
  }
}

// ── Modo foco ─────────────────────────────────────────────────────────────────

function ativarFoco(id) {
  modoFoco = true;
  _fecharSpider();
  Object.values(_clusterBadges).forEach(b => { if (map.hasLayer(b)) map.removeLayer(b); });
  Object.keys(marcadores).forEach(mid => {
    if (mid !== id && map.hasLayer(marcadores[mid])) map.removeLayer(marcadores[mid]);
  });
  if (!marcadores[id]) renderMarcadores();
  if (marcadores[id] && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
}

function desativarFoco() {
  modoFoco = false;
  _fecharSpider();
  renderMarcadores();
}

// ── Foco / Interações ─────────────────────────────────────────────────────────

window.focar = function (dispositivoId, opts = {}) {
  const prevAtivoId = ativoId;
  _salvarFocoAdmin(dispositivoId);
  mostrarCardDispositivo(dispositivoId);

  if (_overlay.labels && prevAtivoId && prevAtivoId !== dispositivoId && marcadores[prevAtivoId]) {
    const mp = marcadores[prevAtivoId];
    const vp = veiculosMap[prevAtivoId];
    if (vp) _bindLabelVeiculo(mp, _textoLabelVeiculo(vp));
    if (mp.getTooltip()) mp.openTooltip();
  }
  if (_overlay.labels && marcadores[dispositivoId]) {
    _removerLabelVeiculo(marcadores[dispositivoId]);
  }

  const v = veiculosMap[dispositivoId];
  if (!v?.posicao) return;

  ativarFoco(dispositivoId);
  if (_overlay.labels) _removerLabelVeiculo(marcadores[dispositivoId]);
  _centralizarDispositivo(v.posicao, 16, opts.offsetPx || 0);

  setTimeout(() => {
    if (opts.abrirPopup === false) return;
    if (_mostrarPopup && marcadores[dispositivoId] && map.hasLayer(marcadores[dispositivoId])) {
      const marker = marcadores[dispositivoId];
      const className = marker.getPopup()?.options?.className || '';
      if (className.includes('popup-evento-moderno')) {
        _restaurarPopupVeiculoAdmin(dispositivoId);
      }
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

// ── Geocodificação reversa ────────────────────────────────────────────────────

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

  const updateLink = (endereco) => {
    const btnMaps = document.getElementById(`btn-maps-${lat}-${lng}`);
    if (btnMaps) btnMaps.href = _urlGoogleMaps(lat, lng, endereco);
  };
  const hideCoords = () => {
    const coordsEl = document.getElementById(elementId + '-coords');
    if (coordsEl) coordsEl.style.display = 'none';
  };

  if (cacheKey in _geocodeCache) {
    const cached = _geocodeCache[cacheKey];
    el.innerHTML = `<i class="fa fa-map-marker"></i> ${cached || coords}`;
    if (cached) hideCoords();
    updateLink(cached);
    return;
  }

  try {
    const data = await window.AL.apiGet(`/api/rastreamento/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`);
    const end = data.endereco || '';
    _geocodeCache[cacheKey] = end;
    el.innerHTML = `<i class="fa fa-map-marker"></i> ${end || coords}`;
    if (end) hideCoords();
    updateLink(end);
  } catch {
    el.innerHTML = `<i class="fa fa-map-marker"></i> ${coords}`;
    updateLink(null);
  }
};
