'use strict';

(function () {
  const TIPOS_NOTIF = [
    { id: 'ignitionOn',    label: 'Ignição Ligada',          icon: 'fa-key' },
    { id: 'ignitionOff',   label: 'Ignição Desligada',       icon: 'fa-power-off' },
    { id: 'geofenceEnter', label: 'Entrada na Cerca',        icon: 'fa-sign-in' },
    { id: 'geofenceExit',  label: 'Saída da Cerca',          icon: 'fa-sign-out' },
    { id: 'overspeed',     label: 'Excesso de Velocidade',   icon: 'fa-tachometer' },
    { id: 'powerCut',      label: 'Alimentação Cortada',     icon: 'fa-bolt' },
    { id: 'alarm',         label: 'Alarme',                  icon: 'fa-exclamation-triangle' },
    { id: 'deviceLocked',  label: 'Veículo Bloqueado',       icon: 'fa-lock' },
    { id: 'deviceUnlocked',label: 'Veículo Desbloqueado',    icon: 'fa-unlock' },
  ];

  const CANAIS = [
    { id: 'web',   label: 'Web',   icon: 'fa-desktop' },
    { id: 'app',   label: 'App',   icon: 'fa-mobile' },
    { id: 'email', label: 'E-mail',icon: 'fa-envelope-o' },
  ];

  let veiculos = [];
  let dispositivoIdAtivo = null;
  let preferenciasAtivas = {};

  async function init() {
    await carregarVeiculos();
    bindEvents();
  }

  async function carregarVeiculos() {
    try {
      const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/posicoes');
      veiculos = data || [];
      const select = document.getElementById('filtro-dispositivo');
      select.innerHTML = '<option value="">Selecione um veículo...</option>' + 
        veiculos.map(v => `<option value="${v.dispositivoId}">${v.placa ? v.nome + ' (' + v.placa + ')' : v.nome}</option>`).join('');
    } catch (err) {
      console.error('Erro ao carregar veículos', err);
    }
  }

  function bindEvents() {
    document.getElementById('filtro-dispositivo').addEventListener('change', function () {
      const id = this.value;
      if (!id) {
        document.getElementById('notif-container').style.display = 'none';
        document.getElementById('notif-vazio').style.display = 'block';
        dispositivoIdAtivo = null;
        return;
      }
      dispositivoIdAtivo = id;
      const v = veiculos.find(v => v.dispositivoId === id);
      document.getElementById('nome-veiculo-selecionado').textContent = v ? (v.nome + (v.placa ? ' - ' + v.placa : '')) : '---';
      carregarPreferencias(id);
    });

    document.getElementById('btn-salvar-geral').addEventListener('click', salvarConfiguracoes);
  }

  async function carregarPreferencias(dispositivoId) {
    try {
      const data = await AL_CLIENTE.apiGet(`/api/cliente/notificacoes/preferencias/${dispositivoId}`);
      preferenciasAtivas = data?.preferencias || {};
      if (data?.overspeedLimit) preferenciasAtivas.overspeedLimit = data.overspeedLimit;
      renderGrid();
      document.getElementById('notif-container').style.display = 'block';
      document.getElementById('notif-vazio').style.display = 'none';
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao carregar preferências.');
    }
  }

  function renderGrid() {
    const grid = document.getElementById('grid-notificacoes');
    grid.innerHTML = TIPOS_NOTIF.map(tipo => {
      return `
        <div class="notif-card" data-tipo="${tipo.id}">
          <span class="notif-type-label"><i class="fa ${tipo.icon} fa-fw"></i> ${tipo.label}</span>
          <div class="channel-toggles">
            ${CANAIS.map(canal => {
              const ativo = preferenciasAtivas[tipo.id]?.[canal.id] || false;
              return `<div class="btn-channel ${ativo ? 'active' : ''}" 
                           onclick="toggleChannel(this, '${tipo.id}', '${canal.id}')"
                           title="Habilitar via ${canal.label}">
                <i class="fa ${canal.icon}"></i>
                ${canal.label}
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Exibir config de velocidade se o tipo for overspeed
    const speedConfig = document.getElementById('config-velocidade');
    speedConfig.style.display = 'block'; // Sempre visível para facilitar
    document.getElementById('input-vel-limite').value = preferenciasAtivas.overspeedLimit || 100;
  }

  window.toggleChannel = function(el, tipoId, canalId) {
    el.classList.toggle('active');
  };

  async function salvarConfiguracoes() {
    if (!dispositivoIdAtivo) return;

    const btn = document.getElementById('btn-salvar-geral');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> SALVANDO...';

    const payload = {
      dispositivoId: dispositivoIdAtivo,
      preferencias: {},
      overspeedLimit: parseInt(document.getElementById('input-vel-limite').value) || 100
    };

    document.querySelectorAll('.notif-card').forEach(card => {
      const tipo = card.dataset.tipo;
      payload.preferencias[tipo] = {
        web: card.querySelector('.btn-channel[title*="Web"]').classList.contains('active'),
        app: card.querySelector('.btn-channel[title*="App"]').classList.contains('active'),
        email: card.querySelector('.btn-channel[title*="E-mail"]').classList.contains('active')
      };
    });

    try {
      // Chamada real ao backend que será implementada
      await AL_CLIENTE.apiPost('/api/cliente/notificacoes/preferencias', payload);
      AL_CLIENTE.showAlert('Configurações salvas com sucesso!', 'success');
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-save"></i> SALVAR CONFIGURAÇÕES';
    }
  }

  init();
})();