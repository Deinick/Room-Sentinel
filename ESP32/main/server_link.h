#pragma once

#include "esp_err.h"

esp_err_t server_link_init(void);
void server_link_request_pairing(void);
void server_link_clear_account(void);
void server_link_send_telemetry(const char *message);

