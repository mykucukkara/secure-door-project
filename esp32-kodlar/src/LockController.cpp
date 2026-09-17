#include "LockController.h"

LockController::LockController(uint8_t relayPin)
    : relayPin(relayPin),
      unlockTimer(0),
      cooldownTimer(0),
      isUnlocked(false),
      isCoolingDown(false) {}

void LockController::begin() {
    // Pin çıkış olarak tanımlanır
    pinMode(relayPin, OUTPUT);
    
    // Sistem açılışında rölenin anlık tetiklenmesini önlemek için 
    // başlangıç durumu kesin olarak HIGH (Pasif/Kapalı) yapılır.
    digitalWrite(relayPin, HIGH);

    Serial.printf(
        "[KILIT] Kontrolcü baslatildi. Pin: GPIO%d, Baslangic Durumu: HIGH (Kapali).\n",
        relayPin
    );
}

bool LockController::unlockDoor() {
    // Eğer soğuma (cooldown) süresindeyse veya zaten açıksa yeni isteği reddet
    if (isCoolingDown || isUnlocked) {
        Serial.println("[KILIT] Uyarı: Kilit şu an soğuma aşamasında veya zaten açık, tetikleme atlandı.");
        return false;
    }

    // Kilidi açmak için röleyi tetikle (Aktif-Düşük mantık: LOW)
    digitalWrite(relayPin, LOW);
    isUnlocked = true;
    unlockTimer = millis();

    Serial.printf(
        "[KILIT] GPIO%d -> LOW (Tetiklendi / Kilit Acildi). Sure: %lu ms.\n",
        relayPin,
        UNLOCK_DURATION
    );
    return true;
}

void LockController::update() {
    const unsigned long now = millis();

    // Açık kalma süresi (UNLOCK_DURATION) dolduysa kilidi kapat
    if (isUnlocked && (now - unlockTimer >= UNLOCK_DURATION)) {
        digitalWrite(relayPin, HIGH); // Röleyi bırak (Pasif)
        isUnlocked = false;
        isCoolingDown = true;
        cooldownTimer = now;

        Serial.printf(
            "[KILIT] GPIO%d -> HIGH (Birakildi / Kilit Kapandi). Gerceklesen sure: %lu ms.\n",
            relayPin,
            now - unlockTimer
        );
    }

    // Cooldown süresi dolduysa yeniden tetiklenebilir hale getir
    if (isCoolingDown && (now - cooldownTimer >= COOLDOWN_DURATION)) {
        isCoolingDown = false;
    }
}