'use strict';

(function () {

  // ── Estado ────────────────────────────────────────────────────────────────────
  let veiculos = [];
  let dispositivoIdAtivo = null;
  let registros = [];
  let recorrencias = [];
  let recorrenciasData = [];
  let fotosPendentes = [];
  let fotosFeitoPendentes = [];
  let editandoRegistroId = null;
  let editandoRecorrenciaId = null;
  let editandoRecDataId = null;
  let recorrenciaFeitoId = null;
  let recorrenciaDataFeitoId = null;
  let excluirId = null;
  let excluirTipo = null; // 'registro' | 'recorrencia' | 'recorrencia-data'

  function podeGerenciarManutencao() {
    const v = veiculos.find(v => v.dispositivoId === dispositivoIdAtivo);
    return !!(v && v.podeGerenciarManutencao);
  }

  function manutencaoAtiva() {
    const v = veiculos.find(v => v.dispositivoId === dispositivoIdAtivo);
    return !v || v.manutencaoAtiva !== false;
  }

  function textoVeiculoModal() {
    const v = veiculos.find(v => v.dispositivoId === dispositivoIdAtivo);
    if (!v) return '';
    return [v.nome, v.placa].filter(Boolean).join(' ');
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
      <button type="button" class="man-device-picker-btn" id="man-picker-dispositivo-btn"><span>Selecione um veículo...</span><i class="fa fa-chevron-down"></i></button>
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
    const filtrados = filtro ? veiculos.filter(v => normalizarPlacaBusca(v.nome + ' ' + v.placa).includes(filtro)) : veiculos;
    const label = document.querySelector('#man-picker-dispositivo-btn span');
    const opt = sel.options[sel.selectedIndex];
    if (label) label.textContent = opt && opt.value ? opt.text : 'Selecione um veículo...';
    const lista = document.getElementById('man-picker-dispositivo-lista');
    if (!lista) return;
    lista.innerHTML = filtrados.length ? filtrados.map(v => {
      const texto = v.nome + (v.placa ? ' (' + v.placa + ')' : '');
      return `<button type="button" class="man-device-picker-option${String(v.dispositivoId) === String(sel.value) ? ' active' : ''}" data-id="${v.dispositivoId}">${texto}</button>`;
    }).join('') : '<div class="man-device-picker-empty">Nenhum veículo encontrado.</div>';
    lista.querySelectorAll('.man-device-picker-option').forEach(btn => {
      btn.addEventListener('click', function () {
        sel.value = this.dataset.id;
        document.getElementById('man-picker-dispositivo').classList.remove('open');
        renderPickerDispositivo(document.getElementById('man-busca-placa-dispositivo')?.value || '');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  function aplicarPermissaoManutencao() {
    const pode = podeGerenciarManutencao();
    const ativa = manutencaoAtiva();
    const podeOperar = pode && ativa;
    const btnRegistro = document.getElementById('btn-novo-registro');
    const btnRecorrencia = document.getElementById('btn-nova-recorrencia');
    if (btnRegistro) {
      btnRegistro.disabled = !dispositivoIdAtivo || !podeOperar;
      btnRegistro.title = !ativa ? 'Manutenções desativadas para este veículo.' : (!pode ? 'Apenas o responsavel pelo faturamento pode registrar manutencoes.' : '');
    }
    if (btnRecorrencia) {
      btnRecorrencia.disabled = !dispositivoIdAtivo || !podeOperar;
      btnRecorrencia.title = !ativa ? 'Manutenções desativadas para este veículo.' : (!pode ? 'Apenas o responsavel pelo faturamento pode criar recorrencias.' : '');
    }
    const banner = document.getElementById('man-banner-desativado');
    if (banner) banner.classList.toggle('visivel', !!dispositivoIdAtivo && !ativa);

    // Se desativado: esconde todo o conteúdo, mostra só o banner
    const container = document.getElementById('man-container');
    if (container) container.style.display = (dispositivoIdAtivo && !ativa) ? 'none' : 'block';
  }

  const TIPO_ICON = {
    preventiva:'fa-shield', corretiva:'fa-wrench',
    revisao:'fa-search', personalizado:'fa-star',
  };
  const TIPO_LABEL = {
    preventiva:'Preventiva', corretiva:'Corretiva',
    revisao:'Revisão', personalizado:'Personalizado',
  };

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    await carregarVeiculos();
    bindEvents();
  }

  async function carregarVeiculos() {
    try {
      const data = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/posicoes');
      veiculos = data || [];
      const sel = document.getElementById('filtro-dispositivo');
      sel.innerHTML = '<option value="">Selecione um veículo...</option>' +
        veiculos.map(v =>
          `<option value="${v.dispositivoId}">${v.nome}${v.placa ? ' (' + v.placa + ')' : ''}</option>`
        ).join('');
      renderPickerDispositivo('');
    } catch (err) {
      console.error('Erro ao carregar veículos', err);
    }
  }

  function bindEvents() {
    document.getElementById('filtro-dispositivo').addEventListener('change', function () {
      const id = this.value;
      dispositivoIdAtivo = id || null;
      if (!id) {
        document.getElementById('man-container').style.display = 'none';
        document.getElementById('man-vazio').style.display = 'flex';
        document.getElementById('btn-novo-registro').disabled = true;
        document.getElementById('btn-nova-recorrencia').disabled = true;
        var bannerVazio = document.getElementById('man-banner-desativado');
        if (bannerVazio) bannerVazio.classList.remove('visivel');
        return;
      }
      aplicarPermissaoManutencao();
      document.getElementById('man-vazio').style.display = 'none';
      carregarDados(id);
      renderPickerDispositivo(document.getElementById('man-busca-placa-dispositivo')?.value || '');
    });

    document.getElementById('btn-novo-registro').addEventListener('click', abrirModalRegistro);
    document.getElementById('btn-nova-recorrencia').addEventListener('click', abrirModalRecorrencia);
    document.getElementById('btn-salvar-registro').addEventListener('click', salvarRegistro);
    document.getElementById('btn-salvar-recorrencia').addEventListener('click', salvarRecorrencia);
    document.getElementById('btn-confirmar-feito').addEventListener('click', confirmarFeito);
    document.getElementById('btn-confirmar-excluir').addEventListener('click', executarExcluir);
    document.getElementById('cbtn-salvar-recdata').addEventListener('click', _salvarRecDataCliente);
    document.getElementById('cbtn-confirmar-feito-data').addEventListener('click', _confirmarFeitoDataCliente);

    document.getElementById('reg-fotos-input').addEventListener('change', function () {
      processarFotos(this.files, fotosPendentes, 'reg-fotos-preview');
      this.value = '';
    });
    document.getElementById('feito-fotos-input').addEventListener('change', function () {
      processarFotos(this.files, fotosFeitoPendentes, 'feito-fotos-preview');
      this.value = '';
    });

    document.getElementById('man-lightbox-close').addEventListener('click', fecharLightbox);
    document.getElementById('man-lightbox').addEventListener('click', function (e) {
      if (e.target === this) fecharLightbox();
    });

    $('#modalRegistro').on('hidden.bs.modal', resetModalRegistro);
    $('#modalRecorrencia').on('hidden.bs.modal', resetModalRecorrencia);
    $('#modalFeito').on('hidden.bs.modal', resetModalFeito);
  }

  // ── Carregar dados ────────────────────────────────────────────────────────────
  async function carregarDados(dispositivoId) {
    try {
      const [regs, recs, recsData] = await Promise.all([
        AL_CLIENTE.apiGet('/api/cliente/manutencoes/registros?dispositivoId=' + dispositivoId),
        AL_CLIENTE.apiGet('/api/cliente/manutencoes/recorrencias?dispositivoId=' + dispositivoId),
        AL_CLIENTE.apiGet('/api/cliente/manutencoes/recorrencias-data?dispositivoId=' + dispositivoId),
      ]);
      registros = regs || [];
      recorrencias = recs || [];
      recorrenciasData = recsData || [];
      renderRegistros();
      renderRecorrencias();
      renderRecorrenciasData();
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao carregar manutenções.');
    }
  }

  // ── Render Histórico ──────────────────────────────────────────────────────────
  function renderRegistros() {
    const list = document.getElementById('list-registros');
    const empty = document.getElementById('empty-registros');
    if (!registros.length) { list.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';
    list.innerHTML = registros.map(r => {
      const tipo = r.tipo || 'preventiva';
      const icon = TIPO_ICON[tipo] || 'fa-wrench';
      const tipoLabel = TIPO_LABEL[tipo] || tipo;
      const dataStr = new Date(r.dataRealizacao).toLocaleDateString('pt-BR');
      const fotos = Array.isArray(r.fotos) ? r.fotos : [];
      const isAdmin = r.origem === 'ADMIN';
      const podeGerenciar = podeGerenciarManutencao();

      return `
        <div class="man-card" data-id="${r.id}">
          <div class="man-card-top">
            <div class="man-card-icon tipo-${tipo}"><i class="fa ${icon}"></i></div>
            <div class="man-card-body">
              <div class="man-card-title">
                ${_esc(r.titulo)}
                <span class="man-badge man-badge-${tipo}" style="margin-left:6px;">${tipoLabel}</span>
                ${isAdmin ? '<span class="man-badge man-badge-admin" style="margin-left:4px;"><i class="fa fa-shield" style="margin-right:3px;"></i>Admin</span>' : ''}
              </div>
              <div class="man-card-meta">
                <span><i class="fa fa-calendar"></i>${dataStr}</span>
                ${r.kmRealizacao != null ? `<span><i class="fa fa-road"></i>${Math.round(r.kmRealizacao).toLocaleString('pt-BR')} km</span>` : ''}
                ${r.oficina ? `<span><i class="fa fa-building-o"></i>${_esc(r.oficina)}</span>` : ''}
                ${r.custo != null ? `<span><i class="fa fa-money"></i>R$ ${parseFloat(r.custo).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>` : ''}
              </div>
            </div>
            <div class="man-card-actions">
              ${podeGerenciar && !isAdmin ? `<button class="btn btn-info btn-xs" onclick="_editarRegistro('${r.id}')" title="Editar"><i class="fa fa-pencil"></i></button>` : ''}
              ${podeGerenciar && !isAdmin ? `<button class="btn btn-danger btn-xs" onclick="_confirmarExcluir('${r.id}','registro')" title="Excluir"><i class="fa fa-trash"></i></button>` : ''}
              ${(r.notas || fotos.length) ? `<button class="btn btn-default btn-xs" onclick="_toggleExtra(this)" title="Ver mais"><i class="fa fa-chevron-down"></i></button>` : ''}
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
    const list = document.getElementById('list-recorrencias');
    const empty = document.getElementById('empty-recorrencias');
    const badge = document.getElementById('badge-rec');

    const urgentes = recorrencias.filter(r => {
      const kmAtual = (r.dispositivo?.odometroSistemaMetros ?? 0) / 1000;
      return r.intervaloKm - (kmAtual - r.kmBase) <= 50;
    }).length;
    if (urgentes > 0) { badge.textContent = urgentes; badge.style.display = ''; }
    else badge.style.display = 'none';

    if (!recorrencias.length) { list.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    list.innerHTML = recorrencias.map(r => {
      const kmAtual = (r.dispositivo?.odometroSistemaMetros ?? 0) / 1000;
      const kmPercorrido = kmAtual - r.kmBase;
      const kmRestante = r.intervaloKm - kmPercorrido;
      const pct = Math.min(100, Math.max(0, (kmPercorrido / r.intervaloKm) * 100));
      const isAdmin = r.origem === 'ADMIN';
      const podeGerenciar = podeGerenciarManutencao();

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
        <div class="man-rec-card" data-id="${r.id}">
          <div class="man-rec-top">
            <div class="man-rec-icon"><i class="fa fa-repeat"></i></div>
            <div class="man-rec-body">
              <div class="man-rec-title">
                ${_esc(r.titulo)}
                ${isAdmin ? '<span class="man-badge man-badge-admin" style="margin-left:6px;"><i class="fa fa-shield" style="margin-right:3px;"></i>Admin</span>' : ''}
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
              ${podeGerenciar ? `<button class="btn btn-success btn-sm" onclick="_abrirFeito('${r.id}', ${JSON.stringify(_esc(r.titulo))})">
                <i class="fa fa-check"></i> Feito
              </button>` : ''}
              ${podeGerenciar && !isAdmin ? `<button class="btn btn-info btn-xs" onclick="_editarRecorrencia('${r.id}')" title="Editar"><i class="fa fa-pencil"></i></button>` : ''}
              ${podeGerenciar && !isAdmin ? `<button class="btn btn-danger btn-xs" onclick="_confirmarExcluir('${r.id}','recorrencia')" title="Cancelar"><i class="fa fa-times"></i></button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────────
  function processarFotos(files, arr, previewId) {
    const MAX = 5, MAX_SIZE = 2 * 1024 * 1024;
    if (arr.length >= MAX) { AL_CLIENTE.showAlert('Máximo de 5 fotos.'); return; }
    Array.from(files).forEach(file => {
      if (arr.length >= MAX) return;
      if (file.size > MAX_SIZE) { AL_CLIENTE.showAlert('Foto "' + file.name + '" excede 2 MB.'); return; }
      const reader = new FileReader();
      reader.onload = function (e) {
        arr.push({ nome: file.name, dataUrl: e.target.result });
        renderFotoPreview(arr, previewId);
      };
      reader.readAsDataURL(file);
    });
  }

  function renderFotoPreview(arr, previewId) {
    const el = document.getElementById(previewId);
    el.innerHTML = arr.map((f, i) => `
      <div class="man-foto-preview-item">
        <img src="${f.dataUrl}" alt="${_esc(f.nome)}" />
        <button class="btn-remove-foto" onclick="_removeFoto(${i}, '${previewId}')">×</button>
      </div>
    `).join('');
  }

  window._removeFoto = function (idx, previewId) {
    const arr = previewId === 'reg-fotos-preview' ? fotosPendentes : fotosFeitoPendentes;
    arr.splice(idx, 1);
    renderFotoPreview(arr, previewId);
  };

  // ── Modais ────────────────────────────────────────────────────────────────────
  function abrirModalRegistro() { 
    if (!podeGerenciarManutencao()) { AL_CLIENTE.showAlert('Apenas o responsavel pelo faturamento pode registrar manutencoes deste dispositivo.', 'warning'); return; }
    editandoRegistroId = null;
    atualizarVeiculoModal('registro');
    document.getElementById('modalRegistro-title').textContent = 'Registrar Manutenção';
    document.getElementById('btn-salvar-registro').innerHTML = '<i class="fa fa-save"></i> Salvar Registro';
    const hoje = new Date().toISOString().slice(0, 10);
    document.getElementById('reg-data').value = hoje;
    const v = veiculos.find(v => v.dispositivoId === dispositivoIdAtivo);
    if (v && v.odometroSistemaMetros != null) {
      document.getElementById('reg-km').value = Math.round(v.odometroSistemaMetros / 1000);
    }
    $('#modalRegistro').modal('show');
  }

  async function _carregarCanaisRecorrencia() {
    if (!dispositivoIdAtivo) return;
    try {
      const data = await AL_CLIENTE.apiGet('/api/cliente/notificacoes/preferencias/' + dispositivoIdAtivo);
      const manut = data?.preferencias?.manutencao || {};
      document.getElementById('rec-canal-web').checked = manut.web || false;
      document.getElementById('rec-canal-app').checked = manut.app || false;
      document.getElementById('rec-canal-email').checked = manut.email || false;
    } catch { /* mantém desmarcado */ }
  }

  function abrirModalRecorrencia() {
    if (!podeGerenciarManutencao()) { AL_CLIENTE.showAlert('Apenas o responsavel pelo faturamento pode criar recorrencias deste dispositivo.', 'warning'); return; }
    editandoRecorrenciaId = null;
    atualizarVeiculoModal('recorrencia');
    document.getElementById('modalRecorrencia-title').textContent = 'Nova Recorrência de Manutenção';
    document.getElementById('btn-salvar-recorrencia').innerHTML = '<i class="fa fa-repeat"></i> Criar Recorrência';
    _carregarCanaisRecorrencia();
    $('#modalRecorrencia').modal('show');
  }

  window._editarRegistro = function (id) {
    if (!podeGerenciarManutencao()) return;
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
    renderFotoPreview(fotosPendentes, 'reg-fotos-preview');
    $('#modalRegistro').modal('show');
  };

  window._editarRecorrencia = function (id) {
    if (!podeGerenciarManutencao()) return;
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

  window._abrirFeito = function (id, titulo) {
    if (!podeGerenciarManutencao()) return;
    recorrenciaFeitoId = id;
    document.getElementById('feito-titulo-label').textContent = titulo;
    $('#modalFeito').modal('show');
  };

  window._confirmarExcluir = function (id, tipo) {
    if (!podeGerenciarManutencao()) return;
    excluirId = id;
    excluirTipo = tipo;
    let msg;
    if (tipo === 'registro') msg = 'Tem certeza que deseja excluir este registro de manutenção? Esta ação não pode ser desfeita.';
    else if (tipo === 'recorrencia-data') msg = 'Tem certeza que deseja cancelar esta recorrência por data? Os alertas serão interrompidos.';
    else msg = 'Tem certeza que deseja cancelar esta recorrência? Os alertas automáticos serão interrompidos.';
    document.getElementById('excluir-msg').textContent = msg;
    $('#modalConfirmarExcluir').modal('show');
  };

  // Alias para compatibilidade com as novas chamadas de recorrência-data
  window._confirmarExcluirC = window._confirmarExcluir;

  async function executarExcluir() {
    if (!excluirId || !excluirTipo) return;
    const btn = document.getElementById('btn-confirmar-excluir');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    try {
      if (excluirTipo === 'registro') {
        await AL_CLIENTE.apiDelete('/api/cliente/manutencoes/registros/' + excluirId);
        AL_CLIENTE.showAlert('Registro excluído.', 'success');
      } else if (excluirTipo === 'recorrencia-data') {
        await AL_CLIENTE.apiDelete('/api/cliente/manutencoes/recorrencias-data/' + excluirId);
        AL_CLIENTE.showAlert('Recorrência por data cancelada.', 'success');
      } else {
        await AL_CLIENTE.apiDelete('/api/cliente/manutencoes/recorrencias/' + excluirId);
        AL_CLIENTE.showAlert('Recorrência cancelada.', 'success');
      }
      $('#modalConfirmarExcluir').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao excluir: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Confirmar';
    }
  }

  function resetModalRegistro() {
    editandoRegistroId = null;
    ['reg-titulo', 'reg-data', 'reg-km', 'reg-custo', 'reg-oficina', 'reg-notas'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('reg-tipo').value = 'preventiva';
    fotosPendentes = [];
    document.getElementById('reg-fotos-preview').innerHTML = '';
  }

  function resetModalRecorrencia() {
    editandoRecorrenciaId = null;
    ['rec-titulo', 'rec-intervalo', 'rec-descricao'].forEach(id => {
      document.getElementById(id).value = '';
    });
    ['rec-canal-web', 'rec-canal-app', 'rec-canal-email'].forEach(id => {
      const el = document.getElementById(id); if (el) el.checked = false;
    });
  }

  function resetModalFeito() {
    recorrenciaFeitoId = null;
    document.getElementById('feito-notas').value = '';
    fotosFeitoPendentes = [];
    document.getElementById('feito-fotos-preview').innerHTML = '';
  }

  // ── Salvar ────────────────────────────────────────────────────────────────────
  async function salvarRegistro() {
    const titulo = document.getElementById('reg-titulo').value.trim();
    const dataRealizacao = document.getElementById('reg-data').value;
    if (!titulo || !dataRealizacao) { AL_CLIENTE.showAlert('Preencha o título e a data.'); return; }
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
        await AL_CLIENTE.apiPut('/api/cliente/manutencoes/registros/' + editandoRegistroId, payload);
        AL_CLIENTE.showAlert('Registro atualizado!', 'success');
      } else {
        await AL_CLIENTE.apiPost('/api/cliente/manutencoes/registros', { ...payload, dispositivoId: dispositivoIdAtivo });
        AL_CLIENTE.showAlert('Manutenção registrada!', 'success');
      }
      $('#modalRegistro').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = editandoRegistroId ? '<i class="fa fa-save"></i> Salvar Alterações' : '<i class="fa fa-save"></i> Salvar Registro';
    }
  }

  async function salvarRecorrencia() {
    const titulo = document.getElementById('rec-titulo').value.trim();
    const intervaloKm = parseInt(document.getElementById('rec-intervalo').value);
    if (!titulo || !intervaloKm || intervaloKm < 100) {
      AL_CLIENTE.showAlert('Preencha o título e um intervalo válido (mín. 100 km).');
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
        await AL_CLIENTE.apiPut('/api/cliente/manutencoes/recorrencias/' + editandoRecorrenciaId, payload);
        AL_CLIENTE.showAlert('Recorrência atualizada!', 'success');
      } else {
        await AL_CLIENTE.apiPost('/api/cliente/manutencoes/recorrencias', { ...payload, dispositivoId: dispositivoIdAtivo });
        AL_CLIENTE.showAlert('Recorrência criada! Você receberá alertas quando chegar ao limite.', 'success');
      }
      // Salva preferência de canal de notificação para manutenções
      const web = document.getElementById('rec-canal-web').checked;
      const app = document.getElementById('rec-canal-app').checked;
      const email = document.getElementById('rec-canal-email').checked;
      await AL_CLIENTE.apiPost('/api/cliente/notificacoes/preferencias', {
        dispositivoId: dispositivoIdAtivo,
        preferencias: { manutencao: { web, app, email } },
      }).catch(function() {}); // silencia erros da preferência
      $('#modalRecorrencia').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message);
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
      await AL_CLIENTE.apiPost('/api/cliente/manutencoes/recorrencias/' + recorrenciaFeitoId + '/feito', {
        notas: document.getElementById('feito-notas').value.trim() || null,
        fotos: fotosFeitoPendentes,
      });
      AL_CLIENTE.showAlert('Manutenção confirmada! Contador reiniciado.', 'success');
      $('#modalFeito').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao confirmar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-check"></i> Confirmar Realizado';
    }
  }

  // ── Toggle extra ──────────────────────────────────────────────────────────────
  window._toggleExtra = function (btn) {
    const card = btn.closest('.man-card');
    const extra = card.querySelector('.man-card-extra');
    if (!extra) return;
    const open = extra.style.display !== 'none';
    extra.style.display = open ? 'none' : 'block';
    btn.innerHTML = open ? '<i class="fa fa-chevron-down"></i>' : '<i class="fa fa-chevron-up"></i>';
  };

  // ── Lightbox ──────────────────────────────────────────────────────────────────
  window.abrirLightbox = function (src) {
    document.getElementById('man-lightbox-img').src = src;
    document.getElementById('man-lightbox').classList.add('open');
  };
  function fecharLightbox() {
    document.getElementById('man-lightbox').classList.remove('open');
    document.getElementById('man-lightbox-img').src = '';
  }

  // ── Recorrências por Data (Cliente) ──────────────────────────────────────────

  const DIAS_SEMANA_C = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const MESES_C = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const TIPO_REC_LABELS_C = { AVULSA:'Avulsa', INTERVALO:'Intervalo', SEMANAL:'Semanal', MENSAL:'Mensal', ANUAL:'Anual' };

  function _labelRecDataC(r) {
    switch (r.tipoRecorrencia) {
      case 'AVULSA': return 'Data única';
      case 'INTERVALO': return 'A cada ' + r.intervaloDias + ' dias';
      case 'SEMANAL': return 'Semanal: ' + (Array.isArray(r.diasSemana) ? r.diasSemana.map(d => DIAS_SEMANA_C[d]).join(', ') : '—');
      case 'MENSAL': return 'Todo dia ' + r.diaDoMes + ' do mês';
      case 'ANUAL': return 'Todo ' + r.diaDoMes + '/' + MESES_C[r.mesDoAno];
      default: return r.tipoRecorrencia;
    }
  }

  function _diffDiasC(dataStr) {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const data = new Date(dataStr); data.setHours(0,0,0,0);
    return Math.ceil((data - hoje) / 86400000);
  }

  function renderRecorrenciasData() {
    const list = document.getElementById('list-recorrencias-data');
    const empty = document.getElementById('empty-recorrencias-data');
    const badge = document.getElementById('badge-rec-data');
    if (!list) return;

    const urgentes = recorrenciasData.filter(r => _diffDiasC(r.dataReferencia) <= 2).length;
    if (badge) { badge.textContent = urgentes; badge.style.display = urgentes > 0 ? '' : 'none'; }

    if (!recorrenciasData.length) { list.innerHTML = ''; if (empty) empty.style.display = 'flex'; return; }
    if (empty) empty.style.display = 'none';

    const podGer = podeGerenciarManutencao();

    list.innerHTML = recorrenciasData.map(r => {
      const diff = _diffDiasC(r.dataReferencia);
      const dataStr = new Date(r.dataReferencia).toLocaleDateString('pt-BR');
      const isAdmin = r.origem === 'ADMIN';

      let statusClass, statusLabel, statusIcon, borderColor;
      if (diff > 4) {
        statusClass = 'status-ok'; statusLabel = 'Em ' + diff + ' dias — ' + dataStr; statusIcon = 'fa-calendar-o'; borderColor = '#27ae60';
      } else if (diff > 2) {
        statusClass = 'status-warn'; statusLabel = 'Em breve — ' + diff + ' dias (' + dataStr + ')'; statusIcon = 'fa-calendar-check-o'; borderColor = '#e67e22';
      } else if (diff >= 0) {
        statusClass = 'status-urgent'; statusLabel = diff === 0 ? 'Hoje!' : 'Amanhã!'; statusIcon = 'fa-exclamation-circle'; borderColor = '#e74c3c';
      } else {
        statusClass = 'status-overdue'; statusLabel = 'Pendente — ' + Math.abs(diff) + ' dia(s) atrás'; statusIcon = 'fa-times-circle'; borderColor = '#c0392b';
      }

      const podeMexer = podGer;
      const podeEditar = podGer && r.origem !== 'ADMIN';

      return `
        <div class="man-rec-card" style="border-left:4px solid ${borderColor};">
          <div class="man-rec-top">
            <div class="man-rec-icon" style="background:rgba(142,68,173,.12);color:#8e44ad;"><i class="fa fa-calendar"></i></div>
            <div class="man-rec-body">
              <div class="man-rec-title">
                ${_esc(r.titulo)}
                ${isAdmin ? '<span class="man-badge man-badge-admin" style="margin-left:6px;"><i class="fa fa-shield" style="margin-right:3px;"></i>Admin</span>' : ''}
                <span style="font-size:10px;background:rgba(142,68,173,.1);color:#8e44ad;padding:2px 7px;border-radius:10px;margin-left:4px;">${TIPO_REC_LABELS_C[r.tipoRecorrencia]||r.tipoRecorrencia}</span>
              </div>
              <div class="man-rec-sub">${_labelRecDataC(r)}${r.descricao ? ' — ' + _esc(r.descricao) : ''}</div>
              <div class="man-status-badge ${statusClass}" style="margin-top:6px;">
                <i class="fa ${statusIcon}"></i>${statusLabel}
              </div>
              ${r.ciclosCompletos > 0 ? `<small style="color:#8a9ab0;margin-top:4px;display:block;"><i class="fa fa-check"></i> ${r.ciclosCompletos} ciclo(s) concluído(s)</small>` : ''}
            </div>
            <div class="man-rec-actions">
              ${podeMexer ? `<button class="btn btn-sm" onclick="_abrirFeitoData('${r.id}','${_esc(r.titulo)}')" style="background:#8e44ad;color:#fff;font-weight:700;border-radius:7px;"><i class="fa fa-check"></i> Feito</button>` : ''}
              ${podeEditar ? `<button class="btn btn-info btn-xs" onclick="_editarRecurrenciaData('${r.id}')" title="Editar"><i class="fa fa-pencil"></i></button>` : ''}
              ${podeEditar ? `<button class="btn btn-danger btn-xs" onclick="_confirmarExcluirC('${r.id}','recorrencia-data')" title="Cancelar"><i class="fa fa-times"></i></button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.cAtualizarCamposRecData = function () {
    const tipo = document.getElementById('crecdata-tipo').value;
    document.getElementById('crecdata-campo-data').style.display = tipo === 'AVULSA' ? '' : 'none';
    document.getElementById('crecdata-campo-intervalo').style.display = tipo === 'INTERVALO' ? '' : 'none';
    document.getElementById('crecdata-campo-semanal').style.display = tipo === 'SEMANAL' ? '' : 'none';
    document.getElementById('crecdata-campo-mensal').style.display = tipo === 'MENSAL' ? '' : 'none';
    document.getElementById('crecdata-campo-anual').style.display = tipo === 'ANUAL' ? '' : 'none';
  };

  window.abrirModalNovaRecurrenciaData = function () {
    if (!podeGerenciarManutencao()) { AL_CLIENTE.showAlert('Apenas o responsável pelo faturamento pode criar recorrências.', 'warning'); return; }
    editandoRecDataId = null;
    document.getElementById('cmodalRecData-title').textContent = 'Nova Recorrência por Data';
    document.getElementById('cbtn-salvar-recdata-label').textContent = 'Criar Recorrência';
    ['crecdata-titulo','crecdata-descricao'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('crecdata-tipo').value = 'AVULSA';
    document.getElementById('crecdata-canal').value = 'todos';
    document.querySelectorAll('.crecdata-dia-semana').forEach(cb => { cb.checked = false; });
    cAtualizarCamposRecData();
    $('#modalRecorrenciaData').modal('show');
  };

  window._editarRecurrenciaData = function (id) {
    const r = recorrenciasData.find(x => x.id === id);
    if (!r) return;
    editandoRecDataId = id;
    document.getElementById('cmodalRecData-title').textContent = 'Editar Recorrência por Data';
    document.getElementById('cbtn-salvar-recdata-label').textContent = 'Salvar Alterações';
    document.getElementById('crecdata-titulo').value = r.titulo || '';
    document.getElementById('crecdata-descricao').value = r.descricao || '';
    document.getElementById('crecdata-tipo').value = r.tipoRecorrencia || 'AVULSA';
    document.getElementById('crecdata-data').value = r.dataReferencia ? new Date(r.dataReferencia).toISOString().slice(0,10) : '';
    document.getElementById('crecdata-canal').value = r.canalNotificacao || 'todos';
    if (r.intervaloDias) document.getElementById('crecdata-intervalo-dias').value = r.intervaloDias;
    if (r.diaDoMes) { document.getElementById('crecdata-dia-mes').value = r.diaDoMes; document.getElementById('crecdata-dia-anual').value = r.diaDoMes; }
    if (r.mesDoAno) document.getElementById('crecdata-mes-ano').value = r.mesDoAno;
    if (Array.isArray(r.diasSemana)) {
      document.querySelectorAll('.crecdata-dia-semana').forEach(cb => { cb.checked = r.diasSemana.includes(parseInt(cb.value)); });
    }
    cAtualizarCamposRecData();
    $('#modalRecorrenciaData').modal('show');
  };

  window._abrirFeitoData = function (id, titulo) {
    recorrenciaDataFeitoId = id;
    document.getElementById('cfeito-data-msg').textContent = 'Confirmar que "' + titulo + '" foi realizado?';
    document.getElementById('cfeito-data-notas').value = '';
    $('#modalFeitoData').modal('show');
  };

  async function _salvarRecDataCliente() {
    const titulo = document.getElementById('crecdata-titulo').value.trim();
    const tipo = document.getElementById('crecdata-tipo').value;
    if (!titulo) { AL_CLIENTE.showAlert('Preencha o título.'); return; }

    let dataReferencia, intervaloDias = null, diasSemana = null, diaDoMes = null, mesDoAno = null;

    if (tipo === 'AVULSA') {
      dataReferencia = document.getElementById('crecdata-data').value;
      if (!dataReferencia) { AL_CLIENTE.showAlert('Informe a data.'); return; }
    } else if (tipo === 'INTERVALO') {
      intervaloDias = parseInt(document.getElementById('crecdata-intervalo-dias').value);
      dataReferencia = document.getElementById('crecdata-intervalo-inicio').value;
      if (!intervaloDias || !dataReferencia) { AL_CLIENTE.showAlert('Informe o intervalo e a data de início.'); return; }
    } else if (tipo === 'SEMANAL') {
      diasSemana = Array.from(document.querySelectorAll('.crecdata-dia-semana:checked')).map(cb => parseInt(cb.value));
      dataReferencia = document.getElementById('crecdata-semanal-inicio').value;
      if (!diasSemana.length || !dataReferencia) { AL_CLIENTE.showAlert('Selecione ao menos um dia e a data de início.'); return; }
    } else if (tipo === 'MENSAL') {
      diaDoMes = parseInt(document.getElementById('crecdata-dia-mes').value);
      if (!diaDoMes || diaDoMes < 1 || diaDoMes > 31) { AL_CLIENTE.showAlert('Informe um dia válido.'); return; }
      const hoje = new Date();
      const d = diaDoMes <= hoje.getDate() ? new Date(hoje.getFullYear(), hoje.getMonth() + 1, diaDoMes) : new Date(hoje.getFullYear(), hoje.getMonth(), diaDoMes);
      dataReferencia = d.toISOString().slice(0,10);
    } else if (tipo === 'ANUAL') {
      diaDoMes = parseInt(document.getElementById('crecdata-dia-anual').value);
      mesDoAno = parseInt(document.getElementById('crecdata-mes-ano').value);
      if (!diaDoMes || !mesDoAno) { AL_CLIENTE.showAlert('Informe o dia e mês.'); return; }
      const hoje = new Date();
      let ano = hoje.getFullYear();
      if (new Date(ano, mesDoAno - 1, diaDoMes) <= hoje) ano++;
      dataReferencia = new Date(ano, mesDoAno - 1, diaDoMes).toISOString().slice(0,10);
    }

    const payload = { dispositivoId: dispositivoIdAtivo, titulo, descricao: document.getElementById('crecdata-descricao').value.trim() || null, tipoRecorrencia: tipo, dataReferencia, intervaloDias, diasSemana, diaDoMes, mesDoAno, canalNotificacao: document.getElementById('crecdata-canal').value };

    const btn = document.getElementById('cbtn-salvar-recdata');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    try {
      if (editandoRecDataId) {
        await AL_CLIENTE.apiPut('/api/cliente/manutencoes/recorrencias-data/' + editandoRecDataId, payload);
        AL_CLIENTE.showAlert('Recorrência atualizada!', 'success');
      } else {
        await AL_CLIENTE.apiPost('/api/cliente/manutencoes/recorrencias-data', payload);
        AL_CLIENTE.showAlert('Recorrência por data criada!', 'success');
      }
      $('#modalRecorrenciaData').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-calendar-check-o"></i> ' + document.getElementById('cbtn-salvar-recdata-label').textContent;
    }
  }

  async function _confirmarFeitoDataCliente() {
    if (!recorrenciaDataFeitoId) return;
    const btn = document.getElementById('cbtn-confirmar-feito-data');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    try {
      const result = await AL_CLIENTE.apiPost('/api/cliente/manutencoes/recorrencias-data/' + recorrenciaDataFeitoId + '/feito', {
        notas: document.getElementById('cfeito-data-notas').value.trim() || null,
      });
      AL_CLIENTE.showAlert('Confirmado!' + (result.proximaData ? ' Próxima: ' + new Date(result.proximaData).toLocaleDateString('pt-BR') : ''), 'success');
      $('#modalFeitoData').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-check"></i> Confirmar';
    }
  }

  // ── Utils ─────────────────────────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  init();
})();
