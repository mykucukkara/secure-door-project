/* SecureLab — admin.html (kullanıcı yönetimi, yalnızca yönetici) */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  var ICON = {
    edit: '<path d="M4 20h4L18.5 9.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5"></path><path d="M13.5 7.5l3 3"></path>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"></rect><path d="m4 7 8 6 8-6"></path>',
    pin: '<circle cx="8" cy="15.5" r="4"></circle><path d="M11 12.5 19 4.5M16.3 7.2l2.3 2.3M19 4.5l1.6 1.6"></path>',
    trash: '<path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12.1a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7"></path><path d="M10 11v6M14 11v6"></path>'
  };

  var state = {
    me: null,
    users: [],
    search: '',
    editingId: null
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
    state.me = user;
    window.SecureNav.init(user);

    wireModals();
    wireFilterBar();
    loadUsers();
  }

  function isSelf(id) {
    return state.me && String(state.me.kullaniciId) === String(id);
  }

  function iconBtn(action, id, title, icon, extraClass) {
    return '<button type="button" class="icon-btn btn-sm' + (extraClass ? ' ' + extraClass : '') + '" data-action="' + action +
      '" data-id="' + UI.escapeHtml(id) + '" title="' + title + '" aria-label="' + title + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg></button>';
  }

  /* ---------------- Veri ---------------- */

  async function loadUsers() {
    var container = document.getElementById('usersTableContainer');
    UI.setLoading(container, 'Kullanıcılar yükleniyor…');

    var durum = document.getElementById('filterDurum').value;
    var rol = document.getElementById('filterRol').value;
    var query = '?durum=' + encodeURIComponent(durum) + '&rol=' + encodeURIComponent(rol);

    try {
      var users = await API.apiRequest('/api/kullanicilar' + query);
      state.users = Array.isArray(users) ? users : [];
      renderUsers();
    } catch (err) {
      UI.setError(container, err.message, loadUsers);
      setText('userCountSubtitle', 'Yüklenemedi');
    }
  }

  function renderUsers() {
    var container = document.getElementById('usersTableContainer');
    var search = state.search.trim().toLocaleLowerCase('tr-TR');
    var onlyWaiting = document.getElementById('filterIlkGiris').value === 'bekliyor';

    var filtered = state.users.filter(function (u) {
      if (onlyWaiting && !u.sifreDegistirmeZorunlu) return false;
      if (!search) return true;
      var haystack = [u.unvan, u.ad, u.soyad, u.eposta].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.indexOf(search) !== -1;
    });

    var waiting = state.users.filter(function (u) { return u.sifreDegistirmeZorunlu && u.durum === 'aktif'; }).length;
    setText('userCountSubtitle', filtered.length + ' kullanıcı listeleniyor (toplam ' + state.users.length + ')' +
      (waiting ? ' · ' + waiting + ' kişi ilk girişini henüz yapmadı' : ''));

    if (!filtered.length) {
      UI.setEmpty(container, 'Kullanıcı bulunamadı', 'Arama veya filtre kriterlerinizi değiştirmeyi deneyin.');
      return;
    }

    var rows = filtered.map(function (u) {
      var self = isSelf(u.kullaniciId);
      var status = UI.renderBadge('kullaniciDurum', u.durum);
      if (u.durum === 'aktif' && u.sifreDegistirmeZorunlu) {
        status += ' <span class="badge badge-warning" title="Geçici şifreyle henüz giriş yapıp kendi şifresini belirlemedi">İlk giriş bekleniyor</span>';
      }
      var actions = iconBtn('edit', u.kullaniciId, 'Düzenle', ICON.edit);
      if (!self && u.eposta && u.durum === 'aktif') {
        actions += iconBtn('temp', u.kullaniciId, 'Yeni geçici şifre gönder', ICON.mail);
      }
      actions += iconBtn('pin', u.kullaniciId, 'Kapı şifresini yenile', ICON.pin);
      if (!self) actions += iconBtn('delete', u.kullaniciId, 'Sil / Pasife al', ICON.trash, 'icon-btn-danger');

      return '<tr>' +
        '<td><div class="cell-strong">' + UI.escapeHtml(((u.ad || '') + ' ' + (u.soyad || '')).trim()) +
          (self ? ' <span class="badge badge-neutral">Siz</span>' : '') + '</div>' +
          '<div class="cell-muted">' + UI.escapeHtml(u.unvan || '—') + '</div></td>' +
        '<td>' + UI.escapeHtml(u.eposta || '—') + '</td>' +
        '<td>' + UI.renderBadge('rol', u.rol) + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="cell-muted">' + UI.escapeHtml(u.sonGiris ? UI.formatDateTime(u.sonGiris) : 'Hiç giriş yapmadı') + '</td>' +
        '<td class="cell-actions">' + actions + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
      '<thead><tr><th>Ad Soyad</th><th>E-posta</th><th>Rol</th><th>Durum</th><th>Son Giriş</th><th>İşlemler</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    var handlers = { edit: openEditModal, temp: sendTemporaryPassword, pin: renewPin, delete: deleteUser };
    container.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fn = handlers[btn.getAttribute('data-action')];
        if (fn) fn(btn.getAttribute('data-id'));
      });
    });
  }

  /* ---------------- Filtreler ---------------- */

  function wireFilterBar() {
    var searchInput = document.getElementById('searchInput');
    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = searchInput.value;
        renderUsers();
      }, 150);
    });
    document.getElementById('filterDurum').addEventListener('change', loadUsers);
    document.getElementById('filterRol').addEventListener('change', loadUsers);
    document.getElementById('filterIlkGiris').addEventListener('change', renderUsers);
  }

  /* ---------------- Düzenleme ---------------- */

  function wireModals() {
    ['userModal', 'credentialsModal', 'pinRevealModal'].forEach(function (id) {
      UI.wireModalDismiss(document.getElementById(id));
    });
    document.getElementById('userForm').addEventListener('submit', submitUserForm);
    UI.wireCopyButton(document.getElementById('copyPinRevealBtn'), function () {
      return document.getElementById('pinRevealValue').textContent;
    });
  }

  function setFormAlert(message, type) {
    var el = document.getElementById('userFormAlert');
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert alert-' + (type || 'error') + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>';
  }

  function findUser(id) {
    return state.users.find(function (x) { return String(x.kullaniciId) === String(id); });
  }

  function openEditModal(id) {
    var u = findUser(id);
    if (!u) return;
    var self = isSelf(id);

    state.editingId = id;
    setFormAlert('', 'info');
    document.getElementById('userModalSubtitle').textContent = [u.unvan, u.ad, u.soyad].filter(Boolean).join(' ');
    document.getElementById('userUnvan').value = u.unvan || '';
    document.getElementById('userAd').value = u.ad || '';
    document.getElementById('userSoyad').value = u.soyad || '';
    document.getElementById('userEposta').value = u.eposta || '';

    var rolSelect = document.getElementById('userRol');
    rolSelect.value = u.rol === 'admin' ? 'admin' : 'hoca';
    rolSelect.disabled = self;
    var durumSelect = document.getElementById('userDurum');
    durumSelect.value = u.durum === 'pasif' ? 'pasif' : 'aktif';
    durumSelect.disabled = self;
    document.getElementById('userRolHint').textContent = self
      ? 'Kendi rolünüzü ve durumunuzu değiştiremezsiniz.'
      : 'Yöneticiler kullanıcı ekleyip silebilir ve kart yetkilendirebilir.';

    UI.openModal(document.getElementById('userModal'));
  }

  async function submitUserForm(e) {
    e.preventDefault();
    setFormAlert('', 'info');

    var u = findUser(state.editingId);
    var body = {
      unvan: document.getElementById('userUnvan').value,
      ad: document.getElementById('userAd').value.trim(),
      soyad: document.getElementById('userSoyad').value.trim(),
      eposta: document.getElementById('userEposta').value.trim() || undefined
    };
    if (!isSelf(state.editingId)) {
      body.rol = document.getElementById('userRol').value;
      body.durum = document.getElementById('userDurum').value;
    }
    if (!body.ad || !body.soyad) {
      setFormAlert('Ad ve soyad zorunludur.', 'error');
      return;
    }
    if (u && body.rol && body.rol !== u.rol) {
      var msg = body.rol === 'admin'
        ? body.ad + ' ' + body.soyad + ' kullanıcısına yönetici yetkisi verilecek. Devam edilsin mi?'
        : body.ad + ' ' + body.soyad + ' kullanıcısının yönetici yetkisi kaldırılacak. Devam edilsin mi?';
      if (!window.confirm(msg)) return;
    }

    var submitBtn = document.getElementById('userFormSubmit');
    submitBtn.disabled = true;
    var originalText = submitBtn.textContent;
    submitBtn.textContent = 'Kaydediliyor…';

    try {
      await API.apiRequest('/api/kullanicilar/' + encodeURIComponent(state.editingId), { method: 'PUT', body: body });
      UI.closeModal(document.getElementById('userModal'));
      UI.toast('Kullanıcı güncellendi.', 'success');
      loadUsers();
    } catch (err) {
      setFormAlert(err.message || 'İşlem gerçekleştirilemedi.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  /* ---------------- Geçici şifre ---------------- */

  async function sendTemporaryPassword(id) {
    var u = findUser(id);
    if (!u) return;
    var label = ((u.ad || '') + ' ' + (u.soyad || '')).trim();
    if (!window.confirm(label + ' için yeni bir geçici şifre oluşturulup ' + u.eposta +
      ' adresine gönderilecek. Kullanıcının mevcut web şifresi ve açık oturumları hemen geçersiz olur. Devam edilsin mi?')) return;

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + encodeURIComponent(id) + '/gecici-sifre', { method: 'POST' });
      var expires = res.geciciSifreBitis ? UI.formatDateTime(res.geciciSifreBitis) : '—';
      document.getElementById('credentialsModalSubtitle').textContent = label;
      var body = document.getElementById('credentialsBody');
      if (res.mailGonderildi) {
        document.getElementById('credentialsModalTitle').textContent = 'Geçici şifre gönderildi';
        body.innerHTML = '<div class="alert alert-success"><div class="alert-body">Yeni geçici şifre <strong>' +
          UI.escapeHtml(res.eposta) + '</strong> adresine gönderildi (' + UI.escapeHtml(expires) + ' tarihine kadar geçerli).</div></div>';
      } else {
        document.getElementById('credentialsModalTitle').textContent = 'Geçici şifre oluşturuldu — e-posta gönderilemedi';
        body.innerHTML = '<div class="credentials-callout">' +
          '<div class="credentials-callout-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 19.5H3L12 3.5Z"></path><path d="M12 9.5v4"></path><path d="M12 16.8h.01"></path></svg>' +
          '<span>' + UI.escapeHtml(res.mailHatasi || 'E-posta gönderilemedi.') + ' Bu şifre yalnızca şimdi gösterilir.</span></div>' +
          '<div class="credential-row"><div><div class="credential-row-label">Geçici şifre (' + UI.escapeHtml(expires) + ' tarihine kadar)</div>' +
          '<div class="credential-row-value" id="credTempPassword">' + UI.escapeHtml(res.geciciSifre || '—') + '</div></div>' +
          '<button type="button" class="copy-btn" id="copyTempBtn">Kopyala</button></div></div>';
        UI.wireCopyButton(document.getElementById('copyTempBtn'), function () {
          return document.getElementById('credTempPassword').textContent;
        });
      }
      UI.openModal(document.getElementById('credentialsModal'));
      loadUsers();
    } catch (err) {
      UI.toast(err.message || 'Geçici şifre oluşturulamadı.', 'error');
    }
  }

  /* ---------------- Kapı şifresi ---------------- */

  async function renewPin(id) {
    var u = findUser(id);
    var label = u ? ((u.ad || '') + ' ' + (u.soyad || '')) : ('#' + id);

    if (!window.confirm(label + ' için yeni bir kapı şifresi oluşturulacak. Kullanıcının mevcut kapı şifresi hemen geçersiz olur. Devam edilsin mi?')) return;

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + encodeURIComponent(id) + '/sifre-yenile', { method: 'POST' });
      var veri = res.veri || {};
      document.getElementById('pinRevealModalSubtitle').textContent = label + ' için yeni kapı şifresi oluşturuldu.';
      setText('pinRevealValue', veri.yeniPin || '—');
      setText('pinRevealValidity', veri.gecerlilikBitis ? UI.formatDate(veri.gecerlilikBitis) : 'Süresiz');
      document.getElementById('pinRevealDevices').innerHTML = '';
      UI.openModal(document.getElementById('pinRevealModal'));
      UI.toast(res.mesaj || 'Kapı şifresi yenilendi.', 'success');
    } catch (err) {
      UI.toast(err.message || 'Kapı şifresi yenilenemedi.', 'error');
    }
  }

  /* ---------------- Silme / pasife alma ---------------- */

  async function deleteUser(id) {
    var u = findUser(id);
    var label = u ? ((u.ad || '') + ' ' + (u.soyad || '')) : ('#' + id);

    if (!window.confirm(label + ' kullanıcısını silmek istediğinize emin misiniz?\n\nGeçmiş erişim kayıtları olan hesaplar silinmez; pasife alınır ve kartları kapatılır.')) return;

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + encodeURIComponent(id), { method: 'DELETE' });
      if (res && res.pasifeAlindi) {
        UI.toast('Geçmiş kayıtları olduğu için hesap pasife alındı ve kartları kapatıldı.', 'warning');
      } else {
        UI.toast((res && res.mesaj) || 'Kullanıcı silindi.', 'success');
      }
      loadUsers();
    } catch (err) {
      UI.toast(err.message || 'Kullanıcı silinemedi.', 'error');
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
})();
