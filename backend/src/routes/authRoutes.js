const express = require('express');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const prisma = require('../config/prisma');
const { authenticateToken, JWT_SECRET } = require('../middlewares/authMiddleware');
const { validateWebPassword } = require('../services/webPasswordService');
const { createPasswordReset, consumePasswordReset } = require('../services/passwordResetService');
const { isMailConfigured, sendPasswordResetEmail } = require('../services/mailService');
const { writeAudit } = require('../services/auditService');
const { isProduction } = require('../config/security');

const router = express.Router();
const GENERIC_RESET_MESSAGE = 'Hesap bulunursa şifre yenileme bağlantısı gönderilecektir.';

const serializeUser = (user) => ({
  kullaniciId: user.kullaniciId.toString(),
  ad: user.ad,
  soyad: user.soyad,
  unvan: user.unvan || null,
  eposta: user.eposta,
  birimId: user.birimId,
  rol: user.rol,
  durum: user.durum,
  sifreDegistirmeZorunlu: Boolean(user.sifreDegistirmeZorunlu),
  sifreGecerlilikBitis: user.sifreDegistirmeZorunlu ? user.sifreGecerlilikBitis : null
});

function signSessionToken(user) {
  return jwt.sign({
    kullaniciId: user.kullaniciId.toString(),
    eposta: user.eposta,
    rol: user.rol,
    oturumSurumu: user.oturumSurumu
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h' });
}

// Kullanıcı bulunamasa bile aynı sürede yanıt vermek için (e-posta
// numaralandırma saldırılarına karşı) sahte bir hash doğrulanır.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = argon2.hash('securelab-zamanlama-dengeleme');
  return dummyHashPromise;
}

router.post('/login', async (req, res) => {
  try {
    const normalizedEmail = String(req.body.eposta || '').trim().toLowerCase();
    const password = String(req.body.pin || req.body.sifre || '');
    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: 'E-posta ve şifre gereklidir.' });
    }
    if (normalizedEmail.length > 128 || password.length > 128) {
      return res.status(401).json({ message: 'E-posta veya şifre hatalı.' });
    }

    const user = await prisma.kullanici.findFirst({
      where: { eposta: { equals: normalizedEmail, mode: 'insensitive' } }
    });
    // Web girişi yalnızca web şifresiyle yapılır; kapı PIN'i web şifresi yerine geçmez.
    const credentialHash = user?.sifreHash || null;
    const passwordOk = credentialHash
      ? await argon2.verify(credentialHash, password)
      : (await argon2.verify(await dummyHash(), password), false);
    if (!passwordOk) {
      return res.status(401).json({ message: 'E-posta veya şifre hatalı.' });
    }
    if (user.durum !== 'aktif') {
      return res.status(403).json({ message: 'Kullanıcı hesabı aktif değil. Bölüm yöneticisiyle iletişime geçin.' });
    }
    if (user.sifreDegistirmeZorunlu && user.sifreGecerlilikBitis
      && new Date(user.sifreGecerlilikBitis).getTime() < Date.now()) {
      return res.status(403).json({
        message: 'Geçici şifrenizin süresi dolmuş. "Şifremi unuttum" bağlantısını kullanın ya da yöneticiden yeni geçici şifre isteyin.',
        code: 'GECICI_SIFRE_SURESI_DOLDU'
      });
    }

    const updated = await prisma.kullanici.update({
      where: { kullaniciId: user.kullaniciId },
      data: { sonGiris: new Date() }
    });

    return res.json({
      message: user.sifreDegistirmeZorunlu
        ? 'Giriş başarılı. Devam etmek için kendi şifrenizi belirleyin.'
        : 'Giriş başarılı.',
      token: signSessionToken(updated),
      user: serializeUser(updated)
    });
  } catch (error) {
    console.error('Login hatası:', error);
    return res.status(500).json({ message: 'Giriş işlemi tamamlanamadı.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const normalizedEmail = String(req.body.eposta || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return res.status(400).json({ message: 'E-posta adresi gereklidir.' });
  }

  try {
    const user = await prisma.kullanici.findFirst({
      where: { eposta: { equals: normalizedEmail, mode: 'insensitive' } }
    });
    if (!user || user.durum !== 'aktif' || !user.eposta) {
      return res.json({ message: GENERIC_RESET_MESSAGE });
    }

    const { rawToken, expiresAt } = await createPasswordReset(user.kullaniciId, req.ip);
    const inferredFrontend = `${req.protocol}://${req.get('host') || 'localhost:8080'}`
      .replace(/:3000$/, ':8080');
    const appBase = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    const resetPage = process.env.PASSWORD_RESET_BASE_URL
      || `${appBase || inferredFrontend}/sifre-sifirla.html`;
    const resetUrl = `${resetPage}${resetPage.includes('?') ? '&' : '?'}token=${encodeURIComponent(rawToken)}`;

    if (isMailConfigured()) {
      await sendPasswordResetEmail({
        to: user.eposta,
        name: `${user.ad} ${user.soyad}`.trim(),
        resetUrl,
        expiresAt
      });
    }

    const response = { message: GENERIC_RESET_MESSAGE };
    if (!isProduction() && process.env.ALLOW_DEV_PASSWORD_RESET === 'true') {
      response.resetUrl = resetUrl;
      response.expiresAt = expiresAt.toISOString();
    }
    return res.json(response);
  } catch (error) {
    console.error('Şifre sıfırlama talebi hatası:', error);
    return res.status(500).json({ message: 'Şifre sıfırlama talebi tamamlanamadı.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.yeniSifre || '');
    const confirmation = String(req.body.yeniSifreTekrar || '');
    if (!token || !newPassword || !confirmation) {
      return res.status(400).json({ message: 'Yenileme bağlantısı ve yeni şifre alanları gereklidir.' });
    }
    if (newPassword !== confirmation) {
      return res.status(400).json({ message: 'Yeni şifreler eşleşmiyor.' });
    }
    const validation = validateWebPassword(newPassword);
    if (!validation.valid) return res.status(400).json({ message: validation.message });

    await consumePasswordReset(token, await argon2.hash(newPassword));
    return res.json({ message: 'Şifreniz yenilendi. Güvenliğiniz için tüm eski oturumlar kapatıldı.' });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error('Şifre yenileme hatası:', error);
    return res.status(status).json({
      message: status >= 500 ? 'Şifre yenileme işlemi tamamlanamadı.' : error.message
    });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.kullanici.findUnique({
      where: { kullaniciId: req.authenticatedUser.kullaniciId }
    });
    return res.json({ user: serializeUser(user) });
  } catch (error) {
    return res.status(500).json({ message: 'Kullanıcı bilgileri alınamadı.' });
  }
});

router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const currentPassword = String(req.body.mevcutSifre || '');
    const newPassword = String(req.body.yeniSifre || '');
    const confirmation = String(req.body.yeniSifreTekrar || '');

    const user = await prisma.kullanici.findUnique({
      where: { kullaniciId: req.authenticatedUser.kullaniciId }
    });
    // İlk girişte (geçici şifreyle açılmış oturum) geçici şifre yeniden sorulmaz;
    // kullanıcı az önce onunla giriş yaptı. Normal şifre değişiminde mevcut şifre zorunludur.
    const forced = Boolean(user?.sifreDegistirmeZorunlu);
    if ((!forced && !currentPassword) || !newPassword || !confirmation) {
      return res.status(400).json({
        message: forced ? 'Yeni şifre ve şifre tekrarı gereklidir.' : 'Mevcut şifre, yeni şifre ve şifre tekrarı gereklidir.'
      });
    }
    if (newPassword !== confirmation) {
      return res.status(400).json({ message: 'Yeni şifreler eşleşmiyor.' });
    }

    const validation = validateWebPassword(newPassword, user || {});
    if (!validation.valid) return res.status(400).json({ message: validation.message });

    const credentialHash = user?.sifreHash || user?.pinHash;
    if (!credentialHash) {
      return res.status(401).json({ message: 'Mevcut web şifresi hatalı.' });
    }
    if (!forced && !(await argon2.verify(credentialHash, currentPassword))) {
      return res.status(401).json({ message: 'Mevcut web şifresi hatalı.' });
    }
    if (await argon2.verify(credentialHash, newPassword)) {
      return res.status(400).json({ message: 'Yeni şifre mevcut şifreyle aynı olamaz.' });
    }
    if (user.pinHash && await argon2.verify(user.pinHash, newPassword)) {
      return res.status(400).json({ message: 'Web şifresi kapı şifrenizle aynı olamaz.' });
    }

    const wasForced = Boolean(user.sifreDegistirmeZorunlu);
    const updated = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.kullanici.update({
        where: { kullaniciId: user.kullaniciId },
        data: {
          sifreHash: await argon2.hash(newPassword),
          sifreGecerlilikBitis: null,
          sifreDegistirmeZorunlu: false,
          oturumSurumu: { increment: 1 }
        }
      });
      await writeAudit({
        client: transaction,
        actorId: user.kullaniciId,
        action: 'guncelle',
        tableName: 'kullanici',
        recordId: user.kullaniciId,
        before: { webSifresi: wasForced ? 'gecici' : 'mevcut' },
        after: { webSifresi: 'degistirildi', tumOturumlar: 'kapatildi' }
      });
      return saved;
    });

    // Diğer cihazlardaki oturumlar kapatıldı; şifreyi değiştiren bu oturum
    // yeni bir anahtarla devam eder.
    return res.json({
      message: wasForced
        ? 'Şifreniz belirlendi. SecureLab\'e hoş geldiniz.'
        : 'Web şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.',
      token: signSessionToken(updated),
      user: serializeUser(updated)
    });
  } catch (error) {
    console.error('Web şifresi değiştirme hatası:', error);
    return res.status(500).json({ message: 'Web şifresi değiştirilemedi.' });
  }
});

router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.kullanici.update({
        where: { kullaniciId: req.authenticatedUser.kullaniciId },
        data: { oturumSurumu: { increment: 1 } }
      });
      await writeAudit({
        client: transaction,
        actorId: req.authenticatedUser.kullaniciId,
        action: 'guncelle',
        tableName: 'kullanici',
        recordId: req.authenticatedUser.kullaniciId,
        after: { tumOturumlar: 'kapatildi' }
      });
    });
    return res.json({ message: 'Tüm oturumlar güvenli biçimde kapatıldı.' });
  } catch (error) {
    return res.status(500).json({ message: 'Çıkış işlemi tamamlanamadı.' });
  }
});

module.exports = router;
