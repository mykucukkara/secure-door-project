/**
 * Hesap açma / geçici şifre işlemleri.
 *
 * Akış:
 *  1. Yönetici "Yeni Kullanıcı Ekle" sayfasından hesap açar.
 *  2. Sunucu tahmin edilemez bir geçici şifre üretir (yönetici şifre seçemez),
 *     argon2 ile saklar, sifreDegistirmeZorunlu = true ve süre sonu koyar.
 *  3. Geçici şifre kullanıcının kurumsal e-postasına gönderilir.
 *  4. Kullanıcı ilk girişte şifresini değiştirene kadar API'nin geri kalanı
 *     kilitlidir (authMiddleware).
 */
const argon2 = require('argon2');
const prisma = require('../config/prisma');
const { writeAudit } = require('./auditService');
const { recordPinHistory } = require('./pinHistoryService');
const { generateUniquePin } = require('./pinService');
const {
  generateTemporaryWebPassword,
  temporaryPasswordExpiry
} = require('./webPasswordService');
const { isMailConfigured, sendAccountInviteEmail } = require('./mailService');

const EPOSTA_RE = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

function allowedEmailDomains() {
  return String(process.env.IZINLI_EPOSTA_ALANLARI || 'subu.edu.tr')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 128 && EPOSTA_RE.test(email);
}

function isAllowedEmailDomain(value) {
  const domain = normalizeEmail(value).split('@')[1] || '';
  return allowedEmailDomains().some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function cleanName(value, max = 64) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function loginUrl() {
  const explicit = String(process.env.APP_BASE_URL || '').trim();
  if (explicit) return `${explicit.replace(/\/+$/, '')}/login.html`;
  const resetBase = String(process.env.PASSWORD_RESET_BASE_URL || '').trim();
  if (resetBase) {
    try {
      return new URL('login.html', resetBase).toString();
    } catch (error) { /* aşağıya düş */ }
  }
  const origin = String(process.env.CORS_ORIGIN || 'http://localhost').split(',')[0].trim();
  return `${origin.replace(/\/+$/, '')}/login.html`;
}

async function findUserByEmail(email, client = prisma) {
  return client.kullanici.findFirst({
    where: { eposta: { equals: normalizeEmail(email), mode: 'insensitive' } }
  });
}

async function activeAdminCount(client = prisma, excludeUserId = null) {
  return client.kullanici.count({
    where: {
      rol: 'admin',
      durum: 'aktif',
      ...(excludeUserId != null ? { NOT: { kullaniciId: BigInt(excludeUserId) } } : {})
    }
  });
}

function hataOlustur(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Yeni kullanıcıyı geçici şifreyle oluşturur. Geçici şifre yalnızca dönüş
 * değerinde bulunur; veritabanına ve loglara düz metin olarak yazılmaz.
 */
async function createInvitedUser({ ad, soyad, unvan, eposta, birimId, actorId }) {
  const temizAd = cleanName(ad);
  const temizSoyad = cleanName(soyad);
  const temizUnvan = cleanName(unvan, 48) || null;
  const email = normalizeEmail(eposta);

  if (!temizAd || !temizSoyad) throw hataOlustur('Ad ve soyad zorunludur.');
  if (!email) throw hataOlustur('Geçici şifrenin gönderilebilmesi için e-posta adresi zorunludur.');
  if (!isValidEmail(email)) throw hataOlustur('Geçerli bir e-posta adresi girin.');
  if (!isAllowedEmailDomain(email)) {
    throw hataOlustur(`Yalnızca kurumsal e-posta adresleriyle hesap açılabilir (${allowedEmailDomains().map((d) => '@' + d).join(', ')}).`);
  }
  if (await findUserByEmail(email)) throw hataOlustur('Bu e-posta adresiyle kayıtlı bir hesap zaten var.', 409);

  let birim = null;
  if (birimId != null && birimId !== '') {
    birim = Number.parseInt(birimId, 10);
    if (!Number.isInteger(birim)) throw hataOlustur('Geçersiz birim.');
  } else {
    const ceng = await prisma.birim.findUnique({ where: { kod: 'CENG' } });
    birim = ceng ? ceng.birimId : null;
  }

  const temporaryPassword = generateTemporaryWebPassword();
  const expiresAt = temporaryPasswordExpiry();
  const initialPin = await generateUniquePin();
  const [passwordHash, pinHash] = await Promise.all([argon2.hash(temporaryPassword), argon2.hash(initialPin)]);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.kullanici.create({
      data: {
        ad: temizAd,
        soyad: temizSoyad,
        unvan: temizUnvan,
        eposta: email,
        birimId: birim,
        rol: 'hoca',
        durum: 'aktif',
        sifreHash: passwordHash,
        sifreGecerlilikBitis: expiresAt,
        sifreDegistirmeZorunlu: true,
        pinHash,
        pinSonDegisim: new Date(),
        pinGecerlilikBitis: null
      }
    });
    await recordPinHistory(tx, {
      kullaniciId: created.kullaniciId,
      pin: initialPin,
      pinHash,
      gecerlilikBitis: null,
      kaynak: 'yonetici'
    });
    await writeAudit({
      client: tx,
      actorId,
      action: 'olustur',
      tableName: 'kullanici',
      recordId: created.kullaniciId,
      after: {
        ad: created.ad,
        soyad: created.soyad,
        eposta: created.eposta,
        rol: created.rol,
        geciciSifre: 'olusturuldu',
        geciciSifreBitis: expiresAt.toISOString()
      }
    });
    return created;
  });

  return { user, temporaryPassword, expiresAt };
}

/** Mevcut kullanıcıya yeni geçici şifre verir ve tüm oturumlarını kapatır. */
async function issueTemporaryPassword(userId, actorId) {
  const target = await prisma.kullanici.findUnique({ where: { kullaniciId: BigInt(userId) } });
  if (!target) throw hataOlustur('Kullanıcı bulunamadı.', 404);
  if (!target.eposta) throw hataOlustur('Kullanıcının e-posta adresi yok; önce e-posta tanımlayın.');
  if (target.durum !== 'aktif') throw hataOlustur('Pasif hesaba geçici şifre verilemez. Önce hesabı aktifleştirin.', 409);

  const temporaryPassword = generateTemporaryWebPassword();
  const expiresAt = temporaryPasswordExpiry();
  const passwordHash = await argon2.hash(temporaryPassword);

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.kullanici.update({
      where: { kullaniciId: target.kullaniciId },
      data: {
        sifreHash: passwordHash,
        sifreGecerlilikBitis: expiresAt,
        sifreDegistirmeZorunlu: true,
        oturumSurumu: { increment: 1 }
      }
    });
    // Bekleyen "şifremi unuttum" bağlantıları da geçersiz olsun.
    await tx.webSifreSifirlama.updateMany({
      where: { kullaniciId: target.kullaniciId, kullanildi: null, iptal: false },
      data: { iptal: true }
    });
    await writeAudit({
      client: tx,
      actorId,
      action: 'guncelle',
      tableName: 'kullanici',
      recordId: target.kullaniciId,
      after: { geciciSifre: 'yenilendi', tumOturumlar: 'kapatildi', geciciSifreBitis: expiresAt.toISOString() }
    });
    return updated;
  });

  return { user, temporaryPassword, expiresAt };
}

/**
 * Geçici şifreyi e-postayla iletir. SMTP tanımlı değilse ya da gönderim
 * başarısız olursa şifre, yöneticinin elden iletebilmesi için bir kez
 * yanıtta döndürülür.
 */
async function deliverTemporaryPassword({ user, temporaryPassword, expiresAt, yenileme = false }) {
  const adSoyad = [user.unvan, user.ad, user.soyad].filter(Boolean).join(' ');
  const sonuc = {
    eposta: user.eposta,
    geciciSifreBitis: expiresAt.toISOString(),
    mailGonderildi: false
  };
  if (isMailConfigured()) {
    try {
      await sendAccountInviteEmail({
        to: user.eposta,
        name: adSoyad,
        temporaryPassword,
        loginUrl: loginUrl(),
        expiresAt,
        yenileme
      });
      sonuc.mailGonderildi = true;
      return sonuc;
    } catch (error) {
      console.error('[HESAP] Geçici şifre e-postası gönderilemedi:', error.message);
      sonuc.mailHatasi = 'E-posta gönderilemedi. Şifreyi kullanıcıya güvenli bir yoldan elden iletin.';
    }
  } else {
    sonuc.mailHatasi = 'E-posta sunucusu (SMTP) tanımlı olmadığı için e-posta gönderilemedi. Şifreyi kullanıcıya güvenli bir yoldan elden iletin.';
  }
  sonuc.geciciSifre = temporaryPassword;
  return sonuc;
}

module.exports = {
  allowedEmailDomains,
  isAllowedEmailDomain,
  isValidEmail,
  normalizeEmail,
  findUserByEmail,
  activeAdminCount,
  createInvitedUser,
  issueTemporaryPassword,
  deliverTemporaryPassword,
  loginUrl
};
