'use strict';

(function () {

  // ── Estado ────────────────────────────────────────────────────────────────────
  let clientes = [];
  let clienteLoginIdAtivo = null;
  let dispositivoIdAtivo = null;
  let registros = [];
  let recorrencias = [];
  let fotosPendentes = [];
  let recorrenciaFeitoId = null;
  let gPage = 1;

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
    } catch (err) {
      AL.showAlert('Erro ao carregar clientes: ' + err.message);
    }
  }

  async function carregarDispositivosCliente(loginId) {
    const sel = document.getElementById('filtro-dispositivo');
    sel.innerHTML = '<option value="">Carregando...</option>';
    document.getElementById('wrap-filtro-dispositivo').style.display = 'block';
    try {
      const data = await AL.apiGet('/api/manutencoes-admin/clientes/' + loginId + '/dispositivos');
      sel.innerHTML = '<option value="">Selecione um dispositivo...</option>' +
        (data || []).map(d => `<option value="${d.id}">${d.nome}${d.placa ? ' (' + d.placa + ')' : ''}</option>`).join('');
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
      document.getElementById('cliente-man-container').style.display = 'none';
      document.getElementById('cliente-man-vazio').style.display = 'flex';
      document.getElementById('wrap-acoes-cliente').style.display = id ? 'flex' : 'none';
      document.getElementById('btn-novo-registro').disabled = true;
      document.getElementById('btn-nova-recorrencia').disabled = true;
      if (!id) {
        document.getElementById('wrap-filtro-dispositivo').style.display = 'none';
        return;
      }
      const c = clientes.find(c => c.id === id);
      document.getElementById('c-nome-cliente').textContent = c ? c.nome : '—';
      carregarDispositivosCliente(id);
    });

    document.getElementById('filtro-dispositivo').addEventListener('change', function () {
      const id = this.value;
      dispositivoIdAtivo = id || null;
      document.getElementById('cliente-man-container').style.display = 'none';
      document.getElementById('cliente-man-vazio').style.display = id ? 'none' : 'flex';
      document.getElementById('btn-novo-registro').disabled = !id;
      document.getElementById('btn-nova-recorrencia').disabled = !id;
      if (!id) return;
      const opt = this.options[this.selectedIndex];
      document.getElementById('c-nome-dispositivo').textContent = opt ? opt.text : '—';
      document.getElementById('cliente-man-container').style.display = 'block';
      carregarDados(clienteLoginIdAtivo, id);
    });

    document.getElementById('btn-novo-registro').addEventListener('click', abrirModalRegistro);
    document.getElementById('btn-nova-recorrencia').addEventListener('click', abrirModalRecorrencia);
    document.getElementById('btn-bulk-recorrencia').addEventListener('click', function () { $('#modalBulk').modal('show'); });
    document.getElementById('btn-salvar-registro').addEventListener('click', salvarRegistro);
    document.getElementById('btn-salvar-recorrencia').addEventListener('click', salvarRecorrencia);
    document.getElementById('btn-confirmar-feito').addEventListener('click', confirmarFeito);
    document.getElementById('btn-salvar-bulk').addEventListener('click', salvarBulk);

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

    // Lightbox
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
              <button class="btn btn-danger btn-xs" onclick="_excluirRegistro('${r.id}')"><i class="fa fa-trash"></i></button>
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
      const kmRestante = r.kmBase + r.intervaloKm - kmAtual;
      return kmRestante <= 50;
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
              <button class="btn btn-danger btn-xs" onclick="_excluirRecorrencia('${r.id}')"><i class="fa fa-trash"></i></button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Modais ────────────────────────────────────────────────────────────────────
  function abrirModalRegistro() {
    document.getElementById('reg-data').value = new Date().toISOString().slice(0, 10);
    $('#modalRegistro').modal('show');
  }
  function abrirModalRecorrencia() { $('#modalRecorrencia').modal('show'); }

  window._abrirFeito = function (id, titulo) {
    recorrenciaFeitoId = id;
    document.getElementById('feito-titulo-label').textContent = titulo;
    $('#modalFeito').modal('show');
  };

  function resetModalRegistro() {
    ['reg-titulo','reg-data','reg-km','reg-custo','reg-oficina','reg-notas'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('reg-tipo').value = 'preventiva';
    fotosPendentes = [];
    document.getElementById('reg-fotos-preview').innerHTML = '';
  }

  function resetModalRecorrencia() {
    ['rec-titulo','rec-intervalo','rec-descricao'].forEach(id => {
      document.getElementById(id).value = '';
    });
  }

  // ── Salvar ────────────────────────────────────────────────────────────────────
  async function salvarRegistro() {
    const titulo = document.getElementById('reg-titulo').value.trim();
    const dataRealizacao = document.getElementById('reg-data').value;
    if (!titulo || !dataRealizacao) { AL.showAlert('Preencha o título e a data.'); return; }
    const btn = document.getElementById('btn-salvar-registro');
    btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';
    try {
      await AL.apiPost('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/registros', {
        dispositivoId: dispositivoIdAtivo,
        titulo,
        tipo: document.getElementById('reg-tipo').value,
        dataRealizacao,
        kmRealizacao: parseFloat(document.getElementById('reg-km').value) || null,
        custo: parseFloat(document.getElementById('reg-custo').value) || null,
        oficina: document.getElementById('reg-oficina').value.trim() || null,
        notas: document.getElementById('reg-notas').value.trim() || null,
        fotos: fotosPendentes,
      });
      AL.showAlert('Registro salvo com sucesso!', 'success');
      $('#modalRegistro').modal('hide');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) {
      AL.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-save"></i> Salvar Registro';
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
    btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';
    try {
      await AL.apiPost('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/recorrencias', {
        dispositivoId: dispositivoIdAtivo,
        titulo,
        descricao: document.getElementById('rec-descricao').value.trim() || null,
        intervaloKm,
      });
      AL.showAlert('Recorrência criada com sucesso!', 'success');
      $('#modalRecorrencia').modal('hide');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) {
      AL.showAlert('Erro ao criar: ' + err.message);
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-repeat"></i> Criar Recorrência';
    }
  }

  async function confirmarFeito() {
    if (!recorrenciaFeitoId) return;
    const btn = document.getElementById('btn-confirmar-feito');
    btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Confirmando...';
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
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-check"></i> Confirmar Realizado';
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
    btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Criando...';
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
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-users"></i> Criar para Selecionados';
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

  // ── Ações inline ──────────────────────────────────────────────────────────────
  window._excluirRegistro = async function (id) {
    if (!confirm('Excluir este registro?')) return;
    try {
      await AL.apiDelete('/api/manutencoes-admin/registros/' + id);
      AL.showAlert('Registro excluído.', 'success');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
    } catch (err) { AL.showAlert('Erro: ' + err.message); }
  };

  window._excluirRegistroGeral = async function (id) {
    if (!confirm('Excluir este registro?')) return;
    try {
      await AL.apiDelete('/api/manutencoes-admin/registros/' + id);
      AL.showAlert('Registro excluído.', 'success');
      window.buscarTodosRegistros();
    } catch (err) { AL.showAlert('Erro: ' + err.message); }
  };

  window._excluirRecorrencia = async function (id) {
    if (!confirm('Remover esta recorrência?')) return;
    try {
      await AL.apiDelete('/api/manutencoes-admin/clientes/' + clienteLoginIdAtivo + '/recorrencias/' + id);
      AL.showAlert('Recorrência removida.', 'success');
      carregarDados(clienteLoginIdAtivo, dispositivoIdAtivo);
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
