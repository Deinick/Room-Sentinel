# Room Sentinel — controller/server protocol

Production server: `https://stormhacks.onrender.com`

All public traffic uses TLS. The serial number is identity, while the random
manufacturing secret and issued device token are credentials. A user's email
and password are never sent to either microcontroller.

## Device identity

On first boot the ESP32 creates and stores:

- serial: `1234-5678-9012-3456`
- 128-bit manufacturing secret encoded as 32 hexadecimal characters

The values survive Wi-Fi and account factory resets. On the first pairing
request, an unknown serial number is registered with the supplied secret. All
later requests for that serial must present the same secret. The server stores
only a hash of the secret.

## Account pairing

After `START_LOGIN`, the ESP32 calls:

```http
POST /devices/pairing
Content-Type: application/json

{"device_id":"1234-5678-9012-3456","secret":"..."}
```

The returned `pairing_url` is displayed as a QR code. The phone signs in and
confirms the device. The ESP32 polls `POST /devices/pairing/{code}/token` with
the same body until it receives the one-time device token, then stores it in
NVS. Pairing expires after ten minutes.

## Sensor telemetry

The paired ESP32 maintains:

```text
wss://stormhacks.onrender.com/devices/stream
Authorization: Bearer <device_token>
```

Every STM32 measurement becomes one WebSocket text frame:

```json
{
  "serial": "1234-5678-9012-3456",
  "seq": 42,
  "uptime_ms": 38500,
  "temps": {
    "Centre": 22.4,
    "Window": 21.8,
    "Heater": 29.1,
    "Door": null,
    "Far wall": 22.3
  }
}
```

The server validates the serial against the token, stores the measurement,
assigns its UTC receipt time, processes alerts, and responds with an ack. A
faulty or disconnected sensor is sent as `null`; no device RTC is required.

Successful acknowledgement:

```json
{"seq":42,"ok":true,"error":null}
```

The ESP32 forwards acknowledgements to the STM32, where the latest confirmed
sequence number is available on the Settings screen.

## Live settings

Immediately after the WebSocket connects, and whenever the owner changes the
device target, the server sends:

```json
{"type":"settings","target_temperature":22.5}
```

`target_temperature` can also be `null`. The ESP32 forwards this frame to the
STM32, which stores and displays the current target. This is the server-to-
controller path for later control logic.

## STM32 and ESP32 UART

The boards use newline-delimited JSON at 9600 baud over STM32 USART3 and ESP32
UART2. In addition to provisioning and pairing messages, ESP32 reports cloud
state as:

```json
{"type":"server_status","state":"connected","detail":"secure stream online"}
```

ESP32 periodically repeats the device identity, Wi-Fi state, and cloud state,
so either controller can restart independently without losing UI status.
