#pragma once

#include "esp_err.h"

esp_err_t uart_link_init(void);
void uart_link_send_status(const char *state, const char *detail);
void uart_link_send_server_status(const char *state, const char *detail);
void uart_link_send_provisioning(const char *ssid, const char *password,
                                 const char *setup_url);
void uart_link_send_setup_url(const char *setup_url);
void uart_link_send_device_info(const char *serial);
void uart_link_send_pairing_state(const char *state, const char *email,
                                  const char *qr);
void uart_link_forward_server_message(const char *message);
