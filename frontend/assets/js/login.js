/* SecureLab — login.html */
(function () {
  'use strict';

  var API = window.SecureAPI;

  document.addEventListener('DOMContentLoaded', function () {
    var themeSlot = document.getElementById('authThemeToggle');
    if (themeSlot && window.SecureTheme) window.SecureTheme.mountTopbarToggle(themeSlot);

    // If already authenticated, skip straight past login.
    if (API.getToken()) {
      API.apiRequest('/api/auth/me').then(function (res) {
        redirectByRole(res.user);
      }).catch(function () {
        API.clearToken();
      });
    }

    wirePasswordToggle();
    wireLoginForm();
    wireForgotPassword();
  });

  function wirePasswordToggle() {
    var btn = document.getElementById('togglePassword');
    var input = document.getElementById('pin');
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.setAttribute('aria-label', isHidden ? 'Şifreyi gizle' : 'Şifreyi göster');
      btn.innerHTML = isHidden
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"></path><path d="M10.6 5.6A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3.2 3.9M6.5 6.9C4 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.9 9.9 0 0 0 3.9-.8"></path><path d="M9.9 10a3 3 0 0 0 4.1 4.1"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    });
  }

  function showAlert(containerId, message, type) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!message) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<div class="alert alert-' + type + '"><span class="alert-icon">' +
      (type === 'success'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 12.5l2.3 2.3L16 9.8"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16h.01"></path></svg>') +
      '</span><div class="alert-body">' + message.replace(/</g, '&lt;') + '</div></div>';
  }

  function redirectByRole(user) {
    // Geçici şifreyle giren kullanıcı önce kendi şifresini belirler.
    if (user && user.sifreDegistirmeZorunlu) {
      location.replace('sifre-degistir.html');
      return;
    }
    // Rol fark etmeksizin herkes önce Panel'e (index.html) yönlendirilir.
    location.replace('index.html');
  }

  function wireLoginForm() {
    var form = document.getElementById('loginForm');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      showAlert('loginAlert', '', 'info');

      var eposta = document.getElementById('eposta').value.trim();
      var pin = document.getElementById('pin').value;
      var remember = document.getElementById('rememberMe').checked;

      if (!eposta || !pin) {
        showAlert('loginAlert', 'Lütfen e-posta ve şifrenizi girin.', 'error');
        return;
      }

      var submitBtn = document.getElementById('loginSubmit');
      var submitText = document.getElementById('loginSubmitText');
      submitBtn.disabled = true;
      var originalText = submitText.textContent;
      submitText.textContent = 'Giriş yapılıyor…';

      try {
        var res = await API.apiRequest('/api/auth/login', {
          method: 'POST',
          body: { eposta: eposta, pin: pin }
        });
        API.setToken(res.token, remember);
        redirectByRole(res.user);
      } catch (err) {
        showAlert('loginAlert', err.message || 'Giriş yapılamadı.', 'error');
        submitBtn.disabled = false;
        submitText.textContent = originalText;
      }
    });
  }

  function wireForgotPassword() {
    var link = document.getElementById('forgotPasswordLink');
    var modal = document.getElementById('forgotModal');
    var form = document.getElementById('forgotForm');
    if (!link || !modal || !form) return;

    if (window.SecureUI) window.SecureUI.wireModalDismiss(modal);

    link.addEventListener('click', function (e) {
      e.preventDefault();
      showAlert('forgotAlert', '', 'info');
      document.getElementById('forgotEposta').value = document.getElementById('eposta').value || '';
      if (window.SecureUI) window.SecureUI.openModal(modal);
      else modal.classList.add('is-open');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var eposta = document.getElementById('forgotEposta').value.trim();
      if (!eposta) return;

      var btn = document.getElementById('forgotSubmit');
      btn.disabled = true;
      var originalText = btn.textContent;
      btn.textContent = 'Gönderiliyor…';

      try {
        var res = await API.apiRequest('/api/auth/forgot-password', {
          method: 'POST',
          body: { eposta: eposta }
        });
        showAlert('forgotAlert', res.message || 'E-posta adresiniz sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderildi.', 'success');
        form.reset();
      } catch (err) {
        showAlert('forgotAlert', err.message || 'İşlem gerçekleştirilemedi.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }
})();
