// API güvenlik kontrolleri: kimlik doğrulama ve rol yetkileri.
const { test, expect } = require('@playwright/test');
const { HESAPLAR, benimId, tokenOku, yetki, kullaniciBul, gecerliPinUret } = require('./yardimci');

test.describe('API yetkileri', () => {
  let yoneticiToken;
  let hocaToken;
  let hocaId;

  test.beforeAll(async ({ request }) => {
    yoneticiToken = tokenOku(HESAPLAR.yonetici);
    hocaToken = tokenOku(HESAPLAR.hoca);
    hocaId = await benimId(request, hocaToken);
  });

  test('sağlık uç noktası çalışır', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe('OK');
  });

  test('token olmadan kullanıcı listesi alınamaz (401)', async ({ request }) => {
    const res = await request.get('/api/kullanicilar');
    expect(res.status()).toBe(401);
  });

  test('geçersiz tokenla istek reddedilir', async ({ request }) => {
    const res = await request.get('/api/kullanicilar', { headers: yetki('gecersiz.token.degeri') });
    expect([401, 403]).toContain(res.status());
  });

  test('yönetici kullanıcı listesini alır ve şifre hash’i dönmez', async ({ request }) => {
    const res = await request.get('/api/kullanicilar', { headers: yetki(yoneticiToken) });
    expect(res.status()).toBe(200);
    const liste = await res.json();
    expect(liste.length).toBeGreaterThan(1);
    const govde = JSON.stringify(liste);
    expect(govde).not.toContain('pinHash');
    expect(govde).not.toContain('webSifreHash');
    expect(govde).not.toMatch(/\$argon2/);
  });

  test('öğretim elemanı kullanıcı listesini alamaz (403)', async ({ request }) => {
    const res = await request.get('/api/kullanicilar', { headers: yetki(hocaToken) });
    expect(res.status()).toBe(403);
  });

  test('öğretim elemanı kendi kapı şifresini görebilir', async ({ request }) => {
    const res = await request.get(`/api/kullanicilar/${hocaId}/kapi-sifresi`, { headers: yetki(hocaToken) });
    expect(res.status()).toBe(200);
    const govde = await res.json();
    expect(govde.kalici).toBe(true);
    expect(govde.pin).toMatch(/^\d{6}$/);
  });

  test('öğretim elemanı başkasının kapı şifresini göremez ve değiştiremez (403)', async ({ request }) => {
    const yonetici = await kullaniciBul(request, yoneticiToken, HESAPLAR.yonetici.eposta);
    const bak = await request.get(`/api/kullanicilar/${yonetici.kullaniciId}/kapi-sifresi`, { headers: yetki(hocaToken) });
    expect(bak.status()).toBe(403);
    const pin = gecerliPinUret();
    const degistir = await request.put(`/api/kullanicilar/${yonetici.kullaniciId}/kapi-sifresi`, {
      headers: yetki(hocaToken), data: { pin, pinTekrar: pin }
    });
    expect(degistir.status()).toBe(403);
  });

  test('öğretim elemanı kullanıcı silemez (403)', async ({ request }) => {
    const yonetici = await kullaniciBul(request, yoneticiToken, HESAPLAR.yonetici.eposta);
    const res = await request.delete(`/api/kullanicilar/${yonetici.kullaniciId}`, { headers: yetki(hocaToken) });
    expect(res.status()).toBe(403);
  });

  test('zayıf kapı şifresi API tarafından da reddedilir (400)', async ({ request }) => {
    const res = await request.put(`/api/kullanicilar/${hocaId}/kapi-sifresi`, {
      headers: yetki(hocaToken), data: { pin: '111111', pinTekrar: '111111' }
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).hata).toContain('Aynı rakamın');
  });
});
