/*
 * SmartVent gateway (ESP32-S3).
 *
 * Data path  : node --BLE notify--> gateway --MQTT/TLS--> AWS IoT Core
 * Command path: AWS IoT Core --MQTT smartvent/<id>/cmd--> gateway --BLE write--> node <id>
 *
 * While the cloud is unreachable, every received reading is stored in the
 * offline ring buffer with its receive timestamp. After reconnecting, the
 * buffer is drained to smartvent/<id>/backfill (stored as history only) while
 * live readings continue on smartvent/<id>/telemetry.
 *
 * Serial commands (115200 baud) for testing:
 *   x  toggle simulated network outage
 *   s  print status
 */
#include <Arduino.h>
#include <ArduinoJson.h>

#include "ble_central.h"
#include "cloud.h"
#include "config.h"
#include "offline_buffer.h"
#include "protocol.h"
#include "secrets.h"

static OfflineBuffer offlineBuffer;
static bool wasOnline = false;

// Resolve the wall-clock time a sample was received. If the clock wasn't
// synced yet at receipt, back-compute from millis() now that it is.
static uint64_t sampleTimestamp(const TelemetrySample &s) {
    if (s.receivedEpochMs != 0) return s.receivedEpochMs;
    return Cloud::nowEpochMs() - (uint32_t)(millis() - s.receivedMillis);
}

static void publishAck(const char *deviceId, const char *cmdId, const char *status) {
    JsonDocument ack;
    ack["cmdId"] = cmdId;
    ack["deviceId"] = deviceId;
    ack["status"] = status;
    ack["ts"] = Cloud::nowEpochMs();
    Cloud::publish(deviceId, "ack", ack);
}

static void put16(uint8_t *p, int16_t v) {
    p[0] = (uint8_t)(v & 0xff);
    p[1] = (uint8_t)((uint16_t)v >> 8);
}

// Translate a cloud command (JSON) into the node's binary command packet and
// forward it ONLY to the node whose id appears in the MQTT topic. Other nodes
// are never touched, so a command to one node cannot change another.
static void handleCommand(const char *deviceId, JsonDocument &cmd) {
    const char *action = cmd["action"] | "";
    const char *cmdId = cmd["cmdId"] | "";
    uint8_t pkt[SV_COMMAND_LEN] = {0};

    if (strcmp(action, "auto") == 0) {
        pkt[0] = SV_OP_SET_AUTO;
    } else if (strcmp(action, "manual") == 0) {
        pkt[0] = SV_OP_SET_MANUAL;
    } else if (strcmp(action, "fan") == 0) {
        pkt[0] = SV_OP_SET_FAN;
        put16(&pkt[2], (cmd["fanOn"] | false) ? 1 : 0);
    } else if (strcmp(action, "thresholds") == 0) {
        pkt[0] = SV_OP_SET_THRESHOLDS;
        put16(&pkt[2], (int16_t)lround((cmd["tempOn"] | 27.0) * 100));
        put16(&pkt[4], (int16_t)lround((cmd["humOn"] | 60.0) * 100));
        put16(&pkt[6], (int16_t)(cmd["aqOn"] | 1500));
    } else {
        Serial.printf("[CMD] Unknown action '%s' for %s\n", action, deviceId);
        publishAck(deviceId, cmdId, "rejected");
        return;
    }

    if (!BleCentral::isConnected(deviceId)) {
        Serial.printf("[CMD] %s is not connected\n", deviceId);
        publishAck(deviceId, cmdId, "node_offline");
        return;
    }
    bool ok = BleCentral::sendCommand(deviceId, pkt, sizeof(pkt));
    Serial.printf("[CMD] %s -> %s: %s\n", action, deviceId, ok ? "delivered" : "FAILED");
    publishAck(deviceId, cmdId, ok ? "delivered" : "ble_write_failed");
}

static void handleSample(const TelemetrySample &s) {
    if (Cloud::online()) {
        JsonDocument doc;
        telemetryToJson(s, sampleTimestamp(s), "live", THING_NAME, doc);
        if (Cloud::publish(s.deviceId, "telemetry", doc)) return;
    }
    // Offline (or publish failed): keep it for later.
    offlineBuffer.push(s);
}

// Upload a few buffered readings per pass, oldest first, with their original
// timestamps. A sample is removed only after its publish succeeded.
static void drainOfflineBuffer() {
    TelemetrySample s;
    for (int i = 0; i < BACKFILL_BATCH && Cloud::online() && offlineBuffer.peek(s); i++) {
        JsonDocument doc;
        telemetryToJson(s, sampleTimestamp(s), "backfill", THING_NAME, doc);
        if (!Cloud::publish(s.deviceId, "backfill", doc)) break;
        offlineBuffer.pop();
        if (offlineBuffer.size() == 0) Serial.println("[BUF] Backfill complete");
    }
}

static void printStatus() {
    Serial.printf("[STATUS] online=%d forcedOffline=%d nodes=%u buffered=%u dropped=%u\n",
                  Cloud::online(), Cloud::forcedOffline(), BleCentral::connectedCount(),
                  offlineBuffer.size(), offlineBuffer.dropped());
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("SmartVent gateway starting");
    BleCentral::begin();
    Cloud::begin(handleCommand);
}

void loop() {
    Cloud::poll();
    BleCentral::poll();

    bool online = Cloud::online();
    if (online != wasOnline) {
        Serial.printf("[CLOUD] %s (buffered=%u)\n", online ? "ONLINE" : "OFFLINE", offlineBuffer.size());
        wasOnline = online;
    }

    TelemetrySample s;
    while (BleCentral::nextSample(s)) handleSample(s);

    drainOfflineBuffer();

    if (Serial.available()) {
        char c = Serial.read();
        if (c == 'x') {
            Cloud::setForcedOffline(!Cloud::forcedOffline());
            Serial.printf("[TEST] Simulated outage %s\n", Cloud::forcedOffline() ? "ON" : "OFF");
        } else if (c == 's') {
            printStatus();
        }
    }

    static uint32_t lastStatus = 0;
    if (millis() - lastStatus > 30000) {
        lastStatus = millis();
        printStatus();
    }
    delay(10);
}
