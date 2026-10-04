# StormHacks ESP32 firmware

ESP-IDF firmware for an ESP32-WROOM module. The firmware provides:

- UART2 link to STM32 at 9600 baud;
- temporary WPA2 SoftAP for Wi-Fi provisioning;
- local setup page at `http://192.168.4.1/`;
- storage of Wi-Fi credentials in NVS;
- automatic station connection after restart;
- JSON-line status messages for the STM32 display;
- HTTPS pairing with `https://stormhacks.onrender.com`;
- authenticated TLS WebSocket telemetry at `/devices/stream`.

## Wiring

| STM32F407 | ESP32-WROOM |
|---|---|
| PD8 / USART3_TX | GPIO16 / UART2_RX |
| PD9 / USART3_RX | GPIO17 / UART2_TX |
| GND | GND |

The ESP32 must have its own adequate 3.3 V supply. Do not power a bare WROOM
module directly from a weak MCU 3.3 V pin; Wi-Fi current peaks require suitable
regulation and local decoupling.

## Build

Install and activate ESP-IDF, then run:

```sh
idf.py set-target esp32
idf.py build
idf.py flash monitor
```

On first boot the ESP32 generates a 19-character serial number and a random
128-bit manufacturing secret, then stores both in NVS. The first successful
`POST /devices/pairing` registers that identity automatically; no staff
provisioning step is required. The secret is not printed unless the local
diagnostic option `STORM_LOG_PROVISIONING_SECRET` is explicitly enabled.

Account Login obtains a short-lived pairing URL for the display QR code, polls
until the user confirms, stores the device token in NVS, and opens the secured
WebSocket. The server timestamps received telemetry in UTC, so no controller
RTC is required. Server acknowledgements, cloud connection state, and live
settings updates are forwarded to the STM32 over UART.

The UART provisioning message contains a standard Wi-Fi QR payload. The STM32
renders the Wi-Fi setup and account-pairing QR codes on the touchscreen.
