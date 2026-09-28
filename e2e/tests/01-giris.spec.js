// Giriş ekranı ve oturum koruması (oturum açılmamış kullanıcı).
const { test, expect } = require('@playwright/test');
const { HESAPLAR, formlaGiris } = require('./yardimci');

test.describe('Giriş ekranı', () => {
  test('giriş sayfası logo ve formla açılır', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#eposta')).toBeVisible();
    await expect(page.locator('#pin')).toBeVisible();
    await expect(page.locator('#loginSubmit')).toBeEnabled();
    await expect(page.locator('img[src*="subu-logo"]').first()).toBeVisible();
  });

  test('boş formla giriş yapılamaz', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('#loginSubmit');
    await expect(page.locator('#loginAlert')).toContainText('e-posta ve şifrenizi girin');
    await expect(page).toHaveURL(/login\.html/);
  });

  test('yanlış şifreyle giriş reddedilir', async ({ page }) => {
    const sonuc = await formlaGiris(page, HESAPLAR.yonetici.eposta, 'YanlisSifre-12345');
    expect(sonuc.basarili).toBe(false);
    expect(sonuc.mesaj.length).toBeGreaterThan(0);
    await expect(page).toHaveURL(/login\.html/);
  });

  for (const sayfa of ['index.html', 'admin.html', 'hesabim.html', 'yetkilendirme.html']) {
    test(`oturum yokken ${sayfa} giriş sayfasına yönlendirir`, async ({ page }) => {
      await page.goto('/' + sayfa);
      await expect(page).toHaveURL(/login\.html/);
    });
  }
});
