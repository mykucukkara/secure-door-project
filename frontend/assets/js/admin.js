/* SecureLab — admin.html (user management, admin only) */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  var state = {
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

    window.SecureNav.init(user);

    wireModals();
    wireFilterBar();
    wireNewUserButton();

    loadUsers();
  }

  /* ---------------- Data loading ---------------- */

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
    var search = state.search.trim().toLowerCase();

    var filtered = state.users.filter(function (u) {
      if (!search) return true;
      var haystack = [u.ad, u.soyad, u.eposta].filter(Boolean).join(' ').toLowerCase();
      return haystack.indexOf(search) !== -1;
    });

    setText('userCountSubtitle', filtered.length + ' kullanıcı listeleniyor (toplam ' + state.users.length + ')');

    if (!filtered.length) {
      UI.setEmpty(container, 'Kullanıcı bulunamadı', 'Arama veya filtre kriterlerinizi değiştirmeyi deneyin.');
      return;
    }

    var rows = filtered.map(function (u) {
      var birimText = (u.birim && u.birim.ad) ? u.birim.ad : (u.birimId ? ('Birim #' + u.birimId) : '—');
      return '<tr>' +
        '<td>' + UI.escapeHtml((u.ad || '') + ' ' + (u.soyad || '')) + '</td>' +
        '<td>' + UI.escapeHtml(u.eposta || '—') + '</td>' +
        '<td>' + UI.escapeHtml(birimText) + '</td>' +
        '<td>' + UI.renderBadge('rol', u.rol) + '</td>' +
        '<td>' + UI.renderBadge('kullaniciDurum', u.durum) + '</td>' +
        '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(u.pinSonDegisim)) + '</td>' +
        '<td class="cell-actions">' +
          '<button type="button" class="icon-btn btn-sm" data-action="edit" data-id="' + u.kullaniciId + '" title="Düzenle" aria-label="Düzenle">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5"></path><path d="M13.5 7.5l3 3"></path></svg>' +
          '</button>' +
          '<button type="button" class="icon-btn btn-sm" data-action="pin" data-id="' + u.kullaniciId + '" title="Kapı şifresini yenile" aria-label="Kapı şifresini yenile">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15.5" r="4"></circle><path d="M11 12.5 19 4.5M16.3 7.2l2.3 2.3M19 4.5l1.6 1.6"></path></svg>' +
          '</button>' +
          '<button type="button" class="icon-btn btn-sm" data-action="delete" data-id="' + u.kullaniciId + '" title="Sil / Pasife Al" aria-label="Sil">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12.1a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7"></path><path d="M10 11v6M14 11v6"></path></svg>' +
          '</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
      '<thead><tr><th>Ad Soyad</th><th>E-posta</th><th>Birim</th><th>Rol</th><th>Durum</th><th>Kapı Şifresi Değişimi</th><th>İşlemler</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    container.querySelectorAll('[data-action="edit"]').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditModal(btn.getAttribute('data-id')); });
    });
    container.querySelectorAll('[data-action="pin"]').forEach(function (btn) {
      btn.addEventListener('click', function () { renewPin(btn.getAttribute('data-id')); });
    });
    container.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteUser(btn.getAttribute('data-id')); });
    });
  }

  /* ---------------- Filters ---------------- */

  function wireFilterBar() {
    var searchInput = document.getElementById('searchInput');
    var durumSelect = document.getElementById('filterDurum');
    var rolSelect = document.getElementById('filterRol');

    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = searchInput.value;
        renderUsers();
      }, 150);
    });

    durumSelect.addEventListener('change', loadUsers);
    rolSelect.addEventListener('change', loadUsers);
  }

  /* ---------------- Create / edit modal ---------------- */

  function wireNewUserButton() {
    document.getElementById('newUserBtn').addEventListener('click', openCreateModal);
  }

  function wireModals() {
    ['userModal', 'credentialsModal', 'pinRevealModal'].forEach(function (id) {
      UI.wireModalDismiss(document.getElementById(id));
    });

    document.getElementById('userForm').addEventListener('submit', submitUserForm);

    UI.wireCopyButton(document.getElementById('copyPasswordBtn'), function () {
      return document.getElementById('credInitialPassword').textContent;
    });
    UI.wireCopyButton(document.getElementById('copyPinBtn'), function () {
      return document.getElementById('credInitialPin').textContent;
    });
    UI.wireCopyButton(document.getElementById('copyPinRevealBtn'), function () {
      return document.getElementById('pinRevealValue').textContent;
    });
  }

  function setFormAlert(message, type) {
    var el = document.getElementById('userFormAlert');
    if (!message) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert alert-' + (type || 'error') + '"><div class="alert-body">' + UI.escapeHtml(message) + '</div></div>';
  }

  function openCreateModal() {
    state.editingId = null;
    setFormAlert('', 'info');
    document.getElementById('userModalTitle').textContent = 'Yeni Kullanıcı';
    document.getElementById('userModalSubtitle').textContent = 'Yeni bir kullanıcı hesabı oluşturun.';
    document.getElementById('userForm').reset();
    document.getElementById('userAd').value = '';
    document.getElementById('userSoyad').value = '';
    document.getElementById('userEposta').value = '';
    document.getElementById('userBirimId').value = '';

    var rolSelect = document.getElementById('userRol');
    rolSelect.value = 'hoca';
    var adminOpt = rolSelect.querySelector('option[value="admin"]');
    if (adminOpt) adminOpt.disabled = true;
    document.getElementById('userRolHint').hidden = false;

    document.getElementById('userDurumField').hidden = true;
    document.getElementById('userDurum').value = 'aktif';

    document.getElementById('userFormSubmit').textContent = 'Oluştur';
    UI.openModal(document.getElementById('userModal'));
  }

  function openEditModal(id) {
    var u = state.users.find(function (x) { return String(x.kullaniciId) === String(id); });
    if (!u) return;

    state.editingId = id;
    setFormAlert('', 'info');
    document.getElementById('userModalTitle').textContent = 'Kullanıcıyı Düzenle';
    document.getElementById('userModalSubtitle').textContent = (u.ad || '') + ' ' + (u.soyad || '');
    document.getElementById('userAd').value = u.ad || '';
    document.getElementById('userSoyad').value = u.soyad || '';
    document.getElementById('userEposta').value = u.eposta || '';
    document.getElementById('userBirimId').value = u.birimId || '';

    var rolSelect = document.getElementById('userRol');
    var adminOpt = rolSelect.querySelector('option[value="admin"]');
    if (adminOpt) adminOpt.disabled = false;
    rolSelect.value = u.rol === 'admin' ? 'admin' : 'hoca';
    document.getElementById('userRolHint').hidden = true;

    document.getElementById('userDurumField').hidden = false;
    document.getElementById('userDurum').value = u.durum === 'pasif' ? 'pasif' : 'aktif';

    document.getElementById('userFormSubmit').textContent = 'Kaydet';
    UI.openModal(document.getElementById('userModal'));
  }

  async function submitUserForm(e) {
    e.preventDefault();
    setFormAlert('', 'info');

    var ad = document.getElementById('userAd').value.trim();
    var soyad = document.getElementById('userSoyad').value.trim();
    var eposta = document.getElementById('userEposta').value.trim();
    var birimIdRaw = document.getElementById('userBirimId').value;
    var rol = document.getElementById('userRol').value;
    var durum = document.getElementById('userDurum').value;

    if (!ad || !soyad) {
      setFormAlert('Ad ve soyad zorunludur.', 'error');
      return;
    }

    var submitBtn = document.getElementById('userFormSubmit');
    submitBtn.disabled = true;
    var originalText = submitBtn.textContent;
    submitBtn.textContent = 'Kaydediliyor…';

    try {
      if (state.editingId) {
        var body = {
          ad: ad,
          soyad: soyad,
          eposta: eposta || undefined,
          birimId: birimIdRaw ? Number(birimIdRaw) : undefined,
          rol: rol,
          durum: durum
        };
        await API.apiRequest('/api/kullanicilar/' + state.editingId, { method: 'PUT', body: body });
        UI.closeModal(document.getElementById('userModal'));
        UI.toast('Kullanıcı güncellendi.', 'success');
        loadUsers();
      } else {
        var createBody = {
          ad: ad,
          soyad: soyad,
          eposta: eposta || undefined,
          birimId: birimIdRaw ? Number(birimIdRaw) : undefined,
          rol: 'hoca'
        };
        var res = await API.apiRequest('/api/kullanicilar', { method: 'POST', body: createBody });
        UI.closeModal(document.getElementById('userModal'));
        UI.toast('Kullanıcı oluşturuldu.', 'success');
        showCredentials(res);
        loadUsers();
      }
    } catch (err) {
      setFormAlert(err.message || 'İşlem gerçekleştirilemedi.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  function showCredentials(res) {
    setText('credInitialPassword', res.initialPassword || '—');
    setText('credInitialPin', res.initialPin || '—');
    UI.openModal(document.getElementById('credentialsModal'));
  }

  /* ---------------- PIN yenile ---------------- */

  async function renewPin(id) {
    var u = state.users.find(function (x) { return String(x.kullaniciId) === String(id); });
    var label = u ? ((u.ad || '') + ' ' + (u.soyad || '')) : ('#' + id);

    if (!window.confirm(label + ' için yeni bir kapı şifresi oluşturulacak. Kullanıcının mevcut şifresi hemen geçersiz olur. Devam edilsin mi?')) return;

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + id + '/sifre-yenile', { method: 'POST' });
      var veri = res.veri || {};
      document.getElementById('pinRevealModalSubtitle').textContent = label + ' için yeni kapı şifresi oluşturuldu.';
      setText('pinRevealValue', veri.yeniPin || '—');
      setText('pinRevealValidity', veri.gecerlilikBitis ? UI.formatDate(veri.gecerlilikBitis) : 'Süresiz');

      var devicesEl = document.getElementById('pinRevealDevices');
      var cihazlar = Array.isArray(veri.cihazlar) ? veri.cihazlar : [];
      if (cihazlar.length) {
        devicesEl.innerHTML = '<div class="text-meta">Etkilenen cihazlar: ' +
          UI.escapeHtml(cihazlar.map(function (c) { return c.seriNo || c.ad || c.cihazId || String(c); }).join(', ')) + '</div>';
      } else {
        devicesEl.innerHTML = '';
      }

      UI.openModal(document.getElementById('pinRevealModal'));
      UI.toast(res.mesaj || 'Kapı şifresi yenilendi.', 'success');
    } catch (err) {
      UI.toast(err.message || 'PIN yenilenemedi.', 'error');
    }
  }

  /* ---------------- Delete / deactivate ---------------- */

  async function deleteUser(id) {
    var u = state.users.find(function (x) { return String(x.kullaniciId) === String(id); });
    var label = u ? ((u.ad || '') + ' ' + (u.soyad || '')) : ('#' + id);

    if (!window.confirm(label + ' kullanıcısını silmek istediğinize emin misiniz?')) return;

    try {
      var res = await API.apiRequest('/api/kullanicilar/' + id, { method: 'DELETE' });
      if (res && res.pasifeAlindi) {
        UI.toast('Kullanıcının ilişkili kayıtları bulunduğu için hesap pasife alındı.', 'warning');
      } else {
        UI.toast((res && res.mesaj) || 'Kullanıcı silindi.', 'success');
      }
      loadUsers();
    } catch (err) {
      UI.toast(err.message || 'Kullanıcı silinemedi.', 'error');
    }
  }

  /* ---------------- Helpers ---------------- */

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
})();
