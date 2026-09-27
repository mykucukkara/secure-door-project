/* SecureLab — sifre-degistir.html
   Yöneticinin verdiği geçici şifreyle giren kullanıcı, panelin geri kalanını
   kullanmadan önce kendi şifresini belirler. Sunucu da bu kuralı zorlar
   (SIFRE_DEGISTIRME_ZORUNLU); bu sayfa yalnızca akışı kolaylaştırır. */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;
  var currentUser = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    var themeSlot = document.getElementById('authThemeToggle');
    if (themeSlot && window.SecureTheme) window.SecureTheme.mountTopbarToggle(themeSlot);

    if (!API.getToken()) {
      location.replace('login.html');
      return;
    }

    var user = await API.requireAuth();
    if (!user) return;
    if (!user.sifreDegistirmeZorunlu) {
      // Şifresini zaten belirlemiş kullanıcı bu sayfada kalmaz.
      location.replace('index.html');
      return;
    }
    currentUser = user;

    var name = [user.unvan, user.ad, user.soyad].filter(Boolean).join(' ');
    document.getElementById('welcomeText').textContent = 'Hoş geldiniz, ' + name + '.';
    document.getElementById('usernameHidden').value = user.eposta || '';
    if (user.sifreGecerlilikBitis) {
      document.getElementById('expiryText').textContent =
        'Geçici şifreniz ' + UI.formatDateTime(user.sifreGecerlilikBitis) + ' tarihine kadar geçerlidir.';
    }

    wireToggle();
    wirePolicy();
    wireForm();
    wireLogout();
    document.getElementById('mevcutSifre').focus();
  }

  function wireToggle() {
    var btn = document.getElementById('toggleNewPassword');
    var input = document.getElementById('yeniSifre');
    btn.addEventListener('click', function () {
      var hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      document.getElementById('yeniSifreTekrar').type = input.type;
      btn.setAttribute('aria-label', hidden ? 'Şifreyi gizle' : 'Şifreyi göster');
    });
  }

  function personalParts() {
    if (!currentUser) return [];
    return [String(currentUser.eposta || '').split('@')[0], currentUser.ad || '', currentUser.soyad || '']
      .join(' ')
      .split(/[\s._-]+/)
      .map(function (p) { return p.toLocaleLowerCase('tr-TR'); })
      .filter(function (p) { return p.length >= 3; });
  }

  function evaluate(value) {
    var lower = value.toLocaleLowerCase('tr-TR');
    return {
      length: value.length >= 10 && value.length <= 72,
      upper: /[A-ZÇĞİÖŞÜ]/.test(value),
      lower: /[a-zçğıöşü]/.test(value),
      digit: /\d/.test(value),
      personal: value.length > 0 && !personalParts().some(function (p) { return lower.indexOf(p) !== -1; })
    };
  }

  function wirePolicy() {
    var input = document.getElementById('yeniSifre');
    input.addEventListener('input', function () {
      var result = evaluate(input.value);
      document.querySelectorAll('#policyList li').forEach(function (li) {
        li.classList.toggle('is-ok', Boolean(result[li.getAttribute('data-rule')]));
      });
    });
  }

  function setAlert(message, type) {
    var el = document.getElementById('changeAlert');
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert alert-' + type + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>';
  }

  function wireForm() {
    document.getElementById('changeForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      setAlert('', 'info');

      var mevcut = document.getElementById('mevcutSifre').value;
      var yeni = document.getElementById('yeniSifre').value;
      var tekrar = document.getElementById('yeniSifreTekrar').value;

      if (!mevcut || !yeni || !tekrar) { setAlert('Lütfen tüm alanları doldurun.', 'error'); return; }
      var result = evaluate(yeni);
      var failed = Object.keys(result).filter(function (k) { return !result[k]; });
      if (failed.length) { setAlert('Yeni şifre kurallarının tamamını karşılamıyor.', 'error'); return; }
      if (yeni !== tekrar) { setAlert('Yeni şifreler birbiriyle eşleşmiyor.', 'error'); return; }
      if (yeni === mevcut) { setAlert('Yeni şifre geçici şifreyle aynı olamaz.', 'error'); return; }

      var btn = document.getElementById('changeSubmit');
      var text = document.getElementById('changeSubmitText');
      var original = text.textContent;
      btn.disabled = true;
      text.textContent = 'Kaydediliyor…';

      try {
        var res = await API.apiRequest('/api/auth/change-password', {
          method: 'POST',
          body: { mevcutSifre: mevcut, yeniSifre: yeni, yeniSifreTekrar: tekrar }
        });
        if (res.token) API.replaceToken(res.token);
        setAlert(res.message || 'Şifreniz belirlendi.', 'success');
        setTimeout(function () { location.replace(res.token ? 'index.html' : 'login.html'); }, 900);
      } catch (err) {
        setAlert(err.message || 'Şifre değiştirilemedi.', 'error');
        btn.disabled = false;
        text.textContent = original;
      }
    });
  }

  function wireLogout() {
    document.getElementById('logoutLink').addEventListener('click', async function () {
      try { await API.apiRequest('/api/auth/logout', { method: 'POST' }); } catch (e) { /* yok say */ }
      API.clearToken();
      location.replace('login.html');
    });
  }
})();
