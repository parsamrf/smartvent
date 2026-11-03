/*
 * BLE wire protocol shared by the node and the gateway.
 * Keep this file byte-for-byte in sync with firmware/gateway/src/protocol.h.
 *
 * All multi-byte fields are little-endian. Payloads are kept <= 20 bytes so
 * they fit in a single notification at the default ATT MTU (23).
 */
#ifndef SMARTVENT_PROTOCOL_H
#define SMARTVENT_PROTOCOL_H

/* 128-bit UUIDs (base 5f0a0000-7c3e-4b8a-9f4e-2d1c0b5a6e00) */
#define SV_UUID_SERVICE_STR   "5f0a0001-7c3e-4b8a-9f4e-2d1c0b5a6e00"
#define SV_UUID_DEVICE_ID_STR "5f0a0002-7c3e-4b8a-9f4e-2d1c0b5a6e00" /* read: ASCII id */
#define SV_UUID_TELEMETRY_STR "5f0a0003-7c3e-4b8a-9f4e-2d1c0b5a6e00" /* read + notify */
#define SV_UUID_COMMAND_STR   "5f0a0004-7c3e-4b8a-9f4e-2d1c0b5a6e00" /* write */

#define SV_PROTO_VERSION 1

/* Telemetry packet layout (20 bytes):
 *  [0]     version
 *  [1]     mode        0 = auto, 1 = manual
 *  [2]     fan         0 = off,  1 = on
 *  [3]     flags       bit0 = temp/hum sensor ok, bit1 = air-quality sensor ok
 *  [4..5]  temperature int16, 0.01 degC
 *  [6..7]  humidity    uint16, 0.01 %RH
 *  [8..9]  air quality uint16, millivolts at the MQ-135 pin
 *  [10..11] temp_on    int16, 0.01 degC   (current auto threshold)
 *  [12..13] hum_on     uint16, 0.01 %RH
 *  [14..15] aq_on      uint16, millivolts
 *  [16..19] seq        uint32, increments every packet
 */
#define SV_TELEMETRY_LEN 20

#define SV_FLAG_TH_OK (1u << 0)
#define SV_FLAG_AQ_OK (1u << 1)

enum sv_mode { SV_MODE_AUTO = 0, SV_MODE_MANUAL = 1 };

/* Command packet layout (8 bytes):
 *  [0]     opcode (enum sv_opcode)
 *  [1]     reserved
 *  [2..3]  arg0 int16
 *  [4..5]  arg1 int16
 *  [6..7]  arg2 int16
 */
#define SV_COMMAND_LEN 8

enum sv_opcode {
	SV_OP_SET_AUTO = 0x01,       /* return to sensor-based control */
	SV_OP_SET_FAN = 0x02,        /* arg0: 0/1. Switches to manual mode. */
	SV_OP_SET_THRESHOLDS = 0x03, /* arg0: temp_on (0.01C), arg1: hum_on (0.01%), arg2: aq_on (mV) */
	SV_OP_SET_MANUAL = 0x04,     /* freeze current fan state, manual mode */
};

#endif /* SMARTVENT_PROTOCOL_H */
