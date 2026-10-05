# Room Sentinel — website (room view)

← Part of [Room Sentinel](../../README.md)

Full-screen 3D room with live temperatures, alerts and demo controls. No build step: plain HTML, CSS and
JavaScript modules; three.js and GSAP load from CDNs.

## Run

The page must be served over http (browsers block loading `room.glb` from `file://`). From `frontend/`:

```bash
python3 -m http.server 8080
```

Open http://localhost:8080/room-view/

## Sign in and data

The page opens on a sign-in screen (create an account there too). Two ways in:

- **Sign in**: live data from the API — the account's rooms plus the shared demo room, real alerts,
  history and the demo controls. The server defaults to `https://stormhacks.onrender.com`; change it under
  "Server" on the sign-in card (e.g. `http://127.0.0.1:8000` for a local backend). The API must allow this
  page's address in `CORS_ALLOW_ORIGINS` (local defaults include `http://localhost:8080` and `http://127.0.0.1:8080`).
  The token is kept for the browser tab only; passwords are never stored.
- **Explore the offline demo**: a small built-in copy of the backend's room simulation, so the page works
  without the backend or internet. Its alerts are simple rules, not the real detector.

The **Account** panel (person icon) changes the password, deletes the account or signs out.

## Devices and pairing

After signing in, the page checks the account's devices (`GET /devices`):

- **No device yet**: "Add your first device" with the three steps, and "Explore the demo room". The page
  checks every few seconds and switches to the real room as soon as a device is paired.
- **QR link from the device** (`…/room-view/#pair/CODE`): sign in if needed, see the serial number,
  confirm (`GET /pairing/{code}`, `POST /pairing/{code}/confirm`). Expired or used codes say what to do.
- **Devices** panel (house icon): rename, min / target / max temperature, show, unpair.
- A paired device that hasn't sent anything yet shows "Waiting for … to send readings".

For the QR link to open this page, set the backend's `PAIRING_URL_BASE` to this page plus `#pair`,
e.g. `http://localhost:8080/room-view/#pair` (the backend appends `/CODE`). The `#` keeps it working on any
static server (nginx, `python3 -m http.server`).

## 3D and 2D

The **3D | 2D** switch in the dock shows the room plan from above, drawn from the same estimated field.
"Move sensors" lets you drag sensors on the plan (or use the arrow keys); they move in 3D too and are
remembered in this browser.

## Links into a scenario (skip the sign-in, offline demo)

`?offline` · `?outside=-5&window=open` · `?scenario=window_open` · `?view=window|door|heater|top` ·
`?panel=insights|history|layers|sensors|account` · `?plan` (open the 2D plan)

## Check the account client

```bash
node frontend/room-view/scripts/account-check.mjs
```

## Files

| File | What |
|---|---|
| `js/layout.js` | Room size, sensor positions, window/door/heater, camera views (metres) |
| `js/scene.js` | three.js scene: room model, window/door/heater, heat surfaces, air particles, haze, sensors |
| `js/field.js` | Estimated temperature between the sensors and the colour scale (shared by GPU and JS) |
| `js/main.js` | Sign-in, HUD, panels, account, charts, demo controls, 3D/2D switch |
| `js/plan.js` | 2D plan (top view) with draggable sensors |
| `js/account.js` | Account API client: register, sign in, current user, change password, delete |
| `js/backend.js` | Room data client (`/latest`, `/issues`, `/history`, `/metrics`, `/demo/*`) |
| `js/preview.js` | Offline demo simulation |

Sign-in / registration, account settings, the account client and the 2D plan idea come from the first
version of the website by Anton (`frontend/react-app`), redesigned to match this page.

Room model "room" by [yYett](https://sketchfab.com/3d-models/room-65f4aba797c04c56a8dc25205a1c7713), CC BY 4.0.
The model has no window, door or radiator; they are added in code (`scene.js`).
