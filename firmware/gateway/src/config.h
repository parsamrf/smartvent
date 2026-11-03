#pragma once

// MQTT topic layout (one sub-tree per node, keyed by device id):
//   smartvent/<deviceId>/telemetry   gateway -> cloud  live reading + status
//   smartvent/<deviceId>/backfill    gateway -> cloud  reading recovered after an outage
//   smartvent/<deviceId>/cmd         cloud -> gateway  control command
//   smartvent/<deviceId>/ack         gateway -> cloud  command delivery result
#define TOPIC_PREFIX "smartvent/"
#define TOPIC_CMD_FILTER "smartvent/+/cmd"

#define MAX_NODES 2

// Offline buffer: 720 readings = 30 min for two nodes at a 5 s period
// (requirement is >= 5 min). ~35 KB of RAM.
#define OFFLINE_BUFFER_CAPACITY 720

// Backfill messages sent per loop() pass after reconnecting, so live traffic
// and command handling are not starved while the buffer drains.
#define BACKFILL_BATCH 5

#define WIFI_RETRY_MS 10000
#define MQTT_RETRY_MS 5000
#define BLE_SCAN_SECONDS 5
