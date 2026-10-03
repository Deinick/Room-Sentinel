# stormhacks

### Project Architecture


                 PHYSICAL WORLD
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   Room Sensor    Window Sensor   Heater Sensor
        │              │              │
        └──────────────┼──────────────┘
                       ↓
                    STM32
                       │
                 USB Serial
                       │
                       ↓
                 Python Gateway
                       │
                       ↓
                   webserver
                 /    |     \
                /     |      \
               ↓      ↓       ↓
        Snowflake  TigerGraph  ML/AI
           │          │          │
           │          │          │
           └──────────┼──────────┘
                      ↓
                   Grafana
                      │
                      ↓
             Digital Twin Dashboard


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
