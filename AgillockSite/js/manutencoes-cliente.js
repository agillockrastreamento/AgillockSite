'use strict';

(function () {

  // ── Estado ────────────────────────────────────────────────────────────────────
  let veiculos = [];
  let dispositivoIdAtivo = null;
  let registros = [];
  let recorrencias = [];
  let fotosPendentes = []; // { nome, dataUrl } para modal de registro
  let fotosFeitoPendentes = []; // para modal de feito
  let recorrenciaFeitoId = null;

  const TIPO_ICON = {
    preventiva:   'fa-shield',
    corretiva:    'fa-wrench',
    revisao:      'fa-search',
    personalizado:'fa-star',
  };
  const TIPO_LABEL = {
    preventiva:   'Preventiva',
    corretiva:    'Corretiva',
    revisao:      'Revisão',
    personalizado:'Personalizado',
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
        return;
      }
      document.getElementById('btn-novo-registro').disabled = false;
      document.getElementById('btn-nova-recorrencia').disabled = false;
      document.getElementById('man-vazio').style.display = 'none';
      document.getElementById('man-container').style.display = 'block';
      carregarDados(id);
    });

    // Botões de abrir modal
    document.getElementById('btn-novo-registro').addEventListener('click', abrirModalRegistro);
    document.getElementById('btn-nova-recorrencia').addEventListener('click', abrirModalRecorrencia);

    // Salvar registro
    document.getElementById('btn-salvar-registro').addEventListener('click', salvarRegistro);

    // Salvar recorrência
    document.getElementById('btn-salvar-recorrencia').addEventListener('click', salvarRecorrencia);

    // Confirmar feito
    document.getElementById('btn-confirmar-feito').addEventListener('click', confirmarFeito);

    // Fotos no modal de registro
    document.getElementById('reg-fotos-input').addEventListener('change', function () {
      processarFotos(this.files, fotosPendentes, 'reg-fotos-preview');
      this.value = '';
    });

    // Fotos no modal de feito
    document.getElementById('feito-fotos-input').addEventListener('change', function () {
      processarFotos(this.files, fotosFeitoPendentes, 'feito-fotos-preview');
      this.value = '';
    });

    // Lightbox
    document.getElementById('man-lightbox-close').addEventListener('click', fecharLightbox);
    document.getElementById('man-lightbox').addEventListener('click', function (e) {
      if (e.target === this) fecharLightbox();
    });

    // Reset modais ao fechar
    $('#modalRegistro').on('hidden.bs.modal', resetModalRegistro);
    $('#modalRecorrencia').on('hidden.bs.modal', resetModalRecorrencia);
    $('#modalFeito').on('hidden.bs.modal', resetModalFeito);
  }

  // ── Carregar dados ────────────────────────────────────────────────────────────
  async function carregarDados(dispositivoId) {
    try {
      const [regs, recs] = await Promise.all([
        AL_CLIENTE.apiGet('/api/cliente/manutencoes/registros?dispositivoId=' + dispositivoId),
        AL_CLIENTE.apiGet('/api/cliente/manutencoes/recorrencias?dispositivoId=' + dispositivoId),
      ]);
      registros = regs || [];
      recorrencias = recs || [];
      renderRegistros();
      renderRecorrencias();
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao carregar manutenções.');
    }
  }

  // ── Render Histórico ──────────────────────────────────────────────────────────
  function renderRegistros() {
    const list = document.getElementById('list-registros');
    const empty = document.getElementById('empty-registros');
    if (!registros.length) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = registros.map(r => {
      const tipo = r.tipo || 'preventiva';
      const icon = TIPO_ICON[tipo] || 'fa-wrench';
      const tipoLabel = TIPO_LABEL[tipo] || tipo;
      const dataStr = new Date(r.dataRealizacao).toLocaleDateString('pt-BR');
      const fotos = Array.isArray(r.fotos) ? r.fotos : [];
      const isAdmin = r.origem === 'ADMIN';

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
              ${!isAdmin ? `<button class="btn btn-danger btn-xs" onclick="_excluirRegistro('${r.id}')"><i class="fa fa-trash"></i></button>` : ''}
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
    const list = document.getElementById('list-recorrencias');
    const empty = document.getElementById('empty-recorrencias');
    const badge = document.getElementById('badge-rec');

    // Count alertas
    const urgentes = recorrencias.filter(r => {
      const kmAtual = (r.dispositivo?.odometroSistemaMetros ?? 0) / 1000;
      const kmRestante = r.kmBase + r.intervaloKm - kmAtual;
      return kmRestante <= 50;
    }).length;

    if (urgentes > 0) { badge.textContent = urgentes; badge.style.display = ''; }
    else badge.style.display = 'none';

    if (!recorrencias.length) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
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
                ${r.dispositivo ? ` · ${_esc(r.dispositivo.nome)}${r.dispositivo.placa ? ' (' + r.dispositivo.placa + ')' : ''}` : ''}
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
              ${!isAdmin ? `<button class="btn btn-danger btn-xs" onclick="_excluirRecorrencia('${r.id}')"><i class="fa fa-trash"></i></button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────────
  function processarFotos(files, arr, previewId) {
    const MAX = 5;
    const MAX_SIZE = 2 * 1024 * 1024;
    if (arr.length >= MAX) {
      AL_CLIENTE.showAlert('Máximo de ' + MAX + ' fotos permitido.');
      return;
    }
    Array.from(files).forEach(file => {
      if (arr.length >= MAX) return;
      if (file.size > MAX_SIZE) {
        AL_CLIENTE.showAlert('Foto "' + file.name + '" excede 2 MB.');
        return;
      }
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
    const hoje = new Date().toISOString().slice(0, 10);
    document.getElementById('reg-data').value = hoje;
    const v = veiculos.find(v => v.dispositivoId === dispositivoIdAtivo);
    if (v && v.odometroSistemaMetros != null) {
      document.getElementById('reg-km').value = Math.round(v.odometroSistemaMetros / 1000);
    }
    $('#modalRegistro').modal('show');
  }

  function abrirModalRecorrencia() {
    $('#modalRecorrencia').modal('show');
  }

  window._abrirFeito = function (id, titulo) {
    recorrenciaFeitoId = id;
    document.getElementById('feito-titulo-label').textContent = titulo;
    $('#modalFeito').modal('show');
  };

  function resetModalRegistro() {
    ['reg-titulo', 'reg-data', 'reg-km', 'reg-custo', 'reg-oficina', 'reg-notas'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('reg-tipo').value = 'preventiva';
    fotosPendentes = [];
    document.getElementById('reg-fotos-preview').innerHTML = '';
  }

  function resetModalRecorrencia() {
    ['rec-titulo', 'rec-intervalo', 'rec-descricao'].forEach(id => {
      document.getElementById(id).value = '';
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
    if (!titulo || !dataRealizacao) {
      AL_CLIENTE.showAlert('Preencha o título e a data.');
      return;
    }
    const btn = document.getElementById('btn-salvar-registro');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...';
    try {
      await AL_CLIENTE.apiPost('/api/cliente/manutencoes/registros', {
        dispositivoId: dispositivoIdAtivo,
        titulo,
        tipo: document.getElementById('reg-tipo').value,
        descricao: null,
        dataRealizacao,
        kmRealizacao: parseFloat(document.getElementById('reg-km').value) || null,
        custo: parseFloat(document.getElementById('reg-custo').value) || null,
        oficina: document.getElementById('reg-oficina').value.trim() || null,
        notas: document.getElementById('reg-notas').value.trim() || null,
        fotos: fotosPendentes,
      });
      AL_CLIENTE.showAlert('Manutenção registrada com sucesso!', 'success');
      $('#modalRegistro').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao salvar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-save"></i> Salvar Registro';
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
    try {
      await AL_CLIENTE.apiPost('/api/cliente/manutencoes/recorrencias', {
        dispositivoId: dispositivoIdAtivo,
        titulo,
        descricao: document.getElementById('rec-descricao').value.trim() || null,
        intervaloKm,
      });
      AL_CLIENTE.showAlert('Recorrência criada! Você receberá alertas quando chegar ao limite.', 'success');
      $('#modalRecorrencia').modal('hide');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao criar: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-repeat"></i> Criar Recorrência';
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

  // ── Ações inline ──────────────────────────────────────────────────────────────
  window._excluirRegistro = async function (id) {
    if (!confirm('Excluir este registro de manutenção?')) return;
    try {
      await AL_CLIENTE.apiDelete('/api/cliente/manutencoes/registros/' + id);
      AL_CLIENTE.showAlert('Registro excluído.', 'success');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao excluir: ' + err.message);
    }
  };

  window._excluirRecorrencia = async function (id) {
    if (!confirm('Remover esta recorrência?')) return;
    try {
      await AL_CLIENTE.apiDelete('/api/cliente/manutencoes/recorrencias/' + id);
      AL_CLIENTE.showAlert('Recorrência removida.', 'success');
      carregarDados(dispositivoIdAtivo);
    } catch (err) {
      AL_CLIENTE.showAlert('Erro ao remover: ' + err.message);
    }
  };

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

  // ── Utilitários ───────────────────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  init();
})();
