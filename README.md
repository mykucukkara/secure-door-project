# SecureLab — Laboratuvar Kapı Erişim Kontrol Sistemi

**Sakarya Uygulamalı Bilimler Üniversitesi · Bilgisayar Mühendisliği**

SecureLab, laboratuvar kapısını **RFID kart** ve **kişisel kapı şifresi (6 haneli PIN)** ile yöneten bir erişim kontrol sistemidir.
Kapıdaki ESP32 cihazı kartı/şifreyi okur, backend yetkiyi kontrol eder, kapı açılır ve her deneme kayda geçer.
Öğretim elemanları ve yöneticiler web panelinden erişim geçmişini, kartları ve kapı şifrelerini yönetir.

---

## İçindekiler

1. [Sistem nasıl çalışır?](#1-sistem-nasıl-çalışır)
2. [Klasör yapısı](#2-klasör-yapısı)
3. [Kurulum ve çalıştırma](#3-kurulum-ve-çalıştırma)
4. [Hesaplar ve ilk şifreler](#4-hesaplar-ve-ilk-şifreler)
5. [Roller ve yetkiler](#5-roller-ve-yetkiler)
6. [Web paneli sayfaları](#6-web-paneli-sayfaları)
7. [Kapı şifresi (PIN) kuralları](#7-kapı-şifresi-pin-kuralları)
8. [Kart kayıt istasyonu ve kart yetkilendirme](#8-kart-kayıt-istasyonu-ve-kart-yetkilendirme)
9. [ESP32 kapı cihazı](#9-esp32-kapı-cihazı)
10. [Testler](#10-testler)
11. [Ortam değişkenleri (.env)](#11-ortam-değişkenleri-env)
12. [Günlük komutlar](#12-günlük-komutlar)
13. [Sorun giderme](#13-sorun-giderme)
14. [GitHub'a yükleme ve sunucuya kurulum](#14-githuba-yükleme-ve-sunucuya-kurulum)
15. [Güvenlik notları](#15-güvenlik-notları)

---

## 1. Sistem nasıl çalışır?

```text
 ┌────────────────┐   MQTT (1883)   ┌───────────────┐   HTTP /api   ┌──────────────────┐
 │ ESP32 kapı     │ ◄─────────────► │   Backend     │ ◄───────────► │ Web paneli       │
 │ RC522 + tuş    │                 │ Node.js       │               │ Nginx (port 80)  │
 │ takımı + röle  │                 │ Express+Prisma│               │ tarayıcı         │
 └────────────────┘                 └──────┬────────┘               └────────┬─────────┘
                                           │                                 │ Web Serial (USB)
                                    ┌──────┴────────┐               ┌────────┴─────────┐
                                    │ PostgreSQL 16 │               │ Kart kayıt       │
                                    └───────────────┘               │ istasyonu (ESP32)│
                                                                    └──────────────────┘
```

| Bileşen | Görevi | Docker servisi |
|---|---|---|
| **Web paneli** | Giriş, kullanıcı yönetimi, kart yetkilendirme, erişim geçmişi, profil | `frontend` (Nginx, port 80) |
| **Backend API** | Kimlik doğrulama, yetki kararı, kapı şifreleri, kayıtlar, MQTT | `backend` (port 3000) |
| **Veritabanı** | Kullanıcılar, kartlar, kapılar, cihazlar, erişim/denetim kayıtları | `db` (PostgreSQL 16, port 5432) |
| **MQTT broker** | Kapı cihazlarıyla anlık haberleşme | `mqtt` (Mosquitto, port 1883) |
| **QR arıza formu** | Öğrencilerin girişsiz arıza bildirdiği sayfa | `public-form`, `qr-tunnel` |

**Kapıda giriş akışı:** kart okutulur ya da şifre girilir → ESP32 MQTT ile backend'e sorar → backend kartın/şifrenin
sahibini ve yetkisini kontrol eder → izin varsa röle kapıyı açar → sonuç `Erişim Geçmişi`ne yazılır.
Tanınmayan kart yöneticinin onayına düşer. Ağ koptuğunda cihaz, backend'in gönderdiği çevrimdışı listeyle çalışmaya devam eder.

---

## 2. Klasör yapısı

| Klasör | İçerik |
|---|---|
| `backend/` | Node.js 22 + Express + Prisma 7 API, MQTT servisi, zamanlanmış görevler, Jest testleri (`src/tests/`) |
| `backend/prisma/` | Veritabanı şeması, migration'lar, başlangıç verisi (`seed.js`) |
| `frontend/` | Web paneli (HTML + `assets/js` + `assets/css`), Nginx ayarları |
| `esp32-kodlar/` | Kapı cihazı yazılımı (RC522, 4x4 tuş takımı, röle, LCD, manyetik sensör, buzzer) — PlatformIO |
| `kart-kayit-istasyonu/` | Masa üstü kart okuyucu (ESP32 + RC522), UID'yi USB seri porta yazar — [README](kart-kayit-istasyonu/README.md) |
| `e2e/` | Tarayıcı ile uçtan uca testler (Playwright) — [README](e2e/README.md) |
| `mosquitto/` | MQTT broker ayarı |
| `scripts/` | `testleri-calistir.cmd` (tüm testler), `veritabani-sifirla.ps1` (veritabanını sıfırdan kurma) |
| `docs/` | [Proje rehberi](docs/PROJE_REHBERI.md), [donanım şeması](docs/donanim-baglanti-semasi.md), [MQTT konuları](docs/mqtt-topicleri.md), [OTA](docs/ota-guncelleme.md), [API örnekleri](docs/api-ornekleri.md) |

> `frontend/script.js` eski sürümden kalmıştır ve hiçbir sayfa tarafından yüklenmez. Sayfa kodları `frontend/assets/js/` içindedir.

---

## 3. Kurulum ve çalıştırma

### Gerekenler

- **Docker Desktop** (açık ve çalışır durumda olmalı)
- **Git**
- Testler için **Node.js 22+** (yalnızca `e2e` testlerini çalıştırırken)
- ESP32 için **VS Code + PlatformIO** eklentisi

### İlk kurulum

Windows'ta **cmd (Komut İstemi)** ya da **PowerShell** açın:

```cmd
cd C:\Users\<kullanici>\Documents\VSCode-files\secureDoor\secure-door-project
copy .env.example .env
docker compose up -d --build
```

PowerShell'de `copy` yerine `Copy-Item .env.example .env` de kullanılabilir. `.env` zaten varsa bu adımı atlayın.

İlk açılışta backend migration'ları uygular ve [başlangıç hesaplarını](#4-hesaplar-ve-ilk-şifreler) oluşturur.
Hazır olduğunu görmek için:

```cmd
docker compose logs -f --tail 40 backend
```

`Oluşturulan hesaplar (20)` ve `Backend sunucusu 3000 portunda başlatıldı` satırlarını görünce `Ctrl+C` ile log izlemeyi bırakın
(sistem arka planda çalışmaya devam eder) ve tarayıcıda **http://localhost** adresini açın.

### Veritabanını sıfırdan kurma (tüm kayıtlar silinir)

cmd:

```cmd
docker compose down -v && docker compose up -d --build && docker compose logs -f --tail 40 backend
```

PowerShell (onay soran betik):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\veritabani-sifirla.ps1
```

> **cmd ile PowerShell farkı:** cmd'de komutlar `&&` ile, PowerShell'de `;` ile art arda yazılır.
> cmd'de `;` kullanırsanız `unknown shorthand flag: ';'` hatası alırsınız.

### Kod değişikliğinden sonra

| Değişen yer | Komut |
|---|---|
| `backend/src` | `docker compose restart backend` (kod klasörü konteynere bağlıdır) |
| `frontend/` | `docker compose up -d --build frontend`, ardından tarayıcıda `Ctrl+F5` |
| `backend/package.json`, Dockerfile, migration | `docker compose up -d --build` |

### Adresler

| Servis | Adres |
|---|---|
| Web paneli | http://localhost (`FRONTEND_PORT` ile değiştirilebilir) |
| Backend API | http://localhost:3000 — sağlık kontrolü: http://localhost:3000/api/health |
| PostgreSQL | `localhost:5432` |
| MQTT | `localhost:1883` |

---

## 4. Hesaplar ve ilk şifreler

Veritabanı **boşken** ilk açılışta aşağıdaki 20 hesap otomatik oluşturulur. Kadro bilgisi
[bm.subu.edu.tr akademik kadro](https://bm.subu.edu.tr/tr/akademik-kadro) sayfasından alınmıştır
(yedek liste: `backend/src/data/bmAkademikKadro.js`).

**Herkes ilk girişte kendi şifresini belirlemek zorundadır.** Aşağıdaki şifreler yalnızca ilk giriş içindir;
şifre değiştirildikten sonra geçersizdir. Değerler `.env` içindeki `SEED_ADMIN_PASSWORD` ve `SEED_HOCA_PASSWORD`
ile değiştirilebilir (tabloda geliştirme varsayılanları yazılıdır).

### Yöneticiler

| Ad Soyad | E-posta | İlk şifre |
|---|---|---|
| Sistem Yöneticisi (sistem hesabı, temsili e-posta) | `sistem.yonetici@securelab.local` | `SecureLab2026!` |
| Prof. Dr. Halit Öztekin (bölüm başkanı) | `halitoztekin@subu.edu.tr` | `BmLab-2026!` |

### Öğretim elemanları — ilk şifre hepsi için `BmLab-2026!`

| Unvan | Ad Soyad | E-posta |
|---|---|---|
| Doç. Dr. | Caner Erden | `cerden@subu.edu.tr` |
| Doç. Dr. | Ekin Ekinci | `ekinekinci@subu.edu.tr` |
| Doç. Dr. | Selman Hızal | `selmanhizal@subu.edu.tr` |
| Doç. Dr. | Süleyman Uzun | `suleymanuzun@subu.edu.tr` |
| Doç. Dr. | Zafer Albayrak | `zaferalbayrak@subu.edu.tr` |
| Doç. Dr. | Zeynep Garip | `zbatik@subu.edu.tr` |
| Dr. Öğr. Üyesi | Ahmet Kala | `ahmetkala@subu.edu.tr` |
| Dr. Öğr. Üyesi | Emin Güney | `eminguney@subu.edu.tr` |
| Dr. Öğr. Üyesi | Fatih Varçın | `fatihvarcin@subu.edu.tr` |
| Dr. Öğr. Üyesi | Muhammed Ali Nur Öz | `muhammedoz@subu.edu.tr` |
| Dr. Öğr. Üyesi | Muhammed Telçeken | `muhammedtelceken@subu.edu.tr` |
| Dr. Öğr. Üyesi | A.F.M. Suaib Akhter | `suaibakhter@subu.edu.tr` |
| Arş. Gör. Dr. | Muhammed Yusuf Küçükkara | `muhammedkucukkara@subu.edu.tr` |
| Arş. Gör. | Furkan Atban | `furkanatban@subu.edu.tr` |
| Arş. Gör. | İsmail Ergün | `ismailergun@subu.edu.tr` |
| Arş. Gör. | Semih Özenç | `semihozenc@subu.edu.tr` |
| Arş. Gör. | Yavuz Selim Bozan | `ysbozan@subu.edu.tr` |
| Arş. Gör. | Muhammed Bilâl Kamburoğlu | `mbk@subu.edu.tr` |

### Hesap ekleme ve şifre sıfırlama

Yönetici şifreleri unutulduysa (yalnızca geliştirme ortamında) `scripts\sifre-sifirla.cmd` iki yönetici hesabını
yukarıdaki ilk şifrelere döndürür ve zorunlu değişimi kaldırır.

- **Kadroya sonradan katılanlar:** yönetici panelde **Kullanıcı Ekle** sayfasını açar; bölüm sitesinde olup
  SecureLab hesabı olmayanlar listelenir. **Hesap Oluştur** geçici bir şifre üretip kişinin `@subu.edu.tr` adresine gönderir
  (SMTP ayarlı değilse şifre yöneticiye bir kez ekranda gösterilir). Geçici şifre 72 saat geçerlidir.
  Komutla toplu ekleme: `docker compose exec backend npm run import:academic-staff`
- **Şifresini unutan:** giriş ekranında **Şifremi unuttum** (SMTP gerekir) ya da yönetici **Kullanıcılar** sayfasında
  zarf simgesiyle **Yeni geçici şifre gönder**.
- Yalnızca `@subu.edu.tr` adresleriyle hesap açılabilir (`IZINLI_EPOSTA_ALANLARI`).

---

## 5. Roller ve yetkiler

| İşlem | Yönetici | Öğretim elemanı |
|---|:-:|:-:|
| Panele giriş, anasayfa, erişim geçmişi, arıza kayıtları | ✓ | ✓ |
| Kendi kapı şifresini görme ve değiştirme (Profilim) | ✓ | ✓ |
| Kullanıcı ekleme, düzenleme, silme / pasife alma | ✓ | — |
| Başka bir kullanıcının kapı şifresini değiştirme | ✓ | — |
| Yeni geçici web şifresi gönderme | ✓ | — |
| Kart yetkilendirme, bekleyen kartları onaylama | ✓ | — |
| Yönetici yetkisi verme / kaldırma | ✓ | — |

Kurallar: birden fazla yönetici olabilir; **son aktif yönetici silinemez**, kimse **kendi** rolünü veya durumunu değiştiremez.
Rol, durum veya şifre değiştiğinde kişinin açık oturumları kapanır. Yetkiler sunucu tarafında kontrol edilir
(öğretim elemanı yönetici API'lerini çağırırsa `403` alır).

---

## 6. Web paneli sayfaları

| Menü | Sayfa | Açıklama |
|---|---|---|
| Anasayfa | `index.html` | Özet: kullanıcı, kapı ve cihaz sayıları, izin verilen/reddedilen erişimler, son erişimler |
| Kullanıcılar | `admin.html` | Arama/filtre, düzenleme, geçici şifre gönderme, **kapı şifresini değiştirme** (anahtar simgesi), silme |
| Kullanıcı Ekle | `kullanici-ekle.html` | Bölüm sitesinde olup hesabı olmayanlar; geçici şifreyle hesap açma |
| Kart Yetkilendirme | `yetkilendirme.html` | UID gir veya istasyondan okut → sahibini seç → yetkilendir; onay bekleyen kartlar |
| Erişim Geçmişi | `gecmis-girisler.html` | Tüm giriş denemeleri (kart/şifre/uzaktan, izin/red) |
| Arıza Kayıtları | `ariza-gecmisi.html` | QR formundan gelen arıza bildirimleri |
| QR Kod | `qr-kod.html` | Arıza formunun QR kodu |
| Profilim | `hesabim.html` | Kişisel bilgiler, kapı şifresini görme/değiştirme, şifre geçmişi |
| — | `login.html`, `sifre-degistir.html`, `sifre-sifirla.html` | Giriş, ilk girişte zorunlu şifre değişimi, şifre sıfırlama |

**Yönetici başkasının kapı şifresini nasıl değiştirir?** Kullanıcılar → kişinin satırındaki **anahtar** simgesi →
6 haneli yeni şifreyi iki kez yazıp **Şifreyi Kaydet** ya da **Rastgele Oluştur**. Yeni şifre bir kez gösterilir;
eski şifre o anda geçersiz olur ve kapı cihazlarına iletilir. Kişi yeni şifresini kendi Profilim sayfasından da görebilir.

---

## 7. Kapı şifresi (PIN) kuralları

- Tam olarak **6 rakam**.
- `111111` gibi tekrar eden, `123456` / `654321` gibi ardışık ve kolay tahmin edilen şifreler kabul edilmez.
- Başka bir kullanıcının şifresiyle aynı olamaz.
- **Süresi dolmaz**; yalnızca kişi kendisi ya da yönetici değiştirdiğinde değişir
  (eski "her gece yeni şifre" davranışı için `.env` → `PIN_OTOMATIK_YENILEME=true`).
- Kapı şifresi ile web paneli şifresi **ayrıdır**; kapı şifresiyle panele giriş yapılamaz.
- Veritabanında argon2 hash + AES-256-GCM ile şifrelenmiş kopya olarak saklanır.

Web şifresi kuralları: en az 10 karakter, büyük harf, küçük harf ve rakam içerir, ad/soyad/e-posta içermez.

---

## 8. Kart kayıt istasyonu ve kart yetkilendirme

1. `kart-kayit-istasyonu/` klasörünü PlatformIO ile ESP32'ye yükleyin:
   ```cmd
   cd kart-kayit-istasyonu
   pio run -t upload
   pio device monitor
   ```
   Kart okutunca UID seri ekranda görünür (`UID:04:A1:B2:C3`).
2. Seri monitörü kapatın (COM portunu aynı anda tek program kullanabilir).
3. Panelde **Kart Yetkilendirme** → **İstasyona Bağlan** → COM portunu seçin (Chrome/Edge gerekir) → kartı okutun
   ya da UID'yi elle yazın → kartın sahibini ad-soyad listesinden seçin → **Kartı Yetkilendir**.

Bağlantı şeması ve seri çıktı örneği: [kart-kayit-istasyonu/README.md](kart-kayit-istasyonu/README.md).
Kapıda okutulan tanınmayan kartlar da bu sayfada **onay bekleyen kartlar** listesine düşer.

---

## 9. ESP32 kapı cihazı

1. `esp32-kodlar/include/config.local.example.h` dosyasını `config.local.h` adıyla kopyalayın.
2. Wi-Fi, MQTT sunucu adresi (bilgisayarın/sunucunun IP'si), cihaz/kapı kimlikleri ve pinleri düzenleyin.
3. Cihazdaki `ESP32_SECRET_KEY` değeri `.env` içindeki `ESP32_SECRET_KEY` ile aynı olmalıdır.
4. `esp32-kodlar` klasörünü PlatformIO ile derleyip yükleyin: `pio run -t upload`.

`config.local.h` gizli bilgi içerdiği için Git tarafından izlenmez. Ayrıntılar: [docs/PROJE_REHBERI.md](docs/PROJE_REHBERI.md),
[docs/donanim-baglanti-semasi.md](docs/donanim-baglanti-semasi.md), [docs/mqtt-topicleri.md](docs/mqtt-topicleri.md),
uzaktan güncelleme için [docs/ota-guncelleme.md](docs/ota-guncelleme.md).

Donanım bağlı değilken backend'i yerelde (Docker dışında) çalıştırıyorsanız `backend/.env` içinde `MQTT_ENABLED=false`
MQTT bağlantı denemelerini kapatır.

---

## 10. Testler

Sistem `docker compose up -d --build` ile çalışırken proje klasöründe (cmd veya PowerShell):

```cmd
scripts\testleri-calistir.cmd
```

Betik iki aşamayı sırayla çalıştırır ve sonunda `SONUC: Tum testler gecti` ya da hangi aşamanın başarısız olduğunu yazar.

| Aşama | Ne test eder | Nerede |
|---|---|---|
| **1. Backend (Jest, 92 test)** | Kapı şifresi politikası, giriş, zorunlu şifre değişimi, kullanıcı/kapı/cihaz CRUD, rol yetkileri, akademik kadro okuma — gerçek PostgreSQL ile | `backend/src/tests/` |
| **2. Uçtan uca (Playwright, 27 test)** | Gerçek tarayıcıyla giriş ekranı, oturum koruması, API yetkileri (401/403), yöneticinin başkasının kapı şifresini değiştirmesi, öğretim elemanının profil sayfası | `e2e/tests/` |

Aşamaları ayrı ayrı çalıştırmak:

```cmd
docker compose exec -e NODE_ENV=test -e ALLOW_DEV_PASSWORD_RESET=true backend npm test
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

Uçtan uca testlerin kullandığı hesaplar, ortam değişkenleri ve raporlar: [e2e/README.md](e2e/README.md).

> Backend testleri çalıştığı veritabanına test kayıtları ekler; uçtan uca testler de iki test hesabının
> şifrelerini değiştirir. Testleri **geliştirme** ortamında çalıştırın, gerçek kullanımdaki sunucuda çalıştırmayın.

---

## 11. Ortam değişkenleri (.env)

`.env.example` dosyasını `.env` olarak kopyalayıp düzenleyin. `.env` Git'e **yüklenmez**.

| Değişken | Açıklama |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL` | Veritabanı bağlantısı (Docker içinde host `db`) |
| `FRONTEND_PORT`, `BACKEND_PORT` | Panel (varsayılan 80) ve API (3000) portları |
| `JWT_SECRET` | Web oturum tokenlarının imza anahtarı |
| `PIN_HISTORY_ENCRYPTION_KEY` | Kapı şifresi geçmişinin şifreleme anahtarı |
| `ESP32_SECRET_KEY` | Kapı cihazlarının kimlik doğrulama anahtarı |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Sistem yöneticisi hesabı ve ilk şifresi |
| `SEED_BOLUM_BASKANI_EPOSTA` | Yönetici olarak açılan bölüm başkanı |
| `SEED_HOCA_PASSWORD` | Kadro hesaplarının ilk şifresi |
| `IZINLI_EPOSTA_ALANLARI` | Hesap açılabilecek e-posta alan adları (`subu.edu.tr`) |
| `GECICI_SIFRE_GECERLILIK_SAAT` | Geçici şifre süresi (72) |
| `AKADEMIK_KADRO_URL` | Kullanıcı Ekle sayfasının karşılaştırdığı bölüm kadro sayfası |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `APP_BASE_URL` | Geçici şifre ve şifre sıfırlama e-postaları |
| `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | MQTT broker bağlantısı |
| `PIN_OTOMATIK_YENILEME` | `true` ise kapı şifreleri her gece yenilenir (varsayılan `false`) |
| `PUBLIC_ISSUE_URL` | Telefonların açacağı QR arıza formu adresi (`localhost` telefondan açılmaz) |
| `FIRMWARE_PUBLIC_BASE_URL`, `OTA_SIGNING_SECRET` | ESP32 uzaktan güncelleme |

`NODE_ENV=production` iken varsayılan/zayıf `SEED_*`, `JWT_SECRET` gibi değerlerle backend açılmaz.

---

## 12. Günlük komutlar

```cmd
docker compose ps                       & REM servislerin durumu
docker compose logs -f backend          & REM backend logları (Ctrl+C ile çık)
docker compose restart backend          & REM backend'i yeniden başlat
docker compose down                     & REM sistemi durdur (veriler korunur)
docker compose up -d                    & REM sistemi yeniden başlat
```

Veritabanı yedeği (değerleri kendi `.env` ayarlarınıza göre yazın):

```cmd
docker compose exec -T db pg_dump -U kapi_user kapi_sistemi_db > securelab-yedek.sql
```

---

## 13. Sorun giderme

| Belirti | Çözüm |
|---|---|
| `unknown shorthand flag: ';'` | cmd kullanıyorsunuz; komutları `&&` ile birleştirin ya da PowerShell açın |
| http://localhost açılmıyor | `docker compose ps` ile servislere bakın; 80 portu doluysa `.env` → `FRONTEND_PORT=8080` |
| Başlangıç şifresiyle giriş olmuyor | Hesaplar yalnızca boş veritabanında oluşur; eski veritabanı duruyorsa [sıfırdan kurun](#veritabanını-sıfırdan-kurma-tüm-kayıtlar-silinir) ya da şifre zaten değiştirilmiştir |
| `Çok fazla deneme yapıldı` | Giriş 15 dakikada 10 denemeyle sınırlıdır; bekleyin ya da `docker compose restart backend` |
| Frontend değişikliği görünmüyor | `docker compose up -d --build frontend`, ardından `Ctrl+F5` |
| İstasyona bağlanılamıyor | Seri monitörü kapatın; Chrome/Edge kullanın; sayfayı `http://localhost` üzerinden açın |
| Backend açılmıyor | `docker compose logs backend` çıktısındaki ilk hatayı okuyun (çoğunlukla `.env` veya migration) |

Daha fazlası: [docs/PROJE_REHBERI.md — Sorun giderme](docs/PROJE_REHBERI.md#25-sorun-giderme).

---

## 14. GitHub'a yükleme ve sunucuya kurulum

### Bilgisayardan GitHub'a yükleme

```cmd
git status
git add -A
git commit -m "Yapılan değişikliğin kısa açıklaması"
git push origin main
```

`git add -A` öncesi `git status` çıktısında `.env`, `config.local.h`, `node_modules` veya `.zip` dosyası görünmemelidir
(hepsi `.gitignore` ile dışarıda tutulur).

### Sunucuya ilk kurulum (Linux)

Sunucuda Git ve Docker (Compose eklentisiyle) kurulu olmalıdır: `git --version`, `docker compose version`.

```bash
git clone https://github.com/rumeysakolip/secure-door-project.git
cd secure-door-project
cp .env.example .env
nano .env
```

Depo gizliyse `git clone` kullanıcı adı ve şifre yerine GitHub **Personal Access Token** ister.

`.env` içinde gerçek kullanım için en az şunları değiştirin:

| Değişken | Değer |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOW_DEV_PASSWORD_RESET` | `false` |
| `JWT_SECRET`, `PIN_HISTORY_ENCRYPTION_KEY`, `OTA_SIGNING_SECRET`, `ESP32_SECRET_KEY` | Her biri için ayrı `openssl rand -hex 32` çıktısı |
| `POSTGRES_PASSWORD` (ve `DATABASE_URL` içindeki şifre) | Güçlü, benzersiz bir şifre |
| `SEED_ADMIN_PASSWORD`, `SEED_HOCA_PASSWORD` | Güçlü ilk giriş şifreleri |
| `PUBLIC_ISSUE_URL`, `FIRMWARE_PUBLIC_BASE_URL`, `APP_BASE_URL` | Sunucunun adresi (ör. `http://10.9.2.50`) |

Üretimde zayıf/varsayılan değer kalırsa backend açılmaz; hatayı `docker compose logs backend` gösterir.

```bash
docker compose up -d --build
docker compose logs -f --tail 40 backend
```

`Backend sunucusu 3000 portunda başlatıldı` satırını görünce `Ctrl+C` ile çıkın. Panel: `http://<sunucu-ip>`.

### Sunucuda yeni sürüme geçme

```bash
cd secure-door-project
docker compose exec -T db pg_dump -U kapi_user kapi_sistemi_db > yedek-$(date +%F).sql
git pull origin main
docker compose up -d --build
```

Veriler `postgres_data` biriminde kalır; migration'lar backend açılırken uygulanır.

> Sunucuda `scripts/testleri-calistir.cmd` ve `scripts/sifre-sifirla.cmd` **çalıştırmayın**; ikisi de hesap şifrelerini değiştirir.

---

## 15. Güvenlik notları

- Bu depodaki başlangıç şifreleri **yalnızca geliştirme ve ilk giriş** içindir. Gerçek kullanımda `.env` içinde
  `SEED_ADMIN_PASSWORD`, `SEED_HOCA_PASSWORD`, `JWT_SECRET`, `PIN_HISTORY_ENCRYPTION_KEY`, `ESP32_SECRET_KEY`,
  `OTA_SIGNING_SECRET` değerlerini uzun ve rastgele değerlerle değiştirin.
- `.env` ve `esp32-kodlar/include/config.local.h` Git'e yüklenmez; bu dosyaları paylaşmayın.
- Kapı cihazları web tokenı yerine `X-Device-Key` başlığıyla doğrulanır.
- Yönetici işlemleri (kapı şifresi görüntüleme/değiştirme, kullanıcı silme vb.) denetim kaydına yazılır.

Lisans: [LICENSE](LICENSE)
