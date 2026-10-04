# Room view (website)

Full-screen 3D room with live temperatures, alerts and demo controls. No build step: plain HTML, CSS and
JavaScript modules; three.js and GSAP load from CDNs.

## Run

The page must be served over http (browsers block loading `room.glb` from `file://`). From `frontend/`:

```bash
python3 -m http.server 8080
```

Open http://localhost:8080/room-view/

## Data

- **Offline preview** (default): a small built-in copy of the backend's room simulation, so the page works
  without the backend. Its alerts are simple rules, not the real detector.
- **Backend**: open the connection panel (bottom icon on the left), sign in with an account on the API.
  The API must allow this page's address: `CORS_ALLOW_ORIGINS` in the backend (defaults include
  `http://localhost:8080` and `http://127.0.0.1:8080`).

## Links into a scenario

`?outside=-5&window=open` · `?scenario=window_open` · `?view=window|door|heater|top` · `?panel=insights|history|layers|sensors`

## Files

| File | What |
|---|---|
| `js/layout.js` | Room size, sensor positions, window/door/heater, camera views (metres) |
| `js/scene.js` | three.js scene: room model, window/door/heater, heat surfaces, air particles, haze, sensors |
| `js/field.js` | Estimated temperature between the sensors and the colour scale (shared by GPU and JS) |
| `js/main.js` | HUD, panels, charts, demo controls, connection |
| `js/backend.js` | API client (`/token`, `/latest`, `/issues`, `/history`, `/metrics`, `/demo/*`) |
| `js/preview.js` | Offline preview simulation |

Room model "room" by [yYett](https://sketchfab.com/3d-models/room-65f4aba797c04c56a8dc25205a1c7713), CC BY 4.0.
The model has no window, door or radiator; they are added in code (`scene.js`).
