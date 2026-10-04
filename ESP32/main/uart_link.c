#include "uart_link.h"

#include <stdio.h>
#include <string.h>

#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "wifi_provisioning.h"
#include "server_link.h"

#define LINK_UART UART_NUM_2
#define LINK_TX_GPIO 17
#define LINK_RX_GPIO 16
#define LINK_BAUD_RATE 9600

static const char *TAG = "uart_link";
static SemaphoreHandle_t link_mutex;
static char latest_status[256] =
    "{\"type\":\"status\",\"state\":\"booting\",\"detail\":\"\"}";
static char latest_provisioning[384];
static bool provisioning_available;

static void uart_link_write_line(const char *line)
{
    if (link_mutex != NULL) {
        xSemaphoreTake(link_mutex, portMAX_DELAY);
    }
    uart_write_bytes(LINK_UART, line, strlen(line));
    uart_write_bytes(LINK_UART, "\n", 1);
    if (link_mutex != NULL) {
        xSemaphoreGive(link_mutex);
    }
    ESP_LOGI(TAG, "TX: %s", line);
}

static void uart_status_task(void *argument)
{
    char message[sizeof(latest_status)];
    (void)argument;

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        xSemaphoreTake(link_mutex, portMAX_DELAY);
        strlcpy(message, latest_status, sizeof(message));
        xSemaphoreGive(link_mutex);
        if (provisioning_available) {
            uart_link_write_line(latest_provisioning);
        }
        uart_link_write_line(message);
    }
}

static void uart_command_task(void *argument)
{
    char line[320];
    size_t length = 0;
    uint8_t byte;
    (void)argument;

    for (;;) {
        int count = uart_read_bytes(LINK_UART, &byte, 1, pdMS_TO_TICKS(100));
        if (count <= 0) {
            continue;
        }
        if (byte == '\n') {
            line[length] = '\0';
            ESP_LOGI(TAG, "RX command: %s", line);
            if (strcmp(line, "START_PROVISIONING") == 0) {
                wifi_provisioning_request_setup();
            } else if (strcmp(line, "FACTORY_RESET") == 0) {
                wifi_provisioning_factory_reset();
            } else if (strcmp(line, "START_LOGIN") == 0) {
                server_link_request_pairing();
            } else if (strstr(line, "\"type\":\"telemetry\"") != NULL) {
                server_link_send_telemetry(line);
            }
            length = 0;
        } else if (byte != '\r') {
            if (length < sizeof(line) - 1) {
                line[length++] = (char)byte;
            } else {
                length = 0;
            }
        }
    }
}

esp_err_t uart_link_init(void)
{
    const uart_config_t config = {
        .baud_rate = LINK_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    link_mutex = xSemaphoreCreateMutex();
    if (link_mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }
    ESP_ERROR_CHECK(uart_driver_install(LINK_UART, 1024, 1024, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LINK_UART, &config));
    ESP_ERROR_CHECK(uart_set_pin(LINK_UART, LINK_TX_GPIO, LINK_RX_GPIO,
                                UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
    if (xTaskCreate(uart_status_task, "uart_status", 3072, NULL, 5, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(uart_command_task, "uart_command", 3072, NULL, 6, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void uart_link_send_status(const char *state, const char *detail)
{
    char message[256];
    snprintf(message, sizeof(message),
             "{\"type\":\"status\",\"state\":\"%s\",\"detail\":\"%s\"}",
             state, detail != NULL ? detail : "");
    xSemaphoreTake(link_mutex, portMAX_DELAY);
    strlcpy(latest_status, message, sizeof(latest_status));
    if (strcmp(state, "wifi_connecting") == 0 ||
        strcmp(state, "wifi_connected") == 0) {
        provisioning_available = false;
    }
    xSemaphoreGive(link_mutex);
    uart_link_write_line(message);
}

void uart_link_send_provisioning(const char *ssid, const char *password,
                                 const char *setup_url)
{
    char message[384];
    snprintf(message, sizeof(message),
             "{\"type\":\"provisioning\",\"ssid\":\"%s\","
             "\"password\":\"%s\",\"url\":\"%s\","
             "\"qr\":\"WIFI:T:WPA;S:%s;P:%s;;\"}",
             ssid, password, setup_url, ssid, password);
    xSemaphoreTake(link_mutex, portMAX_DELAY);
    strlcpy(latest_provisioning, message, sizeof(latest_provisioning));
    provisioning_available = true;
    xSemaphoreGive(link_mutex);
    uart_link_write_line(message);
}

void uart_link_send_setup_url(const char *setup_url)
{
    char message[384];
    snprintf(message, sizeof(message),
             "{\"type\":\"provisioning\",\"stage\":\"open_setup\"," 
             "\"url\":\"%s\",\"qr\":\"%s\"}",
             setup_url, setup_url);
    xSemaphoreTake(link_mutex, portMAX_DELAY);
    strlcpy(latest_provisioning, message, sizeof(latest_provisioning));
    provisioning_available = true;
    xSemaphoreGive(link_mutex);
    uart_link_write_line(message);
}

void uart_link_send_device_info(const char *serial)
{
    char message[96];
    snprintf(message, sizeof(message),
             "{\"type\":\"device_info\",\"serial\":\"%s\"}", serial);
    uart_link_write_line(message);
}

void uart_link_send_pairing_state(const char *state, const char *email,
                                  const char *qr)
{
    char message[512];
    snprintf(message, sizeof(message),
             "{\"type\":\"pairing\",\"state\":\"%s\"," 
             "\"email\":\"%s\",\"qr\":\"%s\"}",
             state, email, qr);
    uart_link_write_line(message);
}

void uart_link_forward_server_message(const char *message)
{
    uart_link_write_line(message);
}
