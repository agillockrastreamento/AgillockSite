'use strict';

let map;
const marcadores = {};
let veiculosMap = {};
let traccarIdParaDispositivoId = {};

let ws = null;
let wsReconectando = false;
let wsReconectTimer = null;

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  inicializarMapa();
  carregarPosicoes();
  document.getElementById('filtro').addEventListener('input', () => renderSidebar());
});

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: true }).setView([-15.78, -47.93], 5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
}

// ── Snapshot inicial via REST ─────────────────────────────────────────────────

async function carregarPosicoes() {
  try {
    const lista = await window.AL.apiGet('/api/rastreamento/posicoes');
    veiculosMap = {};
    traccarIdParaDispositivoId = {};
    lista.forEach(v => {
      veiculosMap[v.dispositivoId] = v;
      if (v.traccarId) traccarIdParaDispositivoId[v.traccarId] = v.dispositivoId;
    });

    renderMarcadores();
    renderSidebar();
    ajustarBounds();
    conectarWebSocket();
  } catch (err) {
    console.error('Erro ao carregar posições:', err);
    document.getElementById('lista-veiculos').innerHTML =
      '<div style="padding:20px;text-align:center;color:#e74c3c">' +
      '<i class="fa fa-exclamation-triangle"></i> Erro ao carregar veículos.</div>';
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

      veiculosMap[dispositivoId].posicao = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        velocidade: pos.velocidade,
        curso: pos.curso,
        altitude: pos.altitude,
        fixTime: pos.fixTime,
        valida: pos.valida,
        ignition: pos.ignition,
        motion: pos.motion,
        sat: pos.sat,
        bateria: pos.bateria,
        endereco: pos.endereco,
      };

      atualizarMarcador(dispositivoId);
      atualizarItemSidebar(dispositivoId);
    });
  }

  if (msg.devices?.length) {
    msg.devices.forEach(d => {
      const dispositivoId = traccarIdParaDispositivoId[d.traccarId];
      if (!dispositivoId || !veiculosMap[dispositivoId]) return;

      veiculosMap[dispositivoId].status = d.status;
      veiculosMap[dispositivoId].lastUpdate = d.lastUpdate;

      atualizarMarcador(dispositivoId);
      atualizarItemSidebar(dispositivoId);
    });
  }
}

function setWsStatus(estado, texto) {
  const el = document.getElementById('ws-status');
  el.className = estado;
  el.innerHTML = `<i class="fa fa-circle"></i> ${texto}`;
}

// ── Marcadores no mapa ────────────────────────────────────────────────────────

function renderMarcadores() {
  Object.keys(veiculosMap).forEach(id => {
    const v = veiculosMap[id];
    if (!v.posicao) return;

    const icone = criarIcone(v);
    const { latitude, longitude } = v.posicao;

    if (marcadores[id]) {
      marcadores[id].setLatLng([latitude, longitude]);
      marcadores[id].setIcon(icone);
      marcadores[id].getPopup().setContent(criarPopup(v));
    } else {
      const marker = L.marker([latitude, longitude], { icon: icone })
        .bindPopup(criarPopup(v))
        .addTo(map);
      marker.on('click', () => destacar(id));
      marcadores[id] = marker;
    }
  });
}

function atualizarMarcador(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v?.posicao) return;

  const { latitude, longitude } = v.posicao;
  const icone = criarIcone(v);

  if (marcadores[dispositivoId]) {
    marcadores[dispositivoId].setLatLng([latitude, longitude]);
    marcadores[dispositivoId].setIcon(icone);
    if (marcadores[dispositivoId].isPopupOpen()) {
      marcadores[dispositivoId].getPopup().setContent(criarPopup(v));
    }
  } else {
    const marker = L.marker([latitude, longitude], { icon: icone })
      .bindPopup(criarPopup(v))
      .addTo(map);
    marker.on('click', () => destacar(dispositivoId));
    marcadores[dispositivoId] = marker;
  }
}

function criarIcone(v) {
  const curso = v.posicao?.curso ?? 0;
  let cor = '#bdc3c7';
  if (v.status === 'online') {
    cor = v.posicao?.motion ? '#2980b9' : '#27ae60';
  }
  if (v.limiteVelocidade && v.posicao?.velocidade > v.limiteVelocidade) {
    cor = '#e74c3c';
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <g transform="rotate(${curso},14,14)">
      <polygon points="14,2 24,26 14,20 4,26" fill="${cor}" stroke="white" stroke-width="1.5"/>
    </g>
  </svg>`;

  return L.divIcon({ html: svg, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
}

function criarPopup(v) {
  const p = v.posicao;
  const corStatus = v.status === 'online' ? '#27ae60' : '#bdc3c7';
  const txtStatus = v.status === 'online'
    ? (p?.motion ? `Em movimento · ${p.velocidade} km/h` : 'Parado')
    : 'Offline';
  const ign = p?.ignition === true ? '🔑 Ligado' : p?.ignition === false ? '🔑 Desligado' : '';

  return `<div style="min-width:180px;font-size:13px">
    <strong style="display:block;margin-bottom:3px">${v.nome}</strong>
    ${v.placa ? `<span style="background:#333;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${v.placa}</span>` : ''}
    <div style="margin-top:6px;color:${corStatus}">● ${txtStatus}</div>
    ${ign ? `<div style="font-size:11px;margin-top:2px">${ign}</div>` : ''}
    ${v.cliente ? `<div style="font-size:11px;color:#888;margin-top:2px">${v.cliente.nome}</div>` : ''}
    ${p?.fixTime ? `<div style="font-size:10px;color:#aaa;margin-top:4px">${window.AL.fmtDate(p.fixTime)}</div>` : ''}
    <div style="margin-top:8px">
      <a href="rastreamento-detalhe.html?id=${v.dispositivoId}" class="btn btn-xs btn-primary">
        <i class="fa fa-map-marker"></i> Ver detalhes
      </a>
    </div>
  </div>`;
}

// ── Sidebar de veículos ───────────────────────────────────────────────────────

function renderSidebar() {
  const filtro = (document.getElementById('filtro').value || '').toLowerCase();
  const todos = Object.values(veiculosMap);

  const filtrados = filtro
    ? todos.filter(v =>
        v.nome.toLowerCase().includes(filtro) ||
        (v.placa && v.placa.toLowerCase().includes(filtro)) ||
        (v.cliente?.nome.toLowerCase().includes(filtro))
      )
    : todos;

  filtrados.sort((a, b) => pesoStatus(a) - pesoStatus(b));

  const online  = todos.filter(v => v.status === 'online').length;
  const offline = todos.filter(v => v.status !== 'online').length;
  const semPos  = todos.filter(v => !v.posicao).length;

  document.getElementById('sidebar-counters').innerHTML =
    `<span class="dot-moving">●</span> ${online} online &nbsp;·&nbsp;
     <span class="dot-offline">●</span> ${offline} offline
     ${semPos ? `&nbsp;·&nbsp; <span style="color:#e67e22">${semPos} sem posição</span>` : ''}`;

  document.getElementById('lista-veiculos').innerHTML = filtrados.length
    ? filtrados.map(v => itemSidebarHtml(v)).join('')
    : '<div style="padding:20px;text-align:center;color:#aaa;font-size:12px">Nenhum veículo encontrado.</div>';
}

function atualizarItemSidebar(dispositivoId) {
  const el = document.getElementById(`item-${dispositivoId}`);
  if (!el) { renderSidebar(); return; }
  el.outerHTML = itemSidebarHtml(veiculosMap[dispositivoId]);
}

function itemSidebarHtml(v) {
  const p = v.posicao;
  let dotClass = 'dot-offline', txtStatus = 'Offline';
  if (v.status === 'online' && p?.motion) {
    dotClass = 'dot-moving'; txtStatus = `Em movimento · ${p.velocidade} km/h`;
  } else if (v.status === 'online') {
    dotClass = 'dot-online'; txtStatus = 'Parado';
  }

  return `<div class="veiculo-item" id="item-${v.dispositivoId}" onclick="focar('${v.dispositivoId}')">
    <div class="v-nome">${v.nome}
      ${v.placa ? `&nbsp;<span class="v-placa">${v.placa}</span>` : ''}
    </div>
    <div class="v-status">
      <i class="fa fa-circle ${dotClass}"></i> ${txtStatus}
      ${!p ? '&nbsp;<span style="color:#e67e22">· Sem posição</span>' : ''}
    </div>
    ${v.cliente ? `<div class="v-cliente">${v.cliente.nome}</div>` : ''}
  </div>`;
}

function pesoStatus(v) {
  if (v.status !== 'online') return 2;
  if (v.posicao?.motion) return 0;
  return 1;
}

// ── Interações ────────────────────────────────────────────────────────────────

window.focar = function (dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v?.posicao) return;

  map.setView([v.posicao.latitude, v.posicao.longitude], 16);
  marcadores[dispositivoId]?.openPopup();
  destacar(dispositivoId);
};

function destacar(dispositivoId) {
  document.querySelectorAll('.veiculo-item').forEach(el => el.classList.remove('ativo'));
  const el = document.getElementById(`item-${dispositivoId}`);
  if (el) { el.classList.add('ativo'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function ajustarBounds() {
  const comPosicao = Object.values(veiculosMap).filter(v => v.posicao);
  if (!comPosicao.length) return;

  const group = new L.FeatureGroup(
    comPosicao.map(v => L.marker([v.posicao.latitude, v.posicao.longitude]))
  );
  map.fitBounds(group.getBounds().pad(0.15));
}
