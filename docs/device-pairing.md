# Adding a New Device

This describes how a controller (ESP32) goes from the factory to streaming readings into a user's account.
The code lives in `backend/src/device/` (routes, service, models) and `backend/src/sentinel/device_readings/routes.py` (the stream).

## Actors and credentials

| Actor | Authenticates with | Lifetime |
|---|---|---|
| Staff (factory) | User bearer token with staff flag | - |
| Device, before pairing | Serial number (`device_id`) + manufacturing secret | Forever, survives factory reset |
| Device, after pairing | Device token (bearer) | Until re-paired or unpaired |
| User (website) | User bearer token from `POST /token` | Session |

The server stores only SHA-256 hashes of the secret and the device token.
The user's password never touches the device.

## Overview

```
Staff    POST /devices                        -> device row created (no owner)
Device   POST /devices/pairing                -> code + pairing_url (shown as QR)
User     GET  /pairing/{code}                 -> sees serial number to verify
User     POST /pairing/{code}/confirm         -> device linked to user
Device   POST /devices/pairing/{code}/token   -> 202 until confirmed, then device_token
Device   WS   /devices/stream                 -> Authorization: Bearer <device_token>
```

## Step 1 - Factory provisioning (staff)

`POST /devices` with `{"device_id": "<serial>", "secret": "<at least 16 chars>"}`.

- Requires a staff user token.
- Creates the `devices` row with `user_id = NULL` and the hashed secret.
- The same secret is flashed into the device firmware.
- Returns `409` if the serial number already exists.

## Step 2 - Device starts pairing

The device (new, or after a factory reset) calls `POST /devices/pairing` with `{"device_id", "secret"}`.

- `401` if the serial is unknown or the secret is wrong.
- Any earlier open pairing session for this device is invalidated.
- A new `pairing_sessions` row is created with a random code and a 10 minute TTL.
- Response `201`: `{"code", "pairing_url", "expires_at"}`.
- `pairing_url` is `PAIRING_URL_BASE/<code>` and the device shows it as a QR code.

## Step 3 - User opens the pairing link

The user scans the QR code and signs in on the website.
The page calls `GET /pairing/{code}` with the user's bearer token.

- Response: `{"device_id", "expires_at"}` so the user can compare the serial number with the label on the device.
- `404` if the code is unknown or already used, `410` if it expired.

## Step 4 - User confirms

`POST /pairing/{code}/confirm` with the user's bearer token, response `204`.

- The device's `user_id` is set to the confirming user and the session records `confirmed_by`.
- If the device belonged to someone else, that owner's device token is revoked and its open stream is disconnected.
  Physical possession plus a factory reset is what transfers ownership.
- On a change of owner (including re-pairing after an unpair), `paired_at` is set to now.
  History and metrics only return data from `paired_at` on, so a new owner never sees the previous owner's readings.
  Re-pairing by the same owner without unpairing keeps `paired_at`.
- A second, different user cannot confirm the same code (`404`).

## Step 5 - Device collects its token

While steps 3 and 4 happen, the device polls `POST /devices/pairing/{code}/token` with `{"device_id", "secret"}`.

| Response | Meaning | Device action |
|---|---|---|
| `202` | User has not confirmed yet | Poll again shortly |
| `200 {"device_token"}` | Paired | Store token in NVS, stop polling |
| `401` | Wrong serial or secret | Stop |
| `404` | Code unknown, used, or for another device | Restart from step 2 |
| `410` | Code expired | Restart from step 2 |

The token is generated at claim time, so its plaintext is never stored on the server.
Claiming consumes the session, so the token is delivered exactly once.

## Step 6 - Device connects

The device opens the WebSocket `/devices/stream` with header `Authorization: Bearer <device_token>`.

- An invalid or revoked token rejects the handshake (HTTP 403).
- The first server frame is the current settings (`{"type": "settings", "target_temperature": ...}`), so a device that was offline catches up.
- Later settings changes made by the owner (`PATCH /devices/{device_id}`) are pushed live.

## After pairing

- `GET /devices` lists the user's devices.
- `PATCH /devices/{device_id}` sets `name`, `target_temperature`, `min_temperature`, `max_temperature`.
- `DELETE /devices/{device_id}` unpairs: clears the owner, revokes the token, and drops the stream.
  To pair again, the device restarts from step 2.

## Configuration

- `PAIRING_URL_BASE` - website URL the code is appended to (default `http://localhost:8000/pair`).
- Pairing TTL is fixed at 10 minutes (`PAIRING_TTL` in `backend/src/device/services.py`).
