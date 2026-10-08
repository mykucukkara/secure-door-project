# SecureLab — Devir Teslim ve Komut Satırı Kullanım Kılavuzu

Bu kılavuz, projeyi devralacak kişinin **sıfırdan** kurulum yapabilmesi, ESP32 yazılımını **PlatformIO** ile derleyip
yükleyebilmesi ve tüm sistemi **Docker** ile çalıştırıp yönetebilmesi için hazırlanmıştır. Her adımın komutu yazılıdır.
Genel tanıtım için [README.md](../README.md), ayrıntılar için [docs/PROJE_REHBERI.md](PROJE_REHBERI.md) dosyasına bakın.

> Komutlar Windows **cmd** ya da **PowerShell** içindir. Linux sunucuda aynı `docker compose` komutları geçerlidir.
> cmd'de komutları art arda bağlamak için `&&`, PowerShell'de `;` kullanılır.

---

## İçindekiler

1. [Projeye genel bakış](#1-projeye-genel-bakış)
2. [Gerekli programlar](#2-gerekli-programlar)
3. [Projeyi edinme](#3-projeyi-edinme)
4. [Docker ile sistemi çalıştırma](#4-docker-ile-sistemi-çalıştırma)
5. [Docker komutları rehberi](#5-docker-komutları-rehberi)
6. [PlatformIO ile ESP32 kodu](#6-platformio-ile-esp32-kodu)
7. [Kapı cihazı: ayar, derleme, yükleme](#7-kapı-cihazı-ayar-derleme-yükleme)
8. [Kart kayıt istasyonu](#8-kart-kayıt-istasyonu)
9. [ESP32 testleri (PlatformIO)](#9-esp32-testleri-platformio)
10. [Uzaktan güncelleme (OTA)](#10-uzaktan-güncelleme-ota)
11. [Backend ve uçtan uca testler](#11-backend-ve-uçtan-uca-testler)
12. [Veritabanı işlemleri](#12-veritabanı-işlemleri)
13. [Baştan sona devir teslim senaryosu](#13-baştan-sona-devir-teslim-senaryosu)
14. [Sık karşılaşılan sorunlar](#14-sık-karşılaşılan-sorunlar)
15. [Hızlı komut özeti](#15-hızlı-komut-özeti)

---

## 1. Projeye genel bakış

| Parça | Teknoloji | Nerede çalışır | Nasıl çalıştırılır |
|---|---|---|---|
| Web paneli | HTML/JS + Nginx | Docker (`frontend`) | `docker compose up -d --build` |
| Backend API | Node.js 22, Express, Prisma | Docker (`backend`) | `docker compose up -d --build` |
| Veritabanı | PostgreSQL 16 | Docker (`db`) | Docker ile birlikte |
| MQTT broker | Mosquitto | Docker (`mqtt`) | Docker ile birlikte |
| QR arıza formu | Nginx + Cloudflare tüneli | Docker (`public-form`, `qr-tunnel`) | Docker ile birlikte |
| **Kapı cihazı yazılımı** | ESP32, Arduino çatısı | **ESP32 kartı** | **PlatformIO** (`esp32-kodlar/`) |
| **Kart kayıt istasyonu** | ESP32 + RC522 | **ESP32 kartı** | **PlatformIO** (`kart-kayit-istasyonu/`) |

Yani iki ayrı dünya vardır:

- **Sunucu tarafı** (panel, API, veritabanı, MQTT) → hepsi **Docker** ile tek komutla ayağa kalkar.
- **Cihaz tarafı** (kapıdaki ESP32 ve kart istasyonu) → **PlatformIO** ile derlenir ve USB ile karta yüklenir.

İki taraf **MQTT** (1883) üzerinden konuşur. Kapı cihazının `config.local.h` içindeki MQTT adresi, Docker'ın çalıştığı
bilgisayarın/sunucunun IP'si olmalıdır.

---

## 2. Gerekli programlar

| Program | Ne için | Kontrol komutu |
|---|---|---|
| **Git** | Projeyi indirmek / yüklemek | `git --version` |
| **Docker Desktop** (Windows) ya da Docker Engine + Compose (Linux) | Sunucu tarafını çalıştırmak | `docker --version` ve `docker compose version` |
| **VS Code** | Kod düzenleme | — |
| **PlatformIO IDE** (VS Code eklentisi) | ESP32 derleme/yükleme | VS Code sol menüde karınca başı simgesi |
| **ESP32 USB sürücüsü** (CP210x veya CH340, karta göre) | Kartı bilgisayarın COM port olarak görmesi | Aygıt Yöneticisi → Bağlantı Noktaları (COM ve LPT) |
| **Node.js 22+** | Yalnızca uçtan uca testler için | `node --version` |
| **Chrome veya Edge** | Panel + kart istasyonu (Web Serial) | — |

> **Docker Desktop açık ve "Running" durumda olmalıdır.** Kapalıysa `docker compose` komutları bağlantı hatası verir.

### PlatformIO komut satırı (`pio`) kurulumu

VS Code eklentisini kurunca `pio` komutu da gelir, ancak PATH'e eklenmemiş olabilir. İki yol vardır:

1. **Önerilen:** VS Code içinde PlatformIO terminali açın → alt çubuktaki **PlatformIO: New Terminal** simgesi (`>_`).
   Bu terminalde `pio` komutu hazırdır.
2. Normal cmd/PowerShell'de kullanmak için tam yol:

   ```cmd
   %USERPROFILE%\.platformio\penv\Scripts\pio.exe --version
   ```

   İsterseniz `%USERPROFILE%\.platformio\penv\Scripts` klasörünü Windows PATH'ine ekleyin.

Bu kılavuzda `pio` yazan her yerde `platformio` de yazılabilir (aynı programdır).

---

## 3. Projeyi edinme

```cmd
cd C:\Users\<kullanici>\Documents\VSCode-files\secureDoor
git clone https://github.com/rumeysakolip/secure-door-project.git
cd secure-door-project
```

Depo gizliyse GitHub kullanıcı adı ve şifre yerine **Personal Access Token** istenir.

Proje klasörünün içeriği:

```text
secure-door-project/
├── backend/               Node.js API (Docker içinde çalışır)
├── frontend/              Web paneli (Docker içinde çalışır)
├── esp32-kodlar/          KAPI CİHAZI yazılımı  → PlatformIO
├── kart-kayit-istasyonu/  KART OKUYUCU yazılımı → PlatformIO
├── mosquitto/             MQTT ayar dosyası
├── e2e/                   Tarayıcı testleri (Playwright)
├── scripts/               Yardımcı betikler
├── docs/                  Dokümanlar
├── docker-compose.yml     Tüm sunucu servislerinin tanımı
└── .env.example           Ayar şablonu
```

---

## 4. Docker ile sistemi çalıştırma

### 4.1 Ayar dosyasını oluşturma

```cmd
copy .env.example .env
```

PowerShell: `Copy-Item .env.example .env`

`.env` zaten varsa bu adımı atlayın. Bu dosya **Git'e yüklenmez**, gizli bilgi içerir; kimseyle paylaşmayın.
Yerel deneme için varsayılan değerler yeterlidir. Gerçek kullanımda değiştirilecek alanlar için
[README § 14](../README.md#14-githuba-yükleme-ve-sunucuya-kurulum) ve bu kılavuzun [§ 13](#13-baştan-sona-devir-teslim-senaryosu) bölümüne bakın.

### 4.2 Tüm sistemi derleyip başlatma

```cmd
docker compose up -d --build
```

Bu tek komut şunları yapar:

1. `db` → PostgreSQL 16 konteynerini kaldırır (veriler `postgres_data` biriminde kalıcıdır).
2. `mqtt` → Mosquitto broker'ı kaldırır (1883 ve 9001 portları).
3. `backend` → imajı derler, veritabanı sağlıklı olunca başlar; **migration'lar otomatik uygulanır** ve boş veritabanında
   20 başlangıç hesabı oluşturulur.
4. `frontend` → Nginx ile paneli 80 portundan yayınlar.
5. `public-form`, `qr-tunnel` → öğrenci arıza formu ve Cloudflare tüneli.

Parametreler:

| Parametre | Anlamı |
|---|---|
| `up` | Servisleri oluştur ve başlat |
| `-d` | Arka planda çalıştır (terminal serbest kalır) |
| `--build` | İmajları yeniden derle (kodu değiştirdiyseniz gerekir) |

### 4.3 Açıldığını doğrulama

```cmd
docker compose ps
```

Tüm servislerin `Up` (backend, db, frontend için `healthy`) olması gerekir.

```cmd
docker compose logs -f --tail 40 backend
```

Şu satırları görünce hazırdır (`Ctrl+C` ile log izlemeyi bırakın; sistem çalışmaya devam eder):

```text
Oluşturulan hesaplar (20)
Backend sunucusu 3000 portunda başlatıldı
```

Tarayıcıdan kontrol:

| Ne | Adres |
|---|---|
| Web paneli | http://localhost |
| API sağlık kontrolü | http://localhost:3000/api/health |

Komut satırından sağlık kontrolü (PowerShell):

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

### 4.4 Sistemi durdurma / yeniden başlatma

```cmd
docker compose down        & REM durdurur, veriler KORUNUR
docker compose up -d       & REM tekrar başlatır (yeniden derlemez)
```

> `docker compose down -v` ise **veritabanı dahil tüm verileri siler**. Yalnızca bilerek sıfırlamak için kullanın.

---

## 5. Docker komutları rehberi

Hepsi proje klasöründe (`docker-compose.yml` dosyasının olduğu yer) çalıştırılır.

### 5.1 Durum ve loglar

```cmd
docker compose ps                         & REM servislerin durumu
docker compose logs backend               & REM backend'in tüm logu
docker compose logs -f --tail 100 backend & REM canlı izle, son 100 satırdan başla
docker compose logs mqtt                  & REM MQTT broker logu (cihaz bağlandı mı?)
docker compose logs qr-tunnel             & REM QR formunun dış adresi burada yazar
docker compose logs db                    & REM veritabanı logu
```

Canlı log izlemeden çıkmak için `Ctrl+C`; servisleri durdurmaz.

### 5.2 Başlatma, durdurma, yeniden başlatma

```cmd
docker compose up -d                  & REM hepsini başlat
docker compose down                   & REM hepsini durdur (veri korunur)
docker compose restart backend        & REM sadece backend'i yeniden başlat
docker compose stop frontend          & REM sadece frontend'i durdur
docker compose start frontend         & REM durdurulanı tekrar başlat
```

### 5.3 Kod değiştikten sonra ne yapılır?

| Değişen yer | Komut |
|---|---|
| `backend/src/` | `docker compose restart backend` (kod klasörü konteynere bağlıdır, yeniden derleme gerekmez) |
| `frontend/` | `docker compose up -d --build frontend`, ardından tarayıcıda `Ctrl+F5` |
| `backend/package.json`, `Dockerfile`, `backend/prisma/` migration | `docker compose up -d --build` |
| `.env` | `docker compose up -d` (ortam değişkenlerini yeniden okur) |
| `mosquitto/mosquitto.conf` | `docker compose restart mqtt` |

### 5.4 Konteynerin içinde komut çalıştırma

```cmd
docker compose exec backend sh                          & REM backend konteynerinde kabuk aç (çıkış: exit)
docker compose exec backend npm run import:academic-staff & REM bölüm kadrosunu içe aktar
docker compose exec db psql -U kapi_user -d kapi_sistemi_db & REM veritabanına SQL bağlantısı
```

`psql` içinde: `\dt` (tabloları listele), `SELECT * FROM "User" LIMIT 5;`, çıkış için `\q`.
(Kullanıcı ve veritabanı adlarını kendi `.env` değerlerinize göre yazın.)

### 5.5 Port ve çakışma sorunları

| Durum | Çözüm |
|---|---|
| 80 portu başka program tarafından kullanılıyor | `.env` içine `FRONTEND_PORT=8080` yazın, sonra `docker compose up -d`; panel `http://localhost:8080` olur |
| 3000 doluysa | `.env` → `BACKEND_PORT=3001` |
| Hangi program 80'i kullanıyor? | `netstat -ano \| findstr :80` |

### 5.6 Temizlik (dikkatli kullanın)

```cmd
docker compose down -v                 & REM konteynerler + VERİTABANI birimi silinir
docker image prune                     & REM kullanılmayan imajları temizler
docker system df                       & REM Docker'ın kapladığı disk alanı
```

---

## 6. PlatformIO ile ESP32 kodu

### 6.1 PlatformIO nedir, neden kullanıyoruz?

PlatformIO, VS Code içinde çalışan bir gömülü yazılım geliştirme aracıdır. Arduino IDE'ye göre avantajları:

- **Kütüphaneler `platformio.ini` dosyasında yazılıdır** ve ilk derlemede otomatik indirilir. Elle kütüphane kurmak gerekmez.
- Kart tipi, hız, derleme bayrakları dosyada sabittir; **herkes aynı ayarla derler**.
- Birden fazla ortam (`env`) tanımlanabilir: gerçek kart, bilgisayarda çalışan test ortamı vb.
- Komut satırından çalışır (`pio run`), otomasyona uygundur.

Bu projede **iki ayrı PlatformIO projesi** vardır:

| Klasör | Amaç |
|---|---|
| `esp32-kodlar/` | Kapıdaki cihaz: RC522 kart okuyucu, 4x4 tuş takımı, röle, LCD, buzzer, manyetik sensör, Ethernet/Wi-Fi, MQTT, OTA |
| `kart-kayit-istasyonu/` | Masadaki küçük okuyucu: kartın UID'sini USB seri porta yazar |

### 6.2 `platformio.ini` dosyasının anlamı (`esp32-kodlar/`)

```ini
[platformio]
default_envs = esp32dev        ; komutta ortam belirtilmezse bu kullanılır

[env:esp32dev]                 ; GERÇEK KART ORTAMI
platform = espressif32         ; ESP32 araç zinciri
board = esp32dev               ; kart tipi
framework = arduino            ; Arduino çatısı
monitor_speed = 115200         ; seri monitör hızı (koddaki Serial.begin ile aynı olmalı)
monitor_dtr = 0                ; monitör açılınca kart resetlenmesin
monitor_rts = 0
build_flags = -DMFRC522_SPICLOCK=500000   ; RC522 SPI hızı
lib_deps =                     ; otomatik indirilen kütüphaneler:
    miguelbalboa/MFRC522       ;   RFID okuyucu
    bblanchon/ArduinoJson      ;   JSON
    knolleary/PubSubClient     ;   MQTT
    arduino-libraries/Ethernet ;   W5500 kablolu ağ
    chris--a/Keypad            ;   tuş takımı
    marcoschwartz/LiquidCrystal_I2C ; LCD
    adafruit/RTClib            ;   gerçek zaman saati

[env:native]                   ; BİLGİSAYARDA ÇALIŞAN TEST ORTAMI (kart gerekmez)
[env:esp32dev-mqtt-test]       ; MQTT yöneticisi için kart üstü test ortamı
```

Üç ortam vardır:

| Ortam | Ne zaman |
|---|---|
| `esp32dev` | Gerçek kapı cihazına yazılım yüklerken (varsayılan) |
| `native` | Kart olmadan, bilgisayarda mantık testleri (`CardReader`, `MqttManager`, `DoorState`, `AccessControl`) |
| `esp32dev-mqtt-test` | MQTT yöneticisini kart üstünde test ederken |

### 6.3 İki kullanım yolu: arayüz ve komut satırı

**VS Code arayüzü (alt çubuktaki simgeler):**

| Simge | Anlamı | Komut karşılığı |
|---|---|---|
| ✓ (onay işareti) | Build — derle | `pio run` |
| → (ok) | Upload — karta yükle | `pio run -t upload` |
| 🗑 (çöp) | Clean — derleme dosyalarını sil | `pio run -t clean` |
| 🔌 (fiş) | Serial Monitor — seri çıktıyı izle | `pio device monitor` |
| Test simgesi | Testleri çalıştır | `pio test` |

**Komut satırı:** önce proje klasörüne girin. `pio` komutları, `platformio.ini` dosyasının olduğu klasörde çalışır.

```cmd
cd esp32-kodlar
```

Ya da klasöre girmeden: `pio run -d esp32-kodlar`

### 6.4 Temel PlatformIO komutları

```cmd
pio --version                          & REM kurulu mu?
pio run                                & REM derle (varsayılan ortam)
pio run -e esp32dev                    & REM ortamı açıkça belirterek derle
pio run -t upload                      & REM derle + karta yükle
pio run -t upload --upload-port COM5   & REM belirli COM portuna yükle
pio run -t clean                       & REM derleme çıktılarını temizle
pio run -t erase                       & REM kartın flash belleğini tamamen sil
pio device list                        & REM bağlı seri aygıtları/COM portlarını listele
pio device monitor                     & REM seri monitörü aç (Çıkış: Ctrl+C)
pio device monitor -p COM5 -b 115200   & REM port ve hız belirterek
pio run -t upload && pio device monitor & REM yükle, hemen ardından izle
pio pkg install                        & REM lib_deps kütüphanelerini indir/güncelle
pio pkg list                           & REM kurulu paketleri göster
pio test -e native                     & REM bilgisayarda birim testler
pio run -t compiledb                   & REM IntelliSense için derleme veritabanı üret
```

> **Önemli:** İlk derleme **uzun sürer** (birkaç dakika). ESP32 araç zinciri ve kütüphaneler internetten indirilir.
> Sonraki derlemeler çok daha hızlıdır. İlk derlemede internet bağlantısı şarttır.

Başarılı derleme çıktısı şuna benzer:

```text
RAM:   [==        ]  17.5% (used 57000 bytes from 327680 bytes)
Flash: [====      ]  38.2% (used 500000 bytes from 1310720 bytes)
========================= [SUCCESS] Took 42.31 seconds =========================
```

Derlenen yazılım şurada oluşur: `esp32-kodlar/.pio/build/esp32dev/firmware.bin` (OTA için bu dosya kullanılır).

---

## 7. Kapı cihazı: ayar, derleme, yükleme

### 7.1 Cihaza özel ayar dosyasını oluşturma

Wi-Fi şifresi ve sunucu adresi gibi bilgiler kodun içine yazılmaz, `config.local.h` dosyasında tutulur
(bu dosya **Git'e yüklenmez**).

```cmd
cd esp32-kodlar\include
copy config.local.example.h config.local.h
```

`config.local.h` dosyasını açıp düzenleyin:

| Satır | Anlamı | Ne yazılır |
|---|---|---|
| `WIFI_SSID`, `WIFI_PASSWORD` | Wi-Fi bilgileri | Ağ adı ve şifresi. Kablolu ağ kullanılıyorsa önemsizdir |
| `WIFI_IDENTITY`, `WIFI_USERNAME` | Eduroam bilgileri | Normal Wi-Fi'de boş bırakın |
| `MQTT_BROKER_HOST` | Docker'ın çalıştığı makinenin IP'si | Örn. `"10.9.2.50"`. **`localhost` yazmayın**; ESP32 için localhost kendisidir |
| `MQTT_BROKER_PORT` | MQTT portu | `1883` |
| `DEVICE_ID`, `DOOR_ID` | Cihaz ve kapı numarası | Panelde tanımlı olanlarla aynı olmalı |
| `FIRMWARE_VERSION` | Yazılım sürümü | OTA'da sürümü artırmak için kullanılır |
| `NETWORK_USE_ETHERNET` | `1` = W5500 kablolu ağ, `0` = Wi-Fi | Donanıma göre |
| `ETHERNET_CS_PIN` | W5500 CS pini | Varsayılan `13` |
| `RFID_SS_PIN`, `RFID_RST_PIN` | RC522 pinleri | Donanım şemasına göre |
| `RELAY_PIN`, `BUZZER_PIN`, `SENSOR_PIN` | Röle, buzzer, kapı sensörü | Donanım şemasına göre |
| `KEYPAD_ROW_*`, `KEYPAD_COL_*` | Tuş takımı pinleri | Donanım şemasına göre |
| `KEYPAD_MIN_LEN`, `KEYPAD_MAX_LEN` | Şifre uzunluğu sınırları | 4–6 |

Pin atamalarının tamamı ve bağlantı çizimi: [donanim-baglanti-semasi.md](donanim-baglanti-semasi.md).

Ayrıca **`ESP32_SECRET_KEY`** değeri, sunucudaki `.env` dosyasındaki `ESP32_SECRET_KEY` ile **birebir aynı** olmalıdır
(cihaz, backend'e kimliğini bu anahtarla kanıtlar). Bunun cihaz tarafında nerede tanımlandığını
[docs/PROJE_REHBERI.md](PROJE_REHBERI.md) içinde bulabilirsiniz.

Bulut MQTT (HiveMQ gibi) kullanılacaksa `config.local.h` içindeki `MQTT_USE_TLS`, `MQTT_USERNAME`, `MQTT_PASSWORD`
satırlarının yorum işareti kaldırılır ve port `8883` yapılır (dosyada açıklaması vardır).

### 7.2 ESP32'yi bilgisayara bağlama

1. ESP32'yi **veri destekli** bir USB kablosuyla bilgisayara takın (yalnızca şarj kabloları çalışmaz).
2. COM portunu bulun:

   ```cmd
   pio device list
   ```

   Çıktıda `COM5` gibi bir port ve açıklamada `CP210x` / `CH340` görmelisiniz.
   Görünmüyorsa USB sürücüsü kurulu değildir veya kablo yalnızca şarj kablosudur.

### 7.3 Derleme ve yükleme

```cmd
cd esp32-kodlar
pio run                          & REM önce sadece derle, hata var mı bak
pio run -t upload                & REM karta yükle
```

Birden fazla kart takılıysa portu belirtin: `pio run -t upload --upload-port COM5`

Yükleme sırasında ekranda `Connecting......` yazıp ilerlemezse: kartın üzerindeki **BOOT** düğmesine, noktalar akarken
basılı tutun; yükleme başlayınca bırakın.

Başarılı yükleme:

```text
Writing at 0x00010000... (100 %)
Hash of data verified.
Hard resetting via RTS pin...
========================= [SUCCESS] =========================
```

### 7.4 Çalıştığını seri monitörden doğrulama

```cmd
pio device monitor
```

(Hız 115200; `platformio.ini` içinde ayarlıdır.) Wi-Fi/Ethernet bağlantısı, MQTT bağlantısı ve kart okutma olayları
satır satır görünür. Çıkış: `Ctrl+C`.

Aynı anda sunucu tarafında doğrulama:

```cmd
docker compose logs -f --tail 50 mqtt
docker compose logs -f --tail 50 backend
```

Cihaz bağlandığında MQTT logunda yeni bir istemci bağlantısı, kart okutunca backend logunda erişim kararı görünür.
Sonuç panelde **Erişim Geçmişi** sayfasına da yazılır.

> **COM portunu aynı anda tek program kullanabilir.** Seri monitör açıkken yükleme yapılamaz; önce monitörü kapatın.

---

## 8. Kart kayıt istasyonu

Masaüstü okuyucu, kartı okutunca UID'yi USB seri porta yazar; panelin **Kart Yetkilendirme** sayfası bunu okur.

```cmd
cd kart-kayit-istasyonu
pio run -t upload
pio device monitor
```

Kart okutunca monitörde şu çıktı görülür:

```text
UID:04:A1:B2:C3
```

Sonra:

1. Seri monitörü **kapatın** (`Ctrl+C`) — port tek program tarafından kullanılabilir.
2. Panel → **Kart Yetkilendirme** → **İstasyona Bağlan** → COM portunu seçin (**Chrome veya Edge** gerekir).
3. Kartı okutun (veya UID'yi elle yazın) → sahibini seçin → **Kartı Yetkilendir**.

Bağlantı şeması: [kart-kayit-istasyonu/README.md](../kart-kayit-istasyonu/README.md).

---

## 9. ESP32 testleri (PlatformIO)

`esp32-kodlar/test/` altında dört test grubu vardır: `test_access_control`, `test_card_reader`, `test_door_state`,
`test_mqtt_manager`.

```cmd
cd esp32-kodlar
pio test -e native                          & REM bilgisayarda çalışır, kart GEREKMEZ
pio test -e native -f test_access_control   & REM sadece bir test grubu
pio test -e native -v                       & REM ayrıntılı çıktı
pio test -e esp32dev-mqtt-test              & REM MQTT testi, kart takılı olmalı
```

`native` ortamı yalnızca `CardReader`, `MqttManager`, `DoorState`, `AccessControl` kaynaklarını derler; donanıma
bağlı kodlar (LCD, röle vb.) dahil edilmez. `native` testleri için bilgisayarda bir **C++ derleyicisi** (Windows'ta
MinGW-w64/`g++`, Linux'ta `g++`) bulunmalıdır.

---

## 10. Uzaktan güncelleme (OTA)

İlk yükleme **mutlaka USB ile** yapılır (bölüm 7). Sonraki sürümler kablosuz gönderilebilir. Ayrıntı:
[docs/ota-guncelleme.md](ota-guncelleme.md). Özet akış:

**1. Sürümü artırın** (`esp32-kodlar/include/FirmwareVersion.h` içinde `FIRMWARE_VERSION`, örn. `"1.0.2"`).

**2. Derleyin:**

```cmd
cd esp32-kodlar
pio run -e esp32dev
```

OTA için kullanılacak dosya: `esp32-kodlar\.pio\build\esp32dev\firmware.bin`

**3. Yönetici olarak oturum açıp token alın (PowerShell):**

```powershell
$body = @{ email = "sistem.yonetici@securelab.local"; password = "<yönetici şifresi>" } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "http://SUNUCU:3000/api/auth/login" -ContentType "application/json" -Body $body
$token = $r.token
```

(Yanıttaki token alanının adı farklıysa [api-ornekleri.md](api-ornekleri.md) dosyasına bakın.)

**4. Firmware'i backend'e yükleyin:**

```powershell
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post `
  -Uri "http://SUNUCU:3000/api/firmware/upload?version=1.0.2" `
  -Headers $headers -ContentType "application/octet-stream" `
  -InFile "esp32-kodlar\.pio\build\esp32dev\firmware.bin"
```

**5. Cihaza güncelleme komutunu gönderin:**

```powershell
$g = @{ version = "1.0.2"; force = $false } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://SUNUCU:3000/api/firmware/cihaz/1/guncelle" `
  -Headers $headers -ContentType "application/json" -Body $g
```

ESP32 komut içindeki kısa ömürlü bağlantıdan dosyayı indirir, MD5'ini doğrular, yazar ve yeniden başlar.
Gerekli `.env` ayarı: `FIRMWARE_PUBLIC_BASE_URL` — ESP32'nin bulunduğu ağdan erişilebilen sunucu adresi olmalıdır
(`localhost` olmaz).

---

## 11. Backend ve uçtan uca testler

Sistem `docker compose up -d --build` ile **çalışırken**, proje klasöründe:

```cmd
scripts\testleri-calistir.cmd
```

Bu betik sırayla iki aşamayı çalıştırır: backend testleri (Jest) ve tarayıcı testleri (Playwright). Sonunda
`SONUC: Tum testler gecti` yazar. Aşamaları ayrı çalıştırmak:

```cmd
docker compose exec -e NODE_ENV=test -e ALLOW_DEV_PASSWORD_RESET=true backend npm test
cd e2e
npm ci
npx playwright install chromium
npx playwright test
npx playwright show-report        & REM HTML test raporunu aç
```

> **Uyarı:** Testler veritabanına test kayıtları ekler ve iki test hesabının şifresini değiştirir. Yalnızca
> **geliştirme** ortamında çalıştırın; gerçek kullanımdaki sunucuda **çalıştırmayın**.

---

## 12. Veritabanı işlemleri

**Yedek alma:**

```cmd
docker compose exec -T db pg_dump -U kapi_user kapi_sistemi_db > securelab-yedek.sql
```

**Yedekten geri yükleme** (mevcut veriyi üzerine yazar; önce yeni bir yedek alın):

```cmd
type securelab-yedek.sql | docker compose exec -T db psql -U kapi_user -d kapi_sistemi_db
```

PowerShell: `Get-Content securelab-yedek.sql | docker compose exec -T db psql -U kapi_user -d kapi_sistemi_db`

**Sıfırdan kurma (tüm kayıtlar silinir):**

cmd:

```cmd
docker compose down -v && docker compose up -d --build && docker compose logs -f --tail 40 backend
```

PowerShell (onay isteyen betik):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\veritabani-sifirla.ps1
```

Başlangıç hesapları **yalnızca boş veritabanında** oluşur. Eski veritabanı duruyorsa bu hesaplar yeniden gelmez;
sıfırdan kurmak gerekir.

**Yönetici şifresini geliştirme ortamında sıfırlama:** `scripts\sifre-sifirla.cmd` (iki yönetici hesabını ilk şifrelerine
döndürür). Gerçek sunucuda **çalıştırmayın**.

---

## 13. Baştan sona devir teslim senaryosu

Teslim sırasında hocaya sırayla gösterilebilecek akış:

**A. Sunucu tarafı (yaklaşık 5 dk)**

1. `git clone ...` → `cd secure-door-project`
2. `copy .env.example .env`
3. `docker compose up -d --build`
4. `docker compose ps` → hepsi `Up/healthy`
5. `docker compose logs -f --tail 40 backend` → "Backend sunucusu 3000 portunda başlatıldı"
6. Tarayıcı: http://localhost → yönetici hesabıyla giriş → şifre değiştirme ekranı

**B. Kapı cihazı (yaklaşık 10 dk, ilk derlemede daha uzun)**

1. VS Code ile `esp32-kodlar` klasörünü aç (PlatformIO otomatik tanır)
2. `config.local.example.h` → `config.local.h`; Wi-Fi, `MQTT_BROKER_HOST` (bilgisayarın IP'si), `DEVICE_ID`, `DOOR_ID`
3. `pio device list` → COM portunu bul
4. `pio run` → derleme başarılı
5. `pio run -t upload` → yükleme
6. `pio device monitor` → ağ ve MQTT bağlantı mesajları
7. Kartı okut → panelde **Erişim Geçmişi** satırı oluşur

**C. Kart tanımlama**

1. `kart-kayit-istasyonu` → `pio run -t upload`
2. Panel → Kart Yetkilendirme → İstasyona Bağlan → kart okut → sahibini seç → Yetkilendir
3. Kartı kapıda okut → kapı açılır

**D. Gerçek kullanıma geçişte `.env` içinde değiştirilecekler**

| Değişken | Değer |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOW_DEV_PASSWORD_RESET` | `false` |
| `JWT_SECRET`, `PIN_HISTORY_ENCRYPTION_KEY`, `OTA_SIGNING_SECRET`, `ESP32_SECRET_KEY` | Her biri için ayrı `openssl rand -hex 32` çıktısı (Windows'ta Git Bash içinde de çalışır) |
| `POSTGRES_PASSWORD` ve `DATABASE_URL` içindeki şifre | Güçlü, benzersiz şifre |
| `SEED_ADMIN_PASSWORD`, `SEED_HOCA_PASSWORD` | Güçlü ilk giriş şifreleri |
| `APP_BASE_URL`, `PUBLIC_ISSUE_URL`, `FIRMWARE_PUBLIC_BASE_URL` | Sunucunun gerçek adresi |
| `SMTP_*` | Geçici şifre ve şifre sıfırlama e-postaları için |

Üretimde zayıf ya da varsayılan değer kalırsa backend açılmaz; nedeni `docker compose logs backend` gösterir.
Yeni sunucuya kurulum ve sürüm güncelleme adımları: [README § 14](../README.md#14-githuba-yükleme-ve-sunucuya-kurulum).

---

## 14. Sık karşılaşılan sorunlar

### Docker

| Belirti | Çözüm |
|---|---|
| `error during connect` / `cannot connect to the Docker daemon` | Docker Desktop açık değil; açıp "Running" olmasını bekleyin |
| `unknown shorthand flag: ';'` | cmd'desiniz; komutları `&&` ile birleştirin ya da PowerShell kullanın |
| `port is already allocated` | Port dolu; `.env` içinde `FRONTEND_PORT` / `BACKEND_PORT` değiştirin |
| http://localhost açılmıyor | `docker compose ps`; sağlıksız servisin logu: `docker compose logs <servis>` |
| Backend açılmıyor | `docker compose logs backend` ilk hata satırını okuyun (çoğunlukla `.env` ya da migration) |
| Başlangıç şifresi çalışmıyor | Şifre zaten değiştirilmiş olabilir veya eski veritabanı duruyordur; sıfırdan kurun (§12) |
| `Çok fazla deneme yapıldı` | Giriş 15 dakikada 10 deneme ile sınırlı; bekleyin ya da `docker compose restart backend` |
| Frontend değişikliği görünmüyor | `docker compose up -d --build frontend`, tarayıcıda `Ctrl+F5` |

### PlatformIO / ESP32

| Belirti | Çözüm |
|---|---|
| `pio` komutu tanınmıyor | VS Code içindeki PlatformIO terminalini kullanın ya da `%USERPROFILE%\.platformio\penv\Scripts` yolunu PATH'e ekleyin |
| `pio device list` boş | USB kablosu yalnızca şarj kablosu olabilir; CP210x/CH340 sürücüsünü kurun; başka USB portu deneyin |
| `Could not open port COM5: Access denied` | Port başka programda açık (seri monitör, Arduino IDE, kart istasyonu sayfası). Kapatın |
| Yükleme `Connecting......` ile takılıyor | Yükleme sırasında kartın **BOOT** düğmesine basılı tutun |
| `A fatal error occurred: Failed to connect to ESP32` | Kablo/port/sürücü; BOOT düğmesi; başka bir COM port deneyin |
| İlk derleme hata veriyor, kütüphane bulunamıyor | İnternet gerekli; `pio pkg install` sonra tekrar `pio run`. Sorun sürerse `pio run -t clean` |
| `config.local.h: No such file` | `config.local.example.h` dosyasını `config.local.h` olarak kopyalayın (§7.1) |
| Cihaz bağlanıyor ama backend'e ulaşmıyor | `MQTT_BROKER_HOST` yanlış; Docker'ın çalıştığı makinenin IP'sini yazın, `localhost` olmaz. Güvenlik duvarında 1883 açık olmalı |
| Kart okutunca cevap yok | `ESP32_SECRET_KEY` cihazda ve `.env`'de aynı mı? Cihaz/kapı numarası panelde tanımlı mı? `docker compose logs backend` |
| Seri monitörde anlamsız karakter | `monitor_speed` değerinin koddaki `Serial.begin` hızıyla (115200) aynı olduğundan emin olun |
| İstasyona bağlanılamıyor (panel) | Seri monitörü kapatın; Chrome/Edge kullanın; sayfayı `http://localhost` üzerinden açın |
| `pio test -e native` derleyici bulamıyor | Bilgisayara `g++` (MinGW-w64) kurun |

---

## 15. Hızlı komut özeti

**Sunucu (proje kök klasöründe)**

```cmd
copy .env.example .env                  & REM ilk kurulum: ayar dosyası
docker compose up -d --build            & REM derle ve başlat
docker compose ps                       & REM durum
docker compose logs -f --tail 40 backend & REM backend logu
docker compose restart backend          & REM backend'i yeniden başlat
docker compose up -d --build frontend   & REM frontend değişince
docker compose down                     & REM durdur (veri korunur)
docker compose down -v                  & REM durdur + TÜM VERİYİ SİL
scripts\testleri-calistir.cmd           & REM tüm testler (yalnızca geliştirme ortamı)
```

**Cihaz (`esp32-kodlar` veya `kart-kayit-istasyonu` klasöründe)**

```cmd
pio device list                         & REM COM portunu bul
pio run                                 & REM derle
pio run -t upload                       & REM karta yükle
pio run -t upload --upload-port COM5    & REM belirli porta yükle
pio device monitor                      & REM seri çıktıyı izle
pio run -t clean                        & REM derleme önbelleğini temizle
pio test -e native                      & REM bilgisayarda birim testler
```

**Git**

```cmd
git status
git add -A
git commit -m "Açıklama"
git push origin main
```

`git add -A` öncesi `git status` çıktısında `.env`, `config.local.h`, `node_modules` ya da `.zip` dosyası
görünmemelidir.
