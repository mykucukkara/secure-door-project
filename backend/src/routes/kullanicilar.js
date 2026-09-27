const express = require('express');
const argon2 = require('argon2');
const prisma = require('../config/prisma');
const {
  refreshSingleUserPin,
  generateUniquePin,
  validateCustomPin,
  isPinInUse,
  setUserPin,
  getCurrentPin
} = require('../services/pinService');
const { recordPinHistory, listPinHistory } = require('../services/pinHistoryService');
const { writeAudit } = require('../services/auditService');
const {
  validateWebPassword,
  generateTemporaryWebPassword
} = require('../services/webPasswordService');
const {
  authenticateToken,
  requireAdmin,
  requireAdminOrHoca,
  requireSelfOrAdmin
} = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticateToken);

const safeUserSelect = {
  kullaniciId: true,
  ad: true,
  soyad: true,
  eposta: true,
  birimId: true,
  durum: true,
  rol: true,
  pinSonDegisim: true,
  pinGecerlilikBitis: true,
  olusturmaTamani: true,
  guncellemeTamani: true,
  birim: true
};

const auditUserSnapshot = (user) => user ? ({
  kullaniciId: user.kullaniciId?.toString(),
  ad: user.ad,
  soyad: user.soyad,
  eposta: user.eposta,
  birimId: user.birimId,
  durum: user.durum,
  rol: user.rol
}) : null;

router.get('/ozet', requireAdminOrHoca, async (req, res) => {
  try {
    const [toplam, aktif] = await Promise.all([
      prisma.kullanici.count(),
      prisma.kullanici.count({ where: { durum: 'aktif' } })
    ]);
    return res.json({ toplam, aktif });
  } catch (error) {
    return res.status(500).json({ hata: 'Kullanıcı özeti alınamadı.' });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const { durum, rol } = req.query;
    const where = {
      ...(durum ? { durum } : {}),
      ...(rol ? { rol } : {})
    };
    const users = await prisma.kullanici.findMany({
      where,
      select: safeUserSelect,
      orderBy: [{ ad: 'asc' }, { soyad: 'asc' }]
    });
    return res.json(users);
  } catch (error) {
    console.error('Kullanıcılar listelenirken hata:', error);
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { ad, soyad, eposta, birimId, durum, rol, pin, webPassword } = req.body;
    if (!String(ad || '').trim() || !String(soyad || '').trim()) {
      return res.status(400).json({ hata: "'ad' ve 'soyad' alanları zorunludur" });
    }

    const normalizedEmail = eposta ? String(eposta).trim().toLowerCase() : null;
    if (normalizedEmail) {
      const existing = await prisma.kullanici.findFirst({
        where: { eposta: { equals: normalizedEmail, mode: 'insensitive' } }
      });
      if (existing) return res.status(409).json({ hata: 'Bu e-posta adresi zaten kullanılıyor.' });
    }

    if (rol && rol !== 'hoca') {
      return res.status(400).json({ hata: 'Yeni kullanıcılar standart kullanıcı rolüyle oluşturulur.' });
    }

    let initialPin;
    if (pin) {
      initialPin = String(pin).trim();
      const pinValidation = validateCustomPin(initialPin);
      if (!pinValidation.valid) return res.status(400).json({ hata: pinValidation.message });
      if (await isPinInUse(initialPin)) {
        return res.status(409).json({ hata: 'Bu kapı şifresi başka bir kullanıcıda tanımlı. Farklı bir şifre seçin.' });
      }
    } else {
      initialPin = await generateUniquePin();
    }

    const initialPassword = String(webPassword || generateTemporaryWebPassword());
    const passwordValidation = validateWebPassword(initialPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ hata: passwordValidation.message });
    }

    // Kapı şifresi kalıcıdır; süresi dolmaz.
    const pinExpiresAt = null;
    const passwordHash = await argon2.hash(initialPassword);
    const pinHash = await argon2.hash(initialPin);
    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.kullanici.create({
        data: {
          ad: String(ad).trim(),
          soyad: String(soyad).trim(),
          eposta: normalizedEmail,
          birimId: birimId != null ? Number.parseInt(birimId, 10) : null,
          sifreHash: passwordHash,
          pinHash,
          pinSonDegisim: new Date(),
          pinGecerlilikBitis: pinExpiresAt,
          durum: durum || 'aktif',
          rol: 'hoca'
        },
        select: safeUserSelect
      });
      await recordPinHistory(transaction, {
        kullaniciId: createdUser.kullaniciId,
        pin: initialPin,
        pinHash,
        gecerlilikBitis: pinExpiresAt,
        kaynak: 'yonetici'
      });
      await writeAudit({
        client: transaction,
        actorId: req.user.kullaniciId,
        action: 'olustur',
        tableName: 'kullanici',
        recordId: createdUser.kullaniciId,
        after: auditUserSnapshot(createdUser)
      });
      return createdUser;
    });

    return res.status(201).json({ ...user, initialPin, initialPassword });
  } catch (error) {
    console.error('Kullanıcı oluşturulurken hata:', error);
    if (error.code === 'P2003') return res.status(400).json({ hata: 'Geçersiz birimId.' });
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { ad, soyad, eposta, birimId, durum, rol } = req.body;
    const normalizedEmail = eposta === undefined
      ? undefined
      : (eposta ? String(eposta).trim().toLowerCase() : null);

    if (normalizedEmail) {
      const existing = await prisma.kullanici.findFirst({
        where: {
          eposta: { equals: normalizedEmail, mode: 'insensitive' },
          NOT: { kullaniciId: BigInt(req.params.id) }
        }
      });
      if (existing) return res.status(409).json({ hata: 'Bu e-posta adresi zaten kullanılıyor.' });
    }

    const targetUser = await prisma.kullanici.findUnique({
      where: { kullaniciId: BigInt(req.params.id) }
    });
    if (!targetUser) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    if ((targetUser.rol === 'admin' && (rol && rol !== 'admin'))
      || (targetUser.rol !== 'admin' && rol === 'admin')) {
      return res.status(409).json({ hata: 'Sistemde yalnızca bir yönetici hesabı bulunabilir.' });
    }
    if (targetUser.rol === 'admin' && durum && durum !== 'aktif') {
      return res.status(409).json({ hata: 'Tek yönetici hesabı pasif duruma getirilemez.' });
    }

    const user = await prisma.$transaction(async (transaction) => {
      const updatedUser = await transaction.kullanici.update({
        where: { kullaniciId: BigInt(req.params.id) },
        data: {
          ...(ad !== undefined ? { ad: String(ad).trim() } : {}),
          ...(soyad !== undefined ? { soyad: String(soyad).trim() } : {}),
          ...(normalizedEmail !== undefined ? { eposta: normalizedEmail } : {}),
          ...(birimId !== undefined ? { birimId: birimId != null ? Number.parseInt(birimId, 10) : null } : {}),
          ...(durum !== undefined ? { durum } : {}),
          ...(rol !== undefined ? { rol } : {})
        },
        select: safeUserSelect
      });
      await writeAudit({
        client: transaction,
        actorId: req.user.kullaniciId,
        action: 'guncelle',
        tableName: 'kullanici',
        recordId: updatedUser.kullaniciId,
        before: auditUserSnapshot(targetUser),
        after: auditUserSnapshot(updatedUser)
      });
      return updatedUser;
    });
    return res.json(user);
  } catch (error) {
    console.error('Kullanıcı güncellenirken hata:', error);
    if (error.code === 'P2025') return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    if (error.code === 'P2003') return res.status(400).json({ hata: 'Geçersiz birimId.' });
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  let targetUser;
  try {
    targetUser = await prisma.kullanici.findUnique({
      where: { kullaniciId: BigInt(req.params.id) }
    });
    if (!targetUser) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    if (targetUser.rol === 'admin') {
      return res.status(409).json({ hata: 'Tek yönetici hesabı silinemez.' });
    }
    await prisma.$transaction(async (transaction) => {
      await writeAudit({
        client: transaction,
        actorId: req.user.kullaniciId,
        action: 'sil',
        tableName: 'kullanici',
        recordId: targetUser.kullaniciId,
        before: auditUserSnapshot(targetUser)
      });
      await transaction.kullanici.delete({ where: { kullaniciId: BigInt(req.params.id) } });
    });
    return res.json({ mesaj: 'Kullanıcı silindi' });
  } catch (error) {
    console.error('Kullanıcı silinirken hata:', error);
    if (error.code === 'P2025') return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    if (error.code === 'P2003') {
      const user = await prisma.$transaction(async (transaction) => {
        const updatedUser = await transaction.kullanici.update({
          where: { kullaniciId: BigInt(req.params.id) },
          data: { durum: 'pasif', oturumSurumu: { increment: 1 } },
          select: safeUserSelect
        });
        await writeAudit({
          client: transaction,
          actorId: req.user.kullaniciId,
          action: 'guncelle',
          tableName: 'kullanici',
          recordId: updatedUser.kullaniciId,
          before: { durum: targetUser.durum },
          after: { durum: 'pasif', sebep: 'bagli_kayitlar_korundu' }
        });
        return updatedUser;
      });
      return res.json({
        mesaj: 'Geçmiş kayıtları korumak için kullanıcı hesabı pasif duruma getirildi.',
        pasifeAlindi: true,
        kullanici: user
      });
    }
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

function sendPinError(res, error) {
  const status = error.statusCode || 400;
  return res.status(status).json({ hata: error.message || 'Kapı şifresi işlemi başarısız oldu.' });
}

// Rastgele yeni (kalıcı) kapı şifresi üretir. Admin herkes için, kullanıcı kendisi için.
router.post('/:id/sifre-yenile', requireSelfOrAdmin, async (req, res) => {
  try {
    const isSelf = String(req.user.kullaniciId) === String(req.params.id);
    const result = await refreshSingleUserPin(req.params.id, isSelf ? 'kullanici' : 'yonetici');
    await writeAudit({
      actorId: req.user.kullaniciId,
      action: 'guncelle',
      tableName: 'kapi_sifre_gecmisi',
      recordId: req.params.id,
      after: { pin: 'rastgele_yenilendi' }
    });
    return res.json({
      mesaj: 'Yeni kapı şifresi oluşturuldu ve aktif cihazlara bildirildi.',
      veri: result
    });
  } catch (error) {
    return sendPinError(res, error);
  }
});

// Güncel (kalıcı) kapı şifresini görüntüle — Profil sayfası.
router.get('/:id/kapi-sifresi', requireSelfOrAdmin, async (req, res) => {
  try {
    const result = await getCurrentPin(req.params.id);
    await writeAudit({
      actorId: req.user.kullaniciId,
      action: 'guncelle',
      tableName: 'kapi_sifre_gecmisi',
      recordId: req.params.id,
      after: { kapiSifresiGoruntulendi: true }
    });
    return res.json(result);
  } catch (error) {
    return sendPinError(res, error);
  }
});

// Kapı şifresini güncelle. Gövde: { pin: "6 haneli" } ya da { rastgele: true }
router.put('/:id/kapi-sifresi', requireSelfOrAdmin, async (req, res) => {
  try {
    const { pin, pinTekrar, rastgele } = req.body || {};
    const isSelf = String(req.user.kullaniciId) === String(req.params.id);
    if (!rastgele) {
      if (!pin) return res.status(400).json({ hata: 'Yeni kapı şifresini girin.' });
      if (pinTekrar !== undefined && String(pinTekrar) !== String(pin)) {
        return res.status(400).json({ hata: 'Girilen şifreler birbiriyle eşleşmiyor.' });
      }
    }
    const result = await setUserPin(req.params.id, {
      pin: rastgele ? undefined : pin,
      kaynak: isSelf ? 'kullanici' : 'yonetici'
    });
    await writeAudit({
      actorId: req.user.kullaniciId,
      action: 'guncelle',
      tableName: 'kapi_sifre_gecmisi',
      recordId: req.params.id,
      after: { pin: rastgele ? 'rastgele_guncellendi' : 'kullanici_belirledi' }
    });
    return res.json({
      mesaj: 'Kapı şifreniz güncellendi. Yeni şifre hemen geçerlidir ve süresi dolmaz.',
      veri: result
    });
  } catch (error) {
    return sendPinError(res, error);
  }
});

router.get('/:id/pin-gecmisi', requireSelfOrAdmin, async (req, res) => {
  try {
    const user = await prisma.kullanici.findUnique({
      where: { kullaniciId: BigInt(req.params.id) },
      select: { kullaniciId: true, ad: true, soyad: true, eposta: true }
    });
    if (!user) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    const history = await listPinHistory(user.kullaniciId, req.query.limit);
    await writeAudit({
      actorId: req.user.kullaniciId,
      action: 'guncelle',
      tableName: 'kapi_sifre_gecmisi',
      recordId: user.kullaniciId,
      after: { gecmisGoruntulendi: true, kayitSayisi: history.length }
    });
    return res.json({
      kullanici: {
        ...user,
        kullaniciId: user.kullaniciId.toString()
      },
      kayitlar: history
    });
  } catch (error) {
    console.error('Kapı şifresi geçmişi alınırken hata:', error);
    return res.status(500).json({ hata: 'Kapı şifresi geçmişi alınamadı.' });
  }
});

// Kullanıcıya tanımlı kartlar (Profil sayfası için)
router.get('/:id/kartlar', requireSelfOrAdmin, async (req, res) => {
  try {
    const cards = await prisma.kartYetkilendirme.findMany({
      where: { kullaniciId: BigInt(req.params.id) },
      select: {
        kartYetkiId: true,
        kartUid: true,
        durum: true,
        yetkilendirilmeTarihi: true,
        kart: { select: { durum: true } }
      },
      orderBy: { yetkilendirilmeTarihi: 'desc' }
    });
    return res.json(cards.map((card) => ({
      kartYetkiId: card.kartYetkiId.toString(),
      kartUid: card.kartUid,
      yetkiDurum: card.durum,
      kartDurum: card.kart?.durum || null,
      yetkilendirilmeTarihi: card.yetkilendirilmeTarihi
    })));
  } catch (error) {
    console.error('Kullanıcı kartları alınırken hata:', error);
    return res.status(500).json({ hata: 'Kart bilgileri alınamadı.' });
  }
});

router.get('/:id', requireSelfOrAdmin, async (req, res) => {
  try {
    const user = await prisma.kullanici.findUnique({
      where: { kullaniciId: BigInt(req.params.id) },
      select: safeUserSelect
    });
    if (!user) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

module.exports = router;
