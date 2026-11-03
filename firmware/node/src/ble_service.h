#ifndef SMARTVENT_BLE_SERVICE_H
#define SMARTVENT_BLE_SERVICE_H

#include <stdbool.h>
#include <stdint.h>

/* Callback invoked (from the BT RX thread) when a valid command was applied,
 * so the main loop can push fresh telemetry immediately. */
typedef void (*ble_command_cb_t)(void);

int ble_service_init(const char *device_id, ble_command_cb_t on_command);

/* Update the telemetry characteristic value and notify the gateway if it has
 * subscribed. */
void ble_service_send_telemetry(const uint8_t *pkt, uint16_t len);

bool ble_service_connected(void);

#endif
