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

  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>', maxZoom: 19 }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }
  );
  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxZoom: 19 }
  );

  tilesEsri.addTo(map);

  L.control.layers(
    { 'ESRI Street': tilesEsri, 'OpenStreetMap': tilesOsm, 'CartoDB Voyager': tilesCartoDB },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Auto-geocodifica o endereço quando o popup abre
  map.on('popupopen', function (e) {
    const container = e.popup.getElement();
    if (!container) return;
    const el = container.querySelector('[id^="addr-"]');
    if (!el || !el.dataset.lat) return;
    geocodificarCoordenadas(parseFloat(el.dataset.lat), parseFloat(el.dataset.lng), el.id);
  });
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
        .bindPopup(criarPopup(v), { autoPanPadding: L.point(10, 70), className: 'popup-veiculo' })
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
      .bindPopup(criarPopup(v), { autoPanPadding: L.point(10, 70), className: 'popup-veiculo' })
      .addTo(map);
    marker.on('click', () => destacar(dispositivoId));
    marcadores[dispositivoId] = marker;
  }
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

function svgVelocimetro(velocidade, limite) {
  if (velocidade == null) return '';
  const max = Math.max(limite || 120, velocidade, 120);
  const f = Math.min(velocidade / max, 1);
  const cor = (limite && velocidade > limite) ? '#e74c3c'
    : f >= 0.8 ? '#e74c3c' : f >= 0.55 ? '#f39c12' : '#00b894';

  const cx = 90, cy = 95, R = 70;
  const pt = t => [+(cx + R * Math.cos(Math.PI * (1 - t))).toFixed(1), +(cy - R * Math.sin(Math.PI * (1 - t))).toFixed(1)];
  const [sx, sy] = pt(0);
  const [ex, ey] = pt(1);
  const [fx, fy] = pt(f);

  // Zonas de fundo coloridas (verde / amarelo / vermelho)
  const zonasBg = [[0, 0.55, '#c8f7c5'], [0.55, 0.8, '#fef0cd'], [0.8, 1, '#ffd7d7']].map(([t0, t1, c]) => {
    const [ax, ay] = pt(t0);
    const [bx2, by2] = pt(t1);
    return `<path d="M ${ax} ${ay} A ${R} ${R} 0 ${(t1 - t0) > 0.5 ? 1 : 0} 1 ${bx2} ${by2}" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="butt"/>`;
  }).join('');

  // Marcas de escala
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI * (1 - i / 10);
    const major = i % 5 === 0;
    const r1 = major ? R - 13 : R - 7;
    return `<line x1="${+(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${+(cy - r1 * Math.sin(a)).toFixed(1)}"
                  x2="${+(cx + (R - 2) * Math.cos(a)).toFixed(1)}" y2="${+(cy - (R - 2) * Math.sin(a)).toFixed(1)}"
                  stroke="${major ? '#888' : '#bbb'}" stroke-width="${major ? 1.5 : 1}"/>`;
  }).join('');

  // Arco de preenchimento (velocidade atual)
  const fillArc = f > 0.01
    ? `<path d="M ${sx} ${sy} A ${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${fx} ${fy}" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round" opacity="0.9"/>`
    : '';

  // Marcador de limite de velocidade
  const limitMark = (limite && limite < max) ? (() => {
    const [lx, ly] = pt(limite / max);
    return `<circle cx="${lx}" cy="${ly}" r="4.5" fill="#e74c3c" stroke="white" stroke-width="1.5"/>`;
  })() : '';

  // Agulha
  const na = Math.PI * (1 - f);
  const [nnx, nny] = [+(cx + (R - 16) * Math.cos(na)).toFixed(1), +(cy - (R - 16) * Math.sin(na)).toFixed(1)];

  return `<svg width="100%" height="96" viewBox="0 0 180 102" style="display:block;margin:5px 0 0">
    <path d="M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}" fill="none" stroke="#ecf0f1" stroke-width="10" stroke-linecap="round"/>
    ${zonasBg}
    ${ticks}
    ${fillArc}
    ${limitMark}
    <line x1="${cx}" y1="${cy}" x2="${nnx}" y2="${nny}" stroke="${cor}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5.5" fill="${cor}" stroke="white" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="2" fill="white"/>
    <text x="${cx}" y="${cy - 20}" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#2d3436">${velocidade}</text>
    <text x="${cx}" y="${cy - 7}" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="#95a5a6" letter-spacing="1">km/h</text>
  </svg>`;
}

function fmtGPSTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function criarPopup(v) {
  const p = v.posicao;
  const corStatus = v.status === 'online' ? '#27ae60' : '#bdc3c7';
  const txtStatus = v.status === 'online' ? (p?.motion ? 'Em movimento' : 'Parado') : 'Offline';
  const ign = p?.ignition === true ? '🔑 Ligado' : p?.ignition === false ? '🔑 Desligado' : '';
  const addrId = `addr-${v.dispositivoId}`;
  const apiBase = window.API_URL || '';

  // Endereço: usa cache para não mostrar "Buscando..." se já foi resolvido
  const cacheKey = p ? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}` : null;
  const coords = p ? `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})` : '';
  const cachedAddr = cacheKey ? _geocodeCache[cacheKey] : null;
  const addrTxt = cachedAddr ? `${cachedAddr} ${coords}` : 'Buscando...';

  // Bateria
  const bat = p?.bateria != null ? p.bateria : null;
  const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
  const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';

  const imgHtml = v.imagemUrl
    ? `<img src="${apiBase}${v.imagemUrl}" style="width:100%;height:115px;object-fit:cover;display:block;image-rendering:auto"
        onerror="this.style.display='none'" />`
    : '';

  return `<div style="font-size:13px">
    ${imgHtml}
    <div style="padding:10px 14px 12px">
      <strong style="display:block;font-size:14px;margin-bottom:3px">${v.nome}</strong>
      ${v.placa ? `<span style="background:#333;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${v.placa}</span>` : ''}
      ${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
        <span style="color:${corStatus}">● ${txtStatus}</span>
        ${ign ? `<span style="font-size:11px">${ign}</span>` : ''}
      </div>
      ${bat != null ? `<div style="font-size:11px;color:#888;margin-top:3px"><i class="fa ${batFa}" style="color:${batCor}"></i> Bateria: ${bat}%</div>` : ''}
      ${v.cliente ? `<div style="font-size:11px;color:#888;margin-top:2px"><i class="fa fa-user" style="width:12px"></i> ${v.cliente.nome}</div>` : ''}
      ${p?.fixTime ? `<div style="font-size:11px;color:#888;margin-top:5px"><i class="fa fa-clock-o"></i> ${fmtGPSTime(p.fixTime)}</div>` : ''}
      ${p ? `<div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4"><i class="fa fa-map-pin"></i>
          <span id="${addrId}" data-lat="${p.latitude}" data-lng="${p.longitude}">${addrTxt}</span>
        </div>` : ''}
      <div style="margin-top:8px">
        <a href="rastreamento-detalhe.html?id=${v.dispositivoId}" class="btn btn-xs btn-primary" style="color:#fff">
          <i class="fa fa-map-marker"></i> Ver detalhes
        </a>
      </div>
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

  let ignIcon = '';
  if (p?.ignition === true) {
    ignIcon = `<i class="fa fa-key" title="Ignição: Sim" style="color:#27ae60"></i>`;
  } else if (p?.ignition === false) {
    ignIcon = `<i class="fa fa-key" title="Ignição: Não" style="color:#bdc3c7"></i>`;
  }

  let batIcon = '';
  if (p?.bateria != null) {
    const pct = p.bateria;
    const faClass = pct >= 80 ? 'fa-battery-full' : pct >= 60 ? 'fa-battery-3' : pct >= 40 ? 'fa-battery-2' : pct >= 20 ? 'fa-battery-1' : 'fa-battery-0';
    const corBat = pct >= 40 ? '#27ae60' : pct >= 20 ? '#f39c12' : '#e74c3c';
    batIcon = `<i class="fa ${faClass}" title="Bateria: ${pct}%" style="color:${corBat}"></i>`;
  }

  return `<div class="veiculo-item" id="item-${v.dispositivoId}" onclick="focar('${v.dispositivoId}')">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div class="v-nome">${v.nome}
        ${v.placa ? `&nbsp;<span class="v-placa">${v.placa}</span>` : ''}
      </div>
      ${(ignIcon || batIcon) ? `<div style="display:flex;gap:5px;font-size:12px;flex-shrink:0;padding-left:4px;padding-top:1px">${ignIcon}${batIcon}</div>` : ''}
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
  const { latitude, longitude } = v.posicao;
  map.once('moveend', () => marcadores[dispositivoId]?.openPopup());
  map.setView([latitude, longitude], 16);
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

// ── Geocodificação reversa (Nominatim) ────────────────────────────────────────

const _geocodeCache = {};

// Formata resposta do Photon (GeoJSON properties)
function _formatarEndereco(props) {
  const partes = [];
  if (props.name && props.name !== props.street) partes.push(props.name);
  if (props.street) partes.push(props.housenumber ? `${props.street}, ${props.housenumber}` : props.street);
  const bairro = props.suburb || props.district || props.neighbourhood;
  if (bairro) partes.push(bairro);
  const cidade = props.city || props.town || props.village;
  if (cidade) partes.push(cidade);
  if (props.state)    partes.push(props.state);
  if (props.postcode) partes.push(props.postcode);
  if (props.country)  partes.push(props.country);
  return partes.join(', ');
}

window.geocodificarCoordenadas = async function (lat, lng, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const coords = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`; // ~100 m de precisão

  if (_geocodeCache[cacheKey]) {
    el.textContent = `${_geocodeCache[cacheKey]} ${coords}`;
    return;
  }

  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=pt`;
    const res = await fetch(url);
    const data = await res.json();
    const props = data.features?.[0]?.properties;
    const end = props ? _formatarEndereco(props) : '';
    _geocodeCache[cacheKey] = end;
    el.textContent = end ? `${end} ${coords}` : coords;
  } catch {
    el.textContent = coords;
  }
};
