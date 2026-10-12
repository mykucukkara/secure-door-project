const mqtt = require('mqtt');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const cardApprovalService = require('./cardApprovalService');
const accessDecisionService = require('./accessDecisionService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePositiveInt(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEventTime(payload) {
  const rawEventTime = payload.olay_zamani || payload.olayZamani;
  const epochSeconds = Number(rawEventTime);

  if (Number.isFinite(epochSeconds) && epochSeconds >= 1600000000) {
    return new Date(epochSeconds * 1000);
  }

  if (rawEventTime) {
    const parsedTime = new Date(rawEventTime);
    if (!Number.isNaN(parsedTime.getTime()) && parsedTime.getTime() >= 1600000000000) {
      return parsedTime;
    }
  }

  return new Date();
}

function safeBigInt(value) {
  try {
    return value === null || value === undefined || value === ''
      ? null
      : BigInt(value);
  } catch (error) {
    return null;
  }
}

function sanitizedAccessPayload(payload, decision) {
  const detail = {
    ...payload,
    sunucu_karari: decision.allowed ? 'izin' : 'red',
    sunucu_red_nedeni: decision.reason || null
  };

  if (Object.prototype.hasOwnProperty.call(detail, 'pin')) {
    detail.pin = '******';
  }

  return detail;
}

class MqttService {
  constructor() {
    this.client = null;
    this.connected = false;
    // Cihazın son bildirdiği çalışma süresi (sn); azalırsa cihaz yeniden başlamıştır.
    this.sonCalismaSuresi = new Map();
    // Son sağlık mesajının geliş zamanı; 90 sn'den uzun boşluk = tekrar bağlandı.
    this.sonSaglikZamani = new Map();
  }

  connect() {
    const brokerHost = process.env.MQTT_BROKER_HOST || 'mqtt';
    const brokerPort = process.env.MQTT_BROKER_PORT || 1883;
    const brokerUrl = process.env.MQTT_BROKER_URL || `mqtt://${brokerHost}:${brokerPort}`;

    this.client = mqtt.connect(brokerUrl, {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      clientId: `backend_${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5000
    });

    this.client.on('connect', () => {
      this.connected = true;
      console.log(`[MQTT] Broker'a bağlandı: ${brokerUrl}`);
      this.subscribeToTopics();
      // Sunucu kapalıyken yapılan değişiklikler kaçmasın diye cihaz listeleri tazelenir.
      require('./offlineListeSenkronService').listeGonderimiPlanla('sunucu MQTT bağlantısı');
    });

    this.client.on('reconnect', () => console.log('[MQTT] Yeniden bağlanmaya çalışılıyor...'));
    this.client.on('error', (err) => console.error('[MQTT] Bağlantı hatası:', err.message));
    this.client.on('close', () => {
      this.connected = false;
      console.log('[MQTT] Bağlantı kapandı.');
    });

    this.client.on('message', (topic, message) => {
      this.handleIncomingMessage(topic, message).catch((err) =>
        console.error(`[MQTT] Mesaj işlenirken beklenmeyen hata (${topic}):`, err)
      );
    });
  }

  subscribeToTopics() {
    [
      'kapi/+/durum',
      'kapi/+/ota-durum',
      'kapi/+/saglik',
      'kapi/+/erisim-istek'
    ].forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) console.error(`[MQTT] Abone olunamadı: ${topic}`, err.message);
        else console.log(`[MQTT] Abone olundu: ${topic}`);
      });
    });
  }

  extractCihazId(topic) {
    const parts = topic.split('/');
    return parts.length >= 2 ? Number.parseInt(parts[1], 10) : null;
  }

  async handleIncomingMessage(topic, messageBuffer) {
    let payload;
    try {
      payload = JSON.parse(messageBuffer.toString());
    } catch (error) {
      console.error(`[MQTT] Geçersiz JSON payload (${topic}).`);
      return;
    }

    const cihazId = this.extractCihazId(topic);
    if (!cihazId || Number.isNaN(cihazId)) {
      console.warn(`[MQTT] Topic'ten cihazId çıkarılamadı: ${topic}`);
      return;
    }

    const cihaz = await prisma.cihaz.findUnique({ where: { cihazId } });
    if (!cihaz) {
      console.warn(`[MQTT] Bilinmeyen cihazdan mesaj: cihazId=${cihazId}, topic=${topic}`);
      return;
    }

    if (topic.endsWith('/durum')) {
      await this.handleDurumMesaji(cihaz, payload);
    } else if (topic.endsWith('/ota-durum')) {
      this.handleOtaDurumMesaji(cihaz, payload);
    } else if (topic.endsWith('/saglik')) {
      await this.handleSaglikMesaji(cihaz, payload);
    } else if (topic.endsWith('/erisim-istek')) {
      await this.handleErisimIstegi(cihaz, payload);
    }
  }

  handleOtaDurumMesaji(cihaz, payload) {
    const status = payload.durum || 'BILINMIYOR';
    const targetVersion = payload.hedef_firmware || '-';
    const progress = Number.isFinite(Number(payload.ilerleme))
      ? ` (${Number(payload.ilerleme)}%)`
      : '';
    console.log(
      `[OTA] Cihaz ${cihaz.cihazId}: ${status}${progress}, hedef=${targetVersion}, mesaj=${payload.mesaj || '-'}`
    );
  }

  async getSonBilinenDurum(cihazId) {
    return prisma.cihazDurumu.findFirst({
      where: { cihazId },
      orderBy: { guncellenmeTarihi: 'desc' }
    });
  }

  async handleDurumMesaji(cihaz, payload) {
    try {
      if (payload.durum === 'BASARILI' || payload.durum === 'HATA') {
        console.log(`[MQTT] Cihaz ${cihaz.cihazId} komut yanıtı: ${payload.durum} - ${payload.mesaj || ''}`);
        return;
      }

      const sonDurum = await this.getSonBilinenDurum(cihaz.cihazId);
      const kapiDurumu = payload.kapiDurumu
        ?? payload.kapi_durumu
        ?? sonDurum?.kapiDurumu
        ?? 'kapali';

      await prisma.cihazDurumu.create({
        data: {
          cihazId: cihaz.cihazId,
          kapiDurumu,
          cihazDurumTip: 'cevrimici',
          bataryaSeviyesi: payload.bataryaSeviyesi ?? sonDurum?.bataryaSeviyesi ?? null,
          wifiSignali: payload.wifiSignali ?? payload.wifi_rssi ?? sonDurum?.wifiSignali ?? null,
          firmwareVersiyon: payload.firmwareVersiyon ?? payload.firmware_versiyon ?? sonDurum?.firmwareVersiyon ?? null,
          bellekKullanimi: payload.bellekKullanimi ?? payload.bellek_kullanimi ?? sonDurum?.bellekKullanimi ?? null,
          kapiAcilmaSayaci: payload.kapiAcilmaSayaci ?? payload.kapi_acilma_sayaci ?? sonDurum?.kapiAcilmaSayaci ?? null,
          kapiAcilmaSuresi: payload.kapiAcilmaSuresi ?? payload.kapi_acilma_suresi ?? null,
          sonHeartbeat: new Date()
        }
      });

      console.log(`[MQTT] Cihaz ${cihaz.cihazId} kapı durumu: ${kapiDurumu.toUpperCase()}`);
    } catch (error) {
      console.error(`[MQTT] Durum mesajı işlenirken hata (cihaz ${cihaz.cihazId}):`, error);
    }
  }

  /**
   * Cihazın yeniden başladığını (çalışma süresi azaldı) ya da çevrimdışıyken
   * tekrar bağlandığını yakalar: yeniden başlamayı olay olarak kaydeder ve
   * çevrimdışı yetki listesini tazeler (fw 1.0.3+ açılış nedenini de bildirir).
   */
  async yenidenBaslamayiIzle(cihaz, payload) {
    const simdi = Date.now();
    const oncekiSaglik = this.sonSaglikZamani.get(cihaz.cihazId);
    this.sonSaglikZamani.set(cihaz.cihazId, simdi);
    const tekrarBaglandi = oncekiSaglik !== undefined && simdi - oncekiSaglik > 90 * 1000;

    const calisma = Number(payload.calisma_suresi_sn ?? (Number(payload.zaman) / 1000));
    if (!Number.isFinite(calisma)) return;
    const onceki = this.sonCalismaSuresi.get(cihaz.cihazId);
    this.sonCalismaSuresi.set(cihaz.cihazId, calisma);

    // Sunucu yeni açıldıysa önceki değer yoktur; cihaz son 2 dk içinde açıldıysa yine sayılır.
    const yenidenBasladi = onceki === undefined ? calisma < 120 : calisma < onceki;

    if (yenidenBasladi) {
      const neden = payload.acilis_nedeni || 'bilinmiyor';
      console.warn(`[CIHAZ] Cihaz ${cihaz.cihazId} yeniden başladı (neden: ${neden}, firmware ${payload.firmware_versiyon || '-'}).`);
      await prisma.olay.create({
        data: {
          tur: 'cihaz_yeniden_basladi',
          kaynak: 'cihaz',
          cihazId: cihaz.cihazId,
          detay: {
            neden,
            firmware: payload.firmware_versiyon || null,
            calismaSuresiSn: Math.round(calisma),
            oncekiCalismaSuresiSn: onceki === undefined ? null : Math.round(onceki)
          }
        }
      });
    }
    if (yenidenBasladi || tekrarBaglandi) {
      require('./offlineListeSenkronService').listeGonderimiPlanla(`cihaz ${cihaz.cihazId} ${yenidenBasladi ? 'yeniden başladı' : 'tekrar bağlandı'}`);
    }
  }

  async handleSaglikMesaji(cihaz, payload) {
    try {
      const sonDurum = await this.getSonBilinenDurum(cihaz.cihazId);
      await this.yenidenBaslamayiIzle(cihaz, payload);

      await prisma.cihazDurumu.create({
        data: {
          cihazId: cihaz.cihazId,
          kapiDurumu: sonDurum?.kapiDurumu ?? 'kapali',
          cihazDurumTip: 'cevrimici',
          bataryaSeviyesi: payload.bataryaSeviyesi ?? payload.batarya_seviyesi ?? null,
          wifiSignali: payload.wifiSignali ?? payload.wifi_rssi ?? null,
          firmwareVersiyon: payload.firmwareVersiyon ?? payload.firmware_versiyon ?? sonDurum?.firmwareVersiyon ?? null,
          bellekKullanimi: payload.bellekKullanimi ?? payload.bellek_kullanimi ?? null,
          kapiAcilmaSayaci: sonDurum?.kapiAcilmaSayaci ?? null,
          sonHeartbeat: new Date()
        }
      });
    } catch (error) {
      console.error(`[MQTT] Sağlık mesajı işlenirken hata (cihaz ${cihaz.cihazId}):`, error);
    }
  }

  async logAccessDecision({ cihaz, payload, eventId, decision, card, userId }) {
    const existing = await prisma.erisimKaydi.findUnique({
      where: { cihazOlayId: eventId }
    });
    if (existing) return existing;

    const kapiId = decision.door?.kapiId;
    if (!kapiId) {
      await prisma.olay.create({
        data: {
          tur: 'erisim-basarisiz',
          kaynak: 'cihaz',
          cihazId: cihaz.cihazId,
          kapiId: null,
          kullaniciId: userId,
          detay: sanitizedAccessPayload(payload, decision),
          olayTamani: parseEventTime(payload)
        }
      });
      return null;
    }

    const eventTime = parseEventTime(payload);
    const lastRecord = await prisma.erisimKaydi.aggregate({ _max: { kayitId: true } });

    await prisma.$transaction([
      prisma.olay.create({
        data: {
          tur: decision.allowed ? 'erisim-basarili' : 'erisim-basarisiz',
          kaynak: 'cihaz',
          cihazId: cihaz.cihazId,
          kapiId,
          kullaniciId: userId,
          detay: sanitizedAccessPayload(payload, decision),
          olayTamani: eventTime
        }
      }),
      prisma.erisimKaydi.create({
        data: {
          kayitId: (lastRecord._max.kayitId || 0n) + 1n,
          cihazOlayId: eventId,
          cihazId: cihaz.cihazId,
          kapiId,
          kullaniciId: userId,
          kartId: card?.kartId || null,
          okunanUid: payload.okunan_uid || payload.okunanUid || null,
          dogrulamaYontemi: payload.dogrulama_yontemi === 'pin' ? 'pin' : 'kart',
          sonuc: decision.allowed ? 'izin' : 'red',
          redNedeni: decision.allowed ? null : (decision.reason || 'yetkisiz'),
          // Sadece çevrimiçi PIN doğrulamasında dolu gelir (bkz. accessDecisionService.verifyPin);
          // kart girişlerinde veya offline/HMAC tabanlı doğrulamada null kalır.
          kapiSifreId: decision.kapiSifreId || null,
          olayTamani: eventTime
        }
      })
    ]);

    if (decision.allowed && card) {
      await prisma.kartYetkilendirme.updateMany({
        where: { kartUid: card.kartUid, durum: 'aktif' },
        data: { sonKullanilmaTarihi: new Date() }
      });
    }

    return null;
  }

  publishAccessResponse(cihazId, requestId, decision) {
    return this.publishCommand(cihazId, 'erisim-yanit', {
      komut_tipi: 'ACCESS_RESPONSE',
      cihaz_olay_id: requestId,
      onay: decision.allowed,
      kullanici_id: decision.userId?.toString() || null,
      red_nedeni: decision.reason || null
    });
  }

  async handleOfflineAccessRecord(cihaz, payload, eventId) {
    const cardUid = String(payload.okunan_uid || payload.okunanUid || '').trim().toUpperCase();
    let card = cardUid
      ? await prisma.kart.findUnique({
          where: { kartUid: cardUid },
          include: {
            kartYetkilendirmeler: {
              where: { durum: 'aktif' },
              take: 1
            }
          }
        })
      : null;

    if (!card && cardUid) {
      await cardApprovalService.handleUnknownCardScan(cardUid);
      card = await prisma.kart.findUnique({ where: { kartUid: cardUid } });
    }

    const door = await accessDecisionService.resolveDoor(
      cihaz.cihazId,
      parsePositiveInt(payload.kapi_id || payload.kapiId)
    );
    const userId = card?.kartYetkilendirmeler?.[0]?.kullaniciId
      || safeBigInt(payload.kullanici_id || payload.kullaniciId);
    const decision = {
      allowed: payload.sonuc === 'izin' || payload.sonuc === 'basarili',
      reason: payload.red_nedeni || null,
      userId,
      card,
      door
    };

    await this.logAccessDecision({
      cihaz,
      payload,
      eventId,
      decision,
      card,
      userId
    });

    console.log(`[MQTT] Cihaz ${cihaz.cihazId} offline erişim kaydı işlendi.`);
  }

  async handleErisimIstegi(cihaz, payload) {
    const suppliedRequestId = String(
      payload.cihaz_olay_id || payload.cihazOlayId || payload.istek_id || ''
    );
    const eventId = UUID_PATTERN.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    const responseRequestId = suppliedRequestId || eventId;

    try {
      const existing = await prisma.erisimKaydi.findUnique({
        where: { cihazOlayId: eventId }
      });
      const isOfflineRecord = Boolean(payload.sonuc);

      if (existing) {
        if (!isOfflineRecord) {
          this.publishAccessResponse(cihaz.cihazId, responseRequestId, {
            allowed: existing.sonuc === 'izin',
            reason: existing.redNedeni,
            userId: existing.kullaniciId
          });
        }
        return;
      }

      if (isOfflineRecord) {
        await this.handleOfflineAccessRecord(cihaz, payload, eventId);
        return;
      }

      const method = payload.dogrulama_yontemi === 'pin' ? 'pin' : 'kart';
      const requestedDoorId = parsePositiveInt(payload.kapi_id || payload.kapiId);
      let decision;

      if (method === 'pin') {
        decision = await accessDecisionService.verifyPin({
          cihazId: cihaz.cihazId,
          kapiId: requestedDoorId,
          pin: payload.pin
        });
      } else {
        decision = await accessDecisionService.verifyCard({
          cihazId: cihaz.cihazId,
          kapiId: requestedDoorId,
          kartUid: payload.okunan_uid || payload.okunanUid
        });
      }

      let card = decision.card;
      if (!card && method === 'kart') {
        const normalizedUid = String(payload.okunan_uid || payload.okunanUid || '').trim().toUpperCase();
        card = normalizedUid
          ? await prisma.kart.findUnique({ where: { kartUid: normalizedUid } })
          : null;
      }

      await this.logAccessDecision({
        cihaz,
        payload,
        eventId,
        decision,
        card,
        userId: decision.userId
      });
      this.publishAccessResponse(cihaz.cihazId, responseRequestId, decision);

      console.log(
        `[MQTT] Cihaz ${cihaz.cihazId} erişim kararı: `
        + `${decision.allowed ? 'ONAYLANDI / KAPI AÇILACAK' : `REDDEDİLDİ / ${decision.reason}`}`
      );
    } catch (error) {
      console.error(`[MQTT] Erişim isteği işlenirken hata (cihaz ${cihaz.cihazId}):`, error);
      this.publishAccessResponse(cihaz.cihazId, responseRequestId, {
        allowed: false,
        reason: 'sunucu_hatasi',
        userId: null
      });
    }
  }

  publishCommand(cihazId, komutTuru, payload) {
    if (!this.connected) {
      console.error('[MQTT] Bağlı değil, mesaj gönderilemedi.');
      return false;
    }

    const commandTypes = {
      'kapi-ac': 'DOOR_OPEN',
      'sifre-guncelleme': 'PASSWORD_RENEW',
      'kart-engelle': 'BLOCK',
      'kart-engel-kaldir': 'UNBLOCK',
      'firmware-guncelle': 'FIRMWARE_UPDATE',
      'erisim-yanit': 'ACCESS_RESPONSE'
    };
    const normalizedPayload = {
      ...payload,
      kullanici_id: payload.kullanici_id || payload.adminId || null,
      komut_tipi: payload.komut_tipi || commandTypes[komutTuru] || komutTuru,
      zaman: payload.zaman || Math.floor(Date.now() / 1000)
    };
    const topic = `kapi/${cihazId}/${komutTuru}`;

    this.client.publish(topic, JSON.stringify(normalizedPayload), { qos: 1 }, (err) => {
      if (err) console.error(`[MQTT] Publish hatası (${topic}):`, err.message);
    });

    return true;
  }
}

module.exports = new MqttService();
