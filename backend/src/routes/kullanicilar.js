const express = require('express');
const prisma = require('../config/prisma');
const {
  refreshSingleUserPin,
  setUserPin,
  getCurrentPin
} = require('../services/pinService');
const { listPinHistory } = require('../services/pinHistoryService');
const { writeAudit } = require('../services/auditService');
const {
  createInvitedUser,
  issueTemporaryPassword,
  deliverTemporaryPassword,
  activeAdminCount,
  isAllowedEmailDomain,
  isValidEmail,
  allowedEmailDomains
} = require('../services/hesapService');
const { getAkademikKadro } = require('../services/akademikKadroService');
const {
  authenticateToken,
  requireAdmin,
  requireSelfOrAdmin
} = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticateToken);

const safeUserSelect = {
  kullaniciId: true,
  ad: true,
  soyad: true,
  unvan: true,
  eposta: true,
  birimId: true,
  durum: true,
  rol: true,
  sifreDegistirmeZorunlu: true,
  sifreGecerlilikBitis: true,
  sonGiris: true,
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
  unvan: user.unvan,
  eposta: user.eposta,
  birimId: user.birimId,
  durum: user.durum,
  rol: user.rol
}) : null;

function parseId(value) {
  const text = String(value || '');
  if (!/^\d{1,18}$/.test(text)) return null;
  return BigInt(text);
}

router.get('/ozet', requireAdmin, async (req, res) => {
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

// Bölüm sitesinde görünen ama SecureLab'de hesabı olmayan öğretim elemanları.
router.get('/aday-hocalar', requireAdmin, async (req, res) => {
  try {
    const kaynak = await getAkademikKadro({ yenile: req.query.yenile === '1' });
    const mevcut = await prisma.kullanici.findMany({
      where: { eposta: { not: null } },
      select: { eposta: true, durum: true }
    });
    const mevcutEpostalar = new Map(mevcut.map((u) => [String(u.eposta).toLowerCase(), u.durum]));
    const adaylar = [];
    let kayitliSayisi = 0;
    kaynak.kadro.forEach((kisi) => {
      if (mevcutEpostalar.has(kisi.eposta.toLowerCase())) {
        kayitliSayisi += 1;
        return;
      }
      adaylar.push(kisi);
    });
    return res.json({
      kaynak: kaynak.kaynak,
      kaynakUrl: kaynak.url,
      zaman: kaynak.zaman,
      uyari: kaynak.uyari || null,
      toplamKadro: kaynak.kadro.length,
      kayitliSayisi,
      izinliAlanlar: allowedEmailDomains(),
      adaylar
    });
  } catch (error) {
    console.error('Aday öğretim elemanları alınamadı:', error);
    return res.status(500).json({ hata: 'Bölüm kadrosu alınamadı.' });
  }
});

// Yeni hesap: sunucu geçici şifre üretir, kullanıcının e-postasına gönderir.
// Kullanıcı ilk girişte kendi şifresini belirlemek zorundadır.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { ad, soyad, unvan, eposta, birimId, rol } = req.body || {};
    if (rol && !['hoca', 'idari_personel', 'yetkili_ogrenci'].includes(rol)) {
      return res.status(400).json({ hata: 'Yeni hesaplar öğretim elemanı, idari personel veya yetkili öğrenci rolüyle açılır; yönetici yetkisi daha sonra düzenleme ekranından verilir.' });
    }
    const { user, temporaryPassword, expiresAt } = await createInvitedUser({
      ad, soyad, unvan, eposta, birimId, rol, actorId: req.user.kullaniciId
    });
    const teslim = await deliverTemporaryPassword({ user, temporaryPassword, expiresAt });
    const kullanici = await prisma.kullanici.findUnique({
      where: { kullaniciId: user.kullaniciId },
      select: safeUserSelect
    });
    return res.status(201).json({
      mesaj: teslim.mailGonderildi
        ? `Hesap oluşturuldu. Geçici şifre ${teslim.eposta} adresine gönderildi.`
        : 'Hesap oluşturuldu ancak e-posta gönderilemedi.',
      kullanici,
      ...teslim
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ hata: error.message });
    if (error.code === 'P2003') return res.status(400).json({ hata: 'Geçersiz birim.' });
    console.error('Kullanıcı oluşturulurken hata:', error);
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

// Kullanıcıya yeni geçici şifre ver (şifresini unutan / e-postası ulaşmayan kullanıcı).
router.post('/:id/gecici-sifre', requireAdmin, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ hata: 'Geçersiz kullanıcı.' });
    if (String(id) === String(req.user.kullaniciId)) {
      return res.status(400).json({ hata: 'Kendi şifrenizi Profilim sayfasından değiştirin.' });
    }
    const { user, temporaryPassword, expiresAt } = await issueTemporaryPassword(id, req.user.kullaniciId);
    const teslim = await deliverTemporaryPassword({ user, temporaryPassword, expiresAt, yenileme: true });
    return res.json({
      mesaj: teslim.mailGonderildi
        ? `Yeni geçici şifre ${teslim.eposta} adresine gönderildi.`
        : 'Yeni geçici şifre oluşturuldu ancak e-posta gönderilemedi.',
      ...teslim
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ hata: error.message });
    console.error('Geçici şifre verilirken hata:', error);
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ hata: 'Geçersiz kullanıcı.' });
    const { ad, soyad, unvan, eposta, birimId, durum, rol } = req.body || {};
    const normalizedEmail = eposta === undefined
      ? undefined
      : (eposta ? String(eposta).trim().toLowerCase() : null);

    if (durum !== undefined && !['aktif', 'pasif', 'askida'].includes(durum)) {
      return res.status(400).json({ hata: 'Geçersiz durum.' });
    }
    if (rol !== undefined && !['hoca', 'idari_personel', 'yetkili_ogrenci', 'admin'].includes(rol)) {
      return res.status(400).json({ hata: 'Geçersiz rol.' });
    }
    if (ad !== undefined && !String(ad).trim()) return res.status(400).json({ hata: 'Ad boş olamaz.' });
    if (soyad !== undefined && !String(soyad).trim()) return res.status(400).json({ hata: 'Soyad boş olamaz.' });

    const targetUser = await prisma.kullanici.findUnique({ where: { kullaniciId: id } });
    if (!targetUser) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });

    if (normalizedEmail && normalizedEmail !== String(targetUser.eposta || '').toLowerCase()) {
      if (!isValidEmail(normalizedEmail)) return res.status(400).json({ hata: 'Geçerli bir e-posta adresi girin.' });
      if (!isAllowedEmailDomain(normalizedEmail)) {
        return res.status(400).json({ hata: 'Yalnızca kurumsal e-posta adresleri kullanılabilir.' });
      }
      const existing = await prisma.kullanici.findFirst({
        where: {
          eposta: { equals: normalizedEmail, mode: 'insensitive' },
          NOT: { kullaniciId: id }
        }
      });
      if (existing) return res.status(409).json({ hata: 'Bu e-posta adresi zaten kullanılıyor.' });
    }

    const isSelf = String(id) === String(req.user.kullaniciId);
    const rolDegisiyor = rol !== undefined && rol !== targetUser.rol;
    const durumDegisiyor = durum !== undefined && durum !== targetUser.durum;
    if (isSelf && (rolDegisiyor || (durumDegisiyor && durum !== 'aktif'))) {
      return res.status(409).json({ hata: 'Kendi yönetici yetkinizi kaldıramaz veya hesabınızı pasife alamazsınız.' });
    }
    const adminligiBitiyor = targetUser.rol === 'admin' && targetUser.durum === 'aktif'
      && ((rolDegisiyor && rol !== 'admin') || (durumDegisiyor && durum !== 'aktif'));
    if (adminligiBitiyor && await activeAdminCount(prisma, id) < 1) {
      return res.status(409).json({ hata: 'Sistemde en az bir aktif yönetici hesabı kalmalıdır.' });
    }

    const user = await prisma.$transaction(async (transaction) => {
      const updatedUser = await transaction.kullanici.update({
        where: { kullaniciId: id },
        data: {
          ...(ad !== undefined ? { ad: String(ad).trim().slice(0, 64) } : {}),
          ...(soyad !== undefined ? { soyad: String(soyad).trim().slice(0, 64) } : {}),
          ...(unvan !== undefined ? { unvan: String(unvan || '').trim().slice(0, 48) || null } : {}),
          ...(normalizedEmail !== undefined ? { eposta: normalizedEmail } : {}),
          ...(birimId !== undefined ? { birimId: birimId != null && birimId !== '' ? Number.parseInt(birimId, 10) : null } : {}),
          ...(durum !== undefined ? { durum } : {}),
          ...(rol !== undefined ? { rol } : {}),
          // Yetki ya da durum değişince açık oturumlar yeniden giriş gerektirsin.
          ...(rolDegisiyor || durumDegisiyor ? { oturumSurumu: { increment: 1 } } : {})
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
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ hata: 'Geçersiz kullanıcı.' });
  try {
    targetUser = await prisma.kullanici.findUnique({ where: { kullaniciId: id } });
    if (!targetUser) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    if (String(id) === String(req.user.kullaniciId)) {
      return res.status(409).json({ hata: 'Kendi hesabınızı silemezsiniz.' });
    }
    if (targetUser.rol === 'admin' && targetUser.durum === 'aktif' && await activeAdminCount(prisma, id) < 1) {
      return res.status(409).json({ hata: 'Sistemdeki son aktif yönetici hesabı silinemez.' });
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
      await transaction.kullanici.delete({ where: { kullaniciId: id } });
    });
    return res.json({ mesaj: 'Kullanıcı silindi' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
    if (error.code === 'P2003') {
      // Erişim kaydı, kart yetkisi vb. geçmiş kayıtları olan kullanıcı silinmez;
      // hesabı pasife alınır, kartları devre dışı bırakılır.
      const user = await prisma.$transaction(async (transaction) => {
        const updatedUser = await transaction.kullanici.update({
          where: { kullaniciId: id },
          data: { durum: 'pasif', oturumSurumu: { increment: 1 } },
          select: safeUserSelect
        });
        await transaction.kartYetkilendirme.updateMany({
          where: { kullaniciId: id, durum: 'aktif' },
          data: { durum: 'pasif' }
        });
        await writeAudit({
          client: transaction,
          actorId: req.user.kullaniciId,
          action: 'guncelle',
          tableName: 'kullanici',
          recordId: updatedUser.kullaniciId,
          before: { durum: targetUser.durum },
          after: { durum: 'pasif', sebep: 'bagli_kayitlar_korundu', kartYetkileri: 'pasife_alindi' }
        });
        return updatedUser;
      });
      return res.json({
        mesaj: 'Geçmiş kayıtları korumak için kullanıcı hesabı pasif duruma getirildi ve kart yetkileri kapatıldı.',
        pasifeAlindi: true,
        kullanici: user
      });
    }
    console.error('Kullanıcı silinirken hata:', error);
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
      after: {
        pin: rastgele ? 'rastgele_guncellendi' : (isSelf ? 'kullanici_belirledi' : 'yonetici_belirledi'),
        degistiren: isSelf ? 'kendisi' : 'yonetici'
      }
    });
    return res.json({
      mesaj: isSelf
        ? 'Kapı şifreniz güncellendi. Yeni şifre hemen geçerlidir ve süresi dolmaz.'
        : 'Kullanıcının kapı şifresi güncellendi. Eski şifre artık geçersizdir; yeni şifreyi kullanıcıya iletin.',
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
