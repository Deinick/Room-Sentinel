#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi_default.h"
#include "nvs_flash.h"

#include "uart_link.h"
#include "server_link.h"
#include "wifi_provisioning.h"

static const char *TAG = "room-sentinel";

void app_main(void)
{
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES ||
        result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(result);
    }

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(uart_link_init());
    ESP_ERROR_CHECK(server_link_init());

    if (wifi_provisioning_has_credentials()) {
        ESP_LOGI(TAG, "Connecting with stored Wi-Fi credentials");
        ESP_ERROR_CHECK(esp_netif_create_default_wifi_sta() != NULL
                            ? ESP_OK : ESP_FAIL);
        ESP_ERROR_CHECK(wifi_provisioning_connect_saved());
    } else {
        ESP_LOGI(TAG, "Starting provisioning access point");
        esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap();
        ESP_ERROR_CHECK(ap_netif != NULL ? ESP_OK : ESP_FAIL);
        ESP_ERROR_CHECK(wifi_provisioning_start(ap_netif));
    }
}
