'use strict';

let map;
let polylineRota = null;
let polylineDestaque = null;
let marcadorInicio = null;
let marcadorFim = null;
let marcadorAtual = null;
let marcadoresParadaLayer = null;
let marcadoresOciosoLayer = null;
let routePlayerControl = null;
let routePlayerMarker = null;
let routePlayerTimer = null;
let routePlayerFrame = null;
let routePlayerPath = [];
let routePlayerIndex = 0;
let historicoCache = [];
let _googleMapLayers = {};
let _googleMapType = 'roadmap';
let _googleMapTypeControl = null;

const GOOGLE_MAP_TYPES = {
  roadmap: { label: 'Mapa', icon: 'fa-map-o', lyrs: 'm' },
  satellite: { label: 'Satélite', icon: 'fa-globe', lyrs: 's' },
  hybrid: { label: 'Híbrido', icon: 'fa-clone', lyrs: 'y' },
  terrain: { label: 'Terreno', icon: 'fa-area-chart', lyrs: 'p' },
};

const urlParams = new URLSearchParams(window.location.search);
const dispositivoId = urlParams.get('id');
const backUrl = urlParams.get('back');

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  if (!dispositivoId) {
    mostrarErro('ID do dispositivo não informado na URL.');
    return;
  }
  const btnBack = document.getElementById('btn-back-rastreamento');
  if (btnBack && backUrl) btnBack.href = backUrl;
  inicializarMapa();
  configurarPeriodo();
  carregarDados();
  document.getElementById('btn-pdf').addEventListener('click', () => window.print());
});

function inicializarMapa() {
  map = L.map('mapa-detalhe', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);
  _googleMapLayers = _criarCamadasGoogle();

  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>', maxNativeZoom: 19, maxZoom: 21 }
  );

  _googleMapLayers.roadmap.addTo(map);

  L.control.layers(
    { 'Google Maps': _googleMapLayers.roadmap, 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);
  _adicionarControleTipoGoogle();

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.on('baselayerchange', function () {
    _atualizarControleTipoGoogle();
  });
  marcadoresParadaLayer = L.layerGroup().addTo(map);
  inicializarRoutePlayerControl();

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
        menu.style.display = abrindo ? 'block' : 'none';
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

// ── Seletor de período ────────────────────────────────────────────────────────

function configurarPeriodo() {
  setHoje();
  document.getElementById('btn-hoje').addEventListener('click', () => { setHoje(); carregarDados(); });
  document.getElementById('btn-ontem').addEventListener('click', () => { setOntem(); carregarDados(); });
  document.getElementById('btn-7dias').addEventListener('click', () => { set7Dias(); carregarDados(); });
  document.getElementById('btn-buscar').addEventListener('click', () => { setAtivo(null); carregarDados(); });

  document.getElementById('input-from').addEventListener('change', () => setAtivo(null));
  document.getElementById('input-to').addEventListener('change', () => setAtivo(null));
}

function setHoje() {
  const s = dataStr(new Date());
  document.getElementById('input-from').value = s;
  document.getElementById('input-to').value = s;
  setAtivo('btn-hoje');
}

function setOntem() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const s = dataStr(d);
  document.getElementById('input-from').value = s;
  document.getElementById('input-to').value = s;
  setAtivo('btn-ontem');
}

function set7Dias() {
  const ate = new Date();
  const de = new Date(); de.setDate(de.getDate() - 6);
  document.getElementById('input-from').value = dataStr(de);
  document.getElementById('input-to').value = dataStr(ate);
  setAtivo('btn-7dias');
}

function setAtivo(btnId) {
  ['btn-hoje', 'btn-ontem', 'btn-7dias'].forEach(id => {
    document.getElementById(id).classList.toggle('active', id === btnId);
  });
}

function dataStr(d) {
  // Usa data local (não UTC) para evitar virada de dia pelo fuso horário
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoComFuso(dateStr, fimDoDia) {
  // Inclui o offset local (ex: -03:00) para o backend interpretar corretamente
  const off = new Date().getTimezoneOffset(); // minutos a OESTE do UTC (Brasil = 180)
  const sign = off <= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const min = String(Math.abs(off) % 60).padStart(2, '0');
  const time = fimDoDia ? 'T23:59:59' : 'T00:00:00';
  return `${dateStr}${time}${sign}${h}:${min}`;
}

// ── Ícone por categoria ───────────────────────────────────────────────────────

const _ICONE_CAT = {
  ambulancia:'fa-ambulance', aviao_passageiros:'fa-plane', helicoptero:'fa-plane', drone:'fa-rocket',
  bicicleta:'fa-bicycle', pedicalo:'fa-bicycle',
  motocicleta:'fa-motorcycle', motocicleta_cruzada:'fa-motorcycle',
  taxi:'fa-taxi',
  onibus:'fa-bus', van:'fa-bus', van_campista:'fa-bus', caravana:'fa-bus',
  caixa_estacionaria:'fa-cube', container_20:'fa-cube', container_40:'fa-cube',
  container_tanque:'fa-cube',
  caminhao:'fa-truck', caminhao_trator:'fa-truck', caminhao_bau:'fa-truck',
  caminhao_bomba_concreto:'fa-truck', caminhao_betoneira:'fa-truck',
  caminhao_reboque:'fa-truck', caminhao_reboque_estrado:'fa-truck',
  caminhao_tanque_combustivel:'fa-truck', caminhao_pipa:'fa-truck',
  caminhao_vacuo:'fa-truck', caminhao_bombeiros:'fa-truck', caminhao_esgoto:'fa-truck',
  caminhao_recuperacao:'fa-truck', caminhao_transporte:'fa-truck',
  pickup:'fa-truck', pickup_reboque:'fa-truck', plataforma_reboque:'fa-truck',
  reboque_reefer:'fa-truck', reboque_tanque:'fa-truck', reboque_residuos:'fa-truck',
  reboque_caixa:'fa-truck', reboque_carro:'fa-truck', reboque_container_gerador:'fa-truck',
  reboque_gerador:'fa-truck', retroescavadeira:'fa-truck', escavadeira:'fa-truck',
  escavadora:'fa-truck', empilhadeira:'fa-truck', trator:'fa-truck', aclo_compressor:'fa-truck',
  carro:'fa-car', carro_executivo:'fa-car', carro_hatchback:'fa-car',
  carro_assistencia:'fa-car', carro_luxo:'fa-car', viatura:'fa-car',
};

function categoriaParaIconeDetalhe(categoria) {
  return _ICONE_CAT[categoria] || 'fa-car';
}

// ── Carregamento de dados ─────────────────────────────────────────────────────

async function carregarDados() {
  const from = document.getElementById('input-from').value;
  const to   = document.getElementById('input-to').value;
  if (!from || !to) return;

  const fromISO = isoComFuso(from, false);
  const toISO   = isoComFuso(to, true);

  setCarregando(true);
  limparMapa();

  try {
    const [listaPosicoes, resHistorico, viagens, paradas] = await Promise.all([
      window.AL.apiGet('/api/rastreamento/posicoes'),
      window.AL.apiGet(
        `/api/rastreamento/dispositivos/${dispositivoId}/historico` +
        `?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
      ),
      window.AL.apiGet(
        `/api/rastreamento/dispositivos/${dispositivoId}/viagens` +
        `?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
      ),
      window.AL.apiGet(
        `/api/rastreamento/dispositivos/${dispositivoId}/paradas` +
        `?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
      ),
    ]);

    const veiculo = (listaPosicoes || []).find(v => v.dispositivoId === dispositivoId);
    historicoCache = resHistorico.posicoes || [];
    window._veiculoDetalhe = veiculo || resHistorico.dispositivo || {};

    renderInfoVeiculo(veiculo, resHistorico.dispositivo);
    renderMapa(historicoCache, veiculo?.posicao, paradas || [], resHistorico.ociosos || []);
    renderStats(viagens || []);
    renderViagens(viagens || []);
  } catch (err) {
    mostrarErro('Erro ao carregar dados: ' + (err.message || err));
  } finally {
    setCarregando(false);
  }
}

// ── Info do veículo ───────────────────────────────────────────────────────────

function renderInfoVeiculo(veiculo, dispositivo) {
  const nome  = veiculo?.nome  || dispositivo?.nome  || '—';
  const placa = veiculo?.placa || dispositivo?.placa || '';

  document.getElementById('topbar-nome-veiculo').textContent =
    nome + (placa ? ` — ${placa}` : '');

  const el = document.getElementById('info-veiculo');

  if (!veiculo) {
    el.innerHTML = `<div style="font-weight:700;font-size:14px">${nome}</div>` +
      (placa ? `<div style="margin-top:2px"><span style="background:#333;color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${placa}</span></div>` : '');
    return;
  }

  const corStatus = veiculo.status === 'online' ? '#27ae60' : '#bdc3c7';
  const txtStatus = veiculo.status === 'online'
    ? (veiculo.posicao?.emMovimento ? `Em movimento · ${veiculo.posicao.velocidade} km/h` : 'Parado')
    : 'Offline';

  el.innerHTML = `
    <div style="font-weight:700;font-size:14px">${nome}</div>
    ${placa ? `<div style="margin-top:2px"><span style="background:#333;color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${placa}</span></div>` : ''}
    ${veiculo.marca || veiculo.modeloVeiculo
      ? `<div style="font-size:11px;color:#888;margin-top:4px">${[veiculo.marca, veiculo.modeloVeiculo].filter(Boolean).join(' ')}</div>`
      : ''}
    ${veiculo.cliente
      ? `<div style="font-size:11px;color:#888;margin-top:2px"><i class="fa fa-user" style="width:12px"></i> ${veiculo.cliente.nome}</div>`
      : ''}
    <div style="margin-top:5px;font-size:11px;color:${corStatus}">● ${txtStatus}</div>
  `;
}

// ── Mapa ──────────────────────────────────────────────────────────────────────

function limparMapa() {
  pararRoutePlayer(true);
  [polylineRota, polylineDestaque, marcadorInicio, marcadorFim, marcadorAtual].forEach(l => {
    if (l) map.removeLayer(l);
  });
  if (marcadoresParadaLayer) marcadoresParadaLayer.clearLayers();
  if (marcadoresOciosoLayer) marcadoresOciosoLayer.clearLayers();
  polylineRota = polylineDestaque = marcadorInicio = marcadorFim = marcadorAtual = null;
  setRoutePlayerPath([]);
}

function renderMapa(posicoes, posicaoAtual, paradas, ociosos) {
  const validas = posicoes.filter(p => p.valida !== false && p.latitude && p.longitude);
  setRoutePlayerPath(validas);

  if (!validas.length) {
    document.getElementById('mapa-sem-dados').style.display = 'flex';
    return;
  }
  document.getElementById('mapa-sem-dados').style.display = 'none';

  const coords = validas.map(p => [p.latitude, p.longitude]);
  polylineRota = L.polyline(coords, { color: '#2980b9', weight: 3, opacity: 0.8 }).addTo(map);

  // Marcadores de início e fim do rastro (com ícones 3D baseados na categoria do veículo)
  const veiculo = window._veiculoDetalhe || {};
  const cat = veiculo.categoria || 'carro';
  
  const iconeInicio = L.divIcon({
    html: window.AL_ICONS_3D.getSvgHtml(cat, '#27ae60', 0),
    className: '',
    iconSize: [window.AL_ICONS_3D.SIZE, window.AL_ICONS_3D.SIZE],
    iconAnchor: [window.AL_ICONS_3D.SIZE / 2, window.AL_ICONS_3D.SIZE / 2]
  });
  marcadorInicio = L.marker([validas[0].latitude, validas[0].longitude], { icon: iconeInicio })
    .bindTooltip('Início do rastro')
    .addTo(map);

  const ult = validas[validas.length - 1];
  const iconeFim = L.divIcon({
    html: window.AL_ICONS_3D.getSvgHtml(cat, '#e74c3c', 0),
    className: '',
    iconSize: [window.AL_ICONS_3D.SIZE, window.AL_ICONS_3D.SIZE],
    iconAnchor: [window.AL_ICONS_3D.SIZE / 2, window.AL_ICONS_3D.SIZE / 2]
  });
  marcadorFim = L.marker([ult.latitude, ult.longitude], { icon: iconeFim })
    .bindTooltip('Fim do rastro')
    .addTo(map);

  // Posição atual do veículo (com ícone 3D)
  if (posicaoAtual?.latitude) {
    const veiculo = window._veiculoDetalhe || {};
    const cat = veiculo.categoria || 'carro';
    const cor = posicaoAtual.emMovimento ? '#2980b9' : '#27ae60';
    const course = posicaoAtual.course || 0;
    
    const html = window.AL_ICONS_3D.getSvgHtml(cat, cor, course);
    
    const icone = L.divIcon({ html, className: '', iconSize: [window.AL_ICONS_3D.SIZE, window.AL_ICONS_3D.SIZE], iconAnchor: [window.AL_ICONS_3D.SIZE / 2, window.AL_ICONS_3D.SIZE / 2] });
    marcadorAtual = L.marker([posicaoAtual.latitude, posicaoAtual.longitude], { icon: icone })
      .bindTooltip('Posição atual')
      .addTo(map);
  }

  renderMarcadoresParada(paradas || []);
  renderMarcadoresOcioso(ociosos || []);
  map.fitBounds(polylineRota.getBounds().pad(0.15));
}

function criarIconeParada() {
  return L.divIcon({
    className: 'stop-marker-icon',
    html: '<div class="stop-pin"><span>P</span></div>',
    iconSize: [30, 38],
    iconAnchor: [15, 34],
    popupAnchor: [0, -32],
  });
}

function renderMarcadoresParada(paradas) {
  if (!marcadoresParadaLayer) marcadoresParadaLayer = L.layerGroup().addTo(map);
  marcadoresParadaLayer.clearLayers();
  paradas.forEach(function (p) {
    const lat = Number(p.latitude ?? p.lat);
    const lng = Number(p.longitude ?? p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const duracao = p.duracao != null ? p.duracao : Math.round((Number(p.duration) || 0) / 60000);
    L.marker([lat, lng], { icon: criarIconeParada(), zIndexOffset: 700 })
      .bindPopup(`<b>Parada</b><br>${fmtHora(p.inicio || p.startTime)} - ${fmtHora(p.fim || p.endTime)}<br>${fmtDuracao(duracao)}`)
      .addTo(marcadoresParadaLayer);
  });
}

// Limite (minutos) a partir do qual a ociosidade vira alerta no mapa.
const OCIOSO_LIMITE_MIN = 5;

function criarIconeOcioso() {
  return L.divIcon({
    className: 'ocioso-marker-icon',
    html: '<i class="fa fa-exclamation-triangle" style="color:#f0ad4e;font-size:26px;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 1px 2px rgba(0,0,0,.5)"></i>',
    iconSize: [28, 28],
    iconAnchor: [14, 24],
    popupAnchor: [0, -22],
  });
}

// Marca os pontos onde o motor ficou ocioso (ligado e parado) acima do limite.
function renderMarcadoresOcioso(ociosos) {
  if (!marcadoresOciosoLayer) marcadoresOciosoLayer = L.layerGroup().addTo(map);
  marcadoresOciosoLayer.clearLayers();
  (ociosos || []).forEach(function (o) {
    if (!(Number(o.duracaoMin) > OCIOSO_LIMITE_MIN)) return;
    const lat = Number(o.latitude);
    const lng = Number(o.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    L.marker([lat, lng], { icon: criarIconeOcioso(), zIndexOffset: 800 })
      .bindPopup(`<b>Motor ocioso</b><br>${fmtHora(o.inicio)} - ${fmtHora(o.fim)}<br>${fmtDuracao(o.duracaoMin)}`)
      .addTo(marcadoresOciosoLayer);
  });
}

function inicializarRoutePlayerControl() {
  if (routePlayerControl) return;
  const PlayerControl = L.Control.extend({
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-control route-player-control');
      wrap.innerHTML = `
        <button type="button" data-route-player-toggle title="Iniciar trajeto" disabled><i class="fa fa-play"></i></button>
        <select data-route-player-speed title="Velocidade">
          <option value="900">1x</option>
          <option value="450">2x</option>
          <option value="220">4x</option>
          <option value="110">8x</option>
        </select>`;
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      L.DomEvent.on(wrap.querySelector('[data-route-player-toggle]'), 'click', function (e) {
        L.DomEvent.stop(e);
        toggleRoutePlayer();
      });
      L.DomEvent.on(wrap.querySelector('[data-route-player-speed]'), 'change', function (e) {
        L.DomEvent.stop(e);
        if (routePlayerTimer) {
          if (routePlayerFrame) cancelAnimationFrame(routePlayerFrame);
          animarProximoRoutePlayer();
        }
      });
      return wrap;
    },
    onRemove() {},
  });
  routePlayerControl = new PlayerControl({ position: 'topleft' }).addTo(map);
}

function getRoutePlayerButton() {
  return document.querySelector('.route-player-control [data-route-player-toggle]');
}

function getRoutePlayerSpeed() {
  const sel = document.querySelector('.route-player-control [data-route-player-speed]');
  return Number(sel?.value || 450);
}

function setRoutePlayerPath(posicoes) {
  routePlayerPath = compactarRoutePlayerPath((posicoes || []).filter(p => p.latitude && p.longitude).map(p => ({
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    course: Number(p.course ?? p.attributes?.course ?? 0),
    time: p.fixTime || p.deviceTime || p.hora || p.serverTime || null,
    categoria: window._veiculoDetalhe?.categoria || 'carro',
  })));
  routePlayerIndex = 0;
  const btn = getRoutePlayerButton();
  if (btn) btn.disabled = routePlayerPath.length < 2;
}

function distanciaMetros(a, b) {
  const r = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function compactarRoutePlayerPath(pontos) {
  const filtrados = [];
  pontos.forEach(function (ponto) {
    const anterior = filtrados[filtrados.length - 1];
    if (!anterior || distanciaMetros(anterior, ponto) >= 10) filtrados.push(ponto);
    else anterior.time = ponto.time || anterior.time;
  });
  return filtrados;
}

function criarIconeRoutePlayer(ponto) {
  const cat = ponto?.categoria || 'carro';
  const course = ponto?.course || 0;
  if (window.AL_ICONS_3D?.getSvgHtml) {
    return L.divIcon({
      html: window.AL_ICONS_3D.getSvgHtml(cat, '#f39c12', course),
      className: 'route-player-marker',
      iconSize: [window.AL_ICONS_3D.SIZE, window.AL_ICONS_3D.SIZE],
      iconAnchor: [window.AL_ICONS_3D.SIZE / 2, window.AL_ICONS_3D.SIZE / 2],
    });
  }
  return L.divIcon({
    className: 'route-player-marker',
    html: '<div class="route-player-fallback"><i class="fa fa-car"></i></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function toggleRoutePlayer() {
  if (routePlayerTimer) {
    pararRoutePlayer(false);
    return;
  }
  iniciarRoutePlayer();
}

function iniciarRoutePlayer() {
  if (routePlayerPath.length < 2) return;
  if (routePlayerIndex >= routePlayerPath.length - 1) routePlayerIndex = 0;
  const ponto = routePlayerPath[routePlayerIndex];
  setMarcadoresExtremosVisiveis(false);
  if (!routePlayerMarker) {
    routePlayerMarker = L.marker([ponto.lat, ponto.lng], { icon: criarIconeRoutePlayer(ponto), zIndexOffset: 900 }).addTo(map);
    routePlayerMarker.bindTooltip(fmtHora(ponto.time), { permanent: true, direction: 'top', offset: [0, -18], className: 'route-player-time' }).openTooltip();
  } else {
    routePlayerMarker.setLatLng([ponto.lat, ponto.lng]).setIcon(criarIconeRoutePlayer(ponto));
    routePlayerMarker.setTooltipContent(fmtHora(ponto.time));
  }
  const btn = getRoutePlayerButton();
  if (btn) {
    btn.classList.add('playing');
    btn.title = 'Pausar trajeto';
    btn.innerHTML = '<i class="fa fa-pause"></i>';
  }
  routePlayerTimer = true;
  animarProximoRoutePlayer();
}

function avancarRoutePlayer() {
  routePlayerIndex += 1;
  if (routePlayerIndex >= routePlayerPath.length) {
    pararRoutePlayer(false);
    return;
  }
  const ponto = routePlayerPath[routePlayerIndex];
  routePlayerMarker.setLatLng([ponto.lat, ponto.lng]).setIcon(criarIconeRoutePlayer(ponto));
  routePlayerMarker.setTooltipContent(fmtHora(ponto.time));
  if (routePlayerIndex >= routePlayerPath.length - 1) {
    pararRoutePlayer(false);
    return;
  }
  animarProximoRoutePlayer();
}

function calcularBearing(a, b) {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function animarProximoRoutePlayer() {
  if (!routePlayerTimer || routePlayerIndex >= routePlayerPath.length - 1) return;
  const origem = routePlayerPath[routePlayerIndex];
  const destino = routePlayerPath[routePlayerIndex + 1];
  const inicio = performance.now();
  const duracao = getRoutePlayerSpeed();
  const bearing = destino.course || calcularBearing(origem, destino);
  routePlayerMarker.setIcon(criarIconeRoutePlayer({ ...destino, course: bearing }));
  routePlayerMarker.setTooltipContent(fmtHora(destino.time));
  const animar = function (agora) {
    if (!routePlayerTimer) return;
    const progresso = Math.min((agora - inicio) / duracao, 1);
    const lat = origem.lat + (destino.lat - origem.lat) * progresso;
    const lng = origem.lng + (destino.lng - origem.lng) * progresso;
    routePlayerMarker.setLatLng([lat, lng]);
    if (progresso < 1) {
      routePlayerFrame = requestAnimationFrame(animar);
    } else {
      avancarRoutePlayer();
    }
  };
  routePlayerFrame = requestAnimationFrame(animar);
}

function setMarcadoresExtremosVisiveis(visivel) {
  [marcadorInicio, marcadorFim].forEach(function (m) {
    if (m?.setOpacity) m.setOpacity(visivel ? 1 : 0);
  });
}

function pararRoutePlayer(removerMarcador) {
  if (routePlayerFrame) cancelAnimationFrame(routePlayerFrame);
  routePlayerFrame = null;
  routePlayerTimer = null;
  setMarcadoresExtremosVisiveis(true);
  const btn = getRoutePlayerButton();
  if (btn) {
    btn.classList.remove('playing');
    btn.title = 'Iniciar trajeto';
    btn.innerHTML = '<i class="fa fa-play"></i>';
  }
  if (removerMarcador && routePlayerMarker) {
    map.removeLayer(routePlayerMarker);
    routePlayerMarker = null;
  }
}

function destacarViagem(inicio, fim) {
  pararRoutePlayer(true);
  if (polylineDestaque) { map.removeLayer(polylineDestaque); polylineDestaque = null; }

  const t0 = new Date(inicio).getTime();
  const t1 = new Date(fim).getTime();

  const trecho = historicoCache.filter(p => {
    if (!p.latitude || !p.longitude) return false;
    const t = new Date(p.fixTime).getTime();
    return t >= t0 && t <= t1;
  });

  if (!trecho.length) return;

  const coords = trecho.map(p => [p.latitude, p.longitude]);
  polylineDestaque = L.polyline(coords, { color: '#e74c3c', weight: 5, opacity: 0.9 }).addTo(map);
  setRoutePlayerPath(trecho);
  map.fitBounds(polylineDestaque.getBounds().pad(0.25));
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function renderStats(viagens) {
  const totalKm  = viagens.reduce((s, v) => s + (v.distancia || 0), 0);
  const velMax   = viagens.reduce((m, v) => Math.max(m, v.velocidadeMaxima || 0), 0);
  const totalMin = viagens.reduce((s, v) => s + (v.duracao || 0), 0);

  document.getElementById('stat-km').textContent      = totalKm ? totalKm.toFixed(1) + ' km' : '—';
  document.getElementById('stat-velmax').textContent   = velMax  ? velMax + ' km/h' : '—';
  document.getElementById('stat-tempo').textContent    = totalMin ? fmtDuracao(totalMin) : '—';
  document.getElementById('stat-viagens').textContent  = viagens.length || '0';
}

// ── Lista de viagens ──────────────────────────────────────────────────────────

function renderViagens(viagens) {
  const lista    = document.getElementById('viagens-lista');
  const semDados = document.getElementById('viagens-sem-dados');
  const loading  = document.getElementById('viagens-carregando');

  loading.style.display = 'none';

  if (!viagens.length) {
    semDados.style.display = 'block';
    return;
  }
  semDados.style.display = 'none';

  // Remove cards antigos (mantém os elementos fixos)
  lista.querySelectorAll('.viagem-card').forEach(el => el.remove());

  viagens.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'viagem-card';
    card.dataset.i = i;
    const motorista = nomeMotoristaViagem(v);
    card.innerHTML = `
      <div class="viagem-hora">
        <i class="fa fa-circle" style="font-size:7px;color:#2980b9;vertical-align:middle"></i>
        ${fmtHora(v.inicio)} → ${fmtHora(v.fim)}
      </div>
      <div class="viagem-info">
        ${fmtDuracao(v.duracao)}
        &nbsp;·&nbsp; ${v.distancia.toFixed(1)} km
        &nbsp;·&nbsp; máx ${v.velocidadeMaxima} km/h
      </div>
      ${motorista ? `<div class="viagem-info"><i class="fa fa-id-card-o" style="color:#7f8c8d"></i> ${motorista}</div>` : ''}
    `;
    card.addEventListener('click', function () {
      lista.querySelectorAll('.viagem-card').forEach(c => c.classList.remove('ativo'));
      this.classList.add('ativo');
      destacarViagem(v.inicio, v.fim);
    });
    lista.appendChild(card);
  });
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmtDuracao(minutos) {
  if (!minutos) return '—';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h ? `${h}h ${m}min` : `${m}min`;
}

// Motorista da viagem: nome se o cartão RFID casou com um cadastro; senão o ID
// cru (quando não zerado); null quando não houve identificação de cartão.
function nomeMotoristaViagem(v) {
  if (v && v.motorista && v.motorista.nome) return v.motorista.nome;
  const id = v && v.motorista_id;
  if (id && !/^0+$/.test(String(id).trim())) return 'ID ' + id;
  return null;
}

function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function setCarregando(sim) {
  document.getElementById('loading-overlay').style.display = sim ? 'flex' : 'none';
}

function mostrarErro(msg) {
  document.getElementById('topbar-nome-veiculo').textContent = 'Erro';
  document.getElementById('info-veiculo').innerHTML =
    `<div style="color:#e74c3c;font-size:12px"><i class="fa fa-exclamation-triangle"></i> ${msg}</div>`;
}
