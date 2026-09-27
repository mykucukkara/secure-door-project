/* SecureLab — fetch wrapper + auth token storage. Everything else depends on this file. */
(function () {
  'use strict';

  var API_BASE = ''; // same-origin
  var TOKEN_KEY = 'securelab_auth_token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  }

  function setToken(token, remember) {
    clearToken();
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  }

  /** Mevcut depolama tercihini (Beni hatırla) koruyarak anahtarı yeniler. */
  function replaceToken(token) {
    var remember = false;
    try { remember = Boolean(localStorage.getItem(TOKEN_KEY)); } catch (e) { remember = false; }
    setToken(token, remember);
  }

  var PASSWORD_CHANGE_PAGE = 'sifre-degistir.html';

  function onPasswordChangePage() {
    return location.pathname.endsWith(PASSWORD_CHANGE_PAGE);
  }

  function goToPasswordChange() {
    if (!onPasswordChangePage()) location.replace(PASSWORD_CHANGE_PAGE);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }

  async function apiRequest(path, options) {
    options = options || {};
    var method = options.method || 'GET';
    var body = options.body;
    var headers = options.headers || {};

    var token = getToken();
    var finalHeaders = Object.assign({ Accept: 'application/json' }, headers);
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    if (token) finalHeaders['Authorization'] = 'Bearer ' + token;

    var response;
    try {
      response = await fetch(API_BASE + path, {
        method: method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.');
    }

    var text = await response.text();
    var data = {};
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { message: 'Sunucudan beklenmeyen bir yanıt alındı.' }; }
    }

    if (!response.ok) {
      if (response.status === 403 && data && data.code === 'SIFRE_DEGISTIRME_ZORUNLU') {
        goToPasswordChange();
      }
      // Giriş ve şifre değiştirme formlarındaki "şifre hatalı" yanıtları
      // oturumu kapatmaz; yalnızca formda hata olarak gösterilir.
      if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/change-password') {
        clearToken();
        if (!location.pathname.endsWith('login.html')) location.replace('login.html');
      }
      var message = data.message || data.hata || data.error ||
        (response.status === 403 ? 'Bu işlem için yetkiniz bulunmuyor.' : 'İşlem gerçekleştirilemedi.');
      var err = new Error(message);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  /**
   * Ensures the current page has a valid session.
   * On success resolves with the user object; on failure clears the token
   * and redirects to login.html.
   */
  async function requireAuth() {
    try {
      var res = await apiRequest('/api/auth/me');
      // Geçici şifreyle giren kullanıcı önce kendi şifresini belirlemeli.
      if (res.user && res.user.sifreDegistirmeZorunlu && !onPasswordChangePage()) {
        goToPasswordChange();
        return null;
      }
      return res.user;
    } catch (e) {
      clearToken();
      if (!location.pathname.endsWith('login.html')) location.replace('login.html');
      return null;
    }
  }

  window.SecureAPI = {
    apiRequest: apiRequest,
    getToken: getToken,
    setToken: setToken,
    replaceToken: replaceToken,
    clearToken: clearToken,
    requireAuth: requireAuth
  };
})();
