const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { JWT_SECRET } = require('../middlewares/authMiddleware');

const TEST_ADMIN_EPOSTA = 'test.yonetici@securelab.test';

function signFor(user) {
  return jwt.sign({
    kullaniciId: user.kullaniciId.toString(),
    eposta: user.eposta,
    rol: user.rol,
    oturumSurumu: user.oturumSurumu
  }, JWT_SECRET, { expiresIn: '10m' });
}

/**
 * Testler için şifre değişimi tamamlanmış ayrı bir yönetici hesabı kullanılır.
 * Seed ile açılan gerçek yönetici hesapları ilk girişte şifre değiştirmek
 * zorunda olduğundan testlerde kullanılmaz.
 */
async function getTestAdmin() {
  let admin = await prisma.kullanici.findFirst({ where: { eposta: TEST_ADMIN_EPOSTA } });
  if (!admin) {
    admin = await prisma.kullanici.create({
      data: {
        ad: 'Test',
        soyad: 'Yönetici',
        eposta: TEST_ADMIN_EPOSTA,
        rol: 'admin',
        durum: 'aktif',
        sifreHash: await argon2.hash('TestYonetici2026'),
        sifreDegistirmeZorunlu: false
      }
    });
  } else if (admin.durum !== 'aktif' || admin.rol !== 'admin' || admin.sifreDegistirmeZorunlu) {
    admin = await prisma.kullanici.update({
      where: { kullaniciId: admin.kullaniciId },
      data: { durum: 'aktif', rol: 'admin', sifreDegistirmeZorunlu: false }
    });
  }
  return admin;
}

async function getAdminToken() {
  return signFor(await getTestAdmin());
}

module.exports = { getAdminToken, getTestAdmin, signFor, TEST_ADMIN_EPOSTA };
