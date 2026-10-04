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
