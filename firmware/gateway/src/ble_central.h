#pragma once
#include <Arduino.h>
#include "telemetry.h"

// BLE central that discovers SmartVent nodes by service UUID, keeps up to
// MAX_NODES connections open, subscribes to their telemetry and writes
// commands to them by device id.
namespace BleCentral {

void begin();

// Drive scanning/connecting. Call from loop().
void poll();

// Pop one telemetry sample received from any node (non-blocking).
bool nextSample(TelemetrySample &out);

// Write an 8-byte command packet to the node with this id.
// Returns false if no such node is connected or the write failed.
bool sendCommand(const char *deviceId, const uint8_t *pkt, size_t len);

bool isConnected(const char *deviceId);
size_t connectedCount();

}  // namespace BleCentral
