#include "AccessControl.h"

#ifndef ARDUINOJSON_ENABLE_STD_STRING
#define ARDUINOJSON_ENABLE_STD_STRING 1
#endif
#include <ArduinoJson.h>
#include <algorithm>
#include <cctype>

#ifdef ARDUINO
#include <LittleFS.h>
#include <esp_system.h>
#include <mbedtls/sha256.h>
#endif

static std::string normalizeCardUid(std::string value) {
    value.erase(
        std::remove_if(value.begin(), value.end(), [](unsigned char character) {
            return std::isspace(character) != 0;
        }),
        value.end()
    );
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
        return static_cast<char>(std::toupper(character));
    });
    return value;
}

#ifdef ARDUINO
namespace {
const char *LISTE_DOSYASI = "/offline_liste.json";
const char *GECICI_DOSYA = "/offline_liste.tmp";
// Bu tarihten önceki epoch "saat bilinmiyor" sayılır (RTC/NTP yok).
constexpr time_t GECERLI_SAAT_ALT_SINIRI = 1700000000;

bool sabitZamanliEsit(const String &a, const String &b) {
    if (a.length() != b.length() || a.isEmpty()) return false;
    unsigned char fark = 0;
    for (size_t i = 0; i < a.length(); ++i) {
        fark |= static_cast<unsigned char>(a[i] ^ b[i]);
    }
    return fark == 0;
}

bool varsayilanKural(int gun, const String &bas, const String &bit) {
    return gun == 127 && bas == "00:00" && bit == "23:59";
}
}  // namespace

AccessControl::AccessControl() {
    _lastOfflineUserId = "";
    _lastOfflineDenyReason = "";
}

void AccessControl::begin() {
    preferences.begin("securedoor", false);
    _pinSalt = preferences.getString("pin_salt", "");
    if (_pinSalt.length() != 32) {
        char saltBuffer[33];
        for (size_t index = 0; index < 16; ++index) {
            snprintf(
                saltBuffer + (index * 2),
                3,
                "%02x",
                static_cast<unsigned int>(esp_random() & 0xff)
            );
        }
        saltBuffer[32] = '\0';
        _pinSalt = saltBuffer;
        preferences.putString("pin_salt", _pinSalt);
    }

    // Liste NVS yerine LittleFS'te tutulur (NVS dizgisi ~4 KB ile sınırlı).
    if (!LittleFS.begin(true)) {
        Serial.println("[AUTH-OFFLINE] LittleFS baslatilamadi; cevrimdisi liste kullanilamaz.");
    }
    migratePlaintextPins();
    migrateNvsListToFile();

    Serial.println("[AUTH] Erisim Kontrol Sistemi baslatildi (MQTT).");
    Serial.printf("[AUTH-OFFLINE] Kalici yerel yetki kaydi: %d\n", offlineEntryCount());
}

void AccessControl::loop() {
}

void AccessControl::setZamanKaynagi(time_t (*saatAlici)()) {
    _saatAlici = saatAlici;
}

String AccessControl::readList() const {
    if (!LittleFS.exists(LISTE_DOSYASI)) return "[]";
    File dosya = LittleFS.open(LISTE_DOSYASI, FILE_READ);
    if (!dosya) return "[]";
    String icerik = dosya.readString();
    dosya.close();
    return icerik.length() ? icerik : "[]";
}

bool AccessControl::writeList(const String &jsonList) {
    // Önce geçici dosyaya yaz, sonra değiştir: yazma sırasında güç kesilirse eski liste korunur.
    File dosya = LittleFS.open(GECICI_DOSYA, FILE_WRITE);
    if (!dosya) return false;
    const size_t yazilan = dosya.print(jsonList);
    dosya.close();
    if (yazilan != jsonList.length()) {
        LittleFS.remove(GECICI_DOSYA);
        return false;
    }
    LittleFS.remove(LISTE_DOSYASI);
    return LittleFS.rename(GECICI_DOSYA, LISTE_DOSYASI);
}

int AccessControl::offlineEntryCount() const {
    JsonDocument doc;
    if (deserializeJson(doc, readList()) || !doc.is<JsonArray>()) return 0;
    return static_cast<int>(doc.as<JsonArray>().size());
}

bool AccessControl::ruleAllowsNow(int dayMask, const String &start, const String &end) const {
    if (varsayilanKural(dayMask, start, end)) return true;

    const time_t simdi = _saatAlici ? _saatAlici() : time(nullptr);
    if (simdi < GECERLI_SAAT_ALT_SINIRI) {
        // Saat bilinmiyorsa kısıtlı kullanıcıya kapı açılmaz.
        Serial.println("[AUTH-OFFLINE] Saat bilinmiyor; saat/gun kisitli yetki reddedildi.");
        return false;
    }

    struct tm yerel;
    localtime_r(&simdi, &yerel);
    const int bugunMaskesi = yerel.tm_wday == 0 ? 64 : (1 << (yerel.tm_wday - 1));
    if ((dayMask & bugunMaskesi) == 0) return false;

    char saat[6];
    snprintf(saat, sizeof(saat), "%02d:%02d", yerel.tm_hour, yerel.tm_min);
    const String suan(saat);
    // Sunucudaki kuralla aynı mantık (gece yarısını aşan aralıklar dahil).
    if (start <= end) return suan >= start && suan <= end;
    return suan >= start || suan <= end;
}

bool AccessControl::verifyOfflineAccess(String authData, bool isCard) {
    _lastOfflineUserId = "";
    _lastOfflineDenyReason = isCard ? "mqtt_yok_kart_dogrulanamadi" : "gecersiz_pin";

    JsonDocument doc;
    if (deserializeJson(doc, readList()) || !doc.is<JsonArray>()) {
        Serial.println("[AUTH-OFFLINE] Yerel yetki listesi okunamadi.");
        return false;
    }

    const String aday = isCard ? hashCard(authData) : hashPin(authData);
    for (JsonObject entry : doc.as<JsonArray>()) {
        bool eslesti = false;
        if (isCard) {
            for (JsonVariant kart : entry["k"].as<JsonArray>()) {
                if (sabitZamanliEsit(kart.as<String>(), aday)) {
                    eslesti = true;
                    break;
                }
            }
        } else {
            eslesti = sabitZamanliEsit(entry["h"] | "", aday);
        }
        if (!eslesti) continue;

        const String kullanici = entry["u"] | "";
        if (!ruleAllowsNow(entry["g"] | 127, entry["s"] | "00:00", entry["e"] | "23:59")) {
            _lastOfflineDenyReason = "cevrimdisi_saat_disi";
            Serial.printf("[AUTH-OFFLINE] Kullanici %s bu saatte yetkili degil.\n", kullanici.c_str());
            return false;
        }
        _lastOfflineUserId = kullanici;
        _lastOfflineDenyReason = "";
        Serial.printf("[AUTH-OFFLINE] %s dogrulandi. Kullanici ID: %s\n", isCard ? "Kart" : "Sifre", kullanici.c_str());
        return true;
    }

    Serial.printf("[AUTH-OFFLINE] %s yerel yetki listesinde bulunamadi.\n", isCard ? "Kart" : "Sifre");
    return false;
}

void AccessControl::rememberOfflineAccess(
    String authData,
    bool isCard,
    String userId
) {
    if (authData.isEmpty() || userId.isEmpty()) return;

    JsonDocument doc;
    if (deserializeJson(doc, readList()) || !doc.is<JsonArray>()) {
        doc.clear();
        doc.to<JsonArray>();
    }

    JsonArray entries = doc.as<JsonArray>();
    JsonObject target;
    for (JsonObject entry : entries) {
        const String storedUserId = entry["u"] | "";
        if (storedUserId == userId) {
            target = entry;
            break;
        }
    }
    if (target.isNull()) {
        target = entries.add<JsonObject>();
        target["u"] = userId;
    }

    if (isCard) {
        const String ozet = hashCard(authData);
        JsonArray kartlar = target["k"].is<JsonArray>() ? target["k"].as<JsonArray>() : target["k"].to<JsonArray>();
        for (JsonVariant kart : kartlar) {
            if (kart.as<String>() == ozet) return;  // zaten kayıtlı
        }
        kartlar.add(ozet);
    } else {
        target["h"] = hashPin(authData);
        target.remove("p");
    }

    String updatedList;
    serializeJson(doc, updatedList);
    writeList(updatedList);
    Serial.printf("[AUTH-OFFLINE] Sunucunun onayladigi %s kalici hafizaya kaydedildi.\n", isCard ? "kart" : "sifre");
}

void AccessControl::syncOfflinePins(String jsonList, bool replaceList) {
    JsonDocument incomingDoc;
    if (deserializeJson(incomingDoc, jsonList) || !incomingDoc.is<JsonArray>()) {
        Serial.println("[AUTH] Gelen offline liste gecersiz, kaydedilmedi.");
        return;
    }

    // Gelen kayıtları cihaz biçimine çevir: PIN ve kartlar özetlenir, düz metin saklanmaz.
    JsonDocument normalizedDoc;
    JsonArray normalized = normalizedDoc.to<JsonArray>();
    for (JsonObject gelen : incomingDoc.as<JsonArray>()) {
        const String userId = gelen["u"] | "";
        if (userId.isEmpty()) continue;

        JsonObject kayit = normalized.add<JsonObject>();
        kayit["u"] = userId;

        const String pin = gelen["p"] | "";
        const String hazirOzet = gelen["h"] | "";
        if (!pin.isEmpty()) kayit["h"] = hashPin(pin);
        else if (!hazirOzet.isEmpty()) kayit["h"] = hazirOzet;

        JsonArray kartlar = kayit["k"].to<JsonArray>();
        for (JsonVariant kart : gelen["k"].as<JsonArray>()) {
            const String uid = kart.as<String>();
            if (!uid.isEmpty()) kartlar.add(hashCard(uid));
        }
        // Eski sunucu sürümlerinin tek kart alanı.
        const String eskiKart = gelen["kartUid"] | (gelen["kart_uid"] | "");
        if (!eskiKart.isEmpty() && kartlar.size() == 0) kartlar.add(hashCard(eskiKart));
        if (kartlar.size() == 0) kayit.remove("k");

        const int gun = gelen["g"] | (gelen["gunMaskesi"] | 127);
        const String bas = gelen["s"] | (gelen["saatBaslangic"] | "00:00");
        const String bit = gelen["e"] | (gelen["saatBitis"] | "23:59");
        if (!varsayilanKural(gun, bas, bit)) {
            kayit["g"] = gun;
            kayit["s"] = bas;
            kayit["e"] = bit;
        }
    }

    if (!replaceList) {
        // Kısmi güncelleme: gelen kullanıcıların kaydı değişir, diğerleri korunur.
        JsonDocument currentDoc;
        if (!deserializeJson(currentDoc, readList()) && currentDoc.is<JsonArray>()) {
            for (JsonObject mevcut : currentDoc.as<JsonArray>()) {
                const String mevcutId = mevcut["u"] | "";
                bool degisti = false;
                for (JsonObject yeni : normalized) {
                    if (mevcutId == (yeni["u"] | "")) {
                        degisti = true;
                        break;
                    }
                }
                if (!degisti) normalized.add(mevcut);
            }
        }
    }

    String listToStore;
    serializeJson(normalizedDoc, listToStore);
    if (writeList(listToStore)) {
        Serial.printf("[AUTH] Cevrimdisi yetki listesi kaydedildi (%u kayit).\n", static_cast<unsigned>(normalized.size()));
    } else {
        Serial.println("[AUTH] Cevrimdisi yetki listesi yazilamadi.");
    }
}

String AccessControl::hashPin(const String &pin) const {
    const String saltedValue = _pinSalt + ":" + pin;
    unsigned char digest[32];
    mbedtls_sha256_ret(
        reinterpret_cast<const unsigned char*>(saltedValue.c_str()),
        saltedValue.length(),
        digest,
        0
    );

    char hexDigest[65];
    for (size_t index = 0; index < sizeof(digest); ++index) {
        snprintf(hexDigest + (index * 2), 3, "%02x", digest[index]);
    }
    hexDigest[64] = '\0';
    return String(hexDigest);
}

String AccessControl::hashCard(const String &uid) const {
    // PIN'lerle karışmaması için ayrı önek; UID kapı okuyucusuyla aynı biçime getirilir.
    const std::string normalized = normalizeCardUid(std::string(uid.c_str()));
    return hashPin(String("kart:") + normalized.c_str());
}

void AccessControl::migratePlaintextPins() {
    String jsonList = preferences.getString("offline_pins", "");
    if (jsonList.isEmpty()) return;
    JsonDocument doc;
    if (deserializeJson(doc, jsonList) || !doc.is<JsonArray>()) return;

    bool changed = false;
    for (JsonObject entry : doc.as<JsonArray>()) {
        const String plainPin = entry["p"] | "";
        if (plainPin.isEmpty()) continue;
        entry["h"] = hashPin(plainPin);
        entry.remove("p");
        changed = true;
    }

    if (!changed) return;
    String migratedList;
    serializeJson(doc, migratedList);
    preferences.putString("offline_pins", migratedList);
    Serial.println("[AUTH-OFFLINE] Eski PIN kayitlari guvenli ozete donusturuldu.");
}

void AccessControl::migrateNvsListToFile() {
    // 1.0.2 ve öncesi listeyi NVS'te tutuyordu; bir kez dosyaya taşınır.
    if (!preferences.isKey("offline_pins")) return;
    if (!LittleFS.exists(LISTE_DOSYASI)) {
        const String eskiListe = preferences.getString("offline_pins", "[]");
        JsonDocument doc;
        if (!deserializeJson(doc, eskiListe) && doc.is<JsonArray>()) {
            for (JsonObject entry : doc.as<JsonArray>()) {
                // Eski sürüm kart UID'lerini özetlemeden saklayabiliyordu; taşınmaz,
                // sunucu bağlanınca güncel listeyi zaten gönderir.
                entry.remove("kartUid");
                entry.remove("kart_uid");
                entry.remove("k");
            }
            String temiz;
            serializeJson(doc, temiz);
            if (!writeList(temiz)) return;  // taşınamadıysa NVS'teki kopya kalsın
        }
    }
    preferences.remove("offline_pins");
    Serial.println("[AUTH-OFFLINE] Cevrimdisi liste NVS'ten dosyaya tasindi.");
}

String AccessControl::getLastOfflineUserId() {
    return _lastOfflineUserId;
}

String AccessControl::getLastOfflineDenyReason() {
    return _lastOfflineDenyReason;
}
#endif

std::string AccessControl::findUserByOfflinePin(
    const std::string &jsonList,
    const std::string &pin
) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, jsonList);

    if (!err && doc.is<JsonArray>()) {
        for (JsonObject user : doc.as<JsonArray>()) {
            std::string storedPin = user["p"].as<std::string>();
            if (pin == storedPin) {
                return user["u"].as<std::string>();
            }
        }
    }

    return "";
}
