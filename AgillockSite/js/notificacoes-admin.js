'use strict';

(function () {
  const TIPOS_CLIENTE = [
    { id: 'ignitionOn',     label: 'Ignição Ligada',              icon: 'fa-key',                  iconClass: 'ic-ignition' },
    { id: 'ignitionOff',    label: 'Ignição Desligada',           icon: 'fa-power-off',            iconClass: 'ic-ignition' },
    { id: 'geofenceEnter',  label: 'Entrada na Zona de Segurança', icon: 'fa-sign-in',              iconClass: 'ic-geofence' },
    { id: 'geofenceExit',   label: 'Saída da Zona de Segurança',   icon: 'fa-sign-out',             iconClass: 'ic-geofence' },
    { id: 'overspeed',      label: 'Excesso de Velocidade',       icon: 'fa-tachometer',           iconClass: 'ic-speed' },
    { id: 'powerCut',       label: 'Alimentação Cortada',         icon: 'fa-bolt',                 iconClass: 'ic-power' },
    { id: 'alarm',          label: 'Alarme',                      icon: 'fa-exclamation-triangle', iconClass: 'ic-alarm' },
    { id: 'deviceLocked',   label: 'Veículo Bloqueado',           icon: 'fa-lock',                 iconClass: 'ic-lock' },
    { id: 'deviceUnlocked', label: 'Veículo Desbloqueado',        icon: 'fa-unlock',               iconClass: 'ic-lock' },
    { id: 'veiculoMovimento', label: 'Veículo em Movimento',      icon: 'fa-location-arrow',       iconClass: 'ic-geofence' },
    { id: 'motorOcioso',    label: 'Motor Ocioso (5min+)',        icon: 'fa-hourglass-half',       iconClass: 'ic-power' },
    { id: 'semAtualizacao', label: 'Veículo sem Atualização',     icon: 'fa-wifi',               iconClass: 'ic-alarm' },
    { id: 'kmExcedida',     label: 'Km Excedida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'kmReduzida',     label: 'Km Reduzida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'manutencao',         label: 'Manutenções (Recorrências)', icon: 'fa-wrench',               iconClass: 'ic-manutencao' },
    { id: 'manutencaoAlerta',   label: 'Alerta de Manutenção',       icon: 'fa-wrench',               iconClass: 'ic-manutencao-alerta', hidden: true },
    { id: 'manutencaoAtrasada', label: 'Manutenção Atrasada',        icon: 'fa-exclamation-triangle', iconClass: 'ic-manutencao-atrasada', hidden: true },
    { id: 'manutencaoFeita',    label: 'Manutenção Realizada',       icon: 'fa-check-circle',         iconClass: 'ic-manutencao-feita', hidden: true },
    { id: 'recorrenciaData',         label: 'Recorrência por Data',       icon: 'fa-calendar-check-o', iconClass: 'ic-manutencao' },
    { id: 'recorrenciaDataAlerta',   label: 'Alerta de Recorrência Data', icon: 'fa-calendar',         iconClass: 'ic-manutencao-alerta', hidden: true },
    { id: 'recorrenciaDataNaoFeita', label: 'Recorrência Data Atrasada',  icon: 'fa-calendar-times-o', iconClass: 'ic-manutencao-atrasada', hidden: true },
    { id: 'recorrenciaDataFeita',    label: 'Recorrência Data Realizada', icon: 'fa-calendar-check-o', iconClass: 'ic-manutencao-feita', hidden: true },
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
  let clienteDispositivos = [];
  let clienteLoginIdAtivo = null;
  let clienteDispositivoId = null;
  let clientePreferencias = {};

  function normalizarPlacaBusca(valor) {
    return String(valor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function garantirPickerDispositivosCliente() {
    if (document.getElementById('picker-dispositivo-cliente')) return;
    const style = document.createElement('style');
    style.textContent = `
      .notif-device-picker{position:relative}
      .notif-device-picker-btn{height:34px;width:100%;border:1px solid #ccc;background:#fff;border-radius:4px;text-align:left;padding:6px 30px 6px 12px;font-size:13px;color:#555;position:relative}
      .notif-device-picker-btn .fa-chevron-down{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#888}
      .notif-device-picker-menu{display:none;position:absolute;z-index:5000;left:0;right:0;top:38px;background:#fff;border:1px solid #ccd3dc;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:8px}
      .notif-device-picker.open .notif-device-picker-menu{display:block}
      .notif-device-picker-search{height:30px;font-size:12px;margin-bottom:7px}
      .notif-device-picker-list{max-height:210px;overflow-y:auto}
      .notif-device-picker-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:7px 8px;border-radius:5px;font-size:12px;color:#333}
      .notif-device-picker-option:hover,.notif-device-picker-option.active{background:#eef6fd;color:#1f6f9f}
      .notif-device-picker-empty{padding:10px;text-align:center;color:#999;font-size:12px}
      html.dark-theme .notif-device-picker-btn,html.dark-theme .notif-device-picker-menu{background:#252535;color:#e0e6f0;border-color:#3a3a5c}
      html.dark-theme .notif-device-picker-option{color:#e0e6f0}
      html.dark-theme .notif-device-picker-option:hover,html.dark-theme .notif-device-picker-option.active{background:#1a3a5c;color:#fff}
    `;
    document.head.appendChild(style);

    const select = document.getElementById('filtro-dispositivo-cliente');
    select.style.display = 'none';
    const picker = document.createElement('div');
    picker.id = 'picker-dispositivo-cliente';
    picker.className = 'notif-device-picker';
    picker.innerHTML = `
      <button type="button" class="notif-device-picker-btn" id="picker-dispositivo-cliente-btn"><span>Selecione um dispositivo...</span><i class="fa fa-chevron-down"></i></button>
      <div class="notif-device-picker-menu">
        <input type="text" id="busca-placa-dispositivo-cliente" class="form-control notif-device-picker-search" placeholder="Buscar por nome ou placa" autocomplete="off">
        <div id="picker-dispositivo-cliente-lista" class="notif-device-picker-list"></div>
      </div>`;
    select.parentNode.insertBefore(picker, select.nextSibling);
    document.getElementById('picker-dispositivo-cliente-btn').addEventListener('click', function () {
      picker.classList.toggle('open');
      if (picker.classList.contains('open')) setTimeout(() => document.getElementById('busca-placa-dispositivo-cliente')?.focus(), 0);
    });
    document.getElementById('busca-placa-dispositivo-cliente').addEventListener('input', function () {
      renderOpcoesDispositivosCliente(this.value);
    });
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) picker.classList.remove('open');
    });
  }

  function atualizarLabelPickerDispositivosCliente() {
    const sel = document.getElementById('filtro-dispositivo-cliente');
    const btnLabel = document.querySelector('#picker-dispositivo-cliente-btn span');
    if (!btnLabel) return;
    const opt = sel.options[sel.selectedIndex];
    btnLabel.textContent = opt && opt.value ? opt.text : 'Selecione um dispositivo...';
  }

  function renderOpcoesDispositivosCliente(filtroPlaca) {
    garantirPickerDispositivosCliente();
    const sel = document.getElementById('filtro-dispositivo-cliente');
    const ativo = sel.value;
    const filtro = normalizarPlacaBusca(filtroPlaca);
    const filtrados = filtro
      ? clienteDispositivos.filter(d => normalizarPlacaBusca(d.nome + ' ' + d.placa).includes(filtro))
      : clienteDispositivos;

    sel.innerHTML = '<option value="">Selecione um dispositivo...</option>' +
      filtrados.map(d => `<option value="${d.id}">${d.nome}${d.placa ? ' (' + d.placa + ')' : ''}</option>`).join('');

    if (ativo && filtrados.some(d => String(d.id) === String(ativo))) {
      sel.value = ativo;
    }
    atualizarLabelPickerDispositivosCliente();
    const lista = document.getElementById('picker-dispositivo-cliente-lista');
    if (lista) {
      lista.innerHTML = filtrados.length ? filtrados.map(d => {
        const texto = d.nome + (d.placa ? ' (' + d.placa + ')' : '');
        return `<button type="button" class="notif-device-picker-option${String(d.id) === String(sel.value) ? ' active' : ''}" data-id="${d.id}">${texto}</button>`;
      }).join('') : '<div class="notif-device-picker-empty">Nenhum dispositivo encontrado.</div>';
      lista.querySelectorAll('.notif-device-picker-option').forEach(btn => {
        btn.addEventListener('click', function () {
          sel.value = this.dataset.id;
          document.getElementById('picker-dispositivo-cliente').classList.remove('open');
          atualizarLabelPickerDispositivosCliente();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }
  }

  function garantirPickerCliente() {
    if (document.getElementById('picker-cliente')) return;
    const style = document.createElement('style');
    style.textContent = `
      .notif-client-picker{position:relative}
      .notif-client-picker-btn{height:34px;width:100%;border:1px solid #ccc;background:#fff;border-radius:4px;text-align:left;padding:6px 30px 6px 12px;font-size:13px;color:#555;position:relative;overflow:hidden}
      .notif-client-picker-btn span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .notif-client-picker-btn .fa-chevron-down{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#888}
      .notif-client-picker-menu{display:none;position:absolute;z-index:5000;left:0;right:0;top:38px;background:#fff;border:1px solid #ccd3dc;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:8px}
      .notif-client-picker.open .notif-client-picker-menu{display:block}
      .notif-client-picker-search{height:30px;font-size:12px;margin-bottom:7px}
      .notif-client-picker-list{max-height:210px;overflow-y:auto}
      .notif-client-picker-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:7px 8px;border-radius:5px;font-size:12px;color:#333}
      .notif-client-picker-option:hover,.notif-client-picker-option.active{background:#eef6fd;color:#1f6f9f}
      .notif-client-picker-empty{padding:10px;text-align:center;color:#999;font-size:12px}
      html.dark-theme .notif-client-picker-btn,html.dark-theme .notif-client-picker-menu{background:#252535;color:#e0e6f0;border-color:#3a3a5c}
      html.dark-theme .notif-client-picker-option{color:#e0e6f0}
      html.dark-theme .notif-client-picker-option:hover,html.dark-theme .notif-client-picker-option.active{background:#1a3a5c;color:#fff}
    `;
    document.head.appendChild(style);
    const sel = document.getElementById('filtro-cliente');
    sel.style.display = 'none';
    const picker = document.createElement('div');
    picker.id = 'picker-cliente';
    picker.className = 'notif-client-picker';
    picker.innerHTML = `
      <button type="button" class="notif-client-picker-btn" id="picker-cliente-btn"><span>Selecione um cliente...</span><i class="fa fa-chevron-down"></i></button>
      <div class="notif-client-picker-menu">
        <input type="text" id="busca-cliente" class="form-control notif-client-picker-search" placeholder="Buscar por nome" autocomplete="off">
        <div id="picker-cliente-lista" class="notif-client-picker-list"></div>
      </div>`;
    sel.parentNode.insertBefore(picker, sel.nextSibling);
    document.getElementById('picker-cliente-btn').addEventListener('click', function () {
      picker.classList.toggle('open');
      if (picker.classList.contains('open')) setTimeout(() => document.getElementById('busca-cliente')?.focus(), 0);
    });
    document.getElementById('busca-cliente').addEventListener('input', function () {
      renderPickerCliente(this.value);
    });
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) picker.classList.remove('open');
    });
  }

  function renderPickerCliente(filtro) {
    garantirPickerCliente();
    const sel = document.getElementById('filtro-cliente');
    const f = (filtro || '').toLowerCase().trim();
    const opts = Array.from(sel.options).filter(opt => opt.value);
    const filtrados = f ? opts.filter(opt => opt.text.toLowerCase().includes(f)) : opts;
    const label = document.querySelector('#picker-cliente-btn span');
    const opt = sel.options[sel.selectedIndex];
    if (label) label.textContent = opt && opt.value ? opt.text : 'Selecione um cliente...';
    const lista = document.getElementById('picker-cliente-lista');
    if (!lista) return;
    lista.innerHTML = filtrados.length ? filtrados.map(opt =>
      `<button type="button" class="notif-client-picker-option${String(opt.value) === String(sel.value) ? ' active' : ''}" data-id="${opt.value}">${opt.text}</button>`
    ).join('') : '<div class="notif-client-picker-empty">Nenhum cliente encontrado.</div>';
    lista.querySelectorAll('.notif-client-picker-option').forEach(btn => {
      btn.addEventListener('click', function () {
        sel.value = this.dataset.id;
        document.getElementById('picker-cliente').classList.remove('open');
        renderPickerCliente(document.getElementById('busca-cliente')?.value || '');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  async function carregarClientes() {
    try {
      const data = await AL.apiGet('/api/notificacoes-admin/clientes');
      clientes = data || [];
      const sel = document.getElementById('filtro-cliente');
      sel.innerHTML = '<option value="">Selecione um cliente...</option>' +
        clientes.map(c => `<option value="${c.id}">${c.nome} — ${c.email}</option>`).join('');
      renderPickerCliente('');
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
      clienteDispositivos = data || [];
      renderOpcoesDispositivosCliente(document.getElementById('busca-placa-dispositivo-cliente')?.value || '');
    } catch (err) {
      AL.showAlert('Erro ao carregar dispositivos: ' + err.message);
    }
  }

  async function carregarPreferenciasCliente(clienteLoginId, dispositivoId) {
    try {
      const data = await AL.apiGet(`/api/notificacoes-admin/clientes/${clienteLoginId}/preferencias/${dispositivoId}`);
      clientePreferencias = data?.preferencias || {};
      if (data?.overspeedLimit != null) clientePreferencias.overspeedLimit = data.overspeedLimit;
      if (data?.semAtualizacaoHoras != null) clientePreferencias.semAtualizacaoHoras = data.semAtualizacaoHoras;
      renderGridCliente();

      document.getElementById('c-input-km-max').value  = data?.kmExcedida?.kmMaximo30Dias || '';
      document.getElementById('c-input-dia-mes').value  = data?.kmExcedida?.diaRenovacaoMes || '';
      document.getElementById('c-input-km-min').value   = data?.kmReduzida?.kmMinimo7Dias || '';
      if (data?.kmReduzida?.diaSemanaRenovacao != null) {
        document.getElementById('c-select-dia-semana').value = data.kmReduzida.diaSemanaRenovacao;
      }
      document.getElementById('cliente-notif-container').style.display = 'block';
      document.getElementById('cliente-notif-vazio').style.display    = 'none';
    } catch (err) {
      AL.showAlert('Erro ao carregar preferências: ' + err.message);
    }
  }

  function renderGridCliente() {
    const grid = document.getElementById('c-grid-notificacoes');
    grid.innerHTML = TIPOS_CLIENTE.filter(t => !t.hidden).map(tipo => `
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
    document.getElementById('c-config-sem-atualizacao').style.display = 'block';
    document.getElementById('c-input-sem-atualizacao-horas').value = clientePreferencias.semAtualizacaoHoras || 3;
    document.getElementById('c-config-km-periodo').style.display = 'block';
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
      semAtualizacaoHoras: parseInt(document.getElementById('c-input-sem-atualizacao-horas').value) || 3,
      kmExcedida: {
        kmMaximo30Dias:  parseInt(document.getElementById('c-input-km-max').value) || null,
        diaRenovacaoMes: parseInt(document.getElementById('c-input-dia-mes').value) || null,
      },
      kmReduzida: {
        kmMinimo7Dias:       parseInt(document.getElementById('c-input-km-min').value) || null,
        diaSemanaRenovacao:  parseInt(document.getElementById('c-select-dia-semana').value),
      },
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
      var inputHoras = document.getElementById('a-input-sem-atualizacao-horas');
      if (inputHoras) inputHoras.value = adminPrefs.semAtualizacaoHoras || 3;
    } catch (err) {
      AL.showAlert('Erro ao carregar preferências admin: ' + err.message);
    }
  }

  function renderGridAdmin() {
    const grid = document.getElementById('a-grid-notificacoes');
    grid.innerHTML = TIPOS_ADMIN.filter(t => !t.hidden).map(tipo => {
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
    const inputHoras = document.getElementById('a-input-sem-atualizacao-horas');
    prefs.semAtualizacaoHoras = (inputHoras && parseInt(inputHoras.value)) || 3;

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
      if (document.getElementById('busca-placa-dispositivo-cliente')) document.getElementById('busca-placa-dispositivo-cliente').value = '';
      clienteDispositivos = [];
      renderOpcoesDispositivosCliente('');
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
