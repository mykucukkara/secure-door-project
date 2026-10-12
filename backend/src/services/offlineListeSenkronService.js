/**
 * Kapı cihazlarındaki çevrimdışı yetki listesini (PIN + kartlar) güncel tutar.
 *
 * Cihaz sunucuya ulaşamadığında bu listeyle kapı açar. Liste şu durumlarda
 * kendiliğinden yeniden gönderilir:
 *   - kart, kart yetkisi, kullanıcı, yetki kuralı, grup veya cihaz-kapı
 *     ataması değişince (iptal edilen kart/kullanıcı listeden hemen düşer),
 *   - cihaz yeniden başlayınca ya da çevrimdışıyken tekrar bağlanınca,
 *   - her gün 04:00'te.
 * Art arda gelen değişiklikler birkaç saniye beklenip tek gönderime birleştirilir.
 */
const cron = require('node-cron');
const prisma = require('../config/prisma');

const BIRLESTIRME_MS = 3000;
let zamanlayici = null;
const bekleyenSebepler = new Set();

async function tumCihazlaraGonder(sebep) {
  // pinService mqttService'i, mqttService de bu modülü kullanır; döngü olmasın diye geç yüklenir.
  const { generateOfflineListForDevice } = require('./pinService');
  const cihazlar = await prisma.cihaz.findMany({ where: { durum: 'aktif' }, select: { cihazId: true } });
  for (const { cihazId } of cihazlar) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const sonuc = await generateOfflineListForDevice(cihazId, new Map(), true);
      console.log(`[OFFLINE] Cihaz ${cihazId}: ${sonuc.toplamUye} kişilik liste ${sonuc.mqttGonderildi ? 'gönderildi' : 'GÖNDERİLEMEDİ (MQTT yok)'} (${sebep}).`);
    } catch (error) {
      console.warn(`[OFFLINE] Cihaz ${cihazId} listesi oluşturulamadı: ${error.message}`);
    }
  }
}

function listeGonderimiPlanla(sebep) {
  if (process.env.NODE_ENV === 'test') return;
  bekleyenSebepler.add(sebep);
  clearTimeout(zamanlayici);
  zamanlayici = setTimeout(() => {
    const sebepler = [...bekleyenSebepler].join(', ');
    bekleyenSebepler.clear();
    zamanlayici = null;
    tumCihazlaraGonder(sebepler).catch((error) => {
      console.error('[OFFLINE] Liste gönderimi hatası:', error.message);
    });
  }, BIRLESTIRME_MS);
}

/** Yetkiyi etkileyen API çağrıları başarıyla bitince listeyi yeniden gönderir. */
function degisiklikteListeyiGonder(req, res, next) {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) listeGonderimiPlanla(`${req.method} ${req.baseUrl}`);
    });
  }
  next();
}

function initOfflineListeCron() {
  if (process.env.NODE_ENV === 'test') return;
  const timezone = process.env.APP_TIMEZONE || 'Europe/Istanbul';
  cron.schedule('0 4 * * *', () => listeGonderimiPlanla('günlük yenileme'), { timezone });
}

module.exports = { listeGonderimiPlanla, degisiklikteListeyiGonder, initOfflineListeCron };
