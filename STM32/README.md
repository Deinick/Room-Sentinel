# Room Sentinel — STM32 firmware

← Part of [Room Sentinel](../README.md)

Initial STM32CubeMX configuration derived from the proven hardware setup in
`Heating Floor Controller Project`.

## Target

- MCU: STM32F407VGT6, LQFP100
- HSE: 25 MHz
- SYSCLK: 100 MHz
- Toolchain: STM32CubeIDE / GCC

## Display and touch (preserved from the working project)

| Signal | Pin | Configuration |
|---|---:|---|
| DISPL_LED | PA1 | TIM2 CH2 PWM |
| TOUCH_INT | PA4 | EXTI falling edge, pull-up |
| DISPL_SCK | PA5 | SPI1 SCK |
| TOUCH_MISO | PA6 | SPI1 MISO |
| DISPL_MOSI | PA7 | SPI1 MOSI |
| DISPL_CS | PB0 | GPIO output, initially high |
| TOUCH_CS | PB1 | GPIO output, initially high |
| DISPL_DC | PC4 | GPIO output |
| DISPL_RST | PC5 | GPIO output |

SPI1 TX uses DMA2 Stream 3. The display driver changes the SPI prescaler at
runtime: fast for ILI9488, slow for XPT2046.

## Five DS18B20 buses

Each sensor currently has its own open-drain 1-Wire GPIO and requires an
external pull-up resistor (normally 4.7 kOhm to 3.3 V).

| Sensor | Proposed pin | Note |
|---|---:|---|
| TEMP_1 | PC0 | Existing proven connection |
| TEMP_2 | PC1 | Existing proven connection |
| TEMP_3 | PC2 | Existing proven connection |
| TEMP_4 | PC3 | Confirmed by the user |
| TEMP_5 | PA0 | Confirmed by the user |

TIM6 is configured as a 1 MHz free-running timing source for the software
1-Wire driver.

## Next step

Open `stormhacks_stm32.ioc` in STM32CubeMX and generate the STM32CubeIDE
project. After generation, copy/adapt only
the reusable drivers (`DS18B20`, `ILI9XXX`, `XPT2046`, and fonts), not the old
heating-control application.

## Current diagnostic firmware

The initial firmware now initializes the ILI9488 display and polls five
DS18B20 sensors once per second. The display shows one line per sensor with
its temperature or a diagnostic error code. The project builds successfully
with STM32CubeIDE 1.17.0 with zero errors and zero warnings.

The CubeMX configuration also enables FreeRTOS through CMSIS-RTOS v2. HAL uses
TIM7 as its time base so SysTick remains available to the RTOS. The ILI9488
uses SPI1 TX DMA, and the XPT2046 shares SPI1 at a reduced clock rate with its
own chip-select and PA4 falling-edge interrupt.

## ESP32 and server integration

USART3 exchanges newline-delimited JSON with the ESP32 at 9600 baud. The STM32
sends the five sensor readings once per measurement cycle. It renders Wi-Fi
and account QR codes received from the ESP32, tracks the secure cloud-stream
state, records the latest server-acknowledged telemetry sequence, and accepts
the live `target_temperature` setting pushed by the backend. The Settings
screen shows the current target, cloud state, and acknowledgement sequence.

Device-local settings include Celsius/Fahrenheit display units, a 30-second
backlight timeout with touch wake-up, Wi-Fi retry/change/forget controls, and a
Device Information page with serial number, firmware versions, IP address, and
Wi-Fi signal strength. Telemetry remains in Celsius regardless of the selected
display unit.

Temperature values are blue below 18 °C, orange from 18–26 °C, and red above
26 °C; disconnected sensors are gray. The existing blue/orange side bars still
represent the one-minute temperature trend. Device Information also shows
controller uptime and a human-readable Wi-Fi quality rating.
