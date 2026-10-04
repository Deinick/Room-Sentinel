# Push Notifications

This describes how the mobile app receives a push when one of the user's devices has an issue.
The code lives in `backend/src/push/` (token registration) and `backend/src/sentinel/notify/expo.py` (sending).
Delivery goes through the [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/), which reaches both iOS and Android.

## Overview

```
App        POST   /me/push-tokens   {"token"}  -> phone registered for the signed-in user
Sentinel   issue opened / escalated / reminder / resolved on a device
Sentinel   look up the device owner's tokens   -> POST https://exp.host/--/api/v2/push/send
App        DELETE /me/push-tokens   {"token"}  -> phone unregistered on sign-out
```

Grafana Cloud is a separate, internal tool for the team.
End users only ever get notifications through the app, and only for devices they own.

## Step 1 - App registers its token

After sign-in, the app asks for notification permission and gets its Expo push token with `Notifications.getExpoPushTokenAsync({ projectId })`.
It then calls `POST /me/push-tokens` with the user's bearer token and `{"token": "ExponentPushToken[...]"}`.

- Response `204`.
- `401` without a valid user token.
- `422` if the value is not an Expo push token (`ExponentPushToken[...]` or `ExpoPushToken[...]`).
- Registering the same token again is harmless.
- A token registered to another user moves to the caller, so a shared phone follows whoever signed in last.

Tokens are stored in the `push_tokens` table, keyed by the token, with the owning `user_id`.
Deleting a user deletes their tokens.

```ts
const { status } = await Notifications.requestPermissionsAsync();
if (status === "granted") {
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.post("/me/push-tokens", { token });
}
```

Push tokens need a development build on a real device.
Expo Go on a simulator does not receive them.

## Step 2 - Sentinel sends the push

The sentinel pipeline turns findings into issue events (`backend/src/sentinel/issues.py`).
Only changes produce an event: opened, escalated, a reminder while still open, and resolved.
Each event goes to every notification channel, and `ExpoPushChannel` is one of them.

- The channel only queues the event, and a worker thread does the database lookup and the HTTP call.
  The pipeline holds its lock while channels run, so a slow network never delays readings.
- It looks up every token of the device's current owner.
  Unowned devices and the demo devices send nothing.
- Messages are sent in batches of at most 100, the Expo limit.
- A failure is logged and that push is dropped; it never stops the pipeline.
- The channel is off when the gateway runs with `--no-db`.

## Message format

| Field | Value |
|---|---|
| `title` | `WARNING Kitchen: SENSOR_FAULT`, or `Resolved: Kitchen SENSOR_FAULT` |
| `body` | What happened, then one `-> action` line per recommendation |
| `data` | `{"device_id", "kind", "severity", "event"}` for routing a tap to the right screen |
| `sound`, `priority` | `default`, `high` |

The title uses the owner's name for the device (`PATCH /devices/{device_id}`), and the serial number when it has no name.
`event` is one of `opened`, `escalated`, `reminder`, `resolved`.

## Step 3 - App unregisters on sign-out

`DELETE /me/push-tokens` with the same body and the user's bearer token, response `204`.
A user can only remove their own tokens, and removing an unknown token is harmless.

## Dead tokens

Expo answers each message with a ticket.
A ticket with error `DeviceNotRegistered` means the app was uninstalled or lost notification permission, and that token is deleted.
Other errors are logged.

Not implemented: the second stage, [push receipts](https://docs.expo.dev/push-notifications/sending-notifications/#push-receipts), which reports delivery failures from Apple and Google after the ticket.
No Expo access token is used, so anyone holding a user's push token could send to that phone through Expo.
Turn on "enhanced push security" in the Expo project and send its access token if that becomes a concern.
