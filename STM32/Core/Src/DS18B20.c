#include "DS18B20.h"

// --------------------------------------------------
// Selected timer for microsecond delays
// Timer must be configured to 1 MHz and started before DS18B20 use
// --------------------------------------------------
static TIM_TypeDef *DS18B20_Timer = NULL;

static uint32_t DS18B20_EnterCritical(void)
{
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    return primask;
}

static void DS18B20_ExitCritical(uint32_t primask)
{
    if (primask == 0U)
    {
        __enable_irq();
    }
}

// --------------------------------------------------
// Set timer used for microsecond delays
// --------------------------------------------------
void DS18B20_SetTimer(TIM_TypeDef *TIMx)
{
    DS18B20_Timer = TIMx;
}

// --------------------------------------------------
// Microsecond delay using selected hardware timer
// Timer frequency must be 1 MHz:
// 1 timer tick = 1 microsecond
// --------------------------------------------------
static void DS18B20_DelayMicro(uint16_t micros)
{
    if (DS18B20_Timer == NULL)
    {
        return;
    }

    DS18B20_Timer->CNT = 0;

    while (DS18B20_Timer->CNT < micros)
    {
        // wait
    }
}

// --------------------------------------------------
// Pull 1-Wire line LOW
// --------------------------------------------------
static inline void DS18B20_LineLow(DS18B20_t *sensor)
{
    sensor->GPIOx->BSRR = ((uint32_t)sensor->GPIO_Pin << 16U);
}

// --------------------------------------------------
// Release 1-Wire line
// Open-drain + external pull-up will bring the line HIGH
// --------------------------------------------------
static inline void DS18B20_LineRelease(DS18B20_t *sensor)
{
    sensor->GPIOx->BSRR = sensor->GPIO_Pin;
}

// --------------------------------------------------
// Read current 1-Wire line state
// --------------------------------------------------
static inline uint8_t DS18B20_LineRead(DS18B20_t *sensor)
{
    return (sensor->GPIOx->IDR & sensor->GPIO_Pin) ? 1U : 0U;
}

// --------------------------------------------------
// Send reset pulse and check DS18B20 presence
//
// Return:
// 0 = sensor detected
// 1 = sensor not detected
// 2 = timer not selected
// --------------------------------------------------
static uint8_t DS18B20_Reset(DS18B20_t *sensor)
{
    uint8_t bus_was_high = 0U;
    uint8_t presence_seen = 0U;
    uint16_t elapsed;

    if (DS18B20_Timer == NULL)
    {
        return 2U;
    }

    DS18B20_LineRelease(sensor);
    DS18B20_DelayMicro(10);

    /* A released 1-Wire bus must be HIGH.  Without this check a shorted
       bus looks exactly like a valid presence pulse and produces 00 bytes. */
    if (DS18B20_LineRead(sensor) == 0U)
    {
        return 3U;
    }

    DS18B20_LineLow(sensor);
    DS18B20_DelayMicro(480);

    DS18B20_LineRelease(sensor);

    /* Scan a deliberately wide window.  First the released bus must rise,
       then a falling edge is accepted as presence.  This prevents the RC
       rise after reset from being mistaken for a sensor response. */
    DS18B20_Timer->CNT = 0U;

    while (DS18B20_Timer->CNT <= 300U)
    {
        elapsed = (uint16_t)DS18B20_Timer->CNT;

        if (bus_was_high == 0U)
        {
            if (DS18B20_LineRead(sensor) != 0U)
            {
                bus_was_high = 1U;
            }
            else if (elapsed >= 15U)
            {
                return 3U;
            }
        }
        else if (presence_seen == 0U)
        {
            if (DS18B20_LineRead(sensor) == 0U)
            {
                presence_seen = 1U;
            }
        }
        else if (DS18B20_LineRead(sensor) != 0U)
        {
            break;
        }
    }

    if (presence_seen == 0U)
    {
        return 1U;
    }

    if (DS18B20_LineRead(sensor) == 0U)
    {
        return 3U;
    }

    /* Ensure reset recovery time before the following command. */
    DS18B20_DelayMicro(200U);
    return 0U;
}

// --------------------------------------------------
// Write one bit to DS18B20
//
// bit = 0:
//   line LOW ~60 us, then release
//
// bit = 1:
//   line LOW briefly, then release
// --------------------------------------------------
static void DS18B20_WriteBit(DS18B20_t *sensor, uint8_t bit)
{
    if (bit != 0U)
    {
        // Write 1
        DS18B20_LineLow(sensor);
        DS18B20_DelayMicro(6);

        DS18B20_LineRelease(sensor);
        DS18B20_DelayMicro(64);
    }
    else
    {
        // Write 0
        DS18B20_LineLow(sensor);
        DS18B20_DelayMicro(60);

        DS18B20_LineRelease(sensor);
        DS18B20_DelayMicro(10);
    }
}

// --------------------------------------------------
// Read one bit from DS18B20
//
// Master pulls line LOW briefly,
// then releases it and samples the line.
// --------------------------------------------------
static uint8_t DS18B20_ReadBit(DS18B20_t *sensor)
{
    uint8_t bit;

    DS18B20_LineLow(sensor);
    DS18B20_DelayMicro(2);

    DS18B20_LineRelease(sensor);
    /* The delay is selected by ROM CRC auto-tuning.  Together with the
       initial 2 us LOW pulse it defines the sampling point in the slot. */
    DS18B20_DelayMicro(sensor->read_sample_delay_us);

    bit = DS18B20_LineRead(sensor);

    DS18B20_DelayMicro(55);

    return bit;
}

// --------------------------------------------------
// Write one byte to DS18B20
// DS18B20 uses LSB first
// --------------------------------------------------
static void DS18B20_WriteByte(DS18B20_t *sensor, uint8_t data)
{
    for (uint8_t i = 0; i < 8; i++)
    {
        DS18B20_WriteBit(sensor, (data >> i) & 0x01U);
        DS18B20_DelayMicro(2);
    }
}

// --------------------------------------------------
// Read one byte from DS18B20
// DS18B20 uses LSB first
// --------------------------------------------------
static uint8_t DS18B20_ReadByte(DS18B20_t *sensor)
{
    uint8_t data = 0;

    for (uint8_t i = 0; i < 8; i++)
    {
        data += DS18B20_ReadBit(sensor) << i;
    }

    return data;
}

// --------------------------------------------------
// Initialize DS18B20 sensor
//
// Return:
// 0 = OK, sensor detected and configured
// 1 = sensor not detected
// --------------------------------------------------
uint8_t DS18B20_Init(DS18B20_t *sensor, GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin)
{
    uint8_t status;
    uint32_t primask;

    sensor->GPIOx = GPIOx;
    sensor->GPIO_Pin = GPIO_Pin;
    sensor->temperature = 0.0f;
    sensor->is_connected = 0U;
    sensor->read_sample_delay_us = 8U;

    DS18B20_LineRelease(sensor);
    DS18B20_DelayMicro(10);

    primask = DS18B20_EnterCritical();

    status = DS18B20_Reset(sensor);

    if (status == 0U)
    {
        sensor->is_connected = 1U;

        DS18B20_WriteByte(sensor, 0xCC);
        DS18B20_WriteByte(sensor, 0x4E);
        DS18B20_WriteByte(sensor, 0x64);
        DS18B20_WriteByte(sensor, 0x9E);
        DS18B20_WriteByte(sensor, 0x3F);
    }
    else
    {
        sensor->is_connected = 0U;
    }

    DS18B20_ExitCritical(primask);

    return status;
}

// --------------------------------------------------
// Start temperature conversion
//
// Return:
// 0 = OK, conversion started
// 1 = sensor not detected
// --------------------------------------------------
uint8_t DS18B20_StartConversion(DS18B20_t *sensor)
{
    uint8_t status;
    uint32_t primask;

    primask = DS18B20_EnterCritical();

    status = DS18B20_Reset(sensor);

    if (status == 0U)
    {
        sensor->is_connected = 1U;

        DS18B20_WriteByte(sensor, 0xCC);
        DS18B20_WriteByte(sensor, 0x44);
    }
    else
    {
        sensor->is_connected = 0U;
    }

    DS18B20_ExitCritical(primask);

    return status;
}

// --------------------------------------------------
// Read DS18B20 scratchpad
//
// data must point to an array of at least 9 bytes.
//
// Return:
// 0 = OK, scratchpad read
// 1 = sensor not detected
// --------------------------------------------------
static uint8_t DS18B20_ReadScratchpad(DS18B20_t *sensor, uint8_t *data)
{
    uint8_t status;
    uint32_t primask;

    primask = DS18B20_EnterCritical();

    status = DS18B20_Reset(sensor);

    if (status == 0U)
    {
        sensor->is_connected = 1U;

        DS18B20_WriteByte(sensor, 0xCC);
        DS18B20_WriteByte(sensor, 0xBE);

        for (uint8_t i = 0; i < 9; i++)
        {
            data[i] = DS18B20_ReadByte(sensor);
        }
    }
    else
    {
        sensor->is_connected = 0U;
    }

    DS18B20_ExitCritical(primask);

    return status;
}

// --------------------------------------------------
// Calculate Dallas/Maxim 1-Wire CRC8
//
// Polynomial: x^8 + x^5 + x^4 + 1
// Reversed polynomial: 0x8C
// --------------------------------------------------
static uint8_t DS18B20_CalculateCRC(const uint8_t *data, uint8_t length)
{
    uint8_t crc = 0U;

    for (uint8_t i = 0; i < length; i++)
    {
        uint8_t byte = data[i];

        for (uint8_t bit = 0; bit < 8; bit++)
        {
            uint8_t mix = (crc ^ byte) & 0x01U;

            crc >>= 1;

            if (mix)
            {
                crc ^= 0x8CU;
            }

            byte >>= 1;
        }
    }

    return crc;
}

// --------------------------------------------------
// Read the 64-bit ROM code of the only device on the bus.
// Return: 0 = OK, 1 = no presence, 2 = CRC error, 3 = bus stuck LOW.
// --------------------------------------------------
static uint8_t DS18B20_ReadROM(DS18B20_t *sensor, uint8_t *rom,
                               uint8_t *crc_calculated)
{
    uint8_t status;
    uint8_t crc;
    uint32_t primask;

    primask = DS18B20_EnterCritical();
    status = DS18B20_Reset(sensor);

    if (status == 0U)
    {
        DS18B20_WriteByte(sensor, 0x33U);

        for (uint8_t i = 0U; i < 8U; i++)
        {
            rom[i] = DS18B20_ReadByte(sensor);
        }
    }

    DS18B20_ExitCritical(primask);

    if (status != 0U)
    {
        return status;
    }

    crc = DS18B20_CalculateCRC(rom, 7U);

    if (crc_calculated != NULL)
    {
        *crc_calculated = crc;
    }

    return (crc == rom[7]) ? 0U : 2U;
}

// --------------------------------------------------
// Find a read sampling point suitable for the connected device.
// A candidate is accepted only after two valid DS18B20 ROM reads in a row.
// --------------------------------------------------
uint8_t DS18B20_AutoTuneReadTiming(DS18B20_t *sensor,
                                   uint8_t *selected_delay_us)
{
    uint8_t rom[8];
    uint8_t crc;
    uint8_t old_delay = sensor->read_sample_delay_us;

    for (uint8_t delay = 1U; delay <= 14U; delay++)
    {
        uint8_t valid_reads = 0U;
        sensor->read_sample_delay_us = delay;

        for (uint8_t attempt = 0U; attempt < 2U; attempt++)
        {
            if ((DS18B20_ReadROM(sensor, rom, &crc) == 0U) &&
                (rom[0] == 0x28U))
            {
                valid_reads++;
            }
            else
            {
                break;
            }
        }

        if (valid_reads == 2U)
        {
            if (selected_delay_us != NULL)
            {
                *selected_delay_us = delay;
            }
            return 0U;
        }
    }

    sensor->read_sample_delay_us = old_delay;
    if (selected_delay_us != NULL)
    {
        *selected_delay_us = old_delay;
    }
    return 1U;
}

// --------------------------------------------------
// Convert raw DS18B20 temperature bytes to Celsius
//
// DS18B20 temperature format:
// raw = MSB:LSB signed 16-bit value
// temperature = raw / 16.0
//
// Works correctly for positive and negative temperatures.
// --------------------------------------------------
static float DS18B20_ConvertRawToTemperature(uint8_t lsb, uint8_t msb)
{
    int16_t raw;

    raw = (int16_t)((msb << 8) | lsb);

    return (float)raw / 16.0f;
}

// --------------------------------------------------
// Read temperature from DS18B20
//
// Important:
// DS18B20_StartConversion(sensor) must be called before this function.
// For 10-bit resolution wait about 200 ms after StartConversion.
//
// Return:
// 0 = OK, temperature updated
// 1 = sensor not detected
// 2 = CRC error
// --------------------------------------------------
uint8_t DS18B20_ReadTemperature(DS18B20_t *sensor)
{
    uint8_t data[9];
    uint8_t status;
    uint8_t crc;

    status = DS18B20_ReadScratchpad(sensor, data);

    if (status != 0U)
    {
        return status;
    }

    crc = DS18B20_CalculateCRC(data, 8U);

    if (crc != data[8])
    {
        sensor->is_connected = 0U;
        return 2U;
    }

    sensor->temperature = DS18B20_ConvertRawToTemperature(data[0], data[1]);
    sensor->is_connected = 1U;

    return 0U;
}
