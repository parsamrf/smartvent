/*
 * SmartVent sensor node - main loop.
 *
 * Every CONFIG_APP_SAMPLE_PERIOD_MS the node reads its sensors, runs the
 * automatic ventilation rule, drives the LEDs and notifies the gateway with a
 * telemetry packet. When a command arrives over BLE the loop is woken early so
 * the gateway (and therefore the dashboard) sees the new reported state within
 * a second instead of waiting for the next period.
 *
 * LEDs: led0 (onboard) and the external fan LED show the fan output (stand-in
 * for a fan relay / motor driver). led1 (yellow) is ON in MANUAL mode and led2
 * (red) is ON while the gateway is connected. The external LEDs are wired in
 * the board overlay.
 */
#include <stdio.h>
#include <stdlib.h>
#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/logging/log.h>

#include "ble_service.h"
#include "control.h"
#include "protocol.h"
#include "sensors.h"

LOG_MODULE_REGISTER(main, LOG_LEVEL_INF);

#define SENSOR_FAIL_REBOOT_COUNT 6

static const struct gpio_dt_spec led_fan = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
#if DT_NODE_EXISTS(DT_ALIAS(fan_ext))
static const struct gpio_dt_spec led_fan_ext = GPIO_DT_SPEC_GET(DT_ALIAS(fan_ext), gpios);
#endif
#if DT_NODE_EXISTS(DT_ALIAS(led1))
static const struct gpio_dt_spec led_manual = GPIO_DT_SPEC_GET(DT_ALIAS(led1), gpios);
#endif
#if DT_NODE_EXISTS(DT_ALIAS(led2))
static const struct gpio_dt_spec led_link = GPIO_DT_SPEC_GET(DT_ALIAS(led2), gpios);
#endif

/* Given by the BLE command handler to cut the sleep short. */
static K_SEM_DEFINE(wake_sem, 0, 1);

static void on_command(void)
{
	k_sem_give(&wake_sem);
}

/* Build a unique device id from the chip's factory-programmed DEVICEID. */
static void make_device_id(char *buf, size_t len)
{
	uint8_t hw[8] = {0};
	ssize_t n = hwinfo_get_device_id(hw, sizeof(hw));

	if (n < 4) {
		snprintf(buf, len, "vent-unknown");
		return;
	}
	snprintf(buf, len, "vent-%02x%02x%02x%02x", hw[0], hw[1], hw[2], hw[3]);
}

static void pack_telemetry(uint8_t *pkt, const struct sensor_reading *r,
			   const struct control_state *s, uint32_t seq)
{
	pkt[0] = SV_PROTO_VERSION;
	pkt[1] = (uint8_t)s->mode;
	pkt[2] = s->fan_on ? 1 : 0;
	pkt[3] = (r->th_ok ? SV_FLAG_TH_OK : 0) | (r->aq_ok ? SV_FLAG_AQ_OK : 0);
	sys_put_le16((uint16_t)r->temp_centi, &pkt[4]);
	sys_put_le16(r->hum_centi, &pkt[6]);
	sys_put_le16(r->aq_mv, &pkt[8]);
	sys_put_le16((uint16_t)s->temp_on_centi, &pkt[10]);
	sys_put_le16(s->hum_on_centi, &pkt[12]);
	sys_put_le16(s->aq_on_mv, &pkt[14]);
	sys_put_le32(seq, &pkt[16]);
}

static void leds_init(void)
{
	gpio_pin_configure_dt(&led_fan, GPIO_OUTPUT_INACTIVE);
#if DT_NODE_EXISTS(DT_ALIAS(fan_ext))
	gpio_pin_configure_dt(&led_fan_ext, GPIO_OUTPUT_INACTIVE);
#endif
#if DT_NODE_EXISTS(DT_ALIAS(led1))
	gpio_pin_configure_dt(&led_manual, GPIO_OUTPUT_INACTIVE);
#endif
#if DT_NODE_EXISTS(DT_ALIAS(led2))
	gpio_pin_configure_dt(&led_link, GPIO_OUTPUT_INACTIVE);
#endif
}

int main(void)
{
	static char device_id[24];
	struct sensor_reading reading = {0};
	struct control_state st;
	uint8_t pkt[SV_TELEMETRY_LEN];
	uint32_t seq = 0;
	int read_failures = 0;

	make_device_id(device_id, sizeof(device_id));
	LOG_INF("SmartVent node starting, device id: %s", device_id);

	leds_init();
	sensors_init();
	control_init();
	if (ble_service_init(device_id, on_command) != 0) {
		return 0;
	}

	bool woke_by_command = false;

	while (1) {
		/* Only resample on the periodic tick; a command wake-up just reports
		 * the new state using the last reading. */
		if (!woke_by_command) {
			sensors_read(&reading);
		}
		control_update(&reading);
		control_get(&st);

		gpio_pin_set_dt(&led_fan, st.fan_on);
#if DT_NODE_EXISTS(DT_ALIAS(fan_ext))
		gpio_pin_set_dt(&led_fan_ext, st.fan_on);
#endif
#if DT_NODE_EXISTS(DT_ALIAS(led1))
		gpio_pin_set_dt(&led_manual, st.mode == SV_MODE_MANUAL);
#endif
#if DT_NODE_EXISTS(DT_ALIAS(led2))
		gpio_pin_set_dt(&led_link, ble_service_connected());
#endif

		pack_telemetry(pkt, &reading, &st, seq++);
		ble_service_send_telemetry(pkt, sizeof(pkt));

		if (reading.th_ok) {
			LOG_INF("T=%d.%02dC H=%u.%02u%% mode=%s fan=%s",
				reading.temp_centi / 100, abs(reading.temp_centi % 100),
				reading.hum_centi / 100, reading.hum_centi % 100,
				st.mode == SV_MODE_AUTO ? "auto" : "manual",
				st.fan_on ? "on" : "off");
		} else {
			LOG_WRN("SENSOR READ FAILED (check SHT31 wiring) mode=%s fan=%s",
				st.mode == SV_MODE_AUTO ? "auto" : "manual",
				st.fan_on ? "on" : "off");
		}

		/* A hung sensor or I2C bus does not recover on its own; restart the node
		 * after a run of failed reads (the gateway reconnects automatically). */
		if (!woke_by_command) {
			read_failures = reading.th_ok ? 0 : read_failures + 1;
			if (read_failures >= SENSOR_FAIL_REBOOT_COUNT) {
				LOG_ERR("Sensor unresponsive for %d reads, rebooting",
					read_failures);
				k_msleep(100);
				sys_reboot(SYS_REBOOT_COLD);
			}
		}

		woke_by_command =
			k_sem_take(&wake_sem, K_MSEC(CONFIG_APP_SAMPLE_PERIOD_MS)) == 0;
	}
	return 0;
}
