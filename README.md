# stormhacks

### Project Architecture
[arch.png](arch.png)

### DATA FORMAT

#### {
####      "Centre":29.7,
####      "Window":29.9,
####      "Heater":30.1,
####      "Door":30.3,
####      "Far wall":30.5,
####      "timestamp": "2023-08-19 12:17:55 -0400"
####      "id":"string"
#### }

#### Larp:
An IoT-based Smart Building Digital Twin that collects physical sensor data through an STM32, processes and stores time-series data in Snowflake, models building relationships with TigerGraph, applies predictive analytics, and exposes real-time monitoring through Grafana.
