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

// Tüm ihlalleri veritabanından getir
router.get('/', async (req, res) => {
    try {
        const ihlaller = await prisma.ihlalKaydi.findMany({
            include: {
                kullanici: { select: safeUserSelect }
            }
        });
        res.json(ihlaller);
    } catch (error) {
        console.error("İhlaller listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// ID'ye göre tek bir ihlal getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const ihlal = await prisma.ihlalKaydi.findUnique({
            where: { ihlalId: parseInt(id) },
            include: {
                kullanici: { select: safeUserSelect }
            }
        });
        
        if (!ihlal) return res.status(404).json({ hata: "İhlal bulunamadı" });
        res.json(ihlal);
    } catch (error) {
        console.error("İhlal getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Manuel ihlal kaydı oluştur (otomatik cron tespiti dışında, admin elle de açabilsin diye)
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { kullaniciId, tarih, tur, aciklama } = req.body;

        if (kullaniciId == null || !tur) {
            return res.status(400).json({ hata: "'kullaniciId' ve 'tur' alanları zorunludur" });
        }

        const yeniIhlal = await prisma.ihlalKaydi.create({
            data: {
                kullaniciId: parseInt(kullaniciId),
                tarih: tarih ? new Date(tarih) : new Date(),
                tur,
                aciklama: aciklama ?? null
            },
            include: { kullanici: { select: safeUserSelect } }
        });

        res.status(201).json(yeniIhlal);
    } catch (error) {
        console.error("İhlal oluşturulurken hata:", error);
        if (error.code === 'P2003') {
            return res.status(400).json({ hata: "Belirtilen kullaniciId geçerli değil" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
