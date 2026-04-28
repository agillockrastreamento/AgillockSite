'use strict';

const API_BASE = window.API_URL || '';
const _token = new URLSearchParams(window.location.search).get('token');

let map;
let _marcador = null;
let _popupAberto = false;
window._dadosPublico = null;
let _pollTimer = null;
const _geocodeCache = {};
const _overlay = { labels: true, rastro: false };
const _rastro = { linha: null, setas: [] };
let _usuarioInteragindo = false;
let _recentralizarTimer = null;

// ── Utilitários ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtGPSTimeSec(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const tz = 'America/Sao_Paulo';
  return d.toLocaleDateString('pt-BR', { timeZone: tz }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz });
}

function fmtTempoDecorridoMs(ms) {
  if (!ms) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const dias = Math.floor(hrs / 24);
  return `${dias} dia${dias > 1 ? 's' : ''}`;
}

function svgVelocimetro(velocidade, limite) {
  if (velocidade == null) return '';
  const numColor = '#333';
  const lblColor = '#555';
  const trackColor = '#e9ecef';
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
  return `<svg width="80" height="50" viewBox="0 0 90 54" style="display:block;margin:4px auto 6px">
    <path d="M 10 45 A 30 30 0 0 1 70 45" fill="none" stroke="${trackColor}" stroke-width="7" stroke-linecap="round"/>
    ${arc}
    <text x="40" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="${numColor}">${velocidade}</text>
    <text x="40" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="${lblColor}">km/h</text>
  </svg>`;
}

// ── Detecção mobile ───────────────────────────────────────────────────────────
function _isMobile() { return window.innerWidth <= 600; }

// ── Drawer mobile ─────────────────────────────────────────────────────────────
let _drawerAberta = false;
let _drawerDragY = null;
let _drawerDragStartHeight = null;

function _abrirDrawer() {
  const card = document.getElementById('pub-device-card');
  if (!card) return;
  _drawerAberta = true;
  card.classList.add('drawer-aberta');
  const mc = document.getElementById('mapa-container');
  if (mc) mc.classList.add('mapa-expandido');
  if (map) setTimeout(function () { map.invalidateSize(); }, 320);
  const btn = document.getElementById('pub-legenda-btn');
  if (btn) btn.classList.add('drawer-open');
}

function _fecharDrawer() {
  const card = document.getElementById('pub-device-card');
  if (!card) return;
  _drawerAberta = false;
  card.classList.remove('drawer-aberta');
  const mc = document.getElementById('mapa-container');
  if (mc) mc.classList.remove('mapa-expandido');
  if (map) setTimeout(function () { map.invalidateSize(); }, 320);
  const btn = document.getElementById('pub-legenda-btn');
  if (btn) btn.classList.remove('drawer-open');
}

function _iniciarGestoDrawer() {
  const handle = document.getElementById('pub-drawer-handle');
  const card = document.getElementById('pub-device-card');
  if (!handle || !card) return;

  function onTouchStart(e) {
    if (!_isMobile()) return;
    _drawerDragY = e.touches[0].clientY;
    _drawerDragStartHeight = card.getBoundingClientRect().height;
    card.style.transition = 'none';
  }
  function onTouchMove(e) {
    if (_drawerDragY === null || !_isMobile()) return;
    e.preventDefault();
    const dy = _drawerDragY - e.touches[0].clientY; // positivo = arrastar para cima
    const novaAltura = Math.min(Math.max(_drawerDragStartHeight + dy, window.innerHeight * 0.2), window.innerHeight * 0.85);
    card.style.height = `${novaAltura}px`;
    const mc = document.getElementById('mapa-container');
    if (mc) mc.style.bottom = `${novaAltura}px`;
  }
  function onTouchEnd() {
    if (_drawerDragY === null || !_isMobile()) return;
    card.style.transition = '';
    const mc = document.getElementById('mapa-container');
    if (mc) mc.style.bottom = '';
    const h = card.getBoundingClientRect().height;
    const vh = window.innerHeight;
    if (h > vh * 0.45) _abrirDrawer();
    else _fecharDrawer();
    card.style.height = '';
    _drawerDragY = null;
  }

  handle.addEventListener('touchstart', onTouchStart, { passive: true });
  handle.addEventListener('touchmove', onTouchMove, { passive: false });
  handle.addEventListener('touchend', onTouchEnd, { passive: true });

  // Scroll no body do card abre gaveta
  const body = card.querySelector('.pub-dcard-body');
  if (body) {
    body.addEventListener('scroll', function () {
      if (_isMobile() && !_drawerAberta && body.scrollTop > 0) _abrirDrawer();
    }, { passive: true });
  }
}

// ── Auto-recentralização ──────────────────────────────────────────────────────

function _agendarRecentralizacao() {
  _cancelarRecentralizacao();
  _recentralizarTimer = setTimeout(function () {
    _usuarioInteragindo = false;
    if (window._dadosPublico?.posicao && map) {
      const p = window._dadosPublico.posicao;
      map.flyTo([p.latitude, p.longitude], map.getZoom(), { animate: true, duration: 1 });
    }
  }, 5000);
}

function _cancelarRecentralizacao() {
  if (_recentralizarTimer) { clearTimeout(_recentralizarTimer); _recentralizarTimer = null; }
}

window.toggleLegendaMob = function () {
  const modal = document.getElementById('pub-legenda-modal');
  if (modal) modal.classList.toggle('aberto');
};

// ── Estado / Erro ─────────────────────────────────────────────────────────────

function _ocultarLoading() {
  const el = document.getElementById('pub-loading');
  if (el) el.style.display = 'none';
}

function _mostrarErro(titulo, msg) {
  _ocultarLoading();
  const el = document.getElementById('pub-error');
  if (el) {
    document.getElementById('pub-error-titulo').textContent = titulo || 'Erro';
    document.getElementById('pub-error-msg').textContent = msg || 'Ocorreu um erro inesperado.';
    el.style.display = 'flex';
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

async function _apiFetch(path) {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `Erro ${r.status}`);
  }
  return r.json();
}

// ── Ícone do marcador ─────────────────────────────────────────────────────────

function _criarIconePublico(dados, posicao) {
  const isOnline = dados.status === 'online';
  const isMoving = isOnline && posicao?.emMovimento;
  const cor = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#95a5a6';
  if (!window.AL_ICONS_3D) {
    return L.divIcon({
      html: `<div style="width:14px;height:14px;background:${cor};border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 4px ${cor}44;"></div>`,
      className: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -10],
    });
  }
  const cat = dados.categoria || 'carro';
  const curso = posicao?.curso || 0;
  const SIZE = window.AL_ICONS_3D.SIZE;
  return L.divIcon({
    html: window.AL_ICONS_3D.getSvgHtml(cat, cor, curso),
    className: '',
    iconSize: [SIZE, SIZE],
    iconAnchor: [SIZE / 2, SIZE / 2],
    popupAnchor: [0, -SIZE / 2 - 4],
  });
}

function _htmlPopup(dados) {
  const cor = dados.cor || '#2980b9';
  const bg = `${cor}22`;
  return `<div style="padding:6px 10px;font-size:12px;font-weight:700;color:#333;background:${bg};border-radius:6px;white-space:nowrap;">${esc(dados.nome)}${dados.placa ? `<br><span style="font-size:10px;font-weight:400;color:#666">${esc(dados.placa)}</span>` : ''}</div>`;
}

// ── Card de dispositivo (simplificado) ────────────────────────────────────────

window._mostrarCard = function _mostrarCard(dados) {
  const card = document.getElementById('pub-device-card');
  if (!card) return;
  const p = dados.posicao;
  const isOnline = dados.status === 'online';
  const isMoving = isOnline && p?.emMovimento;
  const corStatus = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
  const txtStatus = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');

  const estadoDesde = p?.fixTime ? new Date(p.fixTime).getTime()
    : (dados.lastUpdate ? new Date(dados.lastUpdate).getTime() : null);
  const tempoSufixo = estadoDesde ? ` — há ${fmtTempoDecorridoMs(estadoDesde)}` : '';

  const bat = p?.bateria_nivel != null ? p.bateria_nivel : null;
  const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
  const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';

  const si = [];
  if (p?.ignicao === true)    si.push(`<span style="color:#27ae60"><i class="fa fa-key"></i> Ignição: Ligado</span>`);
  if (p?.ignicao === false)   si.push(`<span style="color:#bdc3c7"><i class="fa fa-key"></i> Ignição: Desligado</span>`);
  if (bat != null)            si.push(`<span style="color:${batCor}"><i class="fa ${batFa}"></i> Bateria: ${bat}%</span>`);
  if (p?.tensao != null)      si.push(`<span style="color:#8e44ad"><i class="fa fa-bolt"></i> Tensão: ${p.tensao.toFixed(1)} V</span>`);
  if (p?.odometro != null)    si.push(`<span><i class="fa fa-tachometer" style="color:#7f8c8d"></i> Odômetro: ${Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km</span>`);
  if (p?.horas_motor != null) si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h</span>`);

  const addrId = 'pub-addr';
  const cacheKey = p ? `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}` : null;
  const hasCached = !!(cacheKey && cacheKey in _geocodeCache);
  const cachedAddr = hasCached ? _geocodeCache[cacheKey] : null;
  const coords = p ? `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})` : '';
  const addrTxt = hasCached ? (cachedAddr ? `${cachedAddr}` : coords) : (p ? 'Buscando...' : '—');

  const isMob = _isMobile();
  const velHtml = p?.velocidade != null ? svgVelocimetro(p.velocidade, dados.limiteVelocidade) : '';
  const mobileHasImg = isMob && !!dados.imagemUrl;

  // Desktop: imagem acima, velocímetro inline. Mobile: imagem + nome/placa lado a lado no topo
  let topoHtml;
  if (mobileHasImg) {
    const imgHtml = '<div id="pub-img-wrap"><img src="' + API_BASE + dados.imagemUrl + '" onerror="this.style.display=\'none\'" /></div>';
    const nomeHtml = '<div id="pub-nome-mobile"><div class="pub-v-nome" style="font-size:13px">' + esc(dados.nome) + '</div>' + (dados.placa ? '<span class="pub-v-placa">' + esc(dados.placa) + '</span>' : '') + '</div>';
    topoHtml = '<div id="pub-img-vel-row">' + imgHtml + nomeHtml + '</div>';
  } else if (!isMob && dados.imagemUrl) {
    topoHtml = `<img src="${API_BASE}${dados.imagemUrl}" style="width:100%;height:130px;object-fit:cover;display:block;border-radius:10px 10px 0 0" onerror="this.style.display='none'" />`;
  } else {
    topoHtml = '';
  }

  const ico = 'display:inline-block;width:14px;text-align:center;color:#7f8c8d;font-size:13px;flex-shrink:0';

  const handleHtml = '<div id="pub-drawer-handle"></div>';

  const headerNomeHtml = mobileHasImg
    ? '<div style="flex:1"></div>'
    : '<div style="flex:1;min-width:0"><div class="pub-v-nome">' + esc(dados.nome) + '</div>' + (dados.placa ? '<div style="margin-top:3px"><span class="pub-v-placa">' + esc(dados.placa) + '</span></div>' : '') + '</div>';

  card.innerHTML = `
    ${handleHtml}
    ${topoHtml}
    <div class="pub-dcard-header">
      ${headerNomeHtml}
      <button class="pub-dcard-fechar" onclick="fecharCardPublico()" title="Fechar">×</button>
    </div>
    <div class="pub-dcard-body">
      <div class="pub-dcard-section-title">Informações do Dispositivo</div>
      ${isMob && velHtml ? '<div style="text-align:center;margin-bottom:4px">' + velHtml + '</div>' : ''}
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:4px">
        <div id="pub-si" style="font-size:12px;display:flex;flex-direction:column;gap:3px;flex:1">${si.join('')}</div>
        ${!isMob ? `<div id="pub-vel" style="flex-shrink:0;margin-top:-4px">${velHtml}</div>` : ''}
      </div>
      <div class="pub-dcard-section pub-dcard-val" style="font-size:11px">
        <div class="pub-dcard-section-title">Última Atualização</div>
        <div style="margin-bottom:4px">
          <span id="pub-status-txt" style="color:${corStatus}">
            <i class="fa fa-circle" style="font-size:8px;vertical-align:middle"></i> ${txtStatus}${tempoSufixo}
          </span>
          ${!p ? '&nbsp;<span style="color:#e67e22;font-size:11px"><i class="fa fa-exclamation-triangle"></i> Sem posição</span>' : ''}
        </div>
        ${p ? `<div><i class="fa fa-mobile" style="${ico}"></i> <span class="pub-dcard-lbl">Dispositivo:</span> <span id="pub-ts-dev">${fmtGPSTimeSec(p.deviceTime)}</span></div>` : ''}
      </div>
      ${p ? `<div class="pub-dcard-section pub-dcard-val" style="line-height:1.4">
        <div class="pub-dcard-section-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          Endereço
          <div style="display:flex;gap:4px">
            <a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener noreferrer" class="pub-dcard-maps-btn" title="Abrir no Google Maps"><i class="fa fa-map-pin" style="color:#e74c3c"></i></a>
            <a href="https://www.google.com/maps?q=&layer=c&cbll=${p.latitude},${p.longitude}" target="_blank" rel="noopener noreferrer" class="pub-dcard-maps-btn" title="Abrir no Street View"><i class="fa fa-street-view"></i></a>
          </div>
        </div>
        <div id="${addrId}" style="font-size:11px">${addrTxt}</div>
      </div>` : ''}
    </div>
    <div class="pub-dcard-footer">
      <div style="display:flex;align-items:center;gap:5px;justify-content:center">
        <i class="fa fa-map-marker" style="font-size:11px;color:#fab32c"></i>
        <span style="font-size:9px;color:#aaa;font-weight:700;letter-spacing:.8px;text-transform:uppercase">AgilLock Rastreamento</span>
      </div>
    </div>
  `;

  card.style.display = 'flex';

  if (_isMobile()) {
    // Reconecta gestos (innerHTML recria o handle)
    _iniciarGestoDrawer();
    // Abre na posição 30% mas sempre visível
    _fecharDrawer();
  } else {
    _ajustarAlturaCard();
  }

  if (p && !hasCached) _geocodificar(p.latitude, p.longitude, addrId);
}

window.fecharCardPublico = function () {
  const card = document.getElementById('pub-device-card');
  if (!card) return;
  if (_isMobile()) {
    _fecharDrawer(); // no mobile só fecha para 30%, nunca some
  } else {
    card.style.display = 'none';
    document.getElementById('pub-logo').style.display = 'block';
  }
};

function _ajustarAlturaCard() {
  const card = document.getElementById('pub-device-card');
  const mapa = document.getElementById('mapa');
  if (!card || !mapa || card.style.display === 'none') return;
  const mapaRect = mapa.getBoundingClientRect();
  card.style.top = '60px';
  card.style.maxHeight = `${Math.max(220, mapaRect.height - 84)}px`;
}

function _atualizarCardAtivo(dados) {
  const card = document.getElementById('pub-device-card');
  if (!card || card.style.display === 'none') return;

  const p = dados.posicao;
  const isOnline = dados.status === 'online', isMoving = isOnline && p?.emMovimento;
  const cor = isMoving ? '#2980b9' : isOnline ? '#27ae60' : '#e67e22';
  const txt = isMoving ? 'Em movimento' : isOnline ? 'Parado' : (p ? 'Offline' : 'Sem posição');
  const estadoDesde = p?.fixTime ? new Date(p.fixTime).getTime() : null;
  const sufixo = estadoDesde ? ` — há ${fmtTempoDecorridoMs(estadoDesde)}` : '';

  const elSt = document.getElementById('pub-status-txt');
  if (elSt) { elSt.style.color = cor; elSt.innerHTML = `<i class="fa fa-circle" style="font-size:8px;vertical-align:middle"></i> ${txt}${sufixo}`; }

  const elVel = document.getElementById('pub-vel');
  if (elVel) elVel.innerHTML = p?.velocidade != null ? svgVelocimetro(p.velocidade, dados.limiteVelocidade) : '';

  const elSI = document.getElementById('pub-si');
  if (elSI) {
    const bat = p?.bateria_nivel != null ? p.bateria_nivel : null;
    const batFa = bat >= 80 ? 'fa-battery-full' : bat >= 60 ? 'fa-battery-3' : bat >= 40 ? 'fa-battery-2' : bat >= 20 ? 'fa-battery-1' : 'fa-battery-0';
    const batCor = bat >= 40 ? '#27ae60' : bat >= 20 ? '#f39c12' : '#e74c3c';
    const si = [];
    if (p?.ignicao === true)    si.push(`<span style="color:#27ae60"><i class="fa fa-key"></i> Ignição: Ligado</span>`);
    if (p?.ignicao === false)   si.push(`<span style="color:#bdc3c7"><i class="fa fa-key"></i> Ignição: Desligado</span>`);
    if (bat != null)            si.push(`<span style="color:${batCor}"><i class="fa ${batFa}"></i> Bateria: ${bat}%</span>`);
    if (p?.tensao != null)      si.push(`<span style="color:#8e44ad"><i class="fa fa-bolt"></i> Tensão: ${p.tensao.toFixed(1)} V</span>`);
    if (p?.odometro != null)    si.push(`<span><i class="fa fa-tachometer" style="color:#7f8c8d"></i> Odômetro: ${Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km</span>`);
    if (p?.horas_motor != null) si.push(`<span><i class="fa fa-clock-o" style="color:#7f8c8d"></i> Motor: ${p.horas_motor} h</span>`);
    elSI.innerHTML = si.join('');
  }

  const tsDev = document.getElementById('pub-ts-dev');
  if (tsDev && p) tsDev.textContent = fmtGPSTimeSec(p.deviceTime);
}

// ── Mapa ──────────────────────────────────────────────────────────────────────

let _mostrarPopup = true;

function inicializarMapa() {
  map = L.map('mapa', { zoomControl: false, maxZoom: 21 }).setView([-15.78, -47.93], 5);
  // Toque no mapa (mobile) fecha gaveta para 30%
  map.on('click', function () {
    if (_isMobile() && _drawerAberta) _fecharDrawer();
  });

  const tilesGoogle = L.tileLayer(
    'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Maps', maxNativeZoom: 21, maxZoom: 21, detectRetina: true }
  );
  const tilesGoogleSat = L.tileLayer(
    'https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',
    { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Maps', maxNativeZoom: 21, maxZoom: 21, detectRetina: true }
  );
  const tilesCartoDB = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com/">CartoDB</a>', maxNativeZoom: 19, maxZoom: 21, detectRetina: true }
  );

  tilesGoogle.addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.layers(
    { 'Google Maps': tilesGoogle, 'Satélite': tilesGoogleSat, 'CartoDB': tilesCartoDB },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);

  _adicionarBotoesCamadas();
  window.addEventListener('resize', _ajustarAlturaCard);

  // Auto-recentralização após 5s de inatividade do usuário
  map.on('dragstart', function () { _usuarioInteragindo = true; _cancelarRecentralizacao(); });
  map.on('dragend', function () { _agendarRecentralizacao(); });
  map.getContainer().addEventListener('wheel', function () {
    _usuarioInteragindo = true;
    _cancelarRecentralizacao();
    _agendarRecentralizacao();
  }, { passive: true });
}

// ── Marcador ──────────────────────────────────────────────────────────────────

function _atualizarMarcador(dados) {
  const p = dados.posicao;
  if (!p) return;
  const latlng = [p.latitude, p.longitude];
  const icon = _criarIconePublico(dados, p);

  if (!_marcador) {
    _marcador = L.marker(latlng, { icon, zIndexOffset: 100 }).addTo(map);
    _marcador.on('click', function () {
      window._mostrarCard(dados);
      if (!_isMobile()) document.getElementById('pub-logo').style.display = 'none';
      if (_isMobile()) _abrirDrawer();
      if (_mostrarPopup && _overlay.labels) _marcador.openPopup();
    });
    if (_overlay.labels) {
      _marcador.bindPopup(_htmlPopup(dados), { closeButton: false, autoPan: false, className: 'pub-popup' }).openPopup();
      _popupAberto = true;
    }
    map.setView(latlng, 15);
    window._mostrarCard(dados);
    if (!_isMobile()) document.getElementById('pub-logo').style.display = 'none';
  } else {
    _marcador.setLatLng(latlng);
    _marcador.setIcon(icon);
    if (_overlay.labels && _mostrarPopup && !_popupAberto) {
      _marcador.openPopup();
      _popupAberto = true;
    } else if (!_overlay.labels && _popupAberto) {
      _marcador.closePopup();
      _popupAberto = false;
    }
    _atualizarCardAtivo(dados);
    if (!_usuarioInteragindo) {
      map.panTo(latlng, { animate: true });
    }
  }
}

// ── Camadas ───────────────────────────────────────────────────────────────────

function _adicionarBotoesCamadas() {
  const tray = document.getElementById('pub-mapa-tray');
  if (!tray) return;

  let _toggleBtn = null;
  function posicionarTray() {
    if (!_toggleBtn) return;
    const area = document.getElementById('mapa');
    if (!area) return;
    const areaRect = area.getBoundingClientRect();
    const btnRect = _toggleBtn.getBoundingClientRect();
    const top = Math.max(10, btnRect.top - areaRect.top);
    const right = Math.max(10, areaRect.right - btnRect.left + 9);
    tray.style.top = `${top}px`;
    tray.style.right = `${right}px`;
  }

  const BtnTray = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-control pub-map-control-btn');
      btn.id = 'pub-tray-toggle';
      btn.title = 'Camadas';
      btn.innerHTML = '<i class="fa fa-database"></i>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.disableScrollPropagation(btn);
      L.DomEvent.on(btn, 'click', function (e) {
        L.DomEvent.stop(e);
        const abrindo = !tray.classList.contains('aberta');
        if (abrindo) posicionarTray();
        tray.classList.toggle('aberta', abrindo);
        btn.classList.toggle('ativo', abrindo);
      });
      _toggleBtn = btn;
      return btn;
    },
    onRemove() {},
  });
  new BtnTray({ position: 'topright' }).addTo(map);

  L.DomEvent.disableClickPropagation(tray);
  document.addEventListener('click', function (e) {
    if (!tray.contains(e.target) && (!_toggleBtn || !_toggleBtn.contains(e.target))) {
      tray.classList.remove('aberta');
      if (_toggleBtn) _toggleBtn.classList.remove('ativo');
    }
  });
  window.addEventListener('resize', function () {
    if (tray.classList.contains('aberta')) posicionarTray();
  });

  document.getElementById('pub-ml-labels').addEventListener('click', function () {
    _overlay.labels = !_overlay.labels;
    this.classList.toggle('ativo', _overlay.labels);
    _mostrarPopup = _overlay.labels;
    if (_marcador) {
      if (_overlay.labels) { _marcador.openPopup(); _popupAberto = true; }
      else { _marcador.closePopup(); _popupAberto = false; }
    }
  });

  document.getElementById('pub-ml-rastro').addEventListener('click', function () {
    _overlay.rastro = !_overlay.rastro;
    this.classList.toggle('ativo', _overlay.rastro);
    if (_overlay.rastro) _carregarRastro();
    else _limparRastro();
  });
}

// ── Rastro ────────────────────────────────────────────────────────────────────

function _limparRastro() {
  if (_rastro.linha && map.hasLayer(_rastro.linha)) map.removeLayer(_rastro.linha);
  _rastro.setas.forEach(s => { if (map.hasLayer(s)) map.removeLayer(s); });
  _rastro.linha = null;
  _rastro.setas = [];
}

function _criarSetasRastro(pontos, cor) {
  const setas = [];
  const intervalo = Math.max(1, Math.floor(pontos.length / 8));
  for (let i = intervalo; i < pontos.length - 1; i += intervalo) {
    const p1 = pontos[i - 1], p2 = pontos[i];
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI;
    const seta = L.marker(p2, {
      icon: L.divIcon({
        html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${cor};transform:rotate(${90 - ang}deg);transform-origin:center center;opacity:0.85"></div>`,
        className: '', iconSize: [10, 9], iconAnchor: [5, 4],
      }),
      interactive: false,
      zIndexOffset: -100,
    });
    setas.push(seta);
    seta.addTo(map);
  }
  return setas;
}

async function _carregarRastro() {
  _limparRastro();
  if (!_token) return;
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const data = await _apiFetch(`/api/compartilhamento/${encodeURIComponent(_token)}/historico?from=${from}&to=${now.toISOString()}`);
    const pontos = (data.posicoes || []).map(p => [p.latitude, p.longitude]);
    if (pontos.length >= 2) {
      const cor = '#2980b9';
      _rastro.linha = L.polyline(pontos, { color: cor, weight: 3, opacity: 0.7 }).addTo(map);
      _rastro.setas = _criarSetasRastro(pontos, cor);
    }
  } catch {}
}

// ── Geocodificação ────────────────────────────────────────────────────────────

async function _geocodificar(lat, lng, elementId) {
  if (!_token) return;
  const el = document.getElementById(elementId);
  if (!el) return;
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cacheKey in _geocodeCache) {
    const cached = _geocodeCache[cacheKey];
    if (el) el.textContent = cached || `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    return;
  }
  try {
    const data = await _apiFetch(`/api/compartilhamento/${encodeURIComponent(_token)}/geocode?lat=${lat}&lon=${lng}`);
    const end = data.endereco || '';
    _geocodeCache[cacheKey] = end;
    if (el) el.textContent = end || `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    // Atualiza o link do Maps se já existir no card
    const btnMaps = document.querySelector(`#pub-device-card a[href*="maps.google"]`);
    if (btnMaps && end) btnMaps.href = `https://www.google.com/maps?q=${encodeURIComponent(end)}`;
  } catch {
    if (el) el.textContent = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }
}

// ── Poll / atualização ────────────────────────────────────────────────────────

async function _poll() {
  if (!_token) return;
  try {
    const dados = await _apiFetch(`/api/compartilhamento/${encodeURIComponent(_token)}/dados`);
    window._dadosPublico = dados;
    _atualizarMarcador(dados);
  } catch {}
}

function _iniciarPolling() {
  _pollTimer = setInterval(_poll, 15000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function () {
  if (!_token) {
    _mostrarErro('Link inválido', 'Nenhum token de acesso encontrado na URL.');
    return;
  }

  inicializarMapa();

  try {
    const dados = await _apiFetch(`/api/compartilhamento/${encodeURIComponent(_token)}/dados`);
    window._dadosPublico = dados;
    _ocultarLoading();
    map.invalidateSize();
    document.title = `Acompanhamento — ${dados.nome || 'Veículo'} | AgilLock`;
    _atualizarMarcador(dados);
    _iniciarPolling();
  } catch (err) {
    _mostrarErro('Link inválido ou expirado', err.message || 'Verifique o link e tente novamente.');
  }
});
