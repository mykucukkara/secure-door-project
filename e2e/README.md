# SecureLab — Uçtan Uca (E2E) Testler

Bu klasördeki testler çalışan SecureLab sistemini **gerçek bir tarayıcıyla** (Playwright + Chromium) kullanır:
sayfaları açar, forma yazar, düğmelere basar ve sonucu hem ekrandan hem API'den kontrol eder.

## Çalıştırma

Sistem Docker ile çalışıyor olmalı (`docker compose up -d --build`). Bu klasörde (cmd veya PowerShell):

```cmd
npm ci
npx playwright install chromium
npx playwright test
```

İlk iki komut yalnızca ilk seferde gerekir. Tüm projeyi (backend + e2e) tek komutla test etmek için
proje kökünde `scripts\testleri-calistir.cmd`.

| Komut | Ne yapar |
|---|---|
| `npx playwright test` | Tüm testleri arka planda çalıştırır |
| `npx playwright test --headed` | Tarayıcıyı göstererek çalıştırır (izlemek için) |
| `npx playwright test tests/03-yonetici-kapi-sifresi.spec.js` | Tek dosyayı çalıştırır |
| `npx playwright show-report` | Son çalıştırmanın HTML raporunu açar (hatalı testlerin ekran görüntüsü ve kaydıyla) |

## Test dosyaları

| Dosya | Test edilenler |
|---|---|
| `tests/giris.setup.js` | Yönetici ve öğretim elemanı olarak bir kez giriş yapar (ilk girişse zorunlu şifre değişimini tamamlar), oturumu `.auth/` klasörüne kaydeder |
| `tests/01-giris.spec.js` | Giriş sayfası açılır; boş form ve yanlış şifre reddedilir; oturum yokken korumalı sayfalar giriş ekranına yönlendirir |
| `tests/02-api-yetki.spec.js` | Sağlık kontrolü; token olmadan `401`; geçersiz token; yönetici listesinde şifre hash'i dönmez; öğretim elemanı yönetici işlemlerinde `403`; zayıf PIN API'de de reddedilir |
| `tests/03-yonetici-kapi-sifresi.spec.js` | Kullanıcı listesi yüklenir; ardışık ve eşleşmeyen PIN reddedilir; kutuya harf yazılamaz; yönetici belirli ve rastgele kapı şifresi atar, veritabanında değiştiği API ile doğrulanır |
| `tests/04-ogretim-elemani.spec.js` | Öğretim elemanı yönetim sayfasına giremez; profilde kendi kapı şifresini görür ve değiştirir |
| `tests/yardimci.js` | Ortak hesap ayarları, giriş ve API yardımcıları, kurallara uygun rastgele PIN üretici |

## Kullanılan hesaplar

| Rol | Varsayılan e-posta | İlk şifre | Testin belirlediği şifre |
|---|---|---|---|
| Yönetici | `sistem.yonetici@securelab.local` | `SecureLab2026!` | `TestPaneli2026x` |
| Öğretim elemanı | `selmanhizal@subu.edu.tr` | `BmLab-2026!` | `TestHocasi2026x` |

Test önce "testin belirlediği şifre" ile girmeyi dener; olmazsa ilk şifreyle girip şifreyi değiştirir.
Testler bu iki hesabın **web şifresini ve kapı şifresini değiştirir** — kendi kullandığınız hesabı test hesabı yapmayın.

Farklı hesap, şifre veya adres için çalıştırmadan önce ortam değişkeni verin (cmd'de `set`, PowerShell'de `$env:AD="deger"`):

| Değişken | Varsayılan |
|---|---|
| `SECURELAB_URL` | `http://localhost` |
| `E2E_YONETICI_EPOSTA` / `E2E_YONETICI_ILK_SIFRE` / `E2E_YONETICI_SIFRE` | yukarıdaki tablo |
| `E2E_HOCA_EPOSTA` / `E2E_HOCA_ILK_SIFRE` / `E2E_HOCA_SIFRE` | yukarıdaki tablo |

Örnek (cmd): `set E2E_YONETICI_SIFRE=hesabin-guncel-sifresi && npx playwright test`

## Sık karşılaşılan hatalar

- **`Giriş deneme sınırına takıldı`** — giriş 15 dakikada 10 denemeyle sınırlıdır. `docker compose restart backend` ile sıfırlayın.
- **`... ile giriş yapılamadı`** — hesabın şifresi elle değiştirilmiş; `E2E_*_SIFRE` ile güncel şifreyi verin.
- **`net::ERR_CONNECTION_REFUSED`** — sistem çalışmıyor ya da panel farklı portta; `docker compose ps` ve `SECURELAB_URL`.
