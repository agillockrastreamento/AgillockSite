'use strict';

// Obtém token e dispositivoId da URL (passados pelo iframe parent)
const urlParams = new URLSearchParams(window.location.search);
const dispositivoId = urlParams.get('id');
const clienteToken  = urlParams.get('token');

const BASE = window.API_URL || 'http://localhost:3000';

let map;
let polylineRota = null, polylineDestaque = null, marcadorInicio = null, marcadorFim = null, marcadorAtual = null;
let historicoCache = [];
let _googleMapLayers = {};
let _googleMapType = 'roadmap';
let _googleMapTypeControl = null;

const GOOGLE_MAP_TYPES = {
  roadmap: { label: 'Roadmap', lyrs: 'm' },
  satellite: { label: 'Satellite', lyrs: 's' },
  hybrid: { label: 'Hybrid', lyrs: 'y' },
  terrain: { label: 'Terrain', lyrs: 'p' },
};

// ── API usando token do cliente ───────────────────────────────────────────────

function apiGet(endpoint) {
  return fetch(BASE + endpoint, {
    headers: { 'Authorization': 'Bearer ' + clienteToken, 'Content-Type': 'application/json' },
  }).then(function (res) {
    if (res.status === 204) return null;
    return res.json().then(function (data) {
      if (!res.ok) throw new Error(data.error || 'Erro ' + res.status);
      return data;
    });
  });
}

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  if (!dispositivoId || !clienteToken) { mostrarErro('Parâmetros inválidos.'); return; }
  try {
    inicializarMapa();
  } catch (err) {
    return;
  }
  configurarPeriodo();
  carregarDados();
});

function inicializarMapa() {
  map = L.map('mapa-detalhe', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);
  _googleMapLayers = _criarCamadasGoogle();
  const tilesCartoDB = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxNativeZoom: 19, maxZoom: 21 });
  const tilesOsm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21 });
  const tilesEsri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 21 });
  _googleMapLayers.roadmap.addTo(map);
  L.control.layers({ 'Google Maps': _googleMapLayers.roadmap, 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri }, {}, { position: 'topright', collapsed: true }).addTo(map);
  _adicionarControleTipoGoogle();
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.on('baselayerchange', function () { _atualizarControleTipoGoogle(); });

  // Botão de localização
  let _marcUserCli = null;
  const BtnLocCli = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control leaflet-loc-btn');
      btn.title = 'Minha localização';
      btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function () {
        if (!navigator.geolocation) return;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size:11px;color:#2980b9;"></i>';
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            if (_marcUserCli) map.removeLayer(_marcUserCli);
            _marcUserCli = L.marker(latlng, { icon: L.divIcon({
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
  new BtnLocCli({ position: 'topleft' }).addTo(map);
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
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-end;';
      wrap.innerHTML = `
        <button type="button" class="leaflet-bar" title="Tipo do Google Maps" style="width:35px;height:35px;display:flex;align-items:center;justify-content:center;background:#fff;border:2.5px solid #ccc;border-radius:50%;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3);">
          <i class="fa fa-map" style="font-size:13px;color:#333"></i>
        </button>
        <div class="google-map-type-menu" style="display:none;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.22);overflow:hidden;min-width:112px">
          ${Object.keys(GOOGLE_MAP_TYPES).map(function (tipo) {
            return `<button type="button" data-google-map-type="${tipo}" style="display:block;width:100%;border:0;background:#fff;padding:7px 10px;text-align:left;font-size:12px;cursor:pointer">${GOOGLE_MAP_TYPES[tipo].label}</button>`;
          }).join('')}
        </div>`;
      const btn = wrap.querySelector('button');
      const menu = wrap.querySelector('.google-map-type-menu');
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      L.DomEvent.on(btn, 'click', function (e) {
        L.DomEvent.stop(e);
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      });
      wrap.querySelectorAll('[data-google-map-type]').forEach(function (item) {
        L.DomEvent.on(item, 'click', function (e) {
          L.DomEvent.stop(e);
          _trocarTipoGoogle(item.getAttribute('data-google-map-type'));
          menu.style.display = 'none';
        });
      });
      document.addEventListener('click', function () { menu.style.display = 'none'; });
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
    item.style.background = selecionado ? '#e8f4fd' : '#fff';
    item.style.color = selecionado ? '#2980b9' : '#333';
    item.style.fontWeight = selecionado ? '700' : '400';
  });
}

// ── Período ───────────────────────────────────────────────────────────────────

function configurarPeriodo() {
  setHoje();
  document.getElementById('btn-hoje').addEventListener('click', () => { setHoje(); carregarDados(); });
  document.getElementById('btn-ontem').addEventListener('click', () => { setOntem(); carregarDados(); });
  document.getElementById('btn-7dias').addEventListener('click', () => { set7Dias(); carregarDados(); });
  document.getElementById('btn-buscar').addEventListener('click', () => { setAtivo(null); carregarDados(); });
  document.getElementById('input-from').addEventListener('change', () => setAtivo(null));
  document.getElementById('input-to').addEventListener('change', () => setAtivo(null));
}

function dataStr(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

function setHoje() { const s = dataStr(new Date()); document.getElementById('input-from').value = s; document.getElementById('input-to').value = s; setAtivo('btn-hoje'); }
function setOntem() { const d = new Date(); d.setDate(d.getDate()-1); const s = dataStr(d); document.getElementById('input-from').value = s; document.getElementById('input-to').value = s; setAtivo('btn-ontem'); }
function set7Dias() { const ate = new Date(), de = new Date(); de.setDate(de.getDate()-6); document.getElementById('input-from').value = dataStr(de); document.getElementById('input-to').value = dataStr(ate); setAtivo('btn-7dias'); }

function setAtivo(btnId) {
  ['btn-hoje','btn-ontem','btn-7dias'].forEach(id => document.getElementById(id).classList.toggle('active', id === btnId));
}

function isoComFuso(dateStr, fimDoDia) {
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(off)/60)).padStart(2,'0');
  const m = String(Math.abs(off)%60).padStart(2,'0');
  return `${dateStr}${fimDoDia ? 'T23:59:59' : 'T00:00:00'}${sign}${h}:${m}`;
}

// ── Carregamento ──────────────────────────────────────────────────────────────

async function carregarDados() {
  const from = document.getElementById('input-from').value;
  const to   = document.getElementById('input-to').value;
  if (!from || !to) return;

  setCarregando(true); limparMapa();

  try {
    const fromISO = isoComFuso(from, false), toISO = isoComFuso(to, true);
    const enc = encodeURIComponent;

    const [resHistorico, viagens] = await Promise.all([
      apiGet(`/api/cliente/rastreamento/dispositivos/${dispositivoId}/historico?from=${enc(fromISO)}&to=${enc(toISO)}`),
      apiGet(`/api/cliente/rastreamento/dispositivos/${dispositivoId}/viagens?from=${enc(fromISO)}&to=${enc(toISO)}`),
    ]);

    historicoCache = resHistorico.posicoes || [];
    renderInfoVeiculo(resHistorico.dispositivo);
    renderMapa(historicoCache, null);
    renderStats(viagens || []);
    renderViagens(viagens || []);
  } catch (err) {
    mostrarErro('Erro ao carregar dados: ' + (err.message || err));
  } finally {
    setCarregando(false);
  }
}

function renderInfoVeiculo(d) {
  if (!d) return;
  document.getElementById('info-veiculo').innerHTML =
    `<div style="font-weight:700;font-size:14px">${d.nome}</div>` +
    (d.placa ? `<div style="margin-top:4px"><span style="background:#333;color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${d.placa}</span></div>` : '');
}

function limparMapa() {
  [polylineRota, polylineDestaque, marcadorInicio, marcadorFim, marcadorAtual].forEach(l => { if (l) map.removeLayer(l); });
  polylineRota = polylineDestaque = marcadorInicio = marcadorFim = marcadorAtual = null;
}

function renderMapa(posicoes) {
  const validas = posicoes.filter(p => p.valida !== false && p.latitude && p.longitude);
  if (!validas.length) { document.getElementById('mapa-sem-dados').style.display = 'flex'; return; }
  document.getElementById('mapa-sem-dados').style.display = 'none';

  polylineRota = L.polyline(validas.map(p => [p.latitude, p.longitude]), { color: '#2980b9', weight: 3, opacity: 0.8 }).addTo(map);
  marcadorInicio = L.circleMarker([validas[0].latitude, validas[0].longitude], { radius: 6, color: '#27ae60', fillColor: '#27ae60', fillOpacity: 1, weight: 2 }).bindTooltip('Início').addTo(map);
  const ult = validas[validas.length-1];
  marcadorFim = L.circleMarker([ult.latitude, ult.longitude], { radius: 6, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).bindTooltip('Fim').addTo(map);
  map.fitBounds(polylineRota.getBounds().pad(0.15));
}

function destacarViagem(inicio, fim) {
  if (polylineDestaque) { map.removeLayer(polylineDestaque); polylineDestaque = null; }
  const t0 = new Date(inicio).getTime(), t1 = new Date(fim).getTime();
  const trecho = historicoCache.filter(p => { if (!p.latitude || !p.longitude) return false; const t = new Date(p.fixTime).getTime(); return t >= t0 && t <= t1; });
  if (!trecho.length) return;
  polylineDestaque = L.polyline(trecho.map(p => [p.latitude, p.longitude]), { color: '#e74c3c', weight: 5, opacity: 0.9 }).addTo(map);
  map.fitBounds(polylineDestaque.getBounds().pad(0.25));
}

function renderStats(viagens) {
  const km = viagens.reduce((s, v) => s + (v.distancia || 0), 0);
  const vmax = viagens.reduce((m, v) => Math.max(m, v.velocidadeMaxima || 0), 0);
  const min = viagens.reduce((s, v) => s + (v.duracao || 0), 0);
  document.getElementById('stat-km').textContent = km ? km.toFixed(1) + ' km' : '—';
  document.getElementById('stat-velmax').textContent = vmax ? vmax + ' km/h' : '—';
  document.getElementById('stat-tempo').textContent = min ? fmtDur(min) : '—';
  document.getElementById('stat-viagens').textContent = viagens.length || '0';
}

function renderViagens(viagens) {
  const lista = document.getElementById('viagens-lista');
  document.getElementById('viagens-carregando').style.display = 'none';
  if (!viagens.length) { document.getElementById('viagens-sem-dados').style.display = 'block'; return; }
  document.getElementById('viagens-sem-dados').style.display = 'none';
  lista.querySelectorAll('.viagem-card').forEach(el => el.remove());
  viagens.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'viagem-card'; card.dataset.i = i;
    card.innerHTML = `<div class="viagem-hora"><i class="fa fa-circle" style="font-size:7px;color:#2980b9;vertical-align:middle"></i> ${fmtHora(v.inicio)} → ${fmtHora(v.fim)}</div>
      <div class="viagem-info">${fmtDur(v.duracao)} &nbsp;·&nbsp; ${v.distancia.toFixed(1)} km &nbsp;·&nbsp; máx ${v.velocidadeMaxima} km/h</div>`;
    card.addEventListener('click', function () {
      lista.querySelectorAll('.viagem-card').forEach(c => c.classList.remove('ativo'));
      this.classList.add('ativo');
      destacarViagem(v.inicio, v.fim);
    });
    lista.appendChild(card);
  });
}

function fmtDur(min) { if (!min) return '—'; const h = Math.floor(min/60), m = min%60; return h ? `${h}h ${m}min` : `${m}min`; }
function fmtHora(iso) { if (!iso) return '—'; return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function setCarregando(sim) { document.getElementById('loading-overlay').style.display = sim ? 'flex' : 'none'; }
function mostrarErro(msg) { document.getElementById('info-veiculo').innerHTML = `<div style="color:#e74c3c;font-size:12px"><i class="fa fa-exclamation-triangle"></i> ${msg}</div>`; }
