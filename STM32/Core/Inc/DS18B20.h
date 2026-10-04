#ifndef INC_DS18B20_H_
#define INC_DS18B20_H_

#include "stm32f4xx_hal.h"
#include <stdint.h>

typedef struct
{
    GPIO_TypeDef *GPIOx;
    uint16_t GPIO_Pin;
    float temperature;
    uint8_t is_connected;
    uint8_t read_sample_delay_us;
} DS18B20_t;

void DS18B20_SetTimer(TIM_TypeDef *TIMx);
uint8_t DS18B20_AutoTuneReadTiming(DS18B20_t *sensor,
                                   uint8_t *selected_delay_us);

uint8_t DS18B20_Init(DS18B20_t *sensor, GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin);
uint8_t DS18B20_StartConversion(DS18B20_t *sensor);
uint8_t DS18B20_ReadTemperature(DS18B20_t *sensor);

#endif /* INC_DS18B20_H_ */
