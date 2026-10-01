/* SecureLab — yetkilendirme.html (Kart Yetkilendirme, yalnızca yönetici)
   Üstte kart ID + kişi seçimi formu (kart-kayit.js → window.KartForm),
   yanında kapıda okutulup onay bekleyen kartlar, altta tanımlı kartlar. */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  var pollTimer = null;
  var pendingRefreshInFlight = false;
  var lastPendingSignature = '';
  var permissions = [];
  var POLL_INTERVAL = 4000;

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('beforeunload', stopPolling);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopPolling();
    else startPolling();
  });

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

    if (window.KartForm) {
      window.KartForm.mount({
        onSaved: function () {
          loadPending();
          loadPermissions();
        }
      });
    }

    var search = document.getElementById('permissionsSearch');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(renderPermissions, 150);
    });

    // Web Serial API (USB Masaüstü Kart Kayıt İstasyonu) Entegrasyonu
    initWebSerialStation();

    loadPending();
    loadPermissions();
    startPolling();
  }

  function initWebSerialStation() {
    var connectBtn = document.getElementById('stationConnectBtn');
    if (!connectBtn) return;

    if (!('serial' in navigator)) {
      var alertBox = document.getElementById('serialSupportAlert');
      if (alertBox) {
        alertBox.innerHTML = '<div class="security-note" style="margin-bottom: 20px;">⚠️ Tarayıcınız Web Serial API desteklemiyor. Lütfen Google Chrome veya Microsoft Edge kullanın.</div>';
      }
      connectBtn.disabled = true;
      return;
    }

    connectBtn.addEventListener('click', async function () {
      try {
        var port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        document.getElementById('stationStatus').textContent = 'İstasyon bağlı';
        document.getElementById('stationConnectText').textContent = 'Bağlı';
        connectBtn.classList.add('btn-danger');

        var textDecoder = new TextDecoderStream();
        port.readable.pipeTo(textDecoder.writable);
        var reader = textDecoder.readable.getReader();
        var buffer = '';

        while (true) {
          var res = await reader.read();
          if (res.done) break;
          
          buffer += res.value;
          var lines = buffer.split('\n');
          buffer = lines.pop();

          for (var i = 0; i < lines.length; i++) {
            var cleanLine = lines[i].trim();
            if (cleanLine) {
              var serialLog = document.getElementById('serialLog');
              if (serialLog) {
                if (serialLog.textContent === 'Bağlantı bekleniyor…') serialLog.textContent = '';
                serialLog.innerHTML += '<div>> ' + UI.escapeHtml(cleanLine) + '</div>';
                serialLog.scrollTop = serialLog.scrollHeight;
              }
            }
            
            if (cleanLine.indexOf('UID:') === 0) {
              var uid = cleanLine.replace('UID:', '').trim();
              var kartUidInput = document.getElementById('kartUid');
              var uidDisplayValue = document.getElementById('uidDisplayValue');
              var kartSubmit = document.getElementById('kartSubmit');

              if (kartUidInput) {
                kartUidInput.value = uid;
                kartUidInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              if (uidDisplayValue) uidDisplayValue.textContent = uid;
              if (kartSubmit) kartSubmit.disabled = false;

              if (window.KartForm && typeof window.KartForm.setUid === 'function') {
                window.KartForm.setUid(uid, 'station');
              }
            }
          }
        }
      } catch (err) {
        if (err.name !== 'NotFoundError') {
          console.error('İstasyon bağlantı hatası:', err);
        }
      }
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { loadPending(true); }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function loadPending(silent) {
    var container = document.getElementById('pendingContainer');
    if (!container || pendingRefreshInFlight) return;
    pendingRefreshInFlight = true;
    if (!silent) UI.setLoading(container, 'Onay bekleyen kartlar yükleniyor…');

    try {
      var res = await API.apiRequest('/api/kartlar/onay-bekleyenler');
      var list = Array.isArray(res.data) ? res.data : [];
      var signature = list.map(function (k) { return k.kartUid + '@' + k.sonOkutmaZamani; }).join('|');
      if (silent && signature === lastPendingSignature) return;
      lastPendingSignature = signature;

      if (!list.length) {
        UI.setEmpty(container, 'Onay bekleyen kart yok', 'Kapıda tanımsız bir kart okutulduğunda burada görünür.');
        return;
      }

      var rows = list.map(function (k) {
        var uid = UI.escapeHtml(k.kartUid || '—');
        return '<tr>' +
          '<td><code class="pin-cell">' + uid + '</code></td>' +
          '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(k.sonOkutmaZamani)) + '</td>' +
          '<td class="cell-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="use" data-uid="' + uid + '">Sahibini Seç</button>' +
            '<button type="button" class="btn btn-danger-ghost btn-sm" data-action="reject" data-uid="' + uid + '">Reddet</button>' +
          '</td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Kart ID</th><th>Son Okutma</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';

      container.querySelectorAll('[data-action="use"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (window.KartForm) window.KartForm.setUid(btn.getAttribute('data-uid'), 'pending');
          var form = document.getElementById('kart-tanimla');
          if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      container.querySelectorAll('[data-action="reject"]').forEach(function (btn) {
        btn.addEventListener('click', function () { rejectCard(btn.getAttribute('data-uid')); });
      });
    } catch (err) {
      if (!silent) UI.setError(container, err.message, loadPending);
    } finally {
      pendingRefreshInFlight = false;
    }
  }

  async function rejectCard(kartUid) {
    if (!window.confirm(kartUid + ' ID\'li kartın isteğini reddetmek istediğinize emin misiniz?')) return;
    try {
      var res = await API.apiRequest('/api/kartlar/reddet', { method: 'POST', body: { kartUid: kartUid } });
      UI.toast(res.message || 'Kart reddedildi.', 'success');
      loadPending();
    } catch (err) {
      UI.toast(err.message || 'Kart reddedilemedi.', 'error');
    }
  }

  async function loadPermissions() {
    var container = document.getElementById('permissionsContainer');
    UI.setLoading(container, 'Tanımlı kartlar yükleniyor…');
    try {
      var list = await API.apiRequest('/api/kart-yetkilendirmeler');
      permissions = Array.isArray(list) ? list : [];
      renderPermissions();
    } catch (err) {
      UI.setError(container, err.message, loadPermissions);
    }
  }

  function renderPermissions() {
    var container = document.getElementById('permissionsContainer');
    var q = document.getElementById('permissionsSearch').value.trim().toLocaleLowerCase('tr-TR');
    var list = permissions.filter(function (y) {
      if (!q) return true;
      var k = y.kullanici || {};
      var hay = [k.ad, k.soyad, k.eposta, y.kartUid].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return hay.indexOf(q) !== -1;
    });

    document.getElementById('permissionsSubtitle').textContent =
      permissions.length + ' kart tanımlı · Duruma tıklayarak kartı geçici olarak kapatıp açabilirsiniz';

    if (!list.length) {
      UI.setEmpty(container,
        permissions.length ? 'Eşleşen kart yok' : 'Henüz tanımlı kart yok',
        permissions.length ? 'Arama ifadesini değiştirin.' : 'İlk kartı yukarıdaki formdan yetkilendirebilirsiniz.');
      return;
    }

    var rows = list.map(function (y) {
      var rowId = y.kartYetkiId;
      var k = y.kullanici || {};
      var name = ((k.ad || '') + ' ' + (k.soyad || '')).trim() || '—';
      var info = UI.badgeInfo('genelDurum', y.durum);
      return '<tr>' +
        '<td><div class="cell-strong">' + UI.escapeHtml(name) + '</div>' +
          (k.eposta ? '<div class="cell-muted">' + UI.escapeHtml(k.eposta) + '</div>' : '') + '</td>' +
        '<td><code class="pin-cell">' + UI.escapeHtml(y.kartUid || '—') + '</code></td>' +
        '<td><button type="button" class="badge badge-btn badge-' + info.variant + '" data-action="toggle" data-id="' +
          UI.escapeHtml(rowId) + '" data-durum="' + UI.escapeHtml(y.durum || '') + '" title="Durumu değiştir">' + UI.escapeHtml(info.label) + '</button></td>' +
        '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(y.yetkilendirilmeTarihi)) + '</td>' +
        '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(y.sonKullanilmaTarihi)) + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
      '<thead><tr><th>Kart Sahibi</th><th>Kart ID</th><th>Durum</th><th>Yetkilendirme</th><th>Son Kullanım</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    container.querySelectorAll('[data-action="toggle"]').forEach(function (btn) {
      btn.addEventListener('click', function () { toggleDurum(btn); });
    });
  }

  async function toggleDurum(btn) {
    var id = btn.getAttribute('data-id');
    var current = btn.getAttribute('data-durum');
    var next = current === 'aktif' ? 'pasif' : 'aktif';
    btn.disabled = true;
    try {
      await API.apiRequest('/api/kart-yetkilendirmeler/' + encodeURIComponent(id), { method: 'PUT', body: { durum: next } });
      var item = permissions.find(function (p) { return String(p.kartYetkiId) === String(id); });
      if (item) item.durum = next;
      renderPermissions();
      UI.toast(next === 'aktif' ? 'Kart yeniden açıldı.' : 'Kart geçici olarak kapatıldı.', 'success');
    } catch (err) {
      UI.toast(err.message || 'Durum güncellenemedi.', 'error');
      btn.disabled = false;
    }
  }
})();