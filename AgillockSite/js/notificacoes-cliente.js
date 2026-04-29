'use strict';

(function () {
  const TIPOS_NOTIF = [
    { id: 'ignitionOn',    label: 'Ignição Ligada',              icon: 'fa-key',                  iconClass: 'ic-ignition' },
    { id: 'ignitionOff',   label: 'Ignição Desligada',           icon: 'fa-power-off',            iconClass: 'ic-ignition' },
    { id: 'geofenceEnter', label: 'Entrada na Cerca',            icon: 'fa-sign-in',              iconClass: 'ic-geofence' },
    { id: 'geofenceExit',  label: 'Saída da Cerca',              icon: 'fa-sign-out',             iconClass: 'ic-geofence' },
    { id: 'overspeed',     label: 'Excesso de Velocidade',       icon: 'fa-tachometer',           iconClass: 'ic-speed' },
    { id: 'powerCut',      label: 'Alimentação Cortada',         icon: 'fa-bolt',                 iconClass: 'ic-power' },
    { id: 'alarm',         label: 'Alarme',                      icon: 'fa-exclamation-triangle', iconClass: 'ic-alarm' },
    { id: 'deviceLocked',  label: 'Veículo Bloqueado',           icon: 'fa-lock',                 iconClass: 'ic-lock' },
    { id: 'deviceUnlocked',label: 'Veículo Desbloqueado',        icon: 'fa-unlock',               iconClass: 'ic-lock' },
    { id: 'kmExcedida',    label: 'Km Excedida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'kmReduzida',    label: 'Km Reduzida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'trocaOleo',     label: 'Troca de Óleo',               icon: 'fa-tint',                 iconClass: 'ic-oleo' },
    { id: 'manutencao',    label: 'Manutenções (Recorrências)',   icon: 'fa-wrench',               iconClass: 'ic-manutencao' },
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
      if (data?.overspeedLimit != null) preferenciasAtivas.overspeedLimit = data.overspeedLimit;
      renderGrid();

      // Fill km excedida config
      document.getElementById('input-km-max').value = data?.kmExcedida?.kmMaximo30Dias || '';
      document.getElementById('input-dia-mes').value = data?.kmExcedida?.diaRenovacaoMes || '';

      // Fill km reduzida config
      document.getElementById('input-km-min').value = data?.kmReduzida?.kmMinimo7Dias || '';
      if (data?.kmReduzida?.diaSemanaRenovacao != null) {
        document.getElementById('select-dia-semana').value = data.kmReduzida.diaSemanaRenovacao;
      }

      // Fill troca de oleo config
      document.getElementById('input-km-oleo').value = data?.kmTrocaOleo || '';

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
          <div class="notif-card-header">
            <div class="notif-card-icon ${tipo.iconClass}"><i class="fa ${tipo.icon}"></i></div>
            <span class="notif-card-label">${tipo.label}</span>
          </div>
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

    // Mostrar seções de configuração específicas
    document.getElementById('config-velocidade').style.display = 'block';
    document.getElementById('input-vel-limite').value = preferenciasAtivas.overspeedLimit || 100;
    document.getElementById('config-km-periodo').style.display = 'block';
    document.getElementById('config-troca-oleo').style.display = 'block';
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
      overspeedLimit: parseInt(document.getElementById('input-vel-limite').value) || 100,
      kmExcedida: {
        kmMaximo30Dias: parseInt(document.getElementById('input-km-max').value) || null,
        diaRenovacaoMes: parseInt(document.getElementById('input-dia-mes').value) || null,
      },
      kmReduzida: {
        kmMinimo7Dias: parseInt(document.getElementById('input-km-min').value) || null,
        diaSemanaRenovacao: parseInt(document.getElementById('select-dia-semana').value),
      },
      kmTrocaOleo: parseInt(document.getElementById('input-km-oleo').value) || null,
    };

    document.querySelectorAll('.notif-card').forEach(card => {
      const tipo = card.dataset.tipo;
      payload.preferencias[tipo] = {
        web: card.querySelector('.btn-channel[title*="Web"]').classList.contains('active'),
        app: card.querySelector('.btn-channel[title*="App"]').classList.contains('active'),
        email: card.querySelector('.btn-channel[title*="E-mail"]').classList.contains('active'),
      };
    });

    try {
      await AL_CLIENTE.apiPost('/api/cliente/notificacoes/preferencias', payload);
      AL_CLIENTE.showAlert('Configurações salvas com sucesso!', 'success');
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-save"></i> Salvar configurações';
    }
  }

  init();
})();
