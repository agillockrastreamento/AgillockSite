'use strict';

let dispositivoIdAtual = null;
let dispositivoNomeAtual = '';
let enviando = false;
let tiposSuportados = [];

// ── Mapeamento completo de tipos de comando ───────────────────────────────────
// Cobre os tipos mais comuns do Traccar; tipos desconhecidos usam fallback neutro.

const _CMD_CONFIG = {
  engineStop:         { label: 'Bloquear motor',           icon: 'fa-lock',                style: 'block',   confirm: 'Bloquear o motor do veículo?' },
  engineResume:       { label: 'Desbloquear motor',        icon: 'fa-unlock',              style: 'unlock' },
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

// ── Inicialização ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function () {
  await carregarDispositivos();

  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam) {
    const sel = document.getElementById('sel-dispositivo');
    sel.value = idParam;
    if (sel.value === idParam) onDispositivo(idParam);
  }

  document.getElementById('sel-dispositivo').addEventListener('change', function () {
    onDispositivo(this.value || null);
  });
});

async function carregarDispositivos() {
  try {
    const lista = await AL.apiGet('/api/rastreamento/posicoes');
    const sel = document.getElementById('sel-dispositivo');
    lista.sort((a, b) => a.nome.localeCompare(b.nome));
    lista.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.dispositivoId;
      const statusLabel = v.status === 'online' ? '● ' : '○ ';
      opt.textContent = statusLabel + v.nome + (v.placa ? ` (${v.placa})` : '');
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
  }
}

async function onDispositivo(id) {
  dispositivoIdAtual = id;
  const sel = document.getElementById('sel-dispositivo');
  if (id) {
    const opt = sel.options[sel.selectedIndex];
    dispositivoNomeAtual = opt ? opt.textContent.replace(/^[●○] /, '') : '';
  } else {
    dispositivoNomeAtual = '';
    tiposSuportados = [];
  }

  const statusEl = document.getElementById('status-dispositivo');
  statusEl.textContent = id ? ('Dispositivo: ' + dispositivoNomeAtual) : '';

  document.getElementById('btn-enviar-custom').disabled = !id;

  if (!id) {
    renderizarComandos([]);
    return;
  }

  await carregarComandos(id);
}

// ── Carregar tipos de comando do dispositivo ──────────────────────────────────

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

  renderizarComandos(tiposSuportados);
}

function renderizarComandos(tipos) {
  const grid = document.getElementById('cmd-grid');
  grid.innerHTML = '';

  if (!dispositivoIdAtual) {
    grid.innerHTML = '<div id="cmd-placeholder" style="grid-column:1/-1;padding:16px 0;color:#aaa;font-size:13px;text-align:center"><i class="fa fa-info-circle"></i> Selecione um dispositivo para ver os comandos disponíveis.</div>';
    return;
  }

  if (!tipos.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:16px 0;color:#aaa;font-size:13px;text-align:center"><i class="fa fa-exclamation-circle"></i> Nenhum comando disponível para este dispositivo.</div>';
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

// ── Envio de comandos ─────────────────────────────────────────────────────────

async function _confirmarEEnviar(tipo, mensagem, atributos) {
  if (!dispositivoIdAtual) { AL.showAlert('Selecione um dispositivo primeiro.', 'warning'); return; }
  const ok = confirm(mensagem);
  if (ok) await _enviar(tipo, atributos);
}

window.enviarComandoCustom = async function () {
  if (!dispositivoIdAtual) { AL.showAlert('Selecione um dispositivo primeiro.', 'warning'); return; }

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
  enviando = true;

  const cfg = _CMD_CONFIG[tipo];
  const label = cfg ? cfg.label : tipo;
  adicionarLog('info', `Enviando: ${label} (${tipo})...`);

  // Desabilita botões durante o envio
  document.querySelectorAll('.cmd-btn, #btn-enviar-custom').forEach(b => { b.disabled = true; });

  try {
    await AL.apiPost(`/api/rastreamento/dispositivos/${dispositivoIdAtual}/comandos`, {
      tipo,
      atributos,
    });
    adicionarLog('ok', `✓ Comando "${label}" enviado com sucesso para ${dispositivoNomeAtual}.`);
    AL.showAlert(`Comando "${label}" enviado com sucesso.`, 'success');
  } catch (err) {
    adicionarLog('err', `✗ Erro ao enviar "${label}": ${err.message}`);
    AL.showAlert('Erro ao enviar comando: ' + err.message, 'danger');
  } finally {
    enviando = false;
    if (dispositivoIdAtual) {
      document.querySelectorAll('.cmd-btn, #btn-enviar-custom').forEach(b => { b.disabled = false; });
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

  while (log.children.length > 50) log.removeChild(log.lastChild);
}

window.limparLog = function () {
  document.getElementById('cmd-log').innerHTML =
    '<div class="log-linha" style="color:#aaa">Nenhum comando enviado ainda.</div>';
};
