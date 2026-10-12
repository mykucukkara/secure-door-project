#include "OtaUpdater.h"

#ifdef ARDUINO

#include <Arduino.h>
#include <algorithm>
#include <cctype>
#include <esp_task_wdt.h>

#include "config.h"
#include "FirmwareVersion.h"

#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
#include <Ethernet.h>
#include <Update.h>
#else
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFi.h>
#include <WiFiClient.h>
#endif

namespace {
struct ParsedHttpUrl {
    std::string host;
    std::string path;
    uint16_t port = 80;
};

bool parseHttpUrl(const std::string &url, ParsedHttpUrl &parsed) {
    static const std::string prefix = "http://";
    if (url.rfind(prefix, 0) != 0) return false;

    const size_t authorityStart = prefix.size();
    const size_t pathStart = url.find('/', authorityStart);
    const std::string authority = url.substr(
        authorityStart,
        pathStart == std::string::npos ? std::string::npos : pathStart - authorityStart
    );
    if (authority.empty()) return false;

    const size_t colon = authority.rfind(':');
    if (colon != std::string::npos) {
        parsed.host = authority.substr(0, colon);
        const std::string portText = authority.substr(colon + 1);
        if (parsed.host.empty() || portText.empty()) return false;
        const long port = strtol(portText.c_str(), nullptr, 10);
        if (port <= 0 || port > 65535) return false;
        parsed.port = static_cast<uint16_t>(port);
    } else {
        parsed.host = authority;
    }

    parsed.path = pathStart == std::string::npos ? "/" : url.substr(pathStart);
    return !parsed.host.empty() && !parsed.path.empty();
}

#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
bool ethernetReady() {
    const IPAddress ip = Ethernet.localIP();
    return Ethernet.hardwareStatus() != EthernetNoHardware
        && Ethernet.linkStatus() != LinkOFF
        && (ip[0] != 0 || ip[1] != 0 || ip[2] != 0 || ip[3] != 0);
}
#endif
}

OtaUpdater::OtaUpdater(MqttManager &mqttManager)
    : _mqttManager(mqttManager) {}

bool OtaUpdater::isValidHttpUrl(const std::string &url) {
    ParsedHttpUrl parsed;
    return url.size() >= 10 && url.size() <= 1024 && parseHttpUrl(url, parsed);
}

bool OtaUpdater::isValidMd5(const std::string &md5) {
    return md5.size() == 32
        && std::all_of(md5.begin(), md5.end(), [](unsigned char value) {
            return std::isxdigit(value) != 0;
        });
}

#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
bool OtaUpdater::performEthernetDownload(const DeviceCommand &command) {
    ParsedHttpUrl url;
    if (!parseHttpUrl(command.firmwareUrl, url)) {
        _mqttManager.publishOtaStatus("HATA", "Firmware URL ayrisamadi", command.firmwareVersion);
        return false;
    }

    EthernetClient client;
    client.setTimeout(5000);
    Serial.printf("[OTA] W5500 ile baglaniliyor: %s:%u\n", url.host.c_str(), url.port);
    if (!client.connect(url.host.c_str(), url.port)) {
        Serial.println("[OTA] Firmware HTTP sunucusuna Ethernet ile baglanilamadi.");
        _mqttManager.publishOtaStatus("HATA", "Firmware sunucusuna baglanilamadi", command.firmwareVersion);
        return false;
    }

    client.printf("GET %s HTTP/1.1\r\n", url.path.c_str());
    client.printf("Host: %s\r\n", url.host.c_str());
    client.printf("x-OTA-Expected-MD5: %s\r\n", command.firmwareMd5.c_str());
    client.printf("x-Device-Id: %d\r\n", DEVICE_ID);
    client.print("Connection: close\r\n\r\n");

    String statusLine = client.readStringUntil('\n');
    statusLine.trim();
    if (!statusLine.startsWith("HTTP/") || statusLine.indexOf(" 200 ") < 0) {
        Serial.printf("[OTA] HTTP cevap basarisiz: %s\n", statusLine.c_str());
        client.stop();
        _mqttManager.publishOtaStatus("HATA", "Firmware HTTP cevabi 200 degil", command.firmwareVersion);
        return false;
    }

    uint32_t contentLength = 0;
    bool chunked = false;
    for (uint16_t headerCount = 0; headerCount < 100; ++headerCount) {
        String line = client.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) break;
        if (line.startsWith("Content-Length:") || line.startsWith("content-length:")) {
            contentLength = static_cast<uint32_t>(line.substring(line.indexOf(':') + 1).toInt());
        }
        if (
            (line.startsWith("Transfer-Encoding:") || line.startsWith("transfer-encoding:"))
            && line.indexOf("chunked") >= 0
        ) {
            chunked = true;
        }
    }

    if (chunked || contentLength != command.firmwareSize) {
        Serial.printf(
            "[OTA] Firmware boyutu/aktarimi gecersiz: HTTP=%lu, beklenen=%lu, chunked=%d.\n",
            static_cast<unsigned long>(contentLength),
            static_cast<unsigned long>(command.firmwareSize),
            chunked
        );
        client.stop();
        _mqttManager.publishOtaStatus("HATA", "Firmware boyutu eslesmiyor", command.firmwareVersion);
        return false;
    }

    if (!Update.begin(command.firmwareSize, U_FLASH)) {
        Serial.printf("[OTA] Flash OTA bolumu acilamadi: %s\n", Update.errorString());
        client.stop();
        _mqttManager.publishOtaStatus("HATA", Update.errorString(), command.firmwareVersion);
        return false;
    }
    if (!Update.setMD5(command.firmwareMd5.c_str())) {
        Update.abort();
        client.stop();
        _mqttManager.publishOtaStatus("HATA", "MD5 ayarlanamadi", command.firmwareVersion);
        return false;
    }

    uint8_t buffer[1024];
    uint32_t written = 0;
    int lastProgress = -10;
    uint32_t lastDataAt = millis();
    while (written < command.firmwareSize) {
        // İndirme ana döngüyü onlarca saniye tutabilir; watchdog'u besle.
        esp_task_wdt_reset();
        const int available = client.available();
        if (available > 0) {
            const size_t wanted = std::min(
                static_cast<size_t>(available),
                std::min(sizeof(buffer), static_cast<size_t>(command.firmwareSize - written))
            );
            const int received = client.read(buffer, wanted);
            if (received <= 0) continue;
            if (Update.write(buffer, static_cast<size_t>(received)) != static_cast<size_t>(received)) {
                Serial.printf("[OTA] Flash yazma hatasi: %s\n", Update.errorString());
                Update.abort();
                client.stop();
                _mqttManager.publishOtaStatus("HATA", Update.errorString(), command.firmwareVersion);
                return false;
            }
            written += static_cast<uint32_t>(received);
            lastDataAt = millis();
            const int progress = static_cast<int>((written * 100UL) / command.firmwareSize);
            if (progress - lastProgress >= 10) {
                lastProgress = progress;
                Serial.printf("[OTA] Ethernet indirme: %d%%\n", progress);
            }
            continue;
        }

        if (!client.connected() || millis() - lastDataAt > 15000) break;
        delay(1);
    }
    client.stop();

    if (written != command.firmwareSize || !Update.end() || !Update.isFinished()) {
        Serial.printf(
            "[OTA] Firmware eksik/gecersiz: yazilan=%lu/%lu, hata=%s\n",
            static_cast<unsigned long>(written),
            static_cast<unsigned long>(command.firmwareSize),
            Update.errorString()
        );
        if (Update.isRunning()) Update.abort();
        _mqttManager.publishOtaStatus("HATA", Update.errorString(), command.firmwareVersion);
        return false;
    }

    Serial.printf("[OTA] Firmware %s W5500 uzerinden basariyla yazildi.\n", command.firmwareVersion.c_str());
    _mqttManager.publishOtaStatus(
        "BASARILI",
        "Firmware Ethernet ile yazildi; cihaz yeniden baslatiliyor",
        command.firmwareVersion,
        100
    );
    delay(750);
    ESP.restart();
    return true;
}
#endif

bool OtaUpdater::performUpdate(const DeviceCommand &command) {
    const std::string &version = command.firmwareVersion;

#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
    const bool networkConnected = ethernetReady();
#else
    const bool networkConnected = WiFi.status() == WL_CONNECTED;
#endif
    if (!networkConnected || !_mqttManager.isConnected()) {
        Serial.println("[OTA] Ethernet/MQTT baglantisi yok; guncelleme baslatilmadi.");
        _mqttManager.publishOtaStatus("HATA", "Ethernet veya MQTT baglantisi yok", version);
        return false;
    }

    if (!isValidHttpUrl(command.firmwareUrl)) {
        Serial.println("[OTA] Gecersiz firmware URL; yalnizca http:// destekleniyor.");
        _mqttManager.publishOtaStatus("HATA", "Gecersiz firmware URL", version);
        return false;
    }

    if (version.empty() || !isValidMd5(command.firmwareMd5) || command.firmwareSize == 0) {
        Serial.println("[OTA] Firmware surum/hash/boyut bilgisi eksik veya gecersiz.");
        _mqttManager.publishOtaStatus("HATA", "Firmware metadata gecersiz", version);
        return false;
    }

    if (!command.forceFirmwareUpdate && version == FIRMWARE_VERSION) {
        Serial.printf("[OTA] Firmware zaten guncel: %s\n", FIRMWARE_VERSION);
        _mqttManager.publishOtaStatus("GUNCEL", "Cihaz zaten bu surumde", version, 100);
        return true;
    }

    const uint32_t availableSpace = ESP.getFreeSketchSpace();
    if (command.firmwareSize > availableSpace) {
        Serial.printf(
            "[OTA] Firmware sigmiyor: gereken=%lu, uygun=%lu bayt.\n",
            static_cast<unsigned long>(command.firmwareSize),
            static_cast<unsigned long>(availableSpace)
        );
        _mqttManager.publishOtaStatus("HATA", "Firmware OTA bolumune sigmiyor", version);
        return false;
    }

    Serial.printf(
        "[OTA] Guncelleme basliyor: %s -> %s (%lu bayt).\n",
        FIRMWARE_VERSION,
        version.c_str(),
        static_cast<unsigned long>(command.firmwareSize)
    );
    _mqttManager.publishOtaStatus("BASLADI", "Firmware Ethernet ile indiriliyor", version, 0);
    delay(150);

#if defined(NETWORK_USE_ETHERNET) && NETWORK_USE_ETHERNET
    return performEthernetDownload(command);
#else
    WiFiClient otaClient;
    httpUpdate.rebootOnUpdate(false);
    httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    const String expectedMd5(command.firmwareMd5.c_str());
    const HTTPUpdateResult result = httpUpdate.update(
        otaClient,
        String(command.firmwareUrl.c_str()),
        String(FIRMWARE_VERSION),
        [&](HTTPClient *http) {
            http->addHeader("x-OTA-Expected-MD5", expectedMd5);
            http->addHeader("x-Device-Id", String(DEVICE_ID));
        }
    );
    if (result == HTTP_UPDATE_OK) {
        _mqttManager.publishOtaStatus("BASARILI", "Firmware yazildi; cihaz yeniden baslatiliyor", version, 100);
        delay(750);
        ESP.restart();
        return true;
    }
    const String error = httpUpdate.getLastErrorString();
    Serial.printf("[OTA] Guncelleme basarisiz: %s\n", error.c_str());
    _mqttManager.publishOtaStatus("HATA", error.c_str(), version);
    return result == HTTP_UPDATE_NO_UPDATES;
#endif
}

#endif
