'use strict';

let dispositivoIdAtual = null;
let dispositivoNomeAtual = '';
let enviando = false;

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

function onDispositivo(id) {
  dispositivoIdAtual = id;
  const sel = document.getElementById('sel-dispositivo');
  if (id) {
    const opt = sel.options[sel.selectedIndex];
    dispositivoNomeAtual = opt ? opt.textContent.replace(/^[●○] /, '') : '';
  } else {
    dispositivoNomeAtual = '';
  }

  const statusEl = document.getElementById('status-dispositivo');
  statusEl.textContent = id ? ('Dispositivo selecionado: ' + dispositivoNomeAtual) : '';

  // Habilita/desabilita botões
  document.querySelectorAll('.cmd-btn').forEach(btn => {
    btn.disabled = !id;
  });
  document.getElementById('btn-enviar-custom').disabled = !id;
}

// ── Envio de comandos ─────────────────────────────────────────────────────────

window.enviarComando = async function (tipo) {
  if (!dispositivoIdAtual) { AL.showAlert('Selecione um dispositivo primeiro.', 'warning'); return; }
  await _enviar(tipo, {});
};

window.enviarComandoComAtrib = async function (tipo, atributos) {
  if (!dispositivoIdAtual) { AL.showAlert('Selecione um dispositivo primeiro.', 'warning'); return; }
  await _enviar(tipo, atributos);
};

window.confirmarEEnviar = async function (tipo, mensagem) {
  if (!dispositivoIdAtual) { AL.showAlert('Selecione um dispositivo primeiro.', 'warning'); return; }
  const ok = await AL.confirmar({
    titulo: 'Confirmar comando',
    mensagem: mensagem,
    btnTexto: 'Confirmar',
    btnClasse: 'btn-warning',
  });
  if (ok) await _enviar(tipo, {});
};

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

  const label = _labelComando(tipo);
  adicionarLog('info', `Enviando: ${label} (${tipo})...`);

  // Desabilita todos os botões durante o envio
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
    // Reabilita botões se dispositivo ainda estiver selecionado
    if (dispositivoIdAtual) {
      document.querySelectorAll('.cmd-btn, #btn-enviar-custom').forEach(b => { b.disabled = false; });
    }
  }
}

// ── Log ───────────────────────────────────────────────────────────────────────

function adicionarLog(tipo, msg) {
  const log = document.getElementById('cmd-log');
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Remove mensagem de "nenhum comando"
  const vazio = log.querySelector('.log-linha');
  if (vazio && vazio.textContent.includes('Nenhum comando')) vazio.remove();

  const linha = document.createElement('div');
  linha.className = 'log-linha';
  linha.innerHTML = `<span class="log-hora">${hora}</span><span class="log-${tipo}">${msg}</span>`;
  log.insertBefore(linha, log.firstChild);

  // Limita a 50 entradas
  while (log.children.length > 50) log.removeChild(log.lastChild);
}

window.limparLog = function () {
  document.getElementById('cmd-log').innerHTML =
    '<div class="log-linha" style="color:#aaa">Nenhum comando enviado ainda.</div>';
};

// ── Labels dos comandos ───────────────────────────────────────────────────────

const _LABELS = {
  engineStop:       'Bloquear motor',
  engineResume:     'Desbloquear motor',
  positionSingle:   'Solicitar posição',
  positionPeriodic: 'Rastreamento periódico',
  alarmSos:         'Alarme SOS',
  silenceAlarm:     'Silenciar alarme',
  rebootDevice:     'Reiniciar dispositivo',
  custom:           'Comando personalizado',
};

function _labelComando(tipo) {
  return _LABELS[tipo] || tipo;
}
