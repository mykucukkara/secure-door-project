/**
 * SecureLab başlangıç verileri
 *
 *   node prisma/seed.js             Her backend açılışında çalışır (docker-entrypoint.sh).
 *                                   Eksik yönetici hesaplarını, bölümü ve örnek kapıyı oluşturur.
 *                                   Kullanıcı tablosu BOŞSA (ilk kurulum / sıfırlama sonrası)
 *                                   bölüm kadrosunun tamamını da ekler.
 *   node prisma/seed.js --hocalar   Kadrodaki eksik öğretim elemanlarını sonradan ekler.
 *
 * Mevcut hesaplara ve şifrelere ASLA dokunmaz; yönetici panelinden silinen bir
 * hoca, sonraki açılışta geri eklenmez (kadro yalnızca ilk kurulumda yüklenir).
 *
 * Tüm başlangıç hesapları ilk girişte şifre değiştirmek zorundadır.
 */
const crypto = require('crypto');
const argon2 = require('argon2');
const prisma = require('../src/config/prisma');
const { recordPinHistory } = require('../src/services/pinHistoryService');
const { validateCustomPin } = require('../src/services/pinService');
const {
  akademikKadro,
  VARSAYILAN_BOLUM_BASKANI_EPOSTA
} = require('../src/data/bmAkademikKadro');

const GELISTIRME_ADMIN_SIFRESI = 'SecureLab2026!';
const GELISTIRME_HOCA_SIFRESI = 'BmLab-2026!';

const kullanilanPinler = new Set();

function uretPin() {
  for (let deneme = 0; deneme < 200; deneme += 1) {
    const pin = crypto.randomInt(100000, 1000000).toString();
    if (!kullanilanPinler.has(pin) && validateCustomPin(pin).valid) {
      kullanilanPinler.add(pin);
      return pin;
    }
  }
  throw new Error('Benzersiz kapı şifresi üretilemedi.');
}

async function mevcutKullanici(eposta) {
  return prisma.kullanici.findFirst({
    where: { eposta: { equals: eposta, mode: 'insensitive' } }
  });
}

/** Hesap yoksa oluşturur; varsa hiçbir alanına dokunmaz. */
async function hesapOlustur({ ad, soyad, unvan = null, eposta, rol, birimId, sifre }) {
  const email = String(eposta).trim().toLowerCase();
  const existing = await mevcutKullanici(email);
  if (existing) return { kullanici: existing, yeni: false };

  const pin = uretPin();
  const [sifreHash, pinHash] = await Promise.all([argon2.hash(sifre), argon2.hash(pin)]);
  const kullanici = await prisma.$transaction(async (tx) => {
    const user = await tx.kullanici.create({
      data: {
        ad,
        soyad,
        unvan,
        eposta: email,
        rol,
        birimId,
        durum: 'aktif',
        sifreHash,
        sifreGecerlilikBitis: null,
        sifreDegistirmeZorunlu: true,
        pinHash,
        pinSonDegisim: new Date(),
        pinGecerlilikBitis: null
      }
    });
    await recordPinHistory(tx, {
      kullaniciId: user.kullaniciId,
      pin,
      pinHash,
      gecerlilikBitis: null,
      kaynak: 'baslangic'
    });
    return user;
  });
  return { kullanici, yeni: true };
}

function ortamSifresi(anahtar, gelistirmeVarsayilani) {
  const deger = String(process.env[anahtar] || '').trim();
  if (deger) return deger;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${anahtar} üretim ortamında .env dosyasında tanımlanmalıdır.`);
  }
  return gelistirmeVarsayilani;
}

async function main() {
  const hocalariYukle = process.argv.includes('--hocalar');
  const ilkKurulum = (await prisma.kullanici.count()) === 0;

  const birim = await prisma.birim.upsert({
    where: { kod: 'CENG' },
    update: { ad: 'Bilgisayar Mühendisliği', aktif: true },
    create: { kod: 'CENG', ad: 'Bilgisayar Mühendisliği', aktif: true }
  });

  const adminSifresi = ortamSifresi('SEED_ADMIN_PASSWORD', GELISTIRME_ADMIN_SIFRESI);
  const hocaSifresi = ortamSifresi('SEED_HOCA_PASSWORD', GELISTIRME_HOCA_SIFRESI);
  const sistemAdminEposta = String(process.env.SEED_ADMIN_EMAIL || 'sistem.yonetici@securelab.local').trim().toLowerCase();
  const baskanEposta = String(process.env.SEED_BOLUM_BASKANI_EPOSTA || VARSAYILAN_BOLUM_BASKANI_EPOSTA).trim().toLowerCase();

  const olusturulanlar = [];

  // 1) Sistemin kendi yönetici hesabı (şimdilik temsili e-posta ile)
  const sistem = await hesapOlustur({
    ad: 'Sistem',
    soyad: 'Yöneticisi',
    eposta: sistemAdminEposta,
    rol: 'admin',
    birimId: birim.birimId,
    sifre: adminSifresi
  });
  if (sistem.yeni) olusturulanlar.push(`${sistemAdminEposta} (yönetici, sistem hesabı)`);

  // 2) Bölüm başkanı — yönetici
  const baskanBilgi = akademikKadro.find((k) => k.eposta === baskanEposta)
    || { ad: 'Bölüm', soyad: 'Başkanı', unvan: null, eposta: baskanEposta };
  const baskan = await hesapOlustur({
    ...baskanBilgi,
    rol: 'admin',
    birimId: birim.birimId,
    sifre: hocaSifresi
  });
  if (baskan.yeni) olusturulanlar.push(`${baskanEposta} (yönetici, bölüm başkanı)`);

  // 3) Bölüm akademik kadrosu (yalnızca ilk kurulumda ya da --hocalar ile)
  if (ilkKurulum || hocalariYukle) {
    for (const kisi of akademikKadro) {
      if (kisi.eposta === baskanEposta) continue;
      // eslint-disable-next-line no-await-in-loop
      const sonuc = await hesapOlustur({
        unvan: kisi.unvan,
        ad: kisi.ad,
        soyad: kisi.soyad,
        eposta: kisi.eposta,
        rol: 'hoca',
        birimId: birim.birimId,
        sifre: hocaSifresi
      });
      if (sonuc.yeni) olusturulanlar.push(`${kisi.eposta}`);
    }
  }

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


  if (olusturulanlar.length) {
    console.log(`Oluşturulan hesaplar (${olusturulanlar.length}):`);
    olusturulanlar.forEach((satir) => console.log(`  - ${satir}`));
    console.log('Başlangıç şifreleri .env içindeki SEED_ADMIN_PASSWORD (sistem yöneticisi) ve');
    console.log('SEED_HOCA_PASSWORD (öğretim elemanları) değerleridir. İlk girişte değiştirilmeleri zorunludur.');
  } else {
    console.log('Başlangıç verileri zaten mevcut; hesaplara dokunulmadı.');
  }
}

main()
  .catch((error) => {
    console.error('Seed hatası:', error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
