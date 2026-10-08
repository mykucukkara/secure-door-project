const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdmin);

// Tüm cihaz-kapı atamalarını veritabanından getir
router.get('/', async (req, res) => {
    try {
        const atamalar = await prisma.cihazKapiAtama.findMany({
            include: {
                // Eğer ilişkili tabloları (cihaz ve kapi) de beraber çekmek istersen:
                cihaz: true,
                kapi: true
            }
        });
        res.json(atamalar);
    } catch (error) {
        console.error("Atamalar listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// ID'ye göre tek bir atama getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const atama = await prisma.cihazKapiAtama.findUnique({
            where: { atamaId: parseInt(id) },
            include: {
                cihaz: true,
                kapi: true
            }
        });
        
        if (!atama) return res.status(404).json({ hata: "Atama bulunamadı" });
        res.json(atama);
    } catch (error) {
        console.error("Atama getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yeni cihaz-kapı ataması oluştur
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { cihazId, kapiId, baslangic } = req.body;

        if (cihazId == null || kapiId == null) {
            return res.status(400).json({ hata: "'cihazId' ve 'kapiId' alanları zorunludur" });
        }

        const yeniAtama = await prisma.cihazKapiAtama.create({
            data: {
                cihazId: parseInt(cihazId),
                kapiId: parseInt(kapiId),
                ...(baslangic ? { baslangic: new Date(baslangic) } : {})
            },
            include: { cihaz: true, kapi: true }
        });

        res.status(201).json(yeniAtama);
    } catch (error) {
        console.error("Atama oluşturulurken hata:", error);
        if (error.code === 'P2003') {
            return res.status(400).json({ hata: "Belirtilen cihazId veya kapiId geçerli değil" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Atamayı güncelle (örn. bitis tarihi girerek atamayı kapatma)
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { bitis } = req.body;

        const guncellenmisAtama = await prisma.cihazKapiAtama.update({
            where: { atamaId: parseInt(id) },
            data: {
                ...(bitis !== undefined ? { bitis: bitis ? new Date(bitis) : null } : {})
            },
            include: { cihaz: true, kapi: true }
        });

        res.json(guncellenmisAtama);
    } catch (error) {
        console.error("Atama güncellenirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Atama bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Atamayı sil
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.cihazKapiAtama.delete({
            where: { atamaId: parseInt(id) }
        });

        res.status(200).json({ mesaj: "Atama silindi" });
    } catch (error) {
        console.error("Atama silinirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Atama bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
