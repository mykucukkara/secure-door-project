// Gelistirme ortaminda yonetici hesaplarinin web sifresini baslangic sifresine dondurur.
// Kullanim: scripts\sifre-sifirla.cmd  (backend konteyneri icinde calisir)
const argon2 = require('argon2');
const prisma = require('/app/src/config/prisma');

const HESAPLAR = [
  [process.env.SEED_ADMIN_EMAIL || 'sistem.yonetici@securelab.local', 'SecureLab2026!'],
  [process.env.SEED_BOLUM_BASKANI_EPOSTA || 'halitoztekin@subu.edu.tr', 'BmLab-2026!']
];

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Uretim ortaminda calistirilamaz.');
  for (const [eposta, sifre] of HESAPLAR) {
    const r = await prisma.kullanici.updateMany({
      where: { eposta: { equals: eposta, mode: 'insensitive' } },
      data: { sifreHash: await argon2.hash(sifre), sifreDegistirmeZorunlu: false, sifreGecerlilikBitis: null }
    });
    console.log(r.count ? `${eposta}  ->  ${sifre}` : `${eposta} bulunamadi`);
  }
})().catch((e) => { console.error('HATA:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
