/*
 * Sensor acquisition: a Sensirion SHT31 (temperature + humidity) on I2C.
 * There is no gas sensor on these nodes, so air quality is always reported
 * invalid (aq_ok = false) and the control rule ignores it.
 *
 * With CONFIG_APP_SIMULATED_SENSORS the values are synthesized so the rest of
 * the system can be tested without wiring.
 */
#include "sensors.h"

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/logging/log.h>
#include <zephyr/random/random.h>

LOG_MODULE_REGISTER(sensors, LOG_LEVEL_INF);

#if !defined(CONFIG_APP_SIMULATED_SENSORS)

static const struct device *const sht = DEVICE_DT_GET_ANY(sensirion_sht3xd);

int sensors_init(void)
{
	if (sht == NULL || !device_is_ready(sht)) {
		LOG_WRN("SHT31 not ready; temperature/humidity will be reported invalid");
	}
	return 0;
}

void sensors_read(struct sensor_reading *out)
{
	struct sensor_value t, h;

	out->aq_ok = false;
	out->aq_mv = 0;
	out->th_ok = false;

	if (sht == NULL || !device_is_ready(sht) || sensor_sample_fetch(sht) != 0) {
		return;
	}
	sensor_channel_get(sht, SENSOR_CHAN_AMBIENT_TEMP, &t);
	sensor_channel_get(sht, SENSOR_CHAN_HUMIDITY, &h);

	/* sensor_value is val1 + val2 * 1e-6; convert to hundredths. */
	out->temp_centi = (int16_t)(t.val1 * 100 + t.val2 / 10000);
	out->hum_centi = (uint16_t)(h.val1 * 100 + h.val2 / 10000);
	out->th_ok = true;
}

#else /* CONFIG_APP_SIMULATED_SENSORS */

int sensors_init(void)
{
	LOG_WRN("Using SIMULATED sensors");
	return 0;
}

/* Slow drift around a baseline plus a little noise, so the auto rule toggles
 * now and then and the dashboard shows changing data. */
void sensors_read(struct sensor_reading *out)
{
	static int32_t phase;

	phase = (phase + 1) % 120;
	int32_t tri = phase < 60 ? phase : 120 - phase; /* 0..60..0 */

	out->temp_centi = (int16_t)(2400 + tri * 8 + (int32_t)(sys_rand32_get() % 40) - 20);
	out->hum_centi = (uint16_t)(4500 + tri * 20 + (sys_rand32_get() % 100));
	out->aq_mv = 0;
	out->th_ok = true;
	out->aq_ok = false;
}

#endif
