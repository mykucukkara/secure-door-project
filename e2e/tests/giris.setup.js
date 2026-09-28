// Testlerden önce yönetici ve öğretim elemanı olarak bir kez giriş yapılır,
// oturumlar .auth/ klasörüne kaydedilir. (Giriş uç noktasında 15 dakikada
// 10 deneme sınırı olduğu için her test yeniden giriş yapmaz.)
const fs = require('fs');
const { test: kurulum } = require('@playwright/test');
const { AUTH_DIR, HESAPLAR, hesapIleGiris } = require('./yardimci');

fs.mkdirSync(AUTH_DIR, { recursive: true });

for (const [rol, hesap] of Object.entries(HESAPLAR)) {
  kurulum(`${rol} hesabıyla giriş yapılır`, async ({ page }) => {
    await hesapIleGiris(page, hesap);
    await page.context().storageState({ path: hesap.durumDosyasi });
  });
}
