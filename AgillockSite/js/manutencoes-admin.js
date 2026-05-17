'use strict';

(function () {

  // ── Estado ────────────────────────────────────────────────────────────────────
  let clientes = [];
  let dispositivos = [];
  let clienteLoginIdAtivo = null;
  let dispositivoIdAtivo = null;
  let registros = [];
  let recorrencias = [];
  let fotosPendentes = [];
  let editandoRegistroId = null;
  let editandoRecorrenciaId = null;
  let recorrenciaFeitoId = null;
  let excluirId = null;
  let excluirTipo = null;
  let gPage = 1;

  const TIPO_ICON = {
    preventiva:'fa-shield', corretiva:'fa-wrench',
    revisao:'fa-search', personalizado:'fa-star',
  };

  function textoVeiculoModal() {
    const sel = document.getElementById('filtro-dispositivo');
    if (!sel || !sel.value) return '';
    const opt = sel.options[sel.selectedIndex];
    return opt ? opt.text.replace(/\s*\(([^)]*)\)\s*$/, ' $1').trim() : '';
  }

  function atualizarVeiculoModal(tipo) {
    const el = document.getElementById(tipo === 'recorrencia' ? 'modalRecorrencia-veiculo' : 'modalRegistro-veiculo');
    const texto = textoVeiculoModal();
    if (el) el.textContent = texto ? ' — ' + texto : '';
  }

  function normalizarPlacaBusca(valor) {
    return String(valor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function garantirPickerDispositivo() {
    if (document.getElementById('man-picker-dispositivo')) return;
    const style = document.createElement('style');
    style.textContent = `
      .man-device-picker{position:relative}
      .man-device-picker-btn{height:34px;width:100%;border:1px solid #ccc;background:#fff;border-radius:4px;text-align:left;padding:6px 30px 6px 12px;font-size:13px;color:#555;position:relative}
      .man-device-picker-btn .fa-chevron-down{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#888}
      .man-device-picker-menu{display:none;position:absolute;z-index:5000;left:0;right:0;top:38px;background:#fff;border:1px solid #ccd3dc;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:8px}
      .man-device-picker.open .man-device-picker-menu{display:block}
      .man-device-picker-search{height:30px;font-size:12px;margin-bottom:7px}
      .man-device-picker-list{max-height:210px;overflow-y:auto}
      .man-device-picker-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:7px 8px;border-radius:5px;font-size:12px;color:#333}
      .man-device-picker-option:hover,.man-device-picker-option.active{background:#eef6fd;color:#1f6f9f}
      .man-device-picker-empty{padding:10px;text-align:center;color:#999;font-size:12px}
      html.dark-theme .man-device-picker-btn,html.dark-theme .man-device-picker-menu{background:#252535;color:#e0e6f0;border-color:#3a3a5c}
      html.dark-theme .man-device-picker-option{color:#e0e6f0}
      html.dark-theme .man-device-picker-option:hover,html.dark-theme .man-device-picker-option.active{background:#1a3a5c;color:#fff}
    `;
    document.head.appendChild(style);
    const sel = document.getElementById('filtro-dispositivo');
    sel.style.display = 'none';
    const picker = document.createElement('div');
    picker.id = 'man-picker-dispositivo';
    picker.className = 'man-device-picker';
    picker.innerHTML = `
      <button type="button" class="man-device-picker-btn" id="man-picker-dispositivo-btn"><span>Selecione um dispositivo...</span><i class="fa fa-chevron-down"></i></button>
      <div class="man-device-picker-menu">
        <input type="text" id="man-busca-placa-dispositivo" class="form-control man-device-picker-search" placeholder="Buscar por nome ou placa" autocomplete="off">
        <div id="man-picker-dispositivo-lista" class="man-device-picker-list"></div>
      </div>`;
    sel.parentNode.insertBefore(picker, sel.nextSibling);
    document.getElementById('man-picker-dispositivo-btn').addEventListener('click', function () {
      picker.classList.toggle('open');
      if (picker.classList.contains('open')) setTimeout(() => document.getElementById('man-busca-placa-dispositivo')?.focus(), 0);
    });
    document.getElementById('man-busca-placa-dispositivo').addEventListener('input', function () {
      renderPickerDispositivo(this.value);
    });
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) picker.classList.remove('open');
    });
  }

  function renderPickerDispositivo(filtroPlaca) {
    garantirPickerDispositivo();
    const sel = document.getElementById('filtro-dispositivo');
    const filtro = normalizarPlacaBusca(filtroPlaca);
    const opts = Array.from(sel.options).filter(opt => opt.value);
    const filtrados = filtro ? opts.filter(opt => normalizarPlacaBusca(opt.text).includes(filtro)) : opts;
    const label = document.querySelector('#man-picker-dispositivo-btn span');
    const opt = sel.options[sel.selectedIndex];
    if (label) label.textContent = opt && opt.value ? opt.text : 'Selecione um dispositivo...';
    const lista = document.getElementById('man-picker-dispositivo-lista');
    if (!lista) return;
    lista.innerHTML = filtrados.length ? filtrados.map(opt =>
      `<button type="button" class="man-device-picker-option${String(opt.value) === String(sel.value) ? ' active' : ''}" data-id="${opt.value}">${opt.text}</button>`
    ).join('') : '<div class="man-device-picker-empty">Nenhum dispositivo encontrado.</div>';
    lista.querySelectorAll('.man-device-picker-option').forEach(btn => {
      btn.addEventListener('click', function () {
        sel.value = this.dataset.id;
        document.getElementById('man-picker-dispositivo').classList.remove('open');
        renderPickerDispositivo(document.getElementById('man-busca-placa-dispositivo')?.value || '');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  function garantirPickerCliente() {
    if (document.getElementById('man-picker-cliente')) return;
    const style = document.createElement('style');
    style.textContent = `
      .man-client-picker{position:relative}
      .man-client-picker-btn{height:34px;width:100%;border:1px solid #ccc;background:#fff;border-radius:4px;text-align:left;padding:6px 30px 6px 12px;font-size:13px;color:#555;position:relative;overflow:hidden}
      .man-client-picker-btn span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .man-client-picker-btn .fa-chevron-down{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#888}
      .man-client-picker-menu{display:none;position:absolute;z-index:5000;left:0;right:0;top:38px;background:#fff;border:1px solid #ccd3dc;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:8px}
      .man-client-picker.open .man-client-picker-menu{display:block}
      .man-client-picker-search{height:30px;font-size:12px;margin-bottom:7px}
      .man-client-picker-list{max-height:210px;overflow-y:auto}
      .man-client-picker-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:7px 8px;border-radius:5px;font-size:12px;color:#333}
      .man-client-picker-option:hover,.man-client-picker-option.active{background:#eef6fd;color:#1f6f9f}
      .man-client-picker-empty{padding:10px;text-align:center;color:#999;font-size:12px}
      html.dark-theme .man-client-picker-btn,html.dark-theme .man-client-picker-menu{background:#252535;color:#e0e6f0;border-color:#3a3a5c}
      html.dark-theme .man-client-picker-option{color:#e0e6f0}
      html.dark-theme .man-client-picker-option:hover,html.dark-theme .man-client-picker-option.active{background:#1a3a5c;color:#fff}
    `;
    document.head.appendChild(style);
    const sel = document.getElementById('filtro-cliente');
    sel.style.display = 'none';
    const picker = document.createElement('div');
    picker.id = 'man-picker-cliente';
    picker.className = 'man-client-picker';
    picker.innerHTML = `
      <button type="button" class="man-client-picker-btn" id="man-picker-cliente-btn"><span>Selecione um cliente...</span><i class="fa fa-chevron-down"></i></button>
      <div class="man-client-picker-menu">
        <input type="text" id="man-busca-cliente" class="form-control man-client-picker-search" placeholder="Buscar por nome" autocomplete="off">
        <div id="man-picker-cliente-lista" class="man-client-picker-list"></div>
      </div>`;
    sel.parentNode.insertBefore(picker, sel.nextSibling);
    document.getElementById('man-picker-cliente-btn').addEventListener('click', function () {
      picker.classList.toggle('open');
      if (picker.classList.contains('open')) setTimeout(() => document.getElementById('man-busca-cliente')?.focus(), 0);
    });
    document.getElementById('man-busca-cliente').addEventListener('input', function () {
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
    const label = document.querySelector('#man-picker-cliente-btn span');
    const opt = sel.options[sel.selectedIndex];
    if (label) label.textContent = opt && opt.value ? opt.text : 'Selecione um cliente...';
    const lista = document.getElementById('man-picker-cliente-lista');
    if (!lista) return;
    lista.innerHTML = filtrados.length ? filtrados.map(opt =>
      `<button type="button" class="man-client-picker-option${String(opt.value) === String(sel.value) ? ' active' : ''}" data-id="${opt.value}">${opt.text}</button>`
    ).join('') : '<div class="man-client-picker-empty">Nenhum cliente encontrado.</div>';
    lista.querySelectorAll('.man-client-picker-option').forEach(btn => {
      btn.addEventListener('click', function () {
        sel.value = this.dataset.id;
        document.getElementById('man-picker-cliente').classList.remove('open');
        renderPickerCliente(document.getElementById('man-busca-cliente')?.value || '');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  const TIPO_LABEL = {
    preventiva:'Preventiva', corretiva:'Corretiva',
    revisao:'Revisão', personalizado:'Personalizado',
  };

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    await carregarClientes();
    bindEvents();
    renderBulkLista();
  }

  async function carregarClientes() {
    try {
      const data = await AL.apiGet('/api/manutencoes-admin/clientes');
      clientes = data || [];
      const sel = document.getElementById('filtro-cliente');
      sel.innerHTML = '<option value="">Selecione um cliente...</option>' +
        clientes.map(c => `<option value="${c.id}">${c.nome} — ${c.email}</option>`).join('');
      renderPickerCliente('');
    } catch (err) {
      AL.showAlert('Erro ao carregar clientes: ' + err.message);
    }
  }

  function manutencaoAtiva() {
    const d = dispositivos.find(d => d.id === dispositivoIdAtivo);
    return !d || d.manutencaoAtiva !== false;
  }

  function atualizarBannerManutencao() {
    const banner = document.getElementById('man-banner-desativado');
    if (!banner) return;
    if (dispositivoIdAtivo && !manutencaoAtiva()) banner.classList.add('visivel');
    else banner.classList.remove('visivel');
  }

  async function carregarDispositivosCliente(loginId) {
    const sel = document.getElementById('filtro-dispositivo');
    sel.innerHTML = '<option value="">Carregando...</option>';
    document.getElementById('wrap-filtro-dispositivo').style.display = 'block';
    try {
      const data = await AL.apiGet('/api/manutencoes-admin/clientes/' + loginId + '/dispositivos');
      dispositivos = data || [];
      sel.innerHTML = '<option value="">Selecione um dispositivo...</option>' +
        dispositivos.map(d => `<option value="${d.id}">${d.nome}${d.placa ? ' (' + d.placa + ')' : ''}</option>`).join('');
      renderPickerDispositivo('');
    } catch (err) {
      AL.showAlert('Erro ao carregar dispositivos: ' + err.message);
    }
  }

  async function carregarDados(loginId, dispositivoId) {
    try {
      const [regs, recs] = await Promise.all([
        AL.apiGet('/api/manutencoes-admin/clientes/' + loginId + '/registros?dispositivoId=' + dispositivoId),
        AL.apiGet('/api/manutencoes-admin/clientes/' + loginId + '/recorrencias?dispositivoId=' + dispositivoId),
      ]);
      registros = regs || [];
      recorrencias = recs || [];
      renderRegistros();
      renderRecorrencias();
    } catch (err) {
      AL.showAlert('Erro ao carregar manutenções: ' + err.message);
    }
  }

  // ── Bind events ───────────────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('filtro-cliente').addEventListener('change', function () {
      const id = this.value;
      clienteLoginIdAtivo = id || null;
      dispositivoIdAtivo = null;
      dispositivos = [];
      document.getElementById('cliente-man-container').style.display = 'none';
      document.getElementById('cliente-man-vazio').style.display = 'flex';
      document.getElementById('wrap-acoes-cliente').style.display = id ? 'flex' : 'none';
      document.getElementById('btn-novo-registro').disabled = true;
      document.getElementById('btn-nova-recorrencia').disabled = true;
      const banner = document.getElementById('man-banner-desativado');
      if (banner) banner.classList.remove('visivel');
      if (!id) { document.getElementById('wrap-filtro-dispositivo').style.display = 'none'; renderPickerDispositivo(''); return; }
      const c = clientes.find(c => c.id === id);
      document.getElementById('c-nome-cliente').textContent = c ? c.nome : '—';
      carregarDispositivosCliente(id);
    });

    document.getElementById('filtro-dispositivo').addEventListener('change', function () {
      const id = this.value;
      dispositivoIdAtivo = id || null;
      document.getElementById('cliente-man-container').style.display = 'none';
      document.getElementById('cliente-man-vazio').style.display = id ? 'none' : 'flex';
      if (!id) {
        document.getElementById('btn-novo-registro').disabled = true;
        document.getElementById('btn-nova-recorrencia').disabled = true;
        const banner = document.getElementById('man-banner-desativado');
        if (banner) banner.classList.remove('visivel');
        renderPickerDispositivo(document.getElementById('man-busca-placa-dispositivo')?.value || '');
        return;
      }
      const ativa = manutencaoAtiva();
      atualizarBannerManutencao();
      document.getElementById('btn-novo-registro').disabled = !ativa;
      document.getElementById('btn-nova-recorrencia').disabled = !ativa;
      const opt = this.options[this.selectedIndex];
      document.getElementById('c-nome-dispositivo').textContent = opt ? opt.text : '—';
      document.getElementById('cliente-man-container').style.display = 'block';
      carregarDados(clienteLoginIdAtivo, id);
      renderPickerDispositivo(document.getElementById('man-busca-placa-dispositivo')?.value || '');
    });

    document.getElementById('btn-novo-registro').addEventListener('click', abrirModalRegistro);
    document.getElementById('btn-nova-recorrencia').addEventListener('click', abrirModalRecorrencia);
    document.getElementById('btn-bulk-recorrencia').addEventListener('click', function () { $('#modalBulk').modal('show'); });
    document.getElementById('btn-salvar-registro').addEventListener('click', salvarRegistro);
    document.getElementById('btn-salvar-recorrencia').addEventListener('click', salvarRecorrencia);
    document.getElementById('btn-confirmar-feito').addEventListener('click', confirmarFeito);
    document.getElementById('btn-salvar-bulk').addEventListener('click', salvarBulk);
    document.getElementById('btn-confirmar-excluir').addEventListener('click', executarExcluir);

    document.getElementById('reg-fotos-input').addEventListener('change', function () {
      processarFotos(this.files, fotosPendentes, 'reg-fotos-preview');
      this.value = '';
    });

    document.getElementById('g-btn-buscar').addEventListener('click', function () {
      gPage = 1;
      buscarTodosRegistros();
    });

    document.getElementById('bulk-selecionar-todos').addEventListener('click', function () {
      document.querySelectorAll('#bulk-lista-clientes input[type=checkbox]').forEach(cb => cb.checked = true);
    });
    document.getElementById('bulk-limpar-selecao').addEventListener('click', function () {
      document.querySelectorAll('#bulk-lista-clientes input[type=checkbox]').forEach(cb => cb.checked = false);
    });

    document.getElementById('man-lightbox-close').addEventListener('click', fecharLightbox);
    document.getElementById('man-lightbox').addEventListener('click', function (e) {
      if (e.target === this) fecharLightbox();
    });

    $('#modalRegistro').on('hidden.bs.modal', resetModalRegistro);
    $('#modalRecorrencia').on('hidden.bs.modal', resetModalRecorrencia);
    $('#modalFeito').on('hidden.bs.modal', function () { recorrenciaFeitoId = null; document.getElementById('feito-notas').value = ''; });
  }

  // ── Render Histórico ──────────────────────────────────────────────────────────
  function renderRegistros() {
    const list = document.getElementById('c-list-registros');
    const empty = document.getElementById('c-empty-registros');
    if (!registros.length) { list.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';
    list.innerHTML = registros.map(r => {
      const tipo = r.tipo || 'preventiva';
      const icon = TIPO_ICON[tipo] || 'fa-wrench';
      const tipoLabel = TIPO_LABEL[tipo] || tipo;
      const dataStr = new Date(r.dataRealizacao).toLocaleDateString('pt-BR');
      const fotos = Array.isArray(r.fotos) ? r.fotos : [];
      const isAdmin = r.origem === 'ADMIN';

      return `
        <div class="man-card">
          <div class="man-card-top">
            <div class="man-card-icon tipo-${tipo}"><i class="fa ${icon}"></i></div>
            <div class="man-card-body">
              <div class="man-card-title">
                ${_esc(r.titulo)}
                <span class="man-badge man-badge-${tipo}" style="margin-left:6px;">${tipoLabel}</span>
                <span class="man-badge ${isAdmin ? 'man-badge-admin' : 'man-badge-cliente'}" style="margin-left:4px;">
                  <i class="fa ${isAdmin ? 'fa-shield' : 'fa-user'}" style="margin-right:3px;"></i>${isAdmin ? 'Admin' : 'Cliente'}
                </span>
              </div>
              <div class="man-card-meta">
                <span><i class="fa fa-calendar"></i>${dataStr}</span>
                ${r.kmRealizacao != null ? `<span><i class="fa fa-road"></i>${Math.round(r.kmRealizacao).toLocaleString('pt-BR')} km</span>` : ''}
                ${r.oficina ? `<span><i class="fa fa-building-o"></i>${_esc(r.oficina)}</span>` : ''}
                ${r.custo != null ? `<span><i class="fa fa-money"></i>R$ ${parseFloat(r.custo).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>` : ''}
              </div>
            </div>
            <div class="man-card-actions">
              <button class="btn btn-info btn-xs" onclick="_editarRegistro('${r.id}')" title="Editar"><i class="fa fa-pencil"></i></button>
              <button class="btn btn-danger btn-xs" onclick="_confirmarExcluir('${r.id}','registro')" title="Excluir"><i class="fa fa-trash"></i></button>
              ${(r.notas || fotos.length) ? `<button class="btn btn-default btn-xs" onclick="_toggleExtra(this)"><i class="fa fa-chevron-down"></i></button>` : ''}
            </div>
          </div>
          ${(r.notas || fotos.length) ? `
          <div class="man-card-extra" style="display:none;">
            ${r.notas ? `<p class="man-card-notas">${_esc(r.notas)}</p>` : ''}
            ${fotos.length ? `<div class="man-fotos-grid">${fotos.map(f =>
              `<img class="man-foto-thumb" src="${f.dataUrl}" alt="${_esc(f.nome||'foto')}" onclick="abrirLightbox('${f.dataUrl}')" />`
            ).join('')}</div>` : ''}
          </div>` : ''}
        </div>
      `;
    }).join('');
  }

  // ── Render Recorrências ───────────────────────────────────────────────────────
  function renderRecorrencias() {
    const list = document.getElementById('c-list-recorrencias');
    const empty = document.getElementById('c-empty-recorrencias');
    const badge = document.getElementById('c-badge-rec');

    const urgentes = recorrencias.filter(r => {
      const kmAtual = (r.dispositivo?.odometroSistemaMetros ?? 0) / 1000;
      return r.intervaloKm - (kmAtual - r.kmBase) <= 50;
    }).length;
    badge.textContent = urgentes;
    badge.style.display = urgentes > 0 ? '' : 'none';

    if (!recorrencias.length) { list.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    list.innerHTML = recorrencias.map(r => {
      const kmAtual = (r.dispositivo?.odometroSistemaMetros ?? 0) / 1000;
      const kmPercorrido = kmAtual - r.kmBase;
      const kmRestante = r.intervaloKm - kmPercorrido;
      const pct = Math.min(100, Math.max(0, (kmPercorrido / r.intervaloKm) * 100));
      const isAdmin = r.origem === 'ADMIN';

      let statusClass, statusLabel, fillClass, statusIcon;
      if (kmRestante > 50) {
        statusClass = 'status-ok'; statusLabel = 'Em dia'; fillClass = 'fill-ok'; statusIcon = 'fa-check-circle';
      } else if (kmRestante > 25) {
        statusClass = 'status-warn'; statusLabel = 'Atenção — ' + Math.round(kmRestante) + ' km restantes'; fillClass = 'fill-warn'; statusIcon = 'fa-exclamation-circle';
      } else if (kmRestante > 0) {
        statusClass = 'status-urgent'; statusLabel = 'Urgente — ' + Math.round(kmRestante) + ' km restantes'; fillClass = 'fill-urgent'; statusIcon = 'fa-exclamation-triangle';
      } else {
        statusClass = 'status-overdue'; statusLabel = 'Vencido — ' + Math.round(Math.abs(kmRestante)) + ' km além do limite'; fillClass = 'fill-overdue'; statusIcon = 'fa-times-circle';
      }

      return `
        <div class="man-rec-card">
          <div class="man-rec-top">
            <div class="man-rec-icon"><i class="fa fa-repeat"></i></div>
            <div class="man-rec-body">
              <div class="man-rec-title">
                ${_esc(r.titulo)}
                <span class="man-badge ${isAdmin ? 'man-badge-admin' : 'man-badge-cliente'}" style="margin-left:6px;">
                  <i class="fa ${isAdmin ? 'fa-shield' : 'fa-user'}" style="margin-right:3px;"></i>${isAdmin ? 'Admin' : 'Cliente'}
                </span>
              </div>
              <div class="man-rec-sub">
                A cada <strong>${r.intervaloKm.toLocaleString('pt-BR')} km</strong>
                ${r.descricao ? ' — ' + _esc(r.descricao) : ''}
              </div>
              <div class="man-progress-wrap">
                <div class="man-progress-bar-bg">
                  <div class="man-progress-bar-fill ${fillClass}" style="width:${pct}%"></div>
                </div>
                <div class="man-progress-info">
                  <span>${Math.round(kmPercorrido).toLocaleString('pt-BR')} km percorridos</span>
                  <span>${r.intervaloKm.toLocaleString('pt-BR')} km total</span>
                </div>
                <div class="man-status-badge ${statusClass}">
                  <i class="fa ${statusIcon}"></i>${statusLabel}
                </div>
              </div>
            </div>
            <div class="man-rec-actions">
              <button class="btn btn-success btn-sm" onclick="_abrirFeito('${r.id}', ${JSON.stringify(_esc(r.titulo))})">
                <i class="fa fa-check"></i> Feito
              </button>
              <button class="btn btn-info btn-xs" onclick="_editarRecorrencia('${r.id}')" title="Editar"><i class="fa fa-pencil"></i></button>
              <button class="btn btn-danger btn-xs" onclick="_confirmarExcluir('${r.id}','recorrencia')" title="Cancelar"><i class="fa fa-times"></i></button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Modais ────────────────────────────────────────────────────────────────────
  function abrirModalRegistro() {
    editandoRegistroId = null;
    atualizarVeiculoModal('registro');
    document.getElementById('modalRegistro-title').textContent = 'Registrar Manutenção';
    document.getElementById('btn-salvar-registro').innerHTML = '<i class="fa fa-save"></i> Salvar Registro';
    document.getElementById('reg-data').value = new Date().toISOString().slice(0, 10);
    $('#modalRegistro').modal('show');
  }

  async function _carregarCanaisRecorrencia() {
    if (!clienteLoginIdAtivo || !dispositivoIdAtivo) return;
    try {
      const data = await AL.apiGet('/api/notificacoes-admin/clientes/' + clienteLoginIdAtivo + '/preferencias/' + dispositivoIdAtivo);
      const manut = data?.preferencias?.manutencao || {};
      document.getElementById('rec-canal-web').checked = manut.web || false;
      document.getElementById('rec-canal-app').checked = manut.app || false;
      document.getElementById('rec-canal-email').checked = manut.email || false;
    } catch { /* mantém desmarcado */ }
  }

  function abrirModalRecorrencia() {
    editandoRecorrenciaId = null;
    atualizarVeiculoModal('recorrencia');
    document.getElementById('modalRecorrencia-title').textContent = 'Nova Recorrência de Manutenção';
    document.getElementById('btn-salvar-recorrencia').innerHTML = '<i class="fa fa-repeat"></i> Criar Recorrência';
    _carregarCanaisRecorrencia();
    $('#modalRecorrencia').modal('show');
  }

  window._abrirFeito = function (id, titulo) {
    recorrenciaFeitoId = id;
    document.getElementById('feito-titulo-label').textContent = titulo;
    $('#modalFeito').modal('show');
  };

  window._editarRegistro = function (id) {
    const r = registros.find(x => x.id === id);
    if (!r) return;
    editandoRegistroId = id;
    atualizarVeiculoModal('registro');
    document.getElementById('modalRegistro-title').textContent = 'Editar Manutenção';
    document.getElementById('btn-salvar-registro').innerHTML = '<i class="fa fa-save"></i> Salvar Alterações';
    document.getElementById('reg-titulo').value = r.titulo || '';
    document.getElementById('reg-tipo').value = r.tipo || 'preventiva';
    document.getElementById('reg-data').value = r.dataRealizacao ? new Date(r.dataRealizacao).toISOString().slice(0, 10) : '';
    document.getElementById('reg-km').value = r.kmRealizacao != null ? Math.round(r.kmRealizacao) : '';
    document.getElementById('reg-custo').value = r.custo != null ? parseFloat(r.custo).toFixed(2) : '';
    document.getElementById('reg-oficina').value = r.oficina || '';
    document.getElementById('reg-notas').value = r.notas || '';
    fotosPendentes = Array.isArray(r.fotos) ? [...r.fotos] : [];
    const el = document.getElementById('reg-fotos-preview');
    el.innerHTML = fotosPendentes.map((f, i) => `
      <div class="man-foto-preview-item">
        <img src="${f.dataUrl}" />
        <button class="btn-remove-foto" onclick="fotosPendentes.splice(${i},1);this.closest('.man-foto-preview-item').remove()">×</button>
      </div>
    `).join('');
    $('#modalRegistro').modal('show');
  };

  window._editarRecorrencia = function (id) {
    const r = recorrencias.find(x => x.id === id);
    if (!r) return;
    editandoRecorrenciaId = id;
    atualizarVeiculoModal('recorrencia');
    document.getElementById('modalRecorrencia-title').textContent = 'Editar Recorrência';
    document.getElementById('btn-salvar-recorrencia').innerHTML = '<i class="fa fa-save"></i> Salvar Alterações';
    document.getElementById('rec-titulo').value = r.titulo || '';
    document.getElementById('rec-intervalo').value = r.intervaloKm || '';
    document.getElementById('rec-descricao').value = r.descricao || '';
    _carregarCanaisRecorrencia();
    $('#modalRecorrencia').modal('show');
  };

  window._confirmarExcluir = function (id, tipo) {
    excluirId = id;
    excluirTipo = tipo;
    const msg = tipo === 'registro'
      ? 'Tem certeza que deseja excluir este registro de manutenção?'
      : 'Tem certeza que deseja cancelar esta recorrência? Os alertas automáticos serão interrompidos.';
    document.getElementById('excluir-msg').textContent = msg;
    $('#modalConfirmarExcluir').modal('show');
  };

  async function executarExcluir() {
    if (!excluirId || !excluirTipo) return;
    const btn = document.getElementById('btn-confirmar-excluir');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    try {
      if (excluirTipo === 'registro') {
        await AL.apiDelete('/api/manutencoes-admin/registros/' + excluirId);
        AL.showAlert('Registro excluído.', 'success');
      } else {
        await AL.apiDelete('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/recorrencias/' + excluirId);
        AL.showAlert('Recorrência cancelada.', 'success');
      }
      $('#modalConfirmarExcluir').modal('hide');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) {
      AL.showAlert('Erro: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Confirmar';
    }
  }

  function resetModalRegistro() {
    editandoRegistroId = null;
    ['reg-titulo','reg-data','reg-km','reg-custo','reg-oficina','reg-notas'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('reg-tipo').value = 'preventiva';
    fotosPendentes = [];
    document.getElementById('reg-fotos-preview').innerHTML = '';
  }

  function resetModalRecorrencia() {
    editandoRecorrenciaId = null;
    ['rec-titulo','rec-intervalo','rec-descricao'].forEach(id => {
      document.getElementById(id).value = '';
    });
    ['rec-canal-web', 'rec-canal-app', 'rec-canal-email'].forEach(id => {
      const el = document.getElementById(id); if (el) el.checked = false;
    });
  }

  // ── Salvar ────────────────────────────────────────────────────────────────────
  async function salvarRegistro() {
    const titulo = document.getElementById('reg-titulo').value.trim();
    const dataRealizacao = document.getElementById('reg-data').value;
    if (!titulo || !dataRealizacao) { AL.showAlert('Preencha o título e a data.'); return; }
    const btn = document.getElementById('btn-salvar-registro');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';
    const payload = {
      titulo,
      tipo: document.getElementById('reg-tipo').value,
      dataRealizacao,
      kmRealizacao: parseFloat(document.getElementById('reg-km').value) || null,
      custo: parseFloat(document.getElementById('reg-custo').value) || null,
      oficina: document.getElementById('reg-oficina').value.trim() || null,
      notas: document.getElementById('reg-notas').value.trim() || null,
      fotos: fotosPendentes,
    };
    try {
      if (editandoRegistroId) {
        await AL.apiPut('/api/manutencoes-admin/registros/' + editandoRegistroId, payload);
        AL.showAlert('Registro atualizado!', 'success');
      } else {
        await AL.apiPost('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/registros', { ...payload, dispositivoId: dispositivoIdAtivo });
        AL.showAlert('Registro salvo!', 'success');
      }
      $('#modalRegistro').modal('hide');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) {
      AL.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = editandoRegistroId ? '<i class="fa fa-save"></i> Salvar Alterações' : '<i class="fa fa-save"></i> Salvar Registro';
    }
  }

  async function salvarRecorrencia() {
    const titulo = document.getElementById('rec-titulo').value.trim();
    const intervaloKm = parseInt(document.getElementById('rec-intervalo').value);
    if (!titulo || !intervaloKm || intervaloKm < 100) {
      AL.showAlert('Preencha o título e um intervalo válido (mín. 100 km).');
      return;
    }
    const btn = document.getElementById('btn-salvar-recorrencia');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';
    const payload = {
      titulo,
      descricao: document.getElementById('rec-descricao').value.trim() || null,
      intervaloKm,
    };
    try {
      if (editandoRecorrenciaId) {
        await AL.apiPut('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/recorrencias/' + editandoRecorrenciaId, payload);
        AL.showAlert('Recorrência atualizada!', 'success');
      } else {
        await AL.apiPost('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/recorrencias', { ...payload, dispositivoId: dispositivoIdAtivo });
        AL.showAlert('Recorrência criada!', 'success');
      }
      // Salva preferência de canal de notificação para manutenções do cliente
      const web = document.getElementById('rec-canal-web').checked;
      const app = document.getElementById('rec-canal-app').checked;
      const email = document.getElementById('rec-canal-email').checked;
      await AL.apiPost('/api/notificacoes-admin/clientes/' + clienteLoginIdAtivo + '/preferencias', {
        dispositivoId: dispositivoIdAtivo,
        preferencias: { manutencao: { web, app, email } },
      }).catch(function() {}); // silencia erros da preferência
      $('#modalRecorrencia').modal('hide');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) {
      AL.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = editandoRecorrenciaId ? '<i class="fa fa-save"></i> Salvar Alterações' : '<i class="fa fa-repeat"></i> Criar Recorrência';
    }
  }

  async function confirmarFeito() {
    if (!recorrenciaFeitoId) return;
    const btn = document.getElementById('btn-confirmar-feito');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Confirmando...';
    try {
      await AL.apiPost('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/recorrencias/' + recorrenciaFeitoId + '/feito', {
        notas: document.getElementById('feito-notas').value.trim() || null,
      });
      AL.showAlert('Manutenção confirmada! Contador reiniciado.', 'success');
      $('#modalFeito').modal('hide');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) {
      AL.showAlert('Erro ao confirmar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-check"></i> Confirmar Realizado';
    }
  }

  // ── Bulk recorrência ──────────────────────────────────────────────────────────
  function renderBulkLista() {
    const el = document.getElementById('bulk-lista-clientes');
    el.innerHTML = clientes.map(c =>
      `<label class="man-bulk-item">
        <input type="checkbox" value="${c.id}" />
        <span>${_esc(c.nome)} <span style="color:#8a9ab0;font-size:11px;">${_esc(c.email)}</span></span>
      </label>`
    ).join('');
  }

  async function salvarBulk() {
    const selecionados = Array.from(
      document.querySelectorAll('#bulk-lista-clientes input[type=checkbox]:checked')
    ).map(cb => cb.value);
    const titulo = document.getElementById('bulk-titulo').value.trim();
    const intervaloKm = parseInt(document.getElementById('bulk-intervalo').value);
    if (!selecionados.length) { AL.showAlert('Selecione ao menos um cliente.'); return; }
    if (!titulo || !intervaloKm || intervaloKm < 100) {
      AL.showAlert('Preencha o título e um intervalo válido.');
      return;
    }
    const btn = document.getElementById('btn-salvar-bulk');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Criando...';
    try {
      const result = await AL.apiPost('/api/manutencoes-admin/bulk/recorrencias', {
        clienteLoginIds: selecionados,
        titulo,
        descricao: document.getElementById('bulk-descricao').value.trim() || null,
        intervaloKm,
      });
      AL.showAlert(result.message, 'success');
      $('#modalBulk').modal('hide');
      ['bulk-titulo','bulk-intervalo','bulk-descricao'].forEach(id => { document.getElementById(id).value = ''; });
    } catch (err) {
      AL.showAlert('Erro: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-users"></i> Criar para Selecionados';
    }
  }

  // ── Todos os registros ────────────────────────────────────────────────────────
  window.buscarTodosRegistros = async function () {
    const tipo = document.getElementById('g-filtro-tipo').value;
    const url = '/api/manutencoes-admin/todos/registros?page=' + gPage + '&limit=20' + (tipo ? '&tipo=' + tipo : '');
    try {
      const data = await AL.apiGet(url);
      const tbody = document.getElementById('g-tbody');
      const empty = document.getElementById('g-empty');
      const totalLabel = document.getElementById('g-total-label');
      totalLabel.textContent = data.total + ' registro(s) encontrado(s)';
      if (!data.registros.length) { tbody.innerHTML = ''; empty.style.display = 'flex'; renderPaginacao(0); return; }
      empty.style.display = 'none';
      tbody.innerHTML = data.registros.map(r => {
        const tipo = r.tipo || 'preventiva';
        const dataStr = new Date(r.dataRealizacao).toLocaleDateString('pt-BR');
        return `
          <tr>
            <td>${_esc(r.dispositivo?.nome || '—')}${r.dispositivo?.placa ? '<br><small style="color:#8a9ab0;">' + r.dispositivo.placa + '</small>' : ''}</td>
            <td>${_esc(r.clienteLogin?.cliente?.nome || '—')}<br><small style="color:#8a9ab0;">${_esc(r.clienteLogin?.email || '')}</small></td>
            <td>${_esc(r.titulo)}</td>
            <td><span class="man-badge man-badge-${tipo}">${TIPO_LABEL[tipo] || tipo}</span></td>
            <td>${dataStr}</td>
            <td>${r.kmRealizacao != null ? Math.round(r.kmRealizacao).toLocaleString('pt-BR') + ' km' : '—'}</td>
            <td><span class="man-badge ${r.origem === 'ADMIN' ? 'man-badge-admin' : 'man-badge-cliente'}">${r.origem}</span></td>
            <td><button class="btn btn-danger btn-xs" onclick="_excluirRegistroGeral('${r.id}')"><i class="fa fa-trash"></i></button></td>
          </tr>
        `;
      }).join('');
      renderPaginacao(data.total);
    } catch (err) {
      AL.showAlert('Erro ao buscar registros: ' + err.message);
    }
  };

  function renderPaginacao(total) {
    const pages = Math.ceil(total / 20);
    const el = document.getElementById('g-pagination');
    if (pages <= 1) { el.innerHTML = ''; return; }
    let html = '';
    for (let i = 1; i <= pages; i++) {
      html += `<button class="btn btn-${i === gPage ? 'primary' : 'default'} btn-sm" onclick="_irPagina(${i})">${i}</button>`;
    }
    el.innerHTML = html;
  }

  window._irPagina = function (page) { gPage = page; window.buscarTodosRegistros(); };

  window._excluirRegistroGeral = async function (id) {
    if (!confirm('Excluir este registro?')) return;
    try {
      await AL.apiDelete('/api/manutencoes-admin/registros/' + id);
      AL.showAlert('Registro excluído.', 'success');
      window.buscarTodosRegistros();
    } catch (err) { AL.showAlert('Erro: ' + err.message); }
  };

  window._toggleExtra = function (btn) {
    const card = btn.closest('.man-card');
    const extra = card.querySelector('.man-card-extra');
    if (!extra) return;
    const open = extra.style.display !== 'none';
    extra.style.display = open ? 'none' : 'block';
    btn.innerHTML = open ? '<i class="fa fa-chevron-down"></i>' : '<i class="fa fa-chevron-up"></i>';
  };

  // ── Fotos ─────────────────────────────────────────────────────────────────────
  function processarFotos(files, arr, previewId) {
    const MAX = 5; const MAX_SIZE = 2 * 1024 * 1024;
    if (arr.length >= MAX) { AL.showAlert('Máximo de 5 fotos.'); return; }
    Array.from(files).forEach(file => {
      if (arr.length >= MAX) return;
      if (file.size > MAX_SIZE) { AL.showAlert('Foto "' + file.name + '" excede 2 MB.'); return; }
      const reader = new FileReader();
      reader.onload = function (e) {
        arr.push({ nome: file.name, dataUrl: e.target.result });
        const el = document.getElementById(previewId);
        el.innerHTML = arr.map((f, i) => `
          <div class="man-foto-preview-item">
            <img src="${f.dataUrl}" />
            <button class="btn-remove-foto" onclick="fotosPendentes.splice(${i},1);this.closest('.man-foto-preview-item').remove()">×</button>
          </div>
        `).join('');
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────────
  window.abrirLightbox = function (src) {
    document.getElementById('man-lightbox-img').src = src;
    document.getElementById('man-lightbox').classList.add('open');
  };
  function fecharLightbox() {
    document.getElementById('man-lightbox').classList.remove('open');
    document.getElementById('man-lightbox-img').src = '';
  }

  // ── Utils ─────────────────────────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  init();
})();
