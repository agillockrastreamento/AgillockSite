'use strict';
(function () {
  var geocercas = [];

  function init() {
    bindEvents();
    carregar();
  }

  function bindEvents() {
    document.getElementById('filtro-busca').addEventListener('input', renderizar);
  }

  async function carregar() {
    try {
      geocercas = await AL_CLIENTE.apiGet('/api/cliente/rastreamento/geocercas');
      atualizarStats();
      renderizar();
    } catch (e) {
      document.getElementById('geo-loading').innerHTML =
        '<td colspan="6" style="text-align:center;padding:48px;color:#e74c3c;">' +
        '<i class="fa fa-exclamation-triangle" style="font-size:24px;display:block;margin-bottom:8px;opacity:.7"></i>' +
        'Erro ao carregar geocercas.</td>';
    }
  }

  function atualizarStats() {
    document.getElementById('stat-total').textContent = geocercas.length;
    document.getElementById('stat-ativas').textContent = geocercas.filter(function (g) { return g.ativa; }).length;
  }

  function renderizar() {
    var q = (document.getElementById('filtro-busca').value || '').toLowerCase();
    var lista = q ? geocercas.filter(function (g) { return g.nome.toLowerCase().indexOf(q) !== -1; }) : geocercas;
    var tbody = document.getElementById('geo-tbody');

    if (!lista.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:48px 16px;color:#aaa;">' +
        '<i class="fa fa-object-group" style="font-size:32px;display:block;margin-bottom:10px;opacity:.3"></i>' +
        (q ? 'Nenhum resultado para "' + esc(q) + '"' : 'Nenhuma geocerca cadastrada.<br><a href="geocercas-form.html" style="color:#fab32c;font-weight:600;">Criar primeira geocerca</a>') +
        '</td></tr>';
      return;
    }

    var TIPO = {
      circulo:  ['Círculo',  'geo-badge-circulo'],
      poligono: ['Polígono', 'geo-badge-poligono'],
      linha:    ['Linha',    'geo-badge-linha']
    };

    tbody.innerHTML = lista.map(function (g) {
      var tipoPair = TIPO[g.tipo] || [g.tipo || '?', 'geo-badge-circulo'];
      var qtd = g.dispositivos ? g.dispositivos.length : 0;
      var dispLabel = qtd === 0
        ? '<span style="color:#aaa">—</span>'
        : qtd + ' dispositivo' + (qtd > 1 ? 's' : '');
      var notifHtml = g.notificarCliente
        ? '<i class="fa fa-bell" style="color:#27ae60"></i> Sim'
        : '<i class="fa fa-bell-slash" style="color:#bbb"></i> <span style="color:#aaa">Não</span>';
      return '<tr>' +
        '<td><strong>' + esc(g.nome) + '</strong></td>' +
        '<td><span class="geo-badge ' + tipoPair[1] + '">' + tipoPair[0] + '</span></td>' +
        '<td>' + dispLabel + '</td>' +
        '<td>' + notifHtml + '</td>' +
        '<td><span class="status-badge ' + (g.ativa ? 'status-ativo' : 'status-inativo') + '">' + (g.ativa ? 'Ativa' : 'Suspensa') + '</span></td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-acao" onclick="location.href=\'geocercas-form.html?id=' + esc(g.id) + '\'">' +
            '<i class="fa fa-pencil"></i> Editar' +
          '</button>' +
          '<button class="btn-acao btn-suspender" data-id="' + esc(g.id) + '" data-ativa="' + (g.ativa ? 'true' : 'false') + '">' +
            '<i class="fa fa-' + (g.ativa ? 'pause' : 'play') + '"></i> ' + (g.ativa ? 'Suspender' : 'Ativar') +
          '</button>' +
          '<button class="btn-acao btn-acao-danger btn-excluir" data-id="' + esc(g.id) + '" data-nome="' + esc(g.nome) + '">' +
            '<i class="fa fa-trash"></i> Excluir' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.btn-suspender').forEach(function (btn) {
      btn.addEventListener('click', function () { suspender(btn.dataset.id, btn.dataset.ativa === 'true'); });
    });
    tbody.querySelectorAll('.btn-excluir').forEach(function (btn) {
      btn.addEventListener('click', function () { excluir(btn.dataset.id, btn.dataset.nome); });
    });
  }

  async function suspender(id, ativa) {
    var geo = geocercas.find(function (g) { return g.id === id; });
    if (!geo) return;
    try {
      await AL_CLIENTE.apiPut('/api/cliente/rastreamento/geocercas/' + id, { ativa: !ativa });
      geo.ativa = !ativa;
      atualizarStats();
      renderizar();
      AL_CLIENTE.showAlert((geo.ativa ? 'Geocerca ativada.' : 'Geocerca suspensa.'), 'success');
    } catch (e) {
      AL_CLIENTE.showAlert('Erro: ' + e.message, 'danger');
    }
  }

  async function excluir(id, nome) {
    if (!confirm('Excluir a geocerca "' + nome + '"?\nEsta ação não pode ser desfeita.')) return;
    try {
      await AL_CLIENTE.apiDelete('/api/cliente/rastreamento/geocercas/' + id);
      AL_CLIENTE.showAlert('Geocerca excluída.', 'success');
      geocercas = geocercas.filter(function (g) { return g.id !== id; });
      atualizarStats();
      renderizar();
    } catch (e) {
      AL_CLIENTE.showAlert('Erro: ' + e.message, 'danger');
    }
  }

  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
