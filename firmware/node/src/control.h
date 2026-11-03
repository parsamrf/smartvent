#ifndef SMARTVENT_CONTROL_H
#define SMARTVENT_CONTROL_H

#include <stdbool.h>
#include <stdint.h>
#include "protocol.h"
#include "sensors.h"

struct control_state {
	enum sv_mode mode;
	bool fan_on;
	int16_t temp_on_centi;
	uint16_t hum_on_centi;
	uint16_t aq_on_mv;
};

void control_init(void);

/* Run the automatic rule against a new reading (no-op in manual mode).
 * Returns true if the fan state changed. */
bool control_update(const struct sensor_reading *r);

/* Apply a command packet received over BLE. Returns 0 on success, -EINVAL for
 * a malformed / unknown command. */
int control_apply_command(const uint8_t *buf, uint16_t len);

/* Snapshot of the current state (thread-safe copy). */
void control_get(struct control_state *out);

#endif
