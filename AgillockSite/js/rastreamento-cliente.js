'use strict';

// ── Estado ────────────────────────────────────────────────────────────────────

let map;
const marcadores  = {};
const _clusterBadges = {};
const _clusterGrupos = {};
const marcadoresIconeKey = {};
let veiculosMap = {};
let traccarIdParaDispositivoId = {};
let boundsAjustados = false;
const _spider = { markers: [], linhas: [], chave: null };
const CACHE_KEY = 'rastr_cli_pos_v1';
const CLUSTER_PX = 40;

let ws = null;
let wsReconectando = false;
let wsReconectTimer = null;
let ativoId = null;
let modoFoco = false;
const _geocodeCache = {};

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  verificarAcesso().then(function (bloqueado) {
    if (bloqueado) return;
    inicializarMapa();
    carregarPosicoes();
    document.getElementById('filtro').addEventListener('input', renderBuscaResultados);
    new MutationObserver(function () {
      if (ativoId) mostrarCardDispositivo(ativoId);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });
});

// ── Verificação de bloqueio ───────────────────────────────────────────────────

async function verificarAcesso() {
  try {
    const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/status-acesso');
    if (data && data.bloqueado) {
      const msg = data.diasAtraso
        ? `Existe um boleto em atraso há ${data.diasAtraso} dias. Regularize o pagamento para voltar a acessar.`
        : 'Existe um boleto em atraso. Regularize o pagamento para voltar a acessar.';
      document.getElementById('bloqueio-msg').textContent = msg;
      $('#modal-bloqueio').modal('show');
      return true;
    }
  } catch (e) { /* ignora erros de rede */ }
  return false;
}

// ── Mapa ──────────────────────────────────────────────────────────────────────

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);

  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesOsm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21 }
  );
  const tilesEsri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 21 }
  );
  tilesCartoDB.addTo(map);
  L.control.layers(
    { 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {}, { position: 'topright', collapsed: true }
  ).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // ── Botão de localização do usuário (esquerda, abaixo do zoom) ───────────
  _adicionarBotaoLocalizacao(map);

  map.on('popupclose', function (e) {
    if (ativoId && marcadores[ativoId] && e.popup === marcadores[ativoId].getPopup()) fecharCardDispositivo(true);
  });
  map.on('click', function () { _fecharSpider(); });
  map.on('zoomend', function () { _fecharSpider(); if (!modoFoco) renderMarcadores(); });
}

// ── Botão de localização do usuário (esquerda, abaixo do zoom, ponto azul) ───

function _adicionarBotaoLocalizacao(mapInst) {
  let _marcadorUser = null;
  const BtnLoc = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control leaflet-loc-btn');
      btn.title = 'Minha localização';
      btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#000000;"></i>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function () {
        if (!navigator.geolocation) return;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size:11px;color:#2980b9;"></i>';
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            if (_marcadorUser) mapInst.removeLayer(_marcadorUser);
            _marcadorUser = L.marker(latlng, { icon: L.divIcon({
              html: '<div style="width:14px;height:14px;background:#2980b9;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(41,128,185,0.25);"></div>',
              className: '', iconSize: [14,14], iconAnchor: [7,7],
            }) }).addTo(mapInst).bindTooltip('Sua localização');
            mapInst.setView(latlng, 16);
            btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>';
          },
          function () { btn.innerHTML = '<i class="fa fa-map-marker" style="font-size:13px;color:#2980b9;"></i>'; }
        );
      });
      return btn;
    },
    onRemove() {},
  });
  new BtnLoc({ position: 'topleft' }).addTo(mapInst);
}

// ── Carga de posições ─────────────────────────────────────────────────────────

async function carregarPosicoes() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      JSON.parse(raw).forEach(v => {
        veiculosMap[v.dispositivoId] = v;
        if (v.traccarId) traccarIdParaDispositivoId[v.traccarId] = v.dispositivoId;
      });
      renderMarcadores(); renderSidebar(); renderBarraVeiculos(); ajustarBounds();
      boundsAjustados = true;
    }
  } catch {}

  conectarWebSocket();

  try {
    const lista = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/posicoes');

    Object.keys(marcadores).forEach(id => {
      if (!lista.find(v => v.dispositivoId === id)) {
        if (map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
        delete marcadores[id]; delete marcadoresIconeKey[id];
      }
    });
    Object.keys(_clusterBadges).forEach(k => { if (map.hasLayer(_clusterBadges[k])) map.removeLayer(_clusterBadges[k]); delete _clusterBadges[k]; });
    Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);

    veiculosMap = {}; traccarIdParaDispositivoId = {};
    lista.forEach(v => {
      veiculosMap[v.dispositivoId] = v;
      if (v.traccarId) traccarIdParaDispositivoId[v.traccarId] = v.dispositivoId;
    });

    try { localStorage.setItem(CACHE_KEY, JSON.stringify(lista)); } catch {}
    renderMarcadores(); renderSidebar(); renderBarraVeiculos();
    if (!boundsAjustados) { ajustarBounds(); boundsAjustados = true; }
  } catch (err) {
    if (err.message === 'acesso_bloqueado') { verificarAcesso(); return; }
    if (!Object.keys(veiculosMap).length) {
      document.getElementById('sidebar-counters').innerHTML = '<span style="color:#e74c3c"><i class="fa fa-exclamation-triangle"></i> Erro ao carregar</span>';
    }
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function conectarWebSocket() {
  if (ws && ws.readyState < 2) return;
  const apiBase = window.API_URL || 'http://localhost:3000';
  const wsUrl = `${apiBase.replace(/^http/, 'ws')}/ws/rastreamento`;
  const token = AL_CLIENTE.getToken();
  ws = new WebSocket(token ? `${wsUrl}?token=${token}` : wsUrl);
  setWsStatus('reconectando', 'Conectando...');

  ws.onopen = () => { wsReconectando = false; setWsStatus('conectado', 'Tempo real ativo'); };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    processarMensagemWs(msg);
  };
  ws.onclose = () => {
    setWsStatus('desconectado', 'Reconectando...');
    if (!wsReconectando) { wsReconectando = true; wsReconectTimer = setTimeout(conectarWebSocket, 5000); }
  };
  ws.onerror = () => ws.close();
}

function processarMensagemWs(msg) {
  if (msg.positions?.length) {
    msg.positions.forEach(pos => {
      const did = traccarIdParaDispositivoId[pos.deviceId];
      if (!did || !veiculosMap[did]) return;
      veiculosMap[did].posicao = {
        latitude: pos.latitude, longitude: pos.longitude, velocidade: pos.velocidade,
        curso: pos.curso, altitude: pos.altitude, fixTime: pos.fixTime,
        deviceTime: pos.deviceTime, serverTime: pos.serverTime, valida: pos.valida,
        ignition: pos.ignition, motion: pos.motion, sat: pos.sat, bateria: pos.bateria, endereco: pos.endereco,
      };
      atualizarMarcador(did); atualizarCardAtivo(did); atualizarCardBarra(did);
    });
  }
  if (msg.devices?.length) {
    msg.devices.forEach(d => {
      const did = traccarIdParaDispositivoId[d.traccarId];
      if (!did || !veiculosMap[did]) return;
      veiculosMap[did].status = d.status; veiculosMap[did].lastUpdate = d.lastUpdate;
      atualizarMarcador(did); atualizarCardAtivo(did); atualizarCardBarra(did);
    });
  }
  renderSidebar();
}

function setWsStatus(estado, texto) {
  const el = document.getElementById('ws-status');
  el.className = estado;
  el.innerHTML = `<i class="fa fa-circle"></i> ${texto}`;
}

// ── Cluster / Spider (idêntico ao rastreamento.js do admin) ───────────────────

function _agruparPorPixel() {
  const ids = Object.keys(veiculosMap).filter(id => veiculosMap[id]?.posicao);
  const visitados = new Set(); const grupos = {};
  ids.forEach(id => {
    if (visitados.has(id)) return;
    const v = veiculosMap[id];
    const pt = map.latLngToContainerPoint([v.posicao.latitude, v.posicao.longitude]);
    const grupo = [id]; visitados.add(id);
    ids.forEach(id2 => {
      if (visitados.has(id2)) return;
      const v2 = veiculosMap[id2];
      const pt2 = map.latLngToContainerPoint([v2.posicao.latitude, v2.posicao.longitude]);
      if (Math.hypot(pt.x - pt2.x, pt.y - pt2.y) <= CLUSTER_PX) { grupo.push(id2); visitados.add(id2); }
    });
    const lat = grupo.reduce((s, i) => s + veiculosMap[i].posicao.latitude, 0) / grupo.length;
    const lng = grupo.reduce((s, i) => s + veiculosMap[i].posicao.longitude, 0) / grupo.length;
    const chave = [...grupo].sort().join('|');
    grupos[chave] = { ids: grupo, lat, lng };
  });
  return grupos;
}

function _criarIconeCluster(count) {
  return L.divIcon({ html: `<div style="width:38px;height:38px;background:#8e44ad;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;">${count}</div>`, className: '', iconSize: [38, 38], iconAnchor: [19, 19] });
}

function _fecharSpider() {
  _spider.markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
  _spider.linhas.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  _spider.markers.length = 0; _spider.linhas.length = 0; _spider.chave = null;
}

function _abrirSpider(chave, centroLatLng) {
  if (_spider.chave === chave) { _fecharSpider(); return; }
  _fecharSpider(); _spider.chave = chave;
  const ids = _clusterGrupos[chave]?.ids || [];
  ids.forEach((id, index) => {
    const v = veiculosMap[id]; if (!v?.posicao) return;
    const centro = map.latLngToContainerPoint(centroLatLng);
    const ang = (2 * Math.PI * index / ids.length) - Math.PI / 2;
    const sp = map.containerPointToLatLng([centro.x + 55 * Math.cos(ang), centro.y + 55 * Math.sin(ang)]);
    const linha = L.polyline([centroLatLng, sp], { color: '#666', weight: 1.5, opacity: 0.6, dashArray: '4,4' }).addTo(map);
    _spider.linhas.push(linha);
    const sm = L.marker(sp, { icon: criarIcone(v), zIndexOffset: 1000 }).bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', maxWidth: 200 });
    sm.on('click', function (e) { L.DomEvent.stopPropagation(e); _fecharSpider(); focar(id); });
    sm.addTo(map); _spider.markers.push(sm);
  });
}

// ── Marcadores ────────────────────────────────────────────────────────────────

function renderMarcadores() {
  const grupos = _agruparPorPixel();
  Object.keys(_clusterGrupos).forEach(k => delete _clusterGrupos[k]);
  Object.assign(_clusterGrupos, grupos);

  Object.keys(_clusterBadges).forEach(chave => {
    if (!grupos[chave] || grupos[chave].ids.length < 2) { if (map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]); delete _clusterBadges[chave]; }
  });

  Object.entries(grupos).forEach(([chave, { ids, lat, lng }]) => {
    const isCluster = ids.length > 1;
    ids.forEach(id => {
      const v = veiculosMap[id]; const { latitude, longitude } = v.posicao;
      const visivel = !isCluster && (!modoFoco || id === ativoId);
      if (!marcadores[id]) {
        const m = L.marker([latitude, longitude], { icon: criarIcone(v) }).bindPopup(criarPopupSimples(v), { className: 'popup-veiculo', maxWidth: 200 });
        m.on('click', function (e) { L.DomEvent.stopPropagation(e); focar(id); });
        marcadores[id] = m; marcadoresIconeKey[id] = _iconeKey(v);
        if (visivel) m.addTo(map);
      } else {
        marcadores[id].setLatLng([latitude, longitude]);
        const ik = _iconeKey(v);
        if (marcadoresIconeKey[id] !== ik) { marcadores[id].setIcon(criarIcone(v)); marcadoresIconeKey[id] = ik; }
        if (visivel && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
        else if (!visivel && map.hasLayer(marcadores[id])) map.removeLayer(marcadores[id]);
      }
    });
    if (isCluster) {
      if (modoFoco) { if (_clusterBadges[chave] && map.hasLayer(_clusterBadges[chave])) map.removeLayer(_clusterBadges[chave]); return; }
      if (_clusterBadges[chave]) { _clusterBadges[chave].setLatLng([lat, lng]); _clusterBadges[chave].setIcon(_criarIconeCluster(ids.length)); if (!map.hasLayer(_clusterBadges[chave])) _clusterBadges[chave].addTo(map); }
      else {
        const badge = L.marker([lat, lng], { icon: _criarIconeCluster(ids.length), zIndexOffset: 500 });
        badge.on('click', function (e) { L.DomEvent.stopPropagation(e); _abrirSpider(chave, badge.getLatLng()); });
        _clusterBadges[chave] = badge; badge.addTo(map);
      }
    }
  });
}

function atualizarMarcador(did) {
  const v = veiculosMap[did]; if (!v?.posicao) return;
  if (!marcadores[did]) { renderMarcadores(); return; }
  const { latitude, longitude } = v.posicao;
  marcadores[did].setLatLng([latitude, longitude]);
  const ik = _iconeKey(v);
  if (marcadoresIconeKey[did] !== ik) { marcadores[did].setIcon(criarIcone(v)); marcadoresIconeKey[did] = ik; }
  if (marcadores[did].isPopupOpen()) marcadores[did].getPopup().setContent(criarPopupSimples(v));
}

const _ICONE_CAT = {
  ambulancia:'fa-ambulance', aviao_passageiros:'fa-plane', helicoptero:'fa-plane', drone:'fa-rocket',
  bicicleta:'fa-bicycle', pedicalo:'fa-bicycle', motocicleta:'fa-motorcycle', motocicleta_cruzada:'fa-motorcycle',
  taxi:'fa-taxi', onibus:'fa-bus', van:'fa-bus', van_campista:'fa-bus', caravana:'fa-bus',
  caixa_estacionaria:'fa-cube', container_20:'fa-cube', container_40:'fa-cube', container_tanque:'fa-cube',
  caminhao:'fa-truck', caminhao_trator:'fa-truck', caminhao_bau:'fa-truck', caminhao_bomba_concreto:'fa-truck',
  caminhao_betoneira:'fa-truck', caminhao_reboque:'fa-truck', caminhao_reboque_estrado:'fa-truck',
  caminhao_tanque_combustivel:'fa-truck', caminhao_pipa:'fa-truck', caminhao_vacuo:'fa-truck',
  caminhao_bombeiros:'fa-truck', caminhao_esgoto:'fa-truck', caminhao_recuperacao:'fa-truck',
  caminhao_transporte:'fa-truck', pickup:'fa-truck', pickup_reboque:'fa-truck', plataforma_reboque:'fa-truck',
  reboque_reefer:'fa-truck', reboque_tanque:'fa-truck', reboque_residuos:'fa-truck', reboque_caixa:'fa-truck',
  reboque_carro:'fa-truck', reboque_container_gerador:'fa-truck', reboque_gerador:'fa-truck',
  retroescavadeira:'fa-truck', escavadeira:'fa-truck', escavadora:'fa-truck', empilhadeira:'fa-truck',
  trator:'fa-truck', aclo_compressor:'fa-truck',
  carro:'fa-car', carro_executivo:'fa-car', carro_hatchback:'fa-car', carro_assistencia:'fa-car', carro_luxo:'fa-car', viatura:'fa-car',
};

function categoriaParaIcone(cat) { return _ICONE_CAT[cat] || 'fa-car'; }

function _corMarcador(v) {
  if (!v.posicao) return '#95a5a6';
  if (v.limiteVelocidade && v.posicao.velocidade > v.limiteVelocidade) return '#e74c3c';
  if (v.status === 'online') return v.posicao.motion ? '#2980b9' : '#27ae60';
  return '#e67e22';
}
function _iconeKey(v) { return `${_corMarcador(v)}|${v.categoria}`; }

function criarIcone(v) {
  const cor = _corMarcador(v);
  const fa = categoriaParaIcone(v.categoria);
  const html = `<div style="width:34px;height:34px;background:${cor};border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;"><i class="fa ${fa}"></i></div>`;
  return L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
}

function criarPopupSimples(v) {
  return `<div style="padding:8px 12px;font-size:12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">${v.nome}</div>${v.placa ? `<span style="background:#333;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px">${v.placa}</span>` : ''}</div>`;
}

// ── Sidebar: contadores + busca ───────────────────────────────────────────────

function renderSidebar() {
  const todos = Object.values(veiculosMap);
  const online = todos.filter(v => v.status === 'online').length;
  const offline = todos.length - online;
  document.getElementById('sidebar-counters').innerHTML =
    `<span class="dot-moving">●</span> ${online} online &nbsp;·&nbsp; <span class="dot-offline">●</span> ${offline} offline`;
}

function renderBuscaResultados() {
  const filtro = (document.getElementById('filtro').value || '').toLowerCase().trim();
  const el = document.getElementById('lista-resultados-busca');
  if (!filtro) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const filtrados = Object.values(veiculosMap).filter(v =>
    v.nome.toLowerCase().includes(filtro) ||
    (v.placa && v.placa.toLowerCase().includes(filtro)) ||
    (v.cliente?.nome.toLowerCase().includes(filtro))
  ).slice(0, 8);

  if (!filtrados.length) { el.innerHTML = '<div style="padding:12px;text-align:center;color:#aaa;font-size:12px">Nenhum resultado.</div>'; el.style.display = 'block'; return; }

  filtrados.sort((a, b) => pesoStatus(a) - pesoStatus(b));
  el.innerHTML = filtrados.map(v => {
    const p = v.posicao;
    let dot = 'dot-offline', txt = 'Offline';
    if (v.status === 'online' && p?.motion) { dot = 'dot-moving'; txt = `Em movimento · ${p.velocidade} km/h`; }
    else if (v.status === 'online') { dot = 'dot-online'; txt = 'Parado'; }
    return `<div class="veiculo-item${v.dispositivoId === ativoId ? ' ativo' : ''}" onclick="selecionarDaBusca('${v.dispositivoId}')">
      <div class="v-nome">${v.nome}${v.placa ? `&nbsp;<span class="v-placa">${v.placa}</span>` : ''}</div>
      <div class="v-status"><i class="fa fa-circle ${dot}"></i> ${txt}</div>
    </div>`;
  }).join('');
  el.style.display = 'block';
}

window.selecionarDaBusca = function (id) {
  document.getElementById('filtro').value = '';
  document.getElementById('lista-resultados-busca').style.display = 'none';
  focar(id);
};

function pesoStatus(v) { if (v.status !== 'online') return 2; if (v.posicao?.motion) return 0; return 1; }

// ── Barra de veículos ─────────────────────────────────────────────────────────

const API_BASE = window.API_URL || 'http://localhost:3000';

function renderBarraVeiculos() {
  const barra = document.getElementById('barra-veiculos');
  const veiculos = Object.values(veiculosMap);

  if (!veiculos.length) { barra.innerHTML = ''; return; }

  barra.classList.remove('expandida');
  barra.innerHTML = veiculos.map(v => cardVeiculoHtml(v)).join('');
  barra.style.justifyContent = veiculos.length <= 5 ? 'center' : 'flex-start';

  _bindBarraScroll(barra);
  bindCardsBarra();

  // Detecta overflow automaticamente após o layout ser calculado
  requestAnimationFrame(function () {
    if (barra.scrollHeight > barra.clientHeight) {
      barra.classList.add('expandida');
    }
  });
}

function _bindBarraScroll(barra) {
  if (barra._onWheel) barra.removeEventListener('wheel', barra._onWheel);
  if (barra._onScroll) barra.removeEventListener('scroll', barra._onScroll);

  barra._onWheel = function (e) {
    if (e.deltaY > 0 && !barra.classList.contains('expandida') && barra.scrollHeight > barra.clientHeight) {
      barra.classList.add('expandida');
    } else if (e.deltaY < 0 && barra.classList.contains('expandida') && barra.scrollTop === 0) {
      barra.classList.remove('expandida');
    }
  };

  barra._onScroll = function () {
    // Recolhe automaticamente ao voltar ao topo via scroll
    if (barra.classList.contains('expandida') && barra.scrollTop === 0) {
      barra.classList.remove('expandida');
    }
  };

  barra.addEventListener('wheel', barra._onWheel, { passive: true });
  barra.addEventListener('scroll', barra._onScroll, { passive: true });
}

function bindCardsBarra() {
  const barra = document.getElementById('barra-veiculos');

  barra.querySelectorAll('.card-veiculo').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('.btn-upload-foto')) return;
      focarCliente(this.dataset.did);
    });
  });

  barra.querySelectorAll('.btn-upload-foto').forEach(function (btn) {
    bindUploadFoto(btn.closest('.card-veiculo'));
  });
}

// Upload de foto: atualiza APENAS a img no fotoWrap — sem re-render do card ou da barra
function bindUploadFoto(card) {
  if (!card) return;
  const did = card.dataset.did;
  const btn = card.querySelector('.btn-upload-foto');
  if (!btn || btn._uploadBound) return;
  btn._uploadBound = true;

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';

    inp.onchange = function () {
      if (!this.files[0]) return;
      const file = this.files[0];

      // Encontra o card atual no DOM (pode ter mudado por WS update)
      const cardAtual = document.querySelector(`.card-veiculo[data-did="${did}"]`);
      if (!cardAtual) return;
      const fotoWrap = cardAtual.querySelector('.btn-foto-wrap');

      // Spinner de loading sobreposto ao fotoWrap
      let spinner = null;
      if (fotoWrap) {
        spinner = document.createElement('div');
        spinner.className = 'cv-spinner';
        spinner.style.cssText =
          'position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);' +
          'display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;pointer-events:none;z-index:5;';
        spinner.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
        fotoWrap.style.position = 'relative';
        fotoWrap.appendChild(spinner);
      }

      AL_CLIENTE.uploadFoto(`/api/cliente/dispositivos/${did}/foto`, file)
        .then(function (data) {
          veiculosMap[did].imagemUrlCliente = data.imagemUrlCliente;
          const newSrc = `${API_BASE}${data.imagemUrlCliente}`;
          // Pré-carrega a imagem antes de trocar no DOM (evita flicker de branco)
          const preload = new Image();
          preload.onload = preload.onerror = function () {
            const cc = document.querySelector(`.card-veiculo[data-did="${did}"]`);
            if (!cc) return;
            const fw = cc.querySelector('.btn-foto-wrap');
            if (fw) {
              const sp = fw.querySelector('.cv-spinner');
              if (sp) sp.remove();
              let img = fw.querySelector('img.cv-foto');
              if (img) {
                img.src = newSrc;
              } else {
                const icone = fw.querySelector('.cv-icone');
                img = document.createElement('img');
                img.className = 'cv-foto';
                img.style.cssText = 'width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;';
                if (icone) fw.replaceChild(img, icone);
                else fw.prepend(img);
                img.src = newSrc;
              }
            }
            // Atualiza também o card lateral se estiver ativo
            atualizarCardAtivo(did);
            AL_CLIENTE.showAlert('Foto atualizada!', 'success');
          };
          preload.src = newSrc;
        })
        .catch(function (err) {
          const cc = document.querySelector(`.card-veiculo[data-did="${did}"]`);
          if (cc) { const sp = cc.querySelector('.cv-spinner'); if (sp) sp.remove(); }
          AL_CLIENTE.showAlert(err.message);
        });
    };
    inp.click();
  });
}

function cardVeiculoHtml(v) {
  const cor = _corMarcador(v);
  const fa = categoriaParaIcone(v.categoria);
  const fotoSrc = v.imagemUrlCliente ? `${API_BASE}${v.imagemUrlCliente}` : null;
  const fotoEl = fotoSrc
    ? `<img src="${fotoSrc}" class="cv-foto" onerror="this.style.display='none'" />`
    : `<div class="cv-icone" style="background:${cor};"><i class="fa ${fa}"></i></div>`;

  const isOnline = v.status === 'online';
  const isMoving = isOnline && v.posicao?.motion;
  const statusTxt = isMoving ? `${v.posicao?.velocidade ?? 0} km/h` : isOnline ? 'Parado' : 'Offline';
  const dotCls = isMoving ? 'dot-moving' : isOnline ? 'dot-online' : 'dot-offline';
  const marcaModelo = [v.marca, v.modeloVeiculo].filter(Boolean).join(' ');

  return `<div class="card-veiculo${v.dispositivoId === ativoId ? ' ativo' : ''}" data-did="${v.dispositivoId}">
    <div class="btn-foto-wrap">
      ${fotoEl}
      <button class="btn-upload-foto" title="Alterar foto"><i class="fa fa-camera"></i></button>
    </div>
    ${v.placa ? `<span class="cv-placa">${v.placa}</span>` : ''}
    ${marcaModelo ? `<span class="cv-modelo">${marcaModelo}</span>` : `<span class="cv-modelo">${v.nome}</span>`}
    <span class="cv-status ${dotCls}" style="font-size:9px;">● ${statusTxt}</span>
  </div>`;
}

// Atualização cirúrgica: nunca substitui o card, só atualiza os campos que mudam
function atualizarCardBarra(did) {
  const card = document.querySelector(`.card-veiculo[data-did="${did}"]`);
  if (!card) return;
  const v = veiculosMap[did];

  // Status text + cor do dot
  const statusEl = card.querySelector('.cv-status');
  if (statusEl) {
    const isOnline = v.status === 'online';
    const isMoving = isOnline && v.posicao?.motion;
    const txt = isMoving ? `${v.posicao?.velocidade ?? 0} km/h` : isOnline ? 'Parado' : 'Offline';
    statusEl.className = `cv-status ${isMoving ? 'dot-moving' : isOnline ? 'dot-online' : 'dot-offline'}`;
    statusEl.textContent = `● ${txt}`;
  }

  // Cor do ícone (só quando não tem foto personalizada)
  if (!v.imagemUrlCliente) {
    const icone = card.querySelector('.cv-icone');
    if (icone) icone.style.background = _corMarcador(v);
  }

  // Classe ativo
  card.classList.toggle('ativo', did === ativoId);
}

// ── Card do dispositivo (sidebar) ─────────────────────────────────────────────

const _CMD_CONFIG = {
  engineStop:         { label: 'Bloquear',           icon: 'fa-lock',                style: 'danger',  confirm: 'Bloquear o motor do veículo?' },
  engineResume:       { label: 'Desbloquear',        icon: 'fa-unlock',              style: 'success' },
  positionSingle:     { label: 'Solicitar posição',        icon: 'fa-map-marker',          style: 'info' },
  positionPeriodic:   { label: 'Rastreamento periódico',   icon: 'fa-refresh',             style: 'info',    atributos: { frequency: 60 } },
  positionStop:       { label: 'Parar rastreamento',       icon: 'fa-stop-circle',         style: 'neutral' },
  alarmSos:           { label: 'Alarme SOS',               icon: 'fa-exclamation-triangle', style: 'warn' },
  silenceAlarm:       { label: 'Silenciar alarme',         icon: 'fa-bell-slash',          style: 'neutral' },
  rebootDevice:       { label: 'Reiniciar dispositivo',    icon: 'fa-power-off',           style: 'neutral', confirm: 'Reiniciar o dispositivo?' },
  factoryReset:       { label: 'Reset de fábrica',         icon: 'fa-warning',             style: 'block',   confirm: 'ATENÇÃO: apagará todas as configurações do dispositivo. Continuar?' },
  outputControl:      { label: 'Controle de saída',        icon: 'fa-toggle-on',           style: 'warn' },
  setTimezone:        { label: 'Definir fuso horário',     icon: 'fa-clock-o',             style: 'info',    atributos: { timezone: 'America/Sao_Paulo' } },
  setSpeed:           { label: 'Definir velocidade limite', icon: 'fa-tachometer',         style: 'warn',    atributos: { speed: 100 } },
  sendSms:            { label: 'Enviar SMS',               icon: 'fa-comment',             style: 'info' },
  voiceMonitoring:    { label: 'Monitoramento de voz',     icon: 'fa-microphone',          style: 'info' },
  requestPhoto:       { label: 'Solicitar foto',           icon: 'fa-camera',              style: 'info' },
  alarmArm:           { label: 'Armar alarme',             icon: 'fa-shield',              style: 'warn' },
  alarmDisarm:        { label: 'Desarmar alarme',          icon: 'fa-shield',              style: 'neutral' },
  alarmRemove:        { label: 'Remover alarme',           icon: 'fa-times-circle',        style: 'neutral' },
  immobilize:         { label: 'Imobilizar veículo',       icon: 'fa-ban',                 style: 'block',   confirm: 'Imobilizar o veículo?' },
  driverUnique:       { label: 'Identificação de motorista', icon: 'fa-id-card',           style: 'info' },
  message:            { label: 'Enviar mensagem',          icon: 'fa-envelope',            style: 'info' },
  configuration:      { label: 'Configurar dispositivo',   icon: 'fa-wrench',              style: 'neutral' },
  getVersion:         { label: 'Versão do firmware',       icon: 'fa-code',                style: 'neutral' },
  custom:             { label: 'Personalizado',            icon: 'fa-terminal',            style: 'neutral' },
};

function mostrarCardDispositivo(id) {
  const v = veiculosMap[id]; if (!v) return;
  ativoId = id;
  const p = v.posicao;
  const isOnline = v.status === 'online', isMoving = isOnline && p?.motion;
  const corStatus = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
  const txtStatus = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');
  const refTime = p?.fixTime || p?.serverTime || v.lastUpdate;
  const tempoSufixo = refTime ? ` — há ${fmtTempoDecorrido(refTime)}` : '';
  const bat = p?.bateria != null ? p.bateria : null;
  const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
  const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';
  const ignHtml = p?.ignition === true ? `<span style="color:#27ae60"><i class="fa fa-key"></i> Ligado</span>` : p?.ignition === false ? `<span style="color:#bdc3c7"><i class="fa fa-key"></i> Desligado</span>` : '';
  const addrId = `dcard-addr-${id}`;
  const cacheKey = p ? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}` : null;
  const hasCached = cacheKey != null && cacheKey in _geocodeCache;
  const addrTxt = hasCached ? (_geocodeCache[cacheKey] || `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`) : (p ? 'Buscando...' : '—');
  const coords = p ? `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})` : '';

  const imgHtml = v.imagemUrlCliente
    ? `<img src="${API_BASE}${v.imagemUrlCliente}" style="width:100%;height:140px;object-fit:cover;display:block;border-radius:12px 12px 0 0" onerror="this.style.display='none'" />`
    : '';

  // Horários detalhados
  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';
  const horasHtml = p ? `
    <div class="dcard-section dcard-val" style="font-size:10px">
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
        <span style="color:${corStatus}"><i class="fa fa-circle" style="font-size:9px;vertical-align:middle"></i> ${txtStatus}${tempoSufixo}</span>
        ${!p ? '&nbsp;<span style="color:#e67e22;font-size:11px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : ''}
      </div>
      ${p?.velocidade != null ? svgVelocimetro(p.velocidade, v.limiteVelocidade) : ''}
      ${ignHtml ? `<div style="font-size:12px;margin-bottom:4px">${ignHtml}</div>` : ''}
      ${bat != null ? `<div style="font-size:12px;color:${batCor};margin-bottom:4px"><i class="fa ${batFa}"></i> Bateria: ${bat}%</div>` : ''}
      ${horasHtml}
      ${p ? `<div class="dcard-section dcard-val" style="line-height:1.4">
        <i class="fa fa-map-pin" style="color:#e74c3c;width:13px"></i>
        <span id="${addrId}">${addrTxt}</span>
      </div>` : ''}
      
      <div id="dcard-comandos-${id}" class="dcard-section" style="display:none;padding-top:12px;border-top:1px solid rgba(128,128,128,0.1)">
        <div id="dcard-comandos-grid-${id}" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
      </div>

      <div style="margin-top:12px;display:flex;gap:6px">
        <button onclick="abrirOverlay('${id}', 'relatorio')" class="btn btn-xs btn-primary" style="flex:1">
          <i class="fa fa-bar-chart"></i> Relatório
        </button>
        <button onclick="abrirOverlay('${id}', 'historico')" class="btn btn-xs btn-default" style="flex:1">
          <i class="fa fa-history"></i> Histórico
        </button>
      </div>
    </div>
  `;
  card.style.display = 'block';
  if (p && !hasCached) geocodificarCoordenadas(p.latitude, p.longitude, addrId);

  // Carrega comandos do dispositivo (limitado a Bloquear/Desbloquear)
  AL_CLIENTE.apiGet(`/api/cliente/dispositivos/${id}/tipos-comandos`).then(tipos => {
    const permitidos = ['engineStop', 'engineResume'];
    const suportados = Array.isArray(tipos) 
      ? tipos.map(t => (typeof t === 'string' ? t : t.type)).filter(t => permitidos.includes(t))
      : [];

    if (suportados.length > 0) {
      const grid = document.getElementById(`dcard-comandos-grid-${id}`);
      if (!grid) return;
      document.getElementById(`dcard-comandos-${id}`).style.display = 'block';
      grid.innerHTML = suportados.map(t => {
        const cfg = _CMD_CONFIG[t];
        const btnClass = t === 'engineStop' ? 'btn-danger' : 'btn-success';
        return `<button class="btn btn-xs ${btnClass} cmd-btn" data-tipo="${t}" onclick="enviarComandoDaSidebar('${id}', '${t}')" style="font-weight:700;padding:7px 4px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);border:none;text-transform:uppercase;font-size:10px;">
          <i class="fa ${cfg.icon}"></i> ${cfg.label}
        </button>`;
      }).join('');
    }
  }).catch(() => {});
}

window.enviarComandoDaSidebar = async function(did, tipo) {
  const cfg = _CMD_CONFIG[tipo] || { label: tipo, icon: 'fa-terminal', style: 'neutral' };
  if (cfg.confirm && !confirm(cfg.confirm)) return;

  const btn = document.querySelector(`.cmd-btn[data-tipo="${tipo}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) { 
    btn.disabled = true; 
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Aguarde...'; 
  }

  try {
    await AL_CLIENTE.apiPost(`/api/cliente/dispositivos/${did}/comandos`, {
      tipo,
      atributos: cfg.atributos || {}
    });
    AL_CLIENTE.showAlert('Comando enviado!', 'success');
  } catch (err) {
    AL_CLIENTE.showAlert('Erro: ' + err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
  }
};

window.fecharCardDispositivo = function (skipClosePopup) {
  if (modoFoco) desativarFoco();
  document.getElementById('device-detail-card').style.display = 'none';
  ativoId = null;
  document.querySelectorAll('.card-veiculo').forEach(el => el.classList.remove('ativo'));
  if (!skipClosePopup) map.closePopup();
};

function atualizarCardAtivo(did) {
  if (did !== ativoId) return;
  const card = document.getElementById('device-detail-card');
  if (card.style.display === 'none') return;
  mostrarCardDispositivo(did);
  if (modoFoco) {
    const v = veiculosMap[did];
    if (v?.posicao) map.panTo([v.posicao.latitude, v.posicao.longitude], { animate: true, duration: 0.5 });
  }
}

// ── Velocímetro SVG ───────────────────────────────────────────────────────────

function svgVelocimetro(vel, limite) {
  if (vel == null) return '';
  const isDark = document.documentElement.classList.contains('dark-theme');
  const max = Math.max(limite || 120, 120);
  const f = Math.min(vel / max, 1);
  const ang = Math.PI * (1 - f);
  const ex = (40 + 30 * Math.cos(ang)).toFixed(1), ey = (45 - 30 * Math.sin(ang)).toFixed(1);
  const la = f > 0.5 ? 1 : 0;
  const cor = limite && vel > limite ? '#e74c3c' : vel > 80 ? '#f39c12' : '#27ae60';
  const tr = isDark ? '#2d3748' : '#e9ecef';
  const nc = isDark ? '#f0f2f5' : '#333';
  const lc = isDark ? '#adb5bd' : '#555';
  const arc = f > 0.01 ? `<path d="M 10 45 A 30 30 0 ${la} 1 ${ex} ${ey}" fill="none" stroke="${cor}" stroke-width="7" stroke-linecap="round"/>` : '';
  return `<svg width="90" height="54" viewBox="0 0 90 54" style="display:block;margin:4px auto 8px">
    <path d="M 10 45 A 30 30 0 0 1 70 45" fill="none" stroke="${tr}" stroke-width="7" stroke-linecap="round"/>
    ${arc}
    <text x="40" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="${nc}">${vel}</text>
    <text x="40" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="${lc}">km/h</text>
  </svg>`;
}

function fmtGPSTimeSec(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTempoDecorrido(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)} dia(s)`;
}

// ── Geocodificação reversa ────────────────────────────────────────────────────

window.geocodificarCoordenadas = async function (lat, lng, elementId) {
  const el = document.getElementById(elementId); if (!el) return;
  const coords = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  const ck = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (ck in _geocodeCache) { el.textContent = _geocodeCache[ck] ? `${_geocodeCache[ck]} ${coords}` : coords; return; }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR`);
    const data = await res.json();
    const a = data.address || {};
    const partes = [];
    if (a.road) partes.push(a.house_number ? `${a.road}, ${a.house_number}` : a.road);
    const bairro = a.suburb || a.neighbourhood;
    if (bairro) partes.push(bairro);
    const cidade = a.city || a.town || a.village;
    if (cidade) partes.push(cidade);
    const end = partes.join(', ');
    _geocodeCache[ck] = end;
    el.textContent = end ? `${end} ${coords}` : coords;
  } catch { el.textContent = coords; }
};

// ── Modo foco ─────────────────────────────────────────────────────────────────

function ativarFoco(id) {
  modoFoco = true; _fecharSpider();
  Object.values(_clusterBadges).forEach(b => { if (map.hasLayer(b)) map.removeLayer(b); });
  Object.keys(marcadores).forEach(mid => { if (mid !== id && map.hasLayer(marcadores[mid])) map.removeLayer(marcadores[mid]); });
  if (marcadores[id] && !map.hasLayer(marcadores[id])) marcadores[id].addTo(map);
}

function desativarFoco() { modoFoco = false; _fecharSpider(); renderMarcadores(); }

function moverCardParaInicio(did) {
  const barra = document.getElementById('barra-veiculos');
  if (!barra) return;
  // Só move se estiver em modo expandido (> 1 linha) E o card estiver na 2ª linha ou além
  if (!barra.classList.contains('expandida')) return;
  const card = barra.querySelector(`.card-veiculo[data-did="${did}"]`);
  const primeiro = barra.firstElementChild;
  if (!card || !primeiro || card === primeiro) return;
  if (card.offsetTop <= primeiro.offsetTop) return; // card já está na 1ª linha
  barra.insertBefore(card, primeiro);
  barra.scrollTop = 0;
}

window.focar = function (did) {
  mostrarCardDispositivo(did);
  moverCardParaInicio(did);
  document.querySelectorAll('.card-veiculo').forEach(el => el.classList.toggle('ativo', el.dataset.did === did));
  const v = veiculosMap[did]; if (!v?.posicao) return;
  ativarFoco(did);
  map.flyTo([v.posicao.latitude, v.posicao.longitude], 16, { animate: true, duration: 0.8 });
  setTimeout(() => { if (marcadores[did] && map.hasLayer(marcadores[did])) marcadores[did].openPopup(); }, 900);
};

window.focarCliente = function (did) {
  const barra = document.getElementById('barra-veiculos');
  // Mede e move ANTES de colapsar (offsetTop só é preciso com expandida ativo)
  moverCardParaInicio(did);
  barra.classList.remove('expandida');
  barra.scrollTop = 0;
  focar(did);
};

function ajustarBounds() {
  const comPos = Object.values(veiculosMap).filter(v => v.posicao);
  if (!comPos.length) return;
  if (comPos.length === 1) { map.setView([comPos[0].posicao.latitude, comPos[0].posicao.longitude], 13); return; }
  const group = new L.FeatureGroup(comPos.map(v => L.marker([v.posicao.latitude, v.posicao.longitude])));
  map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 14 });
}

// ── Overlay histórico/relatório ───────────────────────────────────────────────

window.abrirOverlay = function (did, tipo) {
  const v = veiculosMap[did]; if (!v) return;
  document.getElementById('overlay-titulo').textContent = `${v.nome}${v.placa ? ` — ${v.placa}` : ''}`;

  const base = window.location.href.replace(/\/cliente\/rastreamento\.html.*/, '');
  const token = AL_CLIENTE.getToken();
  let iframeSrc;
  if (tipo === 'relatorio') {
    iframeSrc = `${base}/cliente/relatorio-iframe.html?id=${did}&token=${encodeURIComponent(token)}`;
  } else {
    const params = new URLSearchParams({ id: did, token, modo: 'historico' });
    iframeSrc = `${base}/cliente/detalhe-iframe.html?${params}`;
  }
  document.getElementById('overlay-iframe').src = iframeSrc;

  const overlay = document.getElementById('overlay-historico');
  overlay.classList.add('ativo');
  history.pushState({ overlay: true }, '');
};

// ── Verificação de sessão (força logout se admin inativar o cliente) ──────────
setInterval(function () {
  AL_CLIENTE.apiGet('/api/cliente/rastreamento/status-acesso').catch(function () {});
}, 60000);

window.fecharOverlay = function () {
  document.getElementById('overlay-historico').classList.remove('ativo');
  document.getElementById('overlay-iframe').src = '';
  if (history.state?.overlay) history.back();
};

// Botão voltar do browser fecha o overlay
window.addEventListener('popstate', function (e) {
  const overlay = document.getElementById('overlay-historico');
  if (overlay.classList.contains('ativo')) overlay.classList.remove('ativo');
});
