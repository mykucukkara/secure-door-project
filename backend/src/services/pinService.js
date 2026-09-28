const crypto = require('crypto');
const argon2 = require('argon2');
const prisma = require('../config/prisma');
const mqttService = require('./mqttService');
const { recordPinHistory, decryptPin } = require('./pinHistoryService');

// -----------------------------------------------------------------------------
// Kapı şifresi (PIN) politikası
// -----------------------------------------------------------------------------
// Öğretim üyelerinin isteği doğrultusunda kapı şifresi artık KALICIDIR:
//   - Her kullanıcının tek bir kapı şifresi vardır ve süresi dolmaz.
//   - Kullanıcı isterse Profil sayfasından şifresini görebilir ve değiştirebilir
//     (kendi belirlediği 6 haneli bir şifre ya da rastgele üretilen bir şifre).
//   - Gece otomatik şifre yenileme varsayılan olarak KAPALIDIR. Eski davranış
//     gerekiyorsa .env içinde PIN_OTOMATIK_YENILEME=true yapılabilir.
// -----------------------------------------------------------------------------

const PIN_REGEX = /^\d{6}$/;
const OFFLINE_LIST_VALIDITY_MS = 10 * 365 * 24 * 60 * 60 * 1000; // pratikte süresiz

// Tahmini kolay, güvenliği zayıf PIN'ler.
const WEAK_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555', '666666',
  '777777', '888888', '999999', '123456', '654321', '123123', '112233',
  '121212', '101010', '010203', '000001', '999998', '159753', '147258',
  '258369', '123321', '098765', '012345', '543210'
]);

class PinPolicyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'PinPolicyError';
    this.statusCode = statusCode;
  }
}

function isAutoRotationEnabled() {
  return String(process.env.PIN_OTOMATIK_YENILEME || 'false').toLowerCase() === 'true';
}

function isSequential(pin) {
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i += 1) {
    const diff = Number(pin[i]) - Number(pin[i - 1]);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return asc || desc;
}

/**
 * Kullanıcının kendi belirlediği PIN'i kontrol eder.
 * @returns {{ valid: boolean, message?: string }}
 */
function validateCustomPin(pin) {
  const value = String(pin ?? '').trim();
  if (!PIN_REGEX.test(value)) {
    return { valid: false, message: 'Kapı şifresi tam olarak 6 rakamdan oluşmalıdır.' };
  }
  if (/^(\d)\1{5}$/.test(value)) {
    return { valid: false, message: 'Aynı rakamın tekrarından oluşan şifre kullanılamaz (ör. 111111).' };
  }
  if (isSequential(value)) {
    return { valid: false, message: 'Ardışık rakamlardan oluşan şifre kullanılamaz (ör. 123456).' };
  }
  if (WEAK_PINS.has(value)) {
    return { valid: false, message: 'Bu şifre çok kolay tahmin edilebilir. Lütfen başka bir şifre seçin.' };
  }
  return { valid: true };
}

function generateRandomPin() {
  // Zayıf/ardışık PIN üretmemek için birkaç kez dene.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = crypto.randomInt(100000, 1000000).toString();
    if (validateCustomPin(pin).valid) return pin;
  }
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * PIN'ler kapıda kullanıcıyı tanımlamak için kullanılır; bu yüzden iki aktif
 * kullanıcı aynı PIN'e sahip olamaz.
 */
async function isPinInUse(pin, excludeUserId = null) {
  const users = await prisma.kullanici.findMany({
    where: {
      durum: 'aktif',
      pinHash: { not: null },
      ...(excludeUserId != null ? { NOT: { kullaniciId: BigInt(excludeUserId) } } : {})
    },
    select: { kullaniciId: true, pinHash: true }
  });
  for (const user of users) {
    try {
      if (await argon2.verify(user.pinHash, pin)) return true;
    } catch (error) {
      // Bozuk hash kaydı: çakışma sayma.
    }
  }
  return false;
}

async function generateUniquePin(excludeUserId = null) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pin = generateRandomPin();
    if (!(await isPinInUse(pin, excludeUserId))) return pin;
  }
  throw new Error('Benzersiz bir kapı şifresi üretilemedi. Lütfen tekrar deneyin.');
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

/**
 * Kullanıcının o anki (aktif) kapı şifresini şifreli geçmiş kaydından çözer.
 * PIN kalıcı olduğu için süresi dolmuş sayılmaz.
 */
async function readActivePin(kullaniciId, client = prisma) {
  const record = await client.kapiSifreGecmisi.findFirst({
    where: { kullaniciId: BigInt(kullaniciId), aktif: true },
    orderBy: { olusturulma: 'desc' }
  });
  if (!record || !record.pinSifreli) return { record: record || null, pin: null };
  try {
    return { record, pin: decryptPin(record.pinSifreli) };
  } catch (error) {
    return { record, pin: null };
  }
}

async function generateOfflineListForDevice(cihazId, rawPinsByUserId = new Map(), replace = true) {
  const deviceId = Number.parseInt(cihazId, 10);
  const assignment = await prisma.cihazKapiAtama.findFirst({
    where: { cihazId: deviceId, bitis: null }
  });
  if (!assignment) throw new Error('Bu cihaza atanmış aktif bir kapı bulunamadı.');

  const eligibleUsers = await getEligibleUsersForDoor(assignment.kapiId);
  const deviceSecret = process.env.ESP32_SECRET_KEY || 'securelab-device-development-key';
  const expiresAt = new Date(Date.now() + OFFLINE_LIST_VALIDITY_MS);
  const list = [];

  // Tam liste (replace=true) istendiğinde, haritada verilmeyen kullanıcıların
  // kalıcı PIN'leri şifreli geçmişten çözülerek listeye eklenir. Böylece
  // "Offline listeyi yeniden gönder" işlemi herkesin güncel şifresini içerir.
  const fillMissingFromHistory = replace;

  for (const { user, rule } of eligibleUsers) {
    const userId = user.kullaniciId.toString();
    let rawPin = rawPinsByUserId.get(userId);
    if (!rawPin && fillMissingFromHistory) {
      rawPin = (await readActivePin(user.kullaniciId)).pin;
    }
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

async function pushPinToActiveDevices(userId, pin) {
  const devices = await prisma.cihaz.findMany({ where: { durum: 'aktif' } });
  const rawPinsByUserId = new Map([[userId.toString(), pin]]);
  const results = [];
  for (const device of devices) {
    try {
      results.push(await generateOfflineListForDevice(device.cihazId, rawPinsByUserId, false));
    } catch (error) {
      results.push({ cihazId: device.cihazId, hata: error.message });
    }
  }
  return results;
}

/**
 * Kullanıcının kalıcı kapı şifresini belirler.
 * @param {string|number|bigint} kullaniciId
 * @param {{ pin?: string, kaynak?: string }} options
 *   pin verilirse politika + benzersizlik kontrolünden geçirilir;
 *   verilmezse rastgele ve benzersiz bir PIN üretilir.
 */
async function setUserPin(kullaniciId, { pin, kaynak = 'kullanici' } = {}) {
  const userId = BigInt(kullaniciId);
  const existingUser = await prisma.kullanici.findUnique({ where: { kullaniciId: userId } });
  if (!existingUser || existingUser.durum !== 'aktif') {
    throw new PinPolicyError('Aktif kullanıcı bulunamadı.', 404);
  }

  let newPin;
  if (pin !== undefined && pin !== null && String(pin).trim() !== '') {
    newPin = String(pin).trim();
    const validation = validateCustomPin(newPin);
    if (!validation.valid) throw new PinPolicyError(validation.message);

    const current = await readActivePin(userId);
    if (current.pin && current.pin === newPin) {
      throw new PinPolicyError('Yeni kapı şifresi mevcut kapı şifresiyle aynı olamaz.');
    }
    if (await isPinInUse(newPin, userId)) {
      throw new PinPolicyError('Bu kapı şifresi kullanılamıyor. Lütfen farklı bir şifre seçin.', 409);
    }
  } else {
    newPin = await generateUniquePin(userId);
  }

  const pinHash = await argon2.hash(newPin);
  const changedAt = new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.kullanici.update({
      where: { kullaniciId: userId },
      data: {
        pinHash,
        pinSonDegisim: changedAt,
        pinGecerlilikBitis: null
      }
    });
    await recordPinHistory(transaction, {
      kullaniciId: userId,
      pin: newPin,
      pinHash,
      gecerlilikBitis: null,
      kaynak
    });
  });

  const deviceResults = await pushPinToActiveDevices(userId, newPin);

  return {
    kullaniciId: userId.toString(),
    yeniPin: newPin,
    kalici: true,
    gecerlilikBitis: null,
    sonDegisim: changedAt,
    cihazlar: deviceResults
  };
}

/** Geriye dönük uyumluluk: rastgele yeni kalıcı PIN üretir. */
async function refreshSingleUserPin(kullaniciId, kaynak = 'manuel') {
  return setUserPin(kullaniciId, { kaynak });
}

/**
 * Kullanıcının güncel kapı şifresini döndürür (Profil sayfası için).
 */
async function getCurrentPin(kullaniciId) {
  const userId = BigInt(kullaniciId);
  const user = await prisma.kullanici.findUnique({
    where: { kullaniciId: userId },
    select: { kullaniciId: true, pinHash: true, pinSonDegisim: true, pinGecerlilikBitis: true }
  });
  if (!user) throw new PinPolicyError('Kullanıcı bulunamadı.', 404);

  const { record, pin } = await readActivePin(userId);
  return {
    kullaniciId: userId.toString(),
    tanimli: Boolean(user.pinHash),
    pin,
    gorunebilir: Boolean(pin),
    kalici: !user.pinGecerlilikBitis,
    sonDegisim: user.pinSonDegisim || record?.olusturulma || null,
    kaynak: record?.kaynak || null
  };
}

/**
 * Yalnızca PIN_OTOMATIK_YENILEME=true iken cron tarafından kullanılır.
 * Tüm kullanıcılara 24 saat geçerli yeni PIN üretir (eski davranış).
 */
async function refreshAllUsersPins() {
  const users = await prisma.kullanici.findMany({ where: { durum: 'aktif' } });
  const rawPinsByUserId = new Map();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const usedPins = new Set();

  for (const user of users) {
    let pin = generateRandomPin();
    while (usedPins.has(pin)) pin = generateRandomPin();
    usedPins.add(pin);
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

module.exports = {
  PinPolicyError,
  isAutoRotationEnabled,
  validateCustomPin,
  generateRandomPin,
  generateUniquePin,
  isPinInUse,
  pushOfflineListToESP32,
  generateOfflineListForDevice,
  setUserPin,
  getCurrentPin,
  refreshAllUsersPins,
  refreshSingleUserPin
};
