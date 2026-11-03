/*
 * Development convenience: any byte received on the USB console reboots the
 * board into the Adafruit UF2 bootloader, so new firmware can be flashed
 * without shorting RST to GND twice.
 */
#include <zephyr/kernel.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/reboot.h>
#include <nrfx.h>

#if DT_HAS_CHOSEN(zephyr_console) && defined(CONFIG_REBOOT)

#define BOOTLOADER_MAGIC_UF2 0x57 /* GPREGRET value the Adafruit bootloader checks */

static void dfu_reboot_thread(void *a, void *b, void *c)
{
	const struct device *u = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));
	unsigned char ch;

	while (1) {
		if (device_is_ready(u) && uart_poll_in(u, &ch) == 0) {
			NRF_POWER->GPREGRET = BOOTLOADER_MAGIC_UF2;
			sys_reboot(SYS_REBOOT_COLD);
		}
		k_msleep(100);
	}
}

K_THREAD_DEFINE(dfu_reboot, 768, dfu_reboot_thread, NULL, NULL, NULL, 14, 0, 0);

#endif
