// Yönetici panelinden başka bir kullanıcının kapı şifresini değiştirme.
const { test, expect } = require('@playwright/test');
const { HESAPLAR, tokenOku, yetki, kullaniciBul, gecerliPinUret } = require('./yardimci');

test.use({ storageState: HESAPLAR.yonetici.durumDosyasi });

async function pinPenceresiniAc(page, eposta) {
  await page.goto('/admin.html');
  const satir = page.locator('tr', { hasText: eposta });
  await expect(satir).toBeVisible();
  await satir.locator('[data-action="pin"]').click();
  await expect(page.locator('#adminYeniPin')).toBeVisible();
}

test.describe('Yönetici: kullanıcı yönetimi', () => {
  test('kullanıcı listesi yüklenir', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page.locator('#usersTableContainer table tbody tr').first()).toBeVisible();
    await expect(page.locator('#usersTableContainer')).toContainText(HESAPLAR.hoca.eposta);
    await expect(page.locator('#usersTableContainer')).toContainText(HESAPLAR.yonetici.eposta);
  });

  test('ardışık kapı şifresi reddedilir', async ({ page }) => {
    await pinPenceresiniAc(page, HESAPLAR.hoca.eposta);
    await page.fill('#adminYeniPin', '123456');
    await page.fill('#adminYeniPinTekrar', '123456');
    await page.click('#pinEditSubmit');
    await expect(page.locator('#pinEditAlert')).toContainText('Ardışık');
  });

  test('eşleşmeyen şifre tekrarı kaydedilmez', async ({ page }) => {
    await pinPenceresiniAc(page, HESAPLAR.hoca.eposta);
    await page.fill('#adminYeniPin', '582047');
    await page.fill('#adminYeniPinTekrar', '582048');
    await page.click('#pinEditSubmit');
    await expect(page.locator('#pinEditAlert')).toContainText('eşleşmiyor');
  });

  test('rakam dışı karakterler kutuya yazılamaz', async ({ page }) => {
    await pinPenceresiniAc(page, HESAPLAR.hoca.eposta);
    await page.fill('#adminYeniPin', '');
    await page.locator('#adminYeniPin').pressSequentially('12ab34cd56');
    await expect(page.locator('#adminYeniPin')).toHaveValue('123456');
  });

  test('yönetici öğretim elemanına yeni kapı şifresi belirler', async ({ page, request }) => {
    const pin = gecerliPinUret();
    await pinPenceresiniAc(page, HESAPLAR.hoca.eposta);
    await page.fill('#adminYeniPin', pin);
    await page.fill('#adminYeniPinTekrar', pin);
    await page.click('#pinEditSubmit');

    await expect(page.locator('#pinRevealValue')).toHaveText(pin);
    await expect(page.locator('#pinRevealValidity')).toHaveText('Süresiz');

    // Veritabanında gerçekten değiştiğini API ile doğrula.
    const token = tokenOku(HESAPLAR.yonetici);
    const hoca = await kullaniciBul(request, token, HESAPLAR.hoca.eposta);
    const res = await request.get(`/api/kullanicilar/${hoca.kullaniciId}/kapi-sifresi`, { headers: yetki(token) });
    const govde = await res.json();
    expect(govde.pin).toBe(pin);
    expect(govde.kaynak).toBe('yonetici');
  });

  test('yönetici rastgele kapı şifresi oluşturur', async ({ page, request }) => {
    const token = tokenOku(HESAPLAR.yonetici);
    const hoca = await kullaniciBul(request, token, HESAPLAR.hoca.eposta);
    const onceki = (await (await request.get(`/api/kullanicilar/${hoca.kullaniciId}/kapi-sifresi`, { headers: yetki(token) })).json()).pin;

    await pinPenceresiniAc(page, HESAPLAR.hoca.eposta);
    page.once('dialog', (d) => d.accept());
    await page.click('#pinEditRandomBtn');

    await expect(page.locator('#pinRevealValue')).toHaveText(/^\d{6}$/);
    const yeni = (await page.locator('#pinRevealValue').innerText()).trim();
    expect(yeni).not.toBe(onceki);
    const sonra = (await (await request.get(`/api/kullanicilar/${hoca.kullaniciId}/kapi-sifresi`, { headers: yetki(token) })).json()).pin;
    expect(sonra).toBe(yeni);
  });
});
