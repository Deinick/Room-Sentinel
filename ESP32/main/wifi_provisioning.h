#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "esp_netif.h"

esp_err_t wifi_provisioning_start(esp_netif_t *ap_netif);
bool wifi_provisioning_has_credentials(void);
esp_err_t wifi_provisioning_connect_saved(void);
void wifi_provisioning_request_setup(void);
void wifi_provisioning_factory_reset(void);
