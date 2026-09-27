/* SecureLab — ariza-gecmisi.html (fault history: status cycling, photo lightbox, filter) */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  var STATUS_ORDER = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
  var DESC_TRUNCATE_LENGTH = 110;

  var state = {
    all: [],
    durum: ''
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

    window.SecureNav.init(user);

    UI.wireModalDismiss(document.getElementById('photoModal'));
    wireFilter();
    loadFaults();
  }

  function wireFilter() {
    document.getElementById('filterDurum').addEventListener('change', function (e) {
      state.durum = e.target.value;
      render();
    });
  }

  async function loadFaults() {
    var container = document.getElementById('faultsContainer');
    UI.setLoading(container, 'Arıza kayıtları yükleniyor…');

    try {
      var res = await API.apiRequest('/api/arizalar');
      state.all = Array.isArray(res.data) ? res.data : [];
      render();
    } catch (err) {
      UI.setError(container, err.message, loadFaults);
      setText('faultsCountSubtitle', 'Yüklenemedi');
    }
  }

  function render() {
    var container = document.getElementById('faultsContainer');
    var filtered = state.all.filter(function (f) {
      return !state.durum || f.durum === state.durum;
    });

    setText('faultsCountSubtitle', filtered.length + ' kayıt (toplam ' + state.all.length + ')');

    if (!filtered.length) {
      UI.setEmpty(container, 'Arıza kaydı bulunamadı', 'Seçili filtreyle eşleşen bir arıza kaydı yok.');
      return;
    }

    var rows = filtered.map(function (f) {
      var id = f.arizaId;
      var desc = f.aciklama || '';
      var truncated = desc.length > DESC_TRUNCATE_LENGTH;
      var shortDesc = truncated ? desc.slice(0, DESC_TRUNCATE_LENGTH) + '…' : desc;

      var descCell = '<div class="desc-cell" data-full="' + UI.escapeHtml(desc) + '" data-short="' + UI.escapeHtml(shortDesc) + '">' +
        '<span class="desc-text">' + UI.escapeHtml(shortDesc) + '</span>' +
        (truncated ? ' <button type="button" class="btn btn-ghost btn-sm" data-action="toggle-desc">Devamını gör</button>' : '') +
        '</div>';

      var photoCell = f.fotografVerisi
        ? '<button type="button" class="photo-thumb" data-action="view-photo" data-src="' + UI.escapeHtml(f.fotografVerisi) + '" title="Fotoğrafı görüntüle" aria-label="Fotoğrafı görüntüle"><img src="' + UI.escapeHtml(f.fotografVerisi) + '" alt="Arıza fotoğrafı"></button>'
        : '<span class="text-muted">—</span>';

      var badgeInfo = UI.badgeInfo('arizaDurum', f.durum);

      return '<tr>' +
        '<td class="cell-muted">' + UI.escapeHtml(UI.formatDateTime(f.olusturulma)) + '</td>' +
        '<td>' + UI.escapeHtml(f.bildiren || '—') + '</td>' +
        '<td>' + UI.escapeHtml(f.arizaTuru || '—') + '</td>' +
        '<td class="wrap desc-cell">' + descCell + '</td>' +
        '<td>' + photoCell + '</td>' +
        '<td><button type="button" class="badge badge-btn badge-' + badgeInfo.variant + '" data-action="cycle-status" data-id="' + id + '" data-durum="' + UI.escapeHtml(f.durum || '') + '">' + badgeInfo.label + '</button></td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
      '<thead><tr><th>Tarih</th><th>Bildiren</th><th>Arıza Türü</th><th class="wrap">Açıklama</th><th>Fotoğraf</th><th>Durum</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    container.querySelectorAll('[data-action="toggle-desc"]').forEach(function (btn) {
      btn.addEventListener('click', function () { toggleDesc(btn); });
    });
    container.querySelectorAll('[data-action="view-photo"]').forEach(function (btn) {
      btn.addEventListener('click', function () { viewPhoto(btn.getAttribute('data-src')); });
    });
    container.querySelectorAll('[data-action="cycle-status"]').forEach(function (btn) {
      btn.addEventListener('click', function () { cycleStatus(btn); });
    });
  }

  function toggleDesc(btn) {
    var wrap = btn.closest('.desc-cell');
    var textEl = wrap.querySelector('.desc-text');
    var expanded = wrap.getAttribute('data-expanded') === 'true';
    if (expanded) {
      textEl.textContent = wrap.getAttribute('data-short');
      btn.textContent = 'Devamını gör';
      wrap.setAttribute('data-expanded', 'false');
    } else {
      textEl.textContent = wrap.getAttribute('data-full');
      btn.textContent = 'Daralt';
      wrap.setAttribute('data-expanded', 'true');
    }
  }

  function viewPhoto(src) {
    document.getElementById('photoModalImg').src = src;
    UI.openModal(document.getElementById('photoModal'));
  }

  async function cycleStatus(btn) {
    var id = btn.getAttribute('data-id');
    var current = btn.getAttribute('data-durum');
    var idx = STATUS_ORDER.indexOf(current);
    var next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];

    var nextInfo = UI.badgeInfo('arizaDurum', next);
    var prevInfo = UI.badgeInfo('arizaDurum', current);

    btn.className = 'badge badge-btn badge-' + nextInfo.variant;
    btn.textContent = nextInfo.label;
    btn.setAttribute('data-durum', next);
    btn.disabled = true;

    try {
      var res = await API.apiRequest('/api/arizalar/' + id, { method: 'PATCH', body: { status: next } });
      var record = state.all.find(function (f) { return String(f.arizaId) === String(id); });
      if (record) record.durum = (res.report && res.report.durum) || next;
      UI.toast(res.message || 'Arıza durumu güncellendi.', 'success');
    } catch (err) {
      btn.className = 'badge badge-btn badge-' + prevInfo.variant;
      btn.textContent = prevInfo.label;
      btn.setAttribute('data-durum', current);
      UI.toast(err.message || 'Durum güncellenemedi.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
})();
