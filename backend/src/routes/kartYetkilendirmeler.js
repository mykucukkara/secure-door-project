const express = require('express');
const prisma = require('../config/prisma');
const cardApprovalService = require('../services/cardApprovalService');
const { writeAudit } = require('../services/auditService');
const {
  authenticateToken,
  requireAdmin,
  requireAdminOrHoca
} = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticateToken);

const permissionInclude = {
  kullanici: {
    select: {
      kullaniciId: true,
      ad: true,
      soyad: true,
      eposta: true,
      birimId: true,
      durum: true,
      rol: true
    }
  },
  birim: true
};

router.get('/', requireAdmin, async (req, res) => {
  try {
    const permissions = await prisma.kartYetkilendirme.findMany({
      include: permissionInclude,
      orderBy: { yetkilendirilmeTarihi: 'desc' }
    });
    return res.json(permissions);
  } catch (error) {
    console.error('Yetkiler listelenirken hata:', error);
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const permission = await prisma.kartYetkilendirme.findUnique({
      where: { kartYetkiId: BigInt(req.params.id) },
      include: permissionInclude
    });
    if (!permission) return res.status(404).json({ hata: 'Yetki bulunamadı' });
    return res.json(permission);
  } catch (error) {
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { kartUid, kullaniciId } = req.body;
    if (!kartUid || kullaniciId == null) {
      return res.status(400).json({ hata: "'kartUid' ve 'kullaniciId' alanları zorunludur" });
    }

    // Eski arayüz sürümleri bu endpoint'i çağırıyor. Aynı atomik onay
    // servisini kullanarak kartın "onay_bekliyor" durumunda kalmasını önle.
    const result = await cardApprovalService.approveCard(
      kartUid,
      kullaniciId,
      req.user.kullaniciId
    );
    if (!result.success) {
      return res.status(400).json({ hata: result.message, error: result.error });
    }

    const permission = await prisma.kartYetkilendirme.findUnique({
      where: { kartUid: result.kartUid },
      include: permissionInclude
    });
    return res.status(201).json(permission);
  } catch (error) {
    console.error('Yetki oluşturulurken hata:', error);
    if (error.code === 'P2003') return res.status(400).json({ hata: 'Kart, kullanıcı veya birim bilgisi geçersiz' });
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { durum, notlar, sonKullanilmaTarihi } = req.body || {};
    if (!/^\d{1,18}$/.test(String(req.params.id))) return res.status(400).json({ hata: 'Geçersiz yetki kaydı.' });
    if (durum !== undefined && !['aktif', 'pasif', 'iptal'].includes(durum)) {
      return res.status(400).json({ hata: 'Geçersiz durum.' });
    }
    if (notlar !== undefined && notlar !== null && String(notlar).length > 500) {
      return res.status(400).json({ hata: 'Not en fazla 500 karakter olabilir.' });
    }
    const before = await prisma.kartYetkilendirme.findUnique({ where: { kartYetkiId: BigInt(req.params.id) } });
    if (!before) return res.status(404).json({ hata: 'Yetki bulunamadı' });
    const permission = await prisma.kartYetkilendirme.update({
      where: { kartYetkiId: BigInt(req.params.id) },
      data: {
        ...(durum !== undefined ? { durum } : {}),
        ...(notlar !== undefined ? { notlar } : {}),
        ...(sonKullanilmaTarihi !== undefined
          ? { sonKullanilmaTarihi: sonKullanilmaTarihi ? new Date(sonKullanilmaTarihi) : null }
          : {})
      },
      include: permissionInclude
    });
    await writeAudit({
      actorId: req.user.kullaniciId,
      action: 'guncelle',
      tableName: 'kart_yetkilendirme',
      recordId: permission.kartYetkiId,
      before: { durum: before.durum },
      after: { durum: permission.durum }
    });
    return res.json(permission);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ hata: 'Yetki bulunamadı' });
    return res.status(500).json({ hata: 'Sunucu hatası' });
  }
});

module.exports = router;
