/**
 * auth-guard-cliente.js — Autenticação do portal do cliente
 * Inclua APÓS config.js nas páginas de AgillockSite/cliente/
 */

// Anti-FOUC do sidebar (mesmo padrão do auth-guard.js)
(function () {
  if (localStorage.getItem('al-sidebar-state') === 'collapsed') {
    document.documentElement.classList.add('al-sb-collapsed');
  }
})();

(function () {
  'use strict';

  var _clienteBase = (function () {
    var idx = window.location.pathname.indexOf('/AgillockSite/');
    return idx !== -1 ? window.location.pathname.substring(0, idx) + '/AgillockSite' : '';
  })();

  var TOKEN_KEY = 'al_cliente_token';
  var PERMS_KEY = 'al_cliente_permissoes';
  var BASE = window.API_URL || 'http://localhost:3000';

  // Permissões totais (responsável). Mantido em sincronia com backend/utils/cliente-permissoes.ts.
  var PERMS_TOTAIS = {
    rastreamento: {
      ver: true, bloquear: true, desbloquear: true,
      criarCerca: true, verCerca: true, verEventos: true,
      marcarManutencaoRecorrenteFeita: true,
      marcarRecorrenciaDataFeita: true,
      uploadFoto: true, editarIdentificacao: true
    },
    manutencao: {
      ver: true, criar: true, editar: true, excluir: true,
      criarRecorrencia: true, editarRecorrencia: true, marcarFeita: true
    },
    relatorio: { ver: true, exportar: true }
  };

  // Permissões vazias (vinculado sem dados carregados). Default seguro: nada visível
  // até o /me/permissoes responder e atualizar o cache.
  var PERMS_VAZIAS = {
    rastreamento: {
      ver: false, bloquear: false, desbloquear: false,
      criarCerca: false, verCerca: false, verEventos: false,
      marcarManutencaoRecorrenteFeita: false,
      marcarRecorrenciaDataFeita: false,
      uploadFoto: false, editarIdentificacao: false
    },
    manutencao: {
      ver: false, criar: false, editar: false, excluir: false,
      criarRecorrencia: false, editarRecorrencia: false, marcarFeita: false
    },
    relatorio: { ver: false, exportar: false }
  };

  // ─── Token ────────────────────────────────────────────────────────────────

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function removeToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(PERMS_KEY); }

  // ─── Permissões e placas acessíveis ───────────────────────────────────────
  // Cache em localStorage: { tipo, permissoes, dispositivoIdsPermitidos }.
  // Carregadas em getMe() logo após login; nas telas, usadas via can(), placas().
  function _cachedMe() {
    try { return JSON.parse(localStorage.getItem(PERMS_KEY) || 'null'); } catch (e) { return null; }
  }
  function _setCachedMe(me) {
    try { localStorage.setItem(PERMS_KEY, JSON.stringify(me)); } catch (e) {}
  }
  function getPermissoes() {
    var me = _cachedMe();
    if (me && me.permissoes) return me.permissoes;
    // Sem cache: olha o JWT. Responsável → total; vinculado → vazio (default seguro até /me/permissoes resolver).
    var u = getUser();
    if (u && u.tipo === 'vinculado') return PERMS_VAZIAS;
    return PERMS_TOTAIS;
  }
  function isResponsavel() {
    var me = _cachedMe();
    if (me && me.tipo) return me.tipo === 'responsavel';
    var u = getUser();
    return !u || u.tipo !== 'vinculado';
  }
  function placasIds() {
    var me = _cachedMe();
    if (!me) return null;
    return me.dispositivoIdsPermitidos; // null = sem restrição
  }
  function can(key) {
    // key formato 'tela.acao' — ex: 'rastreamento.bloquear'
    var parts = String(key || '').split('.');
    if (parts.length !== 2) return false;
    var grupo = (getPermissoes() || {})[parts[0]];
    return !!(grupo && grupo[parts[1]] === true);
  }
  function podeVerTela(tela) {
    return can(tela + '.ver');
  }
  function podeAcessarDispositivo(dispositivoId) {
    var ids = placasIds();
    if (ids === null || ids === undefined) return true;
    return ids.indexOf(dispositivoId) !== -1;
  }
  // Carrega ou recarrega /me/permissoes. Chame após login e em DOMContentLoaded.
  function refreshPermissoes() {
    if (!isAuthenticated()) return Promise.resolve(null);
    return apiGet('/api/cliente/me/permissoes')
      .then(function (me) { _setCachedMe(me); aplicarPermissoesSidebar(); return me; })
      .catch(function () { return null; });
  }

  // Retorna o arquivo HTML da primeira tela acessível para o cliente atual.
  // Responsável sempre cai em rastreamento.html. Vinculado segue ordem das permissões 'ver'.
  function telaInicialHtml() {
    if (isResponsavel()) return 'rastreamento.html';
    if (can('rastreamento.ver')) return 'rastreamento.html';
    if (can('relatorio.ver'))    return 'relatorio.html';
    if (can('manutencao.ver'))   return 'manutencoes.html';
    // Sub-usuário sem nenhuma tela liberada: mantém em rastreamento (mostrará bloqueio amigável)
    return 'rastreamento.html';
  }

  // Aplica visibilidade aos itens da sidebar conforme tipo/permissões do cliente.
  // Sub-usuários não veem: Pagamentos, Usuários, Notificações (a aba dedicada — eventos
  // continuam acessíveis dentro do Mapa). Telas restritas pelas permissões 'ver' caem juntas.
  function aplicarPermissoesSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var nav = sidebar.querySelector('.sidebar-nav');
    if (!nav) return;

    var responsavel = isResponsavel();
    var permRules = {
      'rastreamento.html': function () { return responsavel || can('rastreamento.ver'); },
      'manutencoes.html':  function () { return responsavel || can('manutencao.ver'); },
      'relatorio.html':    function () { return responsavel || can('relatorio.ver'); },
      'geocercas.html':    function () { return responsavel || can('rastreamento.verCerca'); },
      'notificacoes.html': function () { return responsavel; },
      'pagamentos.html':   function () { return responsavel; },
      'usuarios.html':     function () { return responsavel; },
      'multas.html':       function () { var me = _cachedMe(); return !!(me && me.multasHabilitado); },
      'dispositivos.html': function () { var me = _cachedMe(); return responsavel && !!(me && me.dispositivosHabilitado); },
    };
    nav.querySelectorAll('li').forEach(function (li) {
      var link = li.querySelector('a');
      if (!link) return;
      var href = (link.getAttribute('href') || '').split('?')[0];
      var key = href.split('/').pop();
      var rule = permRules[key];
      if (!rule) return;
      li.style.display = rule() ? '' : 'none';
    });
  }

  function parseJWT(token) {
    try {
      var base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var pad = base64.length % 4;
      if (pad) base64 += '==='.slice(0, 4 - pad);
      // Decodifica como UTF-8 (atob retorna bytes Latin1) — preserva acentos no nome.
      var json = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  function getUser() {
    var t = getToken();
    return t ? parseJWT(t) : null;
  }

  function isAuthenticated() {
    var u = getUser();
    return !!(u && u.exp * 1000 > Date.now() && u.role === 'CLIENTE');
  }

  // ─── Guard ────────────────────────────────────────────────────────────────

  function requireAuth(tipos) {
    if (!isAuthenticated()) {
      window.location.href = _clienteBase + '/login.html';
      return null;
    }
    var user = getUser();
    if (tipos && tipos.length && tipos.indexOf(user.tipo) === -1) {
      window.location.href = _clienteBase + '/cliente/rastreamento.html';
      return null;
    }
    return user;
  }

  function logout() {
    removeToken();
    window.location.href = _clienteBase + '/login.html';
  }

  // ─── API wrappers ─────────────────────────────────────────────────────────

  function apiRequest(method, endpoint, body) {
    var token = getToken();
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);

    return fetch(BASE + endpoint, opts).then(function (res) {
      if (res.status === 401) { removeToken(); window.location.href = _clienteBase + '/login.html'; return Promise.reject(new Error('Sessão expirada.')); }
      if (res.status === 204) return null;
      return res.json().then(function (data) {
        if (!res.ok) return Promise.reject(new Error(data.error || ('Erro ' + res.status)));
        return data;
      });
    });
  }

  function apiGet(endpoint) { return apiRequest('GET', endpoint, null); }
  function apiPost(endpoint, body) { return apiRequest('POST', endpoint, body); }
  function apiPut(endpoint, body) { return apiRequest('PUT', endpoint, body); }
  function apiPatch(endpoint, body) { return apiRequest('PATCH', endpoint, body); }
  function apiDelete(endpoint) { return apiRequest('DELETE', endpoint, null); }

  // ─── Upload de foto (multipart) ───────────────────────────────────────────

  function uploadFoto(endpoint, file) {
    var token = getToken();
    var form = new FormData();
    form.append('foto', file);
    return fetch(BASE + endpoint, {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: form,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) return Promise.reject(new Error(data.error || ('Erro ' + res.status)));
        return data;
      });
    });
  }

  // ─── Logo do cliente no sidebar ───────────────────────────────────────────

  // Envolve o menu em um container rolável, para que brand (topo) e footer
  // (rodapé) permaneçam fixos e só nav + logo do cliente rolem — como no admin.
  function _ensureSidebarScroll(sidebar) {
    var scroll = sidebar.querySelector('.sidebar-scroll');
    if (scroll) return scroll;
    var nav = sidebar.querySelector('.sidebar-nav');
    if (!nav) return null;
    scroll = document.createElement('div');
    scroll.className = 'sidebar-scroll';
    sidebar.insertBefore(scroll, nav);
    scroll.appendChild(nav);
    return scroll;
  }

  function _buildLogoSection(logoUrl) {
    if (!logoUrl) return null;

    var wrap = document.createElement('div');
    wrap.id = 'sidebar-logo-wrap';
    wrap.className = 'sidebar-cliente-logo';

    var imgWrap = document.createElement('div');
    imgWrap.className = 'sidebar-cliente-logo-img-wrap';

    var img = document.createElement('img');
    img.src = BASE.replace(/\/api\/?$/i, '') + logoUrl;
    img.alt = 'Logo';
    imgWrap.appendChild(img);
    wrap.appendChild(imgWrap);

    return wrap;
  }

  function initClienteLogo() {
    apiGet('/api/cliente/perfil').then(function (perfil) {
      var logoSection = _buildLogoSection(perfil.logoUrl || null);
      if (!logoSection) return;

      var sidebar = document.getElementById('sidebar');
      if (!sidebar) return;
      var scroll = _ensureSidebarScroll(sidebar);
      if (!scroll) return;

      // Os dois spacers centralizam a logo no espaço que sobra abaixo do menu
      var spacer1 = document.createElement('div');
      spacer1.className = 'sidebar-logo-spacer';
      var spacer2 = document.createElement('div');
      spacer2.className = 'sidebar-logo-spacer';

      scroll.appendChild(spacer1);
      scroll.appendChild(logoSection);
      scroll.appendChild(spacer2);
    }).catch(function () {});
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  function showAlert(msg, type) {
    type = type || 'danger';
    var bgMap = { danger: '#e74c3c', success: '#27ae60', warning: '#e6a817', info: '#3498db' };
    var bg = bgMap[type] || bgMap.danger;
    var container = document.getElementById('al-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'al-toast-container';
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none;';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.style.cssText = 'background:' + bg + ';color:#fff;padding:12px 16px;border-radius:8px;font-size:13px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:all;';
    toast.innerHTML = '<span>' + msg + '</span><button onclick="this.parentNode.remove()" style="background:transparent;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:18px;padding:0;">&times;</button>';
    container.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 5000);
  }

  // ─── Tema ─────────────────────────────────────────────────────────────────

  function initThemeToggle(btnId) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    function update() {
      var dark = document.documentElement.classList.contains('dark-theme');
      btn.innerHTML = dark
        ? '<i class="fa fa-sun-o"></i> Tema Claro'
        : '<i class="fa fa-moon-o"></i> Tema Escuro';
    }
    update();
    btn.addEventListener('click', function () {
      var nowDark = document.documentElement.classList.toggle('dark-theme');
      localStorage.setItem('al-theme', nowDark ? 'dark' : 'light');
      update();
    });
  }

  // ─── Formatadores ─────────────────────────────────────────────────────────

  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    var s = String(isoStr).split('T')[0];
    var p = s.split('-');
    if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0];
    return new Date(isoStr).toLocaleDateString('pt-BR');
  }

  function fmtMoney(val) {
    if (val === null || val === undefined) return '—';
    return 'R$ ' + Number(val).toFixed(2).replace('.', ',');
  }

  function badgeStatus(status) {
    var map = { ATIVO: '#27ae60', INATIVO: '#95a5a6', PENDENTE: '#e67e22', ATRASADO: '#e74c3c', PAGO: '#27ae60', CANCELADO: '#95a5a6' };
    var cor = map[status] || '#aaa';
    return '<span style="background:' + cor + ';color:#fff;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">' + status + '</span>';
  }

  // ─── Sidebar collapse (reutiliza lógica do auth-guard.js) ─────────────────
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.dropdown-toggle-link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var li = this.closest('.sidebar-dropdown');
        if (li) li.classList.toggle('open');
      });
    });

    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    _ensureSidebarScroll(sidebar);

    var LOGO_FULL = '../img/logo_agillock_white_new.png';
    var LOGO_ICON = '../favicon.ico';
    var logoImg   = sidebar.querySelector('.sidebar-brand img');
    var brand     = sidebar.querySelector('.sidebar-brand');

    var collapseBtn = document.createElement('button');
    collapseBtn.id        = 'btn-sidebar-collapse';
    collapseBtn.className = 'btn-sidebar-collapse';
    collapseBtn.title     = 'Recolher/Expandir';
    collapseBtn.innerHTML = '<i id="icon-sidebar-collapse" class="fa fa-chevron-left"></i>';
    if (brand) brand.appendChild(collapseBtn);

    // Labels para tooltip
    sidebar.querySelectorAll('.sidebar-nav > li').forEach(function (li) {
      var a = li.querySelector(':scope > a');
      if (!a) return;
      var clone = a.cloneNode(true);
      clone.querySelectorAll('i').forEach(function (el) { el.remove(); });
      var label = clone.textContent.replace(/\s+/g, ' ').trim();
      if (label) li.setAttribute('data-nav-label', label);
    });

    // Tooltip fixo no body
    var sidebarTooltip = document.createElement('div');
    sidebarTooltip.className = 'sidebar-tooltip';
    document.body.appendChild(sidebarTooltip);

    function showTooltip(el, label) {
      if (!sidebar.classList.contains('collapsed')) return;
      var rect = el.getBoundingClientRect();
      sidebarTooltip.textContent = label;
      sidebarTooltip.style.display = 'block';
      sidebarTooltip.style.top  = Math.round(rect.top + rect.height / 2) + 'px';
      sidebarTooltip.style.left = Math.round(rect.right + 12) + 'px';
    }
    function hideTooltip() { sidebarTooltip.style.display = 'none'; }

    sidebar.querySelectorAll('.sidebar-nav > li[data-nav-label]').forEach(function (li) {
      li.addEventListener('mouseenter', function () { showTooltip(li, li.getAttribute('data-nav-label')); });
      li.addEventListener('mouseleave', hideTooltip);
    });
    sidebar.addEventListener('click', hideTooltip);

    function applyCollapsed(c, animate) {
      if (!animate) {
        sidebar.classList.remove('sidebar-animate');
        sidebar.offsetWidth;
      }
      sidebar.classList.toggle('collapsed', c);
      document.documentElement.classList.remove('al-sb-collapsed');
      if (logoImg) logoImg.src = c ? LOGO_ICON : LOGO_FULL;
      var icon = document.getElementById('icon-sidebar-collapse');
      if (icon) icon.className = c ? 'fa fa-chevron-right' : 'fa fa-chevron-left';
      var topbar  = document.querySelector('.admin-topbar');
      var content = document.querySelector('.admin-content');
      var px = c ? '64px' : '';
      if (topbar)  topbar.style.left        = px;
      if (content) content.style.marginLeft = px;
      if (!animate) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            sidebar.classList.add('sidebar-animate');
          });
        });
      }
    }

    applyCollapsed(localStorage.getItem('al-sidebar-state') === 'collapsed', false);

    collapseBtn.addEventListener('click', function () {
      var now = !sidebar.classList.contains('collapsed');
      localStorage.setItem('al-sidebar-state', now ? 'collapsed' : 'expanded');
      applyCollapsed(now, true);
      hideTooltip();
    });

    // Injeta logo automaticamente em páginas autenticadas
    if (isAuthenticated()) {
      initClienteLogo();
      // Aplica permissões da sidebar usando cache imediato e re-aplica após refresh
      aplicarPermissoesSidebar();
      refreshPermissoes();
    }
  });

  // ─── Exportação global ────────────────────────────────────────────────────

  window.AL_CLIENTE = {
    getToken: getToken,
    setToken: setToken,
    getUser: getUser,
    isAuthenticated: isAuthenticated,
    requireAuth: requireAuth,
    logout: logout,
    apiGet: apiGet,
    apiPost: apiPost,
    apiPut: apiPut,
    apiPatch: apiPatch,
    apiDelete: apiDelete,
    uploadFoto: uploadFoto,
    showAlert: showAlert,
    initThemeToggle: initThemeToggle,
    fmtDate: fmtDate,
    fmtMoney: fmtMoney,
    badgeStatus: badgeStatus,
    // Permissões / sub-usuários
    refreshPermissoes: refreshPermissoes,
    getPermissoes: getPermissoes,
    isResponsavel: isResponsavel,
    placasIds: placasIds,
    can: can,
    podeVerTela: podeVerTela,
    podeAcessarDispositivo: podeAcessarDispositivo,
    telaInicialHtml: telaInicialHtml,
  };
})();
