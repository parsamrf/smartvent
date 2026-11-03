#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// Wi-Fi + AWS IoT Core (MQTT over TLS, port 8883) connection management.
namespace Cloud {

// Called for every message on smartvent/<deviceId>/cmd.
typedef void (*CommandHandler)(const char *deviceId, JsonDocument &cmd);

void begin(CommandHandler handler);

// Maintain Wi-Fi / NTP / MQTT, reconnecting with back-off. Call from loop().
void poll();

bool online();          // MQTT session established
bool clockSynced();     // NTP time available
uint64_t nowEpochMs();

// Publish JSON to TOPIC_PREFIX + deviceId + "/" + leaf. Returns false if offline
// or the write failed.
bool publish(const char *deviceId, const char *leaf, JsonDocument &doc);

// Test hook: simulate a network outage without unplugging anything.
void setForcedOffline(bool off);
bool forcedOffline();

}  // namespace Cloud
