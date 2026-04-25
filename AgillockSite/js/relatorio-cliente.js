'use strict';

// Lê token e dispositivoId da URL — passados pelo overlay do rastreamento
const _urlParams = new URLSearchParams(window.location.search);
const _token     = _urlParams.get('token') || '';
const _did       = _urlParams.get('id')    || '';
const _BASE      = window.API_URL || 'http://localhost:3000';

// Fetch autenticado com token de cliente
function apiGet(endpoint) {
  return fetch(_BASE + endpoint, {
    headers: { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' },
  }).then(function (res) {
    if (res.status === 204) return null;
    return res.json().then(function (data) {
      if (!res.ok) throw new Error(data.error || 'Erro ' + res.status);
      return data;
    });
  });
}

let mapaRota = null;
let chartVelocidade = null;
let periodoAtual = 'hoje';
let _googleMapLayers = {};
let _googleMapType = 'roadmap';
let _googleMapTypeControl = null;
const _reverseGeocodeCache = {};

const GOOGLE_MAP_TYPES = {
  roadmap: { label: 'Mapa', icon: 'fa-map-o', lyrs: 'm' },
  satellite: { label: 'Satélite', icon: 'fa-globe', lyrs: 's' },
  hybrid: { label: 'Híbrido', icon: 'fa-clone', lyrs: 'y' },
  terrain: { label: 'Terreno', icon: 'fa-area-chart', lyrs: 'p' },
};

const _EVENTO_LABEL = {
  deviceOnline:    { label: 'Online',               cls: 'ev-online'    },
  deviceOffline:   { label: 'Offline',              cls: 'ev-offline'   },
  deviceUnknown:   { label: 'Desconhecido',         cls: 'ev-default'   },
  deviceMoving:    { label: 'Em movimento',         cls: 'ev-moving'    },
  deviceStopped:   { label: 'Parado',               cls: 'ev-stopped'   },
  deviceOverspeed: { label: 'Velocidade excessiva', cls: 'ev-overspeed' },
  ignitionOn:      { label: 'Ignição ligada',       cls: 'ev-ignition'  },
  ignitionOff:     { label: 'Ignição desligada',    cls: 'ev-ignition'  },
  alarm:           { label: 'Alarme',               cls: 'ev-alarm'     },
  geofenceEnter:   { label: 'Entrou na cerca',      cls: 'ev-moving'    },
  geofenceExit:    { label: 'Saiu da cerca',        cls: 'ev-stopped'   },
};

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  if (!_did) {
    document.body.innerHTML = '<p style="padding:24px;color:#e74c3c;">Dispositivo não informado.</p>';
    return;
  }

  configurarPeriodo();
  inicializarMapaRota();

  document.querySelectorAll('.periodo-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      periodoAtual = this.dataset.periodo;
      document.getElementById('custom-datas').style.display = periodoAtual === 'custom' ? 'flex' : 'none';
      if (periodoAtual !== 'custom') carregarRelatorio();
    });
  });

  document.getElementById('btn-carregar').addEventListener('click', carregarRelatorio);
  document.getElementById('btn-confirmar-exportar').addEventListener('click', exportarRelatorio);

  $('a[href="#tab-rota"]').on('shown.bs.tab', function () {
    if (mapaRota) mapaRota.invalidateSize();
  });

  // Carrega imediatamente
  carregarRelatorio();
});

window.abrirModalExportarRelatorioCliente = function () {
  $('#modal-exportar').modal('show');
};

function configurarPeriodo() {
  const hoje = new Date();
  const s = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0') + '-' + String(hoje.getDate()).padStart(2,'0');
  document.getElementById('dt-de').value  = s;
  document.getElementById('dt-ate').value = s;
}

function calcularIntervalo() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
  if (periodoAtual === 'hoje')  return { from: hoje, to: amanha };
  if (periodoAtual === 'ontem') {
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    return { from: ontem, to: hoje };
  }
  if (periodoAtual === '7dias') {
    const sete = new Date(hoje); sete.setDate(sete.getDate() - 7);
    return { from: sete, to: amanha };
  }
  const deVal  = document.getElementById('dt-de').value;
  const ateVal = document.getElementById('dt-ate').value;
  return {
    from: deVal  ? new Date(deVal  + 'T00:00:00') : hoje,
    to:   ateVal ? new Date(ateVal + 'T23:59:59') : amanha,
  };
}

function isoComFuso(d) {
  const off = d.getTimezoneOffset();
  const abs = Math.abs(off);
  const sign = off <= 0 ? '+' : '-';
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return d.toISOString().replace('Z', '') + sign + hh + ':' + mm;
}

function enderecoValido(valor) {
  return typeof valor === 'string' && valor.trim() && !enderecoPareceCoordenada(valor);
}

function enderecoPareceCoordenada(valor) {
  if (typeof valor !== 'string') return false;
  const texto = valor.trim();
  if (!texto || texto === '0.00000, 0.00000') return true;
  return !!extrairCoords(texto);
}

function extrairCoords(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const padroes = [
    /^\(?\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)?$/,
    /^\(?\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)?$/,
    /^lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D+lon(?:gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)$/i,
  ];
  for (const padrao of padroes) {
    const m = texto.match(padrao);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function coordsValidas(lat, lng) {
  const nLat = Number(lat), nLng = Number(lng);
  return Number.isFinite(nLat) && Number.isFinite(nLng) && (Math.abs(nLat) > 0.00001 || Math.abs(nLng) > 0.00001);
}

function fmtEndereco(valor, lat, lng) {
  if (enderecoValido(valor)) return valor.trim();
  const coordsTexto = extrairCoords(valor);
  if (coordsTexto) return `(${coordsTexto.lat.toFixed(5)}, ${coordsTexto.lng.toFixed(5)})`;
  if (coordsValidas(lat, lng)) return `(${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})`;
  return 'Endereço não identificado';
}

async function resolverEndereco(valor, lat, lng) {
  if (enderecoValido(valor)) return valor.trim();
  const coordsTexto = extrairCoords(valor);
  const finalLat = coordsValidas(lat, lng) ? Number(lat) : coordsTexto?.lat;
  const finalLng = coordsValidas(lat, lng) ? Number(lng) : coordsTexto?.lng;
  if (!coordsValidas(finalLat, finalLng)) return 'Endereço não identificado';
  const chave = `${finalLat.toFixed(5)},${finalLng.toFixed(5)}`;
  if (_reverseGeocodeCache[chave]) return _reverseGeocodeCache[chave];
  try {
    const data = await apiGet(`/api/cliente/rastreamento/geocode/reverse?lat=${encodeURIComponent(finalLat)}&lon=${encodeURIComponent(finalLng)}`);
    const end = data.endereco || fmtEndereco(null, finalLat, finalLng);
    _reverseGeocodeCache[chave] = end;
    return end;
  } catch {
    return fmtEndereco(null, finalLat, finalLng);
  }
}

// ── Carregamento ──────────────────────────────────────────────────────────────

async function carregarRelatorio() {
  const { from, to } = calcularIntervalo();
  const fromIso = isoComFuso(from);
  const toIso   = isoComFuso(to);

  const loadHtml = '<div class="rel-loading"><i class="fa fa-spin fa-spinner"></i> Carregando...</div>';
  ['eventos-content','viagens-content','paradas-content','resumo-content','grafico-content'].forEach(k => {
    document.getElementById(k).innerHTML = loadHtml;
  });
  document.getElementById('rota-stats').innerHTML = '';
  document.getElementById('mapa-rota-loading').style.display = 'flex';

  const qs = `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  const base = `/api/cliente/rastreamento/dispositivos/${_did}`;

  try {
    const [historico, viagens, paradas, eventos, resumo] = await Promise.allSettled([
      apiGet(`${base}/historico?${qs}`),
      apiGet(`${base}/viagens?${qs}`),
      apiGet(`${base}/paradas?${qs}`),
      apiGet(`${base}/eventos?${qs}`),
      apiGet(`${base}/resumo?${qs}`),
    ]);

    renderRota(historico.status === 'fulfilled' ? historico.value : null);
    renderEventos(eventos.status === 'fulfilled' ? eventos.value : null);
    await renderViagens(viagens.status === 'fulfilled' ? viagens.value : null);
    await renderParadas(paradas.status === 'fulfilled' ? paradas.value : null);
    renderResumo(
      resumo.status === 'fulfilled'  ? resumo.value  : null,
      viagens.status === 'fulfilled' ? viagens.value : null,
      paradas.status === 'fulfilled' ? paradas.value : null,
    );
    renderGrafico(historico.status === 'fulfilled' ? historico.value : null);
  } catch (err) {
    console.error('Erro ao carregar relatório:', err);
  } finally {
    document.getElementById('mapa-rota-loading').style.display = 'none';
  }
}

// ── Mapa ──────────────────────────────────────────────────────────────────────

function inicializarMapaRota() {
  mapaRota = L.map('mapa-rota', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);
  _googleMapLayers = _criarCamadasGoogle();

  const tilesEsri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 21 });
  const tilesOsm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21 });
  const tilesCartoDB = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© CartoDB', maxNativeZoom: 19, maxZoom: 21 });

  _googleMapLayers.roadmap.addTo(mapaRota);
  L.control.layers(
    { 'Google Maps': _googleMapLayers.roadmap, 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {}, { position: 'topright', collapsed: true }
  ).addTo(mapaRota);
  _adicionarControleTipoGoogle();
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(mapaRota);
  mapaRota.on('baselayerchange', function () { _atualizarControleTipoGoogle(); });

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
    return mapaRota && mapaRota.hasLayer(_googleMapLayers[tipo]);
  });
}

function _trocarTipoGoogle(tipo) {
  if (!_googleMapLayers[tipo] || tipo === _googleMapType) return;
  const anterior = _googleMapLayers[_googleMapType];
  if (anterior && mapaRota.hasLayer(anterior)) mapaRota.removeLayer(anterior);
  _googleMapType = tipo;
  _googleMapLayers[tipo].addTo(mapaRota);
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
        const abrindo = menu.style.display === 'none';
        menu.style.display = abrindo ? 'block' : 'none';
        btn.classList.toggle('ativo', abrindo);
      });
      wrap.querySelectorAll('[data-google-map-type]').forEach(function (item) {
        L.DomEvent.on(item, 'click', function (e) {
          L.DomEvent.stop(e);
          _trocarTipoGoogle(item.getAttribute('data-google-map-type'));
          menu.style.display = 'none';
          btn.classList.remove('ativo');
        });
      });
      document.addEventListener('click', function () { menu.style.display = 'none'; btn.classList.remove('ativo'); });
      _googleMapTypeControl = wrap;
      setTimeout(_atualizarControleTipoGoogle, 0);
      return wrap;
    },
    onRemove() {},
  });
  new GoogleTypeControl({ position: 'topright' }).addTo(mapaRota);
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

function renderRota(data) {
  mapaRota.eachLayer(layer => {
    if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) mapaRota.removeLayer(layer);
  });
  if (!data || !data.posicoes || !data.posicoes.length) {
    document.getElementById('rota-stats').innerHTML = '<i class="fa fa-info-circle"></i> Nenhuma posição no período.';
    return;
  }
  const posicoes = data.posicoes.filter(p => p.valida !== false);
  if (!posicoes.length) { document.getElementById('rota-stats').innerHTML = 'Nenhuma posição válida.'; return; }

  const coords = posicoes.map(p => [p.latitude, p.longitude]);
  L.polyline(coords, { color: '#2980b9', weight: 3, opacity: 0.8 }).addTo(mapaRota);
  const ini = posicoes[0];
  L.circleMarker([ini.latitude, ini.longitude], { radius: 7, color: '#27ae60', fillColor: '#27ae60', fillOpacity: 1 })
    .bindPopup('<b>Início</b><br>' + fmtHora(ini.fixTime)).addTo(mapaRota);
  const fim = posicoes[posicoes.length - 1];
  L.circleMarker([fim.latitude, fim.longitude], { radius: 7, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 1 })
    .bindPopup('<b>Fim</b><br>' + fmtHora(fim.fixTime)).addTo(mapaRota);
  mapaRota.fitBounds(L.polyline(coords).getBounds().pad(0.1));
  mapaRota.invalidateSize();

  const vmax = posicoes.reduce((m, p) => Math.max(m, p.velocidade || 0), 0);
  document.getElementById('rota-stats').innerHTML =
    `<i class="fa fa-map-marker" style="color:#2980b9"></i> <strong>${posicoes.length}</strong> posições &nbsp;·&nbsp;
     <i class="fa fa-tachometer" style="color:#e74c3c"></i> Vel. máx: <strong>${vmax} km/h</strong> &nbsp;·&nbsp;
     <i class="fa fa-clock-o" style="color:#e67e22"></i> ${fmtHora(ini.fixTime)} – ${fmtHora(fim.fixTime)}`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function renderEventos(lista) {
  const el = document.getElementById('eventos-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty"><i class="fa fa-bell-slash-o"></i><br>Nenhum evento no período.</div>'; return; }
  el.innerHTML = `<div class="table-responsive"><table class="rel-table rel-table--center table"><thead><tr><th>Hora</th><th>Tipo</th><th>Detalhes</th></tr></thead><tbody>
    ${lista.map(e => {
      const info = _EVENTO_LABEL[e.tipo] || { label: e.tipo, cls: 'ev-default' };
      const det = Object.entries(e.atributos || {}).filter(([k]) => !['protocol','alarm'].includes(k)).map(([k,v]) => `${k}: ${v}`).join(', ');
      return `<tr><td style="white-space:nowrap">${fmtHora(e.hora)}</td><td><span class="ev-badge ${info.cls}">${info.label}</span></td><td style="font-size:11px;color:#888">${det||'—'}</td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

async function renderViagens(lista) {
  const el = document.getElementById('viagens-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty"><i class="fa fa-car"></i><br>Nenhuma viagem no período.</div>'; return; }
  let totalKm = 0, totalMin = 0, vmax = 0;
  lista.forEach(v => { totalKm += v.distancia || 0; totalMin += v.duracao || 0; vmax = Math.max(vmax, v.velocidadeMaxima || 0); });
  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div class="resumo-card" style="min-width:100px"><div class="rc-val">${lista.length}</div><div class="rc-lbl">Viagens</div></div>
      <div class="resumo-card" style="min-width:100px"><div class="rc-val">${totalKm.toFixed(1)}</div><div class="rc-lbl">km total</div></div>
      <div class="resumo-card" style="min-width:100px"><div class="rc-val">${fmtDuracao(totalMin)}</div><div class="rc-lbl">Tempo total</div></div>
      <div class="resumo-card" style="min-width:100px"><div class="rc-val">${vmax}</div><div class="rc-lbl">km/h máx</div></div>
    </div>
    <div class="table-responsive"><table class="rel-table rel-table--center table"><thead><tr>
      <th>#</th><th>Início</th><th>Fim</th><th>Duração</th><th>Distância</th><th>Vel. Máx</th><th>Origem/Destino</th>
    </tr></thead><tbody>
      ${(await Promise.all(lista.map(async (v, i) => {
        const origem = await resolverEndereco(v.origem, v.origemLat, v.origemLng);
        const destino = await resolverEndereco(v.destino, v.destinoLat, v.destinoLng);
        return `<tr>
          <td style="color:#888">${i+1}</td>
          <td style="white-space:nowrap">${fmtHora(v.inicio)}</td>
          <td style="white-space:nowrap">${fmtHora(v.fim)}</td>
          <td>${fmtDuracao(v.duracao)}</td>
          <td>${(v.distancia||0).toFixed(1)} km</td>
          <td>${v.velocidadeMaxima||0} km/h</td>
          <td style="font-size:10px">${origem}<br>→ ${destino}</td>
        </tr>`;
      }))).join('')}
    </tbody></table></div>`;
}

async function renderParadas(lista) {
  const el = document.getElementById('paradas-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty"><i class="fa fa-pause-circle-o"></i><br>Nenhuma parada no período.</div>'; return; }
  el.innerHTML = (await Promise.all(lista.map(async (p, i) => `
    <div class="parada-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:12px;text-align:left"><i class="fa fa-map-marker" style="color:#fab32c"></i> Parada ${i+1}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;text-align:left">${await resolverEndereco(p.endereco, p.latitude, p.longitude)}</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#888"><div>${fmtDuracao(p.duracao)}</div></div>
      </div>
      <div style="font-size:10px;color:#aaa;margin-top:4px">${fmtHora(p.inicio)} → ${fmtHora(p.fim)}</div>
    </div>`))).join('');
}

function renderResumo(resumo, viagens, paradas) {
  const el = document.getElementById('resumo-content');
  const qtdV = Array.isArray(viagens) ? viagens.length : 0;
  const qtdP = Array.isArray(paradas) ? paradas.length : 0;
  let tmpP = 0;
  if (Array.isArray(paradas)) paradas.forEach(p => { tmpP += p.duracao || 0; });
  if (!resumo && !qtdV && !qtdP) { el.innerHTML = '<div class="rel-empty">Nenhum dado disponível.</div>'; return; }
  el.innerHTML = `<div class="resumo-grid">
    <div class="resumo-card"><div class="rc-val">${resumo?.distancia != null ? resumo.distancia.toFixed(1) : '—'}</div><div class="rc-lbl">km percorridos</div></div>
    <div class="resumo-card"><div class="rc-val">${resumo?.velocidadeMaxima ?? '—'}</div><div class="rc-lbl">km/h máxima</div></div>
    <div class="resumo-card"><div class="rc-val">${resumo?.velocidadeMedia ?? '—'}</div><div class="rc-lbl">km/h média</div></div>
    <div class="resumo-card"><div class="rc-val">${resumo?.horasMotor != null ? resumo.horasMotor.toFixed(1)+'h' : '—'}</div><div class="rc-lbl">Horas motor</div></div>
    <div class="resumo-card"><div class="rc-val">${qtdV}</div><div class="rc-lbl">Viagens</div></div>
    <div class="resumo-card"><div class="rc-val">${qtdP}</div><div class="rc-lbl">Paradas</div></div>
    <div class="resumo-card"><div class="rc-val">${fmtDuracao(tmpP)}</div><div class="rc-lbl">Tempo parado</div></div>
  </div>`;
}

function renderGrafico(data) {
  const el = document.getElementById('grafico-content');
  if (!data || !data.posicoes || !data.posicoes.length) { el.innerHTML = '<div class="rel-empty">Nenhum dado de velocidade disponível.</div>'; return; }
  let amostras = data.posicoes.filter(p => p.fixTime && p.velocidade != null);
  if (amostras.length > 300) { const step = Math.ceil(amostras.length / 300); amostras = amostras.filter((_, i) => i % step === 0); }
  if (!amostras.length) { el.innerHTML = '<div class="rel-empty">Nenhum dado disponível.</div>'; return; }

  const isDark = document.documentElement.classList.contains('dark-theme');
  const textColor = isDark ? '#adb5bd' : '#555';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  el.innerHTML = '<canvas id="canvas-grafico"></canvas>';
  if (chartVelocidade) { chartVelocidade.destroy(); chartVelocidade = null; }
  const ctx = document.getElementById('canvas-grafico').getContext('2d');
  chartVelocidade = new Chart(ctx, {
    type: 'line',
    data: {
      labels: amostras.map(p => fmtHora(p.fixTime)),
      datasets: [{ label: 'Velocidade (km/h)', data: amostras.map(p => p.velocidade||0),
        borderColor: '#2980b9', backgroundColor: 'rgba(41,128,185,0.12)',
        borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} km/h` } } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 }, color: textColor }, grid: { color: gridColor } },
        y: { beginAtZero: true, title: { display: true, text: 'km/h', font: { size: 11 }, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } },
      },
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function exportarRelatorio() {
  const { from, to } = calcularIntervalo();
  const tipo = document.getElementById('export-tipo').value;
  const btn = document.getElementById('btn-confirmar-exportar');
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Gerando...';
  try {
    const url = `${_BASE}/api/cliente/rastreamento/dispositivos/${_did}/exportar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&type=${encodeURIComponent(tipo)}`;
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + _token } });
    if (!res.ok) {
      let msg = 'Erro ao gerar arquivo.';
      try {
        const data = await res.json();
        msg = data.error || msg;
      } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = `relatorio_${tipo}_${Date.now()}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(a.href);
    $('#modal-exportar').modal('hide');
  } catch (err) {
    alert(err.message || 'Erro ao exportar relatório.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuracao(mins) {
  if (!mins && mins !== 0) return '—';
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h + 'h' + (m ? ' ' + m + 'min' : '');
}
