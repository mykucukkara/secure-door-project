/* SecureLab — shared UI helpers used across authenticated + standalone pages:
   toasts, badges (enum -> label/variant map), date formatting, copy-to-clipboard,
   simple modal open/close. Loaded after api.js / theme.js, before page scripts. */
(function () {
  'use strict';

  /* ---------------- Enum -> {label, badge variant} maps ---------------- */

  var ENUM_MAP = {
    kullaniciDurum: {
      aktif: ['Aktif', 'success'],
      pasif: ['Pasif', 'danger']
    },
    pinDurum: {
      aktif: ['Aktif', 'success'],
      pasif: ['Geçmiş', 'neutral']
    },
    kartDurum: {
      aktif: ['Aktif', 'success'],
      askida: ['Askıda', 'warning'],
      iptal: ['İptal', 'danger'],
      kayip: ['Kayıp', 'danger'],
      hasarli: ['Hasarlı', 'danger'],
      bakimda: ['Bakımda', 'warning'],
      devredisi: ['Devre dışı', 'neutral'],
      arizali: ['Arızalı', 'danger'],
      emekli: ['Emekli', 'neutral']
    },
    cihazDurum: {
      cevrimici: ['Çevrimiçi', 'success'],
      cevrimdisi: ['Çevrimdışı', 'neutral'],
      hatali: ['Hatalı', 'danger'],
      aktif: ['Aktif', 'success'],
      pasif: ['Pasif', 'danger']
    },
    genelDurum: {
      aktif: ['Aktif', 'success'],
      pasif: ['Pasif', 'danger']
    },
    rol: {
      hoca: ['Öğretim Elemanı', 'info'],
      admin: ['Yönetici', 'warning'],
      sistem: ['Sistem', 'neutral']
    },
    dogrulamaYontemi: {
      kart: ['RFID Kart', 'neutral'],
      pin: ['PIN', 'neutral']
    },
    sonuc: {
      izin: ['İzin verildi', 'success'],
      red: ['Reddedildi', 'danger']
    },
    arizaDurum: {
      OPEN: ['Açık', 'danger'],
      IN_PROGRESS: ['İnceleniyor', 'warning'],
      RESOLVED: ['Çözüldü', 'success']
    },
    onayDurum: {
      bekliyor: ['Onay bekliyor', 'warning']
    }
  };

  var KAYNAK_MAP = {
    kullanici: 'Kullanıcı belirledi',
    manuel: 'Rastgele yenileme',
    otomatik: 'Günlük otomatik (eski)',
    yonetici: 'Yönetici tarafından',
    baslangic: 'Başlangıç kaydı',
    eski_kayit: 'Geçiş öncesi kayıt'
  };

  var ARIZA_TURU_LIST = [
    'Kapı', 'RFID okuyucu', 'Tuş takımı', 'Monitör', 'Bilgisayar kasası', 'Klavye',
    'Fare', 'Kablo, adaptör veya priz', 'Ağ veya internet', 'Yazıcı veya projeksiyon',
    'Masa veya sandalye', 'Diğer'
  ];

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badgeInfo(category, value) {
    var map = ENUM_MAP[category] || {};
    var entry = map[value];
    if (!entry) return { label: value || '—', variant: 'neutral' };
    return { label: entry[0], variant: entry[1] };
  }

  function renderBadge(category, value, opts) {
    opts = opts || {};
    var info = badgeInfo(category, value);
    var label = opts.label || info.label;
    return '<span class="badge badge-' + info.variant + '">' + escapeHtml(label) + '</span>';
  }

  function kaynakLabel(value) {
    return KAYNAK_MAP[value] || value || '—';
  }

  /* ---------------- Date formatting ---------------- */

  function formatDateTime(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /* ---------------- Toasts ---------------- */

  var ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 12.5l2.3 2.3L16 9.8"></path></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16h.01"></path></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 19.5H3L12 3.5Z"></path><path d="M12 9.5v4"></path><path d="M12 16.8h.01"></path></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 7.8h.01"></path></svg>'
  };

  function ensureToastStack() {
    var stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type, duration) {
    type = type && ICONS[type] ? type : 'info';
    duration = duration || 4200;
    var stack = ensureToastStack();
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML =
      '<span class="toast-icon">' + ICONS[type] + '</span>' +
      '<span class="toast-message">' + escapeHtml(message) + '</span>' +
      '<button type="button" class="toast-close" aria-label="Kapat">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>';
    stack.appendChild(el);

    var timer = setTimeout(remove, duration);
    el.querySelector('.toast-close').addEventListener('click', remove);

    function remove() {
      clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    return el;
  }

  /* ---------------- Copy to clipboard ---------------- */

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function wireCopyButton(btn, getText) {
    if (!btn) return;
    var originalHtml = btn.innerHTML;
    btn.addEventListener('click', function () {
      var text = typeof getText === 'function' ? getText() : String(getText);
      copyToClipboard(text).then(function () {
        btn.classList.add('is-copied');
        btn.innerHTML = 'Kopyalandı';
        setTimeout(function () {
          btn.classList.remove('is-copied');
          btn.innerHTML = originalHtml;
        }, 1800);
      }).catch(function () {
        toast('Kopyalama başarısız oldu.', 'error');
      });
    });
  }

  /* ---------------- Modal ---------------- */

  function openModal(backdropEl) {
    if (!backdropEl) return;
    backdropEl.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    var focusTarget = backdropEl.querySelector('[autofocus]') || backdropEl.querySelector('input, select, textarea, button');
    if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 30);
  }

  function closeModal(backdropEl) {
    if (!backdropEl) return;
    backdropEl.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function wireModalDismiss(backdropEl) {
    if (!backdropEl) return;
    backdropEl.addEventListener('click', function (e) {
      if (e.target === backdropEl) closeModal(backdropEl);
    });
    backdropEl.querySelectorAll('[data-modal-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(backdropEl); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && backdropEl.classList.contains('is-open')) closeModal(backdropEl);
    });
  }

  /* ---------------- Misc ---------------- */

  function setLoading(container, message) {
    container.innerHTML = '<div class="state-box"><span class="spinner spinner-lg"></span>' +
      '<div class="state-box-text">' + escapeHtml(message || 'Yükleniyor…') + '</div></div>';
  }

  function setEmpty(container, title, text, iconSvg) {
    container.innerHTML = '<div class="state-box">' +
      '<span class="state-box-icon">' + (iconSvg || ICONS.info) + '</span>' +
      '<div class="state-box-title">' + escapeHtml(title) + '</div>' +
      (text ? '<div class="state-box-text">' + escapeHtml(text) + '</div>' : '') +
      '</div>';
  }

  function setError(container, message, retryFn) {
    container.innerHTML = '<div class="state-box is-error">' +
      '<span class="state-box-icon">' + ICONS.error + '</span>' +
      '<div class="state-box-title">Bir hata oluştu</div>' +
      '<div class="state-box-text">' + escapeHtml(message || 'İşlem gerçekleştirilemedi.') + '</div>' +
      (retryFn ? '<button type="button" class="btn btn-secondary btn-sm" id="__retryBtn">Tekrar dene</button>' : '') +
      '</div>';
    if (retryFn) {
      var btn = container.querySelector('#__retryBtn');
      if (btn) btn.addEventListener('click', retryFn);
    }
  }

  window.SecureUI = {
    ARIZA_TURU_LIST: ARIZA_TURU_LIST,
    escapeHtml: escapeHtml,
    badgeInfo: badgeInfo,
    renderBadge: renderBadge,
    kaynakLabel: kaynakLabel,
    formatDateTime: formatDateTime,
    formatDate: formatDate,
    toast: toast,
    copyToClipboard: copyToClipboard,
    wireCopyButton: wireCopyButton,
    openModal: openModal,
    closeModal: closeModal,
    wireModalDismiss: wireModalDismiss,
    setLoading: setLoading,
    setEmpty: setEmpty,
    setError: setError
  };
})();
