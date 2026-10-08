/**
 * Kart Kayıt İstasyonu köprüsü.
 *
 * Panel HTTP üzerinden açıldığında tarayıcı USB'ye (Web Serial) erişemez. Bu
 * yüzden istasyonun takılı olduğu bilgisayarda çalışan köprü programı
 * (kart-kayit-istasyonu/kopru) okunan UID'yi buraya iletir; Kart Yetkilendirme
 * sayfası da /durum uç noktasını sorgulayıp UID'yi forma yazar.
 *
 * Köprü istekleri JWT yerine .env'deki ISTASYON_ANAHTARI ile doğrulanır.
 * Okumalar yalnızca bellekte tutulur; kalıcı kayıt kart yetkilendirilince oluşur.
 */
const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
const { normalizeKartUid } = require('../utils/kartUid');
const { writeAudit } = require('../services/auditService');
const { kurulumDosyasiOlustur } = require('../services/istasyonKurulumService');

const router = express.Router();

// Köprü bu süre içinde nabız göndermediyse bağlı sayılmaz (köprü 15 sn'de bir gönderir).
const KOPRU_ZAMAN_ASIMI_MS = 45 * 1000;
// Bundan eski okumalar forma yazılmaz (sayfa geç açıldığında eski kart gelmesin).
const KART_GECERLILIK_MS = 60 * 1000;

const durum = {
  kopruler: new Map(), // ad -> { ad, port, istasyonBagli, sonGorulme }
  sonKart: null,       // { sira, uid, kopru, zaman }
  sira: 0
};

const kopruLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { hata: 'Çok fazla istek.' }
});

function anahtarGecerli(req) {
  const beklenen = Buffer.from(String(process.env.ISTASYON_ANAHTARI || ''));
  const gelen = Buffer.from(String(req.get('x-istasyon-anahtari') || ''));
  if (beklenen.length < 16 || gelen.length !== beklenen.length) return false;
  return crypto.timingSafeEqual(gelen, beklenen);
}

function requireKopruAnahtari(req, res, next) {
  if (anahtarGecerli(req)) return next();
  return res.status(401).json({ hata: 'Geçersiz istasyon anahtarı.' });
}

function kopruGuncelle(body, istasyonBagli) {
  const ad = String(body.ad || 'istasyon').slice(0, 64);
  durum.kopruler.set(ad, {
    ad,
    port: body.port ? String(body.port).slice(0, 32) : null,
    istasyonBagli,
    sonGorulme: Date.now()
  });
  return ad;
}

// Köprü → sunucu: canlılık bildirimi (istasyon takılı mı, hangi portta).
router.post('/nabiz', kopruLimiter, requireKopruAnahtari, (req, res) => {
  kopruGuncelle(req.body || {}, Boolean(req.body?.istasyonBagli));
  return res.json({ ok: true });
});

// Köprü → sunucu: istasyonda okutulan kart.
router.post('/kart', kopruLimiter, requireKopruAnahtari, (req, res) => {
  const uid = normalizeKartUid(req.body?.uid);
  if (!uid) return res.status(400).json({ hata: 'Kart UID biçimi geçersiz.' });
  const kopru = kopruGuncelle(req.body || {}, true);
  durum.sira += 1;
  durum.sonKart = { sira: durum.sira, uid, kopru, zaman: Date.now() };
  return res.json({ ok: true, sira: durum.sira });
});

// Panel: köprü durumu ve `sonra` sırasından yeni bir okuma varsa o kart.
router.get('/durum', authenticateToken, requireAdmin, (req, res) => {
  const simdi = Date.now();
  const sonra = Number.parseInt(req.query.sonra, 10);
  const kopruler = [...durum.kopruler.values()]
    .filter((k) => simdi - k.sonGorulme < KOPRU_ZAMAN_ASIMI_MS);
  const kart = durum.sonKart
    && Number.isInteger(sonra) && durum.sonKart.sira > sonra
    && simdi - durum.sonKart.zaman < KART_GECERLILIK_MS
    ? durum.sonKart
    : null;
  return res.json({
    yapilandirildi: Boolean(process.env.ISTASYON_ANAHTARI),
    kopruler,
    kart,
    sira: durum.sira
  });
});

function sunucuAdresi(req) {
  const acik = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  return acik || `${req.protocol}://${req.get('host')}`;
}

// Panel: sunucu adresi ve istasyon anahtarı gömülü, çift tıklanınca köprüyü kuran .cmd.
router.get('/kurulum', authenticateToken, requireAdmin, async (req, res) => {
  const anahtar = String(process.env.ISTASYON_ANAHTARI || '');
  if (anahtar.length < 16) {
    return res.status(409).json({ hata: 'Sunucuda ISTASYON_ANAHTARI tanımlı değil; köprü kurulamaz.' });
  }
  const sunucu = sunucuAdresi(req);
  const dosya = kurulumDosyasiOlustur({ sunucu, anahtar });
  if (!dosya) {
    return res.status(500).json({ hata: 'Köprü betikleri sunucuda bulunamadı (kart-kayit-istasyonu/kopru).' });
  }

  try {
    await writeAudit({
      actorId: req.user.kullaniciId,
      action: 'olustur',
      tableName: 'istasyon_kopru_kurulum',
      after: { indirildi: true, sunucu }
    });
  } catch (error) {
    console.error('[ISTASYON] Kurulum indirme denetim kaydı yazılamadı:', error.message);
  }

  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="SecureLab-Istasyon-Koprusu-Kur.cmd"');
  res.set('Cache-Control', 'no-store');
  return res.send(dosya);
});

module.exports = router;
