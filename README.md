# SecureLab — Kapı Erişim Kontrol Sistemi

**Sakarya Uygulamalı Bilimler Üniversitesi · Bilgisayar Mühendisliği**

RFID kart ve kişisel kapı şifresiyle çalışan laboratuvar kapı erişim sistemi.
Kapı cihazları (ESP32), kart kayıt istasyonu, web paneli ve backend tek depoda bulunur.

| Klasör | İçerik |
|---|---|
| `backend/` | Node.js + Express + Prisma (PostgreSQL) API, MQTT servisi |
| `frontend/` | Web paneli (Nginx ile sunulur, SUBÜ kurumsal görünümü) |
| `esp32-kodlar/` | Kapı cihazı yazılımı (RC522, tuş takımı, röle, LCD, MQTT) |
| `kart-kayit-istasyonu/` | **Yeni** — ESP32 + RC522 kart kayıt istasyonu (UID'yi seri ekrana yazar) |
| `mosquitto/` | MQTT broker ayarları |
| `docs/` | Proje rehberi, MQTT konuları, OTA, API örnekleri |

## Bu sürümdeki değişiklikler (27 Eylül 2026)

- **Gerçek hesaplar:** Veritabanı ilk kez kurulurken SUBÜ Bilgisayar Mühendisliği akademik kadrosunun
  (bm.subu.edu.tr) tamamı için hesap açılır. **Bölüm başkanı yönetici**dir; ayrıca sistemin kendi yönetici
  hesabı (şimdilik temsili e-posta) vardır. Sistemde birden fazla yönetici olabilir; son aktif yönetici silinemez,
  kimse kendi yetkisini kaldıramaz.
- **İlk girişte zorunlu şifre değişimi:** Geçici/başlangıç şifresiyle giren kullanıcı kendi şifresini belirlemeden
  panelin hiçbir bölümünü kullanamaz (sunucu tarafında zorlanır). Geçici şifreler 72 saat geçerlidir.
- **Yeni Kullanıcı Ekle sayfası:** Bölüm sitesinde görünen ama SecureLab hesabı olmayan öğretim elemanları listelenir.
  **Hesap Oluştur** ile sunucu tahmin edilemez bir geçici şifre üretip kişinin kurumsal e-postasına gönderir.
  SMTP tanımlı değilse şifre yöneticiye yalnızca bir kez gösterilir. Yalnızca `@subu.edu.tr` adresleri kabul edilir.
- **Kart Yetkilendirme:** Kart ID (UID) girilir, kartın sahibi ad-soyad listesinden seçilir, yetkilendirilir.
  Kart kayıt istasyonu USB ile bağlıysa UID kendiliğinden gelir. Onay bekleyen kartlar aynı sayfadadır.
- **Kalıcı kapı şifresi:** Her kullanıcının tek bir kapı şifresi vardır, değişmez; Profilim sayfasından görülür.
- **Güvenlik:** Güçlü şifre politikası (10+ karakter, büyük/küçük harf, rakam, kişisel bilgi içermez),
  kapı PIN'i ile web girişi kapatıldı, e-posta numaralandırmaya karşı sabit süreli giriş, şifre/rol/durum
  değişikliğinde tüm oturumların kapanması, satır içi betik/stil kaldırılarak İçerik Güvenlik Politikası'na uyum.
- **Giriş ekranı:** SUBÜ BYS giriş sayfasındaki gibi sol panelde okul logosu ve kampüs manzarası.
- **Veritabanı:** `20260927110000_sema_senkronu` (şemada olup migration'larda eksik kalan `onay_bekliyor`
  kart durumu ve `erisim_kaydi.kapiSifreId`), `20260927120000_zorunlu_sifre_degisimi`.

## Veritabanını sıfırdan kurma (tek seferlik)

**Tüm kayıtlar silinir.** Proje klasöründe PowerShell:

```powershell
docker compose down -v; docker compose up -d --build; docker compose logs -f --tail 40 backend
```

(Onay sorarak aynı işi yapan betik: `powershell -ExecutionPolicy Bypass -File .\scripts\veritabani-sifirla.ps1`)

Loglarda `Oluşturulan hesaplar (20)` satırını görünce `Ctrl+C` ile log izlemeyi bırakıp **http://localhost** adresini açın.

### Başlangıç hesapları

| Hesap | E-posta | İlk şifre |
|---|---|---|
| Sistem yöneticisi | `sistem.yonetici@securelab.local` (`SEED_ADMIN_EMAIL`) | `SEED_ADMIN_PASSWORD` (geliştirmede `SecureLab2026!`) |
| Bölüm başkanı (yönetici) | `halitoztekin@subu.edu.tr` (`SEED_BOLUM_BASKANI_EPOSTA`) | `SEED_HOCA_PASSWORD` (geliştirmede `BmLab-2026!`) |
| Diğer öğretim elemanları | bölüm sitesindeki kurumsal adresleri | `SEED_HOCA_PASSWORD` |

Herkes ilk girişte kendi şifresini belirler. Üretimde `.env` içinde bu değerleri mutlaka değiştirin;
aksi hâlde backend `NODE_ENV=production` ile açılmaz. Kadroya sonradan eklenenler için:
`docker compose exec backend npm run import:academic-staff` ya da panelde **Kullanıcı Ekle**.

### E-posta gönderimi

Geçici şifre e-postaları için `.env` içinde `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
ve e-postadaki giriş bağlantısı için `APP_BASE_URL` (ör. `http://10.9.2.50`) tanımlayın.

## Hızlı başlangıç (Windows / Docker Desktop)

```powershell
cd C:\Users\<kullanici>\Documents\VSCode-files\secureDoor\secure-door-project
Copy-Item .env.example .env        # yalnızca ilk kurulumda
docker compose up -d --build
```

Tarayıcıdan **http://localhost** adresini açın (`FRONTEND_PORT` ile değiştirilebilir).

Frontend aynı adres üzerindeki `/api` yolunu backend servisine yönlendirir.
Backend sağlık adresi: `http://localhost:3000/api/health`.

## Kart Kayıt İstasyonu

1. `kart-kayit-istasyonu/` klasörünü VS Code + PlatformIO ile açıp ESP32'ye yükleyin:
   ```powershell
   cd kart-kayit-istasyonu
   pio run -t upload
   pio device monitor      # kart okutunca UID burada görünür
   ```
2. Seri monitörü kapatın (port aynı anda tek programda açılabilir).
3. Panelde **Kart Yetkilendirme** sayfasını açın → **İstasyona Bağlan** → COM portunu seçin → kartı okutun (ya da seri ekrandaki UID'yi elle yazın) → kartın sahibini seçip **Kartı Yetkilendir**.

Bağlantı şeması ve seri çıktı örneği: [`kart-kayit-istasyonu/README.md`](kart-kayit-istasyonu/README.md).

## Servisler

- Frontend: `http://localhost`
- Backend: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- MQTT: `localhost:1883`

```powershell
docker compose ps                 # durum
docker compose logs -f backend    # backend logları
docker compose down               # durdur
```

## Testler

```powershell
docker compose exec backend npm test
```

Kapı şifresi politikası ve profil uç noktaları için birim testleri:
`backend/src/tests/pinPolicy.test.js`, `backend/src/tests/kapiSifresi.route.test.js`.

## ESP32 kapı cihazı yapılandırması

1. `esp32-kodlar/include/config.local.example.h` dosyasını `config.local.h` adıyla kopyalayın.
2. Ağ, MQTT adresi, cihaz/kapı kimlikleri ve pinleri kendi donanımınıza göre düzenleyin.
3. Cihazdaki `ESP32_SECRET_KEY` değeri `.env` içindeki `ESP32_SECRET_KEY` ile aynı olmalıdır.
4. PlatformIO ile `esp32-kodlar` klasörünü derleyip karta yükleyin.

`config.local.h` gizli bilgiler içerdiği için Git tarafından izlenmez.

## Şifre sıfırlama ve QR arıza formu

- "Şifremi unuttum" bağlantısının e-posta gönderebilmesi için `.env` dosyasındaki SMTP ayarlarını doldurun.
- Telefonla okutulacak QR adresini `PUBLIC_ISSUE_URL` ile ağdan erişilebilir bir adrese ayarlayın; `localhost` telefondan açılmaz.

## Güvenlik ve roller

- **Yönetici:** kullanıcı yönetimi, kart kaydı/yetkilendirme, uzaktan kapı açma.
- **Öğretim üyesi:** panel, erişim geçmişi, kendi kapı şifresini görme/değiştirme.
- Web parolası ile kapı şifresi ayrıdır; kapı şifresi argon2 hash + AES-256-GCM şifreli kopya olarak saklanır.
- Kapı cihazları web tokenı yerine `X-Device-Key` başlığıyla doğrulanır.

Ayrıntılı kurulum ve donanım rehberi: [`docs/PROJE_REHBERI.md`](docs/PROJE_REHBERI.md).
