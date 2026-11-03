#include "cloud.h"

#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "config.h"
#include "secrets.h"

namespace {

WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);
Cloud::CommandHandler cmdHandler = nullptr;

uint32_t lastWifiAttempt = 0;
uint32_t lastMqttAttempt = 0;
bool ntpStarted = false;
bool forcedOff = false;

// MQTT message callback. Topic format: smartvent/<deviceId>/cmd
void onMqttMessage(char *topic, byte *payload, unsigned int len) {
    const char *start = topic + strlen(TOPIC_PREFIX);
    const char *slash = strchr(start, '/');
    if (!slash || strcmp(slash, "/cmd") != 0) return;

    char deviceId[24] = {0};
    size_t n = min((size_t)(slash - start), sizeof(deviceId) - 1);
    memcpy(deviceId, start, n);

    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) {
        Serial.printf("[MQTT] Bad JSON on %s\n", topic);
        return;
    }
    if (cmdHandler) cmdHandler(deviceId, doc);
}

void ensureWifi() {
    if (WiFi.status() == WL_CONNECTED) return;
    if (millis() - lastWifiAttempt < WIFI_RETRY_MS && lastWifiAttempt != 0) return;
    lastWifiAttempt = millis();
    Serial.printf("[WiFi] Connecting to %s...\n", WIFI_SSID);
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void ensureMqtt() {
    if (mqtt.connected()) return;
    if (millis() - lastMqttAttempt < MQTT_RETRY_MS && lastMqttAttempt != 0) return;
    lastMqttAttempt = millis();

    // TLS certificate validation needs a valid clock.
    if (!Cloud::clockSynced()) {
        Serial.println("[MQTT] Waiting for NTP time");
        return;
    }
    Serial.println("[MQTT] Connecting to AWS IoT...");
    if (mqtt.connect(THING_NAME)) {
        mqtt.subscribe(TOPIC_CMD_FILTER, 1);
        Serial.println("[MQTT] Connected, subscribed to " TOPIC_CMD_FILTER);
    } else {
        Serial.printf("[MQTT] Connect failed, state=%d\n", mqtt.state());
    }
}

}  // namespace

namespace Cloud {

void begin(CommandHandler handler) {
    cmdHandler = handler;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    tlsClient.setCACert(AWS_ROOT_CA);
    tlsClient.setCertificate(DEVICE_CERT);
    tlsClient.setPrivateKey(DEVICE_PRIVATE_KEY);

    mqtt.setServer(AWS_IOT_ENDPOINT, 8883);
    mqtt.setBufferSize(1024);
    mqtt.setKeepAlive(30);
    mqtt.setCallback(onMqttMessage);
}

void poll() {
    if (forcedOff) {
        if (mqtt.connected()) mqtt.disconnect();
        if (WiFi.status() == WL_CONNECTED) WiFi.disconnect();
        return;
    }

    ensureWifi();
    if (WiFi.status() != WL_CONNECTED) return;

    if (!ntpStarted) {
        // UTC; the web app converts to local time for display.
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
        ntpStarted = true;
    }

    ensureMqtt();
    mqtt.loop();
}

bool online() { return !forcedOff && mqtt.connected(); }

bool clockSynced() { return time(nullptr) > 1700000000; }

uint64_t nowEpochMs() {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return (uint64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

bool publish(const char *deviceId, const char *leaf, JsonDocument &doc) {
    if (!online()) return false;
    char topic[64];
    snprintf(topic, sizeof(topic), TOPIC_PREFIX "%s/%s", deviceId, leaf);
    char buf[512];
    size_t n = serializeJson(doc, buf, sizeof(buf));
    return mqtt.publish(topic, (const uint8_t *)buf, n, false);
}

void setForcedOffline(bool off) {
    forcedOff = off;
    lastWifiAttempt = 0;
    lastMqttAttempt = 0;
}

bool forcedOffline() { return forcedOff; }

}  // namespace Cloud
