idf_component_register(
    SRCS
        "app_main.c"
        "server_link.c"
        "uart_link.c"
        "wifi_provisioning.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_event
        esp_http_server
        esp_netif
        esp_wifi
        nvs_flash
        esp_driver_uart
)
