#pragma once

#include <Arduino.h>

/**
 * Fiziksel buzzer ve LED uyarı türleri.
 *
 * Bu modül uyarıyı Firebase veya MQTT'ye göndermez.
 * Yalnızca yerel fiziksel geri bildirimi yönetir.
 */
enum class AlertPattern : uint8_t {
    None,
    Keypress,
    Success,
    Error,
    InvalidPin,
    AccessDenied,
    Lockout,
    DoorOpenTooLong,
    ForcedEntry,
    Offline,
    DeviceError
};

/**
 * Buzzer ve durum LED'ini non-blocking şekilde yönetir.
 *
 * update() metodu loop() içerisinde sürekli çağrılmalıdır.
 */
class AlertSystem {
public:
    /**
     * @param buzzerPin Aktif buzzer GPIO pini
     * @param ledPin Durum LED'i GPIO pini
     * @param buzzerActiveHigh Buzzer HIGH ile aktifse true
     * @param ledActiveHigh LED HIGH ile aktifse true
     */
    AlertSystem(
        uint8_t buzzerPin,
        uint8_t ledPin,
        bool buzzerActiveHigh = true,
        bool ledActiveHigh = true
    );

    /**
     * GPIO pinlerini başlatır.
     */
    void begin();

    /**
     * Aktif alarm desenini ilerletir.
     * loop() içerisinde sürekli çağrılmalıdır.
     */
    void update();

    /**
     * Belirtilen alarm desenini çalıştırır.
     *
     * Aktif alarmdan daha düşük öncelikli bir desen gelirse
     * aktif alarm kesilmez ve false döndürülür.
     */
    bool play(AlertPattern pattern);

    bool playKeypress();
    bool playSuccess();
    bool playError();
    bool playInvalidPin();
    bool playAccessDenied();
    bool playLockout();
    bool playDoorOpenTooLong();
    bool playForcedEntry();
    bool playOffline();
    bool playDeviceError();
    void setPinEntryActive(bool active);

    /**
     * Aktif alarmı koşulsuz durdurur.
     */
    void stop();

    /**
     * Verilen alarm şu anda aktifse durdurur.
     */
    void stop(AlertPattern pattern);

    bool isActive() const;
    AlertPattern getActivePattern() const;

    /**
     * LED çıkışını doğrudan değiştirir.
     * Normal kullanımda alarm desenleri tarafından çağrılır.
     */
    void setLed(bool enabled);

    /**
     * Buzzer çıkışını doğrudan değiştirir.
     * Normal kullanımda alarm desenleri tarafından çağrılır.
     */
    void setBuzzer(bool enabled);

private:
    struct AlertStep {
        bool buzzerOn;
        bool ledOn;
        uint32_t durationMs;
    };

    struct PatternDefinition {
        const AlertStep* steps;
        uint8_t stepCount;
        bool repeat;
    };

    uint8_t _buzzerPin;
    uint8_t _ledPin;

    bool _buzzerActiveHigh;
    bool _ledActiveHigh;

    AlertPattern _activePattern;

    const AlertStep* _activeSteps;
    uint8_t _activeStepCount;
    uint8_t _currentStep;

    bool _repeat;
    bool _started;
    bool _pinEntryActive;

    uint32_t _stepStartedAt;

    static const AlertStep KEYPRESS_STEPS[];
    static const AlertStep SUCCESS_STEPS[];
    static const AlertStep ERROR_STEPS[];
    static const AlertStep ACCESS_DENIED_STEPS[];
    static const AlertStep LOCKOUT_STEPS[];
    static const AlertStep DOOR_OPEN_STEPS[];
    static const AlertStep FORCED_ENTRY_STEPS[];
    static const AlertStep OFFLINE_STEPS[];
    static const AlertStep DEVICE_ERROR_STEPS[];

    PatternDefinition getPatternDefinition(
        AlertPattern pattern
    ) const;

    uint8_t getPriority(
        AlertPattern pattern
    ) const;

    void startPattern(
        AlertPattern pattern,
        const PatternDefinition& definition
    );

    void applyCurrentStep();
    void finishPattern();
};