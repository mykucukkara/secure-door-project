const express = require('express');

const router = express.Router();

const prisma = require('../config/prisma');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdmin);



// Tüm birimleri veritabanından getir

router.get('/', async (req, res) => {

    try {

        const birimler = await prisma.birim.findMany();

        res.json(birimler);

    } catch (error) {

        console.error("Birimler listelenirken hata:", error);

        res.status(500).json({ hata: "Sunucu hatası" });

    }

});



// ID'ye göre tek bir birim getir

router.get('/:id', async (req, res) => {

    try {

        const { id } = req.params;

        const birim = await prisma.birim.findUnique({

            where: { birimId: parseInt(id) }

        });

       

        if (!birim) return res.status(404).json({ hata: "Birim bulunamadı" });

        res.json(birim);

    } catch (error) {

        console.error("Birim getirilirken hata:", error);

        res.status(500).json({ hata: "Sunucu hatası" });

    }

});



module.exports = router;