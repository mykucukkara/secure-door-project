#include "CardReader.h"

#ifdef ARDUINO
#include <SPI.h>

time_t (*CardReader::_saatAlici)() = nullptr;
bool (*CardReader::_rtcdenMiGeliyor)() = nullptr;

void CardReader::setZamanKaynagi(time_t (*saatAlici)(), bool (*rtcdenMiGeliyor)()) {
    _saatAlici = saatAlici;
    _rtcdenMiGeliyor = rtcdenMiGeliyor;
}

CardReader::CardReader(uint8_t ssPin, uint8_t rstPin, uint8_t sckPin, uint8_t misoPin, uint8_t mosiPin)
    : _mfrc522(ssPin, rstPin),
      _ssPin(ssPin), _rstPin(rstPin),
      _sckPin(sckPin), _misoPin(misoPin), _mosiPin(mosiPin) {}

bool CardReader::okuyucuyuBaslat() {
    // SPI hatti W5500 ile ortaktir ve main.cpp'de bir kez baslatilir.
    // Burada SPI.end()/SPI.begin() yapmak aktif Ethernet oturumlarini bozar.
    // Yalnizca RFID'nin kendi CS ve reset hatlarini yeniden baslat.
    // Bazı RC522 klonları soft reset sırasında kilitli kalabiliyor. Her
    // başlangıç/yeniden bağlanma denemesinde RST hattından gerçek donanım
    // reseti uygulayarak SPI haberleşmesini temiz bir durumdan başlat.
    pinMode(_ssPin, OUTPUT);
    digitalWrite(_ssPin, HIGH);
    pinMode(_rstPin, OUTPUT);
    digitalWrite(_rstPin, LOW);
    delay(50);
    digitalWrite(_rstPin, HIGH);
    delay(250);

    _mfrc522.PCD_Init();
    _mfrc522.PCD_AntennaOn();
    _mfrc522.PCD_SetAntennaGain(MFRC522::RxGain_max);
    byte version = _mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
    _sonVersionReg = version;
    const bool bagli = !(version == 0x00 || version == 0xFF);
    if (bagli) {
        Serial.printf("[CardReader] MFRC522 hazir (VersionReg=0x%02X).\n", version);
    } else {
        Serial.printf(
            "[CardReader] RFID okuyucu bulunamadi (VersionReg=0x%02X). Guc ve SPI kablolarini kontrol edin.\n",
            version
        );
    }
    return bagli;
}

void CardReader::begin() {
    // ONEMLI: parametresiz SPI.begin() ESP32'nin donanimsal VARSAYILAN VSPI
    // pinlerini (SCK=18, MISO=19, MOSI=23) kullanir. Bu pinler config.h'de
    // tanimlanan ozel RFID pinleriyle (orn. SCK=32, MISO=34, MOSI=13) AYNI
    // DEGILSE, yazilim ile fiziksel kablolama tamamen farkli pinlerde
    // konusur ve RC522 hicbir zaman yanit vermez. Bu yuzden pinleri burada
    // acikca belirtiyoruz.
    _status = okuyucuyuBaslat() ? ReaderStatus::ACTIVE : ReaderStatus::DISCONNECTED;
    _sonBaglantiDenemesi = millis();
    _sonSaglikKontrolu = millis();
}

void CardReader::update() {
    _newReadFlag = false;
    const unsigned long simdi = millis();

    // Okuyucu bağlantısı koptuysa 3 saniyede bir donanımı otomatik yeniden başlatmayı dener
    if (_status != ReaderStatus::ACTIVE) {
        if (simdi - _sonBaglantiDenemesi >= 3000) {
            _sonBaglantiDenemesi = simdi;
            if (okuyucuyuBaslat()) {
                _status = ReaderStatus::ACTIVE;
                _sonSaglikKontrolu = simdi;
                Serial.println("[CardReader] RFID Okuyucu baglantisi yeniden kuruldu.");
            }
        }
        return; 
    }

    // Okuyucu calisirken sonradan koparsa da algila ve yeniden baslat.
    if (simdi - _sonSaglikKontrolu >= 3000) {
        _sonSaglikKontrolu = simdi;
        const byte version = _mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
        _sonVersionReg = version;
        if (version == 0x00 || version == 0xFF) {
            _status = ReaderStatus::DISCONNECTED;
            _sonBaglantiDenemesi = simdi;
            Serial.printf(
                "[CardReader] RFID baglantisi koptu (VersionReg=0x%02X); "
                "otomatik yeniden baslatilacak.\n",
                version
            );
            return;
        }
    }

    if (!_mfrc522.PICC_IsNewCardPresent() || !_mfrc522.PICC_ReadCardSerial()) {
        return; 
    }

    std::string uid = uidToString(_mfrc522.uid.uidByte, _mfrc522.uid.size);
    _okumaSayisi++;

    // --- DETAYLI SERI EKRAN CIKTISI ---
    MFRC522::PICC_Type piccType = _mfrc522.PICC_GetType(_mfrc522.uid.sak);
    Serial.println(F("========================================"));
    Serial.println(F("[CardReader] KART OKUNDU"));
    Serial.print(F("  UID          : "));
    Serial.println(uid.c_str());
    Serial.print(F("  UID Boyutu   : "));
    Serial.print(_mfrc522.uid.size);
    Serial.println(F(" byte"));
    Serial.print(F("  SAK          : 0x"));
    Serial.println(_mfrc522.uid.sak, HEX);
    Serial.print(F("  Kart Tipi    : "));
    Serial.println(_mfrc522.PICC_GetTypeName(piccType));
    Serial.print(F("  Zaman (ms)   : "));
    Serial.println(millis());
    if (_saatAlici != nullptr) {
        const time_t simdiEpoch = _saatAlici();
        struct tm zamanBilgisi;
        // time(nullptr) (dolayisiyla _saatAlici) ham UTC epoch dondurur;
        // Turkiye (+3 saat) farkini configTime()'in ayarladigi TZ ortam
        // degiskeni uzerinden yalnizca localtime_r/getLocalTime uygular.
        // gmtime_r kullanmak +3 saati atlayip dogrudan UTC'yi gosterirdi -
        // "3 saat geri" sikayetinin sebebi tam olarak buydu.
        localtime_r(&simdiEpoch, &zamanBilgisi);
        char tarihSaat[24];
        strftime(tarihSaat, sizeof(tarihSaat), "%Y-%m-%d %H:%M:%S", &zamanBilgisi);
        const bool rtcden = (_rtcdenMiGeliyor != nullptr) && _rtcdenMiGeliyor();
        Serial.print(F("  Saat         : "));
        Serial.print(tarihSaat);
        Serial.println(rtcden ? F(" (RTC)") : F(" (NTP)"));
    }
    Serial.println(F("========================================"));

    _mfrc522.PICC_HaltA();
    _mfrc522.PCD_StopCrypto1();

    if (uid.empty() || !uidGecerliMi(uid)) {
        _status = ReaderStatus::READ_ERROR;
        Serial.println("[CardReader] Gecersiz veya bozuk UID okundu!");
        return;
    }

    if (isDuplicateRead(uid, _lastCardId, simdi, _lastReadTimestamp, 6000)) {
        Serial.println(F("[CardReader] Tekrarli okuma (debounce) - atlaniyor."));
        return;
    }

    _lastCardId = uid;
    _lastReadTimestamp = simdi;
    _newReadFlag = true;
    _status = ReaderStatus::ACTIVE;
}

bool CardReader::hasNewRead() const { return _newReadFlag; }
std::string CardReader::getLastCardId() const { return _lastCardId; }
unsigned long CardReader::getLastReadTimestamp() const { return _lastReadTimestamp; }
ReaderStatus CardReader::getStatus() const { return _status; }

#ifdef DEBUG_FAKE_CARD
void CardReader::injectFakeRead(const std::string &fakeUid, unsigned long timestampMs) {
    if (isDuplicateRead(fakeUid, _lastCardId, timestampMs, _lastReadTimestamp)) {
        _newReadFlag = false;
        return;
    }
    _lastCardId = fakeUid;
    _lastReadTimestamp = timestampMs;
    _newReadFlag = true;
    _status = ReaderStatus::ACTIVE;
}
#endif
#endif

std::string CardReader::uidToString(const uint8_t *uidBytes, uint8_t uidSize) {
    if (uidSize < CardReader::UID_MIN_BAYT || uidSize > CardReader::UID_MAX_BAYT) {
        return "";
    }

    static const char hexChars[] = "0123456789ABCDEF";
    std::string result;
    result.reserve(uidSize * 3 - 1);

    for (uint8_t i = 0; i < uidSize; i++) {
        if (i > 0) {
            result += ':';
        }
        result += hexChars[(uidBytes[i] >> 4) & 0x0F];
        result += hexChars[uidBytes[i] & 0x0F];
    }
    return result;
}

bool CardReader::uidGecerliMi(const std::string &uid) {
    if (uid.size() < UID_MIN_BAYT * 3 - 1 || uid.size() > UID_MAX_BAYT * 3 - 1) {
        return false;
    }
    if ((uid.size() + 1) % 3 != 0) {
        return false;   
    }

    for (size_t i = 0; i < uid.size(); i++) {
        const bool ayiracKonumu = (i % 3 == 2);
        const char c = uid[i];
        if (ayiracKonumu) {
            if (c != ':') return false;
        } else {
            const bool hexMi = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F');
            if (!hexMi) return false;   
        }
    }
    return true;
}

bool CardReader::isDuplicateRead(const std::string &newUid, const std::string &lastUid,
                                 uint32_t newTimestampMs, uint32_t lastTimestampMs,
                                 uint32_t debounceMs) {
    if (newUid != lastUid) {
        return false;
    }
    return (newTimestampMs - lastTimestampMs) < debounceMs;
}
