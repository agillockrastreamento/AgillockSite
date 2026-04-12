'use strict';

let map;
const marcadores = {};
let veiculosMap = {};
let traccarIdParaDispositivoId = {};

let ws = null;
let wsReconectando = false;
let wsReconectTimer = null;
let ativoId = null;
const marcadoresIconeKey = {};

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  inicializarMapa();
  carregarPosicoes();
  document.getElementById('filtro').addEventListener('input', renderBuscaResultados);
});

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);

  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21 }
  );

  tilesCartoDB.addTo(map);

  L.control.layers(
    { 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
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
    document.getElementById('sidebar-counters').innerHTML =
      '<span style="color:#e74c3c"><i class="fa fa-exclamation-triangle"></i> Erro ao carregar</span>';
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
        deviceTime: pos.deviceTime,
        serverTime: pos.serverTime,
        valida: pos.valida,
        ignition: pos.ignition,
        motion: pos.motion,
        sat: pos.sat,
        bateria: pos.bateria,
        endereco: pos.endereco,
      };

      atualizarMarcador(dispositivoId);
      atualizarCardAtivo(dispositivoId);
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

  renderSidebar(); // atualiza contadores
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
    } else {
      const marker = L.marker([latitude, longitude], { icon: icone })
        .bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', maxWidth: 200 })
        .addTo(map);
      marker.on('click', () => focar(id));
      marcadores[id] = marker;
    }
  });
}

function atualizarMarcador(dispositivoId) {
  const v = veiculosMap[dispositivoId];
  if (!v?.posicao) return;

  const { latitude, longitude } = v.posicao;

  if (marcadores[dispositivoId]) {
    marcadores[dispositivoId].setLatLng([latitude, longitude]);

    const iconKey = _iconeKey(v);
    if (marcadoresIconeKey[dispositivoId] !== iconKey) {
      marcadores[dispositivoId].setIcon(criarIcone(v));
      marcadoresIconeKey[dispositivoId] = iconKey;
    }

    if (marcadores[dispositivoId].isPopupOpen()) {
      marcadores[dispositivoId].getPopup().setContent(criarPopupSimples(v));
    }
  } else {
    const icone = criarIcone(v);
    marcadoresIconeKey[dispositivoId] = _iconeKey(v);
    const marker = L.marker([latitude, longitude], { icon: icone })
      .bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', maxWidth: 200 })
      .addTo(map);
    marker.on('click', () => focar(dispositivoId));
    marcadores[dispositivoId] = marker;
  }
}

function _iconeKey(v) {
  let cor = '#95a5a6';
  if (v.status === 'online') cor = v.posicao?.motion ? '#2980b9' : '#27ae60';
  if (v.limiteVelocidade && v.posicao?.velocidade > v.limiteVelocidade) cor = '#e74c3c';
  return `${cor}|${v.categoria}`;
}

// ── Mapeamento categoria → ícone FontAwesome ──────────────────────────────────

const _ICONE_CATEGORIA = {
  ambulancia: 'fa-ambulance',
  aviao_passageiros: 'fa-plane', helicoptero: 'fa-plane', drone: 'fa-rocket',
  bicicleta: 'fa-bicycle', pedicalo: 'fa-bicycle',
  motocicleta: 'fa-motorcycle', motocicleta_cruzada: 'fa-motorcycle',
  taxi: 'fa-taxi',
  onibus: 'fa-bus', van: 'fa-bus', van_campista: 'fa-bus', caravana: 'fa-bus',
  caixa_estacionaria: 'fa-cube', container_20: 'fa-cube', container_40: 'fa-cube',
  container_tanque: 'fa-cube', reboque_gerador: 'fa-cube',
  caminhao: 'fa-truck', caminhao_trator: 'fa-truck', caminhao_bau: 'fa-truck',
  caminhao_bomba_concreto: 'fa-truck', caminhao_betoneira: 'fa-truck',
  caminhao_reboque: 'fa-truck', caminhao_reboque_estrado: 'fa-truck',
  caminhao_tanque_combustivel: 'fa-truck', caminhao_pipa: 'fa-truck',
  caminhao_vacuo: 'fa-truck', caminhao_bombeiros: 'fa-truck',
  caminhao_esgoto: 'fa-truck', caminhao_recuperacao: 'fa-truck',
  caminhao_transporte: 'fa-truck', pickup: 'fa-truck', pickup_reboque: 'fa-truck',
  plataforma_reboque: 'fa-truck', reboque_reefer: 'fa-truck',
  reboque_tanque: 'fa-truck', reboque_residuos: 'fa-truck',
  reboque_caixa: 'fa-truck', reboque_carro: 'fa-truck',
  reboque_container_gerador: 'fa-truck', retroescavadeira: 'fa-truck',
  escavadeira: 'fa-truck', escavadora: 'fa-truck',
  empilhadeira: 'fa-truck', trator: 'fa-truck', aclo_compressor: 'fa-truck',
  carro: 'fa-car', carro_executivo: 'fa-car', carro_hatchback: 'fa-car',
  carro_assistencia: 'fa-car', carro_luxo: 'fa-car', viatura: 'fa-car',
};

function categoriaParaIcone(categoria) {
  return _ICONE_CATEGORIA[categoria] || 'fa-car';
}

function criarIcone(v) {
  let cor = '#95a5a6';
  if (v.status === 'online') {
    cor = v.posicao?.motion ? '#2980b9' : '#27ae60';
  }
  if (v.limiteVelocidade && v.posicao?.velocidade > v.limiteVelocidade) {
    cor = '#e74c3c';
  }

  const fa = categoriaParaIcone(v.categoria);

  const html = `<div style="
    width:34px;height:34px;
    background:${cor};
    border-radius:50%;
    border:3px solid #fff;
    box-shadow:0 2px 8px rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-size:14px;
  "><i class="fa ${fa}"></i></div>`;

  return L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
}

// ── Popup simplificado (só nome + placa + status) ─────────────────────────────

function criarPopupSimples(v) {
  return `<div style="padding:8px 12px;font-size:12px">
    <div style="font-weight:600;font-size:13px;margin-bottom:4px">${v.nome}</div>
    ${v.placa ? `<span style="background:#333;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${v.placa}</span>` : ''}
  </div>`;
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
  return d.toLocaleDateString('pt-BR') + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTempoDecorrido(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
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

  document.getElementById('sidebar-counters').innerHTML =
    `<span class="dot-moving">●</span> ${online} online &nbsp;·&nbsp;
     <span class="dot-offline">●</span> ${offline} offline
     ${semPos ? `&nbsp;·&nbsp; <span style="color:#e67e22">${semPos} sem posição</span>` : ''}`;
}

// ── Resultados de busca ───────────────────────────────────────────────────────

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
    (v.cliente?.nome.toLowerCase().includes(filtro))
  ).slice(0, 8);

  if (!filtrados.length) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#aaa;font-size:12px">Nenhum resultado.</div>';
    el.style.display = 'block';
    return;
  }

  filtrados.sort((a, b) => pesoStatus(a) - pesoStatus(b));

  el.innerHTML = filtrados.map(v => {
    const p = v.posicao;
    let dotClass = 'dot-offline', txtStatus = 'Offline';
    if (v.status === 'online' && p?.motion) { dotClass = 'dot-moving'; txtStatus = `Em movimento · ${p.velocidade} km/h`; }
    else if (v.status === 'online') { dotClass = 'dot-online'; txtStatus = 'Parado'; }

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

// ── Card do dispositivo selecionado ───────────────────────────────────────────

function mostrarCardDispositivo(id) {
  const v = veiculosMap[id];
  if (!v) return;

  ativoId = id;
  const p = v.posicao;
  const isOnline = v.status === 'online';
  const isMoving = isOnline && p?.motion;

  const corStatus = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#95a5a6';
  const txtStatus = isMoving ? 'Em movimento' : isOnline ? 'Parado' : 'Offline';

  const apiBase = window.API_URL || '';
  const addrId = `dcard-addr-${id}`;

  // "há X tempo" para dispositivos offline com última posição
  let tempoHtml = '';
  if (!isOnline && p?.fixTime) {
    tempoHtml = `<span style="color:#e67e22;font-size:11px;margin-left:6px"><i class="fa fa-clock-o"></i> há ${fmtTempoDecorrido(p.fixTime)}</span>`;
  }

  const bat = p?.bateria != null ? p.bateria : null;
  const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
  const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';

  const ignHtml = p?.ignition === true
    ? `<span style="color:#27ae60"><i class="fa fa-key"></i> Ligado</span>`
    : p?.ignition === false
    ? `<span style="color:#bdc3c7"><i class="fa fa-key"></i> Desligado</span>`
    : '';

  const cacheKey = p ? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}` : null;
  const hasCached = cacheKey != null && cacheKey in _geocodeCache;
  const cachedAddr = hasCached ? _geocodeCache[cacheKey] : null;
  const coords = p ? `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})` : '';
  const addrTxt = hasCached ? (cachedAddr ? `${cachedAddr} ${coords}` : coords) : (p ? 'Buscando...' : '—');

  const imgHtml = v.imagemUrl
    ? `<img src="${apiBase}${v.imagemUrl}" style="width:100%;height:140px;object-fit:cover;display:block" onerror="this.style.display='none'" />`
    : '';

  // Três horários com data + hora + segundos
  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';
  const horasHtml = p ? `
    <div class="dcard-section dcard-val">
      <div style="margin-bottom:2px"><i class="fa fa-server" style="${ico}"></i> <span class="dcard-lbl">Servidor:</span> ${fmtGPSTimeSec(p.serverTime)}</div>
      <div style="margin-bottom:2px"><i class="fa fa-mobile" style="${ico}"></i> <span class="dcard-lbl">Dispositivo:</span> ${fmtGPSTimeSec(p.deviceTime)}</div>
      <div><i class="fa fa-crosshairs" style="${ico}"></i> <span class="dcard-lbl">GPS:</span> ${fmtGPSTimeSec(p.fixTime)}</div>
    </div>` : '';

  const card = document.getElementById('device-detail-card');
  card.innerHTML = `
    ${imgHtml}
    <div class="dcard-header">
      <div>
        <div class="v-nome">${v.nome}</div>
        ${v.placa ? `<span class="v-placa">${v.placa}</span>` : ''}
      </div>
      <button class="dcard-fechar" onclick="fecharCardDispositivo()" title="Fechar">×</button>
    </div>
    <div class="dcard-body">
      <div style="margin-bottom:6px">
        <span style="color:${corStatus}"><i class="fa fa-circle" style="font-size:9px"></i> ${txtStatus}</span>
        ${tempoHtml}
        ${!p ? '&nbsp;<span style="color:#e67e22;font-size:11px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : ''}
      </div>
      ${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}
      ${ignHtml ? `<div style="font-size:12px;margin-bottom:4px">${ignHtml}</div>` : ''}
      ${bat != null ? `<div style="font-size:12px;color:${batCor};margin-bottom:4px"><i class="fa ${batFa}"></i> Bateria: ${bat}%</div>` : ''}
      ${v.cliente ? `<div style="font-size:12px;color:#888;margin-bottom:4px"><i class="fa fa-user" style="color:#2980b9;width:13px"></i> ${v.cliente.nome}</div>` : ''}
      ${horasHtml}
      ${p ? `<div class="dcard-section dcard-val" style="line-height:1.4">
          <i class="fa fa-map-pin" style="color:#e74c3c;width:13px"></i>
          <span id="${addrId}" data-lat="${p.latitude}" data-lng="${p.longitude}">${addrTxt}</span>
        </div>` : ''}
      <div style="margin-top:10px;display:flex;gap:6px">
        <a href="relatorio.html?id=${v.dispositivoId}" class="btn btn-xs btn-primary" style="flex:1;text-align:center;color:#fff">
          <i class="fa fa-bar-chart"></i> Relatório
        </a>
        <a href="rastreamento-detalhe.html?id=${v.dispositivoId}" class="btn btn-xs btn-default" style="flex:1;text-align:center">
          <i class="fa fa-history"></i> Histórico
        </a>
      </div>
    </div>
  `;

  card.style.display = 'block';

  // Auto-geocodifica se não estiver em cache
  if (p && !hasCached) {
    geocodificarCoordenadas(p.latitude, p.longitude, addrId);
  }
}

window.fecharCardDispositivo = function () {
  document.getElementById('device-detail-card').style.display = 'none';
  ativoId = null;
  map.closePopup();
};

function atualizarCardAtivo(dispositivoId) {
  if (dispositivoId !== ativoId) return;
  const card = document.getElementById('device-detail-card');
  if (card.style.display === 'none') return;
  mostrarCardDispositivo(dispositivoId);
}

// ── Interações ────────────────────────────────────────────────────────────────

window.focar = function (dispositivoId) {
  const v = veiculosMap[dispositivoId];

  if (!v?.posicao) {
    // Sem posição: apenas abre o card
    mostrarCardDispositivo(dispositivoId);
    return;
  }

  const { latitude, longitude } = v.posicao;
  map.setView([latitude, longitude], 16);
  mostrarCardDispositivo(dispositivoId);

  // Abre o popup simplificado no mapa
  setTimeout(() => {
    if (marcadores[dispositivoId]) marcadores[dispositivoId].openPopup();
  }, 300);
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

// ── Geocodificação reversa (Nominatim) ────────────────────────────────────────

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

  if (cacheKey in _geocodeCache) {
    const cached = _geocodeCache[cacheKey];
    el.textContent = cached ? `${cached} ${coords}` : coords;
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR`;
    const res = await fetch(url);
    const data = await res.json();
    const end = data.address ? _formatarEndereco(data.address) : '';
    _geocodeCache[cacheKey] = end;
    el.textContent = end ? `${end} ${coords}` : coords;
  } catch {
    el.textContent = coords;
  }
};
