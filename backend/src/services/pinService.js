const crypto = require('crypto');
const argon2 = require('argon2');
const prisma = require('../config/prisma');
const mqttService = require('./mqttService');
const { recordPinHistory } = require('./pinHistoryService');

function generateRandomPin() {
  return crypto.randomInt(100000, 1000000).toString();
}

function pushOfflineListToESP32(cihazId, userPinList, replace = true) {
  return mqttService.publishCommand(cihazId, 'sifre-guncelleme', {
    komut_tipi: 'PASSWORD_RENEW',
    yeni_liste: userPinList,
    replace,
    zaman: Math.floor(Date.now() / 1000)
  });
}

async function getEligibleUsersForDoor(kapiId) {
  const rules = await prisma.yetkiKurali.findMany({
    where: { kapiId, aktif: true },
    include: {
      kullanici: {
        include: {
          kartYetkilendirmeler: { where: { durum: 'aktif' }, take: 1 }
        }
      },
      grup: {
        include: {
          uyeler: {
            include: {
              kullanici: {
                include: {
                  kartYetkilendirmeler: { where: { durum: 'aktif' }, take: 1 }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!rules.length) {
    const users = await prisma.kullanici.findMany({
      where: { durum: 'aktif', pinHash: { not: null } },
      include: {
        kartYetkilendirmeler: { where: { durum: 'aktif' }, take: 1 }
      }
    });
    return users.map((user) => ({
      user,
      rule: { gunMaskesi: 127, saatBaslangic: '00:00', saatBitis: '23:59' }
    }));
  }

  const members = new Map();
  for (const rule of rules) {
    if (rule.kullanici?.durum === 'aktif') {
      members.set(rule.kullanici.kullaniciId.toString(), { user: rule.kullanici, rule });
    }
    for (const membership of rule.grup?.uyeler || []) {
      if (membership.kullanici?.durum === 'aktif') {
        members.set(membership.kullanici.kullaniciId.toString(), {
          user: membership.kullanici,
          rule
        });
      }
    }
  }
  return [...members.values()];
}

async function generateOfflineListForDevice(cihazId, rawPinsByUserId = new Map(), replace = true) {
  const deviceId = Number.parseInt(cihazId, 10);
  const assignment = await prisma.cihazKapiAtama.findFirst({
    where: { cihazId: deviceId, bitis: null }
  });
  if (!assignment) throw new Error('Bu cihaza atanmış aktif bir kapı bulunamadı.');

  const eligibleUsers = await getEligibleUsersForDoor(assignment.kapiId);
  const deviceSecret = process.env.ESP32_SECRET_KEY || 'securelab-device-development-key';
  const expiresAt = null;// süre sınırı yok
  const list = [];

  for (const { user, rule } of eligibleUsers) {
    const userId = user.kullaniciId.toString();
    const rawPin = rawPinsByUserId.get(userId);
    if (!rawPin) continue;
    list.push({
      u: userId,
      p: rawPin,
      kartUid: user.kartYetkilendirmeler?.[0]?.kartUid || null,
      gunMaskesi: rule.gunMaskesi || 127,
      saatBaslangic: rule.saatBaslangic || '00:00',
      saatBitis: rule.saatBitis || '23:59'
    });
  }

  const version = await prisma.offlineListeSurumu.create({
    data: {
      cihazId: deviceId,
      gecerlilikBitis: expiresAt,
      uyeler: {
        create: list.map((entry) => ({
          kullaniciId: BigInt(entry.u),
          kartUid: entry.kartUid,
          pinHmac: crypto.createHmac('sha256', deviceSecret).update(entry.p).digest('hex'),
          gunMaskesi: entry.gunMaskesi,
          saatBaslangic: entry.saatBaslangic,
          saatBitis: entry.saatBitis
        }))
      }
    },
    include: { uyeler: true }
  });

  const published = pushOfflineListToESP32(deviceId, list, replace);
  return {
    surumId: version.surumId.toString(),
    toplamUye: list.length,
    mqttGonderildi: published,
    gecerlilikBitis: expiresAt
  };
}

async function refreshAllUsersPins() {
  const users = await prisma.kullanici.findMany({ where: { durum: 'aktif' } });
  const rawPinsByUserId = new Map();
  const expiresAt = null; // süre sınırı yok

  for (const user of users) {
    const pin = generateRandomPin();
    rawPinsByUserId.set(user.kullaniciId.toString(), pin);
    const pinHash = await argon2.hash(pin);
    await prisma.$transaction(async (transaction) => {
      await transaction.kullanici.update({
        where: { kullaniciId: user.kullaniciId },
        data: {
          pinHash,
          pinSonDegisim: new Date(),
          pinGecerlilikBitis: expiresAt
        }
      });
      await recordPinHistory(transaction, {
        kullaniciId: user.kullaniciId,
        pin,
        pinHash,
        gecerlilikBitis: expiresAt,
        kaynak: 'otomatik'
      });
    });
  }

  const devices = await prisma.cihaz.findMany({ where: { durum: 'aktif' } });
  const results = [];
  for (const device of devices) {
    results.push(await generateOfflineListForDevice(device.cihazId, rawPinsByUserId, true));
  }
  return results;
}

async function refreshSingleUserPin(kullaniciId) {
  const userId = BigInt(kullaniciId);
  const existingUser = await prisma.kullanici.findUnique({ where: { kullaniciId: userId } });
  if (!existingUser || existingUser.durum !== 'aktif') {
    throw new Error('Aktif kullanıcı bulunamadı.');
  }

  const newPin = generateRandomPin();
  const expiresAt = null;
  const pinHash = await argon2.hash(newPin);
  await prisma.$transaction(async (transaction) => {
    await transaction.kullanici.update({
      where: { kullaniciId: userId },
      data: {
        pinHash,
        pinSonDegisim: new Date(),
        pinGecerlilikBitis: expiresAt
      }
    });
    await recordPinHistory(transaction, {
      kullaniciId: userId,
      pin: newPin,
      pinHash,
      gecerlilikBitis: expiresAt,
      kaynak: 'manuel'
    });
  });

  const devices = await prisma.cihaz.findMany({ where: { durum: 'aktif' } });
  const rawPinsByUserId = new Map([[userId.toString(), newPin]]);
  const deviceResults = [];
  for (const device of devices) {
    deviceResults.push(await generateOfflineListForDevice(device.cihazId, rawPinsByUserId, false));
  }

  return {
    kullaniciId: userId.toString(),
    yeniPin: newPin,
    gecerlilikBitis: expiresAt,
    cihazlar: deviceResults
  };
}

module.exports = {
  generateRandomPin,
  pushOfflineListToESP32,
  generateOfflineListForDevice,
  refreshAllUsersPins,
  refreshSingleUserPin
};
