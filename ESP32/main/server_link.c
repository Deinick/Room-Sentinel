#include "server_link.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_check.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/netdb.h"
#include "lwip/sockets.h"
#include "nvs.h"

#include "server_config.h"
#include "uart_link.h"

#define DEVICE_NAMESPACE "device"
#define SERIAL_KEY "serial"
#define SECRET_KEY "secret"
#define TOKEN_KEY "token"

static const char *TAG = "server_link";
static char device_serial[20];
static char device_secret[33];
static char device_token[193];
static volatile bool pairing_requested;

static esp_err_t load_or_create_identity(void)
{
    nvs_handle_t handle;
    ESP_RETURN_ON_ERROR(nvs_open(DEVICE_NAMESPACE, NVS_READWRITE, &handle),
                        TAG, "open device NVS");

    size_t serial_size = sizeof(device_serial);
    size_t secret_size = sizeof(device_secret);
    size_t token_size = sizeof(device_token);
    esp_err_t serial_result = nvs_get_str(handle, SERIAL_KEY, device_serial,
                                          &serial_size);
    esp_err_t secret_result = nvs_get_str(handle, SECRET_KEY, device_secret,
                                          &secret_size);
    if (nvs_get_str(handle, TOKEN_KEY, device_token, &token_size) != ESP_OK) {
        device_token[0] = '\0';
    }
    if (serial_result != ESP_OK || secret_result != ESP_OK) {
        uint32_t digits[4];
        uint8_t secret_bytes[16];
        for (size_t i = 0; i < 4; ++i) {
            digits[i] = esp_random() % 10000U;
        }
        snprintf(device_serial, sizeof(device_serial),
                 "%04lu-%04lu-%04lu-%04lu",
                 (unsigned long)digits[0], (unsigned long)digits[1],
                 (unsigned long)digits[2], (unsigned long)digits[3]);
        for (size_t i = 0; i < sizeof(secret_bytes); ++i) {
            secret_bytes[i] = (uint8_t)esp_random();
            snprintf(&device_secret[i * 2], 3, "%02x", secret_bytes[i]);
        }
        ESP_ERROR_CHECK(nvs_set_str(handle, SERIAL_KEY, device_serial));
        ESP_ERROR_CHECK(nvs_set_str(handle, SECRET_KEY, device_secret));
        ESP_ERROR_CHECK(nvs_commit(handle));
    }
    nvs_close(handle);
    uart_link_send_device_info(device_serial);
    ESP_LOGI(TAG, "Device serial: %s", device_serial);
    return ESP_OK;
}

static bool json_string_field(const char *json, const char *name,
                              char *value, size_t capacity)
{
    char pattern[48];
    snprintf(pattern, sizeof(pattern), "\"%s\":\"", name);
    const char *start = strstr(json, pattern);
    if (start == NULL || capacity == 0) return false;
    start += strlen(pattern);
    const char *end = strchr(start, '"');
    if (end == NULL) return false;
    size_t length = (size_t)(end - start);
    if (length >= capacity) length = capacity - 1;
    memcpy(value, start, length);
    value[length] = '\0';
    return true;
}

static void process_server_message(const char *message)
{
    if (strstr(message, "\"type\":\"pairing_success\"") != NULL) {
        char token[sizeof(device_token)];
        if (json_string_field(message, "device_token", token, sizeof(token))) {
            nvs_handle_t handle;
            if (nvs_open(DEVICE_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
                if (nvs_set_str(handle, TOKEN_KEY, token) == ESP_OK) {
                    nvs_commit(handle);
                    strlcpy(device_token, token, sizeof(device_token));
                }
                nvs_close(handle);
            }
        }
    }
    uart_link_forward_server_message(message);
}

static bool wifi_has_ip(void)
{
    esp_netif_t *station = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t info = {0};
    return station != NULL && esp_netif_get_ip_info(station, &info) == ESP_OK &&
           info.ip.addr != 0;
}

static int connect_server(void)
{
    char port[8];
    struct addrinfo hints = {.ai_family = AF_INET, .ai_socktype = SOCK_STREAM};
    struct addrinfo *addresses = NULL;
    snprintf(port, sizeof(port), "%d", STORM_SERVER_PORT);
    if (getaddrinfo(STORM_SERVER_HOST, port, &hints, &addresses) != 0 ||
        addresses == NULL) {
        return -1;
    }
    int socket_fd = socket(addresses->ai_family, addresses->ai_socktype,
                           addresses->ai_protocol);
    if (socket_fd >= 0 && connect(socket_fd, addresses->ai_addr,
                                  addresses->ai_addrlen) != 0) {
        close(socket_fd);
        socket_fd = -1;
    }
    freeaddrinfo(addresses);
    return socket_fd;
}

static bool send_line(int socket_fd, const char *message)
{
    size_t sent = 0;
    size_t length = strlen(message);
    while (sent < length) {
        int result = send(socket_fd, message + sent, length - sent, 0);
        if (result <= 0) return false;
        sent += (size_t)result;
    }
    return send(socket_fd, "\n", 1, 0) == 1;
}

static void server_task(void *argument)
{
    (void)argument;
    char auth[416];
    char receive_buffer[768];
    size_t receive_length = 0;

    for (;;) {
        while (!wifi_has_ip()) vTaskDelay(pdMS_TO_TICKS(1000));
        int socket_fd = connect_server();
        if (socket_fd < 0) {
            ESP_LOGW(TAG, "Server %s:%d unavailable", STORM_SERVER_HOST,
                     STORM_SERVER_PORT);
            vTaskDelay(pdMS_TO_TICKS(STORM_SERVER_RECONNECT_MS));
            continue;
        }
        ESP_LOGI(TAG, "Connected to %s:%d", STORM_SERVER_HOST,
                 STORM_SERVER_PORT);
        snprintf(auth, sizeof(auth),
                 "{\"type\":\"device_auth\",\"serial\":\"%s\"," 
                 "\"device_secret\":\"%s\",\"device_token\":\"%s\"}",
                 device_serial, device_secret, device_token);
        if (!send_line(socket_fd, auth)) {
            close(socket_fd);
            continue;
        }
        receive_length = 0;
        for (;;) {
            if (pairing_requested) {
                char request[96];
                snprintf(request, sizeof(request),
                         "{\"type\":\"pairing_start\",\"serial\":\"%s\"}",
                         device_serial);
                pairing_requested = false;
                if (!send_line(socket_fd, request)) break;
                uart_link_send_pairing_state("requesting", "", "");
            }

            struct timeval timeout = {.tv_sec = 0, .tv_usec = 200000};
            fd_set read_set;
            FD_ZERO(&read_set);
            FD_SET(socket_fd, &read_set);
            int ready = select(socket_fd + 1, &read_set, NULL, NULL, &timeout);
            if (ready < 0) break;
            if (ready == 0) continue;
            char chunk[128];
            int count = recv(socket_fd, chunk, sizeof(chunk), 0);
            if (count <= 0) break;
            for (int i = 0; i < count; ++i) {
                if (chunk[i] == '\n') {
                    receive_buffer[receive_length] = '\0';
                    process_server_message(receive_buffer);
                    receive_length = 0;
                } else if (chunk[i] != '\r' &&
                           receive_length < sizeof(receive_buffer) - 1) {
                    receive_buffer[receive_length++] = chunk[i];
                }
            }
        }
        close(socket_fd);
        uart_link_send_pairing_state("server_offline", "", "");
        vTaskDelay(pdMS_TO_TICKS(STORM_SERVER_RECONNECT_MS));
    }
}

esp_err_t server_link_init(void)
{
    ESP_RETURN_ON_ERROR(load_or_create_identity(), TAG, "device identity");
    return xTaskCreate(server_task, "server_link", 6144, NULL, 5, NULL) == pdPASS
               ? ESP_OK : ESP_ERR_NO_MEM;
}

void server_link_request_pairing(void)
{
    pairing_requested = true;
}

void server_link_clear_account(void)
{
    nvs_handle_t handle;
    if (nvs_open(DEVICE_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_key(handle, TOKEN_KEY);
        nvs_commit(handle);
        nvs_close(handle);
    }
    device_token[0] = '\0';
}

