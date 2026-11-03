#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "protocol.h"

// One telemetry sample as received from a node, plus the time the gateway
// received it. This is what the offline buffer stores.
struct TelemetrySample {
    char deviceId[24];
    uint8_t raw[SV_TELEMETRY_LEN];
    uint64_t receivedEpochMs; // 0 if the clock was not yet synced at receipt
    uint32_t receivedMillis;  // millis() at receipt, used to back-compute epoch
};

static inline int16_t le16s(const uint8_t *p) { return (int16_t)(p[0] | (p[1] << 8)); }
static inline uint16_t le16u(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static inline uint32_t le32u(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

// Decode the 20-byte BLE packet (layout in protocol.h) into the JSON document
// published to AWS IoT. Invalid sensor values are omitted rather than sent as 0.
static inline void telemetryToJson(const TelemetrySample &s, uint64_t tsMs, const char *source,
                                   const char *gatewayId, JsonDocument &doc) {
    const uint8_t *p = s.raw;
    uint8_t flags = p[3];

    doc["deviceId"] = s.deviceId;
    doc["ts"] = tsMs;
    doc["source"] = source;
    doc["gateway"] = gatewayId;
    doc["mode"] = p[1] == SV_MODE_MANUAL ? "manual" : "auto";
    doc["fanOn"] = p[2] != 0;
    if (flags & SV_FLAG_TH_OK) {
        doc["temperature"] = le16s(&p[4]) / 100.0;
        doc["humidity"] = le16u(&p[6]) / 100.0;
    }
    if (flags & SV_FLAG_AQ_OK) {
        doc["airQuality"] = le16u(&p[8]);
    }
    JsonObject settings = doc["settings"].to<JsonObject>();
    settings["tempOn"] = le16s(&p[10]) / 100.0;
    settings["humOn"] = le16u(&p[12]) / 100.0;
    settings["aqOn"] = le16u(&p[14]);
    doc["seq"] = le32u(&p[16]);
}
