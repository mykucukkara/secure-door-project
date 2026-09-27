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

## Bu sürümdeki değişiklikler

- **Kalıcı kapı şifresi:** Kapı şifreleri artık her gece değişmez. Her kullanıcının tek bir şifresi vardır;
  **Profilim** sayfasından görebilir, isterse kendi belirlediği 6 haneli şifreyle ya da rastgele yeni bir şifreyle değiştirebilir.
  Kolay tahmin edilen (111111, 123456…) ve başka kullanıcıda tanımlı şifreler kabul edilmez.
  Eski davranış için `.env` → `PIN_OTOMATIK_YENILEME=true`.
- **Geçici Şifre sayfası kaldırıldı**, işlevi Profilim sayfasına taşındı.
- **Kart Kayıt İstasyonu:** `kart-kayit-istasyonu/` altında ESP32 kodu ve web panelinde **Kart Kayıt** sayfası.
  Chrome/Edge, istasyona USB üzerinden (Web Serial) bağlanır, okutulan kartın UID'sini otomatik alır; yönetici kullanıcıyı seçip kartı tanımlar.
- **Yeni tasarım:** Tüm sayfalar SUBÜ Bilgisayar Mühendisliği sitesinin düzenine göre yenilendi
  (üst bilgi çubuğu, logo, mavi ana menü, sayfa başlığı bandı, alt bilgi; açık/koyu tema; mobil uyumlu).
- Yeni API uçları: `GET/PUT /api/kullanicilar/:id/kapi-sifresi`, `GET /api/kullanicilar/:id/kartlar`, `GET /api/kartlar/sorgula/:uid`.
- Veritabanı: `20260924120000_kalici_kapi_sifresi` migration'ı mevcut şifrelerin bitiş tarihlerini kaldırır (ilk açılışta otomatik çalışır).

## Hızlı başlangıç (Windows / Docker Desktop)

```powershell
cd C:\Users\<kullanici>\Documents\VSCode-files\secureDoor\secure-door-project
Copy-Item .env.example .env        # yalnızca ilk kurulumda
docker compose up -d --build
```

Tarayıcıdan **http://localhost:8080** adresini açın.

Frontend aynı adres üzerindeki `/api` yolunu backend servisine yönlendirir.
Backend sağlık adresi: `http://localhost:3000/api/health`.

### Geliştirme kullanıcıları

| Rol | E-posta | Parola |
|---|---|---|
| Yönetici | `.env` → `SEED_ADMIN_EMAIL` (varsayılan `admin@securelab.local`) | `.env` → `SEED_ADMIN_PASSWORD` |

Öğretim üyeleri yönetici tarafından **Kullanıcılar** sayfasından eklenir
(ya da `docker compose exec backend npm run import:academic-staff`).

Üretim ortamında varsayılan parola ve anahtarları mutlaka değiştirin.

## Kart Kayıt İstasyonu

1. `kart-kayit-istasyonu/` klasörünü VS Code + PlatformIO ile açıp ESP32'ye yükleyin:
   ```powershell
   cd kart-kayit-istasyonu
   pio run -t upload
   pio device monitor      # kart okutunca UID burada görünür
   ```
2. Seri monitörü kapatın (port aynı anda tek programda açılabilir).
3. Panelde **Kart Kayıt** sayfasını açın → **İstasyona Bağlan** → COM portunu seçin → kartı okutun → kullanıcıyı seçip **Kartı Tanımla**.

Bağlantı şeması ve seri çıktı örneği: [`kart-kayit-istasyonu/README.md`](kart-kayit-istasyonu/README.md).

## Servisler

- Frontend: `http://localhost:8080`
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
