"""Device registration endpoints.

GET    /devices              list the caller's nodes with their latest status
POST   /devices              register a node   {deviceId, name}
DELETE /devices/{deviceId}   unregister a node
"""
import re
import time

from boto3.dynamodb.conditions import Attr, Key

from common import (ApiError, api_handler, body_json, devices_table, dynamodb,
                    latest_table, require_owned_device, response, user_id)

DEVICE_ID_RE = re.compile(r"^vent-[0-9a-f]{8}$")


def list_devices(uid):
    devices = devices_table.query(
        IndexName="OwnerIndex", KeyConditionExpression=Key("ownerId").eq(uid)
    )["Items"]
    if not devices:
        return []

    # Fetch every node's latest status in one round trip.
    keys = [{"deviceId": d["deviceId"]} for d in devices]
    latest = dynamodb.batch_get_item(
        RequestItems={latest_table.name: {"Keys": keys}}
    )["Responses"].get(latest_table.name, [])
    latest_by_id = {item["deviceId"]: item for item in latest}

    return [
        {
            "deviceId": d["deviceId"],
            "name": d.get("name", d["deviceId"]),
            "createdAt": d.get("createdAt"),
            "latest": latest_by_id.get(d["deviceId"]),  # None until first reading
        }
        for d in sorted(devices, key=lambda d: d.get("createdAt", 0))
    ]


def register(uid, data):
    device_id = str(data.get("deviceId", "")).strip().lower()
    name = str(data.get("name", "")).strip()[:40] or device_id
    if not DEVICE_ID_RE.match(device_id):
        raise ApiError(400, "deviceId must look like 'vent-1a2b3c4d' (printed on the node's serial console)")

    try:
        # Succeeds if the id is unclaimed, or already ours (rename).
        devices_table.put_item(
            Item={"deviceId": device_id, "ownerId": uid, "name": name,
                  "createdAt": int(time.time() * 1000)},
            ConditionExpression=Attr("deviceId").not_exists() | Attr("ownerId").eq(uid),
        )
    except devices_table.meta.client.exceptions.ConditionalCheckFailedException:
        raise ApiError(409, "This device is already registered to another account")
    return {"deviceId": device_id, "name": name}


@api_handler
def handler(event, context):
    uid = user_id(event)
    method = event["requestContext"]["http"]["method"]

    if method == "GET":
        return response(200, {"devices": list_devices(uid)})
    if method == "POST":
        return response(201, register(uid, body_json(event)))
    if method == "DELETE":
        device = require_owned_device(event, uid)
        devices_table.delete_item(Key={"deviceId": device["deviceId"]})
        return response(200, {"deleted": device["deviceId"]})
    raise ApiError(405, "Method not allowed")
