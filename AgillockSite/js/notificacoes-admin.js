'use strict';

(function () {
  const TIPOS_CLIENTE = [
    { id: 'ignitionOn',     label: 'Ignição Ligada',              icon: 'fa-key',                  iconClass: 'ic-ignition' },
    { id: 'ignitionOff',    label: 'Ignição Desligada',           icon: 'fa-power-off',            iconClass: 'ic-ignition' },
    { id: 'geofenceEnter',  label: 'Entrada na Cerca',            icon: 'fa-sign-in',              iconClass: 'ic-geofence' },
    { id: 'geofenceExit',   label: 'Saída da Cerca',              icon: 'fa-sign-out',             iconClass: 'ic-geofence' },
    { id: 'overspeed',      label: 'Excesso de Velocidade',       icon: 'fa-tachometer',           iconClass: 'ic-speed' },
    { id: 'powerCut',       label: 'Alimentação Cortada',         icon: 'fa-bolt',                 iconClass: 'ic-power' },
    { id: 'alarm',          label: 'Alarme',                      icon: 'fa-exclamation-triangle', iconClass: 'ic-alarm' },
    { id: 'deviceLocked',   label: 'Veículo Bloqueado',           icon: 'fa-lock',                 iconClass: 'ic-lock' },
    { id: 'deviceUnlocked', label: 'Veículo Desbloqueado',        icon: 'fa-unlock',               iconClass: 'ic-lock' },
    { id: 'kmExcedida',     label: 'Km Excedida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'kmReduzida',     label: 'Km Reduzida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'trocaOleo',      label: 'Troca de Óleo',               icon: 'fa-tint',                 iconClass: 'ic-oleo' },
  ];

  const CANAIS_CLIENTE = [
    { id: 'web',   label: 'Web',    icon: 'fa-desktop' },
    { id: 'app',   label: 'App',    icon: 'fa-mobile' },
    { id: 'email', label: 'E-mail', icon: 'fa-envelope-o' },
  ];

  const TIPOS_ADMIN = [
    ...TIPOS_CLIENTE,
    { id: 'deviceFuelDrop',     label: 'Queda de Combustível',    icon: 'fa-tint',         iconClass: 'ic-power' },
    { id: 'deviceFuelIncrease', label: 'Aumento de Combustível',  icon: 'fa-tint',         iconClass: 'ic-oleo' },
    { id: 'textMessage',        label: 'Mensagem de Texto',       icon: 'fa-comment',      iconClass: 'ic-geofence' },
    { id: 'driverChanged',      label: 'Motorista Alterado',      icon: 'fa-id-card-o',    iconClass: 'ic-ignition' },
    { id: 'commandResult',      label: 'Resultado de Comando',    icon: 'fa-terminal',     iconClass: 'ic-lock' },
  ];

  // ── Section A: Client notifications ────────────────────────────────────

  let clientes = [];
  let clienteLoginIdAtivo = null;
  let clienteDispositivoId = null;
  let clientePreferencias = {};

  async function carregarClientes() {
    try {
      const data = await AL.apiGet('/api/notificacoes-admin/clientes');
      clientes = data || [];
      const sel = document.getElementById('filtro-cliente');
      sel.innerHTML = '<option value="">Selecione um cliente...</option>' +
        clientes.map(c => `<option value="${c.id}">${c.nome} — ${c.email}</option>`).join('');
    } catch (err) {
      AL.showAlert('Erro ao carregar clientes: ' + err.message);
    }
  }

  async function carregarDispositivosCliente(clienteLoginId) {
    const sel = document.getElementById('filtro-dispositivo-cliente');
    sel.innerHTML = '<option value="">Carregando...</option>';
    document.getElementById('filtro-dispositivo-wrap').style.display = 'block';
    try {
      const data = await AL.apiGet(`/api/notificacoes-admin/clientes/${clienteLoginId}/dispositivos`);
      sel.innerHTML = '<option value="">Selecione um dispositivo...</option>' +
        (data || []).map(d => `<option value="${d.id}">${d.nome}${d.placa ? ' (' + d.placa + ')' : ''}</option>`).join('');
    } catch (err) {
      AL.showAlert('Erro ao carregar dispositivos: ' + err.message);
    }
  }

  async function carregarPreferenciasCliente(clienteLoginId, dispositivoId) {
    try {
      const data = await AL.apiGet(`/api/notificacoes-admin/clientes/${clienteLoginId}/preferencias/${dispositivoId}`);
      clientePreferencias = data?.preferencias || {};
      if (data?.overspeedLimit != null) clientePreferencias.overspeedLimit = data.overspeedLimit;
      renderGridCliente();

      document.getElementById('c-input-km-max').value  = data?.kmExcedida?.kmMaximo30Dias || '';
      document.getElementById('c-input-dia-mes').value  = data?.kmExcedida?.diaRenovacaoMes || '';
      document.getElementById('c-input-km-min').value   = data?.kmReduzida?.kmMinimo7Dias || '';
      if (data?.kmReduzida?.diaSemanaRenovacao != null) {
        document.getElementById('c-select-dia-semana').value = data.kmReduzida.diaSemanaRenovacao;
      }
      document.getElementById('c-input-km-oleo').value  = data?.kmTrocaOleo || '';

      document.getElementById('cliente-notif-container').style.display = 'block';
      document.getElementById('cliente-notif-vazio').style.display    = 'none';
    } catch (err) {
      AL.showAlert('Erro ao carregar preferências: ' + err.message);
    }
  }

  function renderGridCliente() {
    const grid = document.getElementById('c-grid-notificacoes');
    grid.innerHTML = TIPOS_CLIENTE.map(tipo => `
      <div class="notif-card" data-tipo-c="${tipo.id}">
        <div class="notif-card-header">
          <div class="notif-card-icon ${tipo.iconClass}"><i class="fa ${tipo.icon}"></i></div>
          <span class="notif-card-label">${tipo.label}</span>
        </div>
        <div class="channel-toggles">
          ${CANAIS_CLIENTE.map(canal => {
            const ativo = clientePreferencias[tipo.id]?.[canal.id] || false;
            return `<div class="btn-channel ${ativo ? 'active' : ''}"
                         onclick="this.classList.toggle('active')"
                         title="Habilitar via ${canal.label}">
              <i class="fa ${canal.icon}"></i>${canal.label}
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');

    document.getElementById('c-config-velocidade').style.display = 'block';
    document.getElementById('c-input-vel-limite').value = clientePreferencias.overspeedLimit || 100;
    document.getElementById('c-config-km-periodo').style.display = 'block';
    document.getElementById('c-config-troca-oleo').style.display  = 'block';
  }

  async function salvarPreferenciasCliente() {
    if (!clienteLoginIdAtivo || !clienteDispositivoId) return;
    const btn = document.getElementById('c-btn-salvar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> SALVANDO...';

    const payload = {
      dispositivoId: clienteDispositivoId,
      preferencias: {},
      overspeedLimit: parseInt(document.getElementById('c-input-vel-limite').value) || 100,
      kmExcedida: {
        kmMaximo30Dias:  parseInt(document.getElementById('c-input-km-max').value) || null,
        diaRenovacaoMes: parseInt(document.getElementById('c-input-dia-mes').value) || null,
      },
      kmReduzida: {
        kmMinimo7Dias:       parseInt(document.getElementById('c-input-km-min').value) || null,
        diaSemanaRenovacao:  parseInt(document.getElementById('c-select-dia-semana').value),
      },
      kmTrocaOleo: parseInt(document.getElementById('c-input-km-oleo').value) || null,
    };

    document.querySelectorAll('.notif-card[data-tipo-c]').forEach(card => {
      const tipo = card.dataset.tipoC;
      const toggles = card.querySelectorAll('.btn-channel');
      payload.preferencias[tipo] = {
        web:   toggles[0]?.classList.contains('active') || false,
        app:   toggles[1]?.classList.contains('active') || false,
        email: toggles[2]?.classList.contains('active') || false,
      };
    });

    try {
      await AL.apiPost(`/api/notificacoes-admin/clientes/${clienteLoginIdAtivo}/preferencias`, payload);
      AL.showAlert('Preferências do cliente salvas!', 'success');
    } catch (err) {
      AL.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-save"></i> Salvar configurações';
    }
  }

  // ── Section B: Admin own notifications ─────────────────────────────────

  let adminPrefs = {};

  async function carregarAdminPrefs() {
    try {
      const data = await AL.apiGet('/api/notificacoes-admin/admin-prefs');
      adminPrefs = data?.prefs || {};
      renderGridAdmin();
    } catch (err) {
      AL.showAlert('Erro ao carregar preferências admin: ' + err.message);
    }
  }

  function renderGridAdmin() {
    const grid = document.getElementById('a-grid-notificacoes');
    grid.innerHTML = TIPOS_ADMIN.map(tipo => {
      const ativo = adminPrefs[tipo.id] || false;
      return `
        <div class="notif-card" data-tipo-a="${tipo.id}">
          <div class="notif-card-header">
            <div class="notif-card-icon ${tipo.iconClass}"><i class="fa ${tipo.icon}"></i></div>
            <span class="notif-card-label">${tipo.label}</span>
          </div>
          <div class="channel-toggles">
            <div class="btn-channel${ativo ? ' active' : ''}"
                 onclick="this.classList.toggle('active')"
                 title="Habilitar via Web"
                 style="flex:initial;min-width:80px;">
              <i class="fa fa-desktop"></i>Web
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function salvarAdminPrefs() {
    const btn = document.getElementById('a-btn-salvar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> SALVANDO...';

    const prefs = {};
    document.querySelectorAll('.notif-card[data-tipo-a]').forEach(card => {
      prefs[card.dataset.tipoA] = card.querySelector('.btn-channel').classList.contains('active');
    });

    try {
      await AL.apiPost('/api/notificacoes-admin/admin-prefs', { prefs });
      AL.showAlert('Preferências salvas!', 'success');
    } catch (err) {
      AL.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-save"></i> Salvar preferências';
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    carregarClientes();
    carregarAdminPrefs();

    document.getElementById('filtro-cliente').addEventListener('change', function () {
      const id = this.value;
      clienteLoginIdAtivo = id || null;
      clienteDispositivoId = null;
      document.getElementById('cliente-notif-container').style.display = 'none';
      document.getElementById('cliente-notif-vazio').style.display    = 'block';
      document.getElementById('filtro-dispositivo-wrap').style.display = id ? 'block' : 'none';
      document.getElementById('filtro-dispositivo-cliente').innerHTML  = '<option value="">Selecione um dispositivo...</option>';
      if (id) carregarDispositivosCliente(id);
    });

    document.getElementById('filtro-dispositivo-cliente').addEventListener('change', function () {
      const id = this.value;
      clienteDispositivoId = id || null;
      document.getElementById('cliente-notif-container').style.display = 'none';
      document.getElementById('cliente-notif-vazio').style.display    = 'block';
      if (!id) return;
      carregarPreferenciasCliente(clienteLoginIdAtivo, id);
    });

    document.getElementById('c-btn-salvar').addEventListener('click', salvarPreferenciasCliente);
    document.getElementById('a-btn-salvar').addEventListener('click', salvarAdminPrefs);
  }

  init();
})();
