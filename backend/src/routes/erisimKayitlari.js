const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticateToken, requireAdminOrHoca } = require('../middlewares/authMiddleware');
router.use(authenticateToken, requireAdminOrHoca);

// Erişim kayıtlarını sayfalama (limit ve offset) desteğiyle getir
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        // Yönetici olmayanlar (hoca, idari personel) yalnızca kendi erişim kayıtlarını görebilir;
        // adminler tüm kayıtları görür. (Bu görünürlük farkı frontend'de de yansıtılır, ama
        // gerçek sınır burada, API seviyesinde uygulanır.)
        const where = req.authenticatedUser.rol === 'admin' ? {} : { kullaniciId: BigInt(req.user.kullaniciId) };

        const erisimKayitlari = await prisma.erisimKaydi.findMany({
            where,
            take: limit,
            skip: offset,
            // Cihaz saati sapabilse de sunucuya en son ulaşan kayıt üstte olsun.
            orderBy: [
                { kayitTamani: 'desc' },
                { kayitId: 'desc' }
            ],
            include: {
                cihaz: true,
                kapi: true,
                kullanici: {
                    select: {
                        kullaniciId: true,
                        ad: true,
                        soyad: true,
                        eposta: true,
                        rol: true,
                        durum: true
                    }
                }
            }
        });

        res.json(erisimKayitlari);
    } catch (error) {
        console.error("Erişim kayıtları listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
