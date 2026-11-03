# SmartVent HTTP API

Base URL: the `ApiUrl` output of the CloudFormation stack, e.g.
`https://abc123.execute-api.us-west-2.amazonaws.com`. HTTPS only.

## Authentication

Every endpoint requires a Cognito **ID token** in the `Authorization` header:

```
Authorization: eyJraWQiOi...
```

Get one by logging in through the web app, or with the CLI:

```
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=<email>,PASSWORD=<password> --query AuthenticationResult.IdToken --output text
```

API Gateway's JWT authorizer rejects missing or invalid tokens with `401` before any
Lambda runs. Lambdas then make sure the caller owns the `{deviceId}` in the path. If
the caller doesn't own it, the API returns `404` and does not reveal whether the
device exists.

Errors always look like `{"error": "human readable message"}`.

---

## Devices

### `GET /devices`
Lists the caller's nodes, each with its latest reported state.

Response `200`:
```json
{
  "devices": [
    {
      "deviceId": "vent-1a2b3c4d",
      "name": "Kitchen",
      "createdAt": 1764000000000,
      "latest": {
        "deviceId": "vent-1a2b3c4d",
        "ts": 1764000123456,
        "receivedAt": 1764000123510,
        "source": "live",
        "gateway": "smartvent-gateway",
        "temperature": 24.31,
        "humidity": 48.2,
        "airQuality": 1040,
        "mode": "auto",
        "fanOn": false,
        "settings": { "tempOn": 27.0, "humOn": 60.0, "aqOn": 1500 },
        "seq": 812
      }
    }
  ]
}
```
`latest` is `null` until the node's first reading reaches AWS. `temperature`/`humidity`
or `airQuality` are omitted when that sensor reports invalid.

### `POST /devices`
Registers a node to the caller.

Body: `{"deviceId": "vent-1a2b3c4d", "name": "Kitchen"}`. The `deviceId` must match `vent-[0-9a-f]{8}`. The `name` is optional, up to 40 characters.

| Status | Meaning |
|---|---|
| 201 | `{"deviceId": "...", "name": "..."}` |
| 400 | malformed device id |
| 409 | already registered to another account |

Re-registering your own device renames it.

### `DELETE /devices/{deviceId}`
Unregisters a node. Response `200` `{"deleted": "vent-1a2b3c4d"}`.

### `GET /devices/{deviceId}/history?minutes=60`
Returns historical readings, oldest first. `minutes` can be 1 to 1440 (default 60). At most 2000 items are returned.

Response `200`:
```json
{ "deviceId": "vent-1a2b3c4d", "minutes": 60,
  "items": [ { "ts": 1764000100000, "temperature": 24.2, "...": "...", "source": "live" },
             { "ts": 1764000105000, "...": "...", "source": "backfill" } ] }
```
`source: "backfill"` marks readings the gateway buffered during a network outage and uploaded after reconnecting. Their `ts` is the original receive time. `receivedAt` is when AWS got them.

---

## Control

All control endpoints publish to `smartvent/<deviceId>/cmd`. The gateway delivers the command over BLE **only to that node** and acknowledges on `smartvent/<deviceId>/ack`.

### `POST /devices/{deviceId}/commands`

| Body | Effect |
|---|---|
| `{"action": "auto"}` | return to automatic, sensor-based control |
| `{"action": "manual"}` | manual mode, keep current fan state |
| `{"action": "fan", "fanOn": true}` | manual mode, fan on (or `false` for off) |

Response `202`:
```json
{ "cmdId": "3f2a...", "status": "sent", "command": { "action": "fan", "fanOn": true, "cmdId": "3f2a..." } }
```
| Status | Meaning |
|---|---|
| 400 | invalid action or `fanOn` |
| 404 | not your device |
| 502 | AWS IoT publish failed |

### `PUT /devices/{deviceId}/settings`
Updates the auto-mode thresholds.

Body: `{"tempOn": 27.5, "humOn": 60, "aqOn": 1500}`. Ranges are: `tempOn` -20 to 80 °C, `humOn` 0 to 100 %, and `aqOn` 0 to 3600 mV.

The response is the same as for commands (`202`). The new values appear in `latest.settings` once the node reports them.

### `GET /devices/{deviceId}/commands/{cmdId}`
Gets a command's delivery status.

Response `200`: `{"cmdId": "...", "status": "sent" | "delivered" | "node_offline" | "ble_write_failed" | "rejected"}`.

`delivered` only means the node accepted the BLE write. The dashboard confirms success only when the node's next telemetry packet shows the requested state.

---

## Assistant (extra credit)

### `POST /assistant`
Body: `{"question": "Which room is warmest?"}` (1 to 1000 characters).

Before calling the LLM, the server loads the caller's devices, each one's latest record, and a summary of the last 60 minutes of history. This data is sent as JSON to an open-source LLM (Qwen, served through Groq's OpenAI-compatible chat API), which is instructed to answer only from that data. Times are sent as "seconds ago" and the answer is returned as plain text. The assistant has no tools and cannot send commands.

Response `200`:
```json
{ "answer": "Kitchen (vent-1a2b3c4d) is warmest at 26.1 °C ...", "model": "claude-opus-5-5",
  "snapshot": { "devices": [ ... ] } }
```
| Status | Meaning |
|---|---|
| 429 | rate limited |
| 502 | LLM unavailable |
| 504 | LLM unreachable |

---

## MQTT topics (gateway ⇄ AWS IoT Core)

| Topic | Direction | Payload |
|---|---|---|
| `smartvent/<id>/telemetry` | gateway → cloud | reading JSON (see `latest` above), `source: "live"` |
| `smartvent/<id>/backfill` | gateway → cloud | same, `source: "backfill"`, original `ts` |
| `smartvent/<id>/cmd` | cloud → gateway | `{"cmdId", "action", "fanOn"?, "tempOn"?, "humOn"?, "aqOn"?}` |
| `smartvent/<id>/ack` | gateway → cloud | `{"cmdId", "deviceId", "status", "ts"}` |

IoT rules:

| Topic | Stored in |
|---|---|
| `telemetry` | `Latest` (overwrite) and `History` (append) |
| `backfill` | `History` only |
| `ack` | `Commands` |
