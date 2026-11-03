# SmartVent: Make It Smart (ECE 513, Fall 2026)

SmartVent is an IoT smart-ventilation system. Two **nRF52840** sensor nodes each measure temperature and humidity (Sensirion SHT31) and turn a fan on automatically when either reading crosses a threshold. The nodes report over **Bluetooth LE** to an **ESP32-S3** gateway, which relays to **AWS IoT Core** using MQTT over TLS. A responsive web app served over HTTPS shows each node and lets logged-in users switch modes, override the fans and change thresholds. Telemetry flows up and commands flow down along the same path.

| | |
|---|---|
| Website | https://3-17-254-71.sslip.io |
| Source code | https://github.com/parsamrf/smartvent |
| Demo video (full project) | _TODO: add link after recording_ |
| Test account | `demo@smartvent.test` / `Vent-yemsg851f07` (owns the two live nodes, Bedroom and Kitchen, with recent data) |

## Architecture

```
 nRF52840 node A â”€â”  BLE (GATT notify / write)
                  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â–º ESP32-S3 gateway â”€â”€MQTT/TLS 8883â”€â”€â–º AWS IoT Core
 nRF52840 node B â”€â”˜           (offline ring buffer)                  â”‚ IoT rules
                                                                     â–¼
     Web app (EC2 + nginx, HTTPS) â—„â”€â”€HTTPSâ”€â”€â–º API Gateway â”€â–º Lambda â”€â–º DynamoDB
                                    Cognito JWT auth â”˜              â””â”€â–º iot-data publish (commands)
```

**Data path.**
1. A node reads its sensors every 5 s, runs the auto rule and drives its LEDs.
2. The node sends a 20-byte BLE notification.
3. The gateway decodes it into JSON and publishes to `smartvent/<deviceId>/telemetry`.
4. IoT rules write the reading to the `Latest` and `History` tables.
5. The dashboard polls `GET /devices`.

**Command path.**
1. The dashboard calls `POST /devices/{id}/commands`.
2. Lambda checks that the caller owns the device and that the command is valid, then publishes `smartvent/<id>/cmd`.
3. The gateway looks up the BLE connection whose Device ID characteristic equals `<id>` and writes an 8-byte command to that node only.
4. The node applies the command and immediately sends fresh telemetry.
5. The dashboard shows success only after that reported state arrives.

**Offline recovery (ECE 513).**
- While Wi-Fi or MQTT is down, the gateway keeps receiving BLE readings. It stores each one in a 720-entry RAM ring buffer, which holds about 30 min for two nodes. Every entry has the device ID and its receive timestamp (NTP time).
- After reconnecting, it uploads the buffer to `smartvent/<id>/backfill`, oldest first, 5 messages per loop pass. Live reporting continues alongside.
- An IoT rule stores backfill messages as individual `History` records with `source: "backfill"`. These never overwrite `Latest`.

**HTTPS (ECE 513).**
- The website is served by nginx on an EC2 instance with a Let's Encrypt certificate (auto-renewed by a systemd timer). Plain HTTP requests get a 301 redirect to HTTPS, and HSTS is enabled.
- API Gateway and Cognito endpoints are HTTPS-only.
- The gateway uses mutual TLS with its X.509 certificate to talk to AWS IoT.

## Repository layout

| Path | Purpose |
|---|---|
| `firmware/node/` | Zephyr / nRF Connect SDK app for the nice!nano (nRF52840) |
| `firmware/node/src/main.c` | Sampling loop, LED outputs, telemetry packing, unique device id from FICR |
| `firmware/node/src/sensors.c` | SHT31 (IÂ²C) temperature + humidity acquisition; optional simulated sensors |
| `firmware/node/src/control.c` | Auto rule with hysteresis, manual override, command decoding |
| `firmware/node/src/ble_service.c` | GATT service (Device ID / Telemetry / Command), advertising + auto-restart |
| `firmware/node/src/protocol.h` | BLE packet formats and UUIDs (shared with gateway) |
| `firmware/node/boards/promicro_nrf52840_nrf52840_uf2.overlay` | Pin wiring: SHT31 on IÂ²C0, three LEDs |
| `firmware/node/src/dfu_reboot.c` | Reboots into the UF2 bootloader when a byte arrives on USB serial |
| `firmware/gateway/` | PlatformIO project for the ESP32-S3 |
| `firmware/gateway/src/main.cpp` | Glue: telemetry routing, command translation/routing, backfill drain |
| `firmware/gateway/src/ble_central.cpp` | NimBLE central: scan, connect up to 2 nodes, subscribe, write commands, reconnect |
| `firmware/gateway/src/cloud.cpp` | Wi-Fi, NTP, MQTT/TLS to AWS IoT with reconnect back-off |
| `firmware/gateway/src/offline_buffer.cpp` | Ring buffer for readings received while offline |
| `firmware/gateway/src/telemetry.h` | Binary packet â†’ JSON conversion |
| `firmware/gateway/src/secrets.example.h` | Template for Wi-Fi credentials and device certificates (real file is git-ignored) |
| `cloud/template.yaml` | AWS SAM: Cognito, DynamoDB, IoT policy + rules, HTTP API, Lambdas |
| `cloud/src/devices.py` | `GET/POST /devices`, `DELETE /devices/{id}` |
| `cloud/src/history.py` | `GET /devices/{id}/history` |
| `cloud/src/commands.py` | Commands, settings, command status; publishes to IoT Core |
| `cloud/src/assistant.py` | Read-only LLM assistant (extra credit) |
| `cloud/src/presignup.py` | Cognito trigger that auto-confirms sign-ups |
| `cloud/src/common.py` | Shared helpers: auth claims, ownership check, JSON responses |
| `cloud/deploy.ps1` | Build/deploy stack, generate `web/js/config.js`, upload website |
| `cloud/setup-iot.ps1` | Create IoT Thing + certificate, generate gateway `secrets.h` |
| `server/setup-ec2.sh` | One-time EC2 setup: nginx, Let's Encrypt certificate, auto-renewal |
| `server/smartvent.conf` | nginx site config |
| `server/deploy-web.ps1` | Upload `web/` to the EC2 instance over SSH |
| `web/` | Static site: home/team, login, register, dashboard, assistant, references |
| `web/js/auth.js` | Cognito sign-up / login / refresh / logout |
| `web/js/api.js` | Authenticated API client |
| `web/js/dashboard.js` | Node cards, controls, reported-state confirmation, history chart |
| `docs/API.md` | API endpoint reference (requests, responses, errors) and MQTT topics |

## Setup

### Prerequisites
- AWS account and the [AWS CLI](https://aws.amazon.com/cli/), configured with `aws configure`
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) and Python 3.12
- [nRF Connect SDK](https://www.nordicsemi.com/Products/Development-software/nRF-Connect-SDK) v3.4.1 (VS Code extension recommended)
- [PlatformIO](https://platformio.org/) (VS Code extension)
- A free [Groq](https://console.groq.com) API key, needed only for the assistant (open-source LLM)

### 1. Deploy the cloud backend
```powershell
cd cloud
# Store the assistant's LLM API key in SSM (it never goes in the repo or the browser)
aws ssm put-parameter --name /smartvent/assistant-api-key --type SecureString --value "<key>"
.\deploy.ps1 -Guided          # first time; afterwards just .\deploy.ps1
```
The script prints the website URL and writes `web/js/config.js`.

### 2. Provision the gateway in AWS IoT
```powershell
.\setup-iot.ps1 -WifiSsid "<ssid>" -WifiPassword "<password>"
```
This creates the Thing and its certificate, attaches `smartvent-gateway-policy`, and writes the git-ignored `firmware/gateway/src/secrets.h`.

### 3. Flash the nodes (nRF52840)
The nodes are **nice!nano** boards (nRF52840, Adafruit UF2 bootloader) built with the Zephyr target `promicro_nrf52840/nrf52840/uf2`. Pins are named by the P-numbers printed on the board.

| Part | Connects to |
|---|---|
| SHT31 VIN / GND | `VCC` (3.3 V) / `GND` (not `RAW`, which is 5 V) |
| SHT31 SDA / SCL (IÂ²C address 0x44) | `006` (P0.06) / `008` (P0.08) |
| Green LED (fan on) | `031` (P0.31) via a resistor to GND |
| Yellow LED (manual mode) | `029` (P0.29) via a resistor to GND |
| Red LED (gateway connected) | `002` (P0.02) via a resistor to GND |

1. Build. The SDK build breaks on paths containing spaces, so build from a path without spaces, for example a copy in `C:\sv\node`:
   ```powershell
   nrfutil sdk-manager toolchain launch --ncs-version v3.4.1 --chdir C:\ncs\v3.4.1\nrf -- `
     west build -b promicro_nrf52840/nrf52840/uf2 -s C:\sv\node -d C:\sv\build --pristine
   ```
   Without a sensor wired, add `-- -DCONFIG_APP_SIMULATED_SENSORS=y`.
2. Flash. Put the board in bootloader mode: briefly short `RST` to `GND` twice in quick succession, and a drive called `NICENANO` appears. Copy `C:\sv\build\node\zephyr\zephyr.uf2` onto it. After that first flash, sending any byte to the board's USB serial port reboots it into bootloader mode, so the reset trick isn't needed again.
3. Open the board's USB serial port (115200 baud) and note the printed id `vent-xxxxxxxx`. Each board gets its own id from its factory ID. Repeat for the second node.

### 4. Flash the gateway (ESP32-S3)
```
cd firmware/gateway
pio run -t upload
pio device monitor
```
The gateway connects to both nodes automatically. Serial command `s` prints its status. `x` toggles a simulated network outage, which is useful for testing. For the graded demo, physically disconnect the network.

### 5. Use it
1. Open the website and register an account.
2. On the Dashboard, add both device ids.
3. Readings appear within a few seconds.

## Testing the ECE 513 offline recovery
1. With both nodes reporting, disconnect the gateway's network, for example by turning off the hotspot, for 5+ minutes. The gateway log shows `[CLOUD] OFFLINE` and the buffer count grows.
2. Reconnect. The log shows `[CLOUD] ONLINE`, then `[BUF] Backfill complete`.
3. In DynamoDB â†’ `HistoryTable`, filter `source = backfill`. The dashboard's history chart also marks recovered points in orange.

## Team and contributions
**Parsa Mirfasihi** and **Afsah Khan** (ECE 413/513, Fall 2026, University of Arizona). The two team members shared all tasks across the whole system: hardware bring-up and wiring, node and gateway firmware, the AWS backend, the web app, testing, and the demo and documentation.

- Parsa Mirfasihi: [website](https://parsamirfasihi.com), [GitHub](https://github.com/parsamrf), [LinkedIn](https://www.linkedin.com/in/parsa-mirfasihi/)
- Afsah Khan: [LinkedIn](https://www.linkedin.com/in/afsah-sharaf-khan-029384311/)

## Lessons learned / Challenges
- **Wi-Fi band:** the ESP32-S3 only joins 2.4 GHz networks. An iPhone hotspot needs "Maximize Compatibility" turned on.
- **Toolchain paths:** the nRF Connect SDK build fails when the project path contains a space (a Kconfig step does not quote it), so we build from a copy in a path without spaces.
- **I²C wiring:** a loose jumper on the SHT31 power or data line made the sensor stop answering. Both lines then read low, and the failure looked like a firmware bug. We added a bit-banged pin scanner to locate the sensor, internal pull-ups, and a self-reboot after repeated failed sensor reads.
- **Honest sensor state:** a failed sensor read is reported as invalid. The dashboard shows dashes instead of the last good value.
- **Command confirmation:** a command is only shown as confirmed after the node's next telemetry packet reports the requested state, not when the gateway merely writes it.
- **Offline recovery:** the gateway keeps each reading's receive time. Replayed readings go to a separate `backfill` topic, so they are stored as history with their original timestamps and never overwrite the live "latest" state.
- **Bootloader entry:** the nice!nano has no reset button. The node firmware reboots into the UF2 bootloader when any byte arrives on its USB serial port, so reflashing does not need the RST-to-GND double tap.


## AI tool usage
As the course requires, we document the AI tools we used. They were development assistants, not a replacement for our own work.
- **Claude Code (Anthropic)** helped us draft, refactor and debug code and documentation for the firmware, the AWS backend and the website, and helped us interpret errors during hardware bring-up.
- **Our own work:** choosing the application and the overall design, wiring and soldering the hardware, setting up the AWS account and the EC2 server, flashing and testing both nodes and the gateway, running the command-routing and offline-recovery tests, and reviewing the code. We can explain and demonstrate all of the code we submit.
- **The Device Assistant** (extra credit) is a product feature, not a development aid. It answers questions with an open-source LLM, Qwen 3.8 27B served through Groq's API.
