# stormhacks

## React frontend prototype

Room Sentinel is a React + TypeScript frontend built with Vite. Run commands from this directory using Node.js 20.19+ or 22.12+:

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. Alternatively use `npm install` and `npm run dev`.
For a production build run `pnpm build`; serve it with `pnpm preview`.

The overview shows one room with Centre, Window, Heater, Door, and Far wall sensors. Customize room lets you rename and resize the room, change its comfort target, and drag sensor positions. Focus a sensor in edit mode and use arrow keys for keyboard positioning. Room configuration saves in browser local storage. Select a sensor and adjust its demo temperature with the slider to see the map change. Pause stops new measurements.

The heatmap uses inverse distance weighting of all five readings, with distances adjusted for the room's physical dimensions. Colors use a fixed 15–35°C scale; temperatures outside that scale use the endpoint colors. This is an illustrative interpolation, not a physical heat-transfer model. The ambient summary averages Centre, Door, and Far wall. Insights use temperature differences; the 20-minute outlook extrapolates the recent centre trend.

Demo mode starts with synthetic 30-minute history sampled every second and updates every second. Settings lets you switch to a REST endpoint returning the original flat sensor package below. ISO 8601 timestamps are also accepted. REST mode starts a new in-memory history and polls every second; it does not yet fetch stored history from a backend. Requests time out after eight seconds. Failed requests retain the previous values, and readings older than 5 seconds are marked stale. The backend needs to allow the frontend origin through CORS. No backend or real ML model is included.

```json
{
  "Centre": 29.7,
  "Window": 29.9,
  "Heater": 23.8,
  "Door": 23.5,
  "Far wall": 30.5,
  "timestamp": "2023-08-19 12:17:55 -0400"
}
```

The existing `layout.htm` remains a standalone earlier simulator.

### Account connection

Accounts use HTTPS at `https://stormhacks.onrender.com`. Override the origin with `VITE_API_BASE_URL` in a Vite environment file if needed. Registration uses `POST /users` and returns to sign in. Login uses `POST /token`, then `GET /users/me` to retrieve the account email. Bearer tokens are saved in browser session storage so refreshing the page restores the session after validation through GET /users/me. Closing the tab ends this browser session. Sign out, account deletion, and password changes clear the saved token. Temporary connection failures offer a retry without discarding the session. Passwords are never stored by the frontend.

Password changes verify the current password through `POST /token`, then submit matching `password1` and `password2` fields to `PUT /users/me`. Successful changes require signing in again. Account deletion uses `DELETE /users/me` after confirmation and signs out only after success. Passwords require 8–32 characters, including a letter and number. Server errors appear in the forms.

The server must allow the deployed frontend origin, JSON content type, and Authorization header through CORS. API requests time out after 60 seconds, allowing for Render startup delays.

Run `node scripts/auth-check.mjs` to check account API payloads and failure handling using mock responses without modifying live accounts.

### Devices and pairing

After sign in, `GET /devices` runs immediately and every five seconds. With no devices, the overview shows three pairing steps and an option to explore the local demo. A newly paired device automatically becomes the active room. The Devices tab lets owners rename devices, set minimum/target/maximum temperatures (`PATCH /devices/{device_id}`), show a room, or confirm unpairing (`DELETE /devices/{device_id}`).

QR links use `/#pair/CODE`. The hash survives sign in and registration. `GET /pairing/{code}` displays the serial and expiry; `POST /pairing/{code}/confirm` links it only after user confirmation. Failed or expired codes explain how to generate a new QR code on the device.

Set the **backend** environment variable `PAIRING_URL_BASE=http://localhost:5173/#pair` for local development, or `https://YOUR-FRONTEND/room-view/#pair` for that deployed path. The backend appends `/CODE`. This frontend change does not change the backend environment variable.

The active device polls authenticated `GET /latest` every second. Rooms without a first reading show “Waiting for … to send readings” rather than demo values. The client expects `/latest` to map device serials to the five-sensor package and timestamp (flat or nested under `readings`, `temperatures`, or `temps`). The OpenAPI schema leaves this payload generic; verify this mapping against an actual paired-device response. The device-ingestion WebSocket is not used for these user requests.

Run `node scripts/devices-check.mjs` to verify device API requests, no-reading handling, and onboarding using mock responses.

### Project Architecture

                         PHYSICAL WORLD
                               │
     ┌───────────┬─────────────┼─────────────┬───────────┐
     ↓           ↓             ↓             ↓           ↓
  Sensor 1    Sensor 2      Sensor 3      Sensor 4    Sensor 5
  Room        Window        Heater        Door        Far wall
  centre
     │           │             │             │           │
     └───────────┴─────────────┼─────────────┴───────────┘
                               ↓
                   STM32 (all 5 on 1-Wire)
                               │──→ TFT Screen (live temps)
                               │
                           USB Serial
                   (one JSON line per second)
                               │
                               ↓
              ┌─────────────────────────────────┐
              │     Python Gateway (backend)    │
              │                                 │
              │ 1. Reader   – reads serial,     │
              │               checks values     │
              │ 2. Detector – checks cooling:   │
              │               how fast & where? │
              │ 3. API      – FastAPI           │
              └─────────────────────────────────┘
                    │                    │
          readings, predictions,      alerts
               alerts                    │
                    ↓                    ↓
               TimescaleDB        Phone Push (ntfy)
              (Tiger Data)
                    │
                    ↓
                 Grafana
        (charts, forecast, alerts)


### DATA FORMAT

{     
      "Centre":29.7,
      "Window":29.9,
      "Heater":23.8,
      "Door":23.5,
      "Far wall":30.5,
      "timestamp": "2023-08-19 12:17:55 -0400"
}

#### Larp:
An IoT-based Smart Building Digital Twin that collects physical sensor data through an STM32, processes and stores time-series data in Snowflake, models building relationships with TigerGraph, applies predictive analytics, and exposes real-time monitoring through Grafana.
