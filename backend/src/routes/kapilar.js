const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const remoteDoorService = require('../services/remoteDoorService');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdmin);
// Tüm kapıları veritabanından getir
router.get('/', async (req, res) => {
    try {
        const kapilar = await prisma.kapi.findMany();
        res.json(kapilar);
    } catch (error) {
        console.error("Kapılar listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// POST /api/kapilar/:id/ac - Uzaktan Kapı Açma Endpoint'i
router.post('/:id/ac', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const result = await remoteDoorService.triggerRemoteDoorOpen(id, req.user.kullaniciId, reason);

        if (result.success) {
            return res.json(result);
        } else {
            return res.status(400).json(result);
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ID'ye göre tek bir kapı getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const kapi = await prisma.kapi.findUnique({
            where: { kapiId: parseInt(id) }
        });
        
        if (!kapi) return res.status(404).json({ hata: "Kapı bulunamadı" });
        res.json(kapi);
    } catch (error) {
        console.error("Kapı getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yeni kapı ekle
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { ad, bina, kat, aciklama, durum } = req.body;

        if (!ad) {
            return res.status(400).json({ hata: "'ad' alanı zorunludur" });
        }

        const yeniKapi = await prisma.kapi.create({
            data: {
                ad,
                bina: bina ?? null,
                kat: kat != null ? parseInt(kat) : null,
                aciklama: aciklama ?? null,
                ...(durum ? { durum } : {})
            }
        });

        res.status(201).json(yeniKapi);
    } catch (error) {
        console.error("Kapı oluşturulurken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Kapı bilgilerini güncelle
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { ad, bina, kat, aciklama, durum } = req.body;

        const guncellenmisKapi = await prisma.kapi.update({
            where: { kapiId: parseInt(id) },
            data: {
                ...(ad !== undefined ? { ad } : {}),
                ...(bina !== undefined ? { bina } : {}),
                ...(kat !== undefined ? { kat: kat != null ? parseInt(kat) : null } : {}),
                ...(aciklama !== undefined ? { aciklama } : {}),
                ...(durum !== undefined ? { durum } : {})
            }
        });

        res.json(guncellenmisKapi);
    } catch (error) {
        console.error("Kapı güncellenirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Kapı bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Kapıyı sil
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.kapi.delete({
            where: { kapiId: parseInt(id) }
        });

        res.status(200).json({ mesaj: "Kapı silindi" });
    } catch (error) {
        console.error("Kapı silinirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Kapı bulunamadı" });
        }
        if (error.code === 'P2003') {
            return res.status(409).json({ hata: "Bu kapıya bağlı kayıtlar (cihaz ataması, erişim kaydı vb.) olduğu için silinemedi. Bunun yerine durumu 'devredisi' yapmayı deneyin." });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
