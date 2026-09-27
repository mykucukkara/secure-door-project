/*
 * SecureLab — Kart Kayıt İstasyonu
 * ---------------------------------------------------------------------------
 * ESP32 + MFRC522 (RC522) kart okuyucu.
 *
 * Görevi: Okutulan RFID kartın UID'sini seri porta düzgün ve okunaklı biçimde
 * yazmak. Yönetici bu UID'yi web panelindeki "Kart Kayıt" sayfasında bir
 * kullanıcıya atar. Sayfa, Chrome/Edge'in Web Serial özelliğiyle istasyona
 * doğrudan bağlanıp UID'yi otomatik de alabilir.
 *
 * Seri çıktı biçimi (115200 baud):
 *   - İnsan için okunaklı bir kutu (UID, HEX, bayt sayısı, kart tipi)
 *   - Makine için tek satır:  UID:04:A1:B2:C3
 *     (Web paneli yalnızca "UID:" ile başlayan satırı kullanır.)
 *
 * UID biçimi kapı cihazıyla (esp32-kodlar/src/CardReader.cpp) birebir aynıdır:
 * büyük harf, iki haneli HEX baytlar, aralarında ':' (ör. 04:A1:B2:C3).
 *
 * Seri komutlar:  i = istasyon bilgisi   h = yardım
 */

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>

#include "config.h"

namespace {

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

bool readerOnline = false;
uint32_t readCount = 0;
String lastUid;
unsigned long lastReadMs = 0;
unsigned long lastHealthCheckMs = 0;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

String uidToString(const MFRC522::Uid &uid, char separator) {
    static const char HEX_CHARS[] = "0123456789ABCDEF";
    String out;
    out.reserve(uid.size * 3);
    for (byte i = 0; i < uid.size; i++) {
        if (i > 0 && separator != '\0') out += separator;
        out += HEX_CHARS[(uid.uidByte[i] >> 4) & 0x0F];
        out += HEX_CHARS[uid.uidByte[i] & 0x0F];
    }
    return out;
}

bool isValidUidSize(byte size) {
    return size == 4 || size == 7 || size == 10;
}

void setLed(bool on) {
#if STATUS_LED_PIN >= 0
    digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
#endif
}

void beep(unsigned int frequency, unsigned long durationMs) {
#if BUZZER_PIN >= 0
    tone(BUZZER_PIN, frequency, durationMs);
    delay(durationMs);
    noTone(BUZZER_PIN);
#else
    (void)frequency;
    (void)durationMs;
#endif
}

void blinkLed(int times, int onMs, int offMs) {
    for (int i = 0; i < times; i++) {
        setLed(true);
        delay(onMs);
        setLed(false);
        delay(offMs);
    }
}

void printLine(char c = '-', int width = 44) {
    for (int i = 0; i < width; i++) Serial.print(c);
    Serial.println();
}

byte readVersion() {
    return rfid.PCD_ReadRegister(MFRC522::VersionReg);
}

bool versionLooksValid(byte version) {
    return !(version == 0x00 || version == 0xFF);
}

// ---------------------------------------------------------------------------
// Okuyucu başlatma / sağlık kontrolü
// ---------------------------------------------------------------------------

bool initReader() {
    // Bazı RC522 klonları yazılımsal resetten sonra kilitli kalabiliyor;
    // önce RST hattından donanım reseti uygula.
    pinMode(RFID_SS_PIN, OUTPUT);
    digitalWrite(RFID_SS_PIN, HIGH);
    pinMode(RFID_RST_PIN, OUTPUT);
    digitalWrite(RFID_RST_PIN, LOW);
    delay(50);
    digitalWrite(RFID_RST_PIN, HIGH);
    delay(100);

    rfid.PCD_Init();
    rfid.PCD_AntennaOn();
    rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);

    const byte version = readVersion();
    readerOnline = versionLooksValid(version);

    if (readerOnline) {
        Serial.printf("[OK]   RC522 okuyucu hazir (VersionReg=0x%02X)\n", version);
    } else {
        Serial.printf("[HATA] RC522 okuyucu bulunamadi (VersionReg=0x%02X)\n", version);
        Serial.println("       3.3V/GND ve SPI kablolarini (SS=5, SCK=18, MOSI=23, MISO=19, RST=22) kontrol edin.");
    }
    return readerOnline;
}

void checkReaderHealth() {
    const unsigned long now = millis();
    if (now - lastHealthCheckMs < READER_HEALTH_CHECK_MS) return;
    lastHealthCheckMs = now;

    const bool ok = versionLooksValid(readVersion());
    if (ok && !readerOnline) {
        readerOnline = true;
        Serial.println("[OK]   Okuyucu baglantisi geri geldi.");
    } else if (!ok) {
        if (readerOnline) Serial.println("[UYARI] Okuyucu yanit vermiyor, yeniden baslatiliyor...");
        readerOnline = false;
        initReader();
    }
}

// ---------------------------------------------------------------------------
// Ekran çıktıları
// ---------------------------------------------------------------------------

void printBanner() {
    Serial.println();
    printLine('=');
    Serial.println("  SecureLab - KART KAYIT ISTASYONU");
    Serial.println("  SUBU Bilgisayar Muhendisligi");
    printLine('=');
    Serial.println("  Karti okuyucuya yaklastirin. UID asagida gorunecek.");
    Serial.println("  Web paneli > Kart Kayit sayfasi bu ciktiyi otomatik okuyabilir.");
    Serial.println("  Komutlar: i = bilgi, h = yardim");
    printLine('=');
}

void printInfo() {
    printLine('-');
    Serial.println("  ISTASYON BILGISI");
    Serial.printf("  Okuyucu durumu : %s\n", readerOnline ? "HAZIR" : "BAGLI DEGIL");
    Serial.printf("  Okunan kart    : %lu\n", static_cast<unsigned long>(readCount));
    Serial.printf("  Son UID        : %s\n", lastUid.length() ? lastUid.c_str() : "-");
    Serial.printf("  Pinler         : SS=%d RST=%d SCK=%d MISO=%d MOSI=%d\n",
                  RFID_SS_PIN, RFID_RST_PIN, RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN);
    Serial.printf("  Calisma suresi : %lu sn\n", millis() / 1000UL);
    printLine('-');
}

void printHelp() {
    printLine('-');
    Serial.println("  i : istasyon bilgisi");
    Serial.println("  h : bu yardim");
    Serial.println("  Makine satiri bicimi: UID:04:A1:B2:C3");
    printLine('-');
}

void printCard(const String &uidColon, const String &uidHex, byte size, const char *typeName) {
    Serial.println();
    printLine('=');
    Serial.printf("  KART OKUNDU  #%lu\n", static_cast<unsigned long>(readCount));
    printLine('-');
    Serial.printf("  UID          : %s\n", uidColon.c_str());
    Serial.printf("  UID (HEX)    : %s\n", uidHex.c_str());
    Serial.printf("  Boyut        : %u bayt\n", size);
    Serial.printf("  Kart tipi    : %s\n", typeName);
    printLine('-');
    // Web panelinin okuduğu tek satır. Biçimi değiştirmeyin.
    Serial.print("UID:");
    Serial.println(uidColon);
    printLine('=');
}

void handleSerialCommands() {
    while (Serial.available()) {
        const char c = static_cast<char>(Serial.read());
        if (c == 'i' || c == 'I') printInfo();
        else if (c == 'h' || c == 'H' || c == '?') printHelp();
    }
}

// ---------------------------------------------------------------------------
// Kart okuma
// ---------------------------------------------------------------------------

void pollCard() {
    if (!readerOnline) return;
    if (!rfid.PICC_IsNewCardPresent()) return;
    if (!rfid.PICC_ReadCardSerial()) return;

    const byte size = rfid.uid.size;
    if (!isValidUidSize(size)) {
        Serial.printf("[UYARI] Beklenmeyen UID uzunlugu (%u bayt), kart tekrar okutulmali.\n", size);
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        return;
    }

    const String uidColon = uidToString(rfid.uid, ':');
    const unsigned long now = millis();

    // Aynı kart çok kısa sürede tekrar yakalandıysa (titreme/bounce) yazdırma.
    if (uidColon == lastUid && now - lastReadMs < SAME_CARD_HOLD_MS) {
        lastReadMs = now;
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        return;
    }

    readCount++;
    lastUid = uidColon;
    lastReadMs = now;

    const MFRC522::PICC_Type type = rfid.PICC_GetType(rfid.uid.sak);
    const String typeName = String(rfid.PICC_GetTypeName(type));

    printCard(uidColon, uidToString(rfid.uid, '\0'), size, typeName.c_str());

    // Kartı uyut: okuyucu üzerinde bekletilen kart tekrar tekrar okunmaz.
    // Kart çekilip yeniden okutulunca yeni okuma olarak algılanır.
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    beep(2200, 80);
    blinkLed(2, 60, 60);
}

}  // namespace

void setup() {
    Serial.begin(SERIAL_BAUD);
    const unsigned long start = millis();
    while (!Serial && millis() - start < 2000) {
        delay(10);
    }

#if STATUS_LED_PIN >= 0
    pinMode(STATUS_LED_PIN, OUTPUT);
    setLed(false);
#endif
#if BUZZER_PIN >= 0
    pinMode(BUZZER_PIN, OUTPUT);
#endif

    // Pinleri açıkça belirt: parametresiz SPI.begin() farklı kablolamada çalışmaz.
    SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);

    printBanner();
    initReader();
    lastHealthCheckMs = millis();

    if (readerOnline) blinkLed(1, 300, 0);
}

void loop() {
    handleSerialCommands();
    checkReaderHealth();
    pollCard();
    delay(20);
}
