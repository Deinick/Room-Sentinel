# StormHacks ESP32 firmware

ESP-IDF firmware for an ESP32-WROOM module. The first version provides:

- UART2 link to STM32 at 115200 baud;
- temporary WPA2 SoftAP for Wi-Fi provisioning;
- local setup page at `http://192.168.4.1/`;
- storage of Wi-Fi credentials in NVS;
- automatic station connection after restart;
- JSON-line status messages for the STM32 display.

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

The UART provisioning message contains a standard Wi-Fi QR payload. The STM32
will render that payload after its USART3 receive task and QR renderer are
added.
