#include "AccessControl.h"

#ifndef ARDUINOJSON_ENABLE_STD_STRING
#define ARDUINOJSON_ENABLE_STD_STRING 1
#endif
#include <ArduinoJson.h>
#include <algorithm>
#include <cctype>

#ifdef ARDUINO
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
AccessControl::AccessControl() {
    _lastOfflineUserId = "";
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
    migratePlaintextPins();
    Serial.println("[AUTH] Erisim Kontrol Sistemi baslatildi (MQTT).");

    String jsonList = preferences.getString("offline_pins", "[]");
    JsonDocument doc;
    const DeserializationError error = deserializeJson(doc, jsonList);
    const size_t entryCount = (!error && doc.is<JsonArray>())
        ? doc.as<JsonArray>().size()
        : 0;
    Serial.printf("[AUTH-OFFLINE] Kalici yerel yetki kaydi: %u\n", entryCount);
}

void AccessControl::loop() {
}

bool AccessControl::verifyOfflineAccess(String authData, bool isCard) {
    _lastOfflineUserId = "";

    if (isCard) {
        Serial.println("[AUTH-OFFLINE] Kart icin MQTT gerekli; cevrimdisi kart girisi kapali.");
        return false;
    }

    String jsonList = preferences.getString("offline_pins", "[]");
    std::string bulunanUserId(findUserByHashedPin(jsonList, authData).c_str());

    if (!bulunanUserId.empty()) {
        _lastOfflineUserId = String(bulunanUserId.c_str());
        Serial.println(
            String("[AUTH-OFFLINE] ")
            + (isCard ? "Kart" : "Sifre")
            + " dogrulandi. Kullanici ID: "
            + _lastOfflineUserId
        );
        return true;
    }

    Serial.println(
        String("[AUTH-OFFLINE] ")
        + (isCard ? "Kart" : "Sifre")
        + " yerel yetki listesinde bulunamadi."
    );
    return false;
}

void AccessControl::rememberOfflineAccess(
    String authData,
    bool isCard,
    String userId
) {
    if (isCard || authData.isEmpty() || userId.isEmpty()) return;

    String jsonList = preferences.getString("offline_pins", "[]");
    JsonDocument doc;
    if (deserializeJson(doc, jsonList) || !doc.is<JsonArray>()) {
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

    target["h"] = hashPin(authData);
    target.remove("p");

    String updatedList;
    serializeJson(doc, updatedList);
    preferences.putString("offline_pins", updatedList);
    Serial.println(
        String("[AUTH-OFFLINE] Sunucunun onayladigi ")
        + "sifre"
        + " kalici hafizaya kaydedildi."
    );
}

void AccessControl::syncOfflinePins(String jsonList, bool replaceList) {
    String listToStore = jsonList;

    if (!replaceList) {
        JsonDocument incomingDoc;
        DeserializationError incomingError = deserializeJson(incomingDoc, jsonList);
        if (incomingError || !incomingDoc.is<JsonArray>()) {
            Serial.println("[AUTH] Gelen offline sifre listesi gecersiz, kaydedilmedi.");
            return;
        }

        String currentJson = preferences.getString("offline_pins", "[]");
        JsonDocument currentDoc;
        DeserializationError currentError = deserializeJson(currentDoc, currentJson);

        JsonDocument mergedDoc;
        JsonArray mergedList = mergedDoc.to<JsonArray>();
        JsonArray incomingList = incomingDoc.as<JsonArray>();

        if (!currentError && currentDoc.is<JsonArray>()) {
            for (JsonObject currentUser : currentDoc.as<JsonArray>()) {
                const String currentUserId = currentUser["u"] | "";
                bool replaced = false;

                for (JsonObject incomingUser : incomingList) {
                    const String incomingUserId = incomingUser["u"] | "";
                    if (currentUserId == incomingUserId) {
                        replaced = true;
                        break;
                    }
                }

                if (!replaced) {
                    mergedList.add(currentUser);
                }
            }
        }

        for (JsonObject incomingUser : incomingList) {
            mergedList.add(incomingUser);
        }

        listToStore = "";
        serializeJson(mergedDoc, listToStore);
    }

    JsonDocument storageDoc;
    const DeserializationError storageError = deserializeJson(storageDoc, listToStore);
    if (storageError || !storageDoc.is<JsonArray>()) {
        Serial.println("[AUTH] Gelen offline liste gecersiz, kaydedilmedi.");
        return;
    }

    for (JsonObject entry : storageDoc.as<JsonArray>()) {
        const String plainPin = entry["p"] | "";
        if (!plainPin.isEmpty()) {
            entry["h"] = hashPin(plainPin);
            entry.remove("p");
        }
        entry.remove("kartUid");
        entry.remove("kart_uid");
    }

    listToStore = "";
    serializeJson(storageDoc, listToStore);
    preferences.putString("offline_pins", listToStore);
    Serial.println("[AUTH] Yeni offline kisi/sifre listesi NVS hafizaya kaydedildi.");
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

String AccessControl::findUserByHashedPin(
    const String &jsonList,
    const String &pin
) const {
    JsonDocument doc;
    if (deserializeJson(doc, jsonList) || !doc.is<JsonArray>()) return "";

    const String candidateHash = hashPin(pin);
    for (JsonObject user : doc.as<JsonArray>()) {
        const String storedHash = user["h"] | "";
        if (storedHash.length() != candidateHash.length()) continue;

        unsigned char difference = 0;
        for (size_t index = 0; index < storedHash.length(); ++index) {
            difference |= static_cast<unsigned char>(
                storedHash[index] ^ candidateHash[index]
            );
        }
        if (difference == 0) return user["u"] | "";
    }
    return "";
}

void AccessControl::migratePlaintextPins() {
    String jsonList = preferences.getString("offline_pins", "[]");
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

    // Deprecated fonksiyon hatasini gidermek icin isNull() kullanimi
    for (JsonObject entry : doc.as<JsonArray>()) {
        if (!entry["kartUid"].isNull() || !entry["kart_uid"].isNull()) {
            entry.remove("kartUid");
            entry.remove("kart_uid");
            changed = true;
        }
    }

    if (!changed) return;
    String migratedList;
    serializeJson(doc, migratedList);
    preferences.putString("offline_pins", migratedList);
    Serial.println("[AUTH-OFFLINE] Eski PIN kayitlari guvenli ozete donusturuldu.");
}

String AccessControl::getLastOfflineUserId() {
    return _lastOfflineUserId;
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