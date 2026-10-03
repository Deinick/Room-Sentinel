# stormhacks

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
