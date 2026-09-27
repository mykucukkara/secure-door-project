/* SecureLab — kullanici-ekle.html (yalnızca yönetici)
   Bölüm sitesindeki (bm.subu.edu.tr) kadroda olup SecureLab'de hesabı
   olmayanları listeler; "Hesap Oluştur" ile sunucu geçici şifre üretip
   kişinin e-postasına gönderir. */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  var state = {
    candidates: [],
    pending: null,      // onay bekleyen { ad, soyad, unvan, eposta, kaynak: 'liste'|'elle' }
    busy: false,
    domains: ['subu.edu.tr']
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    var topbarActions = document.getElementById('topbarActions');
    if (topbarActions && window.SecureTheme) {
      window.SecureTheme.mountTopbarToggle(topbarActions);
      var toggle = topbarActions.querySelector('.topbar-theme-toggle');
      if (toggle) topbarActions.insertBefore(toggle, topbarActions.firstChild);
    }

    var user = await API.requireAuth();
    if (!user) return;
    if (user.rol !== 'admin') {
      location.replace('index.html');
      return;
    }
    window.SecureNav.init(user);

    ['confirmModal', 'resultModal'].forEach(function (id) {
      UI.wireModalDismiss(document.getElementById(id));
    });
    document.getElementById('refreshBtn').addEventListener('click', function () { loadCandidates(true); });
    document.getElementById('manualForm').addEventListener('submit', submitManual);
    document.getElementById('confirmSubmit').addEventListener('click', createAccount);

    loadCandidates(false);
  }

  /* ---------------- Aday listesi ---------------- */

  async function loadCandidates(refresh) {
    var container = document.getElementById('candidatesContainer');
    var btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    UI.setLoading(container, refresh ? 'Bölüm sitesi yeniden kontrol ediliyor…' : 'Bölüm kadrosu yükleniyor…');

    try {
      var res = await API.apiRequest('/api/kullanicilar/aday-hocalar' + (refresh ? '?yenile=1' : ''));
      state.candidates = Array.isArray(res.adaylar) ? res.adaylar : [];
      if (Array.isArray(res.izinliAlanlar) && res.izinliAlanlar.length) {
        state.domains = res.izinliAlanlar;
        document.getElementById('domainHint').textContent =
          'Yalnızca ' + res.izinliAlanlar.map(function (d) { return '@' + d; }).join(', ') + ' adresleri kabul edilir.';
      }

      var sourceLabel = res.kaynak === 'canli'
        ? 'bm.subu.edu.tr akademik kadro sayfası'
        : 'sistemdeki kayıtlı kadro listesi';
      document.getElementById('sourceSubtitle').textContent =
        'Kaynak: ' + sourceLabel + ' · Kadroda ' + res.toplamKadro + ' kişi, ' +
        res.kayitliSayisi + ' kişinin hesabı var · Son kontrol ' + UI.formatDateTime(res.zaman);

      var warning = document.getElementById('sourceWarning');
      warning.innerHTML = res.uyari
        ? '<div class="alert alert-warning mb-md"><div class="alert-body">' + UI.escapeHtml(res.uyari) + '</div></div>'
        : '';

      renderCandidates();
    } catch (err) {
      UI.setError(container, err.message, function () { loadCandidates(refresh); });
      document.getElementById('sourceSubtitle').textContent = 'Kadro bilgisi alınamadı';
    } finally {
      btn.disabled = false;
    }
  }

  function fullName(p) {
    return [p.unvan, p.ad, p.soyad].filter(Boolean).join(' ');
  }

  function renderCandidates() {
    var container = document.getElementById('candidatesContainer');
    if (!state.candidates.length) {
      UI.setEmpty(container, 'Herkesin hesabı var',
        'Bölüm sitesindeki tüm öğretim elemanlarının SecureLab hesabı bulunuyor. Siteye yeni biri eklendiğinde burada görünür.');
      return;
    }

    var rows = state.candidates.map(function (p, i) {
      return '<tr>' +
        '<td><div class="cell-strong">' + UI.escapeHtml(p.ad + ' ' + p.soyad) + '</div>' +
          '<div class="cell-muted">' + UI.escapeHtml(p.unvan || '—') + '</div></td>' +
        '<td>' + UI.escapeHtml(p.eposta) + '</td>' +
        '<td class="cell-muted wrap">' + UI.escapeHtml(p.gorev || '—') + '</td>' +
        '<td class="cell-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-index="' + i + '">Hesap Oluştur</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
      '<thead><tr><th>Ad Soyad</th><th>E-posta</th><th>Görev</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    container.querySelectorAll('button[data-index]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = state.candidates[Number(btn.getAttribute('data-index'))];
        if (p) openConfirm({ unvan: p.unvan, ad: p.ad, soyad: p.soyad, eposta: p.eposta });
      });
    });
  }

  /* ---------------- Elle ekleme ---------------- */

  function setManualAlert(message, type) {
    var el = document.getElementById('manualAlert');
    el.innerHTML = message
      ? '<div class="alert alert-' + type + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>'
      : '';
  }

  function emailAllowed(email) {
    var domain = (email.split('@')[1] || '').toLowerCase();
    return state.domains.some(function (d) { return domain === d || domain.slice(-(d.length + 1)) === '.' + d; });
  }

  function submitManual(e) {
    e.preventDefault();
    setManualAlert('', 'info');
    var person = {
      unvan: document.getElementById('manualUnvan').value,
      ad: document.getElementById('manualAd').value.trim(),
      soyad: document.getElementById('manualSoyad').value.trim(),
      eposta: document.getElementById('manualEposta').value.trim().toLowerCase()
    };
    if (!person.ad || !person.soyad) { setManualAlert('Ad ve soyad zorunludur.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.eposta)) { setManualAlert('Geçerli bir e-posta adresi girin.', 'error'); return; }
    if (!emailAllowed(person.eposta)) {
      setManualAlert('Yalnızca kurumsal e-posta adresleriyle hesap açılabilir.', 'error');
      return;
    }
    person.elle = true;
    openConfirm(person);
  }

  /* ---------------- Onay + oluşturma ---------------- */

  function openConfirm(person) {
    state.pending = person;
    document.getElementById('confirmSubtitle').textContent = fullName(person);
    document.getElementById('confirmEmail').textContent = person.eposta;
    UI.openModal(document.getElementById('confirmModal'));
  }

  async function createAccount() {
    if (!state.pending || state.busy) return;
    var person = state.pending;
    var btn = document.getElementById('confirmSubmit');
    var original = btn.textContent;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = 'Oluşturuluyor…';

    try {
      var res = await API.apiRequest('/api/kullanicilar', {
        method: 'POST',
        body: { unvan: person.unvan || undefined, ad: person.ad, soyad: person.soyad, eposta: person.eposta }
      });
      UI.closeModal(document.getElementById('confirmModal'));
      showResult(person, res);
      if (person.elle) document.getElementById('manualForm').reset();
      state.candidates = state.candidates.filter(function (c) { return c.eposta !== person.eposta; });
      renderCandidates();
    } catch (err) {
      UI.closeModal(document.getElementById('confirmModal'));
      if (person.elle) setManualAlert(err.message || 'Hesap oluşturulamadı.', 'error');
      UI.toast(err.message || 'Hesap oluşturulamadı.', 'error');
    } finally {
      state.busy = false;
      state.pending = null;
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function showResult(person, res) {
    document.getElementById('resultSubtitle').textContent = fullName(person);
    var body = document.getElementById('resultBody');
    var expires = res.geciciSifreBitis ? UI.formatDateTime(res.geciciSifreBitis) : '—';

    if (res.mailGonderildi) {
      document.getElementById('resultTitle').textContent = 'Hesap oluşturuldu, e-posta gönderildi';
      body.innerHTML =
        '<div class="alert alert-success"><div class="alert-body">Geçici şifre <strong>' + UI.escapeHtml(res.eposta) +
        '</strong> adresine gönderildi. Kişi ilk girişte kendi şifresini belirleyecek.</div></div>' +
        '<p class="text-meta mt-sm">Geçici şifre ' + UI.escapeHtml(expires) + ' tarihine kadar geçerlidir. ' +
        'Süre dolarsa Kullanıcılar sayfasından yeni geçici şifre gönderebilirsiniz.</p>';
      UI.toast('Hesap oluşturuldu ve e-posta gönderildi.', 'success');
    } else {
      document.getElementById('resultTitle').textContent = 'Hesap oluşturuldu — e-posta gönderilemedi';
      body.innerHTML =
        '<div class="credentials-callout">' +
          '<div class="credentials-callout-warning">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 19.5H3L12 3.5Z"></path><path d="M12 9.5v4"></path><path d="M12 16.8h.01"></path></svg>' +
            '<span>' + UI.escapeHtml(res.mailHatasi || 'E-posta gönderilemedi.') + ' Bu şifre yalnızca şimdi gösterilir.</span>' +
          '</div>' +
          '<div class="credential-row"><div><div class="credential-row-label">E-posta</div>' +
            '<div class="credential-row-value">' + UI.escapeHtml(res.eposta) + '</div></div></div>' +
          '<div class="credential-row"><div><div class="credential-row-label">Geçici şifre (' + UI.escapeHtml(expires) + ' tarihine kadar)</div>' +
            '<div class="credential-row-value" id="resultTempPassword">' + UI.escapeHtml(res.geciciSifre || '—') + '</div></div>' +
            '<button type="button" class="copy-btn" id="copyTempPasswordBtn">Kopyala</button></div>' +
        '</div>';
      UI.wireCopyButton(document.getElementById('copyTempPasswordBtn'), function () {
        return document.getElementById('resultTempPassword').textContent;
      });
      UI.toast('Hesap oluşturuldu; e-posta gönderilemedi.', 'warning');
    }
    UI.openModal(document.getElementById('resultModal'));
  }
})();
