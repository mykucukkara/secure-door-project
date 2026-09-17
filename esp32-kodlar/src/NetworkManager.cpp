#include "NetworkManager.h"

#include <SPI.h>
#include <sys/time.h>

#include "config.h"

namespace {
constexpr uint32_t NTP_UNIX_EPOCH_OFFSET = 2208988800UL;
constexpr uint16_t NTP_SERVER_PORT = 123;
constexpr uint16_t NTP_PACKET_SIZE = 48;
constexpr uint32_t NTP_RESPONSE_TIMEOUT_MS = 2000;
}

NetworkManager::NetworkManager() = default;

void NetworkManager::buildMacAddress() {
    // Agdaki MAC filtrelemesine takilmamasi icin ethernet kartinin MAC adresi sabitlendi.
    _mac[0] = 0xB6;
    _mac[1] = 0xBF;
    _mac[2] = 0xE9;
    _mac[3] = 0x05;
    _mac[4] = 0xAD;
    _mac[5] = 0xA4;
}

void NetworkManager::resetW5500() {
    pinMode(ETHERNET_CS_PIN, OUTPUT);
    digitalWrite(ETHERNET_CS_PIN, HIGH);

#if ETHERNET_RST_PIN >= 0
    pinMode(ETHERNET_RST_PIN, OUTPUT);
    digitalWrite(ETHERNET_RST_PIN, LOW);
    delay(50);
    digitalWrite(ETHERNET_RST_PIN, HIGH);
    delay(250);
#else
    delay(10);
#endif
}

void NetworkManager::configureTimezone() {
    const int offsetMinutes = ZAMAN_DILIMI_DK;
    const char sign = offsetMinutes >= 0 ? '-' : '+';
    const int absoluteMinutes = abs(offsetMinutes);
    char timezone[20];
    snprintf(
        timezone,
        sizeof(timezone),
        "UTC%c%02d:%02d",
        sign,
        absoluteMinutes / 60,
        absoluteMinutes % 60
    );
    setenv("TZ", timezone, 1);
    tzset();
}

void NetworkManager::begin() {
    buildMacAddress();
    configureTimezone();
    resetW5500();

    Ethernet.init(ETHERNET_CS_PIN);
    startConnection();
}

void NetworkManager::startConnection() {
    Serial.println("[Ethernet] W5500 modulu uyandiriliyor...");

    // Kütüphaneyi ve çipi uyandırmak için bloke etmeyen sahte IP başlatması
    IPAddress dummyIp(0, 0, 0, 0);
    Ethernet.begin(_mac, dummyIp);
    delay(50); // Çipin SPI hattını serbest bırakması için kısa bekleme

    // 1. Asama: Donanım gerçekten var mı kontrol et
    if (Ethernet.hardwareStatus() == EthernetNoHardware) {
        Serial.println("[Ethernet] W5500 bulunamadi; SPI ve CS kablolarini kontrol edin.");
        _lastConnectionAttemptMs = millis();
        _ethernetStarted = false;
        return;
    }

    // 2. Asama: Ağ kablosu takılı mı kontrol et
    if (Ethernet.linkStatus() == LinkOFF) {
        Serial.println("[Ethernet] Kablo takili degil! DHCP atlandi, offline calismaya geciliyor.");
        _lastConnectionAttemptMs = millis();
        _ethernetStarted = true;
        return;
    }

    // 3. Asama: Her şey sağlamsa DHCP'den IP al
    Serial.println("[Ethernet] Kablo algilandi. DHCP'den IP bekleniyor (Maks 4 sn)...");
    const int dhcpResult = Ethernet.begin(
        _mac,
        4000UL, // Bloke olmasını engellemek için 4 saniyeye düşürüldü
        2000UL
    );
    _lastConnectionAttemptMs = millis();
    _ethernetStarted = true;

    if (dhcpResult == 0 || !hasValidIp()) {
        Serial.println("[Ethernet] DHCP yanit vermedi. Ag ayarlarini kontrol edin.");
        return;
    }

    Serial.print("[Ethernet] IP alindi: ");
    Serial.println(Ethernet.localIP());
    Serial.print("[Ethernet] Ag gecidi: ");
    Serial.println(Ethernet.gatewayIP());
    _timeSynced = false;
    _lastNtpAttemptMs = 0;
}

bool NetworkManager::hasValidIp() const {
    const IPAddress ip = Ethernet.localIP();
    return ip[0] != 0 || ip[1] != 0 || ip[2] != 0 || ip[3] != 0;
}

bool NetworkManager::isConnected() {
    if (!_ethernetStarted || !hasValidIp()) return false;
    return Ethernet.hardwareStatus() != EthernetNoHardware
        && Ethernet.linkStatus() != LinkOFF;
}

void NetworkManager::update() {
    const uint32_t now = millis();

    if (_ethernetStarted && isConnected()) {
        const int maintainResult = Ethernet.maintain();
        if (maintainResult == 1 || maintainResult == 3) {
            Serial.println("[Ethernet] DHCP yenileme basarisiz.");
        } else if (maintainResult == 2 || maintainResult == 4) {
            Serial.print("[Ethernet] DHCP yenilendi, IP: ");
            Serial.println(Ethernet.localIP());
        }
    }

    if (!isConnected()) {
        _timeSynced = false;
        _ntpRequestPending = false;
        _ntpUdp.stop();
        if (now - _lastConnectionAttemptMs >= RECONNECT_INTERVAL_MS) {
            if (
                Ethernet.hardwareStatus() != EthernetNoHardware
                && Ethernet.linkStatus() == LinkOFF
            ) {
                _lastConnectionAttemptMs = now;
                return; // Kablo takılı değilse arka planda sessizce bekler
            }
            Serial.println("[Ethernet] Baglanti koptu; W5500 yeniden baslatiliyor...");
            resetW5500();
            Ethernet.init(ETHERNET_CS_PIN);
            startConnection();
        }
        return;
    }

    if (_ntpRequestPending) {
        _timeSynced = pollNtpResponse();
    } else if (!_timeSynced && now - _lastNtpAttemptMs >= NTP_RETRY_INTERVAL_MS) {
        startNtpRequest();
    }
}

void NetworkManager::startNtpRequest() {
    memset(_ntpPacket, 0, sizeof(_ntpPacket));
    _ntpPacket[0] = 0b11100011;
    _ntpPacket[1] = 0;
    _ntpPacket[2] = 6;
    _ntpPacket[3] = 0xEC;
    _ntpPacket[12] = 49;
    _ntpPacket[13] = 0x4E;
    _ntpPacket[14] = 49;
    _ntpPacket[15] = 52;
    _lastNtpAttemptMs = millis();

    _ntpUdp.stop();
    if (_ntpUdp.begin(NTP_LOCAL_PORT) == 0) return;
    if (_ntpUdp.beginPacket(NTP_SUNUCU_1, NTP_SERVER_PORT) == 0) {
        _ntpUdp.stop();
        return;
    }
    _ntpUdp.write(_ntpPacket, sizeof(_ntpPacket));
    _ntpUdp.endPacket();
    _ntpRequestPending = true;
}

bool NetworkManager::pollNtpResponse() {
    const int packetSize = _ntpUdp.parsePacket();
    if (packetSize >= NTP_PACKET_SIZE) {
        _ntpUdp.read(_ntpPacket, sizeof(_ntpPacket));
        _ntpUdp.stop();
        _ntpRequestPending = false;

        const uint32_t ntpSeconds =
            (static_cast<uint32_t>(_ntpPacket[40]) << 24)
            | (static_cast<uint32_t>(_ntpPacket[41]) << 16)
            | (static_cast<uint32_t>(_ntpPacket[42]) << 8)
            | static_cast<uint32_t>(_ntpPacket[43]);
        if (ntpSeconds <= NTP_UNIX_EPOCH_OFFSET) return false;

        timeval systemTime{
            static_cast<time_t>(ntpSeconds - NTP_UNIX_EPOCH_OFFSET),
            0
        };
        settimeofday(&systemTime, nullptr);
        Serial.println("[NTP] Saat W5500 Ethernet uzerinden basariyla cekildi!");
        printLocalTime();
        return true;
    }

    if (millis() - _lastNtpAttemptMs >= NTP_RESPONSE_TIMEOUT_MS) {
        _ntpUdp.stop();
        _ntpRequestPending = false;
        Serial.println("[NTP] Ethernet NTP cevabi zaman asimina ugradi.");
    }
    return false;
}

bool NetworkManager::isTimeSet() const {
    return _timeSynced;
}

String NetworkManager::localIpString() const {
    return Ethernet.localIP().toString();
}

void NetworkManager::printLocalTime() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo, 10)) {
        Serial.println("[NTP] Saat henuz ayarlanmadi.");
        return;
    }
    Serial.println(&timeinfo, "[Tarih/Saat] %A, %B %d %Y %H:%M:%S");
}