const argon2 = require('argon2');
const prisma = require('../src/config/prisma');
const { recordPinHistory } = require('../src/services/pinHistoryService');

async function ensureUser({ ad, soyad, eposta, rol, birimId, password, pin }) {
  const existing = await prisma.kullanici.findFirst({
    where: { eposta: { equals: eposta, mode: 'insensitive' } }
  });
  const passwordHash = await argon2.hash(password);
  const pinHash = await argon2.hash(pin);

  if (existing) {
    return prisma.kullanici.update({
      where: { kullaniciId: existing.kullaniciId },
      data: {
        ad,
        soyad,
        eposta,
        rol,
        birimId,
        durum: 'aktif',
        ...(existing.sifreHash ? {} : { sifreHash: passwordHash }),
        ...(existing.pinHash ? {} : {
          pinHash,
          pinSonDegisim: new Date(),
          pinGecerlilikBitis: null
        })
      }
    });
  }

  // Kapı şifreleri kalıcıdır (süresi dolmaz).
  const expiresAt = null;
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.kullanici.create({
      data: {
        ad,
        soyad,
        eposta,
        rol,
        birimId,
        durum: 'aktif',
        sifreHash: passwordHash,
        pinHash,
        pinSonDegisim: new Date(),
        pinGecerlilikBitis: expiresAt
      }
    });
    await recordPinHistory(transaction, {
      kullaniciId: user.kullaniciId,
      pin,
      pinHash,
      gecerlilikBitis: expiresAt,
      kaynak: 'baslangic'
    });
    return user;
  });
}

async function main() {
  const birim = await prisma.birim.upsert({
    where: { kod: 'CENG' },
    update: { ad: 'Bilgisayar Mühendisliği', aktif: true },
    create: { kod: 'CENG', ad: 'Bilgisayar Mühendisliği', aktif: true }
  });

  const adminEmail = String(process.env.SEED_ADMIN_EMAIL || 'admin@securelab.local').trim().toLowerCase();
  const admin = await ensureUser({
    ad: 'SecureLab',
    soyad: 'Yöneticisi',
    eposta: adminEmail,
    rol: 'admin',
    birimId: birim.birimId,
    password: process.env.SEED_ADMIN_PASSWORD || 'SecureLab2026!',
    pin: process.env.SEED_ADMIN_PIN || '864209'
  });

  await prisma.kullanici.updateMany({
    where: {
      rol: 'admin',
      NOT: { kullaniciId: admin.kullaniciId }
    },
    data: { rol: 'hoca' }
  });

  const kapi = await prisma.kapi.findFirst({ where: { ad: 'Laboratuvar Kapısı' } })
    || await prisma.kapi.create({
      data: {
        ad: 'Laboratuvar Kapısı',
        bina: 'A',
        kat: 2,
        aciklama: 'Bilgisayar Laboratuvarı',
        durum: 'aktif'
      }
    });

  const cihaz = await prisma.cihaz.upsert({
    where: { seriNo: 'ESP32-LAB-001' },
    update: { durum: 'aktif' },
    create: { seriNo: 'ESP32-LAB-001', durum: 'aktif' }
  });

  const atama = await prisma.cihazKapiAtama.findFirst({
    where: { cihazId: cihaz.cihazId, kapiId: kapi.kapiId, bitis: null }
  });
  if (!atama) {
    await prisma.cihazKapiAtama.create({
      data: { cihazId: cihaz.cihazId, kapiId: kapi.kapiId }
    });
  }

  const durumSayisi = await prisma.cihazDurumu.count({ where: { cihazId: cihaz.cihazId } });
  if (!durumSayisi) {
    await prisma.cihazDurumu.create({
      data: {
        cihazId: cihaz.cihazId,
        kapiDurumu: 'kapali',
        cihazDurumTip: 'cevrimdisi',
        firmwareVersiyon: '1.0.0',
        sonHeartbeat: new Date()
      }
    });
  }

  console.log('Canlı başlangıç verileri hazır.');
  console.log(`Yönetici: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error('Seed hatası:', error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
