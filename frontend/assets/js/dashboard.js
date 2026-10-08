/* SecureLab — index.html (dashboard) bootstrap */
(function () {
  'use strict';

  var API = window.SecureAPI;
  var UI = window.SecureUI;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    var topbarActions = document.getElementById('topbarActions');
    if (topbarActions && window.SecureTheme) {
      window.SecureTheme.mountTopbarToggle(topbarActions);
      // Move the freshly-created toggle to the front of the actions row.
      var toggle = topbarActions.querySelector('.topbar-theme-toggle');
      if (toggle) topbarActions.insertBefore(toggle, topbarActions.firstChild);
    }

    var user = await API.requireAuth();
    if (!user) return; // requireAuth already redirected to login
    // Pano kapı/cihaz/kullanıcı özetleri içerir; yetkili öğrenciler Profilim'e yönlenir.
    if (user.rol === 'yetkili_ogrenci') {
      location.replace('hesabim.html');
      return;
    }

    window.SecureNav.init(user);

    loadStats();
    loadRecentAccess();
  }

  async function loadStats() {
    // Users summary
    try {
      var ozet = await API.apiRequest('/api/kullanicilar/ozet');
      setText('statUsersTotal', ozet.toplam);
      setText('statUsersActive', ozet.aktif + ' kullanıcı aktif');
    } catch (e) {
      setText('statUsersTotal', '—');
      setText('statUsersActive', 'Yüklenemedi');
    }

    // Doors
    try {
      var kapilar = await API.apiRequest('/api/kapilar');
      var kapiTotal = kapilar.length;
      var kapiActive = kapilar.filter(function (k) { return k.durum === 'aktif'; }).length;
      setText('statDoorsTotal', kapiTotal);
      setText('statDoorsActive', kapiActive + ' aktif kapı');
    } catch (e) {
      setText('statDoorsTotal', '—');
      setText('statDoorsActive', 'Yüklenemedi');
    }

    // Devices + device status
    try {
      var cihazlar = await API.apiRequest('/api/cihazlar');
      var cihazTotal = cihazlar.length;
      var onlineCount = cihazlar.filter(function (c) { return c.durum === 'cevrimici'; }).length;

      try {
        var durumlar = await API.apiRequest('/api/cihaz-durumlari');
        if (Array.isArray(durumlar) && durumlar.length) {
          var latestByDevice = {};
          durumlar.forEach(function (d) {
            var id = d.cihazId || d.cihaz_id || d.id;
            var ts = d.zaman || d.olusturulma || d.tarih || d.updatedAt;
            if (!latestByDevice[id] || new Date(ts) > new Date(latestByDevice[id].ts || 0)) {
              latestByDevice[id] = { durum: d.durum, ts: ts };
            }
          });
          var onlineFromStatus = Object.keys(latestByDevice).filter(function (id) {
            return latestByDevice[id].durum === 'cevrimici';
          }).length;
          if (onlineFromStatus) onlineCount = onlineFromStatus;
        }
      } catch (e2) { /* fall back to cihazlar.durum */ }

      setText('statDevicesTotal', cihazTotal);
      setText('statDevicesOnline', onlineCount + ' cihaz çevrimiçi');
    } catch (e) {
      setText('statDevicesTotal', '—');
      setText('statDevicesOnline', 'Yüklenemedi');
    }
  }

  async function loadRecentAccess() {
    var container = document.getElementById('recentAccessContainer');
    UI.setLoading(container, 'Son erişim hareketleri yükleniyor…');

    try {
      var records = await API.apiRequest('/api/erisim-kayitlari?limit=20&offset=0');

      var granted = records.filter(function (r) { return r.sonuc === 'izin'; }).length;
      var denied = records.filter(function (r) { return r.sonuc === 'red'; }).length;
      setText('statAccessGranted', granted);
      setText('statAccessDenied', denied + ' reddedilen erişim');

      if (!records.length) {
        UI.setEmpty(container, 'Henüz erişim kaydı yok', 'Kapı okuyucularından herhangi bir hareket alınmadı.');
        return;
      }

      var rows = records.map(function (r) {
        var kullanici = r.kullanici ? (r.kullanici.ad + ' ' + r.kullanici.soyad) : (r.okunanUid || r.kartUid || 'Bilinmiyor');
        var kapiAdi = r.kapi && r.kapi.ad ? r.kapi.ad : '—';
        return '<tr>' +
          '<td>' + UI.escapeHtml(UI.formatDateTime(r.kayitTamani)) + '</td>' +
          '<td>' + UI.escapeHtml(kullanici) + '</td>' +
          '<td>' + UI.escapeHtml(kapiAdi) + '</td>' +
          '<td>' + UI.renderBadge('dogrulamaYontemi', r.dogrulamaYontemi) + '</td>' +
          '<td>' + UI.renderBadge('sonuc', r.sonuc) + (r.sonuc === 'red' && r.redNedeni ? '<div class="text-meta">' + UI.escapeHtml(r.redNedeni) + '</div>' : '') + '</td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Zaman</th><th>Kullanıcı</th><th>Kapı</th><th>Yöntem</th><th>Sonuç</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
    } catch (e) {
      UI.setError(container, e.message, loadRecentAccess);
      setText('statAccessGranted', '—');
      setText('statAccessDenied', 'Yüklenemedi');
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
})();
