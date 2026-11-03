"""Helpers shared by the SmartVent Lambda handlers."""
import json
import os
from decimal import Decimal

import boto3

dynamodb = boto3.resource("dynamodb")
devices_table = dynamodb.Table(os.environ["DEVICES_TABLE"])
latest_table = dynamodb.Table(os.environ["LATEST_TABLE"])
history_table = dynamodb.Table(os.environ["HISTORY_TABLE"])
commands_table = dynamodb.Table(os.environ["COMMANDS_TABLE"])


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _json_default(o):
    # DynamoDB returns numbers as Decimal.
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"Not serializable: {type(o)}")


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=_json_default),
    }


def user_id(event):
    """Cognito user id (sub) from the JWT validated by the API Gateway authorizer."""
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except (KeyError, TypeError):
        raise ApiError(401, "Not authenticated")


def body_json(event):
    raw = event.get("body") or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(400, "Body must be valid JSON")
    if not isinstance(data, dict):
        raise ApiError(400, "Body must be a JSON object")
    return data


def require_owned_device(event, uid):
    """Return the device record for the {deviceId} path parameter, or raise 404
    if it doesn't exist or belongs to someone else (don't leak existence)."""
    device_id = (event.get("pathParameters") or {}).get("deviceId", "")
    item = devices_table.get_item(Key={"deviceId": device_id}).get("Item")
    if not item or item.get("ownerId") != uid:
        raise ApiError(404, f"Device '{device_id}' is not registered to your account")
    return item


def api_handler(fn):
    """Wrap a handler so ApiError becomes a JSON error response."""

    def wrapped(event, context):
        try:
            return fn(event, context)
        except ApiError as e:
            return response(e.status, {"error": e.message})
        except Exception as e:  # noqa: BLE001 - last-resort guard, logged to CloudWatch
            print(f"Unhandled error: {e!r}")
            return response(500, {"error": "Internal server error"})

    return wrapped
