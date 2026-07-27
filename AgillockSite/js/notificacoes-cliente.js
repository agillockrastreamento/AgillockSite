'use strict';

(function () {
  const TIPOS_NOTIF = [
    { id: 'ignitionOn',    label: 'Ignição Ligada',              icon: 'fa-key',                  iconClass: 'ic-ignition' },
    { id: 'ignitionOff',   label: 'Ignição Desligada',           icon: 'fa-power-off',            iconClass: 'ic-ignition' },
    { id: 'geofenceEnter', label: 'Entrada na Zona de Segurança', icon: 'fa-sign-in',              iconClass: 'ic-geofence' },
    { id: 'geofenceExit',  label: 'Saída da Zona de Segurança',   icon: 'fa-sign-out',             iconClass: 'ic-geofence' },
    { id: 'overspeed',     label: 'Excesso de Velocidade',       icon: 'fa-tachometer',           iconClass: 'ic-speed' },
    { id: 'powerCut',      label: 'Alimentação Cortada',         icon: 'fa-bolt',                 iconClass: 'ic-power' },
    { id: 'alarm',         label: 'Alarme',                      icon: 'fa-exclamation-triangle', iconClass: 'ic-alarm' },
    { id: 'deviceLocked',  label: 'Veículo Bloqueado',           icon: 'fa-lock',                 iconClass: 'ic-lock' },
    { id: 'deviceUnlocked',label: 'Veículo Desbloqueado',        icon: 'fa-unlock',               iconClass: 'ic-lock' },
    { id: 'veiculoMovimento', label: 'Veículo em Movimento',     icon: 'fa-location-arrow',       iconClass: 'ic-geofence' },
    { id: 'motorOcioso',   label: 'Motor Ocioso (5min+)',        icon: 'fa-hourglass-half',       iconClass: 'ic-power' },
    { id: 'semAtualizacao',label: 'Veículo sem Atualização',     icon: 'fa-wifi',               iconClass: 'ic-alarm' },
    { id: 'kmExcedida',    label: 'Km Excedida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    { id: 'kmReduzida',    label: 'Km Reduzida (Período)',       icon: 'fa-road',                 iconClass: 'ic-km' },
    // Um interruptor para todos os avisos de multa/licenciamento.
    { id: 'multa',         label: 'Multas',                      icon: 'fa-gavel',                iconClass: 'ic-alarm' },
    { id: 'multaNova',              label: 'Nova Multa',            icon: 'fa-gavel', iconClass: 'ic-alarm', hidden: true },
    { id: 'multaVencimento7dias',   label: 'Multa a Vencer (7 dias)', icon: 'fa-gavel', iconClass: 'ic-alarm', hidden: true },
    { id: 'multaVencimentoHoje',    label: 'Multa Vence Hoje',      icon: 'fa-gavel', iconClass: 'ic-alarm', hidden: true },
    { id: 'licenciamentoPendente',  label: 'Licenciamento Pendente', icon: 'fa-gavel', iconClass: 'ic-alarm', hidden: true },
    { id: 'manutencao',         label: 'Manutenções (Recorrências)', icon: 'fa-wrench',               iconClass: 'ic-manutencao' },
    { id: 'manutencaoAlerta',   label: 'Alerta de Manutenção',       icon: 'fa-wrench',               iconClass: 'ic-manutencao-alerta', hidden: true },
    { id: 'manutencaoAtrasada', label: 'Manutenção Atrasada',        icon: 'fa-exclamation-triangle', iconClass: 'ic-manutencao-atrasada', hidden: true },
    { id: 'manutencaoFeita',    label: 'Manutenção Realizada',       icon: 'fa-check-circle',         iconClass: 'ic-manutencao-feita', hidden: true },
    { id: 'recorrenciaData',         label: 'Recorrência por Data',       icon: 'fa-calendar-check-o', iconClass: 'ic-manutencao' },
    { id: 'recorrenciaDataAlerta',   label: 'Alerta de Recorrência Data', icon: 'fa-calendar',         iconClass: 'ic-manutencao-alerta', hidden: true },
    { id: 'recorrenciaDataNaoFeita', label: 'Recorrência Data Atrasada',  icon: 'fa-calendar-times-o', iconClass: 'ic-manutencao-atrasada', hidden: true },
    { id: 'recorrenciaDataFeita',    label: 'Recorrência Data Realizada', icon: 'fa-calendar-check-o', iconClass: 'ic-manutencao-feita', hidden: true },
  ];

  const CANAIS = [
    { id: 'web',   label: 'Web',   icon: 'fa-desktop' },
    { id: 'app',   label: 'App',   icon: 'fa-mobile' },
    { id: 'email', label: 'E-mail',icon: 'fa-envelope-o' },
  ];

  let veiculos = [];
  let dispositivoIdAtivo = null;
  let preferenciasAtivas = {};
  // Modo "Configurar todos": o que for salvo vale para todos os dispositivos.
  // Continua sendo preferência por dispositivo no banco — depois dá para
  // selecionar um veículo e sobrescrever só ele.
  let modoTodos = false;

  function normalizarPlacaBusca(valor) {
    return String(valor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function garantirPickerVeiculos() {
    if (document.getElementById('picker-dispositivo')) return;
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

    const select = document.getElementById('filtro-dispositivo');
    select.style.display = 'none';
    const picker = document.createElement('div');
    picker.id = 'picker-dispositivo';
    picker.className = 'notif-device-picker';
    picker.innerHTML = `
      <button type="button" class="notif-device-picker-btn" id="picker-dispositivo-btn"><span>Selecione um veículo...</span><i class="fa fa-chevron-down"></i></button>
      <div class="notif-device-picker-menu">
        <input type="text" id="busca-placa-dispositivo" class="form-control notif-device-picker-search" placeholder="Buscar por nome ou placa" autocomplete="off">
        <div id="picker-dispositivo-lista" class="notif-device-picker-list"></div>
      </div>`;
    select.parentNode.insertBefore(picker, select.nextSibling);
    document.getElementById('picker-dispositivo-btn').addEventListener('click', function () {
      picker.classList.toggle('open');
      if (picker.classList.contains('open')) setTimeout(() => document.getElementById('busca-placa-dispositivo')?.focus(), 0);
    });
    document.getElementById('busca-placa-dispositivo').addEventListener('input', function () {
      renderOpcoesVeiculos(this.value);
    });
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) picker.classList.remove('open');
    });
  }

  function atualizarLabelPickerVeiculos() {
    const select = document.getElementById('filtro-dispositivo');
    const btnLabel = document.querySelector('#picker-dispositivo-btn span');
    if (!btnLabel) return;
    if (modoTodos) {
      btnLabel.textContent = `Todos os dispositivos (${veiculos.length})`;
      return;
    }
    const opt = select.options[select.selectedIndex];
    btnLabel.textContent = opt && opt.value ? opt.text : 'Selecione um veículo...';
  }

  function renderOpcoesVeiculos(filtroPlaca) {
    garantirPickerVeiculos();
    const select = document.getElementById('filtro-dispositivo');
    const ativo = select.value;
    const filtro = normalizarPlacaBusca(filtroPlaca);
    const filtrados = filtro
      ? veiculos.filter(v => normalizarPlacaBusca(v.nome + ' ' + v.placa).includes(filtro))
      : veiculos;

    select.innerHTML = '<option value="">Selecione um ve&iacute;culo...</option>' +
      filtrados.map(v => `<option value="${v.dispositivoId}">${v.placa ? v.nome + ' (' + v.placa + ')' : v.nome}</option>`).join('');

    if (ativo && filtrados.some(v => String(v.dispositivoId) === String(ativo))) {
      select.value = ativo;
    }
    atualizarLabelPickerVeiculos();
    const lista = document.getElementById('picker-dispositivo-lista');
    if (lista) {
      lista.innerHTML = filtrados.length ? filtrados.map(v => {
        const texto = v.placa ? v.nome + ' (' + v.placa + ')' : v.nome;
        return `<button type="button" class="notif-device-picker-option${String(v.dispositivoId) === String(select.value) ? ' active' : ''}" data-id="${v.dispositivoId}">${texto}</button>`;
      }).join('') : '<div class="notif-device-picker-empty">Nenhum veículo encontrado.</div>';
      lista.querySelectorAll('.notif-device-picker-option').forEach(btn => {
        btn.addEventListener('click', function () {
          select.value = this.dataset.id;
          document.getElementById('picker-dispositivo').classList.remove('open');
          atualizarLabelPickerVeiculos();
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }
  }

  async function init() {
    await carregarVeiculos();
    bindEvents();
  }

  async function carregarVeiculos() {
    try {
      const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/posicoes');
      veiculos = data || [];
      renderOpcoesVeiculos(document.getElementById('busca-placa-dispositivo')?.value || '');
      // "Configurar todos" só faz sentido com mais de um dispositivo.
      document.getElementById('btn-configurar-todos').style.display = veiculos.length > 1 ? '' : 'none';
    } catch (err) {
      console.error('Erro ao carregar veículos', err);
    }
  }

  function sairModoTodos() {
    modoTodos = false;
    document.getElementById('btn-configurar-todos').classList.remove('ativo');
    document.getElementById('aviso-modo-todos').classList.remove('visivel');
  }

  // Botão em estado de carregando: com muitos veículos o preparo da grade não é
  // instantâneo, e sem isso a tela parecia travada depois do clique.
  function marcarBotaoTodosCarregando(carregando) {
    const btn = document.getElementById('btn-configurar-todos');
    if (!btn) return;
    if (carregando) {
      btn.dataset.htmlOriginal = btn.dataset.htmlOriginal || btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Carregando...';
      return;
    }
    btn.disabled = false;
    if (btn.dataset.htmlOriginal) btn.innerHTML = btn.dataset.htmlOriginal;
  }

  function mostrarGridCarregando(mensagem) {
    const grid = document.getElementById('grid-notificacoes');
    if (!grid) return;
    grid.innerHTML =
      '<div class="text-center text-muted" style="padding:28px 12px;grid-column:1/-1;">' +
      '<i class="fa fa-spinner fa-spin fa-2x"></i>' +
      '<p style="margin-top:10px;">' + mensagem + '</p></div>';
  }

  async function entrarModoTodos() {
    if (veiculos.length < 2) return;
    modoTodos = true;
    dispositivoIdAtivo = null;
    document.getElementById('filtro-dispositivo').value = '';
    document.getElementById('btn-configurar-todos').classList.add('ativo');
    atualizarLabelPickerVeiculos();

    document.getElementById('nome-veiculo-selecionado').textContent =
      `Todos os dispositivos (${veiculos.length})`;
    document.getElementById('aviso-modo-todos-texto').textContent =
      `O que você salvar aqui vale para os ${veiculos.length} dispositivos. ` +
      'Depois, para configurar um deles de forma diferente, basta selecioná-lo na lista.';
    document.getElementById('aviso-modo-todos').classList.add('visivel');

    marcarBotaoTodosCarregando(true);
    document.getElementById('notif-container').style.display = 'block';
    document.getElementById('notif-vazio').style.display = 'none';
    mostrarGridCarregando(`Carregando a configuração dos ${veiculos.length} dispositivos...`);
    try {
      await carregarPreferenciasTodos();
    } finally {
      marcarBotaoTodosCarregando(false);
    }
  }

  function bindEvents() {
    document.getElementById('filtro-dispositivo').addEventListener('change', function () {
      const id = this.value;
      sairModoTodos();   // escolher um veículo sai do modo global
      atualizarLabelPickerVeiculos();   // já fora do modo global, mostra o nome do veículo
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

    document.getElementById('btn-configurar-todos').addEventListener('click', entrarModoTodos);
    document.getElementById('btn-salvar-geral').addEventListener('click', salvarConfiguracoes);
    document.getElementById('select-periodo-excedida').addEventListener('change', aplicarPeriodoKm);
    document.getElementById('select-periodo-reduzida').addEventListener('change', aplicarPeriodoKm);
  }

  // A referência de renovação muda com o período: no semanal o que importa é o
  // dia da semana; nos demais, o dia do mês.
  function aplicarPeriodoKm() {
    const alternar = function (periodoId, grupoSemanaId, grupoMesId) {
      const semanal = document.getElementById(periodoId).value === 'SEMANAL';
      document.getElementById(grupoSemanaId).style.display = semanal ? '' : 'none';
      document.getElementById(grupoMesId).style.display = semanal ? 'none' : '';
    };
    alternar('select-periodo-excedida', 'grupo-dia-semana-excedida', 'grupo-dia-mes-excedida');
    alternar('select-periodo-reduzida', 'grupo-dia-semana-reduzida', 'grupo-dia-mes-reduzida');
  }

  async function carregarPreferencias(dispositivoId) {
    try {
      const data = await AL_CLIENTE.apiGet(`/api/cliente/notificacoes/preferencias/${dispositivoId}`);
      preferenciasAtivas = data?.preferencias || {};
      if (data?.overspeedLimit != null) preferenciasAtivas.overspeedLimit = data.overspeedLimit;
      if (data?.semAtualizacaoHoras != null) preferenciasAtivas.semAtualizacaoHoras = data.semAtualizacaoHoras;
      renderGrid();

      // Fill km excedida config
      document.getElementById('input-km-max').value = data?.kmExcedida?.kmMaximo30Dias || '';
      document.getElementById('input-dia-mes').value = data?.kmExcedida?.diaRenovacaoMes || '';
      if (data?.kmExcedida?.diaSemanaRenovacao != null) {
        document.getElementById('select-dia-semana-excedida').value = data.kmExcedida.diaSemanaRenovacao;
      }
      document.getElementById('select-periodo-excedida').value = data?.kmExcedida?.periodo || 'MENSAL';

      // Fill km reduzida config
      document.getElementById('input-km-min').value = data?.kmReduzida?.kmMinimo7Dias || '';
      if (data?.kmReduzida?.diaSemanaRenovacao != null) {
        document.getElementById('select-dia-semana').value = data.kmReduzida.diaSemanaRenovacao;
      }
      document.getElementById('input-dia-mes-reduzida').value = data?.kmReduzida?.diaRenovacaoMes || '';
      document.getElementById('select-periodo-reduzida').value = data?.kmReduzida?.periodo || 'SEMANAL';
      aplicarPeriodoKm();

      document.getElementById('notif-container').style.display = 'block';
      document.getElementById('notif-vazio').style.display = 'none';
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao carregar preferências.');
    }
  }

  // No modo "todos", mostra o denominador comum: um canal só aparece ligado se
  // estiver ligado em todos os dispositivos; campos numéricos só aparecem
  // preenchidos se o valor for o mesmo em todos.
  async function carregarPreferenciasTodos() {
    try {
      // Uma requisição para todos os veículos. Antes era uma por veículo — com
      // centenas de dispositivos a tela ficava vários segundos sem os cards.
      const resposta = await AL_CLIENTE.apiGet('/api/cliente/notificacoes/preferencias');
      const porDispositivo = resposta?.porDispositivo || {};
      const todas = veiculos.map(v => porDispositivo[v.dispositivoId] || { preferencias: {} });

      const ligadoEmTodos = (tipo, canal) =>
        todas.every(d => d?.preferencias?.[tipo]?.[canal] === true);

      preferenciasAtivas = {};
      TIPOS_NOTIF.forEach(tipo => {
        preferenciasAtivas[tipo.id] = {
          web: ligadoEmTodos(tipo.id, 'web'),
          app: ligadoEmTodos(tipo.id, 'app'),
          email: ligadoEmTodos(tipo.id, 'email'),
        };
      });

      const valorComum = (fn) => {
        const valores = todas.map(fn);
        const primeiro = valores[0];
        return valores.every(v => v === primeiro) ? primeiro : null;
      };

      const overspeed = valorComum(d => d?.overspeedLimit ?? null);
      if (overspeed != null) preferenciasAtivas.overspeedLimit = overspeed;
      const semAtualizacao = valorComum(d => d?.semAtualizacaoHoras ?? null);
      if (semAtualizacao != null) preferenciasAtivas.semAtualizacaoHoras = semAtualizacao;

      renderGrid();

      const kmMax = valorComum(d => d?.kmExcedida?.kmMaximo30Dias ?? null);
      const diaMes = valorComum(d => d?.kmExcedida?.diaRenovacaoMes ?? null);
      const diaSemanaExc = valorComum(d => d?.kmExcedida?.diaSemanaRenovacao ?? null);
      const periodoExc = valorComum(d => d?.kmExcedida?.periodo ?? null);
      const kmMin = valorComum(d => d?.kmReduzida?.kmMinimo7Dias ?? null);
      const diaSemana = valorComum(d => d?.kmReduzida?.diaSemanaRenovacao ?? null);
      const diaMesRed = valorComum(d => d?.kmReduzida?.diaRenovacaoMes ?? null);
      const periodoRed = valorComum(d => d?.kmReduzida?.periodo ?? null);

      document.getElementById('input-km-max').value = kmMax || '';
      document.getElementById('input-dia-mes').value = diaMes || '';
      if (diaSemanaExc != null) document.getElementById('select-dia-semana-excedida').value = diaSemanaExc;
      document.getElementById('select-periodo-excedida').value = periodoExc || 'MENSAL';
      document.getElementById('input-km-min').value = kmMin || '';
      if (diaSemana != null) document.getElementById('select-dia-semana').value = diaSemana;
      document.getElementById('input-dia-mes-reduzida').value = diaMesRed || '';
      document.getElementById('select-periodo-reduzida').value = periodoRed || 'SEMANAL';
      aplicarPeriodoKm();

      document.getElementById('notif-container').style.display = 'block';
      document.getElementById('notif-vazio').style.display = 'none';
    } catch (err) {
      // Sem isto o spinner da grade ficaria girando para sempre.
      const grid = document.getElementById('grid-notificacoes');
      if (grid) {
        grid.innerHTML =
          '<div class="text-center text-muted" style="padding:28px 12px;grid-column:1/-1;">' +
          '<i class="fa fa-exclamation-triangle fa-2x"></i>' +
          '<p style="margin-top:10px;">Não foi possível carregar a configuração dos dispositivos.</p></div>';
      }
      AL_CLIENTE.showAlert('Erro ao carregar preferências dos dispositivos.');
    }
  }

  function renderGrid() {
    const grid = document.getElementById('grid-notificacoes');
    grid.innerHTML = TIPOS_NOTIF.filter(t => !t.hidden).map(tipo => {
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
    document.getElementById('config-sem-atualizacao').style.display = 'block';
    document.getElementById('input-sem-atualizacao-horas').value = preferenciasAtivas.semAtualizacaoHoras || 3;
    document.getElementById('config-km-periodo').style.display = 'block';
  }

  window.toggleChannel = function(el, tipoId, canalId) {
    el.classList.toggle('active');
  };

  async function salvarConfiguracoes() {
    if (!dispositivoIdAtivo && !modoTodos) return;

    const btn = document.getElementById('btn-salvar-geral');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> SALVANDO...';

    const alvo = modoTodos
      ? { dispositivoIds: veiculos.map(v => v.dispositivoId) }
      : { dispositivoId: dispositivoIdAtivo };

    const payload = {
      ...alvo,
      preferencias: {},
      overspeedLimit: parseInt(document.getElementById('input-vel-limite').value) || 100,
      semAtualizacaoHoras: parseInt(document.getElementById('input-sem-atualizacao-horas').value) || 3,
      kmExcedida: {
        kmMaximo30Dias: parseInt(document.getElementById('input-km-max').value) || null,
        diaRenovacaoMes: parseInt(document.getElementById('input-dia-mes').value) || null,
        diaSemanaRenovacao: parseInt(document.getElementById('select-dia-semana-excedida').value),
        periodo: document.getElementById('select-periodo-excedida').value,
      },
      kmReduzida: {
        kmMinimo7Dias: parseInt(document.getElementById('input-km-min').value) || null,
        diaSemanaRenovacao: parseInt(document.getElementById('select-dia-semana').value),
        diaRenovacaoMes: parseInt(document.getElementById('input-dia-mes-reduzida').value) || null,
        periodo: document.getElementById('select-periodo-reduzida').value,
      },
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
      AL_CLIENTE.showAlert(
        modoTodos
          ? `Configurações salvas para os ${veiculos.length} dispositivos!`
          : 'Configurações salvas com sucesso!',
        'success'
      );
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-save"></i> Salvar configurações';
    }
  }

  init();
})();
