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
  var BASE = window.API_URL || 'http://localhost:3000';

  // ─── Token ────────────────────────────────────────────────────────────────

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function removeToken() { localStorage.removeItem(TOKEN_KEY); }

  function parseJWT(token) {
    try {
      var base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var pad = base64.length % 4;
      if (pad) base64 += '==='.slice(0, 4 - pad);
      return JSON.parse(atob(base64));
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
    apiPatch: apiPatch,
    apiDelete: apiDelete,
    uploadFoto: uploadFoto,
    showAlert: showAlert,
    initThemeToggle: initThemeToggle,
    fmtDate: fmtDate,
    fmtMoney: fmtMoney,
    badgeStatus: badgeStatus,
  };
})();
