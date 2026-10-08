/* SecureLab — qr-kod.html (QR generator for the public fault-report form) */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;
  var STORAGE_KEY = 'securelab_public_issue_url';

  document.addEventListener('DOMContentLoaded', async function () {
    var topbarActions = document.getElementById('topbarActions');
    if (topbarActions && window.SecureTheme) {
      window.SecureTheme.mountTopbarToggle(topbarActions);
      var toggle = topbarActions.querySelector('.topbar-theme-toggle');
      if (toggle) topbarActions.insertBefore(toggle, topbarActions.firstChild);
    }

    var user = await API.requireAuth();
    if (!user) return;
    if (user.rol !== 'admin') {
      location.replace('hesabim.html');
      return;
    }
    window.SecureNav.init(user);

    var savedUrl = '';
    try { savedUrl = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) {}
    var customUrlInput = document.getElementById('customUrl');
    if (customUrlInput && savedUrl) customUrlInput.value = savedUrl;

    loadQr(savedUrl);
    wireForm();
    wireActions();
  });

  function showAlert(message, type) {
    var el = document.getElementById('qrAlert');
    if (!el) return;
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert alert-' + type + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>';
  }

  async function loadQr(url) {
    var container = document.getElementById('qrContainer');
    var linkBox = document.getElementById('qrLinkBox');
    var actions = document.getElementById('qrActions');
    UI.setLoading(container, 'QR kod hazırlanıyor…');
    linkBox.hidden = true;
    actions.hidden = true;
    showAlert('', 'info');

    var path = '/api/public/issue-config' + (url ? '?url=' + encodeURIComponent(url) : '');

    try {
      var res = await API.apiRequest(path);
      container.innerHTML = '<div class="qr-display"><img src="' + res.qrDataUrl + '" alt="Arıza bildirim formu QR kodu"></div>';
      linkBox.textContent = res.issueUrl;
      linkBox.hidden = false;
      actions.hidden = false;

      var openBtn = document.getElementById('openLinkBtn');
      if (openBtn) openBtn.href = res.issueUrl;

      var copyBtn = document.getElementById('copyLinkBtn');
      if (copyBtn) {
        copyBtn.onclick = null;
        UI.wireCopyButton(copyBtn, function () { return res.issueUrl; });
      }
    } catch (err) {
      UI.setError(container, err.message, function () { loadQr(url); });
    }
  }

  function wireForm() {
    var form = document.getElementById('customUrlForm');
    var resetBtn = document.getElementById('resetUrlBtn');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = document.getElementById('customUrl').value.trim();
      if (!url) {
        showAlert('Lütfen geçerli bir adres girin veya varsayılana dönün.', 'error');
        return;
      }
      try { localStorage.setItem(STORAGE_KEY, url); } catch (err) {}
      loadQr(url);
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
        document.getElementById('customUrl').value = '';
        loadQr('');
      });
    }
  }

  function wireActions() {
    var printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  }
})();
