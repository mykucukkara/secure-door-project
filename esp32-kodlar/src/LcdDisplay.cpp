#include "LcdDisplay.h"
#include "config.h"

LcdDisplay::LcdDisplay(uint8_t sdaPin, uint8_t sclPin)
    : _sdaPin(sdaPin),
      _sclPin(sclPin),
      _address(0),
      _available(false),
      _lcd(nullptr),
      _lastFirstLine(),
      _lastSecondLine(),
      _lastRefreshAtMs(0) {}

bool LcdDisplay::begin() {
    Wire.begin(_sdaPin, _sclPin);
    Wire.setClock(50000);
    Wire.setTimeOut(50);

    if (!detectAddress()) {
        Serial.println(
            "[LCD] I2C LCD bulunamadi. VCC, GND, SDA21 ve SCL17 "
            "baglantilarini kontrol edin. "
            "Diger sistemler normal calismaya devam edecek."
        );
        return false;
    }

    return initializeDisplay();
}

bool LcdDisplay::initializeDisplay() {
    if (_lcd == nullptr) {
        _lcd = new LiquidCrystal_I2C(_address, COLUMN_COUNT, 2);
    }

    _lcd->begin(COLUMN_COUNT, 2);
    _lcd->backlight();
    _lcd->clear();
    _lcd->noCursor();
    _lcd->noBlink();
    _available = true;
    _lastRefreshAtMs = millis();
    writeCurrentLines();

    Serial.printf("[LCD] 16x2 I2C LCD hazir (adres=0x%02X).\n", _address);
    return true;
}

bool LcdDisplay::isAvailable() const {
    return _available;
}

void LcdDisplay::update() {
    const uint32_t now = millis();
    if (now - _lastRefreshAtMs < 2000) return;
    _lastRefreshAtMs = now;

    if (!_available) {
        if (_address == 0 && !detectAddress()) return;

        Wire.beginTransmission(_address);
        if (Wire.endTransmission() != 0) return;

        Serial.println("[LCD] I2C baglantisi geri geldi; ekran yenileniyor.");
        initializeDisplay();
        return;
    }

    Wire.beginTransmission(_address);
    if (Wire.endTransmission() != 0) {
        _available = false;
        Serial.println("[LCD] I2C baglantisi kesildi; otomatik tekrar denenecek.");
        return;
    }

    _lcd->display();
    _lcd->backlight();
    writeCurrentLines();
}

void LcdDisplay::showBoot() {
    showLines("SecureLab", "Baslatiliyor...");
}

void LcdDisplay::showIdle(bool doorOpen) {
    showLines(
        "Kart/PIN bekle",
        doorOpen ? "Kapi: ACIK" : "Kapi: KAPALI"
    );
}

void LcdDisplay::showPinEntry(uint8_t pinLength) {
    String masked = "SIFRE: ";
    for (uint8_t index = 0; index < pinLength; ++index) {
        masked += '*';
    }
    showLines(masked, "# ILE GONDER");
}

void LcdDisplay::showPinInvalid() {
    showLines("SIFRE GECERSIZ", "4-6 HANE GIRIN");
}

void LcdDisplay::showChecking() {
    showLines("Dogrulaniyor...", "Lutfen bekleyin");
}

void LcdDisplay::showApproved() {
    showLines("ONAYLANDI", "KILIT ACILIYOR");
}

void LcdDisplay::showDenied() {
    showLines("REDDEDILDI", "KAPI KAPALI");
}

void LcdDisplay::showConnectionUnavailable() {
    showLines("BAGLANTI YOK", "TEKRAR DENEYIN");
}

void LcdDisplay::showAlarm() {
    showLines("UYARI / ALARM", "Kapiyi kontrol");
}

void LcdDisplay::showEthernetConnecting() {
    showLines("ETHERNET", "BAGLANIYOR...");
}

void LcdDisplay::showEthernetConnected(const String &ipAddress) {
    showLines("ETHERNET TAMAM", "IP:" + ipAddress);
}

void LcdDisplay::showEthernetDisconnected() {
    showLines("ETHERNET YOK", "KABLO/DHCP BAK");
}

void LcdDisplay::showMqttWaiting() {
    showLines("ETHERNET TAMAM", "MQTT BEKLENIYOR");
}

void LcdDisplay::showMqttConnected() {
    showLines("MQTT BAGLANDI", "SUNUCU AKTIF");
}

void LcdDisplay::showMqttDisconnected() {
    showLines("MQTT BAGLANMADI", "SUNUCU/PORT BAK");
}

bool LcdDisplay::detectAddress() {
    const uint8_t preferredAddresses[] = {0x27, 0x3F};
    for (const uint8_t address : preferredAddresses) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) {
            _address = address;
            Serial.printf("[LCD] I2C LCD bulundu: 0x%02X\n", address);
            return true;
        }
    }

    for (uint8_t address = 1; address < 127; ++address) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) {
            Serial.printf("[LCD] I2C cihaz bulundu: 0x%02X\n", address);

            const bool isPcf8574Address =
                (address >= 0x20 && address <= 0x27)
                || (address >= 0x38 && address <= 0x3F);
            if (isPcf8574Address) {
                _address = address;
                return true;
            }
        }
    }
    return false;
}

void LcdDisplay::showLines(
    const String &firstLine,
    const String &secondLine
) {
    const String formattedFirst = formatLine(firstLine);
    const String formattedSecond = formatLine(secondLine);
    if (
        formattedFirst == _lastFirstLine
        && formattedSecond == _lastSecondLine
    ) {
        return;
    }

    _lastFirstLine = formattedFirst;
    _lastSecondLine = formattedSecond;
    if (!_available) return;

    writeCurrentLines();
    _lastRefreshAtMs = millis();
}

void LcdDisplay::writeCurrentLines() {
    if (!_available || _lcd == nullptr) return;

    _lcd->setCursor(0, 0);
    _lcd->print(formatLine(_lastFirstLine));
    _lcd->setCursor(0, 1);
    _lcd->print(formatLine(_lastSecondLine));
}

String LcdDisplay::formatLine(const String &text) const {
    String formatted = text.substring(0, COLUMN_COUNT);
    while (formatted.length() < COLUMN_COUNT) {
        formatted += ' ';
    }
    return formatted;
}