# StormHacks controller pairing protocol

Development endpoints:

- FastAPI/browser: `http://192.168.68.107:8000`
- ESP32 newline-delimited JSON TCP: `192.168.68.107:9000`

Every TCP message is one UTF-8 JSON object followed by `\n`. The ESP32 opens
the connection and reconnects after a disconnect. The server must keep a map
from device serial number to the active TCP writer.

## Device authentication

ESP32 sends immediately after connecting:

```json
{"type":"device_auth","serial":"1234-5678-9012-3456","device_secret":"...","device_token":""}
```

The server registers a previously unseen serial/secret pair for development,
or verifies it when it already exists. In production, identities must be
pre-provisioned rather than self-registered.

Server response:

```json
{"type":"device_auth_result","status":"ok"}
```

## Start pairing

ESP32 sends after the user presses ACCOUNT LOGIN:

```json
{"type":"pairing_start","serial":"1234-5678-9012-3456"}
```

Server creates a cryptographically random, single-use session that expires in
five minutes and sends:

```json
{"type":"pairing_created","pairing_id":"UUID","pairing_url":"http://192.168.68.107:8000/pair?code=RANDOM_CODE","confirmation_code":"482913","expires_in":300}
```

The browser authenticates the user with FastAPI and asks them to approve the
serial number and confirmation code. After approval, the server binds the
device and pushes over the existing TCP connection:

```json
{"type":"pairing_success","pairing_id":"UUID","account_id":"usr_123","email":"user@example.com","device_token":"LONG_RANDOM_TOKEN"}
```

For errors:

```json
{"type":"pairing_failed","reason":"expired"}
```

Allowed reasons are `expired`, `rejected`, `already_linked`, and
`server_error`. The ESP32 stores `device_token`; the account password must
never be sent to either microcontroller.

## Sensor telemetry

After device authentication, ESP32 forwards the newest STM32 measurement:

```json
{"id":"1234-5678-9012-3456","type":"telemetry","sequence":42,"uptime_ms":38500,"Centre":22.4,"Window":21.8,"Heater":29.1,"Door":22.0,"Far wall":22.3}
```

Disconnected or faulty sensors are `null`. The server assigns the
authoritative UTC timestamp at receipt. It can use `sequence` to detect gaps
and `uptime_ms` to establish ordering within one device boot. No device RTC is
required for the live pipeline.

## Production requirement

The development TCP connection is restricted to the local trusted network.
Before deployment, both the web endpoint and device socket must use TLS with
certificate verification. The serial number is public identity, not a
credential.
