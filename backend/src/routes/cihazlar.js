const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdmin);
// Tüm cihazları veritabanından getir
router.get('/', async (req, res) => {
    try {
        const cihazlar = await prisma.cihaz.findMany();
        res.json(cihazlar);
    } catch (error) {
        console.error("Cihazlar listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// ID'ye göre tek bir cihaz getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cihaz = await prisma.cihaz.findUnique({
            where: { cihazId: parseInt(id) }
        });
        
        if (!cihaz) return res.status(404).json({ hata: "Cihaz bulunamadı" });
        res.json(cihaz);
    } catch (error) {
        console.error("Cihaz getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});
const { generateOfflineListForDevice } = require('../services/pinService');

// Görev 4.3: Belirli bir cihaz için offline çalışma listesi üretme endpoint'i
router.post('/:id/offline-liste-uret', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const sonuc = await generateOfflineListForDevice(id);
    
    return res.status(201).json({
      success: true,
      message: "POST /api/cihazlar/:id/offline-liste-uret başarıyla çalıştı. Offline liste oluşturuldu.",
      data: sonuc
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Offline liste üretilirken hata oluştu.",
      error: error.message
    });
  }
});

// Yeni cihaz ekle
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { seriNo, durum, kurulumuTarihi } = req.body;

        if (!seriNo) {
            return res.status(400).json({ hata: "'seriNo' alanı zorunludur" });
        }

        const yeniCihaz = await prisma.cihaz.create({
            data: {
                seriNo,
                ...(durum ? { durum } : {}),
                ...(kurulumuTarihi ? { kurulumuTarihi: new Date(kurulumuTarihi) } : {})
            }
        });

        res.status(201).json(yeniCihaz);
    } catch (error) {
        console.error("Cihaz oluşturulurken hata:", error);
        if (error.code === 'P2002') {
            return res.status(409).json({ hata: "Bu seriNo ile kayıtlı bir cihaz zaten var" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Cihaz bilgilerini güncelle
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { seriNo, durum } = req.body;

        const guncellenmisCihaz = await prisma.cihaz.update({
            where: { cihazId: parseInt(id) },
            data: {
                ...(seriNo !== undefined ? { seriNo } : {}),
                ...(durum !== undefined ? { durum } : {})
            }
        });

        res.json(guncellenmisCihaz);
    } catch (error) {
        console.error("Cihaz güncellenirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Cihaz bulunamadı" });
        }
        if (error.code === 'P2002') {
            return res.status(409).json({ hata: "Bu seriNo ile kayıtlı başka bir cihaz zaten var" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Cihazı sil
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.cihaz.delete({
            where: { cihazId: parseInt(id) }
        });

        res.status(200).json({ mesaj: "Cihaz silindi" });
    } catch (error) {
        console.error("Cihaz silinirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Cihaz bulunamadı" });
        }
        if (error.code === 'P2003') {
            return res.status(409).json({ hata: "Bu cihaza bağlı kayıtlar (kapı ataması, erişim kaydı vb.) olduğu için silinemedi. Bunun yerine durumu 'emekli' yapmayı deneyin." });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
