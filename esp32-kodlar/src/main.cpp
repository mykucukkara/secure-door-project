#include <Arduino.h>
#include <SPI.h>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>

#include "config.h"
#include "AccessControl.h"
#include "AlertSystem.h"
#include "CardReader.h"
#include "DoorState.h"
#include "KeypadInput.h"
#include "LcdDisplay.h"
#include "LockController.h"
#include "MqttManager.h"
#include "NetworkManager.h"
#include "OfflineQueue.h"
#include "OtaUpdater.h"
#include "RtcManager.h"

static byte rowPins[KeypadInput::ROW_COUNT] = {
    KEYPAD_ROW_1, KEYPAD_ROW_2, KEYPAD_ROW_3, KEYPAD_ROW_4
};
static byte colPins[KeypadInput::COLUMN_COUNT] = {
    KEYPAD_COL_1, KEYPAD_COL_2, KEYPAD_COL_3
};

CardReader cardReader(RFID_SS_PIN, RFID_RST_PIN, RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN);
MqttManager mqttManager(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
OtaUpdater otaUpdater(mqttManager);
LockController lock(RELAY_PIN);
NetworkManager network;
AccessControl accessControl;

AlertSystem alertSystem(
    BUZZER_PIN,
    LED_PIN, // 26 Pin config'den alinir
    false,
    true
);

LcdDisplay lcdDisplay(I2C_SDA_PIN, I2C_SCL_PIN);
RtcManager rtcManager(I2C_SDA_PIN, I2C_SCL_PIN);
KeypadInput keypadInput(
    rowPins, colPins, KEYPAD_MIN_LEN, KEYPAD_MAX_LEN, KEYPAD_TIMEOUT
);

struct PendingAccessRequest {
    bool active = false;
    std::string requestId;
    std::string credential;
    bool isCard = false;
    uint32_t sentAtMs = 0;
};

static PendingAccessRequest pendingAccess;
static constexpr uint32_t ACCESS_RESPONSE_TIMEOUT_MS = 6000;
static uint32_t lastHeartbeatMs = 0;
static bool doorSensorInitialized = false;
static constexpr uint8_t DOOR_SENSOR_CLOSED_LEVEL = LOW;
static bool lastDoorPhysicallyOpen = false;
static bool pendingDoorSensorState = false;
static uint32_t doorSensorChangedAtMs = 0;
static constexpr uint32_t DOOR_SENSOR_DEBOUNCE_MS = 500;
static uint32_t doorOpenedAtMs = 0;
static bool doorOpenAlarmActive = false;
static constexpr uint32_t DOOR_OPEN_ALARM_DELAY_MS = 20000;
static Durum lastLcdWorkflowState = Durum::ALARM;
static bool lastAccessFailureWasConnection = false;
static bool rtcSyncedFromNtp = false;

enum class ConnectivityLcdState : uint8_t {
    UNKNOWN, ETHERNET_DOWN, MQTT_WAITING, ONLINE
};

static ConnectivityLcdState connectivityLcdState = ConnectivityLcdState::UNKNOWN;
static bool mqttWasConnected = false;
static bool onlineAnnouncementActive = false;
static uint32_t connectivityMessageAtMs = 0;
static constexpr uint32_t ONLINE_LCD_MESSAGE_MS = 3000;

static time_t currentEpoch() {
    if (network.isTimeSet()) return time(nullptr);
    if (rtcManager.isAvailable() && !rtcManager.lostPower()) {
        return rtcManager.getEpoch();
    }
    return time(nullptr);
}

static bool isTimeFromRtc() {
    return !network.isTimeSet() && rtcManager.isAvailable() && !rtcManager.lostPower();
}

static void syncRtcFromNtpIfNeeded() {
    if (rtcSyncedFromNtp || !network.isTimeSet() || !rtcManager.isAvailable()) return;
    rtcManager.syncFromEpoch(time(nullptr));
    rtcSyncedFromNtp = true;
}

static std::string createEventId() {
    uint32_t a = esp_random(); uint32_t b = esp_random();
    uint32_t c = esp_random(); uint32_t d = esp_random();
    char buffer[37];
    snprintf(buffer, sizeof(buffer), "%08lx-%04lx-4%03lx-%04lx-%08lx%04lx",
             (unsigned long)a, (unsigned long)(b & 0xffff),
             (unsigned long)((b >> 16) & 0x0fff),
             (unsigned long)(0x8000 | (c & 0x3fff)),
             (unsigned long)d, (unsigned long)((c >> 16) & 0xffff));
    return std::string(buffer);
}

static void publishOrQueue(EntryEvent &event, const String &queueValue) {
    if (mqttManager.publishEntryEvent(event)) return;
    OfflineQueue::olayEkle(queueValue.c_str(), event.dogrulamaYontemi.c_str(), event.sonuc == "izin", event.timestampEpoch);
}

static void applyAccessDecision(bool allowed, const std::string &reason = "") {
    lastAccessFailureWasConnection = false;
    if (allowed) {
        Serial.println("[AUTH] MQTT sunucu karari: ONAYLANDI.");
        DoorState::durumGecisiYap(Durum::ONAYLANDI);
        alertSystem.playSuccess();
        if (doorSensorInitialized && lastDoorPhysicallyOpen) {
            Serial.println("[KILIT] Kapi zaten ACIK; role tetiklenmedi.");
        } else if (!lock.unlockDoor()) {
            Serial.println("[KILIT] Role darbesi devam ettigi icin yeni tetikleme atlandi.");
        }
    } else {
        Serial.printf("[AUTH] MQTT sunucu karari: REDDEDILDI%s%s.\n", reason.empty() ? "" : " - ", reason.c_str());
        DoorState::durumGecisiYap(Durum::REDDEDILDI);
        alertSystem.playAccessDenied();
    }
}

static void applyConnectionUnavailable() {
    lastAccessFailureWasConnection = true;
    Serial.println("[AUTH] DOGRU/YANLIS karari verilemedi: MQTT baglantisi yok. Kapi KAPALI kaldi.");
    DoorState::durumGecisiYap(Durum::REDDEDILDI);
    lcdDisplay.showConnectionUnavailable();
}

static void processCredential(const String &credential, bool isCard) {
    if (DoorState::mevcutDurumuAl() != Durum::BEKLEMEDE) return;
    if (pendingAccess.active) return;

    EntryEvent event;
    event.cihazOlayId = createEventId();
    event.cihazId = DEVICE_ID;
    event.kapiId = DOOR_ID;
    event.dogrulamaYontemi = isCard ? "kart" : "pin";
    event.timestampEpoch = currentEpoch();

    if (isCard) event.okunanUid = std::string(credential.c_str());
    else event.pin = std::string(credential.c_str());

    if (mqttManager.publishEntryEvent(event)) {
        pendingAccess.active = true;
        pendingAccess.requestId = event.cihazOlayId;
        pendingAccess.credential = std::string(credential.c_str());
        pendingAccess.isCard = isCard;
        pendingAccess.sentAtMs = millis();
        DoorState::durumGecisiYap(Durum::OKUNUYOR);
        Serial.printf("[AUTH] %s dogrulama istegi MQTT ile gonderildi.\n", isCard ? "Kart" : "PIN");
        return;
    }

    const bool allowed = accessControl.verifyOfflineAccess(credential, isCard);
    event.sonuc = allowed ? "izin" : "red";
    event.kullaniciId = std::string(accessControl.getLastOfflineUserId().c_str());
    if (!allowed) event.redNedeni = isCard ? "mqtt_yok_kart_dogrulanamadi" : "gecersiz_pin";

    if (allowed) applyAccessDecision(true);
    else applyAccessDecision(false, "cevrimdisi_yetki_bulunamadi");
    publishOrQueue(event, isCard ? credential : accessControl.getLastOfflineUserId());
}

static void processPendingCommands() {
    while (mqttManager.hasPendingCommand()) {
        DeviceCommand command = mqttManager.popPendingCommand();
        if (command.type == CommandType::DOOR_OPEN) {
            const bool opened = (!doorSensorInitialized || !lastDoorPhysicallyOpen) && lock.unlockDoor();
            mqttManager.publishPasswordAck(opened);
        } else if (command.type == CommandType::PASSWORD_RENEW) {
            accessControl.syncOfflinePins(String(command.newPasswordListJson.c_str()), command.replacePasswordList);
            mqttManager.publishPasswordAck(true);
        } else if (command.type == CommandType::FIRMWARE_UPDATE) {
            const bool safeToUpdate = DoorState::mevcutDurumuAl() == Durum::BEKLEMEDE && !pendingAccess.active && doorSensorInitialized && !lastDoorPhysicallyOpen && !doorOpenAlarmActive;
            if (!safeToUpdate) {
                mqttManager.publishOtaStatus("HATA", "Kapi kapali ve sistem beklemede olmali", command.firmwareVersion);
                continue;
            }
            otaUpdater.performUpdate(command);
        } else if (command.type == CommandType::ACCESS_RESPONSE) {
            if (!pendingAccess.active || command.requestId != pendingAccess.requestId) continue;
            if (command.accessAllowed && !pendingAccess.isCard && !command.accessUserId.empty()) {
                accessControl.rememberOfflineAccess(String(pendingAccess.credential.c_str()), pendingAccess.isCard, String(command.accessUserId.c_str()));
            }
            applyAccessDecision(command.accessAllowed, command.accessReason);
            pendingAccess = PendingAccessRequest{};
        }
    }
}

static void checkAccessResponseTimeout() {
    if (pendingAccess.active && millis() - pendingAccess.sentAtMs >= ACCESS_RESPONSE_TIMEOUT_MS) {
        applyConnectionUnavailable();
        pendingAccess = PendingAccessRequest{};
    }
}

static void replayOneOfflineEvent() {
    if (!mqttManager.isConnected() || OfflineQueue::bekleyenOlaySayisi() == 0) return;
    CevrimdisiOlay queued;
    if (!OfflineQueue::okumayiBaslat()) return;
    const bool read = OfflineQueue::siradakiOlayiOku(queued);
    OfflineQueue::okumayiBitir();
    if (!read) return;

    EntryEvent event;
    event.cihazOlayId = createEventId();
    event.cihazId = DEVICE_ID;
    event.kapiId = DOOR_ID;
    event.dogrulamaYontemi = queued.yontem;
    event.sonuc = queued.basarili ? "izin" : "red";
    event.timestampEpoch = queued.zamanDamgasi;
    if (event.dogrulamaYontemi == "kart") event.okunanUid = queued.veri;
    else event.kullaniciId = queued.veri;

    if (mqttManager.publishEntryEvent(event)) OfflineQueue::ilkOlayiSil();
}

static void updatePhysicalDoorState() {
    const uint8_t sensorLevel = digitalRead(SENSOR_PIN);
    const uint32_t now = millis();
    const bool rawDoorOpen = sensorLevel != DOOR_SENSOR_CLOSED_LEVEL;

    if (!doorSensorInitialized) {
        doorSensorInitialized = true;
        lastDoorPhysicallyOpen = pendingDoorSensorState = rawDoorOpen;
        doorSensorChangedAtMs = now;
        doorOpenedAtMs = rawDoorOpen ? now : 0;
        mqttManager.publishDoorStatus(lastDoorPhysicallyOpen);
        if (DoorState::mevcutDurumuAl() == Durum::BEKLEMEDE) lcdDisplay.showIdle(lastDoorPhysicallyOpen);
        return;
    }

    if (rawDoorOpen != pendingDoorSensorState) {
        pendingDoorSensorState = rawDoorOpen;
        doorSensorChangedAtMs = now;
    } else if (pendingDoorSensorState != lastDoorPhysicallyOpen && now - doorSensorChangedAtMs >= DOOR_SENSOR_DEBOUNCE_MS) {
        lastDoorPhysicallyOpen = pendingDoorSensorState;
        doorOpenedAtMs = lastDoorPhysicallyOpen ? now : 0;
        mqttManager.publishDoorStatus(lastDoorPhysicallyOpen);
        if (DoorState::mevcutDurumuAl() == Durum::BEKLEMEDE) lcdDisplay.showIdle(lastDoorPhysicallyOpen);
    }
}

static void updateDoorOpenAlarm() {
    if (!doorSensorInitialized) return;

    if (lastDoorPhysicallyOpen && !doorOpenAlarmActive && millis() - doorOpenedAtMs >= DOOR_OPEN_ALARM_DELAY_MS) {
        doorOpenAlarmActive = true;
        alertSystem.playDoorOpenTooLong();
        lcdDisplay.showAlarm();
        return;
    }

    if (!lastDoorPhysicallyOpen && doorOpenAlarmActive) {
        doorOpenAlarmActive = false;
        alertSystem.stop(AlertPattern::DoorOpenTooLong);
        lcdDisplay.showIdle(false);
    }
}

static ConnectivityLcdState currentConnectivityState() {
    if (!network.isConnected()) return ConnectivityLcdState::ETHERNET_DOWN;
    if (!mqttManager.isConnected()) return ConnectivityLcdState::MQTT_WAITING;
    return ConnectivityLcdState::ONLINE;
}

static void showCurrentConnectivityMessage() {
    switch (connectivityLcdState) {
        case ConnectivityLcdState::ETHERNET_DOWN: lcdDisplay.showEthernetDisconnected(); break;
        case ConnectivityLcdState::MQTT_WAITING: if (mqttWasConnected) lcdDisplay.showMqttDisconnected(); else lcdDisplay.showMqttWaiting(); break;
        case ConnectivityLcdState::ONLINE: lcdDisplay.showMqttConnected(); break;
        case ConnectivityLcdState::UNKNOWN: lcdDisplay.showEthernetConnecting(); break;
    }
}

static void updateConnectivityLcdStatus() {
    const ConnectivityLcdState nextState = currentConnectivityState();
    if (nextState != connectivityLcdState) {
        connectivityLcdState = nextState;
        connectivityMessageAtMs = millis();
        onlineAnnouncementActive = nextState == ConnectivityLcdState::ONLINE;
        if (nextState == ConnectivityLcdState::ONLINE) mqttWasConnected = true;

        if (DoorState::mevcutDurumuAl() == Durum::BEKLEMEDE && !doorOpenAlarmActive) {
            showCurrentConnectivityMessage();
        }
    }

    if (onlineAnnouncementActive && millis() - connectivityMessageAtMs >= ONLINE_LCD_MESSAGE_MS) {
        onlineAnnouncementActive = false;
        lastLcdWorkflowState = Durum::ALARM;
    }
}

static void updateLcdWorkflowState() {
    if (doorOpenAlarmActive) {
        lcdDisplay.showAlarm();
        return;
    }

    const Durum currentState = DoorState::mevcutDurumuAl();

    if (currentState == Durum::BEKLEMEDE) {
        if (connectivityLcdState == ConnectivityLcdState::ETHERNET_DOWN || connectivityLcdState == ConnectivityLcdState::MQTT_WAITING) {
            showCurrentConnectivityMessage();
            return;
        }
        if (onlineAnnouncementActive) return;
    }

    if (currentState == lastLcdWorkflowState) return;

    switch (currentState) {
        case Durum::BEKLEMEDE:
            lastAccessFailureWasConnection = false;
            lcdDisplay.showIdle(lastDoorPhysicallyOpen);
            break;
        case Durum::OKUNUYOR: lcdDisplay.showChecking(); break;
        case Durum::ONAYLANDI: lcdDisplay.showApproved(); break;
        case Durum::REDDEDILDI:
            if (lastAccessFailureWasConnection) lcdDisplay.showConnectionUnavailable();
            else lcdDisplay.showDenied();
            break;
        case Durum::ALARM: lcdDisplay.showAlarm(); break;
    }

    lastLcdWorkflowState = currentState;
}

void setup() {
    Serial.begin(115200);
    Serial.println("[SYSTEM] SecureDoor baslatiliyor...");

    // SPI ve CS pinleri hazirlaniyor
    pinMode(RFID_SS_PIN, OUTPUT);
    digitalWrite(RFID_SS_PIN, HIGH);
    pinMode(ETHERNET_CS_PIN, OUTPUT);
    digitalWrite(ETHERNET_CS_PIN, HIGH);
    
    // ONEMLI: 4. parametre olan -1, ESP32'nin donanimsal olarak CS pinini ele gecirmesini engeller!
    SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, -1);

    pinMode(SENSOR_PIN, INPUT);

    lcdDisplay.begin();
    lcdDisplay.showBoot();
    rtcManager.begin();
    
    if (rtcManager.isAvailable() && !rtcManager.lostPower()) {
        const time_t rtcEpoch = rtcManager.getEpoch();
        if (rtcEpoch > 1700000000) {
            timeval systemTime = { rtcEpoch, 0 };
            settimeofday(&systemTime, nullptr);
        }
    }

    // ONEMLI DEGISIKLIK: Ethernet (W5500) okuyucudan ONCE baslatilir!
    // Amac, cipin uyandirilarak MISO hattini serbest (tri-state) birakmasini saglamaktir.
    lcdDisplay.showEthernetConnecting();
    network.begin();
    if (network.isConnected()) {
        lcdDisplay.showEthernetConnected(network.localIpString());
    } else {
        lcdDisplay.showEthernetDisconnected();
    }

    // Ethernet MISO hattini birakti, artik RFID okuyucu sorunsuz baslayabilir
    CardReader::setZamanKaynagi(&currentEpoch, &isTimeFromRtc);
    cardReader.begin();
    
    lock.begin();
    alertSystem.begin();
    keypadInput.begin();
    accessControl.begin();
    OfflineQueue::baslat();

    DoorState::durumGecisiYap(Durum::BEKLEMEDE);
    alertSystem.playSuccess();
    Serial.println("[SYSTEM] Hazir.");
}

void loop() {
    network.update();
    syncRtcFromNtpIfNeeded();
    mqttManager.update();
    updateConnectivityLcdStatus();
    accessControl.loop();
    processPendingCommands();
    checkAccessResponseTimeout();
    replayOneOfflineEvent();

    const uint32_t now = millis();
    if (mqttManager.isConnected() && now - lastHeartbeatMs >= 30000) {
        mqttManager.publishHeartbeat(DEVICE_ID);
        lastHeartbeatMs = now;
    }

    cardReader.update();
    if (cardReader.hasNewRead()) {
        processCredential(String(cardReader.getLastCardId().c_str()), true);
    }

    keypadInput.update();
    if (keypadInput.wasKeyPressed()) {
        alertSystem.playKeypress();

        const CustomKeypadEvent keypadEvent = keypadInput.getLastEvent();
        if (keypadEvent.type == KeypadEventType::KeyPressed) {
            alertSystem.setPinEntryActive(true);
            lcdDisplay.showPinEntry(keypadEvent.pinLength);
        } else if (
            keypadEvent.type == KeypadEventType::PinCleared
            || keypadEvent.type == KeypadEventType::PinCancelled
            || keypadEvent.type == KeypadEventType::PinCompleted
        ) {
            alertSystem.setPinEntryActive(false);
            lcdDisplay.showIdle(lastDoorPhysicallyOpen);
        } else if (keypadEvent.type == KeypadEventType::InvalidLength) {
            alertSystem.setPinEntryActive(false);
            lcdDisplay.showPinInvalid();
        }
    }
    if (keypadInput.hasTimedOut()) {
        alertSystem.setPinEntryActive(false);
    }
    if (keypadInput.isPinReady()) {
        processCredential(keypadInput.consumePin(), false);
    }

    alertSystem.update();
    updatePhysicalDoorState();
    updateDoorOpenAlarm();
    lock.update();
    DoorState::guncelle();
    updateLcdWorkflowState();
    lcdDisplay.update();
}