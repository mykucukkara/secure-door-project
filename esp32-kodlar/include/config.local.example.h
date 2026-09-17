#pragma once

#define WIFI_SSID "kablosuz-ag-adi"
#define WIFI_IDENTITY "" // Eduroam anonim kimliği; normal Wi-Fi için boş bırakın.
#define WIFI_USERNAME "" // Eduroam kullanıcı adı; normal Wi-Fi için boş bırakın.
#define WIFI_PASSWORD "kablosuz-ag-parolasi"
#define MQTT_BROKER_HOST "10.9.2.50"
#define MQTT_BROKER_PORT 1883
#define DEVICE_ID 1
#define DOOR_ID 1
#define FIRMWARE_VERSION "1.0.0"

// W5500 Lite kablolu Ethernet. DHCP ile otomatik IP alir. W5500 ve RFID
// SCK/MISO/MOSI hatlarini ortak kullanir; CS pinleri farkli olmalidir.
#define NETWORK_USE_ETHERNET 1
#define ETHERNET_CS_PIN 13
// W5500 Lite RST ve INT bu devrede bagli degil.
#define ETHERNET_RST_PIN -1
#define ETHERNET_INT_PIN -1
#define ETHERNET_DHCP_TIMEOUT_MS 10000

// --- Bulut MQTT broker (internet uzerinden erisim icin) ---
// Yerel/anonim broker (10.9.2.50:1883) kullaniyorsan asagidaki 3 satiri comment birak.
// HiveMQ Cloud gibi bir bulut broker kullaniyorsan:
//   * Yukaridaki MQTT_BROKER_HOST -> cluster adresin (orn. xxxx.s1.eu.hivemq.cloud)
//   * Yukaridaki MQTT_BROKER_PORT -> 8883
//   * Asagidaki 3 satirin comment'ini kaldir ve doldur:
//#define MQTT_USE_TLS 1
//#define MQTT_USERNAME "broker_kullanici"
//#define MQTT_PASSWORD "broker_parola"


#define RFID_SS_PIN 5
#define RFID_RST_PIN 22
#define RFID_SCK_PIN 18
#define RFID_MISO_PIN 19
#define RFID_MOSI_PIN 23
#define RELAY_PIN 27
#define BUZZER_PIN 14
#define SENSOR_PIN 35
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 17
// PCF8574T RGB LED genisletici: A0/A1=OFF, A2=ON -> 0x24.
// Ortak arti (common-anode) RGB LED: P0=kirmizi, P3=yesil, P5=mavi.
//#define PCF8574_LED_ADDRESS 0x24
//#define LED_RED_PIN 0
//#define LED_GREEN_PIN 3
//#define LED_BLUE_PIN 5
#define LED_PIN 26
// Keypad dogrudan ESP32 GPIO pinlerine baglidir.
#define KEYPAD_ROW_1 4
#define KEYPAD_ROW_2 16
#define KEYPAD_ROW_3 32
#define KEYPAD_ROW_4 33
#define KEYPAD_COL_1 15
#define KEYPAD_COL_2 12
#define KEYPAD_COL_3 2
#define KEYPAD_MIN_LEN 4
#define KEYPAD_MAX_LEN 6
#define KEYPAD_TIMEOUT 15000
#define ZAMAN_DILIMI_DK 180
#define NTP_SUNUCU_1 "pool.ntp.org"
#define NTP_SUNUCU_2 "time.nist.gov"
