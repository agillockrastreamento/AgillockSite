'use strict';

let mapaRota = null;
let chartVelocidade = null;
let periodoAtual = 'hoje';
let dispositivoIdsAtuais = [];
let dispositivosMap = {}; // id -> { nome, placa }

const _COLORS = [
  '#2980b9', '#e74c3c', '#27ae60', '#f39c12', '#8e44ad', 
  '#16a085', '#d35400', '#2c3e50', '#c0392b', '#27ae60'
];

// ── Mapeamento de tipos de eventos ────────────────────────────────────────────

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

document.addEventListener('DOMContentLoaded', async function () {
  await carregarDispositivos();
  
  // Inicializa o Select2 Multiseletor
  $('#sel-dispositivo').select2({
    placeholder: 'Selecione os dispositivos...',
    allowClear: true,
    width: '100%'
  });

  // Pré-selecionar dispositivo via ?id=
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam) {
    $('#sel-dispositivo').val([idParam]).trigger('change');
  }

  configurarPeriodo();
  inicializarMapaRota();

  // ── Botões de período ──
  document.querySelectorAll('.periodo-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      periodoAtual = this.dataset.periodo;

      const isCustom = periodoAtual === 'custom';
      document.getElementById('custom-datas').style.display = isCustom ? 'flex' : 'none';

      const selecionados = $('#sel-dispositivo').val();
      if (!isCustom && selecionados && selecionados.length > 0) carregarRelatorio();
    });
  });

  // ── Seletor de dispositivo (Select2 change) ──
  $('#sel-dispositivo').on('change', function () {
    const selecionados = $(this).val();
    dispositivoIdsAtuais = selecionados || [];
    if (dispositivoIdsAtuais.length > 0 && periodoAtual !== 'custom') carregarRelatorio();
  });

  document.getElementById('btn-abrir-exportar').addEventListener('click', function() {
    const selecionados = $('#sel-dispositivo').val();
    if (!selecionados || selecionados.length === 0) {
      AL.showAlert('Selecione pelo menos um dispositivo para exportar.', 'warning');
      return;
    }
    $('#modal-exportar').modal('show');
  });

  document.getElementById('btn-confirmar-exportar').addEventListener('click', exportarRelatorio);
  document.getElementById('btn-carregar').addEventListener('click', carregarRelatorio);

  $('a[href="#tab-rota"]').on('shown.bs.tab', function () {
    if (mapaRota) mapaRota.invalidateSize();
  });
});

async function carregarDispositivos() {
  try {
    const lista = await AL.apiGet('/api/rastreamento/posicoes');
    const sel = document.getElementById('sel-dispositivo');
    lista.sort((a, b) => a.nome.localeCompare(b.nome));
    lista.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.traccarId;
      opt.textContent = v.nome + (v.placa ? ` (${v.placa})` : '');
      sel.appendChild(opt);
      dispositivosMap[v.traccarId] = { nome: v.nome, placa: v.placa };
    });
  } catch (err) {
    console.error('Erro dispositivos:', err);
  }
}

function configurarPeriodo() {
  const hoje = new Date();
  const dtStr = formatarData(hoje);
  const elDe = document.getElementById('dt-de'), elAte = document.getElementById('dt-ate');
  if (elDe) elDe.value = dtStr;
  if (elAte) elAte.value = dtStr;
}

function formatarData(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calcularIntervalo() {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
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

// ── Carregamento ──────────────────────────────────────────────────────────────

async function carregarRelatorio() {
  if (dispositivoIdsAtuais.length === 0) {
    AL.showAlert('Selecione os dispositivos.', 'warning');
    return;
  }

  const { from, to } = calcularIntervalo();
  const fromIso = isoComFuso(from), toIso = isoComFuso(to);

  const loadHtml = '<div class="rel-loading"><i class="fa fa-spin fa-spinner"></i> Carregando...</div>';
  ['eventos-content','viagens-content','paradas-content','resumo-content','grafico-content'].forEach(k => {
    const el = document.getElementById(k); if(el) el.innerHTML = loadHtml;
  });
  document.getElementById('rota-stats').innerHTML = '';
  document.getElementById('mapa-rota-loading').style.display = 'flex';

  let qs = `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  dispositivoIdsAtuais.forEach(id => qs += `&deviceId=${id}`);

  try {
    const [historico, viagens, paradas, eventos, resumo] = await Promise.allSettled([
      AL.apiGet(`/api/rastreamento/relatorios/batch/historico?${qs}`),
      AL.apiGet(`/api/rastreamento/relatorios/batch/viagens?${qs}`),
      AL.apiGet(`/api/rastreamento/relatorios/batch/paradas?${qs}`),
      AL.apiGet(`/api/rastreamento/relatorios/batch/eventos?${qs}`),
      AL.apiGet(`/api/rastreamento/relatorios/batch/resumo?${qs}`),
    ]);

    renderRota(historico.status === 'fulfilled' ? historico.value : null);
    renderEventos(eventos.status === 'fulfilled' ? eventos.value : null);
    renderViagens(viagens.status === 'fulfilled' ? viagens.value : null);
    renderParadas(paradas.status === 'fulfilled' ? paradas.value : null);
    renderResumoBatch(resumo.status === 'fulfilled' ? resumo.value : null);
    renderGraficoBatch(historico.status === 'fulfilled' ? historico.value : null);
  } catch (err) {
    AL.showAlert('Erro: ' + err.message, 'danger');
  } finally {
    document.getElementById('mapa-rota-loading').style.display = 'none';
  }
}

// ── Aba Rota ──────────────────────────────────────────────────────────────────

function inicializarMapaRota() {
  mapaRota = L.map('mapa-rota', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21 });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21 });
  const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxNativeZoom: 19, maxZoom: 21 });
  carto.addTo(mapaRota);
  L.control.layers({ 'CartoDB': carto, 'OpenStreetMap': osm, 'ESRI Street': esri }, {}, { position: 'topright' }).addTo(mapaRota);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(mapaRota);
}

function renderRota(data) {
  mapaRota.eachLayer(layer => { if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) mapaRota.removeLayer(layer); });
  if (!data || !data.posicoes || !data.posicoes.length) {
    document.getElementById('rota-stats').innerHTML = 'Nenhuma posição encontrada.';
    return;
  }
  const group = L.featureGroup();
  const porDispositivo = {};
  data.posicoes.forEach(p => { if (!porDispositivo[p.deviceId]) porDispositivo[p.deviceId] = []; porDispositivo[p.deviceId].push(p); });

  let idx = 0;
  for (const did in porDispositivo) {
    const pos = porDispositivo[did], cor = _COLORS[idx % _COLORS.length], dInfo = dispositivosMap[did] || { nome: did };
    const coords = pos.map(p => [p.latitude, p.longitude]);
    const poly = L.polyline(coords, { color: cor, weight: 4, opacity: 0.8 }).bindTooltip(`<b>${dInfo.nome}</b>`).addTo(mapaRota);
    group.addLayer(poly);
    const ini = pos[0], fim = pos[pos.length - 1];
    L.circleMarker([ini.latitude, ini.longitude], { radius: 7, color: cor, fillColor: '#fff', fillOpacity: 1 }).bindPopup(`<b>Início: ${dInfo.nome}</b><br>${fmtHora(ini.fixTime)}`).addTo(mapaRota);
    L.circleMarker([fim.latitude, fim.longitude], { radius: 7, color: cor, fillColor: cor, fillOpacity: 1 }).bindPopup(`<b>Fim: ${dInfo.nome}</b><br>${fmtHora(fim.fixTime)}`).addTo(mapaRota);
    idx++;
  }
  if (group.getLayers().length > 0) mapaRota.fitBounds(group.getBounds().pad(0.1));
  document.getElementById('rota-stats').innerHTML = `<i class="fa fa-info-circle"></i> Exibindo trajeto de <strong>${Object.keys(porDispositivo).length}</strong> dispositivos.`;
}

// ── Renderização das Tabelas e Cards ──────────────────────────────────────────

function renderEventos(lista) {
  const el = document.getElementById('eventos-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty">Nenhum evento encontrado.</div>'; return; }
  el.innerHTML = `<div class="table-responsive"><table class="rel-table table">
    <thead><tr><th>Veículo</th><th>Hora</th><th>Tipo</th><th>Detalhes</th></tr></thead>
    <tbody>${lista.map(e => {
      const info = _EVENTO_LABEL[e.tipo] || { label: e.tipo, cls: 'ev-default' };
      const d = dispositivosMap[e.deviceId] || { nome: '—' };
      const det = Object.entries(e.atributos || {}).filter(([k]) => !['protocol','alarm'].includes(k)).map(([k,v]) => `${k}:${v}`).join(', ');
      return `<tr><td><strong>${d.nome}</strong></td><td>${fmtHora(e.hora)}</td><td><span class="ev-badge ${info.cls}">${info.label}</span></td><td style="font-size:11px;color:#888">${det || '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function renderViagens(lista) {
  const el = document.getElementById('viagens-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty">Nenhuma viagem encontrada.</div>'; return; }
  el.innerHTML = `<div class="table-responsive"><table class="rel-table table">
    <thead><tr><th>Veículo</th><th>Início</th><th>Fim</th><th>Duração</th><th>Km</th><th>Origem/Destino</th></tr></thead>
    <tbody>${lista.map(v => {
      const d = dispositivosMap[v.deviceId] || { nome: '—' };
      return `<tr><td><strong>${d.nome}</strong></td><td>${fmtHora(v.startTime)}</td><td>${fmtHora(v.endTime)}</td><td>${fmtDuracao(v.duration / 60000)}</td><td>${(v.distance / 1000).toFixed(1)} km</td><td style="font-size:10px">${v.startAddress || '—'}<br>→ ${v.endAddress || '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function renderParadas(lista) {
  const el = document.getElementById('paradas-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty">Nenhuma parada encontrada.</div>'; return; }
  el.innerHTML = lista.map((p, i) => {
    const d = dispositivosMap[p.deviceId] || { nome: '—' };
    return `<div class="parada-card">
      <div style="display:flex;justify-content:space-between">
        <div><div style="font-weight:600;font-size:13px"><i class="fa fa-map-marker" style="color:#fab32c"></i> ${d.nome} — Parada ${i+1}</div><div style="font-size:11px;color:#888;margin-top:2px">${p.address || 'Endereço não identificado'}</div></div>
        <div style="text-align:right;font-size:12px;color:#888"><div><i class="fa fa-clock-o"></i> ${fmtDuracao(p.duration / 60000)}</div>${p.engineHours ? `<div><i class="fa fa-cog"></i> ${Math.round(p.engineHours/3600000)}h motor</div>` : ''}</div>
      </div>
      <div style="font-size:10px;color:#aaa;margin-top:5px">${fmtHora(p.startTime)} → ${fmtHora(p.endTime)}</div>
    </div>`;
  }).join('');
}

function renderResumoBatch(lista) {
  const el = document.getElementById('resumo-content');
  if (!lista || !lista.length) { el.innerHTML = '<div class="rel-empty">Sem dados de resumo.</div>'; return; }

  if (lista.length === 1) {
    // Estilo clássico para um único veículo
    const r = lista[0];
    const d = dispositivosMap[r.deviceId] || { nome: '—' };
    el.innerHTML = `
      <div style="margin-bottom:15px; font-weight:700; color:#888; text-align:center; text-transform:uppercase; letter-spacing:1px;">
        Resumo Geral — ${d.nome}
      </div>
      <div class="resumo-grid">
        <div class="resumo-card">
          <div class="rc-val">${(r.distance / 1000).toFixed(1)}</div>
          <div class="rc-lbl"><i class="fa fa-road"></i> Distância Percorrida (km)</div>
        </div>
        <div class="resumo-card">
          <div class="rc-val">${Math.round(r.averageSpeed * 1.852)}</div>
          <div class="rc-lbl"><i class="fa fa-dashboard"></i> Velocidade Média (km/h)</div>
        </div>
        <div class="resumo-card">
          <div class="rc-val">${Math.round(r.maxSpeed * 1.852)}</div>
          <div class="rc-lbl"><i class="fa fa-bolt"></i> Velocidade Máxima (km/h)</div>
        </div>
        <div class="resumo-card">
          <div class="rc-val">${(r.engineHours / 3600000).toFixed(1)}</div>
          <div class="rc-lbl"><i class="fa fa-clock-o"></i> Horas de Motor (h)</div>
        </div>
      </div>`;
  } else {
    // Estilo grade comparativa para múltiplos veículos
    el.innerHTML = `<div class="resumo-grid">${lista.map(r => {
      const d = dispositivosMap[r.deviceId] || { nome: '—' };
      return `<div class="resumo-card">
        <div style="font-size:11px;font-weight:700;color:#888;margin-bottom:8px;text-transform:uppercase">${d.nome}</div>
        <div class="rc-val" style="font-size:22px">${(r.distance / 1000).toFixed(1)} <small style="font-size:12px">km</small></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:10px;font-size:11px;color:#666">
          <div>Média: <strong>${Math.round(r.averageSpeed * 1.852)}</strong></div><div>Máxima: <strong>${Math.round(r.maxSpeed * 1.852)}</strong></div>
          <div>Motor: <strong>${(r.engineHours / 3600000).toFixed(1)}h</strong></div><div>Gasto: <strong>${r.spentFuel || 0}L</strong></div>
        </div>
      </div>`;
    }).join('')}</div>`;
  }
}

function renderGraficoBatch(data) {
  const el = document.getElementById('grafico-content');
  if (!data || !data.posicoes || !data.posicoes.length) { el.innerHTML = '<div class="rel-empty">Sem dados para o gráfico.</div>'; return; }
  
  const datasets = [];
  const porDispositivo = {};
  data.posicoes.forEach(p => { 
    if (!porDispositivo[p.deviceId]) porDispositivo[p.deviceId] = []; 
    porDispositivo[p.deviceId].push({ x: new Date(p.fixTime), y: p.velocidade }); 
  });

  const ids = Object.keys(porDispositivo);
  const isSingle = ids.length === 1;

  let idx = 0;
  for (const did in porDispositivo) {
    const d = dispositivosMap[did] || { nome: did }, cor = _COLORS[idx % _COLORS.length];
    datasets.push({ 
      label: d.nome, 
      data: porDispositivo[did], 
      borderColor: cor, 
      backgroundColor: cor + (isSingle ? '33' : '15'),
      borderWidth: isSingle ? 3 : 2,
      pointRadius: 0, 
      tension: 0.3, 
      fill: true 
    });
    idx++;
  }

  el.innerHTML = '<div style="height:350px"><canvas id="canvas-grafico"></canvas></div>';
  if (chartVelocidade) chartVelocidade.destroy();
  
  chartVelocidade = new Chart(document.getElementById('canvas-grafico').getContext('2d'), {
    type: 'line', 
    data: { datasets },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      scales: { 
        x: { 
          type: 'time', 
          time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
          ticks: { color: '#888' }
        }, 
        y: { 
          beginAtZero: true, 
          title: { display: true, text: 'km/h' } 
        } 
      },
      plugins: {
        legend: { display: !isSingle }
      }
    }
  });
}

// ── Exportação ────────────────────────────────────────────────────────────────

async function exportarRelatorio() {
  const selecionados = $('#sel-dispositivo').val();
  if (!selecionados || selecionados.length === 0) return;
  const tipo = document.getElementById('export-tipo').value, { from, to } = calcularIntervalo();
  const btn = document.getElementById('btn-confirmar-exportar'), old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Gerando...';
  
  try {
    const token = localStorage.getItem('al-token') || localStorage.getItem('al_token');
    let url = `${window.API_URL}/api/rastreamento/relatorios/exportar?from=${from.toISOString()}&to=${to.toISOString()}&type=${tipo}`;
    selecionados.forEach(id => url += `&deviceId=${id}`);
    
    const res = await fetch(url, { 
      headers: { 'Authorization': `Bearer ${token}` } 
    });
    
    if (res.status === 401) throw new Error('Sessão expirada. Faça login novamente.');
    if (!res.ok) throw new Error('Erro ao gerar arquivo no servidor.');
    
    const blob = await res.blob(), a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob); 
    a.download = `relatorio_${tipo}_${Date.now()}.xlsx`; 
    a.click();
    $('#modal-exportar').modal('hide'); 
    AL.showAlert('Download concluído!', 'success');
  } catch (err) { 
    AL.showAlert(err.message, 'danger'); 
  } finally { 
    btn.disabled = false; 
    btn.innerHTML = old; 
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuracao(mins) {
  if (!mins && mins !== 0) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
