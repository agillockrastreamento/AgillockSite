'use strict';

let dispositivos = [];            // lista completa vinda de /posicoes
const selecionadas = new Set();   // dispositivoId (local) selecionados
let enviando = false;
let tiposSuportados = [];          // tipos do dispositivo quando exatamente 1 selecionado

// ── Mapeamento completo de tipos de comando ───────────────────────────────────
// Cobre os tipos mais comuns do Traccar; tipos desconhecidos usam fallback neutro.

const _CMD_CONFIG = {
  engineStop:         { label: 'Bloquear motor',           icon: 'fa-lock',                style: 'block',   confirm: 'Bloquear o motor do(s) veículo(s)?' },
  engineResume:       { label: 'Desbloquear motor',        icon: 'fa-unlock',              style: 'unlock' },
  positionSingle:     { label: 'Solicitar posição',        icon: 'fa-map-marker',          style: 'info' },
  positionPeriodic:   { label: 'Rastreamento periódico',   icon: 'fa-refresh',             style: 'info',    atributos: { frequency: 60 } },
  positionStop:       { label: 'Parar rastreamento',       icon: 'fa-stop-circle',         style: 'neutral' },
  alarmSos:           { label: 'Alarme SOS',               icon: 'fa-exclamation-triangle', style: 'warn' },
  silenceAlarm:       { label: 'Silenciar alarme',         icon: 'fa-bell-slash',          style: 'neutral' },
  rebootDevice:       { label: 'Reiniciar dispositivo',    icon: 'fa-power-off',           style: 'neutral', confirm: 'Reiniciar o(s) dispositivo(s)?' },
  factoryReset:       { label: 'Reset de fábrica',         icon: 'fa-warning',             style: 'block',   confirm: 'ATENÇÃO: apagará todas as configurações do(s) dispositivo(s). Continuar?' },
  outputControl:      { label: 'Controle de saída',        icon: 'fa-toggle-on',           style: 'warn' },
  setTimezone:        { label: 'Definir fuso horário',     icon: 'fa-clock-o',             style: 'info',    atributos: { timezone: 'America/Sao_Paulo' } },
  setSpeed:           { label: 'Definir velocidade limite', icon: 'fa-tachometer',         style: 'warn',    atributos: { speed: 100 } },
  sendSms:            { label: 'Enviar SMS',               icon: 'fa-comment',             style: 'info' },
  voiceMonitoring:    { label: 'Monitoramento de voz',     icon: 'fa-microphone',          style: 'info' },
  requestPhoto:       { label: 'Solicitar foto',           icon: 'fa-camera',              style: 'info' },
  alarmArm:           { label: 'Armar alarme',             icon: 'fa-shield',              style: 'warn' },
  alarmDisarm:        { label: 'Desarmar alarme',          icon: 'fa-shield',              style: 'neutral' },
  alarmRemove:        { label: 'Remover alarme',           icon: 'fa-times-circle',        style: 'neutral' },
  immobilize:         { label: 'Imobilizar veículo',       icon: 'fa-ban',                 style: 'block',   confirm: 'Imobilizar o(s) veículo(s)?' },
  driverUnique:       { label: 'Identificação de motorista', icon: 'fa-id-card',           style: 'info' },
  message:            { label: 'Enviar mensagem',          icon: 'fa-envelope',            style: 'info' },
  configuration:      { label: 'Configurar dispositivo',   icon: 'fa-wrench',              style: 'neutral' },
  getVersion:         { label: 'Versão do firmware',       icon: 'fa-code',                style: 'neutral' },
  custom:             { label: 'Personalizado',            icon: 'fa-terminal',            style: 'neutral' },
};

// Paleta padrão exibida quando há mais de um dispositivo selecionado
// (comandos comuns à maioria dos protocolos — os não suportados retornam erro por dispositivo).
const _COMANDOS_PADRAO = [
  'engineStop', 'engineResume', 'positionSingle', 'positionPeriodic',
  'positionStop', 'rebootDevice', 'setTimezone', 'alarmArm', 'alarmDisarm',
];

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function () {
  await carregarDispositivos();

  // Select2 no filtro de cliente (busca por nome)
  $('#filtro-cliente').select2({ placeholder: 'Todos os clientes', allowClear: true, width: '100%' });
  $('#filtro-cliente').on('change', renderLista);

  document.getElementById('filtro-busca').addEventListener('input', renderLista);
  document.getElementById('filtro-imei-qtd').addEventListener('input', renderLista);
  document.getElementById('filtro-imei-op').addEventListener('change', renderLista);
  document.getElementById('chk-todos').addEventListener('change', onSelecionarTodos);

  // Pré-seleção via ?id= (dispositivo local)
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam && dispositivos.some(d => String(d.dispositivoId) === String(idParam))) {
    selecionadas.add(String(idParam));
  }

  renderLista();
  atualizarSelecionados();
});

async function carregarDispositivos() {
  try {
    const lista = await AL.apiGet('/api/rastreamento/posicoes');
    dispositivos = (Array.isArray(lista) ? lista : []).map(v => ({
      dispositivoId: String(v.dispositivoId),
      nome: v.nome || '',
      placa: v.placa || '',
      identificador: v.identificador || '',
      status: v.status,
      clienteId: v.cliente ? String(v.cliente.id) : '',
      clienteNome: v.cliente ? v.cliente.nome : '',
    }));
    dispositivos.sort((a, b) => a.nome.localeCompare(b.nome));
    popularFiltroClientes();
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
    document.getElementById('lista-dispositivos').innerHTML =
      '<div class="disp-vazio"><i class="fa fa-exclamation-circle"></i> Erro ao carregar dispositivos.</div>';
  }
}

function popularFiltroClientes() {
  const sel = document.getElementById('filtro-cliente');
  const mapa = new Map();
  dispositivos.forEach(d => { if (d.clienteId && !mapa.has(d.clienteId)) mapa.set(d.clienteId, d.clienteNome); });
  const clientes = Array.from(mapa.entries()).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
  clientes.forEach(([id, nome]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = nome || ('Cliente ' + id);
    sel.appendChild(opt);
  });
}

// ── Filtro + render da lista ───────────────────────────────────────────────────

function dispositivosFiltrados() {
  const clienteId = (document.getElementById('filtro-cliente').value || '').trim();
  const busca = (document.getElementById('filtro-busca').value || '').trim().toLowerCase();
  const imeiQtdRaw = (document.getElementById('filtro-imei-qtd').value || '').trim();
  const imeiQtd = imeiQtdRaw ? parseInt(imeiQtdRaw, 10) : null;
  const imeiOp = document.getElementById('filtro-imei-op').value;
  return dispositivos.filter(d => {
    if (clienteId && d.clienteId !== clienteId) return false;
    // Filtra por quantidade de dígitos do IMEI conforme o operador (≤, =, >, <) — ignora não-dígitos.
    if (imeiQtd && imeiQtd > 0) {
      const qtd = String(d.identificador).replace(/\D/g, '').length;
      if (imeiOp === 'lte' && !(qtd <= imeiQtd)) return false;
      if (imeiOp === 'eq'  && !(qtd === imeiQtd)) return false;
      if (imeiOp === 'gt'  && !(qtd >  imeiQtd)) return false;
      if (imeiOp === 'lt'  && !(qtd <  imeiQtd)) return false;
    }
    if (busca) {
      const alvo = `${d.nome} ${d.placa} ${d.identificador}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderLista() {
  const cont = document.getElementById('lista-dispositivos');
  const filtrados = dispositivosFiltrados();
  cont.innerHTML = '';

  if (!filtrados.length) {
    cont.innerHTML = '<div class="disp-vazio"><i class="fa fa-info-circle"></i> Nenhum dispositivo encontrado.</div>';
    sincronizarChkTodos(filtrados);
    return;
  }

  filtrados.forEach(d => {
    const item = document.createElement('label');
    item.className = 'disp-item';
    const online = d.status === 'online';
    item.innerHTML =
      `<input type="checkbox" value="${d.dispositivoId}" ${selecionadas.has(d.dispositivoId) ? 'checked' : ''}>` +
      `<span class="disp-dot ${online ? 'online' : 'offline'}" title="${online ? 'Online' : 'Offline'}"></span>` +
      `<span class="disp-nome">${escapeHtml(d.nome)}${d.placa ? ' (' + escapeHtml(d.placa) + ')' : ''}` +
        `${d.clienteNome ? ` <span style="color:#aaa;font-weight:400">— ${escapeHtml(d.clienteNome)}</span>` : ''}</span>` +
      `<span class="disp-imei">${escapeHtml(d.identificador)}</span>`;
    item.querySelector('input').addEventListener('change', function () {
      if (this.checked) selecionadas.add(this.value);
      else selecionadas.delete(this.value);
      atualizarSelecionados();
      sincronizarChkTodos(dispositivosFiltrados());
    });
    cont.appendChild(item);
  });

  sincronizarChkTodos(filtrados);
}

function sincronizarChkTodos(filtrados) {
  const chk = document.getElementById('chk-todos');
  if (!filtrados.length) { chk.checked = false; chk.indeterminate = false; return; }
  const selecionadosNoFiltro = filtrados.filter(d => selecionadas.has(d.dispositivoId)).length;
  chk.checked = selecionadosNoFiltro === filtrados.length;
  chk.indeterminate = selecionadosNoFiltro > 0 && selecionadosNoFiltro < filtrados.length;
}

function onSelecionarTodos() {
  const filtrados = dispositivosFiltrados();
  const marcar = document.getElementById('chk-todos').checked;
  filtrados.forEach(d => { if (marcar) selecionadas.add(d.dispositivoId); else selecionadas.delete(d.dispositivoId); });
  renderLista();
  atualizarSelecionados();
}

function idsSelecionados() {
  return Array.from(selecionadas);
}

// ── Atualização de estado (contador + comandos) ────────────────────────────────

async function atualizarSelecionados() {
  const ids = idsSelecionados();
  document.getElementById('contador-selecionados').textContent =
    ids.length + ' selecionado(s)';
  document.getElementById('btn-enviar-custom').disabled = ids.length === 0;

  if (ids.length === 0) {
    tiposSuportados = [];
    renderizarComandos([]);
    return;
  }

  if (ids.length === 1) {
    // Um dispositivo: mostra os comandos realmente suportados por ele.
    await carregarComandos(ids[0]);
  } else {
    // Vários: paleta padrão de comandos comuns.
    tiposSuportados = _COMANDOS_PADRAO;
    renderizarComandos(_COMANDOS_PADRAO);
  }
}

async function carregarComandos(id) {
  const grid = document.getElementById('cmd-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;padding:16px 0;color:#aaa;font-size:13px;text-align:center"><i class="fa fa-spinner fa-spin"></i> Carregando comandos...</div>';

  try {
    const tipos = await AL.apiGet(`/api/rastreamento/dispositivos/${id}/tipos-comandos`);
    tiposSuportados = Array.isArray(tipos) ? tipos.map(t => (typeof t === 'string' ? t : t.type)).filter(Boolean) : [];
  } catch (err) {
    console.error('Erro ao carregar tipos de comando:', err);
    tiposSuportados = [];
  }

  // Fallback: se o dispositivo não reportou tipos, usa a paleta padrão.
  renderizarComandos(tiposSuportados.length ? tiposSuportados : _COMANDOS_PADRAO);
}

function renderizarComandos(tipos) {
  const grid = document.getElementById('cmd-grid');
  grid.innerHTML = '';

  if (!idsSelecionados().length) {
    grid.innerHTML = '<div id="cmd-placeholder" style="grid-column:1/-1;padding:16px 0;color:#aaa;font-size:13px;text-align:center"><i class="fa fa-info-circle"></i> Selecione um ou mais dispositivos para ver os comandos disponíveis.</div>';
    return;
  }

  if (!tipos.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:16px 0;color:#aaa;font-size:13px;text-align:center"><i class="fa fa-exclamation-circle"></i> Nenhum comando disponível.</div>';
    return;
  }

  tipos.forEach(tipo => {
    const cfg = _CMD_CONFIG[tipo] || { label: tipo, icon: 'fa-terminal', style: 'neutral' };
    const btn = document.createElement('button');
    btn.className = `cmd-btn cmd-btn-${cfg.style}`;
    btn.dataset.tipo = tipo;
    btn.innerHTML = `<span class="cmd-icon"><i class="fa ${cfg.icon}"></i></span><span>${cfg.label}</span>`;
    btn.addEventListener('click', function () {
      if (cfg.confirm) {
        _confirmarEEnviar(tipo, cfg.confirm, cfg.atributos || {});
      } else {
        _enviar(tipo, cfg.atributos || {});
      }
    });
    grid.appendChild(btn);
  });
}

// ── Envio de comandos (em lote) ────────────────────────────────────────────────

function _confirmarEEnviar(tipo, mensagem, atributos) {
  const n = idsSelecionados().length;
  if (!n) { AL.showAlert('Selecione ao menos um dispositivo.', 'warning'); return; }
  const sufixo = n > 1 ? `\n\nSerá enviado para ${n} dispositivos.` : '';
  if (confirm(mensagem + sufixo)) _enviar(tipo, atributos);
}

window.enviarComandoCustom = async function () {
  if (!idsSelecionados().length) { AL.showAlert('Selecione ao menos um dispositivo.', 'warning'); return; }

  const tipo  = (document.getElementById('cmd-tipo').value || '').trim();
  const dados = (document.getElementById('cmd-dados').value || '').trim();

  if (!tipo) { AL.showAlert('Informe o tipo do comando.', 'warning'); return; }

  let atributos = {};
  if (dados) {
    try {
      atributos = JSON.parse(dados);
    } catch {
      AL.showAlert('Parâmetros inválidos — deve ser JSON válido. Ex: {"data":"comando"}', 'danger');
      return;
    }
  }

  await _enviar(tipo, atributos);
};

async function _enviar(tipo, atributos) {
  if (enviando) return;
  const ids = idsSelecionados();
  if (!ids.length) { AL.showAlert('Selecione ao menos um dispositivo.', 'warning'); return; }

  enviando = true;
  const cfg = _CMD_CONFIG[tipo];
  const label = cfg ? cfg.label : tipo;
  adicionarLog('info', `Enviando "${label}" para ${ids.length} dispositivo(s)...`);

  document.querySelectorAll('.cmd-btn, #btn-enviar-custom').forEach(b => { b.disabled = true; });

  try {
    const resp = await AL.apiPost('/api/rastreamento/comandos/lote', {
      dispositivoIds: ids,
      tipo,
      atributos: atributos || {},
    });
    const resultados = Array.isArray(resp.resultados) ? resp.resultados : [];
    const oks = resultados.filter(r => r.ok);
    const erros = resultados.filter(r => !r.ok);

    oks.forEach(r => adicionarLog('ok', `✓ ${r.nome}`));
    erros.forEach(r => adicionarLog('err', `✗ ${r.nome}: ${r.erro || 'erro'}`));

    if (erros.length === 0) {
      adicionarLog('ok', `✓ "${label}" enviado para ${oks.length} dispositivo(s).`);
      AL.showAlert(`Comando "${label}" enviado para ${oks.length} dispositivo(s).`, 'success');
    } else {
      adicionarLog('info', `Concluído: ${oks.length} ok, ${erros.length} com erro.`);
      AL.showAlert(
        `${oks.length} enviado(s), ${erros.length} com erro. Veja o log.`,
        oks.length === 0 ? 'danger' : 'warning',
      );
    }
  } catch (err) {
    adicionarLog('err', `✗ Erro ao enviar "${label}": ${err.message}`);
    AL.showAlert('Erro ao enviar comando: ' + err.message, 'danger');
  } finally {
    enviando = false;
    // Reabilita conforme a seleção atual
    if (idsSelecionados().length) {
      document.querySelectorAll('.cmd-btn').forEach(b => { b.disabled = false; });
      document.getElementById('btn-enviar-custom').disabled = false;
    }
  }
}

// ── Log ───────────────────────────────────────────────────────────────────────

function adicionarLog(tipo, msg) {
  const log = document.getElementById('cmd-log');
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const vazio = log.querySelector('.log-linha');
  if (vazio && vazio.textContent.includes('Nenhum comando')) vazio.remove();

  const linha = document.createElement('div');
  linha.className = 'log-linha';
  linha.innerHTML = `<span class="log-hora">${hora}</span><span class="log-${tipo}">${msg}</span>`;
  log.insertBefore(linha, log.firstChild);

  while (log.children.length > 200) log.removeChild(log.lastChild);
}

window.limparLog = function () {
  document.getElementById('cmd-log').innerHTML =
    '<div class="log-linha" style="color:#aaa">Nenhum comando enviado ainda.</div>';
};

// ── Util ───────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
