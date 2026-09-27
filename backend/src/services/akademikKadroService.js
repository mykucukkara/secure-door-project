/**
 * Bölüm sitesindeki (bm.subu.edu.tr) akademik kadroyu okur.
 *
 * "Yeni Kullanıcı Ekle" sayfası, sitede görünen ama SecureLab'de hesabı
 * olmayan öğretim elemanlarını listeler. Site erişilemezse (ağ yok, site
 * değişti vb.) src/data/bmAkademikKadro.js içindeki yedek liste kullanılır.
 *
 * Güvenlik: Adres .env ile yalnızca yönetici tarafından değiştirilebilir,
 * yalnızca https ve *.subu.edu.tr alan adına izin verilir, yanıt boyutu ve
 * süresi sınırlıdır; sayfadan gelen metinler düz metin olarak işlenir.
 */
const { KAYNAK_URL, akademikKadro } = require('../data/bmAkademikKadro');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;

// Kişisel sayfa olmayan kurumsal alt alan adları
const KURUMSAL_ALT_ALANLAR = new Set([
  'www', 'bm', 'bys', 'obs', 'ebys', 'uzem', 'lms', 'kutuphane', 'library', 'mail', 'posta',
  'webmail', 'personel', 'ogrenci', 'bilgi', 'bidb', 'oidb', 'sks', 'tf', 'mf', 'teknoloji',
  'avesis', 'akademik', 'kariyer', 'ebs', 'yds', 'yabancidiller', 'btmyo', 'smyo', 'destek',
  'kalite', 'basin', 'haber', 'duyuru', 'etkinlik', 'enstitu', 'lee', 'fbe', 'sbe'
]);

const UNVANLAR = [
  'Prof. Dr.',
  'Doç. Dr.',
  'Dr. Öğr. Üyesi',
  'Dr. Öğretim Üyesi',
  'Öğr. Gör. Dr.',
  'Öğr. Gör.',
  'Arş. Gör. Dr.',
  'Arş. Gör.',
  'Dr.'
];

let cache = null; // { zaman, sonuc }

function izinliKaynakUrl() {
  const raw = String(process.env.AKADEMIK_KADRO_URL || KAYNAK_URL).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return KAYNAK_URL;
    if (url.hostname !== 'subu.edu.tr' && !url.hostname.endsWith('.subu.edu.tr')) return KAYNAK_URL;
    return url.toString();
  } catch (error) {
    return KAYNAK_URL;
  }
}

const HTML_VARLIKLARI = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü',
  acirc: 'â', Acirc: 'Â', icirc: 'î', ucirc: 'û'
};

function htmlToText(fragment) {
  return String(fragment || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => HTML_VARLIKLARI[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function parseUnvanVeAd(tamAd) {
  let metin = String(tamAd || '').replace(/\s+/g, ' ').trim();
  let unvan = null;
  for (const aday of UNVANLAR) {
    if (metin.toLocaleLowerCase('tr-TR').startsWith(aday.toLocaleLowerCase('tr-TR'))) {
      unvan = aday === 'Dr. Öğretim Üyesi' ? 'Dr. Öğr. Üyesi' : aday;
      metin = metin.slice(aday.length).trim();
      break;
    }
  }
  const parcalar = metin.split(' ').filter(Boolean);
  if (parcalar.length < 2) return null;
  const soyad = parcalar.pop();
  return { unvan, ad: parcalar.join(' '), soyad };
}

function normalizeEposta(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Bölüm sitesinin HTML'inden kadroyu çıkarır.
 * Her kişi kartında bir başlık (h2–h4: "Prof. Dr. Ad Soyad"), isteğe bağlı
 * bir görev satırı ve kişisel sayfa bağlantısı (https://<kullanici>.subu.edu.tr)
 * bulunur. Kurumsal e-posta "<kullanici>@subu.edu.tr" olarak türetilir; sayfada
 * açıkça bir mailto: adresi varsa o tercih edilir.
 */
function parseAkademikKadroHtml(html) {
  const temiz = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const basliklar = [];
  const baslikRe = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = baslikRe.exec(temiz)) !== null) {
    const metin = htmlToText(m[2]);
    if (UNVANLAR.some((u) => metin.toLocaleLowerCase('tr-TR').startsWith(u.toLocaleLowerCase('tr-TR')))) {
      basliklar.push({ bas: m.index, son: baslikRe.lastIndex, metin });
    }
  }

  const sonuc = [];
  const gorulen = new Set();
  basliklar.forEach((baslik) => {
    // Kişinin kartı, bir sonraki başlığa (ya da en fazla 3000 karaktere) kadar sürer.
    const sonraki = temiz.slice(baslik.son, baslik.son + 3000);
    const sonrakiBaslik = sonraki.search(/<h[1-6]\b|<footer\b/i);
    const bolum = sonrakiBaslik >= 0 ? sonraki.slice(0, sonrakiBaslik) : sonraki;

    let eposta = null;
    const mail = bolum.match(/mailto:([a-z0-9._%+-]+@(?:[a-z0-9-]+\.)*subu\.edu\.tr)/i);
    if (mail) {
      eposta = normalizeEposta(mail[1]);
    } else {
      const siteRe = /https?:\/\/([a-z0-9][a-z0-9-]{0,62})\.subu\.edu\.tr\b/gi;
      let s;
      while ((s = siteRe.exec(bolum)) !== null) {
        const alt = s[1].toLowerCase();
        if (!KURUMSAL_ALT_ALANLAR.has(alt)) {
          eposta = `${alt}@subu.edu.tr`;
          break;
        }
      }
    }
    if (!eposta || gorulen.has(eposta)) return;

    const kisi = parseUnvanVeAd(baslik.metin);
    if (!kisi) return;

    // Başlık ile bağlantı arasındaki kısa metin görev bilgisidir.
    const ilkBaglanti = bolum.search(/<a\b|https?:\/\//i);
    const gorevMetni = htmlToText(ilkBaglanti >= 0 ? bolum.slice(0, ilkBaglanti) : bolum.slice(0, 300));
    const gorev = gorevMetni && gorevMetni.length <= 120
      ? gorevMetni.replace(/^Bilgisayar Mühendisliği\s*(Bölümü\s*)?/i, '').trim()
      : null;

    gorulen.add(eposta);
    sonuc.push({ ...kisi, eposta, gorev: gorev || null });
  });
  return sonuc;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: { 'User-Agent': 'SecureLab/1.0 (+SUBU Bilgisayar Muhendisligi)', Accept: 'text/html' }
  });
  if (!response.ok) throw new Error(`Bölüm sitesi ${response.status} döndürdü.`);
  const finalHost = new URL(response.url || url).hostname;
  if (finalHost !== 'subu.edu.tr' && !finalHost.endsWith('.subu.edu.tr')) {
    throw new Error('Bölüm sitesi beklenmeyen bir adrese yönlendirdi.');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('Bölüm sitesi yanıtı çok büyük.');
  return buffer.toString('utf8');
}

/**
 * @returns {{ kaynak: 'canli'|'yedek', url: string, zaman: string, uyari?: string, kadro: Array }}
 */
async function getAkademikKadro({ yenile = false } = {}) {
  if (!yenile && cache && Date.now() - cache.zaman < CACHE_TTL_MS) return cache.sonuc;

  const url = izinliKaynakUrl();
  let sonuc;
  if (process.env.AKADEMIK_KADRO_CANLI === 'false' || process.env.NODE_ENV === 'test') {
    sonuc = { kaynak: 'yedek', url, zaman: new Date().toISOString(), kadro: akademikKadro };
  } else {
    try {
      const kadro = parseAkademikKadroHtml(await fetchHtml(url));
      // Site yapısı değişip hiç kişi okunamazsa ya da liste anlamsız biçimde
      // küçükse yedek listeye dön.
      if (kadro.length < 5) throw new Error('Bölüm sitesinden kadro okunamadı (sayfa yapısı değişmiş olabilir).');
      sonuc = { kaynak: 'canli', url, zaman: new Date().toISOString(), kadro };
    } catch (error) {
      console.warn('[AKADEMİK KADRO] Canlı liste alınamadı, yedek liste kullanılıyor:', error.message);
      sonuc = {
        kaynak: 'yedek',
        url,
        zaman: new Date().toISOString(),
        uyari: 'Bölüm sitesine şu anda ulaşılamadı; sistemdeki kayıtlı liste gösteriliyor.',
        kadro: akademikKadro
      };
    }
  }
  // Başarısız denemeler yalnızca 5 dakika önbellekte kalır, sonra yeniden denenir.
  const hataPayi = sonuc.uyari ? CACHE_TTL_MS - 5 * 60 * 1000 : 0;
  cache = { zaman: Date.now() - hataPayi, sonuc };
  return sonuc;
}

function clearCache() {
  cache = null;
}

module.exports = {
  getAkademikKadro,
  parseAkademikKadroHtml,
  parseUnvanVeAd,
  clearCache
};
