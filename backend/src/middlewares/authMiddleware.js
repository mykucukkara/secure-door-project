const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'securelab-development-only-secret';

const SIFRE_DEGISIMI_SIRASINDA_IZINLI = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout'
]);

function requestPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
}

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return res.status(401).json({ message: 'Oturum açmanız gerekiyor.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const userId = BigInt(decoded.kullaniciId || 0);
    const user = await prisma.kullanici.findUnique({
      where: { kullaniciId: userId },
      select: {
        kullaniciId: true,
        eposta: true,
        rol: true,
        durum: true,
        oturumSurumu: true,
        sifreDegistirmeZorunlu: true
      }
    });

    if (!user || user.durum !== 'aktif') {
      return res.status(401).json({ message: 'Aktif kullanıcı oturumu bulunamadı.' });
    }
    if (Number(decoded.oturumSurumu) !== user.oturumSurumu) {
      return res.status(401).json({ message: 'Oturumunuz güvenlik nedeniyle sonlandırıldı. Lütfen yeniden giriş yapın.' });
    }

    // Geçici şifreyle giriş yapan kullanıcı, kendi şifresini belirleyene kadar
    // yalnızca oturum bilgisi, şifre değiştirme ve çıkış uçlarını kullanabilir.
    if (user.sifreDegistirmeZorunlu && !SIFRE_DEGISIMI_SIRASINDA_IZINLI.has(requestPath(req))) {
      return res.status(403).json({
        message: 'Devam etmeden önce geçici şifrenizi değiştirmeniz gerekiyor.',
        code: 'SIFRE_DEGISTIRME_ZORUNLU'
      });
    }

    req.authenticatedUser = user;
    req.user = {
      ...decoded,
      kullaniciId: user.kullaniciId.toString(),
      eposta: user.eposta,
      rol: user.rol,
      oturumSurumu: user.oturumSurumu
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Oturum geçersiz veya süresi dolmuş.' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.authenticatedUser?.rol === 'admin') return next();
  return res.status(403).json({ message: 'Bu işlem için yönetici yetkisi gerekiyor.' });
};

// İdari personel, panelde öğretim elemanıyla aynı (salt okunur) yetkilere sahiptir.
const requireAdminOrHoca = (req, res, next) => {
  if (req.authenticatedUser && ['admin', 'hoca', 'idari_personel'].includes(req.authenticatedUser.rol)) return next();
  return res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
};

// Yetkili öğrenci dahil tüm panel kullanıcıları (yalnızca kendi verisini gören uç noktalar için).
const requirePanelUser = (req, res, next) => {
  if (req.authenticatedUser
    && ['admin', 'hoca', 'idari_personel', 'yetkili_ogrenci'].includes(req.authenticatedUser.rol)) return next();
  return res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
};

const requireSelfOrAdmin = (req, res, next) => {
  const requestedUserId = String(req.params.id || req.params.kullaniciId || '');
  const authenticatedUserId = String(req.user?.kullaniciId || '');
  if (req.authenticatedUser?.rol === 'admin'
    || (authenticatedUserId && authenticatedUserId === requestedUserId)) {
    return next();
  }
  return res.status(403).json({ message: 'Yalnızca kendi hesabınız üzerinde işlem yapabilirsiniz.' });
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireAdminOrHoca,
  requirePanelUser,
  requireSelfOrAdmin,
  JWT_SECRET
};
