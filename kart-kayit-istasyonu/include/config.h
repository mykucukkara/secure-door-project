#pragma once

// =============================================================================
// Kart Kayıt İstasyonu — donanım ayarları
// =============================================================================
// Pinler kapı cihazıyla (esp32-kodlar) aynı tutuldu; böylece aynı kablolama
// ile hem istasyon hem kapı kartı test edilebilir.
//
//   MFRC522   ->  ESP32
//   SDA/SS    ->  GPIO5
//   SCK       ->  GPIO18
//   MOSI      ->  GPIO23
//   MISO      ->  GPIO19
//   RST       ->  GPIO22
//   3.3V      ->  3V3   (5V BAĞLAMAYIN!)
//   GND       ->  GND
//   IRQ       ->  boş
// =============================================================================

#define RFID_SS_PIN   5
#define RFID_RST_PIN  22
#define RFID_SCK_PIN  18
#define RFID_MISO_PIN 19
#define RFID_MOSI_PIN 23

// Durum LED'i (çoğu ESP32 DevKit kartında dahili mavi LED GPIO2'dedir).
// Kullanmak istemiyorsanız -1 yapın.
#define STATUS_LED_PIN 2

// İsteğe bağlı buzzer (pasif buzzer, PWM). Kullanmıyorsanız -1 bırakın.
#define BUZZER_PIN -1

#define SERIAL_BAUD 115200

// Aynı kart okuyucunun üzerinde bekletilirse tekrar yazdırmamak için süre (ms).
// Kart çekilip yeniden okutulursa bu süreyi beklemeden tekrar yazdırılır.
#define SAME_CARD_HOLD_MS 1500

// Okuyucu bağlantısını kontrol etme aralığı (ms).
#define READER_HEALTH_CHECK_MS 5000
