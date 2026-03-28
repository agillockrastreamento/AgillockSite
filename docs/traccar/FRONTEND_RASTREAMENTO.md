# Frontend — Tela de Rastreamento

## Telas planejadas

| Tela | Arquivo | Status |
|---|---|---|
| **Rastreamento (mapa geral)** | `AgillockSite/admin/rastreamento.html` | Pendente |
| Detalhe do veículo + histórico | `AgillockSite/admin/rastreamento-detalhe.html` | Pendente |

---

## Arquitetura de comunicação

```
Backend (WebSocket /ws/rastreamento)
         │
         │  JSON: { positions: [...], devices: [...], events: [...] }
         ▼
rastreamento.js (frontend)
    │
    ├── Atualiza marcadores no mapa (Leaflet)
    ├── Atualiza sidebar de veículos
    └── Atualiza contadores de status
```

**Fluxo na tela:**
1. Ao abrir a página: `GET /api/rastreamento/posicoes` — carrega snapshot inicial com todas as posições
2. Em seguida: abre WebSocket `ws://...` — recebe atualizações em tempo real (~1s de latência)
3. Cada mensagem WebSocket atualiza apenas o(s) veículo(s) afetado(s), sem recarregar tudo

---

## Biblioteca de mapas: Leaflet.js

**Leaflet** — open-source, leve, sem API key, tiles OpenStreetMap. Compatível com o padrão do projeto (sem npm/bundler).

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

---

## Tela 1: `rastreamento.html`

### O que exibe

- Mapa com marcadores de todos os veículos ativos (triangulo rotacionado pelo `curso`)
- Cores: azul = em movimento online, verde = parado online, cinza = offline
- Popup ao clicar no marcador: placa, status, velocidade, ignição, cliente, link para detalhes
- Sidebar lateral: lista de veículos com filtro por nome/placa, contadores de status
- Atualizações em tempo real via WebSocket (sem polling)

### HTML completo

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rastreamento — AgilLock</title>

  <!-- Anti-FOUC (padrão do projeto) -->
  <script>
    (function() {
      if (localStorage.getItem('al-theme') === 'dark') {
        document.documentElement.classList.add('dark-theme');
      }
    })();
  </script>

  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="../assets/css/style.css">

  <style>
    body { overflow: hidden; }

    #rastreamento-layout {
      display: flex;
      height: calc(100vh - 50px);
    }

    /* ── Sidebar ── */
    #sidebar {
      width: 280px;
      min-width: 280px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid #ddd;
      background: #fff;
      z-index: 10;
    }
    .dark-theme #sidebar { background: #1e1e2e; border-color: #333; }

    #sidebar-header { padding: 10px 12px; border-bottom: 1px solid #eee; }
    .dark-theme #sidebar-header { border-color: #333; }

    #sidebar-counters { font-size: 11px; color: #888; margin-top: 6px; }

    #lista-veiculos { flex: 1; overflow-y: auto; }

    .veiculo-item {
      padding: 9px 12px;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
      transition: background 0.12s;
    }
    .dark-theme .veiculo-item { border-color: #2a2a3e; }
    .veiculo-item:hover { background: #f7f7f7; }
    .dark-theme .veiculo-item:hover { background: #252535; }
    .veiculo-item.ativo { background: #e8f4fd; }
    .dark-theme .veiculo-item.ativo { background: #1a3a5c; }

    .v-nome { font-weight: 600; font-size: 13px; }
    .v-placa {
      display: inline-block;
      background: #333; color: #fff;
      padding: 0 5px; border-radius: 3px;
      font-size: 11px; font-weight: 700;
      letter-spacing: 1px;
    }
    .v-status { font-size: 11px; margin-top: 3px; }
    .v-cliente { font-size: 11px; color: #888; margin-top: 1px; }

    .dot-online  { color: #27ae60; }
    .dot-moving  { color: #2980b9; }
    .dot-offline { color: #bdc3c7; }
    .dot-unknown { color: #e67e22; }

    /* ── Mapa ── */
    #mapa { flex: 1; }

    /* ── Badge WS status ── */
    #ws-status {
      position: fixed; bottom: 14px; right: 14px;
      padding: 4px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 600;
      z-index: 1000; opacity: 0.9;
    }
    #ws-status.conectado { background: #27ae60; color: #fff; }
    #ws-status.desconectado { background: #e74c3c; color: #fff; }
    #ws-status.reconectando { background: #f39c12; color: #fff; }
  </style>
</head>
<body>

  <div id="navbar-placeholder"></div>

  <div id="rastreamento-layout">

    <!-- Sidebar -->
    <div id="sidebar">
      <div id="sidebar-header">
        <input type="text" id="filtro" class="form-control input-sm"
               placeholder="&#xf002;  Buscar veículo ou placa..."
               style="font-family: FontAwesome, sans-serif;">
        <div id="sidebar-counters">
          Carregando...
        </div>
      </div>
      <div id="lista-veiculos">
        <div style="padding:20px;text-align:center;color:#aaa;font-size:12px">
          <i class="fa fa-spin fa-spinner"></i> Carregando veículos...
        </div>
      </div>
    </div>

    <!-- Mapa -->
    <div id="mapa"></div>

  </div>

  <!-- Badge WebSocket -->
  <div id="ws-status" class="reconectando">
    <i class="fa fa-circle"></i> Conectando...
  </div>

  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="../assets/js/auth-guard.js"></script>
  <script src="rastreamento.js"></script>

</body>
</html>
```

---

### JavaScript: `AgillockSite/admin/rastreamento.js`

```javascript
// AgillockSite/admin/rastreamento.js
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

let map;
const marcadores = {};   // { dispositivoId: L.Marker }
let veiculosMap = {};    // { dispositivoId: dadosCompletos }
// Mapeamento traccarId → dispositivoId (necessário para aplicar updates do WS)
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
    const lista = await window.AL.apiGet('/rastreamento/posicoes');
    // Indexar por dispositivoId e por traccarId
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
  if (ws && ws.readyState < 2) return; // já conectado ou conectando

  // Montar URL do WS: trocar http/https por ws/wss
  const apiBase = (window.AL._apiBase || 'http://localhost:3000/api');
  const wsBase = apiBase.replace(/^http/, 'ws').replace('/api', '');
  const wsUrl = `${wsBase}/ws/rastreamento`;

  // Incluir token JWT como query param para autenticação
  const token = localStorage.getItem('al_token');
  const url = token ? `${wsUrl}?token=${token}` : wsUrl;

  ws = new WebSocket(url);
  setWsStatus('reconectando', 'Conectando...');

  ws.onopen = () => {
    wsReconectando = false;
    setWsStatus('conectado', 'Tempo real ativo');
    console.log('[WS] Conectado ao backend.');
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
  // Atualizar posições
  if (msg.positions?.length) {
    msg.positions.forEach(pos => {
      const dispositivoId = traccarIdParaDispositivoId[pos.deviceId];
      if (!dispositivoId || !veiculosMap[dispositivoId]) return;

      // Atualizar dados locais
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

  // Atualizar status online/offline
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
    const popup = criarPopup(v);
    const { latitude, longitude } = v.posicao;

    if (marcadores[id]) {
      marcadores[id].setLatLng([latitude, longitude]);
      marcadores[id].setIcon(icone);
      marcadores[id].getPopup().setContent(popup);
    } else {
      const marker = L.marker([latitude, longitude], { icon: icone })
        .bindPopup(popup)
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
  let cor = '#bdc3c7'; // offline
  if (v.status === 'online') {
    cor = v.posicao?.motion ? '#2980b9' : '#27ae60';
  }
  // Alerta velocidade
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
      <a href="rastreamento-detalhe.html?id=${v.dispositivoId}"
         class="btn btn-xs btn-primary">
        <i class="fa fa-map-marker"></i> Ver detalhes
      </a>
    </div>
  </div>`;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

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

  // Ordenar: movendo > parado online > offline
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
  if (!el) { renderSidebar(); return; } // se item não existe, re-renderizar tudo
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

  return `<div class="veiculo-item" id="item-${v.dispositivoId}"
               onclick="focar('${v.dispositivoId}')">
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
```

---

## Tela 2: `rastreamento-detalhe.html` (planejada)

Acessada via `?id=DISPOSITIVO_ID`. Exibirá:

- Dados do veículo e do cliente vinculado
- Mapa com rastro do percurso do dia (polyline no histórico de posições)
- Seletor de data para navegar no histórico
- Timeline de eventos do dia (ignição, paradas, alarmes)
- Tabela de viagens do período
- Velocidade máxima, distância percorrida, horas em movimento

---

## Adicionar link "Rastreamento" na navbar do admin

Na navbar do painel admin, adicionar entrada para `rastreamento.html`.
