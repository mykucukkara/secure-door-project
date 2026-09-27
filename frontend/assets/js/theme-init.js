/* Sayfa çizilmeden önce kayıtlı temayı (açık/koyu) uygular. İçerik Güvenlik
   Politikası satır içi betiğe izin vermediği için ayrı dosyadır; <head> içinde
   "defer" OLMADAN yüklenmelidir. */
(function () {
  try {
    var t = localStorage.getItem('securelab-theme');
    if (t !== 'dark' && t !== 'light') {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* depolama kapalıysa varsayılan tema */ }
})();
