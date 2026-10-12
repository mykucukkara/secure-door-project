const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdmin);
// Tüm cihaz durumlarını veritabanından getir.
// ?son=1 -> her cihazın yalnızca en son durumu (cihaz 30 sn'de bir kayıt yazdığı için
// tüm geçmiş çok büyür; pano bunu kullanır).
router.get('/', async (req, res) => {
    try {
        if (req.query.son === '1') {
            const sonDurumlar = await prisma.$queryRaw`
                SELECT DISTINCT ON ("cihazId") *
                FROM cihaz_durumu
                ORDER BY "cihazId", "guncellenmeTarihi" DESC`;
            return res.json(sonDurumlar);
        }
        const cihazDurumlari = await prisma.cihazDurumu.findMany();
        res.json(cihazDurumlari);
    } catch (error) {
        console.error("Cihaz durumları listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// ID'ye göre tek bir cihaz durumu getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cihazDurumu = await prisma.cihazDurumu.findUnique({
            where: { cihazDurumuId: parseInt(id) }
        });
        
        if (!cihazDurumu) return res.status(404).json({ hata: "Cihaz durumu bulunamadı" });
        res.json(cihazDurumu);
    } catch (error) {
        console.error("Cihaz durumu getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;