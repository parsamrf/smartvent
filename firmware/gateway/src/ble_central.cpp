#include "ble_central.h"

#include <NimBLEDevice.h>
#include <freertos/queue.h>
#include "config.h"

namespace {

// One slot per connected node. `deviceId` is read from the node's Device ID
// characteristic after connecting and is the key used for command routing.
struct NodeSlot {
    NimBLEClient *client = nullptr;
    NimBLERemoteCharacteristic *cmdChr = nullptr;
    char deviceId[24] = {0};
    bool ready = false;
};

NodeSlot slots[MAX_NODES];

const NimBLEUUID SERVICE_UUID(SV_UUID_SERVICE_STR);
const NimBLEUUID ID_UUID(SV_UUID_DEVICE_ID_STR);
const NimBLEUUID TEL_UUID(SV_UUID_TELEMETRY_STR);
const NimBLEUUID CMD_UUID(SV_UUID_COMMAND_STR);

// Notifications arrive on the NimBLE host task; they are queued here and
// consumed in loop() so MQTT is only ever touched from one task.
QueueHandle_t sampleQueue;

// Address of a node found by the scanner and waiting to be connected.
NimBLEAddress pendingAddr;
volatile bool havePending = false;

int slotForClient(NimBLEClient *c) {
    for (int i = 0; i < MAX_NODES; i++)
        if (slots[i].client == c) return i;
    return -1;
}

bool addressInUse(const NimBLEAddress &a) {
    for (auto &s : slots)
        if (s.client && s.client->isConnected() && s.client->getPeerAddress() == a) return true;
    return false;
}

int freeSlot() {
    for (int i = 0; i < MAX_NODES; i++)
        if (!slots[i].ready) return i;
    return -1;
}

void onNotify(NimBLERemoteCharacteristic *chr, uint8_t *data, size_t len, bool isNotify) {
    int idx = slotForClient(chr->getRemoteService()->getClient());
    if (idx < 0 || len < SV_TELEMETRY_LEN) return;

    TelemetrySample s = {};
    strncpy(s.deviceId, slots[idx].deviceId, sizeof(s.deviceId) - 1);
    memcpy(s.raw, data, SV_TELEMETRY_LEN);
    s.receivedMillis = millis();
    // Stamp with wall-clock time now, so readings buffered during an outage
    // keep their original timestamps.
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    s.receivedEpochMs = tv.tv_sec > 1700000000 ? (uint64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000 : 0;

    xQueueSend(sampleQueue, &s, 0);  // drop if queue is full rather than block BLE
}

class ClientCallbacks : public NimBLEClientCallbacks {
    void onDisconnect(NimBLEClient *c) override {
        int idx = slotForClient(c);
        if (idx >= 0) {
            Serial.printf("[BLE] %s disconnected\n", slots[idx].deviceId);
            // Mark the slot free; poll() will rescan and reconnect.
            slots[idx].ready = false;
            slots[idx].cmdChr = nullptr;
        }
    }
} clientCallbacks;

class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
    void onResult(NimBLEAdvertisedDevice *dev) override {
        if (!dev->isAdvertisingService(SERVICE_UUID)) return;
        if (addressInUse(dev->getAddress()) || havePending) return;
        Serial.printf("[BLE] Found node %s (%s)\n", dev->getName().c_str(),
                      dev->getAddress().toString().c_str());
        pendingAddr = dev->getAddress();
        havePending = true;
        NimBLEDevice::getScan()->stop();
    }
} scanCallbacks;

void onScanEnded(NimBLEScanResults) {}

// Connect to the pending node, read its id, subscribe to telemetry.
void connectPending() {
    int idx = freeSlot();
    havePending = false;
    if (idx < 0) return;

    NodeSlot &slot = slots[idx];
    if (!slot.client) {
        slot.client = NimBLEDevice::createClient();
        slot.client->setClientCallbacks(&clientCallbacks, false);
        slot.client->setConnectTimeout(5);
    }
    if (!slot.client->connect(pendingAddr)) {
        Serial.println("[BLE] Connect failed");
        return;
    }

    NimBLERemoteService *svc = slot.client->getService(SERVICE_UUID);
    NimBLERemoteCharacteristic *idChr = svc ? svc->getCharacteristic(ID_UUID) : nullptr;
    NimBLERemoteCharacteristic *telChr = svc ? svc->getCharacteristic(TEL_UUID) : nullptr;
    slot.cmdChr = svc ? svc->getCharacteristic(CMD_UUID) : nullptr;
    if (!idChr || !telChr || !slot.cmdChr) {
        Serial.println("[BLE] Node is missing SmartVent characteristics");
        slot.client->disconnect();
        return;
    }

    std::string id = idChr->readValue();
    strncpy(slot.deviceId, id.c_str(), sizeof(slot.deviceId) - 1);
    slot.deviceId[sizeof(slot.deviceId) - 1] = '\0';

    if (!telChr->subscribe(true, onNotify)) {
        Serial.println("[BLE] Subscribe failed");
        slot.client->disconnect();
        return;
    }
    slot.ready = true;
    Serial.printf("[BLE] Connected to %s (slot %d)\n", slot.deviceId, idx);
}

}  // namespace

namespace BleCentral {

void begin() {
    sampleQueue = xQueueCreate(32, sizeof(TelemetrySample));
    NimBLEDevice::init("SmartVent-GW");
    NimBLEScan *scan = NimBLEDevice::getScan();
    scan->setAdvertisedDeviceCallbacks(&scanCallbacks, false);
    scan->setActiveScan(true);  // needed to get the name from the scan response
    scan->setInterval(97);
    scan->setWindow(37);
}

void poll() {
    if (havePending) {
        connectPending();
    }
    // Keep scanning in short bursts while any slot is free. This is also how
    // a node that dropped off (BLE disconnect) gets reconnected.
    NimBLEScan *scan = NimBLEDevice::getScan();
    if (freeSlot() >= 0 && !havePending && !scan->isScanning()) {
        scan->clearResults();
        // Passing a completion callback makes start() non-blocking, so MQTT
        // keeps being serviced while we scan.
        scan->start(BLE_SCAN_SECONDS, onScanEnded, false);
    }
}

bool nextSample(TelemetrySample &out) {
    return xQueueReceive(sampleQueue, &out, 0) == pdTRUE;
}

bool sendCommand(const char *deviceId, const uint8_t *pkt, size_t len) {
    for (auto &s : slots) {
        if (s.ready && strcmp(s.deviceId, deviceId) == 0 && s.cmdChr) {
            // Write with response so we know the node accepted the command.
            return s.cmdChr->writeValue(pkt, len, true);
        }
    }
    return false;
}

bool isConnected(const char *deviceId) {
    for (auto &s : slots)
        if (s.ready && strcmp(s.deviceId, deviceId) == 0) return true;
    return false;
}

size_t connectedCount() {
    size_t n = 0;
    for (auto &s : slots)
        if (s.ready) n++;
    return n;
}

}  // namespace BleCentral
