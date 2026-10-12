#pragma once

#include <Arduino.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <time.h>

// W5500 Lite uzerinden DHCP, kablo durumu ve NTP senkronizasyonunu yonetir.
class NetworkManager {
public:
    NetworkManager();

    void begin();
    void update();

    bool isConnected();
    // Modul calisiyor ama Ethernet kablosu takili degil (yeniden baslatma cozmez).
    bool isCableUnplugged();
    // Kablo ve IP yerinde gorunse de soketler takilabilir; W5500'u sifirlayip
    // DHCP'den bastan baglanir.
    void forceRestart();
    bool isTimeSet() const;
    String localIpString() const;
    void printLocalTime();

private:
    byte _mac[6]{};
    EthernetUDP _ntpUdp;
    uint32_t _lastConnectionAttemptMs = 0;
    uint32_t _lastNtpAttemptMs = 0;
    bool _timeSynced = false;
    bool _ethernetStarted = false;
    bool _ntpRequestPending = false;
    byte _ntpPacket[48]{};

    static constexpr uint32_t RECONNECT_INTERVAL_MS = 15000;
    static constexpr uint32_t NTP_RETRY_INTERVAL_MS = 10000;
    static constexpr uint16_t NTP_LOCAL_PORT = 2390;

    void buildMacAddress();
    void resetW5500();
    void startConnection();
    void configureTimezone();
    void startNtpRequest();
    bool pollNtpResponse();
    bool hasValidIp() const;
};
