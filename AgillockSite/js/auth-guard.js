/**
 * auth-guard.js — Autenticação e wrapper de API para o painel admin
 * Inclua APÓS config.js em todas as páginas do admin.
 */

(function () {
  'use strict';

  // Detecta prefixo de caminho (/AgillockSite em dev, '' em prod)
  var _adminBase = (function () {
    var idx = window.location.pathname.indexOf('/AgillockSite/');
    return idx !== -1 ? window.location.pathname.substring(0, idx) + '/AgillockSite' : '';
  })();

  var TOKEN_KEY = 'al_token';

  // ─── Helpers de token ────────────────────────────────────────────────────

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function parseJWT(token) {
    try {
      var base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      // Padding
      var pad = base64.length % 4;
      if (pad) base64 += '==='.slice(0, 4 - pad);
      return JSON.parse(atob(base64));
    } catch (e) {
      return null;
    }
  }

  function getUser() {
    var token = getToken();
    if (!token) return null;
    return parseJWT(token);
  }

  function isAuthenticated() {
    var user = getUser();
    if (!user) return false;
    return (user.exp * 1000) > Date.now();
  }

  // ─── Guard de rota ───────────────────────────────────────────────────────

  /**
   * Verifica autenticação e role.
   * @param {string[]} roles - roles permitidos (ex: ['ADMIN', 'COLABORADOR'])
   * @returns {object|null} user payload ou null se não autorizado (já redirecionou)
   */
  function requireAuth(roles) {
    if (!isAuthenticated()) {
      window.location.href = _adminBase + '/admin/login.html';
      return null;
    }
    var user = getUser();
    if (roles && roles.length > 0 && roles.indexOf(user.role) === -1) {
      window.location.href = _adminBase + '/admin/login.html';
      return null;
    }
    return user;
  }

  function logout() {
    removeToken();
    window.location.href = _adminBase + '/admin/login.html';
  }

  // ─── API wrappers ────────────────────────────────────────────────────────

  var BASE = window.API_URL || 'http://localhost:3000';

  function apiRequest(method, endpoint, body) {
    var token = getToken();
    var opts = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) {
      opts.headers['Authorization'] = 'Bearer ' + token;
    }
    if (body !== undefined && body !== null) {
      opts.body = JSON.stringify(body);
    }

    return fetch(BASE + endpoint, opts).then(function (res) {
      if (res.status === 401) {
        removeToken();
        window.location.href = _adminBase + '/admin/login.html';
        return Promise.reject(new Error('Sessão expirada.'));
      }
      if (res.status === 204) return null; // No Content — sem body para parsear
      return res.json().then(function (data) {
        if (!res.ok) {
          return Promise.reject(new Error(data.error || ('Erro ' + res.status)));
        }
        return data;
      });
    });
  }

  function apiGet(endpoint) {
    return apiRequest('GET', endpoint, null);
  }

  function apiPost(endpoint, body) {
    return apiRequest('POST', endpoint, body);
  }

  function apiPut(endpoint, body) {
    return apiRequest('PUT', endpoint, body);
  }

  function apiPatch(endpoint, body) {
    return apiRequest('PATCH', endpoint, body || {});
  }

  function apiDelete(endpoint) {
    return apiRequest('DELETE', endpoint, null);
  }

  // ─── Formatadores ────────────────────────────────────────────────────────

  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    return d.toLocaleDateString('pt-BR');
  }

  function fmtMoney(val) {
    if (val === null || val === undefined) return '—';
    return 'R$ ' + Number(val).toFixed(2).replace('.', ',');
  }

  function fmtCpfCnpj(v) {
    if (!v) return '—';
    v = v.replace(/\D/g, '');
    if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return v;
  }

  function badgeStatus(status) {
    var map = {
      ATIVO: 'badge-ativo', INATIVO: 'badge-inativo',
      PENDENTE: 'badge-pendente', ATRASADO: 'badge-atrasado',
      PAGO: 'badge-pago', CANCELADO: 'badge-cancelado',
    };
    return '<span class="al-badge ' + (map[status] || 'badge-default') + '">' + status + '</span>';
  }

  /** Exibe um toast fixo no canto inferior direito */
  function showAlert(msg, type) {
    type = type || 'danger';
    var bgMap = { danger: '#e74c3c', success: '#27ae60', warning: '#e6a817', info: '#3498db' };
    var bg = bgMap[type] || bgMap.danger;

    var container = document.getElementById('al-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'al-toast-container';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'al-toast';
    toast.style.background = bg;
    toast.innerHTML = '<span>' + msg + '</span><button onclick="this.parentNode.remove()">&times;</button>';
    container.appendChild(toast);

    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 5000);
  }

  // ─── Toggle de tema ──────────────────────────────────────────────────────

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

  // ─── Máscaras de input ───────────────────────────────────────────────────

  function maskCpfCnpj(input) {
    input.addEventListener('input', function () {
      var v = this.value.replace(/\D/g, '');
      if (v.length <= 11) {
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      } else {
        v = v.replace(/^(\d{2})(\d)/, '$1.$2');
        v = v.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
        v = v.replace(/\.(\d{3})(\d)/, '.$1/$2');
        v = v.replace(/(\d{4})(\d)/, '$1-$2');
      }
      this.value = v;
    });
  }

  function maskPhone(input) {
    input.addEventListener('input', function () {
      var v = this.value.replace(/\D/g, '');
      if (v.length <= 10) {
        v = v.replace(/(\d{2})(\d)/, '($1) $2');
        v = v.replace(/(\d{4})(\d)/, '$1-$2');
      } else {
        v = v.replace(/(\d{2})(\d)/, '($1) $2');
        v = v.replace(/(\d{5})(\d)/, '$1-$2');
      }
      this.value = v;
    });
  }

  function maskPlaca(input) {
    input.addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
  }

  // ─── Helpers de data ─────────────────────────────────────────────────────

  /** Retorna true se a data ISO passada corresponde ao dia de hoje */
  function isHoje(isoStr) {
    if (!isoStr) return false;
    var d = new Date(isoStr);
    var h = new Date();
    return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
  }

  // ─── Modal de confirmação reutilizável ───────────────────────────────────

  /**
   * Exibe um modal de confirmação (substitui o confirm() nativo do browser).
   * @param {object} opts - { titulo, mensagem, consequencias, btnTexto, btnClasse }
   * @returns {Promise<boolean>}
   */
  function confirmar(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var id = 'al-confirmar-modal';
      var existing = document.getElementById(id);
      if (existing) { $(existing).modal('hide'); existing.parentNode.removeChild(existing); }

      var isDark = document.documentElement.classList.contains('dark-theme');
      var bodyBg = isDark ? '#1e2530' : '#fff';
      var textColor = isDark ? '#c9d1d9' : '#333';
      var borderColor = isDark ? '#2d3748' : '#e5e5e5';

      var el = document.createElement('div');
      el.className = 'modal fade';
      el.id = id;
      el.setAttribute('tabindex', '-1');
      el.innerHTML =
        '<div class="modal-dialog">' +
          '<div class="modal-content">' +
            '<div class="modal-header" style="background:#1e2530;">' +
              '<button type="button" class="close" data-dismiss="modal" style="color:white;font-size:22px;">&times;</button>' +
              '<h4 class="modal-title" style="color:#fff;"><i class="fa fa-exclamation-triangle" style="color:#fed136;margin-right:8px;"></i>' + (opts.titulo || 'Confirmar ação') + '</h4>' +
            '</div>' +
            '<div class="modal-body" style="background:' + bodyBg + ';color:' + textColor + ';">' +
              '<p style="font-size:15px;margin-bottom:' + (opts.consequencias ? '12px' : '0') + ';">' + (opts.mensagem || 'Deseja continuar?') + '</p>' +
              (opts.consequencias ? '<div class="alert alert-warning" style="font-size:13px;margin-bottom:0;"><i class="fa fa-warning"></i> <strong>Atenção:</strong> ' + opts.consequencias + '</div>' : '') +
            '</div>' +
            '<div class="modal-footer" style="background:' + bodyBg + ';border-top:1px solid ' + borderColor + ';">' +
              '<button type="button" class="btn btn-default" data-dismiss="modal">Cancelar</button>' +
              '<button type="button" class="btn ' + (opts.btnClasse || 'btn-danger') + '" id="al-confirmar-ok">' + (opts.btnTexto || 'Confirmar') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(el);

      var confirmed = false;
      document.getElementById('al-confirmar-ok').addEventListener('click', function () {
        confirmed = true;
        $(el).modal('hide');
      });
      $(el).modal('show');
      $(el).on('hidden.bs.modal', function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        resolve(confirmed);
      });
    });
  }

  // ─── Exportação global ───────────────────────────────────────────────────

  window.AL = {
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
    fmtDate: fmtDate,
    fmtMoney: fmtMoney,
    fmtCpfCnpj: fmtCpfCnpj,
    badgeStatus: badgeStatus,
    showAlert: showAlert,
    initThemeToggle: initThemeToggle,
    maskCpfCnpj: maskCpfCnpj,
    maskPhone: maskPhone,
    maskPlaca: maskPlaca,
    confirmar: confirmar,
    isHoje: isHoje,
  };
})();
