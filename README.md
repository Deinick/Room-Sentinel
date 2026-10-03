# stormhacks

### Project Architecture
[arch.png](arch.png)

### DATA FORMAT

```json
{
  "id": "string",
  "Centre": 29.7,
  "Window": 29.9,
  "Heater": 23.8,
  "Door": 23.5,
  "Far wall": 30.5
}
```

#### Larp:
An IoT-based Smart Building Digital Twin that collects physical sensor data through an STM32, processes and stores time-series data in Snowflake, models building relationships with TigerGraph, applies predictive analytics, and exposes real-time monitoring through Grafana.