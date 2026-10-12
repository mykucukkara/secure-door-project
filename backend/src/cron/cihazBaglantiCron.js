const cron = require('node-cron');
const prisma = require('../config/prisma');

// Kapı cihazı 30 sn'de bir sağlık mesajı gönderir. Üç mesaj üst üste gelmezse
// cihaz çevrimdışı sayılır. Backend yalnızca gelen mesajlarla durum yazdığından,
// bağlantı kopunca panel aksi halde son "çevrimiçi" kaydını göstermeye devam ederdi.
const CEVRIMDISI_ESIGI_MS = 90 * 1000;

async function cevrimdisiCihazlariIsaretle() {
  const cihazlar = await prisma.cihaz.findMany({ where: { durum: 'aktif' }, select: { cihazId: true } });
  const esik = Date.now() - CEVRIMDISI_ESIGI_MS;

  for (const { cihazId } of cihazlar) {
    // eslint-disable-next-line no-await-in-loop
    const son = await prisma.cihazDurumu.findFirst({
      where: { cihazId },
      orderBy: { guncellenmeTarihi: 'desc' }
    });
    if (!son || son.cihazDurumTip !== 'cevrimici') continue;
    const sonSinyal = (son.sonHeartbeat || son.guncellenmeTarihi).getTime();
    if (sonSinyal >= esik) continue;

    // eslint-disable-next-line no-await-in-loop
    await prisma.cihazDurumu.create({
      data: {
        cihazId,
        kapiDurumu: son.kapiDurumu,
        cihazDurumTip: 'cevrimdisi',
        bataryaSeviyesi: son.bataryaSeviyesi,
        wifiSignali: son.wifiSignali,
        firmwareVersiyon: son.firmwareVersiyon,
        bellekKullanimi: son.bellekKullanimi,
        kapiAcilmaSayaci: son.kapiAcilmaSayaci,
        // Son sinyal zamanı korunur; panel "en son ne zaman görüldü" bilgisini gösterir.
        sonHeartbeat: son.sonHeartbeat
      }
    });
    console.warn(`[CIHAZ] Cihaz ${cihazId} çevrimdışı: son sinyal ${new Date(sonSinyal).toISOString()}`);
  }
}

function initCihazBaglantiCron() {
  if (process.env.NODE_ENV === 'test') return;
  cron.schedule('* * * * *', async () => {
    try {
      await cevrimdisiCihazlariIsaretle();
    } catch (error) {
      console.error('[CIHAZ] Çevrimdışı kontrolü hatası:', error.message);
    }
  });
  console.log('Cihaz çevrimdışı kontrolü aktifleştirildi (her dakika, eşik 90 sn).');
}

module.exports = { initCihazBaglantiCron, cevrimdisiCihazlariIsaretle };
