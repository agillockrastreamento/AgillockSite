'use strict';

(function () {
  var STORAGE_KEY = 'al_rastr_bar_aberta';
  var _veiculosGlobal = null;
  var _veiculosCarregando = false;
  var _isRastrPage = /rastreamento\.html/.test(window.location.pathname);

  // ── Injeção imediata — roda antes do DOMContentLoaded ─────────────────────
  // O script fica no final do <body> (depois do HTML já parseado), então injeta
  // diretamente sem esperar DOMContentLoaded.
  if (document.getElementById('al-rastr-bar')) return; // proteção contra dupla injeção
  document.documentElement.classList.add('al-rastr-ativa');

  var bar = document.createElement('div');
  bar.id = 'al-rastr-bar';
  bar.innerHTML =
    '<button type="button" id="al-rastr-menu-btn" title="Menu"><i class="fa fa-bars"></i></button>' +
    '<div id="topbar-busca-wrap">' +
      '<input type="text" id="filtro" class="form-control" autocomplete="off"' +
      ' placeholder="Buscar veículo, placa, IMEI ou cliente...">' +
      '<div id="lista-resultados-busca" style="display:none"></div>' +
    '</div>' +
    '<div id="topbar-counters"></div>';
  document.body.insertBefore(bar, document.body.firstChild);

  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'topbar-busca-toggle';
  toggle.title = 'Mostrar/ocultar barra de rastreamento';
  toggle.innerHTML = '<i class="fa fa-chevron-up"></i>';
  document.body.appendChild(toggle);

  // ── Estado inicial ─────────────────────────────────────────────────────────
  var aberta = true;
  try { if (localStorage.getItem(STORAGE_KEY) === '0') aberta = false; } catch {}
  _aplicarEstado(aberta, false);

  // ── Eventos ────────────────────────────────────────────────────────────────
  toggle.addEventListener('click', function () {
    _aplicarEstado(document.documentElement.classList.contains('rastr-bar-fechada'));
  });

  document.getElementById('al-rastr-menu-btn').addEventListener('click', function () {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open');
  });

  var filtroEl = document.getElementById('filtro');
  // Na página de rastreamento, rastreamento.js faz o próprio binding; nas outras, usamos aqui.
  if (!_isRastrPage) {
    filtroEl.addEventListener('input', function () { _buscarGlobal(this.value); });
    _iniciarContadores();
  }

  document.addEventListener('click', function (e) {
    var wrap = document.getElementById('topbar-busca-wrap');
    if (wrap && !wrap.contains(e.target)) {
      var lista = document.getElementById('lista-resultados-busca');
      if (lista) lista.style.display = 'none';
    }
  });

  // ── Lógica ─────────────────────────────────────────────────────────────────

  function _aplicarEstado(novaAberta, salvar) {
    document.documentElement.classList.toggle('rastr-bar-fechada', !novaAberta);
    var btn = document.getElementById('topbar-busca-toggle');
    if (btn) btn.querySelector('i').className = novaAberta ? 'fa fa-chevron-up' : 'fa fa-chevron-down';
    if (salvar !== false) {
      try { localStorage.setItem(STORAGE_KEY, novaAberta ? '1' : '0'); } catch {}
    }
    if (_isRastrPage && window.map) {
      setTimeout(function () { window.map.invalidateSize(); }, 230);
    }
  }

  async function _carregarVeiculos() {
    if (_veiculosGlobal) return _veiculosGlobal;
    if (_veiculosCarregando) return null;
    _veiculosCarregando = true;
    try {
      _veiculosGlobal = await window.AL.apiGet('/api/rastreamento/posicoes');
      return _veiculosGlobal;
    } catch {
      return null;
    } finally {
      _veiculosCarregando = false;
    }
  }

  async function _buscarGlobal(query) {
    var el = document.getElementById('lista-resultados-busca');
    if (!el) return;
    var q = (query || '').toLowerCase().trim();
    if (!q) { el.style.display = 'none'; el.innerHTML = ''; return; }

    el.innerHTML = '<div style="padding:10px;text-align:center;color:#aaa;font-size:12px">' +
      '<i class="fa fa-spinner fa-spin"></i></div>';
    el.style.display = 'block';

    var lista = await _carregarVeiculos();
    if (!lista) {
      el.innerHTML = '<div style="padding:10px;text-align:center;color:#e74c3c;font-size:12px">Erro ao carregar.</div>';
      return;
    }

    var qAtual = ((document.getElementById('filtro') || {}).value || '').toLowerCase().trim();
    if (!qAtual) { el.style.display = 'none'; el.innerHTML = ''; return; }

    var filtrados = lista.filter(function (v) {
      return (v.nome || '').toLowerCase().indexOf(qAtual) !== -1 ||
        (v.placa || '').toLowerCase().indexOf(qAtual) !== -1 ||
        (v.identificador || '').toLowerCase().indexOf(qAtual) !== -1 ||
        (v.marca || '').toLowerCase().indexOf(qAtual) !== -1 ||
        (v.modeloVeiculo || '').toLowerCase().indexOf(qAtual) !== -1 ||
        ((v.cliente && v.cliente.nome) || '').toLowerCase().indexOf(qAtual) !== -1;
    });

    if (!filtrados.length) {
      el.innerHTML = '<div style="padding:12px;text-align:center;color:#aaa;font-size:12px">Nenhum resultado.</div>';
      return;
    }

    el.innerHTML = filtrados.map(function (v) {
      var dot = v.status === 'online' ? 'dot-moving' : 'dot-offline';
      var status = v.status === 'online' ? 'Online' : 'Offline';
      return '<div class="veiculo-item" onclick="window.__alBuscaGlobal(\'' + _esc(v.dispositivoId) + '\')">' +
        '<div class="v-nome">' + _esc(v.nome) +
        (v.placa ? '&nbsp;<span class="v-placa">' + _esc(v.placa) + '</span>' : '') + '</div>' +
        '<div class="v-status"><i class="fa fa-circle ' + dot + '"></i> ' + status + '</div>' +
        '</div>';
    }).join('');
  }

  window.__alBuscaGlobal = function (id) {
    var f = document.getElementById('filtro');
    var l = document.getElementById('lista-resultados-busca');
    if (f) f.value = '';
    if (l) l.style.display = 'none';
    if (_isRastrPage) {
      if (typeof window.selecionarDaBusca === 'function') window.selecionarDaBusca(id);
    } else {
      var base = window.location.href.replace(/\/[^/?#]+(\?.*)?$/, '/');
      var target = /\/admin\//.test(window.location.pathname)
        ? base + 'rastreamento.html'
        : base + '../admin/rastreamento.html';
      window.location.href = target + '?focus=' + encodeURIComponent(id);
    }
  };

  function _renderContadores(lista) {
    var el = document.getElementById('topbar-counters');
    if (!el) return;
    var online  = lista.filter(function (v) { return v.status === 'online'; }).length;
    var offline = lista.length - online;
    var semPos  = lista.filter(function (v) { return !v.posicao; }).length;
    el.innerHTML =
      '<span class="dot-moving">●</span> ' + online + ' online' +
      ' &nbsp;·&nbsp; ' +
      '<span class="dot-offline">●</span> ' + offline + ' offline' +
      (semPos ? ' &nbsp;·&nbsp; <span style="color:#e67e22">' + semPos + ' sem pos.</span>' : '');
  }

  async function _iniciarContadores() {
    var lista = await _carregarVeiculos();
    if (lista) _renderContadores(lista);
    setInterval(async function () {
      _veiculosGlobal = null;
      var l = await _carregarVeiculos();
      if (l) _renderContadores(l);
    }, 30000);
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

})();
