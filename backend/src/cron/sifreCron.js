const cron = require('node-cron');
const { refreshAllUsersPins, isAutoRotationEnabled } = require('../services/pinService');

/**
 * Kapı şifreleri artık kalıcıdır; kullanıcı istediğinde Profil sayfasından
 * günceller. Eski "her gece yeni şifre" davranışı yalnızca .env içinde
 * PIN_OTOMATIK_YENILEME=true yapılırsa devreye girer.
 */
function initSifreCron() {
  if (!isAutoRotationEnabled()) {
    console.log('🔐 Kapı şifreleri kalıcı modda (PIN_OTOMATIK_YENILEME=false). Gece otomatik yenileme kapalı.');
    return null;
  }

  const timezone = process.env.APP_TIMEZONE || 'Europe/Istanbul';
  const task = cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Günlük otomatik şifre yenileme başlatılıyor...');
    try {
      await refreshAllUsersPins();
      console.log('[CRON] Günlük şifreler yenilendi ve cihaza iletildi.');
    } catch (error) {
      console.error('[CRON] Şifre yenileme hatası:', error.message);
    }
  }, { timezone });

  console.log(`⏰ Otomatik şifre yenileme aktif (00:00, ${timezone}).`);
  return task;
}

module.exports = { initSifreCron };
