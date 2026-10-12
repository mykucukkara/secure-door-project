#ifndef ACCESS_CONTROL_H
#define ACCESS_CONTROL_H

#include <string>

#ifdef ARDUINO
#include <Arduino.h>
#include <Preferences.h>
#include <time.h>
#endif

// Sunucuya ulaşılamadığında kapıyı açabilmek için cihazdaki kalıcı yetki listesi.
// Liste LittleFS'te (/offline_liste.json) tutulur; PIN ve kart UID'leri cihaza
// özel tuzla SHA-256 özeti olarak saklanır, düz metin tutulmaz.
// Kayıt biçimi: {"u":"12","h":"<pin özeti>","k":["<kart özeti>",...],"g":127,"s":"08:00","e":"18:00"}
//   g: gün maskesi (Pzt=1 ... Paz=64), s/e: izinli saat aralığı (yoksa her zaman).
class AccessControl {
private:
#ifdef ARDUINO
    Preferences preferences;
    String _lastOfflineUserId;
    String _lastOfflineDenyReason;
    String _pinSalt;
    time_t (*_saatAlici)() = nullptr;

    String hashPin(const String &pin) const;
    String hashCard(const String &uid) const;
    String readList() const;
    bool writeList(const String &jsonList);
    bool ruleAllowsNow(int dayMask, const String &start, const String &end) const;
    void migratePlaintextPins();
    void migrateNvsListToFile();
#endif

public:
#ifdef ARDUINO
    AccessControl();
    void begin();
    void loop();

    // Çevrimdışı saat/gün kuralı kontrolü için zaman kaynağı (epoch; bilinmiyorsa < 2023).
    void setZamanKaynagi(time_t (*saatAlici)());

    // MQTT/sunucu yokken kalıcı yerel listeden PIN veya kart doğrular.
    bool verifyOfflineAccess(String authData, bool isCard);

    // Sunucunun onayladığı kart/PIN'i sonraki çevrimdışı kullanım için saklar.
    void rememberOfflineAccess(String authData, bool isCard, String userId);

    // Sunucudan gelen listeyi kaydeder. replaceList=false ise yalnızca gelen
    // kullanıcıların kaydı güncellenir.
    void syncOfflinePins(String jsonList, bool replaceList = true);
    String getLastOfflineUserId();
    String getLastOfflineDenyReason();
    int offlineEntryCount() const;
#endif

    static std::string findUserByOfflinePin(
        const std::string &jsonList,
        const std::string &pin
    );

};

#endif
