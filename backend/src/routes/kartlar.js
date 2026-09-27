const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const cardApprovalService = require('../services/cardApprovalService');
const { normalizeKartUid } = require('../utils/kartUid');
const {
    authenticateToken,
    requireAdmin,
    requireAdminOrHoca
} = require('../middlewares/authMiddleware');

// GET /api/kartlar - Tüm kartları listele (durum parametresine göre isteğe bağlı filtreleme)
router.get('/', authenticateToken, requireAdminOrHoca, async (req, res) => {
    try {
        const { durum } = req.query;
        const whereClause = durum ? { durum } : {};

        const kartlar = await prisma.kart.findMany({
            where: whereClause
        });
        
        res.json(kartlar);
    } catch (error) {
        console.error("Kartlar listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// GET /api/kartlar/onay-bekleyenler - Henüz bir kullanıcıya atanmamış kartları getir
router.get('/onay-bekleyenler', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const pendingCards = await cardApprovalService.getPendingCards();
        res.json({ success: true, data: pendingCards });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/kartlar/onayla - Yetkilendirme panelinden kartı kullanıcıya ata
router.post('/onayla', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { kartUid, userId, kaynak } = req.body;

        if (!kartUid || !userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'kartUid ve userId alanları zorunludur.' 
            });
        }

        const notlar = kaynak === 'istasyon'
            ? 'Kart Kayıt İstasyonu üzerinden tanımlandı'
            : null;
        const result = await cardApprovalService.approveCard(kartUid, userId, req.user.kullaniciId, notlar);
        
        if (result.success) {
            return res.json(result);
        } else {
            return res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/kartlar/:id - ID'ye göre tek bir kart getir
router.get('/son-okutulan', authenticateToken, requireAdminOrHoca, async (req, res) => {
    try {
        const latest = await prisma.erisimKaydi.findFirst({
            where: { okunanUid: { not: null } },
            // ESP32 saati yanlış veya geride olsa bile gerçekten en son
            // sunucuya ulaşan kartı göster.
            orderBy: [
                { kayitTamani: 'desc' },
                { kayitId: 'desc' }
            ],
            select: {
                okunanUid: true,
                olayTamani: true,
                kayitTamani: true,
                sonuc: true
            }
        });
        if (!latest) return res.status(404).json({ hata: 'Henüz okutulmuş kart bulunamadı.' });
        return res.json(latest);
    } catch (error) {
        return res.status(500).json({ hata: 'Son kart bilgisi alınamadı.' });
    }
});

// POST /api/kartlar/reddet - Bekleyen kart yetkilendirme isteğini reddet
router.post('/reddet', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { kartUid } = req.body;
        if (!kartUid) {
            return res.status(400).json({
                success: false,
                error: 'kartUid alanı zorunludur.'
            });
        }

        const result = await cardApprovalService.rejectCard(kartUid, req.user.kullaniciId);
        return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Kart isteği reddedilemedi.'
        });
    }
});

// GET /api/kartlar/sorgula/:uid - Kart Kayıt İstasyonu: UID sistemde kayıtlı mı?
router.get('/sorgula/:uid', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const kartUid = normalizeKartUid(req.params.uid);
        if (!kartUid) {
            return res.status(400).json({ hata: 'Kart UID biçimi geçersiz. Örnek: 04:A1:B2:C3' });
        }
        const [kart, yetki] = await Promise.all([
            prisma.kart.findUnique({ where: { kartUid } }),
            prisma.kartYetkilendirme.findUnique({
                where: { kartUid },
                include: {
                    kullanici: { select: { kullaniciId: true, ad: true, soyad: true, eposta: true, durum: true } }
                }
            })
        ]);
        return res.json({
            kartUid,
            kayitli: Boolean(kart),
            kartDurum: kart?.durum || null,
            yetki: yetki ? {
                kartYetkiId: yetki.kartYetkiId,
                durum: yetki.durum,
                yetkilendirilmeTarihi: yetki.yetkilendirilmeTarihi,
                kullanici: yetki.kullanici
            } : null
        });
    } catch (error) {
        console.error('Kart sorgulanırken hata:', error);
        return res.status(500).json({ hata: 'Kart bilgisi alınamadı.' });
    }
});

router.get('/:id', authenticateToken, requireAdminOrHoca, async (req, res) => {
    try {
        const { id } = req.params;
        const kart = await prisma.kart.findUnique({
            where: { kartId: parseInt(id) }
        });
        
        if (!kart) return res.status(404).json({ hata: "Kart bulunamadı" });
        res.json(kart);
    } catch (error) {
        console.error("Kart getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yeni kart tanımla
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { kartUid, durum, verilicTarihi } = req.body;

        if (!kartUid) {
            return res.status(400).json({ hata: "'kartUid' alanı zorunludur" });
        }

        const yeniKart = await prisma.kart.create({
            data: {
                kartUid,
                ...(durum ? { durum } : {}),
                ...(verilicTarihi ? { verilicTarihi: new Date(verilicTarihi) } : {})
            }
        });

        res.status(201).json(yeniKart);
    } catch (error) {
        console.error("Kart oluşturulurken hata:", error);
        if (error.code === 'P2002') {
            return res.status(409).json({ hata: "Bu kartUid ile kayıtlı bir kart zaten var" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Kart durumunu / bilgilerini güncelle (örn. durum: kayip/iptal/hasarli)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { durum, iptalTarihi, iptalNedeni } = req.body;

        const guncellenmisKart = await prisma.kart.update({
            where: { kartId: parseInt(id) },
            data: {
                ...(durum !== undefined ? { durum } : {}),
                ...(iptalTarihi !== undefined ? { iptalTarihi: iptalTarihi ? new Date(iptalTarihi) : null } : {}),
                ...(iptalNedeni !== undefined ? { iptalNedeni } : {})
            }
        });

        res.json(guncellenmisKart);
    } catch (error) {
        console.error("Kart güncellenirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Kart bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Kartı sil
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.kart.delete({
            where: { kartId: parseInt(id) }
        });

        res.status(200).json({ mesaj: "Kart silindi" });
    } catch (error) {
        console.error("Kart silinirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Kart bulunamadı" });
        }
        if (error.code === 'P2003') {
            return res.status(409).json({ hata: "Bu karta bağlı kayıtlar (yetkilendirme, erişim kaydı vb.) olduğu için silinemedi. Bunun yerine durumu 'iptal' yapmayı deneyin." });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
