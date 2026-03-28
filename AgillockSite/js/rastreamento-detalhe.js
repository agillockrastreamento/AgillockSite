'use strict';

let map;
let polylineRota = null;
let polylineDestaque = null;
let marcadorInicio = null;
let marcadorFim = null;
let marcadorAtual = null;
let historicoCache = [];

const urlParams = new URLSearchParams(window.location.search);
const dispositivoId = urlParams.get('id');

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  if (!dispositivoId) {
    mostrarErro('ID do dispositivo não informado na URL.');
    return;
  }
  inicializarMapa();
  configurarPeriodo();
  carregarDados();
  document.getElementById('btn-pdf').addEventListener('click', () => window.print());
});

function inicializarMapa() {
  map = L.map('mapa-detalhe', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);

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

  tilesCartoDB.addTo(map);

  L.control.layers(
    { 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
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
  return d.toISOString().slice(0, 10);
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

  const fromISO = `${from}T00:00:00`;
  const toISO   = `${to}T23:59:59`;

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
    ? (veiculo.posicao?.motion ? `Em movimento · ${veiculo.posicao.velocidade} km/h` : 'Parado')
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
    const cor = posicaoAtual.motion ? '#2980b9' : '#27ae60';
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
