/* SecureLab — hesabim.html (Profilim)
   Hesap bilgileri, kalıcı kapı şifresi (görüntüle / değiştir), web paneli
   şifresi ve kapı şifresi geçmişi. */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;
  var currentUser = null;

  var pinState = {
    value: null,      // çözülmüş güncel PIN (yalnızca bellekte)
    revealed: false,
    mode: 'custom',   // 'custom' | 'random'
    hideTimer: null
  };

  var WEAK = ['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
    '123456', '654321', '123123', '112233', '121212', '101010', '010203', '000001', '999998', '159753',
    '147258', '258369', '123321', '098765', '012345', '543210'];

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

    window.SecureNav.init(user);
    currentUser = user;

    renderProfile(user);
    loadProfileDetails(user.kullaniciId);
    loadDoorPin();
    wireDoorPin();
    wirePasswordForm();
    loadPinHistory(user.kullaniciId);
  }

  /* ---------------- Hesap bilgileri ---------------- */

  function renderProfile(user) {
    var fullName = ((user.ad || '') + ' ' + (user.soyad || '')).trim() || 'Kullanıcı';
    var initials = ((user.ad || '?').charAt(0) + (user.soyad || '').charAt(0)).toLocaleUpperCase('tr-TR');

    setText('summaryAvatar', initials || '?');
    setText('summaryName', fullName);
    setText('summaryEmail', user.eposta || '—');
    document.getElementById('summaryRoleBadge').innerHTML = UI.renderBadge('rol', user.rol,
      user.rol === 'hoca' ? { label: 'Öğretim Üyesi' } : undefined);
    document.getElementById('summaryDurumBadge').innerHTML = UI.renderBadge('kullaniciDurum', user.durum);
  }

  async function loadProfileDetails(userId) {
    try {
      var detail = await API.apiRequest('/api/kullanicilar/' + userId);
      setText('summaryBirim', (detail && detail.birim && detail.birim.ad) || '—');
    } catch (err) {
      setText('summaryBirim', '—');
    }
    try {
      var cards = await API.apiRequest('/api/kullanicilar/' + userId + '/kartlar');
      cards = Array.isArray(cards) ? cards : [];
      var active = cards.filter(function (c) { return c.yetkiDurum === 'aktif'; });
      var el = document.getElementById('summaryCards');
      if (!active.length) {
        el.innerHTML = '<span class="cell-muted">Tanımlı aktif kart yok</span>';
      } else {
        el.innerHTML = active.map(function (c) {
          return '<code class="pin-cell">' + UI.escapeHtml(c.kartUid) + '</code>';
        }).join(' ');
      }
    } catch (err) {
      setText('summaryCards', '—');
    }
  }

  /* ---------------- Kapı şifresi ---------------- */

  async function loadDoorPin() {
    var revealBtn = document.getElementById('doorPinRevealBtn');
    var copyBtn = document.getElementById('doorPinCopyBtn');
    try {
      var res = await API.apiRequest('/api/kullanicilar/' + currentUser.kullaniciId + '/kapi-sifresi');
      pinState.value = res.pin || null;
      setText('doorPinChanged', res.sonDegisim ? UI.formatDateTime(res.sonDegisim) : '—');

      var badge = document.getElementById('doorPinBadge');
      if (!res.tanimli) {
        badge.textContent = 'Tanımlı değil';
        badge.className = 'badge badge-warning';
      } else {
        badge.textContent = res.kalici ? 'Süresiz' : 'Süreli';
        badge.className = 'badge ' + (res.kalici ? 'badge-success' : 'badge-warning');
      }

      var hasPin = Boolean(pinState.value);
      revealBtn.disabled = !hasPin;
      copyBtn.disabled = !hasPin;
      setRevealed(false);

      if (!hasPin) {
        document.getElementById('doorPinDigits').innerHTML =
          '<span class="door-pin-empty">' + (res.tanimli
            ? 'Şifreniz eski bir sürümde oluşturulduğu için görüntülenemiyor. Aşağıdan yeni bir şifre belirleyin.'
            : 'Henüz bir kapı şifreniz yok. Aşağıdan belirleyebilirsiniz.') + '</span>';
      }
    } catch (err) {
      revealBtn.disabled = true;
      copyBtn.disabled = true;
      setAlert('doorPinAlert', err.message || 'Kapı şifresi bilgisi alınamadı.', 'error');
    }
  }

  function renderDigits(value, masked) {
    var container = document.getElementById('doorPinDigits');
    var chars = String(value || '').split('');
    if (!chars.length) chars = ['•', '•', '•', '•', '•', '•'];
    container.classList.toggle('is-masked', masked);
    container.innerHTML = chars.map(function (c) {
      return '<span class="pin-digit">' + UI.escapeHtml(masked ? '•' : c) + '</span>';
    }).join('');
  }

  function setRevealed(revealed) {
    pinState.revealed = revealed && Boolean(pinState.value);
    renderDigits(pinState.value, !pinState.revealed);
    setText('doorPinRevealText', pinState.revealed ? 'Gizle' : 'Göster');
    if (pinState.hideTimer) clearTimeout(pinState.hideTimer);
    if (pinState.revealed) {
      // Ekranda açık kalmasın: 30 saniye sonra otomatik gizle.
      pinState.hideTimer = setTimeout(function () { setRevealed(false); }, 30000);
    }
  }

  function wireDoorPin() {
    document.getElementById('doorPinRevealBtn').addEventListener('click', function () {
      setRevealed(!pinState.revealed);
    });

    UI.wireCopyButton(document.getElementById('doorPinCopyBtn'), function () {
      return pinState.value || '';
    });

    document.querySelectorAll('[data-pin-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-pin-mode')); });
    });

    var pinInput = document.getElementById('yeniPin');
    var pinRepeat = document.getElementById('yeniPinTekrar');
    [pinInput, pinRepeat].forEach(function (input) {
      input.addEventListener('input', function () {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        updateStrength();
      });
    });

    document.getElementById('doorPinForm').addEventListener('submit', submitDoorPin);
  }

  function setMode(mode) {
    pinState.mode = mode === 'random' ? 'random' : 'custom';
    document.querySelectorAll('[data-pin-mode]').forEach(function (btn) {
      var active = btn.getAttribute('data-pin-mode') === pinState.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.getElementById('doorPinCustomFields').hidden = pinState.mode === 'random';
    document.getElementById('doorPinRandomInfo').hidden = pinState.mode !== 'random';
    document.getElementById('pinStrength').textContent = '';
    document.getElementById('doorPinSubmit').textContent =
      pinState.mode === 'random' ? 'Rastgele Şifre Oluştur' : 'Kapı Şifresini Kaydet';
    setAlert('doorPinAlert', '', 'info');
  }

  function isSequential(pin) {
    var asc = true;
    var desc = true;
    for (var i = 1; i < pin.length; i++) {
      var diff = Number(pin[i]) - Number(pin[i - 1]);
      if (diff !== 1) asc = false;
      if (diff !== -1) desc = false;
    }
    return asc || desc;
  }

  function checkPin(pin) {
    if (!/^\d{6}$/.test(pin)) return 'Şifre 6 rakamdan oluşmalıdır.';
    if (/^(\d)\1{5}$/.test(pin)) return 'Aynı rakamın tekrarı kullanılamaz.';
    if (isSequential(pin)) return 'Ardışık rakamlar kullanılamaz.';
    if (WEAK.indexOf(pin) !== -1) return 'Bu şifre çok kolay tahmin edilir.';
    if (pinState.value && pin === pinState.value) return 'Yeni şifre mevcut şifrenizle aynı olamaz.';
    return null;
  }

  function updateStrength() {
    var el = document.getElementById('pinStrength');
    var pin = document.getElementById('yeniPin').value;
    var repeat = document.getElementById('yeniPinTekrar').value;
    if (!pin) { el.textContent = ''; el.className = 'pin-strength'; return; }
    var problem = checkPin(pin);
    if (!problem && repeat && repeat !== pin) problem = 'Şifreler birbiriyle eşleşmiyor.';
    if (problem) {
      el.textContent = problem;
      el.className = 'pin-strength is-bad';
    } else {
      el.textContent = repeat === pin ? '✓ Şifre uygun' : 'Şifre uygun, tekrarını girin.';
      el.className = 'pin-strength is-ok';
    }
  }

  async function submitDoorPin(e) {
    e.preventDefault();
    setAlert('doorPinAlert', '', 'info');

    var body;
    if (pinState.mode === 'random') {
      if (!window.confirm('Mevcut kapı şifreniz geçersiz olacak ve yeni bir şifre oluşturulacak. Devam edilsin mi?')) return;
      body = { rastgele: true };
    } else {
      var pin = document.getElementById('yeniPin').value;
      var repeat = document.getElementById('yeniPinTekrar').value;
      var problem = checkPin(pin);
      if (problem) { setAlert('doorPinAlert', problem, 'error'); return; }
      if (pin !== repeat) { setAlert('doorPinAlert', 'Girilen şifreler birbiriyle eşleşmiyor.', 'error'); return; }
      body = { pin: pin, pinTekrar: repeat };
    }

    var btn = document.getElementById('doorPinSubmit');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor…';

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + currentUser.kullaniciId + '/kapi-sifresi', {
        method: 'PUT',
        body: body
      });
      var veri = res.veri || {};
      pinState.value = veri.yeniPin || pinState.value;
      setText('doorPinChanged', UI.formatDateTime(veri.sonDegisim || new Date()));
      var badge = document.getElementById('doorPinBadge');
      badge.textContent = 'Süresiz';
      badge.className = 'badge badge-success';
      document.getElementById('doorPinRevealBtn').disabled = false;
      document.getElementById('doorPinCopyBtn').disabled = false;
      setRevealed(true);

      var cihazlar = Array.isArray(veri.cihazlar) ? veri.cihazlar : [];
      var deviceNote = cihazlar.length
        ? ' Yeni şifre ' + cihazlar.length + ' kapı cihazına iletildi.'
        : ' Şu an çevrimiçi kapı cihazı olmadığı için şifre cihazlar bağlandığında kullanılabilir olacak.';
      setAlert('doorPinAlert', (res.mesaj || 'Kapı şifreniz güncellendi.') + deviceNote, 'success');
      UI.toast('Kapı şifreniz güncellendi.', 'success');
      document.getElementById('doorPinForm').reset();
      updateStrength();
      loadPinHistory(currentUser.kullaniciId);
    } catch (err) {
      setAlert('doorPinAlert', err.message || 'Kapı şifresi güncellenemedi.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  /* ---------------- Web paneli şifresi ---------------- */

  function wirePasswordForm() {
    var form = document.getElementById('passwordForm');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      setAlert('passwordFormAlert', '', 'info');

      var mevcutSifre = document.getElementById('mevcutSifre').value;
      var yeniSifre = document.getElementById('yeniSifre').value;
      var yeniSifreTekrar = document.getElementById('yeniSifreTekrar').value;

      if (!mevcutSifre || !yeniSifre || !yeniSifreTekrar) {
        setAlert('passwordFormAlert', 'Lütfen tüm alanları doldurun.', 'error');
        return;
      }
      if (yeniSifre !== yeniSifreTekrar) {
        setAlert('passwordFormAlert', 'Yeni şifreler birbiriyle eşleşmiyor.', 'error');
        return;
      }

      var btn = document.getElementById('passwordSubmit');
      btn.disabled = true;
      var originalText = btn.textContent;
      btn.textContent = 'Güncelleniyor…';

      try {
        var res = await API.apiRequest('/api/auth/change-password', {
          method: 'POST',
          body: { mevcutSifre: mevcutSifre, yeniSifre: yeniSifre, yeniSifreTekrar: yeniSifreTekrar }
        });
        form.reset();
        if (res.token) {
          // Diğer cihazlardaki oturumlar kapatıldı; bu oturum yeni anahtarla sürer.
          API.replaceToken(res.token);
          setAlert('passwordFormAlert', res.message || 'Şifreniz güncellendi.', 'success');
          UI.toast('Şifreniz güncellendi.', 'success');
          btn.disabled = false;
          btn.textContent = originalText;
        } else {
          setAlert('passwordFormAlert', res.message || 'Şifreniz güncellendi. Güvenliğiniz için tekrar giriş yapmanız gerekiyor.', 'success');
          UI.toast('Şifreniz güncellendi. Yönlendiriliyorsunuz…', 'success');
          setTimeout(function () {
            API.clearToken();
            location.replace('login.html');
          }, 1600);
        }
      } catch (err) {
        setAlert('passwordFormAlert', err.message || 'Şifre güncellenemedi.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  /* ---------------- Kapı şifresi geçmişi ---------------- */

  async function loadPinHistory(userId) {
    var container = document.getElementById('pinHistoryContainer');
    UI.setLoading(container, 'Kapı şifresi geçmişi yükleniyor…');

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + userId + '/pin-gecmisi?limit=25');
      var kayitlar = Array.isArray(res.kayitlar) ? res.kayitlar : [];

      if (!kayitlar.length) {
        UI.setEmpty(container, 'Kayıt bulunamadı', 'Kapı şifrenizde henüz bir değişiklik yapılmamış.');
        return;
      }

      var rows = kayitlar.map(function (k) {
        var isCurrent = Boolean(k.aktif);
        var durumBadge = isCurrent
          ? '<span class="badge badge-success">Güncel</span>'
          : '<span class="badge badge-neutral">' + UI.escapeHtml(k.durum || 'Geçmiş') + '</span>';
        var kullanim = k.kullanim || {};
        var kullanimCell;
        if (!kullanim.toplamDeneme) {
          kullanimCell = '<span class="cell-muted">Kullanılmadı</span>';
        } else {
          kullanimCell = UI.escapeHtml((kullanim.basariliKullanim || 0) + ' başarılı / ' + kullanim.toplamDeneme + ' deneme') +
            (kullanim.sonKullanim
              ? '<div class="cell-muted">son: ' + UI.escapeHtml(UI.formatDateTime(kullanim.sonKullanim)) +
                (kullanim.sonKapi ? ' — ' + UI.escapeHtml(kullanim.sonKapi) : '') + '</div>'
              : '');
        }
        return '<tr>' +
          '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(k.olusturulma)) + '</td>' +
          '<td>' + durumBadge + '</td>' +
          '<td>' + UI.escapeHtml(UI.kaynakLabel(k.kaynak)) + '</td>' +
          '<td class="cell-muted">' + (k.gecerlilikBitis ? UI.escapeHtml(UI.formatDate(k.gecerlilikBitis)) : 'Süresiz') + '</td>' +
          '<td class="wrap">' + kullanimCell + '</td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Oluşturulma</th><th>Durum</th><th>Kaynak</th><th>Geçerlilik</th><th>Kapı Kullanımı</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        '<p class="text-meta mt-sm">Güvenlik nedeniyle eski şifreler gösterilmez; güncel şifrenizi yukarıdaki kartta görebilirsiniz. ' +
        'Kullanım bilgisi çevrimiçi doğrulanan kapı girişleri için tutulur.</p>';
    } catch (err) {
      UI.setError(container, err.message, function () { loadPinHistory(userId); });
    }
  }

  /* ---------------- Yardımcılar ---------------- */

  function setAlert(id, message, type) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert alert-' + type + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>';
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
})();
