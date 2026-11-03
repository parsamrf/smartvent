/*
 * SmartVent GATT service (BLE peripheral role).
 *
 * Characteristics:
 *   Device ID  (read)          ASCII id, e.g. "vent-1a2b3c4d"; the gateway reads
 *                              this on connect and uses it to route MQTT commands.
 *   Telemetry  (read, notify)  20-byte packet, see protocol.h
 *   Command    (write)         8-byte packet, see protocol.h
 *
 * Advertising carries the service UUID so the gateway can filter for SmartVent
 * nodes, and restarts automatically after a disconnect (BLE reconnection).
 */
#include "ble_service.h"
#include "control.h"
#include "protocol.h"

#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(ble_service, LOG_LEVEL_INF);

#define SV_UUID_BASE(n) BT_UUID_128_ENCODE(0x5f0a0000 | (n), 0x7c3e, 0x4b8a, 0x9f4e, 0x2d1c0b5a6e00)

static const struct bt_uuid_128 svc_uuid = BT_UUID_INIT_128(SV_UUID_BASE(1));
static const struct bt_uuid_128 id_uuid = BT_UUID_INIT_128(SV_UUID_BASE(2));
static const struct bt_uuid_128 tel_uuid = BT_UUID_INIT_128(SV_UUID_BASE(3));
static const struct bt_uuid_128 cmd_uuid = BT_UUID_INIT_128(SV_UUID_BASE(4));

static char dev_id[24];
static uint8_t tel_value[SV_TELEMETRY_LEN];
static bool notify_enabled;
static struct bt_conn *current_conn;
static ble_command_cb_t command_cb;

static struct k_work adv_work;

/* ---------- GATT callbacks ---------- */

static ssize_t read_id(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
		       uint16_t len, uint16_t offset)
{
	return bt_gatt_attr_read(conn, attr, buf, len, offset, dev_id, strlen(dev_id));
}

static ssize_t read_tel(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			uint16_t len, uint16_t offset)
{
	return bt_gatt_attr_read(conn, attr, buf, len, offset, tel_value, sizeof(tel_value));
}

static void tel_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
	notify_enabled = (value == BT_GATT_CCC_NOTIFY);
	LOG_INF("Telemetry notifications %s", notify_enabled ? "enabled" : "disabled");
}

static ssize_t write_cmd(struct bt_conn *conn, const struct bt_gatt_attr *attr, const void *buf,
			 uint16_t len, uint16_t offset, uint8_t flags)
{
	if (offset != 0) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_OFFSET);
	}
	if (control_apply_command(buf, len) != 0) {
		LOG_WRN("Rejected command (len=%u)", len);
		return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
	}
	if (command_cb) {
		command_cb();
	}
	return len;
}

BT_GATT_SERVICE_DEFINE(smartvent_svc,
	BT_GATT_PRIMARY_SERVICE(&svc_uuid),
	BT_GATT_CHARACTERISTIC(&id_uuid.uuid, BT_GATT_CHRC_READ, BT_GATT_PERM_READ,
			       read_id, NULL, NULL),
	BT_GATT_CHARACTERISTIC(&tel_uuid.uuid, BT_GATT_CHRC_READ | BT_GATT_CHRC_NOTIFY,
			       BT_GATT_PERM_READ, read_tel, NULL, NULL),
	BT_GATT_CCC(tel_ccc_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
	BT_GATT_CHARACTERISTIC(&cmd_uuid.uuid, BT_GATT_CHRC_WRITE | BT_GATT_CHRC_WRITE_WITHOUT_RESP,
			       BT_GATT_PERM_WRITE, NULL, write_cmd, NULL),
);

/* Index of the telemetry value attribute inside smartvent_svc.attrs:
 * [0] service, [1] id decl, [2] id value, [3] tel decl, [4] tel value, ... */
#define TEL_ATTR_IDX 4

/* ---------- Advertising ---------- */

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA_BYTES(BT_DATA_UUID128_ALL, SV_UUID_BASE(1)),
};

static struct bt_data sd[1];

static void adv_work_handler(struct k_work *work)
{
	/* Connectable advertising does not resume by itself after a connection
	 * (Zephyr 4.x / NCS 3.x), so recycled() restarts it after each disconnect. */
	static const struct bt_le_adv_param param = BT_LE_ADV_PARAM_INIT(
		BT_LE_ADV_OPT_CONN,
		BT_GAP_ADV_FAST_INT_MIN_2, BT_GAP_ADV_FAST_INT_MAX_2, NULL);

	int err = bt_le_adv_start(&param, ad, ARRAY_SIZE(ad), sd, ARRAY_SIZE(sd));

	if (err && err != -EALREADY) {
		LOG_ERR("Advertising failed to start (%d)", err);
		return;
	}
	LOG_INF("Advertising as %s", dev_id);
}

/* ---------- Connection callbacks ---------- */

static void connected(struct bt_conn *conn, uint8_t err)
{
	if (err) {
		LOG_WRN("Connection failed (0x%02x)", err);
		return;
	}
	current_conn = bt_conn_ref(conn);
	LOG_INF("Gateway connected");
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
	LOG_INF("Gateway disconnected (reason 0x%02x)", reason);
	notify_enabled = false;
	if (current_conn) {
		bt_conn_unref(current_conn);
		current_conn = NULL;
	}
}

/* Called once the connection object is freed; only now can advertising
 * restart when CONFIG_BT_MAX_CONN=1. */
static void recycled(void)
{
	k_work_submit(&adv_work);
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
	.connected = connected,
	.disconnected = disconnected,
	.recycled = recycled,
};

/* ---------- Public API ---------- */

int ble_service_init(const char *device_id, ble_command_cb_t on_command)
{
	int err;

	strncpy(dev_id, device_id, sizeof(dev_id) - 1);
	command_cb = on_command;

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("bt_enable failed (%d)", err);
		return err;
	}

	/* Put the device id in the GAP name and scan response so it is visible
	 * in nRF Connect / the gateway scan log. */
	bt_set_name(dev_id);
	sd[0].type = BT_DATA_NAME_COMPLETE;
	sd[0].data_len = strlen(dev_id);
	sd[0].data = (const uint8_t *)dev_id;

	k_work_init(&adv_work, adv_work_handler);
	k_work_submit(&adv_work);
	return 0;
}

void ble_service_send_telemetry(const uint8_t *pkt, uint16_t len)
{
	memcpy(tel_value, pkt, MIN(len, sizeof(tel_value)));

	if (current_conn && notify_enabled) {
		int err = bt_gatt_notify(current_conn, &smartvent_svc.attrs[TEL_ATTR_IDX],
					 tel_value, sizeof(tel_value));
		if (err) {
			LOG_WRN("Notify failed (%d)", err);
		}
	}
}

bool ble_service_connected(void)
{
	return current_conn != NULL;
}
