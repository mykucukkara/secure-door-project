// Öğretim elemanı (hoca) rolünün panel deneyimi.
const { test, expect } = require('@playwright/test');
const { HESAPLAR, benimId, tokenOku, yetki, gecerliPinUret } = require('./yardimci');

test.use({ storageState: HESAPLAR.hoca.durumDosyasi });

test.describe('Öğretim elemanı paneli', () => {
  test('yönetim sayfasına giremez, ana sayfaya yönlendirilir', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page).toHaveURL(/index\.html/);
  });

  test('profilde kendi kapı şifresini görür', async ({ page, request }) => {
    const token = tokenOku(HESAPLAR.hoca);
    const id = await benimId(request, token);
    const beklenen = (await (await request.get(`/api/kullanicilar/${id}/kapi-sifresi`, { headers: yetki(token) })).json()).pin;

    await page.goto('/hesabim.html');
    await expect(page.locator('#doorPinRevealBtn')).toBeEnabled();
    await expect(page.locator('#doorPinDigits')).not.toContainText(beklenen);  // başta gizli
    await page.click('#doorPinRevealBtn');
    await expect(page.locator('#doorPinDigits')).toHaveText(beklenen.split('').join(''));
  });

  test('profilden kendi kapı şifresini değiştirir', async ({ page, request }) => {
    const pin = gecerliPinUret();
    await page.goto('/hesabim.html');
    await page.fill('#yeniPin', pin);
    await page.fill('#yeniPinTekrar', pin);
    await page.click('#doorPinSubmit');
    await expect(page.locator('#doorPinAlert')).toContainText('güncellendi');

    const token = tokenOku(HESAPLAR.hoca);
    const id = await benimId(request, token);
    const govde = await (await request.get(`/api/kullanicilar/${id}/kapi-sifresi`, { headers: yetki(token) })).json();
    expect(govde.pin).toBe(pin);
    expect(govde.kaynak).toBe('kullanici');
  });
});
