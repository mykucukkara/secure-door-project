const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const issueReportService = require('../services/issueReportService');
const { writeAudit } = require('../services/auditService');
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddleware');

const SUPPORTED_ISSUE_TYPES = new Set([
    'Kapı', 'RFID okuyucu', 'Tuş takımı', 'Monitör', 'Bilgisayar kasası',
    'Klavye', 'Fare', 'Kablo, adaptör veya priz', 'Ağ veya internet',
    'Yazıcı veya projeksiyon', 'Masa veya sandalye', 'Diğer'
]);

// POST /api/arizalar - QR kod veya form ile yeni arıza bildirimi yapma
// NOT: Bu, QR kod okutan herkesin (giriş yapmadan) kullandığı bir form,
// bu yüzden bilerek korumasız bırakıldı.
router.post('/', async (req, res) => {
    try {
        const { reportedBy, issueType, description, photoName, photoData } = req.body;
        const normalizedType = String(issueType || '').trim();
        const normalizedDescription = String(description || '').trim();
        
        if (!normalizedType || !normalizedDescription) {
            return res.status(400).json({ 
                success: false, 
                error: 'Arıza türü ve açıklaması zorunludur.' 
            });
        }
        if (!SUPPORTED_ISSUE_TYPES.has(normalizedType)) {
            return res.status(400).json({ success: false, error: 'Geçersiz arıza türü.' });
        }
        if (normalizedDescription.length < 5 || normalizedDescription.length > 512) {
            return res.status(400).json({ success: false, error: 'Açıklama 5 ile 512 karakter arasında olmalıdır.' });
        }
        const supportedImage = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
        if (photoData && (!supportedImage.test(String(photoData)) || String(photoData).length > 4_000_000)) {
            return res.status(400).json({
                success: false,
                error: 'Fotoğraf geçersiz veya izin verilen boyuttan büyük.'
            });
        }

        const result = await issueReportService.createIssueReport({
            reportedBy: String(reportedBy || 'Anonim').trim().slice(0, 128),
            issueType: normalizedType,
            description: normalizedDescription,
            photoName: photoName ? String(photoName).slice(0, 128) : null,
            photoData
        });

        if (result.success) {
            await writeAudit({
                action: 'olustur',
                tableName: 'ariza_bildirimi',
                recordId: result.report.arizaId,
                after: { arizaTuru: result.report.arizaTuru, durum: result.report.durum }
            });
            return res.status(201).json(result);
        } else {
            return res.status(500).json(result);
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/arizalar - Tüm arıza bildirimlerini listeleme (Yönetici Paneli)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const reports = await issueReportService.getAllIssueReports();
        return res.json({ success: true, data: reports });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/arizalar/:id - Arıza durumunu güncelleme (OPEN, IN_PROGRESS, RESOLVED)
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ 
                success: false, 
                error: 'Güncellenecek durum (status) belirtilmelidir.' 
            });
        }
        if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Geçersiz arıza durumu.'
            });
        }

        const before = await prisma.arizaBildirimi.findUnique({
            where: { arizaId: Number(id) },
            select: { arizaId: true, durum: true }
        });
        if (!before) return res.status(404).json({ success: false, error: 'Arıza kaydı bulunamadı.' });
        const result = await issueReportService.updateReportStatus(id, status);
        
        if (result.success) {
            await writeAudit({
                actorId: req.user.kullaniciId,
                action: 'guncelle',
                tableName: 'ariza_bildirimi',
                recordId: id,
                before: { durum: before.durum },
                after: { durum: status }
            });
            return res.json(result);
        } else {
            return res.status(400).json(result);
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
