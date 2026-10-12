#pragma once

#include <cstdint>
#include <string>
#include <queue>

// Native test ortamlarında std::string desteğini garanti altına al
#ifndef ARDUINOJSON_ENABLE_STD_STRING
#define ARDUINOJSON_ENABLE_STD_STRING 1
#endif
#include <ArduinoJson.h>

// PubSubClient ve WiFi kısımları sadece ESP32 derlemesinde aktif olur
#ifdef ARDUINO
#include <Arduino.h>
#include "config.h"
#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
#include <Ethernet.h>
#if defined(MQTT_USE_TLS) && MQTT_USE_TLS
#error "W5500 modunda MQTT_USE_TLS 0 olmalidir."
#endif
#else
#include <WiFi.h>
// Bulut broker (TLS) veya yerel broker (düz TCP) seçimi config.h'daki
// MQTT_USE_TLS makrosuna göre yapılır. TLS açıkken WiFiClientSecure kullanılır.
#if defined(MQTT_USE_TLS) && MQTT_USE_TLS
#include <WiFiClientSecure.h>
#else
#include <WiFiClient.h>
#endif
#endif
#include <PubSubClient.h>
#endif

// Backend'den ESP32'ye gelebilecek komut tipleri
enum class CommandType {
    DOOR_OPEN,       // Uzaktan kapı açma
    PASSWORD_RENEW,  // Günlük şifre listesi yenileme
    BLOCK,           // Kartı geçici engelleme
    UNBLOCK,         // Kart engelini kaldırma
    FIRMWARE_UPDATE, // HTTP üzerinden OTA firmware güncellemesi
    ACCESS_RESPONSE,
    UNKNOWN
};

// Prisma 'ErisimKaydi' (erisim_kaydi) tablosu ile %100 uyumlu olay yapısı
struct EntryEvent {
    std::string pin;
    std::string cihazOlayId;      // UUID (Çevrimdışı/Canlı kayıt benzersiz kimliği)
    int cihazId = 1;              // DB Cihaz ID
    int kapiId = 1;               // DB Kapı ID
    std::string okunanUid;        // Okunan RFID Kart UID ("A1:B2:C3:D4") veya PIN ise boş
    std::string kullaniciId;      // PIN doğrulamasında eşleşen kullanıcı ID'si
    std::string dogrulamaYontemi; // "kart" | "pin" | "uzaktan"
    std::string sonuc;            // "izin" | "red"
    std::string redNedeni;        // "tanimsiz_kart", "gecersiz_pin", "yetkisiz"
    uint32_t timestampEpoch = 0;  // Unix Epoch Zaman Damgası (Saniye)
};

// Sunucudan (MQTT) ESP32'ye gelen komut yapısı
struct DeviceCommand {
    std::string requestId;
    bool accessAllowed = false;
    std::string accessUserId;
    std::string accessReason;
    CommandType type = CommandType::UNKNOWN;
    std::string issuedByUserId;
    std::string newPasswordListJson; // PASSWORD_RENEW için gelen JSON dizisi
    bool replacePasswordList = true;
    std::string targetCardUid;       // BLOCK/UNBLOCK için hedef kart UID
    std::string firmwareUrl;         // FIRMWARE_UPDATE indirme adresi
    std::string firmwareVersion;     // Hedef firmware sürümü
    std::string firmwareMd5;         // Beklenen 32 karakterlik MD5
    uint32_t firmwareSize = 0;       // Beklenen .bin boyutu
    bool forceFirmwareUpdate = false;
    uint32_t timestampEpoch = 0;
};

class MqttManager {
public:
#ifdef ARDUINO
    MqttManager(const char *brokerHost, uint16_t brokerPort);

    void update();

    bool publishEntryEvent(const EntryEvent &event);
    // rfidVersion: RC522 VersionReg (0x00/0xFF = okuyucu yanıt vermiyor), -1 = bilinmiyor.
    bool publishHeartbeat(int cihazId = 1, int rfidVersion = -1, uint32_t kartOkumaSayisi = 0);
    bool publishDoorStatus(bool isOpen);
    bool publishPasswordAck(bool success);
    bool publishOtaStatus(
        const char *status,
        const char *message,
        const std::string &targetVersion = "",
        int progressPercent = -1
    );
    bool isConnected();

    bool hasPendingCommand() const;
    DeviceCommand popPendingCommand();

    void handleIncomingMessage(char *topic, byte *payload, unsigned int length);
#endif

    // Donanımdan bağımsız static metodlar (Native testler için)
    static std::string buildEventTopic();
    static std::string buildCommandTopic();
    static std::string buildHeartbeatTopic();
    static std::string serializeEntryEvent(const EntryEvent &event);
    static DeviceCommand parseCommand(const std::string &jsonPayload);

private:
#ifdef ARDUINO
#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
    EthernetClient _networkClient;
    PubSubClient _mqttClient{_networkClient};
#elif defined(MQTT_USE_TLS) && MQTT_USE_TLS
    WiFiClientSecure _wifiClient;
    PubSubClient _mqttClient{_wifiClient};
#else
    WiFiClient _wifiClient;
    PubSubClient _mqttClient{_wifiClient};
#endif
    std::string _eventTopic;
    std::string _commandTopic;
    std::string _heartbeatTopic;
    std::string _statusTopic;

    std::queue<DeviceCommand> _commandQueue;

    uint32_t _lastReconnectAttemptMs = 0;
    uint32_t _reconnectBackoffMs = 1000;

    void attemptReconnect();
#endif
};
