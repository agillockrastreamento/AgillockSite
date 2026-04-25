'use strict';

let map;
let polylineRota = null;
let polylineDestaque = null;
let marcadorInicio = null;
let marcadorFim = null;
let marcadorAtual = null;
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

  // ── Botão de localização do usuário ───────────────────────────────────────
  let _marcadorUserDet = null;
  const BtnLocDet = L.Control.extend({
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
            if (_marcadorUserDet) map.removeLayer(_marcadorUserDet);
            _marcadorUserDet = L.marker(latlng, { icon: L.divIcon({
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
  new BtnLocDet({ position: 'topleft' }).addTo(map);
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
    const [listaPosicoes, resHistorico, viagens] = await Promise.all([
      window.AL.apiGet('/api/rastreamento/posicoes'),
      window.AL.apiGet(
        `/api/rastreamento/dispositivos/${dispositivoId}/historico` +
        `?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
      ),
      window.AL.apiGet(
        `/api/rastreamento/dispositivos/${dispositivoId}/viagens` +
        `?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
      ),
    ]);

    const veiculo = (listaPosicoes || []).find(v => v.dispositivoId === dispositivoId);
    historicoCache = resHistorico.posicoes || [];
    window._veiculoDetalhe = veiculo;

    renderInfoVeiculo(veiculo, resHistorico.dispositivo);
    renderMapa(historicoCache, veiculo?.posicao);
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
  [polylineRota, polylineDestaque, marcadorInicio, marcadorFim, marcadorAtual].forEach(l => {
    if (l) map.removeLayer(l);
  });
  polylineRota = polylineDestaque = marcadorInicio = marcadorFim = marcadorAtual = null;
}

function renderMapa(posicoes, posicaoAtual) {
  const validas = posicoes.filter(p => p.valida !== false && p.latitude && p.longitude);

  if (!validas.length) {
    document.getElementById('mapa-sem-dados').style.display = 'flex';
    return;
  }
  document.getElementById('mapa-sem-dados').style.display = 'none';

  const coords = validas.map(p => [p.latitude, p.longitude]);
  polylineRota = L.polyline(coords, { color: '#2980b9', weight: 3, opacity: 0.8 }).addTo(map);

  // Marcadores de início e fim do rastro
  marcadorInicio = L.circleMarker([validas[0].latitude, validas[0].longitude], {
    radius: 6, color: '#27ae60', fillColor: '#27ae60', fillOpacity: 1, weight: 2,
  }).bindTooltip('Início do rastro').addTo(map);

  const ult = validas[validas.length - 1];
  marcadorFim = L.circleMarker([ult.latitude, ult.longitude], {
    radius: 6, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 1, weight: 2,
  }).bindTooltip('Fim do rastro').addTo(map);

  // Posição atual do veículo (mesmo estilo da tela principal)
  if (posicaoAtual?.latitude) {
    const veiculo = window._veiculoDetalhe || {};
    const fa = categoriaParaIconeDetalhe(veiculo.categoria);
    const cor = posicaoAtual.emMovimento ? '#2980b9' : '#27ae60';
    const html = `<div style="
      width:34px;height:34px;background:${cor};border-radius:50%;
      border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:14px;
    "><i class="fa ${fa}"></i></div>`;
    const icone = L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
    marcadorAtual = L.marker([posicaoAtual.latitude, posicaoAtual.longitude], { icon: icone })
      .bindTooltip('Posição atual')
      .addTo(map);
  }

  map.fitBounds(polylineRota.getBounds().pad(0.15));
}

function destacarViagem(inicio, fim) {
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
