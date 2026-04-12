'use strict';

let mapaRota = null;
let chartVelocidade = null;
let periodoAtual = 'hoje';
let dispositivoIdAtual = null;
let dispositivoNomeAtual = '';

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

  // Pré-selecionar dispositivo via ?id=
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam) {
    const sel = document.getElementById('sel-dispositivo');
    sel.value = idParam;
    if (sel.value === idParam) {
      dispositivoIdAtual = idParam;
      dispositivoNomeAtual = sel.options[sel.selectedIndex]?.text || '';
    }
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

      // Auto-carrega se não for personalizado e tiver dispositivo
      if (!isCustom && dispositivoIdAtual) carregarRelatorio();
    });
  });

  // ── Seletor de dispositivo ──
  document.getElementById('sel-dispositivo').addEventListener('change', function () {
    const sel = this;
    dispositivoIdAtual = sel.value || null;
    dispositivoNomeAtual = sel.value ? (sel.options[sel.selectedIndex]?.text || '') : '';

    // Auto-carrega se período não for personalizado
    if (dispositivoIdAtual && periodoAtual !== 'custom') carregarRelatorio();
  });

  // ── Botão carregar (só para personalizado) ──
  document.getElementById('btn-carregar').addEventListener('click', carregarRelatorio);

  // Reinicia mapa ao mudar para aba Rota
  $('a[href="#tab-rota"]').on('shown.bs.tab', function () {
    if (mapaRota) mapaRota.invalidateSize();
  });

  // Carrega imediatamente se dispositivo já estava pré-selecionado
  if (dispositivoIdAtual && periodoAtual !== 'custom') carregarRelatorio();
});

async function carregarDispositivos() {
  try {
    const lista = await AL.apiGet('/api/rastreamento/posicoes');
    const sel = document.getElementById('sel-dispositivo');
    lista.sort((a, b) => a.nome.localeCompare(b.nome));
    lista.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.dispositivoId;
      opt.textContent = v.nome + (v.placa ? ` (${v.placa})` : '');
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
  }
}

function configurarPeriodo() {
  const hoje = new Date();
  const dtAte = formatarData(hoje);
  const dtDe  = formatarData(hoje);
  document.getElementById('dt-de').value  = dtDe;
  document.getElementById('dt-ate').value = dtAte;
}

function formatarData(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
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
  // custom
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

// ── Carregamento de dados ─────────────────────────────────────────────────────

async function carregarRelatorio() {
  if (!dispositivoIdAtual) {
    AL.showAlert('Selecione um dispositivo.', 'warning');
    return;
  }

  const { from, to } = calcularIntervalo();
  const fromIso = isoComFuso(from);
  const toIso   = isoComFuso(to);
  const id = dispositivoIdAtual;

  const loadHtml = '<div class="rel-loading"><i class="fa fa-spin fa-spinner"></i> Carregando...</div>';
  ['eventos-content','viagens-content','paradas-content','resumo-content','grafico-content'].forEach(k => {
    document.getElementById(k).innerHTML = loadHtml;
  });
  document.getElementById('rota-stats').innerHTML = '';
  document.getElementById('mapa-rota-loading').style.display = 'flex';

  const qs = `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  try {
    const [historico, viagens, paradas, eventos, resumo] = await Promise.allSettled([
      AL.apiGet(`/api/rastreamento/dispositivos/${id}/historico?${qs}`),
      AL.apiGet(`/api/rastreamento/dispositivos/${id}/viagens?${qs}`),
      AL.apiGet(`/api/rastreamento/dispositivos/${id}/paradas?${qs}`),
      AL.apiGet(`/api/rastreamento/dispositivos/${id}/eventos?${qs}`),
      AL.apiGet(`/api/rastreamento/dispositivos/${id}/resumo?${qs}`),
    ]);

    renderRota(historico.status === 'fulfilled' ? historico.value : null);
    renderEventos(eventos.status === 'fulfilled' ? eventos.value : null);
    renderViagens(viagens.status === 'fulfilled' ? viagens.value : null);
    renderParadas(paradas.status === 'fulfilled' ? paradas.value : null);
    renderResumo(
      resumo.status === 'fulfilled'  ? resumo.value   : null,
      viagens.status === 'fulfilled' ? viagens.value  : null,
      paradas.status === 'fulfilled' ? paradas.value  : null,
    );
    renderGrafico(historico.status === 'fulfilled' ? historico.value : null);
  } catch (err) {
    AL.showAlert('Erro ao carregar dados: ' + err.message, 'danger');
  } finally {
    document.getElementById('mapa-rota-loading').style.display = 'none';
  }
}

// ── Aba Rota ──────────────────────────────────────────────────────────────────

function inicializarMapaRota() {
  mapaRota = L.map('mapa-rota', { zoomControl: true, maxZoom: 21 }).setView([-15.78, -47.93], 5);

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

  tilesCartoDB.addTo(mapaRota);

  L.control.layers(
    { 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(mapaRota);

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(mapaRota);
}

function renderRota(data) {
  mapaRota.eachLayer(layer => {
    if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) mapaRota.removeLayer(layer);
  });

  if (!data || !data.posicoes || !data.posicoes.length) {
    document.getElementById('rota-stats').innerHTML =
      '<i class="fa fa-info-circle"></i> Nenhuma posição no período selecionado.';
    return;
  }

  const posicoes = data.posicoes.filter(p => p.valida !== false);
  if (!posicoes.length) {
    document.getElementById('rota-stats').innerHTML = 'Nenhuma posição válida encontrada.';
    return;
  }

  const coords = posicoes.map(p => [p.latitude, p.longitude]);
  L.polyline(coords, { color: '#2980b9', weight: 3, opacity: 0.8 }).addTo(mapaRota);

  const inicio = posicoes[0];
  L.circleMarker([inicio.latitude, inicio.longitude], {
    radius: 8, color: '#27ae60', fillColor: '#27ae60', fillOpacity: 1
  }).bindPopup('<b>Início</b><br>' + fmtHora(inicio.fixTime)).addTo(mapaRota);

  const fim = posicoes[posicoes.length - 1];
  L.circleMarker([fim.latitude, fim.longitude], {
    radius: 8, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 1
  }).bindPopup('<b>Fim</b><br>' + fmtHora(fim.fixTime)).addTo(mapaRota);

  mapaRota.fitBounds(L.polyline(coords).getBounds().pad(0.1));
  mapaRota.invalidateSize();

  const vmax = posicoes.reduce((m, p) => Math.max(m, p.velocidade || 0), 0);
  document.getElementById('rota-stats').innerHTML =
    `<i class="fa fa-map-marker" style="color:#2980b9"></i> <strong>${posicoes.length}</strong> posições &nbsp;·&nbsp;
     <i class="fa fa-tachometer" style="color:#e74c3c"></i> Vel. máx: <strong>${vmax} km/h</strong> &nbsp;·&nbsp;
     <i class="fa fa-clock-o" style="color:#e67e22"></i> ${fmtHora(inicio.fixTime)} – ${fmtHora(fim.fixTime)}`;
}

// ── Aba Eventos ───────────────────────────────────────────────────────────────

function renderEventos(lista) {
  const el = document.getElementById('eventos-content');
  if (!lista || !lista.length) {
    el.innerHTML = '<div class="rel-empty"><i class="fa fa-bell-slash-o"></i><br>Nenhum evento no período selecionado.</div>';
    return;
  }

  el.innerHTML = `<div class="table-responsive">
    <table class="rel-table table">
      <thead><tr><th>Hora</th><th>Tipo</th><th>Detalhes</th></tr></thead>
      <tbody>
        ${lista.map(e => {
          const info = _EVENTO_LABEL[e.tipo] || { label: e.tipo, cls: 'ev-default' };
          const det = Object.entries(e.atributos || {})
            .filter(([k]) => !['protocol','alarm'].includes(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          return `<tr>
            <td style="white-space:nowrap">${fmtHora(e.hora)}</td>
            <td><span class="ev-badge ${info.cls}">${info.label}</span></td>
            <td style="font-size:11px;color:#888">${det || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

// ── Aba Viagens ───────────────────────────────────────────────────────────────

function renderViagens(lista) {
  const el = document.getElementById('viagens-content');
  if (!lista || !lista.length) {
    el.innerHTML = '<div class="rel-empty"><i class="fa fa-car"></i><br>Nenhuma viagem no período selecionado.</div>';
    return;
  }

  let totalKm = 0, totalMin = 0, vmax = 0;
  lista.forEach(v => { totalKm += v.distancia || 0; totalMin += v.duracao || 0; vmax = Math.max(vmax, v.velocidadeMaxima || 0); });

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div class="resumo-card" style="min-width:110px"><div class="rc-val">${lista.length}</div><div class="rc-lbl">Viagens</div></div>
      <div class="resumo-card" style="min-width:110px"><div class="rc-val">${totalKm.toFixed(1)}</div><div class="rc-lbl">km total</div></div>
      <div class="resumo-card" style="min-width:110px"><div class="rc-val">${fmtDuracao(totalMin)}</div><div class="rc-lbl">Tempo total</div></div>
      <div class="resumo-card" style="min-width:110px"><div class="rc-val">${vmax}</div><div class="rc-lbl">km/h máx</div></div>
    </div>
    <div class="table-responsive">
      <table class="rel-table table">
        <thead><tr>
          <th>#</th><th>Início</th><th>Fim</th><th>Duração</th>
          <th>Distância</th><th>Vel. Máx</th><th>Vel. Média</th>
          <th>Origem</th><th>Destino</th>
        </tr></thead>
        <tbody>
          ${lista.map((v, i) => `<tr>
            <td style="color:#888">${i + 1}</td>
            <td style="white-space:nowrap">${fmtHora(v.inicio)}</td>
            <td style="white-space:nowrap">${fmtHora(v.fim)}</td>
            <td>${fmtDuracao(v.duracao)}</td>
            <td>${(v.distancia || 0).toFixed(1)} km</td>
            <td>${v.velocidadeMaxima || 0} km/h</td>
            <td>${v.velocidadeMedia || 0} km/h</td>
            <td style="font-size:11px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.origem || '—'}</td>
            <td style="font-size:11px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.destino || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Aba Paradas ───────────────────────────────────────────────────────────────

function renderParadas(lista) {
  const el = document.getElementById('paradas-content');
  if (!lista || !lista.length) {
    el.innerHTML = '<div class="rel-empty"><i class="fa fa-pause-circle-o"></i><br>Nenhuma parada no período selecionado.</div>';
    return;
  }

  el.innerHTML = lista.map((p, i) => `
    <div class="parada-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:600;font-size:13px">
            <i class="fa fa-map-marker" style="color:#fab32c"></i> Parada ${i + 1}
          </div>
          <div style="font-size:12px;color:#888;margin-top:3px">
            ${p.endereco || `(${(p.latitude || 0).toFixed(5)}, ${(p.longitude || 0).toFixed(5)})`}
          </div>
        </div>
        <div style="text-align:right;font-size:12px;color:#888">
          <div><i class="fa fa-clock-o"></i> ${fmtDuracao(p.duracao)}</div>
          ${p.horasMotor ? `<div><i class="fa fa-cog"></i> ${p.horasMotor}h motor</div>` : ''}
        </div>
      </div>
      <div style="font-size:11px;color:#aaa;margin-top:6px">${fmtHora(p.inicio)} → ${fmtHora(p.fim)}</div>
    </div>
  `).join('');
}

// ── Aba Resumo ────────────────────────────────────────────────────────────────

function renderResumo(resumo, viagens, paradas) {
  const el = document.getElementById('resumo-content');

  const qtdViagens = Array.isArray(viagens) ? viagens.length : 0;
  const qtdParadas = Array.isArray(paradas) ? paradas.length : 0;
  let tempoParadas = 0;
  if (Array.isArray(paradas)) paradas.forEach(p => { tempoParadas += p.duracao || 0; });

  if (!resumo && !qtdViagens && !qtdParadas) {
    el.innerHTML = '<div class="rel-empty"><i class="fa fa-list-alt"></i><br>Nenhum dado disponível para o período.</div>';
    return;
  }

  el.innerHTML = `<div class="resumo-grid">
    <div class="resumo-card"><div class="rc-val">${resumo?.distancia != null ? resumo.distancia.toFixed(1) : '—'}</div><div class="rc-lbl">km percorridos</div></div>
    <div class="resumo-card"><div class="rc-val">${resumo?.velocidadeMaxima ?? '—'}</div><div class="rc-lbl">km/h máxima</div></div>
    <div class="resumo-card"><div class="rc-val">${resumo?.velocidadeMedia ?? '—'}</div><div class="rc-lbl">km/h média</div></div>
    <div class="resumo-card"><div class="rc-val">${resumo?.horasMotor != null ? resumo.horasMotor.toFixed(1) + 'h' : '—'}</div><div class="rc-lbl">Horas motor</div></div>
    <div class="resumo-card"><div class="rc-val">${qtdViagens}</div><div class="rc-lbl">Viagens</div></div>
    <div class="resumo-card"><div class="rc-val">${qtdParadas}</div><div class="rc-lbl">Paradas</div></div>
    <div class="resumo-card"><div class="rc-val">${fmtDuracao(tempoParadas)}</div><div class="rc-lbl">Tempo parado</div></div>
  </div>`;
}

// ── Aba Gráfico ───────────────────────────────────────────────────────────────

function renderGrafico(data) {
  const el = document.getElementById('grafico-content');

  if (!data || !data.posicoes || !data.posicoes.length) {
    el.innerHTML = '<div class="rel-empty"><i class="fa fa-area-chart"></i><br>Nenhum dado disponível para o gráfico.</div>';
    return;
  }

  const posicoes = data.posicoes.filter(p => p.fixTime && p.velocidade != null);
  if (!posicoes.length) {
    el.innerHTML = '<div class="rel-empty">Nenhum dado de velocidade disponível.</div>';
    return;
  }

  // Reamostrar se necessário (máx 300 pontos)
  let amostras = posicoes;
  if (posicoes.length > 300) {
    const step = Math.ceil(posicoes.length / 300);
    amostras = posicoes.filter((_, i) => i % step === 0);
  }

  const isDark = document.documentElement.classList.contains('dark-theme');
  const textColor = isDark ? '#adb5bd' : '#555';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const labels     = amostras.map(p => fmtHora(p.fixTime));
  const velocidades = amostras.map(p => p.velocidade || 0);

  el.innerHTML = '<canvas id="canvas-grafico"></canvas>';

  if (chartVelocidade) { chartVelocidade.destroy(); chartVelocidade = null; }

  const ctx = document.getElementById('canvas-grafico').getContext('2d');
  chartVelocidade = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Velocidade (km/h)',
        data: velocidades,
        borderColor: '#2980b9',
        backgroundColor: 'rgba(41,128,185,0.12)',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.parsed.y} km/h` } },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 }, color: textColor },
          grid: { color: gridColor },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'km/h', font: { size: 11 }, color: textColor },
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
      },
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuracao(mins) {
  if (!mins && mins !== 0) return '—';
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h + 'h' + (m ? ' ' + m + 'min' : '');
}
