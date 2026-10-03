# stormhacks


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