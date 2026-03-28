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
  map = L.map('mapa-detalhe', { zoomControl: true }).setView([-15.78, -47.93], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
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

  // Posição atual do veículo (marcador triangular)
  if (posicaoAtual?.latitude) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <g transform="rotate(${posicaoAtual.curso ?? 0},14,14)">
        <polygon points="14,2 24,26 14,20 4,26" fill="#f39c12" stroke="white" stroke-width="1.5"/>
      </g>
    </svg>`;
    const icone = L.divIcon({ html: svg, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
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
