// Ortak ayarlar ve yardımcı fonksiyonlar.
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const AUTH_DIR = path.join(__dirname, '..', '.auth');

// Hesap bilgileri ortam değişkenlerinden okunur; varsayılanlar docker-compose.yml
// içindeki geliştirme değerleridir. "yeni" şifre, ilk girişte zorunlu değişimde
// belirlenen ve sonraki çalıştırmalarda kullanılan şifredir.
const HESAPLAR = {
  yonetici: {
    eposta: process.env.E2E_YONETICI_EPOSTA || 'sistem.yonetici@securelab.local',
    ilkSifre: process.env.E2E_YONETICI_ILK_SIFRE || 'SecureLab2026!',
    sifre: process.env.E2E_YONETICI_SIFRE || 'TestPaneli2026x',
    durumDosyasi: path.join(AUTH_DIR, 'yonetici.json')
  },
  hoca: {
    eposta: process.env.E2E_HOCA_EPOSTA || 'selmanhizal@subu.edu.tr',
    ilkSifre: process.env.E2E_HOCA_ILK_SIFRE || 'BmLab-2026!',
    sifre: process.env.E2E_HOCA_SIFRE || 'TestHocasi2026x',
    durumDosyasi: path.join(AUTH_DIR, 'hoca.json')
  }
};

/** Giriş formunu doldurur; gidilen sayfayı ya da hata mesajını döndürür. */
async function formlaGiris(page, eposta, sifre) {
  await page.goto('/login.html');
  await page.fill('#eposta', eposta);
  await page.fill('#pin', sifre);
  await page.click('#loginSubmit');
  const sonuc = await Promise.race([
    page.waitForURL(/(index|sifre-degistir)\.html/, { timeout: 15_000 }).then(() => 'basarili'),
    page.locator('#loginAlert .alert').waitFor({ timeout: 15_000 }).then(() => 'hata')
  ]);
  if (sonuc === 'hata') return { basarili: false, mesaj: (await page.locator('#loginAlert').innerText()).trim() };
  return { basarili: true, zorunluDegisim: page.url().includes('sifre-degistir') };
}

/**
 * Hesabın şifresi elle değiştirilmişse (ne test ne başlangıç şifresi tutuyorsa)
 * geliştirme ortamındaki şifre yenileme akışıyla test şifresine çevirir.
 * Backend yalnızca üretim dışında ve ALLOW_DEV_PASSWORD_RESET=true iken
 * yenileme bağlantısını yanıtta döndürür; aksi halde false döner.
 */
async function gelistirmeSifreSifirla(page, hesap) {
  const talep = await page.request.post('/api/auth/forgot-password', { data: { eposta: hesap.eposta } });
  if (!talep.ok()) return false;
  const { resetUrl } = await talep.json();
  if (!resetUrl) return false;
  const token = new URL(resetUrl).searchParams.get('token');
  const yenile = await page.request.post('/api/auth/reset-password', {
    data: { token, yeniSifre: hesap.sifre, yeniSifreTekrar: hesap.sifre }
  });
  if (!yenile.ok()) return false;
  console.log(`[e2e] ${hesap.eposta} şifresi geliştirme sıfırlamasıyla test şifresine çevrildi.`);
  return true;
}

/**
 * Hesaba giriş yapar. Önce test şifresi denenir; olmazsa başlangıç şifresiyle
 * girilir ve zorunlu şifre değişiminde test şifresi belirlenir.
 */
async function hesapIleGiris(page, hesap) {
  let sonuc = await formlaGiris(page, hesap.eposta, hesap.sifre);
  if (!sonuc.basarili) {
    sonuc = await formlaGiris(page, hesap.eposta, hesap.ilkSifre);
    if (!sonuc.basarili && /Çok fazla deneme/.test(sonuc.mesaj)) {
      throw new Error('Giriş deneme sınırına takıldı (15 dakikada 10 deneme). ' +
        '"docker compose restart backend" ile sınırı sıfırlayıp testleri tekrar çalıştırın.');
    }
    if (!sonuc.basarili && await gelistirmeSifreSifirla(page, hesap)) {
      sonuc = await formlaGiris(page, hesap.eposta, hesap.sifre);
    }
    if (!sonuc.basarili) {
      throw new Error(`${hesap.eposta} ile giriş yapılamadı (${sonuc.mesaj}). ` +
        'E2E_*_SIFRE ortam değişkenine bu hesabın güncel şifresini yazın.');
    }
  }
  if (sonuc.zorunluDegisim) {
    await page.fill('#mevcutSifre', hesap.ilkSifre);
    await page.fill('#yeniSifre', hesap.sifre);
    await page.fill('#yeniSifreTekrar', hesap.sifre);
    await page.click('#changeSubmit');
    await page.waitForURL(/index\.html/, { timeout: 15_000 });
  }
  await expect(page).toHaveURL(/index\.html/);
}

/** Kaydedilmiş oturum dosyasından API tokenını okur. */
function tokenOku(hesap) {
  const durum = JSON.parse(fs.readFileSync(hesap.durumDosyasi, 'utf8'));
  for (const origin of durum.origins || []) {
    const kayit = (origin.localStorage || []).find((x) => x.name === 'securelab_auth_token');
    if (kayit) return kayit.value;
  }
  throw new Error('Oturum dosyasında token bulunamadı: ' + hesap.durumDosyasi);
}

function yetki(token) {
  return { Authorization: `Bearer ${token}` };
}

/** Sistemin PIN politikasına uyan rastgele 6 haneli şifre üretir. */
function gecerliPinUret() {
  const zayif = new Set(['123123', '121212', '112233', '000000', '654321', '123456', '696969', '101010']);
  for (;;) {
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    const rakamlar = pin.split('').map(Number);
    const hepsiAyni = rakamlar.every((r) => r === rakamlar[0]);
    const artan = rakamlar.every((r, i) => i === 0 || r === rakamlar[i - 1] + 1);
    const azalan = rakamlar.every((r, i) => i === 0 || r === rakamlar[i - 1] - 1);
    if (!hepsiAyni && !artan && !azalan && !zayif.has(pin)) return pin;
  }
}

/** E-postası verilen kullanıcının kaydını yönetici tokenıyla bulur. */
async function kullaniciBul(request, token, eposta) {
  const res = await request.get('/api/kullanicilar', { headers: yetki(token) });
  expect(res.status()).toBe(200);
  const liste = await res.json();
  const kullanici = liste.find((u) => u.eposta === eposta);
  if (!kullanici) throw new Error(`${eposta} kullanıcısı bulunamadı`);
  return kullanici;
}

/** Tokenın sahibi olan kullanıcının kimliğini döndürür (/api/auth/me). */
async function benimId(request, token) {
  const res = await request.get('/api/auth/me', { headers: yetki(token) });
  expect(res.status()).toBe(200);
  const govde = await res.json();
  return String(govde.user.kullaniciId);
}

module.exports = { AUTH_DIR, benimId, HESAPLAR, formlaGiris, hesapIleGiris, tokenOku, yetki, gecerliPinUret, kullaniciBul };
