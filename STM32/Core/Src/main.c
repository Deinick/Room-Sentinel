/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "cmsis_os.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "DS18B20.h"
#include "FreeRTOS.h"
#include "qrcodegen.h"
#include "task.h"
#include <stdio.h>
#include <string.h>

/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */
typedef enum {
  UI_HOME = 0,
  UI_SETTINGS,
  UI_WIFI_SETUP,
  UI_ACCOUNT_LOGIN,
  UI_RESET_CONFIRM
} UiScreen_t;

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define SENSOR_COUNT 5U
#define SENSOR_CONVERSION_TIME_MS 200U
#define SENSOR_REFRESH_TIME_MS 800U
#define UI_BACKGROUND 0xF7BDU /* warm white #F7F4EE */
#define UI_PANEL 0xFFFFU      /* white */
#define UI_PANEL_BORDER 0xDEB9U
#define UI_PRIMARY 0xF465U    /* orange #F28C28 */
#define UI_TEXT 0x2924U       /* charcoal #2B2520 */
#define UI_MUTED 0x7B6CU      /* warm gray #7A6F65 */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
SPI_HandleTypeDef hspi1;
DMA_HandleTypeDef hdma_spi1_tx;
DMA_HandleTypeDef hdma_usart3_rx;

TIM_HandleTypeDef htim2;
TIM_HandleTypeDef htim6;

UART_HandleTypeDef huart3;

/* Definitions for defaultTask */
osThreadId_t defaultTaskHandle;
const osThreadAttr_t defaultTask_attributes = {
  .name = "defaultTask",
  .stack_size = 1024 * 4,
  .priority = (osPriority_t) osPriorityNormal,
};
/* USER CODE BEGIN PV */
static DS18B20_t temperature_sensors[SENSOR_COUNT];
static uint8_t temperature_status[SENSOR_COUNT];
static volatile uint32_t wifi_status_sequence;
static char wifi_status_text[40] = "WIFI: WAITING FOR ESP32";
static char displayed_temperature_text[SENSOR_COUNT][32];
#define UART_RX_RING_SIZE 512U
static volatile uint16_t uart_rx_tail;
static uint8_t uart_rx_ring[UART_RX_RING_SIZE];
static volatile uint32_t uart_rx_count;
static volatile uint32_t uart_newline_count;
static volatile uint8_t uart_status_decoded;
static volatile uint8_t uart_last_bytes[4];
static volatile UiScreen_t ui_screen = UI_HOME;
static volatile uint8_t ui_redraw = 1U;
static char wifi_qr_payload[160];
static volatile uint32_t wifi_qr_sequence;
static char device_serial[20] = "---- ---- ---- ----";
static char login_qr_payload[256];
static char login_status_text[48] = "Waiting for server...";
static volatile uint32_t login_sequence;

static osThreadId_t uartTaskHandle;
static const osThreadAttr_t uartTask_attributes = {
  .name = "uartTask",
  .stack_size = 512 * 4,
  .priority = (osPriority_t) osPriorityBelowNormal,
};

static GPIO_TypeDef *const sensor_ports[SENSOR_COUNT] = {
  TEMP_1_GPIO_Port,
  TEMP_2_GPIO_Port,
  TEMP_3_GPIO_Port,
  TEMP_4_GPIO_Port,
  TEMP_5_GPIO_Port
};

static const uint16_t sensor_pins[SENSOR_COUNT] = {
  TEMP_1_Pin,
  TEMP_2_Pin,
  TEMP_3_Pin,
  TEMP_4_Pin,
  TEMP_5_Pin
};

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_SPI1_Init(void);
static void MX_TIM2_Init(void);
static void MX_TIM6_Init(void);
static void MX_USART3_UART_Init(void);
void StartDefaultTask(void *argument);

/* USER CODE BEGIN PFP */
static void DisplayTemperature(uint8_t sensor_index);
static void DisplayWifiStatus(void);
static void StartUartTask(void *argument);
static void UiRender(void);
static void UiHandleTouch(void);
static void UiServiceDelay(uint32_t duration_ms);
static void Esp32SendCommand(const char *command);
static void Esp32SendTelemetry(void);
static uint8_t JsonStringField(const char *json, const char *name,
                               char *value, size_t value_size);

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
static uint8_t JsonStringField(const char *json, const char *name,
                               char *value, size_t value_size)
{
  char pattern[40];
  (void)snprintf(pattern, sizeof(pattern), "\"%s\":\"", name);
  const char *start = strstr(json, pattern);
  if (start == NULL || value_size == 0U) return 0U;
  start += strlen(pattern);
  const char *end = strchr(start, '"');
  if (end == NULL) return 0U;
  size_t length = (size_t)(end - start);
  if (length >= value_size) length = value_size - 1U;
  (void)memcpy(value, start, length);
  value[length] = '\0';
  return 1U;
}

static void AppendTemperatureJson(char *buffer, size_t buffer_size,
                                  size_t *offset, uint8_t sensor_index,
                                  const char *name)
{
  int written;
  if (temperature_status[sensor_index] != 0U)
  {
    written = snprintf(&buffer[*offset], buffer_size - *offset,
                       "\"%s\":null", name);
  }
  else
  {
    float temperature = temperature_sensors[sensor_index].temperature;
    int32_t tenths = (int32_t)((temperature >= 0.0f)
                              ? (temperature * 10.0f + 0.5f)
                              : (temperature * 10.0f - 0.5f));
    int32_t magnitude = (tenths < 0) ? -tenths : tenths;
    written = snprintf(&buffer[*offset], buffer_size - *offset,
                       "\"%s\":%s%ld.%ld", name,
                       (tenths < 0) ? "-" : "",
                       (long)(magnitude / 10), (long)(magnitude % 10));
  }
  if (written > 0 && (size_t)written < buffer_size - *offset)
  {
    *offset += (size_t)written;
  }
}

static void Esp32SendTelemetry(void)
{
  static uint32_t sequence;
  static const char *const names[SENSOR_COUNT] = {
    "Centre", "Window", "Heater", "Door", "Far wall"
  };
  char message[256];
  size_t offset = (size_t)snprintf(message, sizeof(message),
      "{\"type\":\"telemetry\",\"sequence\":%lu,\"uptime_ms\":%lu,",
      (unsigned long)++sequence, (unsigned long)HAL_GetTick());

  for (uint8_t i = 0U; i < SENSOR_COUNT && offset < sizeof(message); i++)
  {
    AppendTemperatureJson(message, sizeof(message), &offset, i, names[i]);
    if (i + 1U < SENSOR_COUNT && offset + 1U < sizeof(message))
    {
      message[offset++] = ',';
      message[offset] = '\0';
    }
  }
  if (offset + 2U < sizeof(message))
  {
    message[offset++] = '}';
    message[offset++] = '\n';
    message[offset] = '\0';
    (void)HAL_UART_Transmit(&huart3, (uint8_t *)message,
                            (uint16_t)offset, 250U);
  }
}

static void DisplayTemperature(uint8_t sensor_index)
{
  char line[32];
  uint16_t x = (sensor_index % 2U == 0U) ? 12U : 246U;
  uint16_t y = (uint16_t)(58U + ((sensor_index / 2U) * 76U));

  if (temperature_status[sensor_index] == 0U)
  {
    float temperature = temperature_sensors[sensor_index].temperature;
    int32_t tenths = (int32_t)((temperature >= 0.0f)
                              ? (temperature * 10.0f + 0.5f)
                              : (temperature * 10.0f - 0.5f));
    int32_t magnitude = (tenths < 0) ? -tenths : tenths;

    (void)snprintf(line, sizeof(line), "%s%ld.%ld C",
                   (tenths < 0) ? "-" : "",
                   (long)(magnitude / 10),
                   (long)(magnitude % 10));
  }
  else
  {
    (void)strncpy(line, "NOT CONNECTED", sizeof(line));
  }

  if (strcmp(line, displayed_temperature_text[sensor_index]) == 0)
  {
    return;
  }
  (void)strncpy(displayed_temperature_text[sensor_index], line,
                sizeof(displayed_temperature_text[sensor_index]));
  displayed_temperature_text[sensor_index]
                            [sizeof(displayed_temperature_text[0]) - 1U] = '\0';

  Displ_CString((uint16_t)(x + 20U), (uint16_t)(y + 28U),
                (uint16_t)(x + 212U), (uint16_t)(y + 56U), line,
                Font16, 1U,
                (temperature_status[sensor_index] == 0U) ? UI_TEXT : RED,
                UI_PANEL);
}

static void DisplayWifiStatus(void)
{
  char text[sizeof(wifi_status_text)];
  (void)strncpy(text, wifi_status_text, sizeof(text));
  text[sizeof(text) - 1U] = '\0';

  const char *value = (strncmp(text, "WIFI: ", 6U) == 0) ? &text[6] : text;
  char display_value[sizeof(text)];
  size_t value_length = strlen(value);
  if (value_length >= sizeof(display_value)) value_length = sizeof(display_value) - 1U;
  for (size_t i = 0U; i < value_length; i++)
  {
    char character = value[i];
    if (character == '_') character = ' ';
    if (character >= 'a' && character <= 'z') character -= ('a' - 'A');
    display_value[i] = character;
  }
  display_value[value_length] = '\0';
  Displ_CString(266U, 238U, 458U, 266U, display_value,
                Font16, 1U, UI_PRIMARY, UI_PANEL);
}

static void UiDrawSensorCard(uint8_t sensor_index, const char *label,
                             uint16_t accent)
{
  uint16_t x = (sensor_index % 2U == 0U) ? 12U : 246U;
  uint16_t y = (uint16_t)(58U + ((sensor_index / 2U) * 76U));
  Displ_fillRoundRect(x, y, 222, 66, 8, UI_PANEL);
  Displ_drawRoundRect(x, y, 222, 66, 8, UI_PANEL_BORDER);
  Displ_FillArea((uint16_t)(x + 8U), (uint16_t)(y + 10U), 5U, 46U, accent);
  Displ_CString((uint16_t)(x + 20U), (uint16_t)(y + 5U),
                (uint16_t)(x + 212U), (uint16_t)(y + 29U), label,
                Font16, 1U, UI_MUTED, UI_PANEL);
}

static void UiDrawButton(uint16_t x, uint16_t y, uint16_t w, uint16_t h,
                         const char *label, uint16_t color)
{
  uint16_t text_color = (color == UI_PANEL) ? UI_TEXT : WHITE;
  uint16_t border_color = (color == UI_PANEL) ? UI_PRIMARY : color;
  Displ_fillRoundRect(x, y, w, h, 8, color);
  Displ_drawRoundRect(x, y, w, h, 8, border_color);
  Displ_FillArea((uint16_t)(x + 10U), (uint16_t)(y + 10U), 5U,
                 (uint16_t)(h - 20U),
                 (color == UI_PANEL) ? UI_PRIMARY : WHITE);
  Displ_CString(x, y, (uint16_t)(x + w - 1U), (uint16_t)(y + h - 1U),
                label, Font16, 1U, text_color, color);
}

static void UiDrawGear(void)
{
  Displ_fillRoundRect(424, 7, 48, 40, 9, UI_PANEL);
  Displ_drawRoundRect(424, 7, 48, 40, 9, UI_PANEL_BORDER);
  Displ_drawCircle(448, 27, 10, UI_PRIMARY);
  Displ_fillCircle(448, 27, 3, UI_PRIMARY);
  Displ_FillArea(445, 12, 7, 5, UI_PRIMARY);
  Displ_FillArea(445, 37, 7, 5, UI_PRIMARY);
  Displ_FillArea(433, 24, 5, 7, UI_PRIMARY);
  Displ_FillArea(458, 24, 5, 7, UI_PRIMARY);
}

static void UiDrawQrCode(const char *payload)
{
  enum { QR_VERSION_MAX = 10 };
  static uint8_t temp[qrcodegen_BUFFER_LEN_FOR_VERSION(QR_VERSION_MAX)];
  static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(QR_VERSION_MAX)];

  if (payload[0] == '\0' ||
      !qrcodegen_encodeText(payload, temp, qr, qrcodegen_Ecc_LOW,
                            1, QR_VERSION_MAX, qrcodegen_Mask_AUTO, true)) {
    Displ_CString(40, 125, 439, 165, "Waiting for ESP32 setup data...",
                  Font16, 1U, UI_PRIMARY, UI_BACKGROUND);
    return;
  }

  int size = qrcodegen_getSize(qr);
  int scale = 5;
  while ((size + 8) * scale > 220) {
    scale--;
  }
  int pixels = (size + 8) * scale;
  int x0 = (480 - pixels) / 2;
  int y0 = 52;
  Displ_FillArea((uint16_t)x0, (uint16_t)y0,
                 (uint16_t)pixels, (uint16_t)pixels, WHITE);
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      if (qrcodegen_getModule(qr, x, y)) {
        Displ_FillArea((uint16_t)(x0 + (x + 4) * scale),
                       (uint16_t)(y0 + (y + 4) * scale),
                       (uint16_t)scale, (uint16_t)scale, BLACK);
      }
    }
  }
}

static void UiRender(void)
{
  Displ_CLS(UI_BACKGROUND);
  if (ui_screen == UI_HOME) {
    static const char *const sensor_labels[SENSOR_COUNT] = {
      "CENTRE", "WINDOW", "HEATER", "DOOR", "FAR WALL"
    };
    static const uint16_t sensor_accents[SENSOR_COUNT] = {
      UI_PRIMARY, UI_PRIMARY, UI_PRIMARY, UI_PRIMARY, UI_PRIMARY
    };
    Displ_CString(14, 7, 205, 45, "ROOM SENTINEL",
                  Font16, 1U, UI_TEXT, UI_BACKGROUND);
    Displ_CString(210, 7, 408, 45, "LIVE MONITOR",
                  Font16, 1U, UI_PRIMARY, UI_BACKGROUND);
    UiDrawGear();
    (void)memset(displayed_temperature_text, 0,
                 sizeof(displayed_temperature_text));
    for (uint8_t i = 0U; i < SENSOR_COUNT; i++) {
      UiDrawSensorCard(i, sensor_labels[i], sensor_accents[i]);
      DisplayTemperature(i);
    }
    Displ_fillRoundRect(246, 210, 222, 66, 8, UI_PANEL);
    Displ_drawRoundRect(246, 210, 222, 66, 8, UI_PANEL_BORDER);
    Displ_FillArea(254, 220, 5, 46, UI_PRIMARY);
    Displ_CString(266, 215, 458, 239, "WI-FI CONNECTION",
                  Font16, 1U, UI_MUTED, UI_PANEL);
    DisplayWifiStatus();
  } else if (ui_screen == UI_SETTINGS) {
    Displ_CString(20, 10, 459, 48, "SETTINGS", Font16, 1U, UI_PRIMARY, UI_BACKGROUND);
    UiDrawButton(40, 60, 400, 50, "WI-FI SETUP", UI_PANEL);
    UiDrawButton(40, 120, 400, 50, "ACCOUNT LOGIN", UI_PANEL);
    UiDrawButton(40, 180, 400, 50, "FACTORY RESET", D_RED);
    UiDrawButton(15, 265, 130, 45, "< BACK", UI_PANEL);
  } else if (ui_screen == UI_WIFI_SETUP) {
    Displ_CString(20, 8, 459, 45, "WI-FI SETUP", Font16, 1U, UI_PRIMARY, UI_BACKGROUND);
    UiDrawQrCode(wifi_qr_payload);
    UiDrawButton(15, 265, 130, 45, "< BACK", UI_PANEL);
    if (strncmp(wifi_qr_payload, "http://", 7U) == 0 ||
        strncmp(wifi_qr_payload, "https://", 8U) == 0) {
      Displ_CString(155, 270, 465, 310, "2. Scan to open setup",
                    Font16, 1U, UI_TEXT, UI_BACKGROUND);
    } else {
      Displ_CString(155, 270, 465, 310, "1. Scan to connect",
                    Font16, 1U, UI_TEXT, UI_BACKGROUND);
    }
  } else if (ui_screen == UI_ACCOUNT_LOGIN) {
    Displ_CString(10, 8, 185, 45, "ACCOUNT LOGIN", Font16, 1U, UI_PRIMARY, UI_BACKGROUND);
    Displ_CString(190, 8, 470, 45, device_serial,
                  Font16, 1U, UI_TEXT, UI_BACKGROUND);
    UiDrawQrCode(login_qr_payload);
    UiDrawButton(15, 265, 130, 45, "< BACK", UI_PANEL);
    Displ_CString(150, 270, 470, 310, login_status_text,
                  Font16, 1U, UI_TEXT, UI_BACKGROUND);
  } else {
    Displ_CString(20, 30, 459, 70, "FACTORY RESET?", Font16, 1U, D_RED, UI_BACKGROUND);
    Displ_CString(30, 90, 449, 130, "Wi-Fi settings will be erased.",
                  Font16, 1U, UI_TEXT, UI_BACKGROUND);
    UiDrawButton(40, 175, 180, 65, "CANCEL", UI_PANEL);
    UiDrawButton(260, 175, 180, 65, "RESET", D_RED);
  }
  ui_redraw = 0U;
}

static void Esp32SendCommand(const char *command)
{
  (void)HAL_UART_Transmit(&huart3, (uint8_t *)command,
                          (uint16_t)strlen(command), 200U);
  (void)HAL_UART_Transmit(&huart3, (uint8_t *)"\n", 1U, 50U);
}

static void UiHandleTouch(void)
{
  uint16_t x, y;
  uint8_t touched;
  if (Touch_GotATouch(0) == 0U && Touch_PollTouch() == 0U) {
    return;
  }
  Touch_GetXYtouch(&x, &y, &touched);
  (void)Touch_WaitForUntouch(250U);
  (void)Touch_GotATouch(1);
  if (touched == 0U) {
    return;
  }

  if (ui_screen == UI_HOME && x >= 395U && y <= 70U) {
    ui_screen = UI_SETTINGS;
    ui_redraw = 1U;
  } else if (ui_screen == UI_SETTINGS) {
    if (y >= 45U && y < 115U) {
      wifi_qr_payload[0] = '\0';
      ui_screen = UI_WIFI_SETUP;
      ui_redraw = 1U;
      Esp32SendCommand("START_PROVISIONING");
    } else if (y >= 115U && y < 175U) {
      login_qr_payload[0] = '\0';
      (void)strncpy(login_status_text, "Requesting login...",
                    sizeof(login_status_text));
      ui_screen = UI_ACCOUNT_LOGIN;
      ui_redraw = 1U;
      Esp32SendCommand("START_LOGIN");
    } else if (y >= 175U && y < 240U) {
      ui_screen = UI_RESET_CONFIRM;
      ui_redraw = 1U;
    } else if (x <= 180U && y >= 240U) {
      ui_screen = UI_HOME;
      ui_redraw = 1U;
    }
  } else if (ui_screen == UI_WIFI_SETUP && x <= 180U && y >= 240U) {
    ui_screen = UI_SETTINGS;
    ui_redraw = 1U;
  } else if (ui_screen == UI_ACCOUNT_LOGIN && x <= 180U && y >= 240U) {
    ui_screen = UI_SETTINGS;
    ui_redraw = 1U;
  } else if (ui_screen == UI_RESET_CONFIRM && y >= 145U && y <= 270U) {
    if (x < 240U) {
      ui_screen = UI_SETTINGS;
    } else {
      wifi_qr_payload[0] = '\0';
      ui_screen = UI_WIFI_SETUP;
      Esp32SendCommand("FACTORY_RESET");
    }
    ui_redraw = 1U;
  }
}

static void UiServiceDelay(uint32_t duration_ms)
{
  uint32_t elapsed = 0U;
  while (elapsed < duration_ms)
  {
    UiHandleTouch();
    if (ui_redraw != 0U)
    {
      UiRender();
    }
    uint32_t step = ((duration_ms - elapsed) > 20U) ? 20U : (duration_ms - elapsed);
    osDelay(step);
    elapsed += step;
  }
}

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_DMA_Init();
  MX_SPI1_Init();
  MX_TIM2_Init();
  MX_TIM6_Init();
  MX_USART3_UART_Init();
  /* USER CODE BEGIN 2 */
  HAL_TIM_Base_Start(&htim6);
  DS18B20_SetTimer(TIM6);

  Displ_Init(Displ_Orientat_270);
  Displ_CLS(UI_BACKGROUND);
  Displ_BackLight('I');

  for (uint8_t i = 0U; i < SENSOR_COUNT; i++)
  {
    temperature_status[i] = DS18B20_Init(&temperature_sensors[i],
                                         sensor_ports[i], sensor_pins[i]);
  }

  UiRender();

  /* USER CODE END 2 */

  /* Init scheduler */
  osKernelInitialize();

  /* USER CODE BEGIN RTOS_MUTEX */
  /* add mutexes, ... */
  /* USER CODE END RTOS_MUTEX */

  /* USER CODE BEGIN RTOS_SEMAPHORES */
  /* add semaphores, ... */
  /* USER CODE END RTOS_SEMAPHORES */

  /* USER CODE BEGIN RTOS_TIMERS */
  /* start timers, add new ones, ... */
  /* USER CODE END RTOS_TIMERS */

  /* USER CODE BEGIN RTOS_QUEUES */
  /* add queues, ... */
  /* USER CODE END RTOS_QUEUES */

  /* Create the thread(s) */
  /* creation of defaultTask */
  defaultTaskHandle = osThreadNew(StartDefaultTask, NULL, &defaultTask_attributes);

  /* USER CODE BEGIN RTOS_THREADS */
  uartTaskHandle = osThreadNew(StartUartTask, NULL, &uartTask_attributes);
  if (uartTaskHandle == NULL)
  {
    (void)strncpy(wifi_status_text, "WIFI: UART TASK ERROR",
                  sizeof(wifi_status_text));
    wifi_status_text[sizeof(wifi_status_text) - 1U] = '\0';
    wifi_status_sequence++;
  }
  /* USER CODE END RTOS_THREADS */

  /* USER CODE BEGIN RTOS_EVENTS */
  /* add events, ... */
  /* USER CODE END RTOS_EVENTS */

  /* Start scheduler */
  osKernelStart();

  /* We should never get here as control is now taken by the scheduler */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
  RCC_OscInitStruct.PLL.PLLM = 8;
  RCC_OscInitStruct.PLL.PLLN = 100;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV2;
  RCC_OscInitStruct.PLL.PLLQ = 4;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV4;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV2;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_3) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief SPI1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_SPI1_Init(void)
{

  /* USER CODE BEGIN SPI1_Init 0 */

  /* USER CODE END SPI1_Init 0 */

  /* USER CODE BEGIN SPI1_Init 1 */

  /* USER CODE END SPI1_Init 1 */
  /* SPI1 parameter configuration*/
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_2LINES;
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_2;
  hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial = 10;
  if (HAL_SPI_Init(&hspi1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN SPI1_Init 2 */

  /* USER CODE END SPI1_Init 2 */

}

/**
  * @brief TIM2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM2_Init(void)
{

  /* USER CODE BEGIN TIM2_Init 0 */

  /* USER CODE END TIM2_Init 0 */

  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_OC_InitTypeDef sConfigOC = {0};

  /* USER CODE BEGIN TIM2_Init 1 */

  /* USER CODE END TIM2_Init 1 */
  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 10000;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = 20;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigOC.OCMode = TIM_OCMODE_PWM1;
  sConfigOC.Pulse = 0;
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM2_Init 2 */

  /* USER CODE END TIM2_Init 2 */
  HAL_TIM_MspPostInit(&htim2);

}

/**
  * @brief TIM6 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM6_Init(void)
{

  /* USER CODE BEGIN TIM6_Init 0 */

  /* USER CODE END TIM6_Init 0 */

  TIM_MasterConfigTypeDef sMasterConfig = {0};

  /* USER CODE BEGIN TIM6_Init 1 */

  /* USER CODE END TIM6_Init 1 */
  htim6.Instance = TIM6;
  htim6.Init.Prescaler = 49;
  htim6.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim6.Init.Period = 65535;
  htim6.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim6) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim6, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM6_Init 2 */

  /* USER CODE END TIM6_Init 2 */

}

/**
  * @brief USART3 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART3_UART_Init(void)
{

  /* USER CODE BEGIN USART3_Init 0 */

  /* USER CODE END USART3_Init 0 */

  /* USER CODE BEGIN USART3_Init 1 */

  /* USER CODE END USART3_Init 1 */
  huart3.Instance = USART3;
  huart3.Init.BaudRate = 9600;
  huart3.Init.WordLength = UART_WORDLENGTH_8B;
  huart3.Init.StopBits = UART_STOPBITS_1;
  huart3.Init.Parity = UART_PARITY_NONE;
  huart3.Init.Mode = UART_MODE_TX_RX;
  huart3.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart3.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart3) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART3_Init 2 */
  if (HAL_UART_Receive_DMA(&huart3, uart_rx_ring, UART_RX_RING_SIZE) != HAL_OK)
  {
    Error_Handler();
  }

  /* USER CODE END USART3_Init 2 */

}

/**
  * Enable DMA controller clock
  */
static void MX_DMA_Init(void)
{

  /* DMA controller clock enable */
  __HAL_RCC_DMA2_CLK_ENABLE();

  /* DMA interrupt init */
  /* DMA2_Stream3_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA2_Stream3_IRQn, 5, 0);
  HAL_NVIC_EnableIRQ(DMA2_Stream3_IRQn);

}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
/* USER CODE BEGIN MX_GPIO_Init_1 */
/* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOH_CLK_ENABLE();
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(GPIOC, TEMP_1_Pin|TEMP_2_Pin|TEMP_3_Pin|TEMP_4_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(TEMP_5_GPIO_Port, TEMP_5_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(GPIOC, DISPL_DC_Pin|DISPL_RST_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(GPIOB, DISPL_CS_Pin|TOUCH_CS_Pin, GPIO_PIN_SET);

  /*Configure GPIO pins : TEMP_1_Pin TEMP_2_Pin TEMP_3_Pin TEMP_4_Pin */
  GPIO_InitStruct.Pin = TEMP_1_Pin|TEMP_2_Pin|TEMP_3_Pin|TEMP_4_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOC, &GPIO_InitStruct);

  /*Configure GPIO pin : TEMP_5_Pin */
  GPIO_InitStruct.Pin = TEMP_5_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(TEMP_5_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : TOUCH_INT_Pin */
  GPIO_InitStruct.Pin = TOUCH_INT_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(TOUCH_INT_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : DISPL_DC_Pin */
  GPIO_InitStruct.Pin = DISPL_DC_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(DISPL_DC_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : DISPL_RST_Pin */
  GPIO_InitStruct.Pin = DISPL_RST_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(DISPL_RST_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pins : DISPL_CS_Pin TOUCH_CS_Pin */
  GPIO_InitStruct.Pin = DISPL_CS_Pin|TOUCH_CS_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

  /* EXTI interrupt init*/
  HAL_NVIC_SetPriority(EXTI4_IRQn, 5, 0);
  HAL_NVIC_EnableIRQ(EXTI4_IRQn);

/* USER CODE BEGIN MX_GPIO_Init_2 */
/* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

static void StartUartTask(void *argument)
{
  uint8_t byte;
  char line[512];
  size_t length = 0U;
  uint8_t received_any_data = 0U;

  (void)argument;
  taskENTER_CRITICAL();
  (void)strncpy(wifi_status_text, "WIFI: UART READY",
                sizeof(wifi_status_text));
  wifi_status_text[sizeof(wifi_status_text) - 1U] = '\0';
  wifi_status_sequence++;
  taskEXIT_CRITICAL();

  for (;;)
  {
    uint16_t dma_head = (uint16_t)(UART_RX_RING_SIZE -
        __HAL_DMA_GET_COUNTER(&hdma_usart3_rx));
    if (uart_rx_tail == dma_head)
    {
      osDelay(1U);
      continue;
    }

    byte = uart_rx_ring[uart_rx_tail];
    uart_rx_tail = (uint16_t)((uart_rx_tail + 1U) % UART_RX_RING_SIZE);
    uart_rx_count++;
    uart_last_bytes[0] = uart_last_bytes[1];
    uart_last_bytes[1] = uart_last_bytes[2];
    uart_last_bytes[2] = uart_last_bytes[3];
    uart_last_bytes[3] = byte;

    if (received_any_data == 0U)
    {
      received_any_data = 1U;
      taskENTER_CRITICAL();
      (void)strncpy(wifi_status_text, "WIFI: UART DATA",
                    sizeof(wifi_status_text));
      wifi_status_text[sizeof(wifi_status_text) - 1U] = '\0';
      wifi_status_sequence++;
      taskEXIT_CRITICAL();
    }

    if (byte == '\n')
    {
      uart_newline_count++;
      line[length] = '\0';
      uint8_t pairing_line = (strstr(line, "\"type\":\"pairing") != NULL);
      if (strstr(line, "\"type\":\"device_info\"") != NULL)
      {
        char serial[sizeof(device_serial)];
        if (JsonStringField(line, "serial", serial, sizeof(serial)) != 0U)
        {
          taskENTER_CRITICAL();
          (void)strncpy(device_serial, serial, sizeof(device_serial));
          device_serial[sizeof(device_serial) - 1U] = '\0';
          login_sequence++;
          taskEXIT_CRITICAL();
        }
      }
      if (pairing_line != 0U)
      {
        char pairing_url[sizeof(login_qr_payload)] = "";
        char email[48] = "";
        char state[32] = "";
        char new_login_status[sizeof(login_status_text)] = "";
        (void)JsonStringField(line, "pairing_url", pairing_url,
                              sizeof(pairing_url));
        if (pairing_url[0] == '\0')
        {
          (void)JsonStringField(line, "qr", pairing_url,
                                sizeof(pairing_url));
        }
        (void)JsonStringField(line, "email", email, sizeof(email));
        (void)JsonStringField(line, "state", state, sizeof(state));

        if (strstr(line, "\"type\":\"pairing_created\"") != NULL)
          (void)strncpy(new_login_status, "Scan QR to log in",
                        sizeof(new_login_status));
        else if (strstr(line, "\"type\":\"pairing_success\"") != NULL)
          (void)snprintf(new_login_status, sizeof(new_login_status),
                         "Logged in: %.36s", email);
        else if (strstr(line, "\"type\":\"pairing_failed\"") != NULL)
          (void)strncpy(new_login_status, "Login failed", sizeof(new_login_status));
        else if (strcmp(state, "requesting") == 0)
          (void)strncpy(new_login_status, "Requesting login...",
                        sizeof(new_login_status));
        else if (strcmp(state, "server_offline") == 0)
          (void)strncpy(new_login_status, "Server offline - retrying",
                        sizeof(new_login_status));

        taskENTER_CRITICAL();
        if (pairing_url[0] != '\0')
        {
          (void)strncpy(login_qr_payload, pairing_url,
                        sizeof(login_qr_payload));
          login_qr_payload[sizeof(login_qr_payload) - 1U] = '\0';
        }
        if (new_login_status[0] != '\0')
        {
          (void)strncpy(login_status_text, new_login_status,
                        sizeof(login_status_text));
          login_status_text[sizeof(login_status_text) - 1U] = '\0';
        }
        login_sequence++;
        taskEXIT_CRITICAL();
      }
      const char *qr_value = strstr(line, "\"qr\":\"");
      if (pairing_line == 0U && qr_value != NULL)
      {
        qr_value += sizeof("\"qr\":\"") - 1U;
        const char *qr_end = strchr(qr_value, '"');
        if (qr_end != NULL)
        {
          size_t qr_length = (size_t)(qr_end - qr_value);
          if (qr_length >= sizeof(wifi_qr_payload))
          {
            qr_length = sizeof(wifi_qr_payload) - 1U;
          }
          char new_qr_payload[sizeof(wifi_qr_payload)];
          (void)memcpy(new_qr_payload, qr_value, qr_length);
          new_qr_payload[qr_length] = '\0';

          taskENTER_CRITICAL();
          if (strcmp(wifi_qr_payload, new_qr_payload) != 0)
          {
            (void)strncpy(wifi_qr_payload, new_qr_payload,
                          sizeof(wifi_qr_payload));
            wifi_qr_payload[sizeof(wifi_qr_payload) - 1U] = '\0';
            wifi_qr_sequence++;
          }
          taskEXIT_CRITICAL();
        }
      }
      const char *state = strstr(line, "\"state\":\"");
      if (pairing_line == 0U &&
          strstr(line, "\"type\":\"status\"") != NULL && state != NULL)
      {
        state += sizeof("\"state\":\"") - 1U;
        const char *end = strchr(state, '"');
        if (end != NULL)
        {
          size_t state_length = (size_t)(end - state);
          if (state_length > (sizeof(wifi_status_text) - 7U))
          {
            state_length = sizeof(wifi_status_text) - 7U;
          }

          char new_status[sizeof(wifi_status_text)];
          (void)memcpy(new_status, "WIFI: ", 6U);
          (void)memcpy(&new_status[6], state, state_length);
          new_status[6U + state_length] = '\0';

          taskENTER_CRITICAL();
          uart_status_decoded = 1U;
          if (strcmp(wifi_status_text, new_status) != 0)
          {
            (void)strncpy(wifi_status_text, new_status,
                          sizeof(wifi_status_text));
            wifi_status_text[sizeof(wifi_status_text) - 1U] = '\0';
            wifi_status_sequence++;
          }
          taskEXIT_CRITICAL();
        }
      }
      length = 0U;
    }
    else if (byte != '\r')
    {
      if (length < (sizeof(line) - 1U))
      {
        line[length++] = (char)byte;
      }
      else
      {
        length = 0U;
      }
    }
  }
}

/* USER CODE END 4 */

/* USER CODE BEGIN Header_StartDefaultTask */
/**
  * @brief  Function implementing the defaultTask thread.
  * @param  argument: Not used
  * @retval None
  */
/* USER CODE END Header_StartDefaultTask */
void StartDefaultTask(void *argument)
{
  /* USER CODE BEGIN 5 */
  uint32_t displayed_wifi_sequence = UINT32_MAX;
  uint32_t displayed_qr_sequence = wifi_qr_sequence;
  uint32_t displayed_login_sequence = login_sequence;
  /* Infinite loop */
  for(;;)
  {
    for (uint8_t i = 0U; i < SENSOR_COUNT; i++)
    {
      temperature_status[i] = DS18B20_StartConversion(&temperature_sensors[i]);
    }

    UiServiceDelay(SENSOR_CONVERSION_TIME_MS);

    for (uint8_t i = 0U; i < SENSOR_COUNT; i++)
    {
      if (temperature_status[i] == 0U)
      {
        temperature_status[i] = DS18B20_ReadTemperature(&temperature_sensors[i]);
      }

      if (ui_screen == UI_HOME)
      {
        DisplayTemperature(i);
      }
    }

    Esp32SendTelemetry();

    if (displayed_wifi_sequence != wifi_status_sequence)
    {
      displayed_wifi_sequence = wifi_status_sequence;
      if (ui_screen == UI_HOME)
      {
        DisplayWifiStatus();
      }
    }
    if (displayed_qr_sequence != wifi_qr_sequence)
    {
      displayed_qr_sequence = wifi_qr_sequence;
      if (ui_screen == UI_WIFI_SETUP)
      {
        ui_redraw = 1U;
      }
    }
    if (displayed_login_sequence != login_sequence)
    {
      displayed_login_sequence = login_sequence;
      if (ui_screen == UI_ACCOUNT_LOGIN)
      {
        ui_redraw = 1U;
      }
    }

    UiHandleTouch();
    if (ui_redraw != 0U)
    {
      UiRender();
    }

    UiServiceDelay(SENSOR_REFRESH_TIME_MS);
  }
  /* USER CODE END 5 */
}

/**
  * @brief  Period elapsed callback in non blocking mode
  * @note   This function is called  when TIM7 interrupt took place, inside
  * HAL_TIM_IRQHandler(). It makes a direct call to HAL_IncTick() to increment
  * a global variable "uwTick" used as application time base.
  * @param  htim : TIM handle
  * @retval None
  */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
  /* USER CODE BEGIN Callback 0 */

  /* USER CODE END Callback 0 */
  if (htim->Instance == TIM7) {
    HAL_IncTick();
  }
  /* USER CODE BEGIN Callback 1 */

  /* USER CODE END Callback 1 */
}

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
