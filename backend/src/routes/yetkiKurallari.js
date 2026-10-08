const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdmin);
const safeUserSelect = {
    kullaniciId: true,
    ad: true,
    soyad: true,
    eposta: true,
    rol: true,
    durum: true
};

function isValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}
// Not: Bu dosya daha önce hiç yoktu; YetkiKurali modeli (gün/saat bazlı
// erişim yetkisi) için hiçbir endpoint bulunmuyordu. Diğer route
// dosyalarıyla aynı üslup ve hata yönetimi deseniyle yazıldı.

// Tüm yetki kurallarını getir (isteğe bağlı grupId/kullaniciId/kapiId filtreleriyle)
router.get('/', async (req, res) => {
    try {
        const { grupId, kullaniciId, kapiId } = req.query;
        const whereClause = {};

        if (grupId) whereClause.grupId = parseInt(grupId);
        if (kullaniciId) whereClause.kullaniciId = parseInt(kullaniciId);
        if (kapiId) whereClause.kapiId = parseInt(kapiId);

        const kurallar = await prisma.yetkiKurali.findMany({
            where: whereClause,
            include: {
                grup: true,
                kullanici: { select: safeUserSelect },
                kapi: true
            }
        });

        res.json(kurallar);
    } catch (error) {
        console.error("Yetki kuralları listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// ID'ye göre tek bir yetki kuralı getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const kural = await prisma.yetkiKurali.findUnique({
            where: { yetkiKuraliId: parseInt(id) },
            include: {
                grup: true,
                kullanici: { select: safeUserSelect },
                kapi: true
            }
        });

        if (!kural) return res.status(404).json({ hata: "Yetki kuralı bulunamadı" });
        res.json(kural);
    } catch (error) {
        console.error("Yetki kuralı getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yeni yetki kuralı oluştur (bir gruba ya da doğrudan bir kullanıcıya tanımlanabilir)
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { grupId, kullaniciId, kapiId, gunMaskesi, saatBaslangic, saatBitis, aktif } = req.body;

        if (kapiId == null || gunMaskesi == null || !saatBaslangic || !saatBitis) {
            return res.status(400).json({ hata: "'kapiId', 'gunMaskesi', 'saatBaslangic' ve 'saatBitis' alanları zorunludur" });
        }
        if ((grupId == null) === (kullaniciId == null)) {
            return res.status(400).json({ hata: "Kural yalnızca bir 'grupId' veya bir 'kullaniciId'ye bağlanmalıdır" });
        }
        const normalizedMask = parseInt(gunMaskesi);
        if (!Number.isInteger(normalizedMask) || normalizedMask < 1 || normalizedMask > 127) {
            return res.status(400).json({ hata: "'gunMaskesi' 1 ile 127 arasında olmalıdır" });
        }
        if (!isValidTime(saatBaslangic) || !isValidTime(saatBitis)) {
            return res.status(400).json({ hata: "Saatler SS:DD biçiminde olmalıdır" });
        }

        const yeniKural = await prisma.yetkiKurali.create({
            data: {
                grupId: grupId != null ? parseInt(grupId) : null,
                kullaniciId: kullaniciId != null ? parseInt(kullaniciId) : null,
                kapiId: parseInt(kapiId),
                gunMaskesi: normalizedMask,
                saatBaslangic,
                saatBitis,
                ...(aktif !== undefined ? { aktif: !!aktif } : {})
            },
            include: { grup: true, kullanici: { select: safeUserSelect }, kapi: true }
        });

        res.status(201).json(yeniKural);
    } catch (error) {
        console.error("Yetki kuralı oluşturulurken hata:", error);
        if (error.code === 'P2003') {
            return res.status(400).json({ hata: "Belirtilen grupId, kullaniciId veya kapiId geçerli değil" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yetki kuralını güncelle
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { gunMaskesi, saatBaslangic, saatBitis, aktif } = req.body;
        const normalizedMask = gunMaskesi !== undefined ? parseInt(gunMaskesi) : undefined;
        if (normalizedMask !== undefined && (!Number.isInteger(normalizedMask) || normalizedMask < 1 || normalizedMask > 127)) {
            return res.status(400).json({ hata: "'gunMaskesi' 1 ile 127 arasında olmalıdır" });
        }
        if ((saatBaslangic !== undefined && !isValidTime(saatBaslangic))
            || (saatBitis !== undefined && !isValidTime(saatBitis))) {
            return res.status(400).json({ hata: "Saatler SS:DD biçiminde olmalıdır" });
        }

        const guncellenmisKural = await prisma.yetkiKurali.update({
            where: { yetkiKuraliId: parseInt(id) },
            data: {
                ...(normalizedMask !== undefined ? { gunMaskesi: normalizedMask } : {}),
                ...(saatBaslangic !== undefined ? { saatBaslangic } : {}),
                ...(saatBitis !== undefined ? { saatBitis } : {}),
                ...(aktif !== undefined ? { aktif: !!aktif } : {})
            },
            include: { grup: true, kullanici: { select: safeUserSelect }, kapi: true }
        });

        res.json(guncellenmisKural);
    } catch (error) {
        console.error("Yetki kuralı güncellenirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Yetki kuralı bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yetki kuralını sil
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.yetkiKurali.delete({
            where: { yetkiKuraliId: parseInt(id) }
        });

        res.status(200).json({ mesaj: "Yetki kuralı silindi" });
    } catch (error) {
        console.error("Yetki kuralı silinirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Yetki kuralı bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
