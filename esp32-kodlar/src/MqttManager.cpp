#include "MqttManager.h"
#include <algorithm>

#ifdef ARDUINO
#include <esp_system.h>
#include "config.h"
#include "FirmwareVersion.h"

static MqttManager *g_activeInstance = nullptr;

// PubSubClient C-style callback yönlendiricisi
static void mqttCallbackTrampoline(char *topic, byte *payload, unsigned int length) {
    if (g_activeInstance != nullptr) {
        g_activeInstance->handleIncomingMessage(topic, payload, length);
    }
}

MqttManager::MqttManager(const char *brokerHost, uint16_t brokerPort) {
    _eventTopic = buildEventTopic();
    _commandTopic = buildCommandTopic();
    _heartbeatTopic = buildHeartbeatTopic();
    _statusTopic = "kapi/" + std::to_string(DEVICE_ID) + "/durum";

    _mqttClient.setServer(brokerHost, brokerPort);
    _mqttClient.setCallback(mqttCallbackTrampoline);
    // Çevrimdışı yetki listesi (PIN + kartlar) tek mesajla gelir; ~200 kişiye yeter.
    _mqttClient.setBufferSize(16384);
#if (!defined(NETWORK_USE_ETHERNET) || !NETWORK_USE_ETHERNET) && defined(MQTT_USE_TLS) && MQTT_USE_TLS
    // Bulut broker TLS: sunucu sertifikasi dogrulanmaz ama trafik sifrelenir.
    // Tam dogrulama istenirse setInsecure yerine setCACert(root_ca) kullanilabilir.
    _wifiClient.setInsecure();
#endif
    g_activeInstance = this;
}

void MqttManager::attemptReconnect() {
#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
    const IPAddress ethernetIp = Ethernet.localIP();
    const bool networkConnected =
        Ethernet.hardwareStatus() != EthernetNoHardware
        && Ethernet.linkStatus() != LinkOFF
        && (ethernetIp[0] != 0 || ethernetIp[1] != 0 || ethernetIp[2] != 0 || ethernetIp[3] != 0);
    if (!networkConnected) {
        return;
    }
#else
    if (WiFi.status() != WL_CONNECTED) {
        return;
    }
#endif

#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
    // Önceki başarısız denemeden kalan W5500 soketini serbest bırak; aksi halde
    // 8 soketlik çip zamanla dolar ve bağlantı isteği ağa hiç çıkmaz.
    _networkClient.stop();
#endif
    Serial.print("[MqttManager] Broker'a baglaniliyor... ");
    const std::string clientId = "SecureDoor_ESP32_" + std::to_string(DEVICE_ID);
#if defined(MQTT_USERNAME) && defined(MQTT_PASSWORD)
    if (_mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
#else
    if (_mqttClient.connect(clientId.c_str())) {
#endif
        Serial.println("Baglandi!");
        _mqttClient.subscribe(_commandTopic.c_str());
        _reconnectBackoffMs = 1000;
    } else {
        Serial.print("Basarisiz, rc=");
        Serial.print(_mqttClient.state());
        Serial.printf(". %lu ms sonra tekrar denenecek.\n", (unsigned long)_reconnectBackoffMs);
        _lastReconnectAttemptMs = millis();
        _reconnectBackoffMs = std::min((uint32_t)30000, _reconnectBackoffMs * 2);
    }
}

void MqttManager::update() {
    if (!_mqttClient.connected()) {
        uint32_t now = millis();
        if (now - _lastReconnectAttemptMs >= _reconnectBackoffMs) {
            attemptReconnect();
        }
    } else {
        _mqttClient.loop();
    }
}

bool MqttManager::publishEntryEvent(const EntryEvent &event) {
    if (!_mqttClient.connected()) return false;
    std::string payload = serializeEntryEvent(event);
    return _mqttClient.publish(_eventTopic.c_str(), payload.c_str());
}

static const char *resetReasonText() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "guc_acildi";
        case ESP_RST_EXT: return "harici_reset";
        case ESP_RST_SW: return "yazilim";          // ESP.restart(): OTA veya 10 dk kurtarma
        case ESP_RST_PANIC: return "hata";
        case ESP_RST_INT_WDT:
        case ESP_RST_TASK_WDT:
        case ESP_RST_WDT: return "watchdog";        // ana döngü kilitlendi
        case ESP_RST_BROWNOUT: return "dusuk_voltaj";
        case ESP_RST_DEEPSLEEP: return "uyku";
        default: return "bilinmiyor";
    }
}

bool MqttManager::publishHeartbeat(int cihazId) {
    if (!_mqttClient.connected()) return false;

    JsonDocument doc;
    doc["cihaz_id"] = cihazId;
    doc["durum"] = "cevrimici";
#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
    doc["baglanti_tipi"] = "ethernet";
    doc["ip_adresi"] = Ethernet.localIP().toString();
#else
    doc["baglanti_tipi"] = "wifi";
    doc["wifi_rssi"] = WiFi.RSSI();
#endif
    doc["firmware_versiyon"] = FIRMWARE_VERSION;
    doc["zaman"] = millis();
    // Sunucu yeniden başlamaları (watchdog, kurtarma, elektrik) buradan izler.
    doc["calisma_suresi_sn"] = millis() / 1000UL;
    doc["acilis_nedeni"] = resetReasonText();

    std::string payload;
    serializeJson(doc, payload);
    return _mqttClient.publish(_heartbeatTopic.c_str(), payload.c_str());
}

bool MqttManager::publishDoorStatus(bool isOpen) {
    if (!_mqttClient.connected()) return false;

    JsonDocument doc;
    doc["cihaz_id"] = DEVICE_ID;
    doc["kapi_durumu"] = isOpen ? "acik" : "kapali";
    doc["durum"] = "cevrimici";
    doc["zaman"] = millis();

    std::string payload;
    serializeJson(doc, payload);
    std::string topic = "kapi/" + std::to_string(DEVICE_ID) + "/durum";
    return _mqttClient.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::publishPasswordAck(bool success) {
    if (!_mqttClient.connected()) return false;

    JsonDocument doc;
    doc["durum"] = success ? "BASARILI" : "HATA";
    doc["mesaj"] = success ? "Sifre listesi guncellendi" : "Sifre guncellenemedi";

    std::string payload;
    serializeJson(doc, payload);
    std::string topic = "kapi/" + std::to_string(DEVICE_ID) + "/durum";
    return _mqttClient.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::publishOtaStatus(
    const char *status,
    const char *message,
    const std::string &targetVersion,
    int progressPercent
) {
    if (!_mqttClient.connected()) return false;

    JsonDocument doc;
    doc["cihaz_id"] = DEVICE_ID;
    doc["durum"] = status;
    doc["mesaj"] = message;
    doc["mevcut_firmware"] = FIRMWARE_VERSION;
    if (!targetVersion.empty()) {
        doc["hedef_firmware"] = targetVersion;
    }
    if (progressPercent >= 0) {
        doc["ilerleme"] = progressPercent;
    }
    doc["zaman"] = millis();

    std::string payload;
    serializeJson(doc, payload);
    const std::string topic =
        "kapi/" + std::to_string(DEVICE_ID) + "/ota-durum";
    return _mqttClient.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::isConnected() {
    return _mqttClient.connected();
}

bool MqttManager::hasPendingCommand() const {
    return !_commandQueue.empty();
}

DeviceCommand MqttManager::popPendingCommand() {
    if (_commandQueue.empty()) {
        return DeviceCommand{};
    }
    DeviceCommand cmd = _commandQueue.front();
    _commandQueue.pop();
    return cmd;
}

void MqttManager::handleIncomingMessage(char *topic, byte *payload, unsigned int length) {
    if (_eventTopic == topic || _heartbeatTopic == topic || _statusTopic == topic) {
        return;
    }

    std::string payloadStr(reinterpret_cast<char*>(payload), length);
    DeviceCommand cmd = parseCommand(payloadStr);
    if (cmd.type == CommandType::ACCESS_RESPONSE) {
        Serial.println(cmd.accessAllowed
            ? "[MQTT] Erisim cevabi: ONAY - kapi acilacak."
            : "[MQTT] Erisim cevabi: RED - kapi kapali kalacak.");
    } else {
        Serial.printf("[MqttManager] Komut Geldi [%s]: %s\n", topic, payloadStr.c_str());
    }

    if (cmd.type != CommandType::UNKNOWN) {
        _commandQueue.push(cmd);
    }
}

#endif // ARDUINO

// Native ortam ve Genel Statik Metodlar
std::string MqttManager::buildEventTopic() {
#ifdef ARDUINO
    return "kapi/" + std::to_string(DEVICE_ID) + "/erisim-istek";
#else
    return "kapi/1/erisim-istek";
#endif
}

std::string MqttManager::buildCommandTopic() {
#ifdef ARDUINO
    return "kapi/" + std::to_string(DEVICE_ID) + "/+";
#else
    return "kapi/1/+";
#endif
}

std::string MqttManager::buildHeartbeatTopic() {
#ifdef ARDUINO
    return "kapi/" + std::to_string(DEVICE_ID) + "/saglik";
#else
    return "kapi/1/saglik";
#endif
}

// EntryEvent nesnesini DB ile tam uyumlu JSON string'e çevirir
std::string MqttManager::serializeEntryEvent(const EntryEvent &event) {
    JsonDocument doc;
    doc["mesaj_tipi"] = "ACCESS_REQUEST";
    doc["cihaz_olay_id"] = event.cihazOlayId;
    doc["cihaz_id"] = event.cihazId;
    doc["kapi_id"] = event.kapiId;
    if (!event.okunanUid.empty()) {
        doc["okunan_uid"] = event.okunanUid;
    }
    if (!event.pin.empty()) {
        doc["pin"] = event.pin;
    }
    if (!event.kullaniciId.empty()) {
        doc["kullanici_id"] = event.kullaniciId;
    }
    doc["dogrulama_yontemi"] = event.dogrulamaYontemi;
    if (!event.sonuc.empty()) {
        doc["sonuc"] = event.sonuc;
    }
    if (!event.redNedeni.empty()) {
        doc["red_nedeni"] = event.redNedeni;
    }
    doc["olay_zamani"] = event.timestampEpoch;

    std::string output;
    serializeJson(doc, output);
    return output;
}

// Sunucudan gelen JSON komutu parse eder
DeviceCommand MqttManager::parseCommand(const std::string &jsonPayload) {
    DeviceCommand cmd;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, jsonPayload);
    if (err) return cmd;

    std::string komutTipi = doc["komut_tipi"] | std::string("");
    cmd.issuedByUserId = doc["kullanici_id"] | std::string("");
    cmd.timestampEpoch = doc["zaman"] | 0;

    if (komutTipi == "DOOR_OPEN") {
        cmd.type = CommandType::DOOR_OPEN;
    } else if (komutTipi == "PASSWORD_RENEW") {
        cmd.type = CommandType::PASSWORD_RENEW;
        cmd.replacePasswordList = doc["replace"] | true;
        if (doc["yeni_liste"].is<JsonArray>()) {
            std::string serializedList;
            serializeJson(doc["yeni_liste"], serializedList);
            cmd.newPasswordListJson = serializedList;
        }
    } else if (komutTipi == "BLOCK") {
        cmd.type = CommandType::BLOCK;
        cmd.targetCardUid = doc["kart_uid"] | std::string("");
    } else if (komutTipi == "UNBLOCK") {
        cmd.type = CommandType::UNBLOCK;
        cmd.targetCardUid = doc["kart_uid"] | std::string("");
    } else if (komutTipi == "FIRMWARE_UPDATE") {
        cmd.type = CommandType::FIRMWARE_UPDATE;
        cmd.firmwareUrl = doc["firmware_url"] | std::string("");
        cmd.firmwareVersion = doc["firmware_versiyon"] | std::string("");
        cmd.firmwareMd5 = doc["firmware_md5"] | std::string("");
        cmd.firmwareSize = doc["firmware_boyut"] | 0;
        cmd.forceFirmwareUpdate = doc["force"] | false;
    } else if (komutTipi == "ACCESS_RESPONSE" || komutTipi == "erisim-yanit") {
        cmd.type = CommandType::ACCESS_RESPONSE;
        cmd.requestId = doc["cihaz_olay_id"] | std::string("");
        if (cmd.requestId.empty()) {
            cmd.requestId = doc["istek_id"] | std::string("");
        }
        cmd.accessAllowed = doc["onay"] | false;
        cmd.accessUserId = doc["kullanici_id"] | std::string("");
        cmd.accessReason = doc["red_nedeni"] | std::string("");
    }

    return cmd;
}
