#include <WiFi.h>
#include <HTTPClient.h>

// Configure these for your own network and deployed HTTPS API.
// For local testing, use your computer's LAN IPv4 address, not localhost.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_URL = "http://192.168.1.100:3000/api/telemetry"; // change to LAN IP or deployed HTTPS URL
const char* DEVICE_API_KEY = "CHANGE_TO_THE_SAME_DEVICE_API_KEY";

const int LS1_PIN = 18;
const int LS2_PIN = 19;
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 5000;

void setup() {
  Serial.begin(115200);
  pinMode(LS1_PIN, INPUT_PULLUP);
  pinMode(LS2_PIN, INPUT_PULLUP);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Wi-Fi connected. ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(1000);
    return;
  }
  if (millis() - lastSend < SEND_INTERVAL_MS) return;
  lastSend = millis();

  bool ls1 = digitalRead(LS1_PIN) == LOW; // switch to GND = active
  bool ls2 = digitalRead(LS2_PIN) == LOW;
  String payload = "{";
  payload += "\"station\":\"OGL\",";
  payload += "\"deviceId\":\"railsafe-esp32-01\",";
  payload += "\"ls1\":" + String(ls1 ? "true" : "false") + ",";
  payload += "\"ls2\":" + String(ls2 ? "true" : "false") + ",";
  payload += "\"wifiRssiDbm\":" + String(WiFi.RSSI());
  payload += "}";

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(5000);
  if (http.begin(client, API_URL)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-key", DEVICE_API_KEY);
    int status = http.POST(payload);
    Serial.printf("POST status: %d\n", status);
    if (status > 0) Serial.println(http.getString());
    else Serial.println(http.errorToString(status));
    http.end();
  } else {
    Serial.println("Could not initialize HTTP request");
  }
}
