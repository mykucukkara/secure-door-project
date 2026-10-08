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
// Grupları, üye sayılarıyla birlikte listele
router.get('/', async (req, res) => {
    try {
        const gruplar = await prisma.grup.findMany({
            include: {
                _count: {
                    select: { uyeler: true }
                }
            },
            orderBy: {
                ad: 'asc'
            }
        });

        // _count.uyeler -> uyeSayisi olarak sadeleştir
        const sonuc = gruplar.map(grup => ({
            ...grup,
            uyeSayisi: grup._count.uyeler,
            _count: undefined
        }));

        res.json(sonuc);
    } catch (error) {
        console.error("Gruplar listelenirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// ID'ye göre tek bir grubu, üyeleriyle birlikte getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const grupId = parseInt(id);

        if (isNaN(grupId)) {
            return res.status(400).json({ hata: "Geçersiz grup ID" });
        }

        const grup = await prisma.grup.findUnique({
            where: { grupId },
            include: {
                uyeler: {
                    include: {
                        kullanici: { select: safeUserSelect }
                    }
                }
            }
        });

        if (!grup) return res.status(404).json({ hata: "Grup bulunamadı" });
        res.json(grup);
    } catch (error) {
        console.error("Grup getirilirken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Yeni grup oluştur
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { ad, aciklama, aktif } = req.body;

        if (!ad) {
            return res.status(400).json({ hata: "'ad' alanı zorunludur" });
        }

        const yeniGrup = await prisma.grup.create({
            data: {
                ad,
                aciklama: aciklama ?? null,
                ...(aktif !== undefined ? { aktif: !!aktif } : {})
            }
        });

        res.status(201).json(yeniGrup);
    } catch (error) {
        console.error("Grup oluşturulurken hata:", error);
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Grubu güncelle
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const grupId = parseInt(id);
        if (isNaN(grupId)) {
            return res.status(400).json({ hata: "Geçersiz grup ID" });
        }

        const { ad, aciklama, aktif } = req.body;

        const guncellenmisGrup = await prisma.grup.update({
            where: { grupId },
            data: {
                ...(ad !== undefined ? { ad } : {}),
                ...(aciklama !== undefined ? { aciklama } : {}),
                ...(aktif !== undefined ? { aktif: !!aktif } : {})
            }
        });

        res.json(guncellenmisGrup);
    } catch (error) {
        console.error("Grup güncellenirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Grup bulunamadı" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Grubu sil
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const grupId = parseInt(id);
        if (isNaN(grupId)) {
            return res.status(400).json({ hata: "Geçersiz grup ID" });
        }

        await prisma.grup.delete({ where: { grupId } });

        res.status(200).json({ mesaj: "Grup silindi" });
    } catch (error) {
        console.error("Grup silinirken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Grup bulunamadı" });
        }
        if (error.code === 'P2003') {
            return res.status(409).json({ hata: "Bu gruba bağlı üyeler veya yetki kuralları olduğu için silinemedi. Önce üyeleri/kuralları kaldırın." });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Gruba üye (kullanıcı) ekle
router.post('/:id/uyeler', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const grupId = parseInt(id);
        const { kullaniciId } = req.body;

        if (isNaN(grupId) || kullaniciId == null) {
            return res.status(400).json({ hata: "Geçersiz grup ID veya eksik 'kullaniciId'" });
        }

        const uyelik = await prisma.kullaniciGrup.create({
            data: {
                grupId,
                kullaniciId: parseInt(kullaniciId)
            },
            include: { kullanici: { select: safeUserSelect }, grup: true }
        });

        res.status(201).json(uyelik);
    } catch (error) {
        console.error("Üye eklenirken hata:", error);
        if (error.code === 'P2002') {
            return res.status(409).json({ hata: "Bu kullanıcı zaten bu grubun üyesi" });
        }
        if (error.code === 'P2003') {
            return res.status(400).json({ hata: "Belirtilen grupId veya kullaniciId geçerli değil" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

// Gruptan üye (kullanıcı) çıkar
router.delete('/:id/uyeler/:kullaniciId', requireAdmin, async (req, res) => {
    try {
        const { id, kullaniciId } = req.params;
        const grupId = parseInt(id);

        if (isNaN(grupId)) {
            return res.status(400).json({ hata: "Geçersiz grup ID" });
        }

        await prisma.kullaniciGrup.delete({
            where: {
                kullaniciId_grupId: {
                    kullaniciId: parseInt(kullaniciId),
                    grupId
                }
            }
        });

        res.status(200).json({ mesaj: "Üye gruptan çıkarıldı" });
    } catch (error) {
        console.error("Üye çıkarılırken hata:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ hata: "Bu kullanıcı bu grubun üyesi değil" });
        }
        res.status(500).json({ hata: "Sunucu hatası" });
    }
});

module.exports = router;
