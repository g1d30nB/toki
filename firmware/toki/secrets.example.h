// The old way to give Toki its Wi-Fi, kept as a fallback for builds made on this
// Mac. The new way needs no file at all: flash Toki, then run the Wi-Fi setup over
// USB (uv run --with pyserial bridge/tools/toki-wifi.py), which saves the Wi-Fi on
// Toki itself (Phase 7). If you do use this: copy it to secrets.h (git ignores
// secrets.h) and fill it in. Wi-Fi must be 2.4 GHz.
#pragma once
#define TOKI_WIFI_SSID "your-wifi-name"
#define TOKI_WIFI_PASS "your-wifi-password"
#define TOKI_LINK_SECRET "replace-with-a-long-random-string"
