/* SecureLab — Kart Yetkilendirme formu (yetkilendirme.html içinde)
   ESP32 + RC522 istasyonu seri porta "UID:04:A1:B2:C3" satırı yazar.
   Chrome/Edge'deki Web Serial API ile istasyona bağlanıp bu satırı okur,
   UID'yi kullanıcıya atar (POST /api/kartlar/onayla). Web Serial yoksa UID
   elle girilebilir. */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  var BAUD_RATE = 115200;
  var LOG_MAX_LINES = 120;

  var state = {
    users: [],
    selectedUserId: '',
    uid: null,          // normalize edilmiş UID
    lookup: null,       // /api/kartlar/sorgula sonucu
    onSaved: null,
    lookupSeq: 0,
    port: null,
    reader: null,
    keepReading: false,
    logLines: []
  };

  /**
   * Kart Yetkilendirme sayfası (yetkilendirme.html) oturum kontrolünü yaptıktan
   * sonra formu buradan başlatır. opts.onSaved: kart tanımlanınca çağrılır.
   */
  function mount(opts) {
    state.onSaved = (opts && opts.onSaved) || null;
    wireForm();
    wireStation();
    loadUsers();
    loadRecentCards();
  }

  /* ---------------- UID yardımcıları ---------------- */

  function normalizeUid(raw) {
    var hex = String(raw || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    if (!hex || hex.length % 2 !== 0) return null;
    var bytes = hex.length / 2;
    if ([4, 7, 10].indexOf(bytes) === -1) return null;
    return hex.match(/.{2}/g).join(':');
  }

  function setUid(raw, source) {
    var input = document.getElementById('kartUid');
    var normalized = normalizeUid(raw);
    if (source !== 'input') input.value = normalized || String(raw || '');
    state.uid = normalized;
    state.uidSource = normalized ? source : null;

    var display = document.getElementById('uidDisplay');
    var valueEl = document.getElementById('uidDisplayValue');
    var metaEl = document.getElementById('uidDisplayMeta');

    if (normalized) {
      valueEl.textContent = normalized;
      metaEl.textContent = source === 'serial'
        ? 'İstasyondan okundu · ' + new Date().toLocaleTimeString('tr-TR')
        : source === 'door' ? 'Kapı okuyucusundaki son kart'
        : source === 'pending' ? 'Onay bekleyen kartlardan seçildi' : 'Elle girildi';
      display.classList.add('has-uid');
      if (source === 'serial' || source === 'door' || source === 'pending') {
        display.classList.remove('is-flash');
        void display.offsetWidth; // animasyonu yeniden başlat
        display.classList.add('is-flash');
      }
      lookupCard(normalized);
    } else {
      valueEl.textContent = input.value ? input.value.toUpperCase() : '— — — —';
      metaEl.textContent = input.value
        ? 'UID biçimi geçersiz. 4, 7 veya 10 baytlık HEX değer girin (ör. 04:A1:B2:C3).'
        : 'İstasyonun ekranındaki / seri çıktısındaki UID\'yi aşağıya yazın.';
      display.classList.remove('has-uid');
      state.lookup = null;
      document.getElementById('lookupResult').innerHTML = '';
    }
    updateSubmitState();
  }

  async function lookupCard(uid) {
    var seq = ++state.lookupSeq;
    var box = document.getElementById('lookupResult');
    box.innerHTML = '<span class="text-meta">Kart sorgulanıyor…</span>';
    try {
      var res = await API.apiRequest('/api/kartlar/sorgula/' + encodeURIComponent(uid));
      if (seq !== state.lookupSeq) return;
      state.lookup = res;
      box.innerHTML = renderLookup(res);
    } catch (err) {
      if (seq !== state.lookupSeq) return;
      state.lookup = null;
      box.innerHTML = '<div class="alert alert-error"><div class="alert-body">' + UI.escapeHtml(err.message) + '</div></div>';
    }
    updateSubmitState();
  }

  function renderLookup(res) {
    if (res.yetki && res.yetki.kullanici) {
      var k = res.yetki.kullanici;
      var name = ((k.ad || '') + ' ' + (k.soyad || '')).trim();
      var active = res.yetki.durum === 'aktif';
      return '<div class="alert alert-' + (active ? 'warning' : 'info') + '"><div class="alert-body">' +
        'Bu kart <strong>' + UI.escapeHtml(name) + '</strong> kullanıcısına tanımlı (' +
        UI.escapeHtml(active ? 'aktif' : res.yetki.durum) + '). ' +
        'Başka bir kullanıcı seçip kaydederseniz kart o kullanıcıya aktarılır.' +
        '</div></div>';
    }
    if (res.kayitli && res.kartDurum === 'onay_bekliyor') {
      return '<div class="alert alert-info"><div class="alert-body">Bu kart kapıda okutulmuş ve onay bekliyor. Kullanıcı seçip tanımlayabilirsiniz.</div></div>';
    }
    return '<div class="alert alert-success"><div class="alert-body">Yeni kart — sistemde kaydı yok. Kullanıcı seçip tanımlayabilirsiniz.</div></div>';
  }

  function updateSubmitState() {
    document.getElementById('kartSubmit').disabled = !(state.uid && state.selectedUserId);
  }

  /* ---------------- Form ---------------- */

  function wireForm() {
    var input = document.getElementById('kartUid');
    var debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { setUid(input.value, 'input'); }, 250);
    });
    input.addEventListener('blur', function () {
      var normalized = normalizeUid(input.value);
      if (normalized) input.value = normalized;
    });

    document.getElementById('clearUidBtn').addEventListener('click', function () {
      input.value = '';
      setUid('', 'input');
      input.focus();
    });

    document.getElementById('userFilter').addEventListener('input', renderUserOptions);
    document.getElementById('userSelect').addEventListener('change', function (e) {
      selectUser(e.target.value);
    });

    document.getElementById('useLastDoorScanBtn').addEventListener('click', useLastDoorScan);
    document.getElementById('kartForm').addEventListener('submit', submitCard);
  }

  async function loadUsers() {
    var select = document.getElementById('userSelect');
    select.innerHTML = '<option disabled>Kullanıcılar yükleniyor…</option>';
    try {
      var users = await API.apiRequest('/api/kullanicilar?durum=aktif');
      state.users = (Array.isArray(users) ? users : [])
        .filter(function (u) { return u.durum === 'aktif'; })
        .sort(function (a, b) {
          return ((a.ad || '') + ' ' + (a.soyad || '')).localeCompare((b.ad || '') + ' ' + (b.soyad || ''), 'tr');
        });
      renderUserOptions();
    } catch (err) {
      select.innerHTML = '<option disabled>Kullanıcı listesi alınamadı</option>';
      UI.toast(err.message || 'Kullanıcı listesi alınamadı.', 'error');
    }
  }

  function userLabel(u) {
    var name = ((u.ad || '') + ' ' + (u.soyad || '')).trim();
    return name + (u.unvan ? ' (' + u.unvan + ')' : '') + (u.eposta ? ' — ' + u.eposta : '');
  }

  function renderUserOptions() {
    var select = document.getElementById('userSelect');
    var q = document.getElementById('userFilter').value.trim().toLocaleLowerCase('tr-TR');
    var list = state.users.filter(function (u) {
      if (!q) return true;
      var hay = ((u.ad || '') + ' ' + (u.soyad || '') + ' ' + (u.eposta || '')).toLocaleLowerCase('tr-TR');
      return hay.indexOf(q) !== -1;
    });
    if (!list.length) {
      select.innerHTML = '<option disabled>Eşleşen kullanıcı yok</option>';
      return;
    }
    select.innerHTML = list.map(function (u) {
      var sel = String(u.kullaniciId) === String(state.selectedUserId) ? ' selected' : '';
      return '<option value="' + UI.escapeHtml(u.kullaniciId) + '"' + sel + '>' + UI.escapeHtml(userLabel(u)) + '</option>';
    }).join('');
    // Tek eşleşme kaldıysa otomatik seç.
    if (list.length === 1 && q) {
      select.value = String(list[0].kullaniciId);
      selectUser(select.value);
    }
  }

  function selectUser(id) {
    state.selectedUserId = id;
    var hint = document.getElementById('selectedUserHint');
    var user = state.users.find(function (u) { return String(u.kullaniciId) === String(id); });
    if (hint) {
      hint.textContent = user ? 'Seçilen: ' + userLabel(user) : 'Listeden bir kişi seçin.';
      hint.classList.toggle('is-selected', Boolean(user));
    }
    updateSubmitState();
  }

  async function useLastDoorScan() {
    try {
      var res = await API.apiRequest('/api/kartlar/son-okutulan');
      if (!res || !res.okunanUid) {
        UI.toast('Kapıda okutulmuş kart bulunamadı.', 'warning');
        return;
      }
      setUid(res.okunanUid, 'door');
      UI.toast('Son okutulan kart: ' + res.okunanUid, 'info');
    } catch (err) {
      UI.toast(err.message || 'Son okutulan kart alınamadı.', 'error');
    }
  }

  async function submitCard(e) {
    e.preventDefault();
    setAlert('', 'info');
    if (!state.uid) { setAlert('Geçerli bir kart UID girin veya kartı okutun.', 'error'); return; }
    if (!state.selectedUserId) { setAlert('Kartın tanımlanacağı kullanıcıyı seçin.', 'error'); return; }

    var user = state.users.find(function (u) { return String(u.kullaniciId) === String(state.selectedUserId); });
    var userName = user ? ((user.ad || '') + ' ' + (user.soyad || '')).trim() : '#' + state.selectedUserId;

    var existing = state.lookup && state.lookup.yetki && state.lookup.yetki.kullanici;
    if (existing && String(existing.kullaniciId) !== String(state.selectedUserId)) {
      var oldName = ((existing.ad || '') + ' ' + (existing.soyad || '')).trim();
      if (!window.confirm('Bu kart şu an ' + oldName + ' kullanıcısına tanımlı. ' + userName + ' kullanıcısına aktarılsın mı?')) return;
    }

    var btn = document.getElementById('kartSubmit');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Tanımlanıyor…';

    try {
      var res = await API.apiRequest('/api/kartlar/onayla', {
        method: 'POST',
        body: { kartUid: state.uid, userId: state.selectedUserId, kaynak: state.uidSource === 'serial' ? 'istasyon' : 'panel' }
      });
      setAlert((res.message || 'Kart tanımlandı.') + ' (' + state.uid + ' → ' + userName + ')', 'success');
      UI.toast('Kart ' + userName + ' kullanıcısına tanımlandı.', 'success');
      appendLog('✓ ' + state.uid + ' → ' + userName + ' olarak tanımlandı', true);
      lookupCard(state.uid);
      loadRecentCards();
      if (typeof state.onSaved === 'function') state.onSaved(state.uid);
    } catch (err) {
      setAlert(err.message || 'Kart tanımlanamadı.', 'error');
    } finally {
      btn.textContent = originalText;
      updateSubmitState();
    }
  }

  function setAlert(message, type) {
    var el = document.getElementById('kartAlert');
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert alert-' + type + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>';
  }

  /* ---------------- Son tanımlanan kartlar ---------------- */

  async function loadRecentCards() {
    var container = document.getElementById('recentCardsContainer');
    if (!container) return;
    try {
      var list = await API.apiRequest('/api/kart-yetkilendirmeler');
      list = (Array.isArray(list) ? list : []).slice(0, 10);
      if (!list.length) {
        UI.setEmpty(container, 'Henüz tanımlı kart yok', 'İlk kartı yukarıdaki formdan tanımlayabilirsiniz.');
        return;
      }
      var rows = list.map(function (p) {
        var k = p.kullanici || {};
        var name = ((k.ad || '') + ' ' + (k.soyad || '')).trim() || '—';
        return '<tr>' +
          '<td><code class="pin-cell">' + UI.escapeHtml(p.kartUid) + '</code></td>' +
          '<td>' + UI.escapeHtml(name) + (k.eposta ? '<div class="cell-muted">' + UI.escapeHtml(k.eposta) + '</div>' : '') + '</td>' +
          '<td>' + UI.renderBadge('genelDurum', p.durum, p.durum === 'iptal' ? { label: 'İptal' } : undefined) + '</td>' +
          '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(p.yetkilendirilmeTarihi)) + '</td>' +
          '<td class="cell-muted wrap">' + UI.escapeHtml(p.notlar || '—') + '</td>' +
          '</tr>';
      }).join('');
      container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Kart UID</th><th>Kullanıcı</th><th>Durum</th><th>Tanımlanma</th><th>Not</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
    } catch (err) {
      UI.setError(container, err.message, loadRecentCards);
    }
  }

  /* ---------------- Web Serial: istasyon bağlantısı ---------------- */

  function serialSupported() {
    return 'serial' in navigator && window.isSecureContext;
  }

  function wireStation() {
    var btn = document.getElementById('stationConnectBtn');
    if (!serialSupported()) {
      btn.disabled = true;
      setStationStatus('Tarayıcı desteklemiyor', 'error');
      document.getElementById('serialSupportAlert').innerHTML =
        '<div class="alert alert-warning mb-md"><div class="alert-body">' +
        'Bu tarayıcı istasyona doğrudan bağlanmayı (Web Serial) desteklemiyor. ' +
        '<strong>Chrome</strong> veya <strong>Edge</strong> ile <strong>http://localhost</strong> adresinden açın ' +
        'ya da seri monitördeki UID\'yi aşağıdaki alana yapıştırın.' +
        '</div></div>';
      document.getElementById('serialLog').textContent = 'Web Serial kullanılamıyor.';
      return;
    }

    btn.addEventListener('click', function () {
      if (state.port) disconnect();
      else connect();
    });

    navigator.serial.addEventListener('disconnect', function (e) {
      if (state.port && e.target === state.port) {
        appendLog('! İstasyon USB bağlantısı kesildi.');
        cleanupConnection();
      }
    });
  }

  function setStationStatus(text, kind) {
    var el = document.getElementById('stationStatus');
    el.textContent = text;
    el.className = 'station-status' + (kind === 'ok' ? ' is-connected' : kind === 'error' ? ' is-error' : '');
  }

  async function connect() {
    var btn = document.getElementById('stationConnectBtn');
    try {
      var port = await navigator.serial.requestPort();
      btn.disabled = true;
      setStationStatus('Bağlanıyor…');
      await port.open({ baudRate: BAUD_RATE });
      // ESP32'yi reset durumunda tutmamak için DTR/RTS sinyallerini bırak.
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) { /* bazı sürücüler desteklemez */ }

      state.port = port;
      state.keepReading = true;
      state.logLines = [];
      appendLog('● İstasyona bağlanıldı (' + BAUD_RATE + ' baud). Kartı okutun.');
      setStationStatus('İstasyon bağlı', 'ok');
      document.getElementById('stationConnectText').textContent = 'Bağlantıyı Kes';
      btn.classList.remove('btn-accent');
      btn.classList.add('btn-secondary');
      readLoop();
    } catch (err) {
      if (err && err.name === 'NotFoundError') {
        setStationStatus('İstasyon bağlı değil');
      } else {
        setStationStatus('Bağlanılamadı', 'error');
        var msg = err && err.name === 'NetworkError'
          ? 'Port açılamadı. Seri monitör (PlatformIO/Arduino) açıksa kapatıp tekrar deneyin.'
          : (err && err.message) || 'İstasyona bağlanılamadı.';
        UI.toast(msg, 'error');
        appendLog('! ' + msg);
      }
      state.port = null;
    } finally {
      btn.disabled = false;
    }
  }

  async function readLoop() {
    var decoder = new TextDecoder();
    var buffer = '';
    while (state.port && state.keepReading && state.port.readable) {
      state.reader = state.port.readable.getReader();
      try {
        for (;;) {
          var result = await state.reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          lines.forEach(handleLine);
        }
      } catch (err) {
        if (state.keepReading) appendLog('! Okuma hatası: ' + (err.message || err));
      } finally {
        try { state.reader.releaseLock(); } catch (e) { /* yoksay */ }
        state.reader = null;
      }
      if (!state.keepReading) break;
    }
  }

  function handleLine(line) {
    var text = String(line || '').replace(/\s+$/, '');
    if (!text) return;
    var match = text.match(/^UID:\s*([0-9A-Fa-f:]+)\s*$/);
    if (match) {
      appendLog('▶ ' + text, true);
      setUid(match[1], 'serial');
      return;
    }
    // Süs çizgilerini kayda yazma, geri kalanını göster.
    if (/^[=\-]{8,}$/.test(text)) return;
    appendLog(text);
  }

  async function disconnect() {
    state.keepReading = false;
    try { if (state.reader) await state.reader.cancel(); } catch (e) { /* yoksay */ }
    try { if (state.port) await state.port.close(); } catch (e) { /* yoksay */ }
    appendLog('○ Bağlantı kapatıldı.');
    cleanupConnection();
  }

  function cleanupConnection() {
    state.keepReading = false;
    state.port = null;
    state.reader = null;
    setStationStatus('İstasyon bağlı değil');
    document.getElementById('stationConnectText').textContent = 'İstasyona Bağlan';
    var btn = document.getElementById('stationConnectBtn');
    btn.classList.add('btn-accent');
    btn.classList.remove('btn-secondary');
  }

  function appendLog(text, highlight) {
    state.logLines.push({ text: text, highlight: Boolean(highlight) });
    if (state.logLines.length > LOG_MAX_LINES) state.logLines.shift();
    var log = document.getElementById('serialLog');
    log.innerHTML = state.logLines.map(function (l) {
      var safe = UI.escapeHtml(l.text);
      return l.highlight ? '<span class="log-uid">' + safe + '</span>' : safe;
    }).join('\n');
    log.scrollTop = log.scrollHeight;
  }

  window.addEventListener('beforeunload', function () {
    if (state.port) disconnect();
  });

  window.KartForm = {
    mount: mount,
    setUid: function (uid, source) {
      var input = document.getElementById('kartUid');
      if (input) input.value = uid;
      setUid(uid, source || 'door');
      var filter = document.getElementById('userFilter');
      if (filter) filter.focus();
    }
  };
})();
