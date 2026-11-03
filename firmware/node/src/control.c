/*
 * Ventilation control logic.
 *
 * AUTO mode: the fan turns ON when any reading exceeds its threshold
 * (temperature, humidity or air quality) and turns OFF only when every reading
 * has dropped below threshold minus a hysteresis band. The hysteresis keeps the
 * fan from chattering when a reading hovers around the threshold.
 *
 * MANUAL mode: the fan state is whatever the last command set it to; sensor
 * readings are still sampled and reported but do not drive the output.
 */
#include "control.h"

#include <errno.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(control, LOG_LEVEL_INF);

#define TEMP_HYST_CENTI 50  /* 0.5 degC */
#define HUM_HYST_CENTI  300 /* 3 %RH */
#define AQ_HYST_MV      100

static struct control_state state;
static struct k_mutex lock;

void control_init(void)
{
	k_mutex_init(&lock);
	state.mode = SV_MODE_AUTO;
	state.fan_on = false;
	state.temp_on_centi = CONFIG_APP_DEFAULT_TEMP_ON_CENTI;
	state.hum_on_centi = CONFIG_APP_DEFAULT_HUM_ON_CENTI;
	state.aq_on_mv = CONFIG_APP_DEFAULT_AQ_ON;
}

/* Decide the auto-mode fan state. Invalid sensors are ignored so a broken
 * sensor cannot force the fan on or off. */
static bool auto_decision(const struct sensor_reading *r, bool currently_on)
{
	bool any_above = false;
	bool all_below_off = true;

	if (r->th_ok) {
		if (r->temp_centi >= state.temp_on_centi || r->hum_centi >= state.hum_on_centi) {
			any_above = true;
		}
		if (r->temp_centi > state.temp_on_centi - TEMP_HYST_CENTI ||
		    r->hum_centi > state.hum_on_centi - HUM_HYST_CENTI) {
			all_below_off = false;
		}
	}
	if (r->aq_ok) {
		if (r->aq_mv >= state.aq_on_mv) {
			any_above = true;
		}
		if (r->aq_mv > state.aq_on_mv - AQ_HYST_MV) {
			all_below_off = false;
		}
	}

	if (any_above) {
		return true;
	}
	if (all_below_off) {
		return false;
	}
	return currently_on; /* inside the hysteresis band: keep current state */
}

bool control_update(const struct sensor_reading *r)
{
	bool changed = false;

	k_mutex_lock(&lock, K_FOREVER);
	if (state.mode == SV_MODE_AUTO) {
		bool next = auto_decision(r, state.fan_on);
		changed = next != state.fan_on;
		state.fan_on = next;
	}
	k_mutex_unlock(&lock);

	if (changed) {
		LOG_INF("Auto: fan %s", state.fan_on ? "ON" : "OFF");
	}
	return changed;
}

int control_apply_command(const uint8_t *buf, uint16_t len)
{
	if (len < SV_COMMAND_LEN) {
		return -EINVAL;
	}

	int16_t a0 = (int16_t)sys_get_le16(&buf[2]);
	int16_t a1 = (int16_t)sys_get_le16(&buf[4]);
	int16_t a2 = (int16_t)sys_get_le16(&buf[6]);
	int err = 0;

	k_mutex_lock(&lock, K_FOREVER);
	switch (buf[0]) {
	case SV_OP_SET_AUTO:
		/* The next control_update() call re-evaluates the rule, restoring
		 * sensor-based control. */
		state.mode = SV_MODE_AUTO;
		LOG_INF("Cmd: AUTO mode");
		break;
	case SV_OP_SET_MANUAL:
		state.mode = SV_MODE_MANUAL;
		LOG_INF("Cmd: MANUAL mode (fan stays %s)", state.fan_on ? "ON" : "OFF");
		break;
	case SV_OP_SET_FAN:
		state.mode = SV_MODE_MANUAL;
		state.fan_on = a0 != 0;
		LOG_INF("Cmd: MANUAL fan %s", state.fan_on ? "ON" : "OFF");
		break;
	case SV_OP_SET_THRESHOLDS:
		/* Range-check so a bad command can't produce nonsense thresholds. */
		if (a0 < -2000 || a0 > 8000 || a1 < 0 || a1 > 10000 || a2 < 0 || a2 > 3600) {
			err = -EINVAL;
			break;
		}
		state.temp_on_centi = a0;
		state.hum_on_centi = (uint16_t)a1;
		state.aq_on_mv = (uint16_t)a2;
		LOG_INF("Cmd: thresholds T=%d H=%d AQ=%d", a0, a1, a2);
		break;
	default:
		err = -EINVAL;
	}
	k_mutex_unlock(&lock);
	return err;
}

void control_get(struct control_state *out)
{
	k_mutex_lock(&lock, K_FOREVER);
	*out = state;
	k_mutex_unlock(&lock);
}
