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
                    STM32 (all 5 on one wire)
                               │──→ TFT screen (live temps)
                               │
                          USB Serial
                 (one JSON line per second)
                               │
                               ↓
              ┌─────────────────────────────────┐
              │      Python Gateway (backend)   │
              │                                 │
              │  1. Reader   – reads serial,    │
              │                checks values    │
              │  2. Detector –  is the room     │
              │                cooling too      │
              │                fast and where?  │
              │  3. API      – FastAPI          │
              └─────────────────────────────────┘
                    │                    │
          readings, predictions,      alerts
               alerts                    │
                    ↓                    ↓
              TimescaleDB         Phone push (ntfy)
              (Tiger Data)
                    │
                    ↓
                 Grafana
         (charts, forecast, alerts)




### DATA FORMAT

{     
      1:29.7;
      2:29.9;
      ...
      5:30.5 ;
      "timestamp": "2023-08-19 12:17:55 -0400";
}

#### Larp:
An IoT-based Smart Building Digital Twin that collects physical sensor data through an STM32, processes and stores time-series data in Snowflake, models building relationships with TigerGraph, applies predictive analytics, and exposes real-time monitoring through Grafana.
