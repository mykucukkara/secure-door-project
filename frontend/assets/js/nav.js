/* SecureLab — kurumsal (SUBÜ) sayfa iskeleti
   Oturum gerektiren her sayfada üst bilgi çubuğunu, logo alanını, mavi ana
   menüyü, sayfa başlığı bandını ve alt bilgiyi oluşturur. Sayfalar yalnızca
   şu iskeleti içerir:

     <div class="app-shell">
       <div class="app-body"><main class="main-content">…</main></div>
     </div>

   Bu dosya "defer" ile yüklendiği için DOM hazır olduğunda, sayfa betikleri
   DOMContentLoaded'da çalışmadan ÖNCE iskeleti kurar. Böylece sayfa betikleri
   #topbarActions, #profileName, #logoutBtn gibi öğeleri her zamanki gibi bulur.
   Kullanıcı bilgisi geldiğinde SecureNav.init(user) çağrılır. */
(function () {
  'use strict';

  var ICONS = {
    home: '<path d="M3.5 11 12 4l8.5 7"></path><path d="M5.5 9.5V20h13V9.5"></path><path d="M10 20v-5.5h4V20"></path>',
    users: '<path d="M17 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20"></path><circle cx="10" cy="7.5" r="3.5"></circle><path d="M19.5 20v-1.2a3.3 3.3 0 0 0-2.3-3.15"></path><path d="M15.3 4.2a3.5 3.5 0 0 1 0 6.6"></path>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h4"></path>',
    key: '<circle cx="8" cy="15.5" r="4"></circle><path d="M11 12.5 18.5 5M16.5 7 19 9.5M13.7 9.8l2 2"></path>',
    clock: '<circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 2.5"></path><path d="M9 2.5h6"></path>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.3L4 17v3h3l5.4-5.3a4 4 0 0 1 5.3-5.4l-2.6 2.6-2-2 2.6-2.6Z"></path>',
    qr: '<rect x="3.5" y="3.5" width="6" height="6" rx="1"></rect><rect x="14.5" y="3.5" width="6" height="6" rx="1"></rect><rect x="3.5" y="14.5" width="6" height="6" rx="1"></rect><path d="M14.5 14.5h3v3M20.5 14.5v2M14.5 20.5h3M20.5 20.5v-1"></path>',
    user: '<circle cx="12" cy="8.5" r="3.5"></circle><path d="M5 20a7 7 0 0 1 14 0"></path>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"></path>',
    logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"></path><path d="M16 16l4-4-4-4"></path><path d="M20 12H9"></path>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path>',
    globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>'
  };

  var NAV_ITEMS = [
    { href: 'index.html', label: 'Anasayfa', icon: 'home', home: true },
    { href: 'admin.html', label: 'Kullanıcılar', icon: 'users', role: 'admin' },
    { href: 'kart-kayit.html', label: 'Kart Kayıt', icon: 'card', role: 'admin' },
    { href: 'yetkilendirme.html', label: 'Yetkilendirme', icon: 'key', role: 'admin' },
    { href: 'gecmis-girisler.html', label: 'Erişim Geçmişi', icon: 'clock' },
    { href: 'ariza-gecmisi.html', label: 'Arıza Kayıtları', icon: 'wrench' },
    { href: 'qr-kod.html', label: 'QR Kod', icon: 'qr' },
    { href: 'hesabim.html', label: 'Profilim', icon: 'user' }
  ];

  var LOGO_SRC = 'assets/img/subu-logo.png';

  function svg(name, extraAttrs) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extraAttrs || '') + '>' + (ICONS[name] || '') + '</svg>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentFileName() {
    var path = location.pathname.replace(/\\/g, '/');
    var last = path.substring(path.lastIndexOf('/') + 1);
    return last || 'index.html';
  }

  /* ------------------------------------------------------------------ */
  /* İskelet HTML'i                                                      */
  /* ------------------------------------------------------------------ */

  function headerHtml() {
    var navLinks = NAV_ITEMS.map(function (item) {
      return '<li' + (item.role ? ' data-role="' + item.role + '" hidden' : '') + '>' +
        '<a href="' + item.href + '" class="site-nav-link' + (item.home ? ' site-nav-home' : '') + '"' +
        (item.home ? ' title="' + item.label + '"' : '') + '>' +
        svg(item.icon) + '<span class="site-nav-text">' + item.label + '</span></a></li>';
    }).join('');

    return '' +
      '<header class="site-header" role="banner">' +
        '<div class="site-topbar"><div class="container site-topbar-inner">' +
          '<div class="site-topbar-links">' +
            '<a href="https://www.subu.edu.tr" target="_blank" rel="noopener">SUBÜ</a>' +
            '<span class="site-topbar-sep">|</span>' +
            '<a href="https://bm.subu.edu.tr" target="_blank" rel="noopener">Bilgisayar Mühendisliği</a>' +
            '<span class="site-topbar-sep hide-sm">|</span>' +
            '<a class="hide-sm" href="ariza-bildir.html">Arıza Bildir</a>' +
          '</div>' +
          '<div class="site-topbar-meta">' +
            '<span class="site-clock">' + svg('calendar') + ' <span id="siteClock"></span></span>' +
          '</div>' +
        '</div></div>' +

        '<div class="site-brandbar"><div class="container site-brandbar-inner">' +
          '<a class="site-brand" href="index.html" aria-label="SecureLab anasayfa">' +
            '<img src="' + LOGO_SRC + '" alt="Sakarya Uygulamalı Bilimler Üniversitesi logosu" width="51" height="64">' +
            '<span class="site-brand-text">' +
              '<span class="site-brand-l1">SAKARYA</span>' +
              '<span class="site-brand-l2">UYGULAMALI BİLİMLER ÜNİVERSİTESİ</span>' +
              '<span class="site-brand-l3">Bilgisayar Mühendisliği</span>' +
            '</span>' +
          '</a>' +
          '<span class="site-brand-divider" aria-hidden="true"></span>' +
          '<div class="site-product">' +
            '<span class="site-product-name">SecureLab</span>' +
            '<span class="site-product-sub">Kapı Erişim Kontrol Sistemi</span>' +
          '</div>' +
          '<div class="topbar-actions" id="topbarActions">' +
            '<a href="hesabim.html" class="topbar-profile" title="Profilim">' +
              '<span class="topbar-profile-avatar" id="profileAvatar">--</span>' +
              '<span class="topbar-profile-meta">' +
                '<span class="topbar-profile-name" id="profileName">Yükleniyor…</span>' +
                '<span class="badge badge-neutral" id="profileRoleBadge">—</span>' +
              '</span>' +
            '</a>' +
            '<button type="button" class="btn btn-sm btn-logout" id="logoutBtn" title="Çıkış yap">' +
              svg('logout') + '<span>Çıkış</span>' +
            '</button>' +
          '</div>' +
        '</div></div>' +

        '<nav class="site-nav" aria-label="Ana menü"><div class="container site-nav-inner">' +
          '<button type="button" class="site-nav-toggle" id="menuToggle" aria-expanded="false" aria-controls="siteNavList">' +
            svg('menu') + '<span>Menü</span>' +
          '</button>' +
          '<ul class="site-nav-list" id="siteNavList">' + navLinks + '</ul>' +
        '</div></nav>' +
      '</header>';
  }

  function heroHtml(label) {
    return '' +
      '<section class="page-hero"><div class="container page-hero-inner" id="pageHeroInner">' +
        '<nav class="breadcrumb" aria-label="Konum">' +
          '<a href="index.html">Anasayfa</a>' +
          '<span class="breadcrumb-sep">›</span>' +
          '<span class="breadcrumb-current" id="breadcrumbCurrent">' + escapeHtml(label) + '</span>' +
        '</nav>' +
      '</div></section>';
  }

  function footerHtml() {
    var year = new Date().getFullYear();
    var quickLinks = NAV_ITEMS.filter(function (i) { return !i.home; }).map(function (item) {
      return '<li' + (item.role ? ' data-role="' + item.role + '" hidden' : '') + '><a href="' + item.href + '">' + item.label + '</a></li>';
    }).join('');

    return '' +
      '<footer class="site-footer" role="contentinfo">' +
        '<div class="container site-footer-grid">' +
          '<div>' +
            '<div class="site-footer-title">SecureLab</div>' +
            '<div class="site-footer-brand">' +
              '<img src="' + LOGO_SRC + '" alt="" width="46" height="58">' +
              '<div>' +
                '<div class="site-footer-brand-name">Sakarya Uygulamalı Bilimler Üniversitesi<br>Bilgisayar Mühendisliği Bölümü</div>' +
                '<p>RFID kart ve kişisel kapı şifresiyle çalışan laboratuvar erişim kontrol sistemi.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="site-footer-title">Hızlı Erişim</div>' +
            '<ul>' + quickLinks + '</ul>' +
          '</div>' +
          '<div>' +
            '<div class="site-footer-title">Bağlantılar</div>' +
            '<ul>' +
              '<li><a href="https://www.subu.edu.tr" target="_blank" rel="noopener">subu.edu.tr</a></li>' +
              '<li><a href="https://bm.subu.edu.tr" target="_blank" rel="noopener">Bilgisayar Mühendisliği</a></li>' +
              '<li><a href="ariza-bildir.html">Arıza Bildirim Formu</a></li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
        '<div class="site-footer-bottom"><div class="container">' +
          '<span>© ' + year + ' SUBÜ Bilgisayar Mühendisliği · SecureLab</span>' +
          '<span>Kapı Erişim Kontrol Sistemi</span>' +
        '</div></div>' +
      '</footer>';
  }

  /* ------------------------------------------------------------------ */
  /* İskeleti kur                                                        */
  /* ------------------------------------------------------------------ */

  function buildShell() {
    var shell = document.querySelector('.app-shell');
    if (!shell || shell.getAttribute('data-shell-ready') === '1') return;
    var body = shell.querySelector('.app-body');
    if (!body) return;

    var label = document.body.getAttribute('data-breadcrumb') || document.title.split('·')[0].trim();

    body.insertAdjacentHTML('beforebegin', headerHtml());
    body.insertAdjacentHTML('beforebegin', heroHtml(label));
    body.insertAdjacentHTML('afterend', footerHtml());

    // Sayfa başlığını (başlık + açıklama + işlem düğmeleri) başlık bandına taşı.
    var pageHeader = body.querySelector('.page-header');
    var heroInner = document.getElementById('pageHeroInner');
    if (pageHeader && heroInner) heroInner.appendChild(pageHeader);

    shell.setAttribute('data-shell-ready', '1');
    highlightActiveLink();
    startClock();
  }

  function highlightActiveLink() {
    var file = currentFileName();
    document.querySelectorAll('.site-nav-link').forEach(function (link) {
      var href = (link.getAttribute('href') || '').split('/').pop();
      var active = href === file;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function startClock() {
    var el = document.getElementById('siteClock');
    if (!el) return;
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat('tr-TR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      fmt = null;
    }
    function tick() {
      var now = new Date();
      el.textContent = fmt ? fmt.format(now) : now.toLocaleString('tr-TR');
    }
    tick();
    setInterval(tick, 30 * 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Etkileşimler                                                        */
  /* ------------------------------------------------------------------ */

  function wireMobileToggle() {
    var shell = document.querySelector('.app-shell');
    var menuBtn = document.getElementById('menuToggle');
    if (!shell || !menuBtn || menuBtn.getAttribute('data-wired') === '1') return;
    menuBtn.setAttribute('data-wired', '1');

    function close() {
      shell.classList.remove('nav-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }

    menuBtn.addEventListener('click', function () {
      var open = !shell.classList.contains('nav-open');
      shell.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.querySelectorAll('.site-nav-link').forEach(function (link) {
      link.addEventListener('click', close);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function wireLogout() {
    var btn = document.getElementById('logoutBtn');
    if (!btn || btn.getAttribute('data-wired') === '1') return;
    btn.setAttribute('data-wired', '1');
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        if (window.SecureAPI) {
          await window.SecureAPI.apiRequest('/api/auth/logout', { method: 'POST' }).catch(function () {});
        }
      } finally {
        if (window.SecureAPI) window.SecureAPI.clearToken();
        location.replace('login.html');
      }
    });
  }

  function applyRoleVisibility(user) {
    var rol = user && user.rol;
    document.querySelectorAll('[data-role]').forEach(function (el) {
      var required = el.getAttribute('data-role');
      if (!required) return;
      var allowed = required.split(',').map(function (r) { return r.trim(); });
      el.hidden = !(rol && allowed.indexOf(rol) !== -1);
    });
  }

  function fillProfile(user) {
    if (!user) return;
    var nameEl = document.getElementById('profileName');
    var roleEl = document.getElementById('profileRoleBadge');
    var avatarEl = document.getElementById('profileAvatar');
    var fullName = [user.ad, user.soyad].filter(Boolean).join(' ');

    if (nameEl) nameEl.textContent = fullName || user.eposta || 'Kullanıcı';
    if (roleEl) {
      var roleMap = { admin: ['Yönetici', 'badge-warning'], hoca: ['Öğretim Üyesi', 'badge-info'], sistem: ['Sistem', 'badge-neutral'] };
      var info = roleMap[user.rol] || [user.rol || '—', 'badge-neutral'];
      roleEl.textContent = info[0];
      roleEl.className = 'badge ' + info[1];
    }
    if (avatarEl) {
      var initials = ((user.ad || '?').charAt(0) + (user.soyad || '').charAt(0)).toLocaleUpperCase('tr-TR');
      avatarEl.textContent = initials || '?';
    }
  }

  function init(user) {
    buildShell();
    highlightActiveLink();
    wireMobileToggle();
    wireLogout();
    if (user) {
      applyRoleVisibility(user);
      fillProfile(user);
    }
  }

  // İskeleti hemen kur (sayfa betikleri DOMContentLoaded'da çalışmadan önce).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildShell);
  } else {
    buildShell();
  }

  window.SecureNav = {
    init: init,
    buildShell: buildShell,
    highlightActiveLink: highlightActiveLink,
    applyRoleVisibility: applyRoleVisibility,
    fillProfile: fillProfile
  };
})();
