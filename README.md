# SmartVent: Make It Smart (ECE 513, Fall 2026)

SmartVent is a smart-ventilation system. Two **nRF52840** sensor nodes each measure temperature and humidity (Sensirion SHT31) and switch a fan output on when a reading goes over its threshold. The nodes send their data over **Bluetooth LE** to an **ESP32-S3** gateway. The gateway relays it to **AWS IoT Core** with MQTT over TLS. A responsive web app served over HTTPS shows each node and lets a logged-in user change modes, override the fans and edit thresholds. Readings travel up and commands travel down the same path.

We are claiming the ECE 513 extras (HTTPS and offline data recovery) and the AI Device Assistant extra credit.

| | |
|---|---|
| Website | https://3-17-254-71.sslip.io |
| Source code | https://github.com/parsamrf/smartvent |
| Documentation (user manual and report) | [docs/REPORT.md](docs/REPORT.md) and [docs/REPORT.pdf](docs/REPORT.pdf) |
| Demo video, part 1: website and user experience (12:01) | [SmartVent-Demo-Part1-Frontend.mp4](https://github.com/parsamrf/smartvent/releases/download/demo-videos/SmartVent-Demo-Part1-Frontend.mp4) |
| Demo video, part 2: backend and implementation (7:38) | [SmartVent-Demo-Part2-Backend.mp4](https://github.com/parsamrf/smartvent/releases/download/demo-videos/SmartVent-Demo-Part2-Backend.mp4) |
| Pitch video (about 5 min) | _Not added yet_ |
| Test account | `demo@smartvent.test` / `Vent-yemsg851f07` (owns the two nodes, Bedroom and Kitchen) |

The two demo parts together run 19 min 39 s. Both files are on the [demo-videos release page](https://github.com/parsamrf/smartvent/releases/tag/demo-videos) (they are too big for the repository itself). Download them and play them locally.

## Architecture

```
 nRF52840 node A --+   BLE (GATT notify / write)
                   +-----------------------> ESP32-S3 gateway --MQTT/TLS 8883--> AWS IoT Core
 nRF52840 node B --+      (offline ring buffer)                                      |  IoT rules
                                                                                      v
     Web app (EC2 + nginx, HTTPS) <--HTTPS--> API Gateway --> Lambda --> DynamoDB
                                       Cognito JWT auth ^        '--> iot-data publish (commands)
```

**Data path.**
1. A node reads its sensor every 5 s, runs the auto rule and drives its LEDs.
2. The node sends a 20-byte BLE notification.
3. The gateway decodes it into JSON and publishes it to `smartvent/<deviceId>/telemetry`.
4. IoT rules write the reading to the `Latest` and `History` tables.
5. The dashboard polls `GET /devices`.

**Command path.**
1. The dashboard calls `POST /devices/{id}/commands`.
2. Lambda checks that the caller owns the device and that the command is valid, then publishes to `smartvent/<id>/cmd`.
3. The gateway finds the BLE connection whose Device ID characteristic equals `<id>` and writes an 8-byte command to that node only.
4. The node applies the command and sends fresh telemetry right away.
5. The dashboard shows success only after that reported state arrives.

**Offline recovery (ECE 513).**
- While Wi-Fi or MQTT is down, the gateway keeps receiving BLE readings. It stores each one, with its device ID and NTP receive time, in a 720-entry RAM ring buffer. That holds about 30 minutes for two nodes.
- After it reconnects, it uploads the buffer to `smartvent/<id>/backfill`, oldest first, 5 messages per loop pass. Live reporting keeps going alongside.
- An IoT rule stores each backfill message as its own `History` record with `source: "backfill"`. These never overwrite `Latest`.

**HTTPS (ECE 513).**
- nginx on EC2 serves the site with a Let's Encrypt certificate that a systemd timer renews. Plain HTTP gets a 301 redirect to HTTPS, and HSTS is on.
- API Gateway and Cognito endpoints are HTTPS only.
- The gateway uses mutual TLS with its X.509 certificate to reach AWS IoT.

**AI Device Assistant (extra credit).** The assistant page sends a question to a Lambda. The Lambda first loads the user's devices, each node's latest reading and the last 60 minutes of history from DynamoDB, then passes that data and the question to Qwen 3.8 27B through Groq's API. The model can only read; it has no way to send commands. Details are in [docs/REPORT.md](docs/REPORT.md#210-ai-device-assistant-extra-credit).

## Repository layout

| Path | Purpose |
|---|---|
| `firmware/node/` | Zephyr / nRF Connect SDK app for the nice!nano (nRF52840) |
| `firmware/node/src/main.c` | Sampling loop, LED outputs, telemetry packing, unique device ID from the chip's FICR |
| `firmware/node/src/sensors.c` | SHT31 (I2C) temperature and humidity reads; optional simulated sensors |
| `firmware/node/src/control.c` | Auto rule with hysteresis, manual override, command decoding |
| `firmware/node/src/ble_service.c` | GATT service (Device ID / Telemetry / Command), advertising and auto-restart |
| `firmware/node/src/protocol.h` | BLE packet formats and UUIDs (shared with the gateway) |
| `firmware/node/src/dfu_reboot.c` | Reboots into the UF2 bootloader when a byte arrives on USB serial |
| `firmware/node/boards/promicro_nrf52840_nrf52840_uf2.overlay` | Pin wiring: SHT31 on I2C0, three LEDs |
| `firmware/gateway/` | PlatformIO project for the ESP32-S3 |
| `firmware/gateway/src/main.cpp` | Glue: telemetry routing, command translation and routing, backfill drain |
| `firmware/gateway/src/ble_central.cpp` | NimBLE central: scan, connect up to 2 nodes, subscribe, write commands, reconnect |
| `firmware/gateway/src/cloud.cpp` | Wi-Fi, NTP, MQTT/TLS to AWS IoT with reconnect back-off |
| `firmware/gateway/src/offline_buffer.cpp` | Ring buffer for readings received while offline |
| `firmware/gateway/src/telemetry.h` | Binary packet to JSON conversion |
| `firmware/gateway/src/secrets.example.h` | Template for Wi-Fi credentials and device certificate (the real `secrets.h` is git-ignored) |
| `cloud/template.yaml` | AWS SAM: Cognito, DynamoDB, IoT policy and rules, HTTP API, Lambdas |
| `cloud/src/devices.py` | `GET/POST /devices`, `DELETE /devices/{id}` |
| `cloud/src/history.py` | `GET /devices/{id}/history` |
| `cloud/src/commands.py` | Commands, settings, command status; publishes to IoT Core |
| `cloud/src/assistant.py` | Read-only LLM assistant (extra credit) |
| `cloud/src/presignup.py` | Cognito trigger that auto-confirms sign-ups |
| `cloud/src/common.py` | Shared helpers: auth claims, ownership check, JSON responses |
| `cloud/deploy.ps1` | Build and deploy the stack, generate `web/js/config.js`, upload the website |
| `cloud/setup-iot.ps1` | Create the IoT Thing and certificate, generate the gateway's `secrets.h` |
| `server/setup-ec2.sh` | One-time EC2 setup: nginx, Let's Encrypt certificate, auto-renewal |
| `server/smartvent.conf` | nginx site config |
| `server/deploy-web.ps1` | Upload `web/` to the EC2 instance over SSH |
| `web/` | Static site: home and team, login, register, dashboard, assistant, references |
| `web/js/auth.js` | Cognito sign-up, login, token refresh, logout |
| `web/js/api.js` | Authenticated API client |
| `web/js/dashboard.js` | Node cards, controls, reported-state confirmation, history chart |
| `web/js/chart.js` | History chart, including markers for recovered readings |
| `web/js/assistant.js` | Assistant chat page |
| `docs/REPORT.md`, `docs/REPORT.pdf` | Project documentation and user manual |
| `docs/API.md` | API endpoint reference (requests, responses, errors) and MQTT topics |
| `docs/images/`, `docs/evidence/` | Screenshots, photos and the gateway log used in the report |

## Setup

### Prerequisites
- An AWS account and the [AWS CLI](https://aws.amazon.com/cli/), set up with `aws configure`
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) and Python 3.12
- [nRF Connect SDK](https://www.nordicsemi.com/Products/Development-software/nRF-Connect-SDK) v3.4.1 (the VS Code extension is easiest)
- [PlatformIO](https://platformio.org/) (VS Code extension)
- A free [Groq](https://console.groq.com) API key, needed only for the assistant

### 1. Deploy the cloud backend
```powershell
cd cloud
# Store the assistant's API key in SSM. It never goes in the repo or the browser.
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
The nodes are **nice!nano** boards (nRF52840, Adafruit UF2 bootloader) built for the Zephyr target `promicro_nrf52840/nrf52840/uf2`. Pins are named by the P-numbers printed on the board.

| Part | Connects to |
|---|---|
| SHT31 VIN / GND | `VCC` (3.3 V) / `GND` (not `RAW`, which is 5 V) |
| SHT31 SDA / SCL (I2C address 0x44) | `006` (P0.06) / `008` (P0.08) |
| Green LED (fan on) | `031` (P0.31) through a resistor to GND |
| Yellow LED (manual mode) | `029` (P0.29) through a resistor to GND |
| Red LED (gateway connected) | `002` (P0.02) through a resistor to GND |

1. Build. The SDK build breaks on paths with spaces, so build from a copy in a path without spaces, for example `C:\sv\node`:
   ```powershell
   nrfutil sdk-manager toolchain launch --ncs-version v3.4.1 --chdir C:\ncs\v3.4.1\nrf -- `
     west build -b promicro_nrf52840/nrf52840/uf2 -s C:\sv\node -d C:\sv\build --pristine
   ```
   If no sensor is wired, add `-- -DCONFIG_APP_SIMULATED_SENSORS=y`.
2. Flash. Put the board in bootloader mode by shorting `RST` to `GND` twice in quick succession. A drive called `NICENANO` appears. Copy `C:\sv\build\node\zephyr\zephyr.uf2` onto it. After this first flash, sending any byte to the board's USB serial port reboots it into the bootloader, so the reset trick is not needed again.
3. Open the board's USB serial port (115200 baud) and note the printed id `vent-xxxxxxxx`. Every board gets its own id from its factory chip ID. Repeat for the second node.

### 4. Flash the gateway (ESP32-S3)
```
cd firmware/gateway
pio run -t upload
pio device monitor
```
The gateway connects to both nodes on its own. In the serial monitor, `s` prints its status and `x` toggles a simulated network outage for quick testing. For the graded demo we physically cut the network.

### 5. Use it
1. Open the website and register an account.
2. On the Dashboard, add both device ids.
3. Readings show up within a few seconds.

The site also has a demo mode (`dashboard.html?demo`) that runs the whole interface on simulated data, so it can be tried without hardware.

## Testing the ECE 513 offline recovery
1. With both nodes reporting, cut the gateway's network (for example, turn off the hotspot) for 5 minutes or more. The gateway log shows `[CLOUD] OFFLINE` and the buffer count grows.
2. Turn the network back on. The log shows `[CLOUD] ONLINE`, then `[BUF] Backfill complete`.
3. In DynamoDB, open the History table and filter on `source = backfill`. The dashboard's history chart also marks recovered points with purple diamonds.

Our own test log is in [docs/evidence/offline-recovery-gateway.log](docs/evidence/offline-recovery-gateway.log).

## Team and contributions

| Member | Links |
|---|---|
| Parsa Mirfasihi | [website](https://parsamirfasihi.com), [GitHub](https://github.com/parsamrf), [LinkedIn](https://www.linkedin.com/in/parsa-mirfasihi/) |
| Afsah Khan | [LinkedIn](https://www.linkedin.com/in/afsah-sharaf-khan-029384311/) |
| Sarower Afjal | [LinkedIn](https://www.linkedin.com/in/sarower/) |

All three of us worked on every part of the project. The share of each part is the same:

| Component | Parsa | Afsah | Sarower |
|---|---|---|---|
| Hardware | 35% | 35% | 30% |
| Firmware (nodes and gateway) | 35% | 35% | 30% |
| Cloud backend | 35% | 35% | 30% |
| Web application | 35% | 35% | 30% |
| Documentation | 35% | 35% | 30% |
| Demonstrations | 35% | 35% | 30% |

## Lessons learned and challenges
The full lists (six lessons, six challenges) are in [docs/REPORT.md](docs/REPORT.md). The main ones:
- **Wi-Fi band:** the ESP32-S3 only joins 2.4 GHz networks. An iPhone hotspot needs "Maximize Compatibility" turned on.
- **Toolchain paths:** the nRF Connect SDK build fails when the project path has a space in it, so we build from a copy in a path without spaces.
- **I2C wiring:** a loose jumper on the SHT31 power line made the sensor stop answering, and it looked like a firmware bug. We wrote a pin scanner to find the sensor, turned on internal pull-ups, and made the node reboot itself after repeated failed reads.
- **Sensor state:** a failed read is reported as invalid, and the dashboard shows dashes instead of the last good value.
- **Command confirmation:** a command counts as confirmed only after the node's next telemetry reports the requested state, not when the gateway writes it.
- **Offline recovery:** the gateway keeps each reading's receive time. Replayed readings go to a separate `backfill` topic so they keep their original timestamps and never overwrite the live state.
- **Bootloader entry:** the nice!nano has no reset button, so the node firmware reboots into the UF2 bootloader when a byte arrives on its USB serial port.

## AI tool usage
The course asks us to document AI tools, so here is what we used.
- **Claude Code (Anthropic)** helped us write, refactor and debug code and documentation for the firmware, the AWS backend and the website, and helped us read error messages during hardware bring-up.
- **Our own work:** choosing the application and the design, wiring the hardware, setting up the AWS account and the EC2 server, flashing and testing the nodes and gateway, running the command-routing and offline-recovery tests, and reviewing the code. We can explain and demonstrate all of the code we submit.
- **The Device Assistant** (extra credit) is a feature of the product, not a development aid. It answers questions with Qwen 3.8 27B, served through Groq's API.

All external libraries, services and tutorials are listed on the site's [References page](https://3-17-254-71.sslip.io/references.html) and in section 9 of the report.

## Submission checklist
- [x] Code for the nodes, gateway, cloud backend and website in this repository, with no passwords, keys or device certificates (the test account above is the only credential, as the handout asks)
- [x] README with setup steps, API docs in `docs/API.md`, and documentation in `docs/REPORT.md` / `docs/REPORT.pdf`
- [x] Demo video (two parts, 19 min 39 s total)
- [ ] Pitch video
