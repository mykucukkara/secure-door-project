const cron = require('node-cron');
const prisma = require('../config/prisma');
const mqttService = require('./mqttService');

class PasswordService {
  // Cron Job'ı başlat (Her gün gece yarısı 00:00'da çalışır: '0 0 * * *')
  initCron() {
    cron.schedule('0 0 * * *', async () => {
      console.log('Günlük otomatik şifre yenileme görevi tetiklendi...');
      await this.generateAndPublishNewPasswords();
    });
    console.log('Günlük şifre cron job\'ı aktif edildi (Her gün 00:00).');
  }

  // Tüm aktif cihazlar/kullanıcılar için yeni şifre üret ve yayınla
  async generateAndPublishNewPasswords() {
    try {
      // Aktif cihazları çek
      const aktifCihazlar = await prisma.cihaz.findMany({
        where: { durum: 'aktif' }
      });

      for (const cihaz of aktifCihazlar) {
        // 6 haneli rastgele bir günlük şifre üret
        const yeniSifre = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Güvenlik için hashleyebiliriz veya düz metin/HMAC gönderebiliriz (Senaryoya göre)
        // ESP32 tarafının okuyabileceği formatta payload hazırlıyoruz:
        const payload = {
          cihazId: cihaz.cihazId,
          pin: yeniSifre,
          gecerlilikBitis: null 
        };

        // MQTT üzerinden cihaza publish et
        mqttService.publishCommand(cihaz.cihazId, 'sifre-guncelleme', payload);
        console.log(`Cihaz ${cihaz.cihazId} için yeni şifre MQTT ile gönderildi.`);
      }
    } catch (error) {
      console.error('Günlük şifre üretilirken hata oluştu:', error);
    }
  }

  // Manuel şifre yenileme (Web arayüzünden tetiklenecek)
  async manualRefreshForDevice(cihazId) {
    const yeniSifre = Math.floor(100000 + Math.random() * 900000).toString();
    
    const payload = {
      cihazId: parseInt(cihazId, 10),
      pin: yeniSifre,
      gecerlilikBitis: null 
    };

    mqttService.publishCommand(cihazId, 'sifre-guncelleme', payload);
    return { success: true, yeniSifre };
  }
}

module.exports = new PasswordService();