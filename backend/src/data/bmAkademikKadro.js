/**
 * SUBÜ Bilgisayar Mühendisliği akademik kadrosu — yedek (çevrimdışı) liste.
 *
 * Kaynak: https://bm.subu.edu.tr/tr/akademik-kadro (27.09.2026 itibarıyla)
 * Bölüm sitesinde e-posta adresleri açıkça yazmaz; her öğretim elemanının
 * kişisel sayfası "<kullanici>.subu.edu.tr" biçimindedir ve kurumsal e-posta
 * adresi "<kullanici>@subu.edu.tr" olarak aynı kullanıcı adını kullanır.
 *
 * Bu liste iki yerde kullanılır:
 *   1. prisma/seed.js — veritabanı sıfırdan kurulurken hesapların açılması
 *   2. akademikKadroService — bölüm sitesine ulaşılamazsa "Yeni Kullanıcı Ekle"
 *      sayfasında yedek kaynak olarak
 */

const KAYNAK_URL = 'https://bm.subu.edu.tr/tr/akademik-kadro';

const akademikKadro = [
  { unvan: 'Prof. Dr.', ad: 'Halit', soyad: 'Öztekin', eposta: 'halitoztekin@subu.edu.tr', gorev: 'Bölüm Başkanı' },
  { unvan: 'Doç. Dr.', ad: 'Caner', soyad: 'Erden', eposta: 'cerden@subu.edu.tr', gorev: 'Bölüm Başkan Yardımcısı' },
  { unvan: 'Doç. Dr.', ad: 'Ekin', soyad: 'Ekinci', eposta: 'ekinekinci@subu.edu.tr', gorev: 'Bölüm Başkan Yardımcısı' },
  { unvan: 'Doç. Dr.', ad: 'Selman', soyad: 'Hızal', eposta: 'selmanhizal@subu.edu.tr', gorev: 'Uzaktan Eğitim Uygulama ve Araştırma Merkezi Müdürü' },
  { unvan: 'Doç. Dr.', ad: 'Süleyman', soyad: 'Uzun', eposta: 'suleymanuzun@subu.edu.tr', gorev: null },
  { unvan: 'Doç. Dr.', ad: 'Zafer', soyad: 'Albayrak', eposta: 'zaferalbayrak@subu.edu.tr', gorev: null },
  { unvan: 'Doç. Dr.', ad: 'Zeynep', soyad: 'Garip', eposta: 'zbatik@subu.edu.tr', gorev: null },
  { unvan: 'Dr. Öğr. Üyesi', ad: 'Ahmet', soyad: 'Kala', eposta: 'ahmetkala@subu.edu.tr', gorev: null },
  { unvan: 'Dr. Öğr. Üyesi', ad: 'Emin', soyad: 'Güney', eposta: 'eminguney@subu.edu.tr', gorev: null },
  { unvan: 'Dr. Öğr. Üyesi', ad: 'Fatih', soyad: 'Varçın', eposta: 'fatihvarcin@subu.edu.tr', gorev: null },
  { unvan: 'Dr. Öğr. Üyesi', ad: 'Muhammed Ali Nur', soyad: 'Öz', eposta: 'muhammedoz@subu.edu.tr', gorev: null },
  { unvan: 'Dr. Öğr. Üyesi', ad: 'Muhammed', soyad: 'Telçeken', eposta: 'muhammedtelceken@subu.edu.tr', gorev: null },
  { unvan: 'Dr. Öğr. Üyesi', ad: 'A.F.M. Suaib', soyad: 'Akhter', eposta: 'suaibakhter@subu.edu.tr', gorev: null },
  { unvan: 'Arş. Gör. Dr.', ad: 'Muhammed Yusuf', soyad: 'Küçükkara', eposta: 'muhammedkucukkara@subu.edu.tr', gorev: null },
  { unvan: 'Arş. Gör.', ad: 'Furkan', soyad: 'Atban', eposta: 'furkanatban@subu.edu.tr', gorev: null },
  { unvan: 'Arş. Gör.', ad: 'İsmail', soyad: 'Ergün', eposta: 'ismailergun@subu.edu.tr', gorev: null },
  { unvan: 'Arş. Gör.', ad: 'Semih', soyad: 'Özenç', eposta: 'semihozenc@subu.edu.tr', gorev: null },
  { unvan: 'Arş. Gör.', ad: 'Yavuz Selim', soyad: 'Bozan', eposta: 'ysbozan@subu.edu.tr', gorev: null },
  { unvan: 'Arş. Gör.', ad: 'Muhammed Bilâl', soyad: 'Kamburoğlu', eposta: 'mbk@subu.edu.tr', gorev: 'Bilgi İşlem Daire Başkanlığı' }
];

// Bölüm başkanı (yönetici rolüyle açılır). .env içindeki
// SEED_BOLUM_BASKANI_EPOSTA ile değiştirilebilir.
const VARSAYILAN_BOLUM_BASKANI_EPOSTA = 'halitoztekin@subu.edu.tr';

module.exports = {
  KAYNAK_URL,
  akademikKadro,
  VARSAYILAN_BOLUM_BASKANI_EPOSTA
};
