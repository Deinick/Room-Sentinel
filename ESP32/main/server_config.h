#pragma once

#define STORM_SERVER_HTTPS_BASE "https://stormhacks.onrender.com"
#define STORM_PAIRING_URL STORM_SERVER_HTTPS_BASE "/devices/pairing"
#define STORM_STREAM_URL "wss://stormhacks.onrender.com/devices/stream"

#define STORM_SERVER_RECONNECT_MS 5000
#define STORM_PAIRING_POLL_MS 3000
#define STORM_HTTP_TIMEOUT_MS 15000

/* Keep credentials out of production logs. Enable only for local diagnostics. */
#define STORM_LOG_PROVISIONING_SECRET 0
