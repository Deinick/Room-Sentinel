#include "wifi_provisioning.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_event.h"
#include "esp_check.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "lwip/inet.h"
#include "lwip/sockets.h"
#include "nvs.h"

#include "uart_link.h"
#include "server_link.h"

#define WIFI_NAMESPACE "wifi"
#define WIFI_SSID_KEY "ssid"
#define WIFI_PASSWORD_KEY "password"
#define PROVISIONING_URL "http://192.168.4.1/"
#define WIFI_RECONNECT_INTERVAL_MS 30000
#define DHCPS_OFFER_DNS 0x02

static const char *TAG = "provisioning";
static httpd_handle_t http_server;
static TimerHandle_t station_reconnect_timer;

static void reconnect_timer_callback(TimerHandle_t timer)
{
    (void)timer;
    ESP_LOGI(TAG, "Retrying saved Wi-Fi network");
    esp_err_t result = esp_wifi_connect();
    if (result != ESP_OK) {
        ESP_LOGW(TAG, "Wi-Fi reconnect request failed: %s",
                 esp_err_to_name(result));
        if (station_reconnect_timer != NULL) {
            (void)xTimerReset(station_reconnect_timer, 0);
        }
    }
}

static void clear_credentials(void)
{
    nvs_handle_t handle;
    if (nvs_open(WIFI_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_key(handle, WIFI_SSID_KEY);
        nvs_erase_key(handle, WIFI_PASSWORD_KEY);
        nvs_commit(handle);
        nvs_close(handle);
    }
}

static const char setup_page_head[] =
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>StormHacks setup</title><style>body{font-family:sans-serif;"
    "max-width:420px;margin:40px auto;padding:20px}input,button{width:100%;"
    "box-sizing:border-box;padding:12px;margin:8px 0}button{font-weight:bold}"
    "</style></head><body><h1>Wi-Fi setup</h1>"
    "<form method='post' action='/configure'><label>Network name</label>"
    "<input name='ssid' list='networks' maxlength='32' required>"
    "<datalist id='networks'>";

static const char setup_page_tail[] =
    "</datalist><label>Password</label>"
    "<input name='password' type='password' maxlength='64'>"
    "<button type='submit'>Connect</button></form></body></html>";

static void dns_captive_task(void *argument)
{
    uint8_t packet[512];
    int server = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    struct sockaddr_in address = {
        .sin_family = AF_INET,
        .sin_port = htons(53),
        .sin_addr.s_addr = htonl(INADDR_ANY),
    };
    (void)argument;
    if (server < 0 || bind(server, (struct sockaddr *)&address,
                           sizeof(address)) != 0) {
        ESP_LOGE(TAG, "Could not start captive DNS server");
        if (server >= 0) close(server);
        vTaskDelete(NULL);
        return;
    }

    for (;;) {
        struct sockaddr_in client;
        socklen_t client_length = sizeof(client);
        int length = recvfrom(server, packet, sizeof(packet) - 16, 0,
                              (struct sockaddr *)&client, &client_length);
        if (length < 12) continue;
        int question_end = 12;
        while (question_end < length && packet[question_end] != 0) {
            question_end += packet[question_end] + 1;
        }
        question_end += 5; /* zero label, QTYPE and QCLASS */
        if (question_end > length || question_end + 16 > (int)sizeof(packet)) {
            continue;
        }
        packet[2] = 0x81; packet[3] = 0x80;
        packet[6] = 0; packet[7] = 1;
        packet[8] = packet[9] = packet[10] = packet[11] = 0;
        uint8_t answer[] = {
            0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01, 0, 0, 0, 30,
            0x00, 0x04, 192, 168, 4, 1};
        memcpy(packet + question_end, answer, sizeof(answer));
        sendto(server, packet, question_end + sizeof(answer), 0,
               (struct sockaddr *)&client, client_length);
    }
}

static void url_decode(char *destination, const char *source, size_t capacity)
{
    size_t output = 0;
    while (*source != '\0' && output + 1 < capacity) {
        if (*source == '+' ) {
            destination[output++] = ' ';
            source++;
        } else if (*source == '%' && isxdigit((unsigned char)source[1]) &&
                   isxdigit((unsigned char)source[2])) {
            char hex[3] = {source[1], source[2], '\0'};
            destination[output++] = (char)strtol(hex, NULL, 16);
            source += 3;
        } else {
            destination[output++] = *source++;
        }
    }
    destination[output] = '\0';
}

static bool form_value(const char *body, const char *name, char *value,
                       size_t value_capacity)
{
    char key[32];
    snprintf(key, sizeof(key), "%s=", name);
    const char *start = strstr(body, key);
    if (start == NULL) {
        return false;
    }
    start += strlen(key);
    const char *end = strchr(start, '&');
    size_t encoded_length = end != NULL ? (size_t)(end - start) : strlen(start);
    char encoded[128];
    if (encoded_length >= sizeof(encoded)) {
        return false;
    }
    memcpy(encoded, start, encoded_length);
    encoded[encoded_length] = '\0';
    url_decode(value, encoded, value_capacity);
    return true;
}

static esp_err_t save_credentials(const char *ssid, const char *password)
{
    nvs_handle_t handle;
    ESP_RETURN_ON_ERROR(nvs_open(WIFI_NAMESPACE, NVS_READWRITE, &handle),
                        TAG, "open NVS");
    esp_err_t result = nvs_set_str(handle, WIFI_SSID_KEY, ssid);
    if (result == ESP_OK) {
        result = nvs_set_str(handle, WIFI_PASSWORD_KEY, password);
    }
    if (result == ESP_OK) {
        result = nvs_commit(handle);
    }
    nvs_close(handle);
    return result;
}

static esp_err_t root_handler(httpd_req_t *request)
{
    httpd_resp_set_type(request, "text/html; charset=utf-8");
    httpd_resp_sendstr_chunk(request, setup_page_head);

    wifi_ap_record_t networks[16];
    uint16_t network_count = 16;
    memset(networks, 0, sizeof(networks));
    if (esp_wifi_scan_start(NULL, true) == ESP_OK &&
        esp_wifi_scan_get_ap_records(&network_count, networks) == ESP_OK) {
        for (uint16_t i = 0; i < network_count; i++) {
            char option[160];
            snprintf(option, sizeof(option), "<option value='%s'>%s (%d dBm)</option>",
                     (const char *)networks[i].ssid,
                     (const char *)networks[i].ssid, networks[i].rssi);
            httpd_resp_sendstr_chunk(request, option);
        }
    }
    httpd_resp_sendstr_chunk(request, setup_page_tail);
    return httpd_resp_sendstr_chunk(request, NULL);
}

static esp_err_t configure_handler(httpd_req_t *request)
{
    if (request->content_len <= 0 || request->content_len >= 256) {
        return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST,
                                   "Invalid request");
    }

    char body[256];
    int received = httpd_req_recv(request, body, request->content_len);
    if (received <= 0) {
        return ESP_FAIL;
    }
    body[received] = '\0';

    char ssid[33] = {0};
    char password[65] = {0};
    if (!form_value(body, "ssid", ssid, sizeof(ssid)) || ssid[0] == '\0' ||
        !form_value(body, "password", password, sizeof(password))) {
        return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST,
                                   "SSID or password missing");
    }

    ESP_RETURN_ON_ERROR(save_credentials(ssid, password), TAG,
                        "save credentials");
    uart_link_send_status("credentials_saved", ssid);
    httpd_resp_sendstr(request,
                       "Wi-Fi settings saved. The controller is restarting.");
    vTaskDelay(pdMS_TO_TICKS(700));
    esp_restart();
    return ESP_OK;
}

static esp_err_t start_http_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.uri_match_fn = httpd_uri_match_wildcard;
    ESP_RETURN_ON_ERROR(httpd_start(&http_server, &config), TAG,
                        "start HTTP server");
    const httpd_uri_t root = {
        .uri = "/", .method = HTTP_GET, .handler = root_handler};
    const httpd_uri_t configure = {
        .uri = "/configure", .method = HTTP_POST,
        .handler = configure_handler};
    const httpd_uri_t captive = {
        .uri = "/*", .method = HTTP_GET, .handler = root_handler};
    ESP_ERROR_CHECK(httpd_register_uri_handler(http_server, &root));
    ESP_ERROR_CHECK(httpd_register_uri_handler(http_server, &configure));
    ESP_ERROR_CHECK(httpd_register_uri_handler(http_server, &captive));
    return ESP_OK;
}

static void wifi_event_handler(void *argument, esp_event_base_t base,
                               int32_t event_id, void *event_data)
{
    if (base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        uart_link_send_status("disconnected", "retrying in 30 seconds");
        uart_link_send_runtime_info("--", 0);
        ESP_LOGW(TAG, "Wi-Fi disconnected; keeping saved credentials");
        if (station_reconnect_timer != NULL &&
            xTimerReset(station_reconnect_timer, 0) != pdPASS) {
            ESP_LOGE(TAG, "Could not schedule Wi-Fi reconnect");
        }
    } else if (base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *got_ip = (ip_event_got_ip_t *)event_data;
        char ip_address[16];
        snprintf(ip_address, sizeof(ip_address), IPSTR,
                 IP2STR(&got_ip->ip_info.ip));
        wifi_ap_record_t access_point = {0};
        int rssi = 0;
        if (esp_wifi_sta_get_ap_info(&access_point) == ESP_OK) {
            rssi = access_point.rssi;
        }
        if (station_reconnect_timer != NULL) {
            (void)xTimerStop(station_reconnect_timer, 0);
        }
        uart_link_send_status("wifi_connected", "");
        uart_link_send_runtime_info(ip_address, rssi);
    } else if (base == WIFI_EVENT &&
               event_id == WIFI_EVENT_AP_STACONNECTED) {
        ESP_LOGI(TAG, "Phone connected to setup access point");
        uart_link_send_setup_url(PROVISIONING_URL);
    }
}

bool wifi_provisioning_has_credentials(void)
{
    nvs_handle_t handle;
    if (nvs_open(WIFI_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) {
        return false;
    }
    size_t ssid_length = 0;
    bool available = nvs_get_str(handle, WIFI_SSID_KEY, NULL,
                                 &ssid_length) == ESP_OK && ssid_length > 1;
    nvs_close(handle);
    return available;
}

esp_err_t wifi_provisioning_connect_saved(void)
{
    char ssid[33] = {0};
    char password[65] = {0};
    size_t ssid_length = sizeof(ssid);
    size_t password_length = sizeof(password);
    nvs_handle_t handle;
    ESP_RETURN_ON_ERROR(nvs_open(WIFI_NAMESPACE, NVS_READONLY, &handle),
                        TAG, "open NVS");
    esp_err_t result = nvs_get_str(handle, WIFI_SSID_KEY, ssid, &ssid_length);
    if (result == ESP_OK) {
        result = nvs_get_str(handle, WIFI_PASSWORD_KEY, password,
                             &password_length);
    }
    nvs_close(handle);
    ESP_RETURN_ON_ERROR(result, TAG, "read credentials");

    wifi_init_config_t init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_config));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                               wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                               wifi_event_handler, NULL));
    station_reconnect_timer = xTimerCreate(
        "wifi_reconnect", pdMS_TO_TICKS(WIFI_RECONNECT_INTERVAL_MS),
        pdFALSE, NULL, reconnect_timer_callback);
    if (station_reconnect_timer == NULL) {
        return ESP_ERR_NO_MEM;
    }
    wifi_config_t station_config = {0};
    strlcpy((char *)station_config.sta.ssid, ssid,
            sizeof(station_config.sta.ssid));
    strlcpy((char *)station_config.sta.password, password,
            sizeof(station_config.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &station_config));
    uart_link_send_status("wifi_connecting", ssid);
    return esp_wifi_start();
}

esp_err_t wifi_provisioning_start(esp_netif_t *ap_netif)
{
    if (ap_netif == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    char ssid[33];
    char password[16];
    snprintf(ssid, sizeof(ssid), "StormHacks-%02X%02X", mac[4], mac[5]);
    snprintf(password, sizeof(password), "setup-%08lx",
             (unsigned long)esp_random());

    wifi_init_config_t init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_config));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                               wifi_event_handler, NULL));
    wifi_config_t access_point = {0};
    strlcpy((char *)access_point.ap.ssid, ssid,
            sizeof(access_point.ap.ssid));
    strlcpy((char *)access_point.ap.password, password,
            sizeof(access_point.ap.password));
    access_point.ap.ssid_len = strlen(ssid);
    access_point.ap.channel = 1;
    access_point.ap.max_connection = 4;
    access_point.ap.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &access_point));

    esp_err_t dhcp_result = esp_netif_dhcps_stop(ap_netif);
    if (dhcp_result != ESP_OK &&
        dhcp_result != ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED) {
        return dhcp_result;
    }
    uint8_t offer_dns = DHCPS_OFFER_DNS;
    ESP_ERROR_CHECK(esp_netif_dhcps_option(
        ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER,
        &offer_dns, sizeof(offer_dns)));
    esp_netif_dns_info_t dns = {
        .ip = ESP_IP4ADDR_INIT(192, 168, 4, 1),
    };
    ESP_ERROR_CHECK(esp_netif_set_dns_info(
        ap_netif, ESP_NETIF_DNS_MAIN, &dns));
    ESP_ERROR_CHECK(esp_netif_dhcps_option(
        ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI,
        (void *)PROVISIONING_URL, strlen(PROVISIONING_URL)));
    ESP_ERROR_CHECK(esp_netif_dhcps_start(ap_netif));

    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(start_http_server());
    if (xTaskCreate(dns_captive_task, "captive_dns", 3072, NULL, 4, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    uart_link_send_provisioning(ssid, password, PROVISIONING_URL);
    uart_link_send_status("setup_ready", PROVISIONING_URL);
    return ESP_OK;
}

void wifi_provisioning_request_setup(void)
{
    uart_link_send_status("restarting_setup", "");
    clear_credentials();
    vTaskDelay(pdMS_TO_TICKS(150));
    esp_restart();
}

void wifi_provisioning_retry_now(void)
{
    wifi_ap_record_t access_point = {0};
    if (esp_wifi_sta_get_ap_info(&access_point) == ESP_OK) {
        uart_link_send_status("wifi_connected", "already connected");
        return;
    }
    if (station_reconnect_timer != NULL) {
        (void)xTimerStop(station_reconnect_timer, 0);
    }
    uart_link_send_status("wifi_connecting", "manual retry");
    esp_err_t result = esp_wifi_connect();
    if (result != ESP_OK) {
        uart_link_send_status("disconnected", "retrying in 30 seconds");
        if (station_reconnect_timer != NULL) {
            (void)xTimerReset(station_reconnect_timer, 0);
        }
    }
}

void wifi_provisioning_forget_network(void)
{
    uart_link_send_status("network_forgotten", "starting setup");
    clear_credentials();
    vTaskDelay(pdMS_TO_TICKS(150));
    esp_restart();
}

void wifi_provisioning_factory_reset(void)
{
    uart_link_send_status("factory_reset", "");
    server_link_clear_account();
    clear_credentials();
    vTaskDelay(pdMS_TO_TICKS(150));
    esp_restart();
}
