#pragma once

#include <cstdint>
#include <string>

#ifdef ARDUINO
#include <Arduino.h>
#include <MFRC522.h>
#include <ctime>
#endif

enum class ReaderStatus { ACTIVE, READ_ERROR, DISCONNECTED };

class CardReader {
public:
    static constexpr uint8_t UID_MIN_BAYT = 4;
    static constexpr uint8_t UID_MAX_BAYT = 10;

#ifdef ARDUINO
    // sckPin/misoPin/mosiPin: ESP32'nin bu projede varsayilan VSPI pinlerini
    // (18/19/23) DEGIL, config.h'de tanimli OZEL pinleri kullanmasi icin
    // eklendi. Onceki surumde SPI.begin() parametresiz cagriliyordu, bu da
    // donanimsal olarak kablolanan pinlerle yazilimin konustugu pinlerin
    // tamamen farkli olmasina (ve RFID'nin hic yanit vermemesine) sebep
    // oluyordu.
    CardReader(uint8_t ssPin, uint8_t rstPin, uint8_t sckPin, uint8_t misoPin, uint8_t mosiPin);

    void begin();
    void update();         

    bool hasNewRead() const;                    
    std::string getLastCardId() const;           
    unsigned long getLastReadTimestamp() const;   
    ReaderStatus getStatus() const;
    // Teşhis: RC522'nin son okunan VersionReg değeri (0x00/0xFF = SPI yanıtı yok)
    // ve açılıştan beri okunan kart sayısı. Sağlık mesajıyla sunucuya gider.
    uint8_t getLastVersionReg() const { return _sonVersionReg; }
    uint32_t getReadCount() const { return _okumaSayisi; }

#ifdef DEBUG_FAKE_CARD
    void injectFakeRead(const std::string &fakeUid, unsigned long timestampMs);
#endif

    // main.cpp, NTP/RTC'den gelen gecerli zamani buraya baglar; boylece
    // CardReader kart okundugunda terminale okunabilir tarih/saat de
    // yazdirabilir. saatAlici: epoch dondurur. rtcdenMiGeliyor: o an
    // kullanilan kaynak RTC ise true (aksi halde NTP/sistem saati kabul
    // edilir). Cagrilmazsa (varsayilan nullptr) saat satiri yazdirilmaz.
    static void setZamanKaynagi(time_t (*saatAlici)(), bool (*rtcdenMiGeliyor)());
#endif

    static std::string uidToString(const uint8_t *uidBytes, uint8_t uidSize);
    static bool uidGecerliMi(const std::string &uid);
    static bool isDuplicateRead(const std::string &newUid, const std::string &lastUid,
                                 uint32_t newTimestampMs, uint32_t lastTimestampMs,
                                 uint32_t debounceMs = 1000);

private:
#ifdef ARDUINO
    MFRC522 _mfrc522;
    uint8_t _ssPin;
    uint8_t _rstPin;
    uint8_t _sckPin;
    uint8_t _misoPin;
    uint8_t _mosiPin;
    ReaderStatus _status = ReaderStatus::DISCONNECTED;
    std::string _lastCardId;
    unsigned long _lastReadTimestamp = 0;
    bool _newReadFlag = false;
    unsigned long _sonBaglantiDenemesi = 0;
    unsigned long _sonSaglikKontrolu = 0;
    uint8_t _sonVersionReg = 0;
    uint32_t _okumaSayisi = 0;

    bool okuyucuyuBaslat();

    static time_t (*_saatAlici)();
    static bool (*_rtcdenMiGeliyor)();
#endif
};
