"""GET /devices/{deviceId}/history?minutes=60

Returns the node's historical readings (oldest first). Each record has
`source` = "live" or "backfill" (recovered after a gateway outage).
"""
import time

from boto3.dynamodb.conditions import Key

from common import (ApiError, api_handler, history_table, require_owned_device,
                    response, user_id)

MAX_MINUTES = 24 * 60
MAX_ITEMS = 2000


def query_history(device_id, minutes):
    since = int(time.time() * 1000) - minutes * 60 * 1000
    items, kwargs = [], {
        "KeyConditionExpression": Key("deviceId").eq(device_id) & Key("ts").gte(since),
        "ScanIndexForward": True,
    }
    while len(items) < MAX_ITEMS:
        page = history_table.query(**kwargs)
        items.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return items[:MAX_ITEMS]


@api_handler
def handler(event, context):
    uid = user_id(event)
    device = require_owned_device(event, uid)
    params = event.get("queryStringParameters") or {}
    try:
        minutes = int(params.get("minutes", 60))
    except ValueError:
        raise ApiError(400, "minutes must be an integer")
    minutes = max(1, min(minutes, MAX_MINUTES))

    items = query_history(device["deviceId"], minutes)
    return response(200, {"deviceId": device["deviceId"], "minutes": minutes, "items": items})
