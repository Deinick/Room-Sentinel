#include "server_link.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_check.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs.h"

#include "server_config.h"
#include "uart_link.h"

#define DEVICE_NAMESPACE "device"
#define SERIAL_KEY "serial"
#define SECRET_KEY "secret"
#define TOKEN_KEY "token"
#define HTTP_RESPONSE_MAX 768

static const char *TAG = "server_link";
static char device_serial[20];
static char device_secret[33];
static char device_token[193];
static volatile bool pairing_requested;
static volatile bool websocket_connected;

typedef struct { char json[320]; } telemetry_message_t;
typedef struct { char data[HTTP_RESPONSE_MAX]; size_t length; } http_response_t;

static QueueHandle_t telemetry_queue;
static esp_websocket_client_handle_t websocket_client;

static esp_err_t save_device_token(const char *token)
{
    nvs_handle_t handle;
    ESP_RETURN_ON_ERROR(nvs_open(DEVICE_NAMESPACE, NVS_READWRITE, &handle),
                        TAG, "open device NVS");
    esp_err_t result = nvs_set_str(handle, TOKEN_KEY, token);
    if (result == ESP_OK) result = nvs_commit(handle);
    nvs_close(handle);
    if (result == ESP_OK) strlcpy(device_token, token, sizeof(device_token));
    return result;
}

static esp_err_t load_or_create_identity(void)
{
    nvs_handle_t handle;
    ESP_RETURN_ON_ERROR(nvs_open(DEVICE_NAMESPACE, NVS_READWRITE, &handle),
                        TAG, "open device NVS");
    size_t serial_size = sizeof(device_serial);
    size_t secret_size = sizeof(device_secret);
    size_t token_size = sizeof(device_token);
    esp_err_t serial_result = nvs_get_str(handle, SERIAL_KEY, device_serial, &serial_size);
    esp_err_t secret_result = nvs_get_str(handle, SECRET_KEY, device_secret, &secret_size);
    if (nvs_get_str(handle, TOKEN_KEY, device_token, &token_size) != ESP_OK) device_token[0] = '\0';
    if (serial_result != ESP_OK || secret_result != ESP_OK) {
        uint32_t digits[4];
        uint8_t secret_bytes[16];
        for (size_t i = 0; i < 4; ++i) digits[i] = esp_random() % 10000U;
        snprintf(device_serial, sizeof(device_serial), "%04lu-%04lu-%04lu-%04lu",
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
#if STORM_LOG_PROVISIONING_SECRET
    ESP_LOGW(TAG, "Diagnostic device credentials: serial=%s secret=%s",
             device_serial, device_secret);
#endif
    uart_link_send_server_status(device_token[0] != '\0' ? "connecting" : "unpaired",
                                 "");
    return ESP_OK;
}

static esp_err_t http_event_handler(esp_http_client_event_t *event)
{
    if (event->event_id != HTTP_EVENT_ON_DATA || event->user_data == NULL ||
        event->data == NULL || event->data_len <= 0) return ESP_OK;
    http_response_t *response = event->user_data;
    size_t available = sizeof(response->data) - response->length - 1;
    size_t count = (size_t)event->data_len < available ? (size_t)event->data_len : available;
    memcpy(response->data + response->length, event->data, count);
    response->length += count;
    response->data[response->length] = '\0';
    return ESP_OK;
}

static int post_credentials(const char *url, http_response_t *response)
{
    char body[160];
    snprintf(body, sizeof(body), "{\"device_id\":\"%s\",\"secret\":\"%s\"}",
             device_serial, device_secret);
    memset(response, 0, sizeof(*response));
    esp_http_client_config_t config = {
        .url = url, .event_handler = http_event_handler, .user_data = response,
        .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = STORM_HTTP_TIMEOUT_MS,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) return -1;
    esp_http_client_set_method(client, HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, (int)strlen(body));
    esp_err_t result = esp_http_client_perform(client);
    int status = result == ESP_OK ? esp_http_client_get_status_code(client) : -1;
    if (result != ESP_OK) ESP_LOGW(TAG, "HTTPS POST failed: %s", esp_err_to_name(result));
    esp_http_client_cleanup(client);
    return status;
}

static bool copy_json_string(cJSON *root, const char *name, char *value, size_t capacity)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, name);
    if (!cJSON_IsString(item) || item->valuestring == NULL) return false;
    strlcpy(value, item->valuestring, capacity);
    return true;
}

static bool start_pairing(char *code, size_t capacity)
{
    http_response_t response;
    int status = post_credentials(STORM_PAIRING_URL, &response);
    if (status != 201) {
        ESP_LOGW(TAG, "Start pairing HTTP %d: %s", status, response.data);
        uart_link_send_pairing_state(status == 401 ? "failed" : "server_offline", "", "");
        uart_link_send_server_status(status == 401 ? "identity_rejected" : "offline",
                                     "pairing request failed");
        return false;
    }
    cJSON *root = cJSON_Parse(response.data);
    char pairing_url[256] = {0};
    bool ok = root != NULL && copy_json_string(root, "code", code, capacity) &&
              copy_json_string(root, "pairing_url", pairing_url, sizeof(pairing_url));
    cJSON_Delete(root);
    if (!ok) return false;
    char message[512];
    snprintf(message, sizeof(message),
             "{\"type\":\"pairing_created\",\"pairing_url\":\"%s\"}", pairing_url);
    uart_link_forward_server_message(message);
    uart_link_send_server_status("pairing", "waiting for confirmation");
    return true;
}

/* Returns 1 when paired, 0 while pending, -1 when this session is dead. */
static int poll_pairing_token(const char *code)
{
    char url[256];
    snprintf(url, sizeof(url), "%s/devices/pairing/%s/token", STORM_SERVER_HTTPS_BASE, code);
    http_response_t response;
    int status = post_credentials(url, &response);
    if (status == 202 || status < 0 || status >= 500) return 0;
    if (status != 200) {
        ESP_LOGW(TAG, "Claim token HTTP %d: %s", status, response.data);
        uart_link_forward_server_message(
            "{\"type\":\"pairing_failed\",\"reason\":\"expired\"}");
        uart_link_send_server_status("unpaired", "pairing expired");
        return -1;
    }
    cJSON *root = cJSON_Parse(response.data);
    char token[sizeof(device_token)] = {0};
    bool ok = root != NULL && copy_json_string(root, "device_token", token, sizeof(token));
    cJSON_Delete(root);
    if (!ok || save_device_token(token) != ESP_OK) return -1;
    uart_link_forward_server_message(
        "{\"type\":\"pairing_success\"}");
    uart_link_send_server_status("connecting", "account linked");
    return 1;
}

static void websocket_event_handler(void *arg, esp_event_base_t base,
                                    int32_t event_id, void *event_data)
{
    (void)arg; (void)base;
    esp_websocket_event_data_t *data = event_data;
    if (event_id == WEBSOCKET_EVENT_CONNECTED) {
        websocket_connected = true;
        uart_link_send_server_status("connected", "secure stream online");
        ESP_LOGI(TAG, "WebSocket connected");
    } else if (event_id == WEBSOCKET_EVENT_DISCONNECTED) {
        websocket_connected = false;
        uart_link_send_server_status("disconnected", "reconnecting");
        ESP_LOGW(TAG, "WebSocket disconnected");
    } else if (event_id == WEBSOCKET_EVENT_DATA && data != NULL && data->op_code == 0x1 &&
               data->payload_offset == 0 && data->data_len == data->payload_len &&
               data->data_len > 0 && data->data_len < HTTP_RESPONSE_MAX) {
        char message[HTTP_RESPONSE_MAX];
        memcpy(message, data->data_ptr, (size_t)data->data_len);
        message[data->data_len] = '\0';
        ESP_LOGI(TAG, "WS RX: %s", message);
        uart_link_forward_server_message(message);
    }
}

static bool start_websocket(void)
{
    char headers[256];
    snprintf(headers, sizeof(headers), "Authorization: Bearer %s\r\n", device_token);
    esp_websocket_client_config_t config = {
        .uri = STORM_STREAM_URL, .headers = headers,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .network_timeout_ms = STORM_HTTP_TIMEOUT_MS,
        .reconnect_timeout_ms = STORM_SERVER_RECONNECT_MS,
    };
    websocket_client = esp_websocket_client_init(&config);
    if (websocket_client == NULL) return false;
    ESP_ERROR_CHECK(esp_websocket_register_events(
        websocket_client, WEBSOCKET_EVENT_ANY, websocket_event_handler, NULL));
    if (esp_websocket_client_start(websocket_client) != ESP_OK) {
        esp_websocket_client_destroy(websocket_client);
        websocket_client = NULL;
        return false;
    }
    return true;
}

static void stop_websocket(void)
{
    websocket_connected = false;
    if (websocket_client == NULL) return;
    esp_websocket_client_stop(websocket_client);
    esp_websocket_client_destroy(websocket_client);
    websocket_client = NULL;
}

static char *make_telemetry_frame(const char *message)
{
    cJSON *source = cJSON_Parse(message);
    cJSON *frame = cJSON_CreateObject();
    cJSON *temps = cJSON_CreateObject();
    if (source == NULL || frame == NULL || temps == NULL) {
        cJSON_Delete(source); cJSON_Delete(frame); cJSON_Delete(temps); return NULL;
    }
    cJSON_AddStringToObject(frame, "serial", device_serial);
    cJSON *sequence = cJSON_GetObjectItemCaseSensitive(source, "sequence");
    cJSON *uptime = cJSON_GetObjectItemCaseSensitive(source, "uptime_ms");
    cJSON_AddNumberToObject(frame, "seq", cJSON_IsNumber(sequence) ? sequence->valuedouble : 0);
    cJSON_AddNumberToObject(frame, "uptime_ms", cJSON_IsNumber(uptime) ? uptime->valuedouble : 0);
    static const char *names[] = {"Centre", "Window", "Heater", "Door", "Far wall"};
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); ++i) {
        cJSON *value = cJSON_GetObjectItemCaseSensitive(source, names[i]);
        if (cJSON_IsNumber(value)) cJSON_AddNumberToObject(temps, names[i], value->valuedouble);
        else cJSON_AddNullToObject(temps, names[i]);
    }
    cJSON_AddItemToObject(frame, "temps", temps);
    char *result = cJSON_PrintUnformatted(frame);
    cJSON_Delete(frame); cJSON_Delete(source);
    return result;
}

static void stream_telemetry(void)
{
    telemetry_message_t telemetry;
    if (!websocket_connected || websocket_client == NULL ||
        xQueueReceive(telemetry_queue, &telemetry, 0) != pdTRUE) return;
    char *frame = make_telemetry_frame(telemetry.json);
    if (frame == NULL) return;
    int result = esp_websocket_client_send_text(websocket_client, frame,
                                                (int)strlen(frame), pdMS_TO_TICKS(2000));
    if (result < 0) ESP_LOGW(TAG, "Failed to send telemetry frame");
    else ESP_LOGI(TAG, "WS TX: %s", frame);
    cJSON_free(frame);
}

static void server_task(void *argument)
{
    (void)argument;
    char pairing_code[64] = {0};
    TickType_t next_poll = 0;
    for (;;) {
        if (pairing_requested && pairing_code[0] == '\0') {
            stop_websocket();
            uart_link_send_pairing_state("requesting", "", "");
            if (start_pairing(pairing_code, sizeof(pairing_code))) next_poll = xTaskGetTickCount();
            else vTaskDelay(pdMS_TO_TICKS(STORM_SERVER_RECONNECT_MS));
        }
        if (pairing_code[0] != '\0' && (int32_t)(xTaskGetTickCount() - next_poll) >= 0) {
            int result = poll_pairing_token(pairing_code);
            if (result != 0) {
                pairing_code[0] = '\0';
                pairing_requested = false;
            }
            next_poll = xTaskGetTickCount() + pdMS_TO_TICKS(STORM_PAIRING_POLL_MS);
        }
        if (device_token[0] != '\0' && pairing_code[0] == '\0' && websocket_client == NULL) {
            if (!start_websocket()) vTaskDelay(pdMS_TO_TICKS(STORM_SERVER_RECONNECT_MS));
        }
        stream_telemetry();
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

esp_err_t server_link_init(void)
{
    ESP_RETURN_ON_ERROR(load_or_create_identity(), TAG, "device identity");
    telemetry_queue = xQueueCreate(1, sizeof(telemetry_message_t));
    if (telemetry_queue == NULL) return ESP_ERR_NO_MEM;
    return xTaskCreate(server_task, "server_link", 9216, NULL, 5, NULL) == pdPASS
               ? ESP_OK : ESP_ERR_NO_MEM;
}

void server_link_request_pairing(void) { pairing_requested = true; }

void server_link_clear_account(void)
{
    stop_websocket();
    nvs_handle_t handle;
    if (nvs_open(DEVICE_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_key(handle, TOKEN_KEY); nvs_commit(handle); nvs_close(handle);
    }
    device_token[0] = '\0';
    pairing_requested = false;
    uart_link_send_server_status("unpaired", "account cleared");
}

void server_link_send_telemetry(const char *message)
{
    if (telemetry_queue == NULL || message == NULL) return;
    telemetry_message_t telemetry = {0};
    strlcpy(telemetry.json, message, sizeof(telemetry.json));
    xQueueOverwrite(telemetry_queue, &telemetry);
}
