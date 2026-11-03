"""Control endpoints. Every route requires a logged-in user who owns the node.

POST /devices/{deviceId}/commands          {action: "auto"|"manual"|"fan", fanOn?: bool}
PUT  /devices/{deviceId}/settings          {tempOn: degC, humOn: %RH, aqOn: mV}
GET  /devices/{deviceId}/commands/{cmdId}  delivery status reported by the gateway

A validated command is published to smartvent/<deviceId>/cmd. The gateway
relays it over BLE to that node only and acknowledges on smartvent/<id>/ack,
which an IoT rule stores in the Commands table. The dashboard then waits for
the node's *reported* state to change rather than assuming success.
"""
import json
import time
import uuid

import boto3

from common import (ApiError, api_handler, body_json, commands_table,
                    require_owned_device, response, user_id)

_iot_data = None


def iot_data():
    """iot-data client bound to this account's ATS endpoint (looked up once)."""
    global _iot_data
    if _iot_data is None:
        endpoint = boto3.client("iot").describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
        _iot_data = boto3.client("iot-data", endpoint_url=f"https://{endpoint}")
    return _iot_data


def _number(data, key, lo, hi):
    v = data.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ApiError(400, f"'{key}' must be a number")
    if not lo <= v <= hi:
        raise ApiError(400, f"'{key}' must be between {lo} and {hi}")
    return v


def validate_command(data):
    action = data.get("action")
    if action in ("auto", "manual"):
        return {"action": action}
    if action == "fan":
        if not isinstance(data.get("fanOn"), bool):
            raise ApiError(400, "'fanOn' must be true or false")
        return {"action": "fan", "fanOn": data["fanOn"]}
    raise ApiError(400, "action must be one of: auto, manual, fan")


def validate_settings(data):
    return {
        "action": "thresholds",
        "tempOn": round(_number(data, "tempOn", -20, 80), 2),
        "humOn": round(_number(data, "humOn", 0, 100), 2),
        "aqOn": int(_number(data, "aqOn", 0, 3600)),
    }


def publish(device_id, cmd):
    cmd["cmdId"] = uuid.uuid4().hex
    now = int(time.time() * 1000)
    commands_table.put_item(Item={
        "cmdId": cmd["cmdId"], "deviceId": device_id, "status": "sent",
        "action": cmd["action"], "ts": now, "expiresAt": now // 1000 + 86400,
    })
    try:
        iot_data().publish(topic=f"smartvent/{device_id}/cmd", qos=1, payload=json.dumps(cmd))
    except Exception as e:  # noqa: BLE001
        print(f"IoT publish failed: {e!r}")
        raise ApiError(502, "Could not reach AWS IoT Core; command not sent")
    return {"cmdId": cmd["cmdId"], "status": "sent", "command": cmd}


@api_handler
def handler(event, context):
    uid = user_id(event)
    device = require_owned_device(event, uid)
    method = event["requestContext"]["http"]["method"]
    path = event["requestContext"]["http"]["path"]

    if method == "GET":
        cmd_id = event["pathParameters"].get("cmdId", "")
        item = commands_table.get_item(Key={"cmdId": cmd_id}).get("Item")
        if not item or item.get("deviceId") != device["deviceId"]:
            raise ApiError(404, "Unknown command")
        return response(200, {"cmdId": cmd_id, "status": item.get("status")})

    data = body_json(event)
    cmd = validate_settings(data) if path.endswith("/settings") else validate_command(data)
    return response(202, publish(device["deviceId"], cmd))
