// SecureLab uçtan uca testleri.
// Varsayılan olarak Docker ile çalışan sistemi (http://localhost) test eder.
// Farklı adres için: set SECURELAB_URL=http://localhost:8080  (cmd)
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Testler aynı veritabanını paylaştığı için sırayla çalışır.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.SECURELAB_URL || 'http://localhost',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'tr-TR',
    // Kurulu Chromium yerine özel bir tarayıcı kullanmak için (isteğe bağlı)
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  },
  projects: [
    { name: 'kurulum', testMatch: /giris\.setup\.js/ },
    {
      name: 'testler',
      testMatch: /.*\.spec\.js/,
      dependencies: ['kurulum'],
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
