# Kart Kayıt İstasyonu

Yeni kartları sisteme tanımlamak için kullanılan masa üstü okuyucu.
Bir **ESP32** ve bir **MFRC522 (RC522)** kart okuyucudan oluşur. Okutulan kartın
UID'sini seri porta düzgün biçimde yazar; web panelindeki **Kart Yetkilendirme** sayfası
bu UID'yi otomatik alıp seçilen kullanıcıya atar.

## Bağlantı

| MFRC522 | ESP32 |
|---|---|
| SDA / SS | GPIO5 |
| SCK | GPIO18 |
| MOSI | GPIO23 |
| MISO | GPIO19 |
| RST | GPIO22 |
| 3.3V | 3V3 (**5V bağlamayın**) |
| GND | GND |
| IRQ | boş |

Pinler kapı cihazıyla aynıdır. Farklı pin kullanacaksanız `include/config.h` dosyasını düzenleyin.
İsteğe bağlı buzzer için `BUZZER_PIN`, durum LED'i için `STATUS_LED_PIN` ayarlanabilir.

## Yükleme (PlatformIO)

VS Code'da bu klasörü (`kart-kayit-istasyonu`) açın, ESP32'yi USB ile bağlayın:

```powershell
cd kart-kayit-istasyonu
pio run -t upload
pio device monitor
```

## Seri ekran çıktısı (115200 baud)

```
============================================
  KART OKUNDU  #1
--------------------------------------------
  UID          : 04:A1:B2:C3
  UID (HEX)    : 04A1B2C3
  Boyut        : 4 bayt
  Kart tipi    : MIFARE 1KB
--------------------------------------------
UID:04:A1:B2:C3
============================================
```

- `UID:` ile başlayan satır web panelinin okuduğu satırdır; biçimi değiştirmeyin.
- UID biçimi kapı cihazıyla birebir aynıdır (büyük harf, `:` ile ayrılmış baytlar).
- Kart okuyucu üzerinde bekletilirse tekrar tekrar yazılmaz; çekip yeniden okutun.
- Seri monitörde `i` yazıp Enter'a basarsanız istasyon durumu, `h` ile yardım görüntülenir.

## İstasyon köprüsü (panel sunucudan açılıyorsa)

Tarayıcılar USB'ye (Web Serial) yalnızca HTTPS veya `localhost` sayfalarından erişebilir.
Panel `http://10.9.2.50` gibi bir adresten açılıyorsa istasyonun takılı olduğu Windows
bilgisayarda **köprü** çalışır: istasyonu kendiliğinden bulur, okunan UID'yi sunucuya iletir;
Kart Yetkilendirme sayfası UID'yi forma yazar ("İstasyon bağlı · BİLGİSAYAR-ADI").

1. Sunucudaki `.env` dosyasında `ISTASYON_ANAHTARI` tanımlı olmalıdır (en az 16 karakter,
   `openssl rand -hex 24`). Değiştirince `docker compose up -d backend`.
2. Bilgisayarda `kopru\kur.cmd` dosyasına çift tıklayın; sunucu adresini ve anahtarı girin.
   Ek program gerekmez (Windows PowerShell), yönetici yetkisi istemez.
3. Köprü Windows açılışında gizlice başlar. İstasyonu takın, kartı okutun.

- Kurulum yeri: `%LOCALAPPDATA%\SecureLabKopru` (kayıtlar `kopru.log`).
- Kaldırmak için `kopru\kaldir.cmd`.
- Köprü COM portunu tuttuğu için o bilgisayarda seri monitör/Web Serial aynı anda kullanılamaz.

## Web panelinden kart tanımlama

1. Web panelinde yönetici hesabıyla giriş yapın (başlangıç hesapları için ana [README](../README.md#4-hesaplar-ve-ilk-şifreler)) ve **Kart Yetkilendirme** sayfasını açın.
2. Köprü kuruluysa üstte **İstasyon bağlı** yazar; 3. adıma geçin. Sayfa `http://localhost`
   üzerinden açıldıysa **İstasyona Bağlan** düğmesine basıp ESP32'nin COM portunu da seçebilirsiniz (Chrome/Edge).
3. Kartı okutun, UID alanı otomatik dolar.
4. Kartın sahibini ad-soyad listesinden seçip **Kartı Yetkilendir** düğmesine basın.
5. Kart aynı sayfadaki listede görünür; kapıda okutulduğunda sahibinin adıyla erişim kaydı oluşur.

> Web Serial kullanırken PlatformIO seri monitörünü kapatın; aynı COM portunu
> aynı anda yalnızca bir program kullanabilir.

Web Serial desteklemeyen bir tarayıcıda seri monitördeki UID'yi kopyalayıp
sayfadaki alana elle yapıştırmanız yeterlidir (`04A1B2C3`, `04 a1 b2 c3` gibi
biçimler de otomatik düzeltilir).
