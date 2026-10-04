# STM32 to ESP32 UART protocol

Transport: USART, 9600 baud, 8 data bits, no parity, one stop bit. Each UTF-8
JSON object ends with `\n`. Maximum initial message length is 384 bytes.

ESP32 to STM32 provisioning message:

```json
{"type":"provisioning","ssid":"StormHacks-AB12","password":"setup-12345678","url":"http://192.168.4.1/","qr":"WIFI:T:WPA;S:StormHacks-AB12;P:setup-12345678;;"}
```

ESP32 to STM32 status message:

```json
{"type":"status","state":"wifi_connected","detail":""}
```

Initial states are `setup_ready`, `credentials_saved`, `wifi_connecting`,
`wifi_retry`, `wifi_connected`, and `wifi_failed`.
