# SecureDoor – Donanım Bağlantı Şeması (Net / Referans)

Bu belge `esp32-kodlar/include/config.h` ve firmware kaynak kodundan (`main.cpp`,
`LockController.cpp`, `AlertSystem.cpp`, `LcdDisplay.cpp`, `RtcManager.cpp`,
`CardReader.cpp`, `KeypadInput.cpp`) **birebir türetilmiştir**. Kod bu şekilde
yazılmıştır; kablolama bu belgeye uymuyorsa donanım yanlıştır, kod değil.

Kart: **ESP32 DevKit v1 (esp32dev, 30/38 pin)**

---

## 0. Malzeme listesi

| # | Malzeme | Besleme | Arayüz |
|---|---------|---------|--------|
| 1 | ESP32 DevKit v1 | 5 V (VIN) veya USB | — |
| 2 | MFRC522 RFID okuyucu | **3.3 V (5 V YASAK)** | SPI (VSPI) |
| 3 | 16x2 LCD + PCF8574 I2C backpack | 5 V | I2C |
| 4 | DS3231 RTC modülü (+ CR2032 pil) | 3.3 V | I2C |
| 5 | 4x3 membran keypad (7 uçlu) | Besleme yok | GPIO matris |
| 6 | RGB LED (**ortak ANOT**) + 3 adet 220–330 Ω | 3.3 V | 3 GPIO |
| 7 | Pasif buzzer / buzzer modülü (**LOW tetikli**) | 3.3–5 V | 1 GPIO (PWM) |
| 8 | 1 kanallı opto-izoleli röle modülü | 5 V | 1 GPIO |
| 9 | 12 V elektrikli kapı kilidi (fail-secure strike) | 12 V | Röle kontağı |
| 10 | Reed sensör (manyetik kapı sensörü, NO tip) | — | 1 GPIO + 10k pull-up |
| 11 | 12 V ≥ 2 A adaptör + 5 V regülatör (L7805 / buck) | — | — |
| 12 | 1N4007 flyback diyot, 10 kΩ direnç | — | — |

---

## 1. GÜÇ AKIŞI (akımın izlediği yol – baştan sona)

**Adım 1 — Şebeke → 12 V**
```
220 V AC adaptör  →  +12 V  ve  GND(0V)
```

**Adım 2 — 12 V hattının iki kola ayrılması**
```
+12 V ─┬─► Röle modülü COM ucu (kilit gücü)          [yüksek akım kolu]
       └─► 5 V regülatör (L7805 / DC-DC buck) girişi  [lojik kolu]
```
> L7805 kullanıyorsanız giriş 12 V, çıkış 5 V → üstünde 7 V düşer. RFID + LCD +
> röle ile ~400 mA çekilirse 7 V × 0.4 A ≈ **2.8 W ısı** olur, soğutucu şart.
> DC-DC buck modülü çok daha sağlıklıdır.

**Adım 3 — 5 V dağıtımı**
```
+5 V ─┬─► ESP32  VIN pini        (kart üstündeki AMS1117 → 3.3 V üretir)
      ├─► LCD I2C backpack  VCC
      └─► Röle modülü  VCC
```

**Adım 4 — 3.3 V dağıtımı (ESP32'nin 3V3 pininden)**
```
ESP32 3V3 ─┬─► MFRC522  3.3V     (ASLA 5V verme, modül yanar)
           ├─► DS3231   VCC
           ├─► RGB LED ortak anot bacağı
           ├─► Buzzer modülü VCC (modül 3.3V destekliyorsa)
           └─► GPIO35 sensör hattı için 10k pull-up direncinin üst ucu
```

**Adım 5 — ORTAK GND (en kritik madde)**
```
Adaptör GND = 5V regülatör GND = ESP32 GND = Röle GND = RFID GND
            = LCD GND = DS3231 GND = Buzzer GND = RGB LED yok(anot)
            = Reed sensörün bir ucu
```
> Tüm GND'ler **tek noktada** birleşmeli. Projede en sık görülen "bazen çalışıyor
> bazen çalışmıyor" arızasının %90'ı ortak GND eksikliğidir.

---

## 2. MFRC522 RFID OKUYUCU → SPI (VSPI)

Kod: `CardReader.cpp` → `SPI.begin(SCK, MISO, MOSI, SS)` ile pinler **açıkça**
verilir. RST'den gerçek donanım reseti atılır.

| RC522 pini | Gider → ESP32 | config.h makrosu |
|---|---|---|
| SDA (SS/CS) | **GPIO5** | `RFID_SS_PIN 5` |
| SCK | **GPIO18** | `RFID_SCK_PIN 18` |
| MOSI | **GPIO23** | `RFID_MOSI_PIN 23` |
| MISO | **GPIO19** | `RFID_MISO_PIN 19` |
| RST | **GPIO22** | `RFID_RST_PIN 22` |
| 3.3V | **3V3** | — |
| GND | **GND** | — |
| IRQ | **BOŞ – bağlanmaz** | — |

Notlar:
- SPI hızı `platformio.ini` içinde `-DMFRC522_SPICLOCK=500000` ile 500 kHz'e
  düşürülmüş → uzun/kalitesiz kablolara toleranslı. Yine de kablo **≤ 20 cm**.
- Firmware 3 saniyede bir `VersionReg` okur; `0x00`/`0xFF` gelirse otomatik
  yeniden başlatır. Seri monitörde `VersionReg=0x00` görüyorsanız **kablo veya
  besleme** hatasıdır (genelde 3.3V yerine 5V ya da GND yok).
- **GPIO22 burada kullanıldığı için** ESP32'nin varsayılan I2C SCL pini (GPIO22)
  serbest kalmamıştır → I2C, SCL olarak GPIO17'ye taşınmıştır (bkz. bölüm 3).

---

## 3. I2C HATTI → LCD + DS3231 (aynı iki tel)

`SDA = GPIO21`, `SCL = GPIO17` (**varsayılan 22 DEĞİL**, RFID RST orayı aldı).
`LcdDisplay::begin()` → `Wire.begin(21, 17)`, `Wire.setClock(50000)` (50 kHz,
gürültüye dayanıklı), `Wire.setTimeOut(50)`.

### 3a. 16x2 LCD (PCF8574 backpack)

| LCD backpack | Gider → ESP32 |
|---|---|
| VCC | **5V** (VIN hattı) — 3.3V'ta kontrast çok soluk olur |
| GND | **GND** |
| SDA | **GPIO21** |
| SCL | **GPIO17** |

- Adres kodda **otomatik taranır** (`detectAddress()`); 0x27 veya 0x3F fark etmez.
- Backpack üzerindeki mavi potansiyometre = kontrast. Ekran yanıyor ama yazı yoksa
  önce bunu çevirin.
- LCD 5 V'ta beslenince I2C hattı 5 V'a pull-up'lanır. ESP32 pinleri 5 V toleranslı
  değildir; pratikte çoğu kurulum sorunsuz çalışır ama **temiz çözüm**: ya LCD'yi
  3.3 V'ta besleyip kontrastı ayarlamak ya da araya bir I2C level-shifter koymak.
- LCD zorunlu değildir: bulunamazsa firmware uyarı basıp diğer her şeyi çalıştırır,
  2 saniyede bir tekrar bağlanmayı dener.

### 3b. DS3231 RTC

| DS3231 | Gider → ESP32 |
|---|---|
| VCC | **3V3** |
| GND | **GND** |
| SDA | **GPIO21** (LCD ile aynı tel) |
| SCL | **GPIO17** (LCD ile aynı tel) |
| SQW / 32K | **BOŞ – bağlanmaz** |

- I2C adresi 0x68, LCD ile çakışmaz.
- CR2032 pil takılı olmalı. RTC UTC tutar; ekranda/logda `ZAMAN_DILIMI_DK 180`
  (UTC+3) eklenerek gösterilir.
- Akış: açılışta önce RTC'den sistem saati kurulur → Wi-Fi/NTP gelince
  `syncRtcFromNtpIfNeeded()` RTC'yi bir kez günceller → sonraki internet
  kesintilerinde zaman damgaları doğru kalır.

---

## 4. 4x3 KEYPAD (membran, 7 uç)

Kod `KeypadInput.h`: `ROW_COUNT = 4`, `COLUMN_COUNT = 3`.
Kütüphane satırları OUTPUT yapıp sırayla LOW çeker, sütunları `INPUT_PULLUP`
okur → tuşa basınca ilgili sütun LOW olur. **Beslemeye bağlanmaz.**

| Keypad ucu | Gider → ESP32 | config.h |
|---|---|---|
| Satır 1 (üst, `1 2 3`) | **GPIO4** | `KEYPAD_ROW_1` |
| Satır 2 (`4 5 6`) | **GPIO16** | `KEYPAD_ROW_2` |
| Satır 3 (`7 8 9`) | **GPIO32** | `KEYPAD_ROW_3` |
| Satır 4 (`* 0 #`) | **GPIO33** | `KEYPAD_ROW_4` |
| Sütun 1 | **GPIO15** | `KEYPAD_COL_1` |
| Sütun 2 | **GPIO12** | `KEYPAD_COL_2` |
| Sütun 3 | **GPIO2** | `KEYPAD_COL_3` |

Tuş haritası (`KeypadInput.cpp`):
```
1 2 3
4 5 6
7 8 9
* 0 #        * = PIN'i temizle      # = PIN'i onayla/gönder
```
PIN kuralları: min 4, max 6 hane, 15 s işlemsizlikte otomatik sıfırlanır.

### ⚠ KEYPAD_COL_4 (GPIO34) – DİKKAT
`config.h` içinde `KEYPAD_COL_4 34` **tanımlıdır ama `main.cpp` kullanmaz**
(`colPins[]` dizisi yalnızca 3 elemanlıdır). Yani:
- **4x3 keypad kullanın.** 4x4 keypad taktıysanız 4. sütun (`A B C D`) ucu
  **boşta kalır**, o tuşlar hiç okunmaz — bu bir arıza değil, tasarım böyle.
- GPIO34 giriş-only'dir ve **dahili pull-up'ı yoktur**; ileride 4. sütun
  eklenirse 3.3 V'a 10 kΩ harici pull-up şarttır.

### ⚠ Strapping pin uyarıları (boot sorunlarının kaynağı)
- **GPIO12 (MTDI)**: boot anında **LOW** olmalı. Bu hatta **harici pull-up
  KOYMAYIN**; koyarsanız ESP32 flash gerilimini 1.8 V sanar ve kart açılmaz.
- **GPIO15 (MTDO)**: boot anında HIGH olmalı — dahili pull-up bunu sağlar, sorun yok.
- **GPIO2**: çoğu DevKit'te dahili mavi LED'e bağlıdır; tuş taramasında hafifçe
  yanıp sönebilir, normaldir. Boot anında LOW veya boşta olmalı.
- Sonuç: **cihazı flaşlarken keypad üzerinde tuşa basılı tutmayın.**

---

## 5. RGB LED (ORTAK ANOT – aktif LOW)

`main.cpp`'de `AlertSystem` yapıcısına gönderilen tüm `activeHigh` bayrakları
**`false`**'tur → firmware LED'i yakmak için pini **LOW** yapar. Bu ancak ortak
anot bağlantıda doğru çalışır.

```
ESP32 3V3 ──────────► RGB LED ortak (en uzun) bacak = ANOT
GPIO25 ──[220-330Ω]──► KIRMIZI katot
GPIO26 ──[220-330Ω]──► YEŞİL   katot
GPIO13 ──[220-330Ω]──► MAVİ    katot
```

| Renk | ESP32 | config.h | Ne zaman yanar (koddan) |
|---|---|---|---|
| Kırmızı | **GPIO25** | `LED_RED_PIN` | Erişim reddi, hatalı PIN, kilitlenme, zorla giriş, cihaz hatası, **kapı 20 sn'den uzun açık alarmı** |
| Yeşil | **GPIO26** | `LED_GREEN_PIN` | Başarılı giriş (`Success`), offline yanıp sönme |
| Mavi | **GPIO13** | `LED_BLUE_PIN` | Tuşa basma geri bildirimi + **PIN girişi aktifken sabit yanar** |

> Ayrı ayrı 3 tek renkli LED kullanıyorsanız: her LED'in **anodu 3.3 V'a**,
> katodu direnç üzerinden ilgili GPIO'ya gider. Ortak KATOT bir LED takarsanız
> mantık ters döner (sürekli yanar / hiç yanmaz) — o durumda `main.cpp`'deki
> `false` bayraklarını `true` yapmanız gerekir.

---

## 6. BUZZER → GPIO14 (LEDC PWM, aktif LOW)

`AlertSystem::begin()`: LEDC kanal 7, 10-bit çözünürlük, `ledcAttachPin(14, 7)`.
Buzzer **pasif** tiptir → sadece HIGH/LOW ile ötmez, `ledcWriteTone()` ile kare
dalga üretilir. `buzzerActiveHigh = false` olduğu için **boştayken hat HIGH**
(maks duty) bırakılır.

| Buzzer | Gider → ESP32 |
|---|---|
| I/O (S / SIG) | **GPIO14** |
| VCC | **3V3** (veya modül 5V istiyorsa 5V) |
| GND | **GND** |

Ton frekansları (`setBuzzer()`):

| Olay | Frekans |
|---|---|
| Başarılı giriş / tuş sesi | 3200 Hz |
| Kapı çok uzun açık alarmı | 4000 Hz |
| Red / hatalı PIN / hata | 2400 Hz |
| Diğer | 2800 Hz |

---

## 7. RÖLE + KAPI KİLİDİ → GPIO27 (⚠ açık kollektör / open-drain)

Bu projenin **en çok karıştırılan** noktası. `LockController::begin()`:

```cpp
pinMode(relayPin, OUTPUT_OPEN_DRAIN);   // GPIO27
digitalWrite(relayPin, LOW);            // boşta: ESP32 hattı GND'ye çeker → RÖLE PASİF
...
digitalWrite(relayPin, HIGH);           // aç: ESP32 hattı BIRAKIR (yüksek empedans)
                                        // → röle kartının kendi pull-up'ı IN'i 5V'a çeker
                                        // → RÖLE ÇEKER
```

Yani **ESP32 röleyi sürmez, hattı serbest bırakır.** Bunun amacı 3.3 V'luk MCU ile
5 V lojikli röle kartını seviye çeviriciye gerek kalmadan sürmektir.

### Kontrol tarafı (lojik)

| Röle modülü | Gider → ESP32 |
|---|---|
| IN / SIG | **GPIO27** |
| VCC | **5V** |
| GND | **GND** (ortak) |

> Röle kartında `JD-VCC` ve `VCC` jumper'ı varsa **jumper takılı** kalsın
> (tek besleme modu). Ayrı besleme kullanacaksanız jumper'ı çıkarıp JD-VCC'ye
> 5 V, VCC'ye ESP32 3.3 V verin; GND yine ortak.

### Güç tarafı (kilit devresi – kuru kontak)

```
+12 V ────────────────► Röle  COM
Röle  NO ─────────────► Kilit (+) ucu
Kilit (−) ucu ────────► 12 V GND
Kilit uçlarına ters paralel  1N4007  (katot = +12V tarafı)   ← flyback, ŞART
```

- **NO (Normally Open)** kullanılır → normalde kilit enerjisiz = kapalı
  (fail-secure elektrikli kilit karşılığı).
- Elektrik kesildiğinde kapının **açılması** gereken bir uygulama (yangın çıkışı)
  ise fail-safe kilit + **NC** kontağı kullanılmalıdır.
- Zamanlama (`LockController.h`): darbe **2000 ms** açık, ardından **1000 ms**
  cooldown. Cooldown sırasında gelen ikinci istek yok sayılır.
- Firmware, sensör kapıyı zaten AÇIK gösteriyorsa röleyi hiç tetiklemez.

---

## 8. KAPI SENSÖRÜ (REED) → GPIO35 (⚠ harici pull-up ŞART)

GPIO35 **giriş-only** bir pindir ve **dahili pull-up'ı YOKTUR**.
`main.cpp` → `pinMode(SENSOR_PIN, INPUT);` (pull-up istenmemiş, çünkü mümkün değil).

```
ESP32 3V3 ──[ 10 kΩ ]──┬──► ESP32 GPIO35
                       │
                  Reed switch
                       │
                     GND
```

| Kapı durumu | Reed kontağı | GPIO35 seviyesi | Firmware yorumu |
|---|---|---|---|
| KAPALI (mıknatıs yakın) | Kapalı → GND'ye çeker | **LOW** | `DOOR_SENSOR_CLOSED_LEVEL = LOW` → **KAPALI** |
| AÇIK (mıknatıs uzak) | Açık | **HIGH** (10k pull-up) | **AÇIK** |

- Reed switch'in bir ucu **GPIO35**, diğer ucu **GND**. Yön/polarite yok.
- Mıknatıs kapı kanadına, reed gövdesi kasaya monte edilir; kapı kapalıyken
  aralarındaki mesafe **< 10 mm** olmalı.
- Yazılım debounce: **500 ms**. Bu süreden kısa titremeler yok sayılır.
- **10k direnci unutursanız** hat havada kalır (floating), kapı durumu rastgele
  AÇIK/KAPALI zıplar ve boşuna alarm çalar. Bu, sahada en sık yapılan hatadır.
- Kapı **20 saniyeden** uzun açık kalırsa (`DOOR_OPEN_ALARM_DELAY_MS = 20000`):
  buzzer 4000 Hz'de kesikli çalar + **kırmızı LED** yanar + LCD alarm ekranı.
  Kapı kapanınca alarm otomatik durur.

---

## 9. BAĞLANMAYAN / KULLANILMAYAN PİNLER

| config.h satırı | Durum |
|---|---|
| `SD_CS_PIN 0` | **Kullanılmıyor.** `platformio.ini`'de SD kütüphanesi yok; `OfflineQueue` çevrimdışı kayıtları **LittleFS** (dahili flash, `/olaylar.bin`) üzerinde tutuyor. **SD kart modülü takmayın.** GPIO0 aynı zamanda BOOT butonudur, bir şey bağlamak boot'u bozar. |
| `KEYPAD_COL_4 34` | Tanımlı ama `main.cpp` kullanmıyor (bkz. bölüm 4). Boşta bırakın. |
| `WIFI_IDENTITY` / `WIFI_USERNAME` | Boş → normal WPA2-Personal Wi-Fi. Sadece eduroam gibi WPA2-Enterprise için doldurulur. |

**Asla kullanmayın:** GPIO6–GPIO11 (dahili SPI flash'a bağlı, kart kilitlenir),
GPIO1/GPIO3 (UART0 = seri monitör, 115200 baud).

---

## 10. TAM PİN HARİTASI (tek tablo – kontrol listesi)

| GPIO | Yön | Bağlı malzeme | Malzeme pini | Aktif seviye / not |
|---|---|---|---|---|
| 2 | I/O | Keypad | Sütun 3 | INPUT_PULLUP, strapping |
| 4 | OUT | Keypad | Satır 1 | Tarama sırasında LOW |
| 5 | OUT | MFRC522 | SDA / SS | CS, aktif LOW |
| 12 | I/O | Keypad | Sütun 2 | INPUT_PULLUP, **harici pull-up YASAK** |
| 13 | OUT | RGB LED | Mavi katot | **LOW = yanar** |
| 14 | OUT | Buzzer | I/O | LEDC PWM, boşta HIGH |
| 15 | I/O | Keypad | Sütun 1 | INPUT_PULLUP, strapping |
| 16 | OUT | Keypad | Satır 2 | — |
| 17 | OUT | LCD + DS3231 | SCL | I2C @ 50 kHz |
| 18 | OUT | MFRC522 | SCK | VSPI |
| 19 | IN | MFRC522 | MISO | VSPI |
| 21 | I/O | LCD + DS3231 | SDA | I2C @ 50 kHz |
| 22 | OUT | MFRC522 | RST | Donanım reset |
| 23 | OUT | MFRC522 | MOSI | VSPI |
| 25 | OUT | RGB LED | Kırmızı katot | **LOW = yanar** |
| 26 | OUT | RGB LED | Yeşil katot | **LOW = yanar** |
| 27 | OUT | Röle modülü | IN | **OPEN-DRAIN**: LOW=pasif, HIGH(serbest)=çeker |
| 32 | OUT | Keypad | Satır 3 | — |
| 33 | OUT | Keypad | Satır 4 | — |
| 34 | IN | *(boşta)* | — | KEYPAD_COL_4, kullanılmıyor |
| 35 | IN | Reed sensör | Bir uç | **Giriş-only, 10k harici pull-up ŞART.** LOW=KAPALI |
| 3V3 | PWR | RFID, DS3231, RGB anot, buzzer, 10k pull-up | VCC | — |
| VIN | PWR | 5 V regülatör çıkışı | — | — |
| 5V→ | PWR | LCD backpack, röle modülü | VCC | — |
| GND | PWR | **Hepsi** | GND | Tek ortak nokta |

---

## 11. SİNYAL AKIŞI – bir kart okutulduğunda ne oluyor?

1. **Kart** → MFRC522 anteni UID okur → SPI (GPIO5/18/19/23) üzerinden ESP32'ye.
2. **ESP32** → `processCredential()` → MQTT ile `MQTT_BROKER_HOST:1883` adresine
   `EntryEvent` yayınlar, `CIHAZ_ID=1` / `DOOR_ID=1`.
3. **LCD** (GPIO21/17) → "Kontrol ediliyor" yazar; durum `OKUNUYOR`.
4. **Backend** kararını MQTT ile döner (6 sn zaman aşımı).
   - MQTT yoksa → `AccessControl::verifyOfflineAccess()` yerel PIN listesine bakar;
     olay LittleFS kuyruğuna yazılır, bağlantı gelince gönderilir.
5. **ONAYLANDI** → yeşil LED (GPIO26 LOW) + 3200 Hz bip (GPIO14) +
   `LockController::unlockDoor()` → **GPIO27 open-drain serbest bırakılır** →
   röle çeker → 12 V kilide gider → kapı açılır → **2000 ms** sonra GPIO27 LOW,
   röle bırakır.
6. **REDDEDİLDİ** → kırmızı LED (GPIO25 LOW) + 2400 Hz üçlü bip + LCD "Reddedildi".
7. **Reed sensör** (GPIO35) kapının fiziksel olarak açıldığını görür → 500 ms
   debounce → MQTT `doorStatus` yayınlanır → 20 sn'den uzun açık kalırsa alarm.

---

## 12. Devreye alma sırası (hata ayıklama için)

Her adımda seri monitörü (115200) izleyin; ilgili satır gelmeden sonrakine geçmeyin.

1. Sadece ESP32 + USB → boot mesajı gelsin (`[SYSTEM] SecureDoor baslatiliyor...`).
2. Ortak GND'leri çek.
3. I2C: LCD + DS3231 → `[LCD] 16x2 I2C LCD hazir (adres=0x..)` ve `[RTC] DS3231 bulundu`.
4. RFID → `[CardReader] MFRC522 hazir (VersionReg=0x92)` (0x00/0xFF ise kablo/besleme).
5. Keypad → tuşlara bas, mavi LED yansın ve LCD'de `*` sayısı artsın.
6. RGB LED + buzzer → açılışta bir kısa test bipi ve yeşil LED beklenir.
7. Reed sensör + 10k → `[KAPI] Baslangic fiziksel durumu: KAPALI (GPIO35=0 ...)`.
8. En son röle + 12 V kilit → `[KILIT] GPIO27 AKTIF/HIGH ... 2000 ms`.
