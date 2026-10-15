// Toki's Wi-Fi link to the bridge on the Mac (Phase 4, step 3). Toki listens on
// toki.local:7152; the bridge dials in and must present the shared link secret
// before anything flows. The Wi-Fi and secret are saved on the robot over USB
// (Phase 7); secrets.h is a fallback for builds made on this Mac. One bridge at
// a time: a new connection replaces the old one (the bridge restarted).
//
// Without either, Toki still runs, Bluetooth only.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

namespace net {
void begin();
/** Call every loop: joins Wi-Fi, accepts the bridge, reads its lines, flushes ours. */
void loop(uint32_t now);
bool wifiUp();
bool bridgeUp();
/** Queues "<tag> <line>" for the bridge; never blocks. Dropped if the bridge isn't there or is backed up. */
void send(const char* tag, const char* line);
/** A complete line from the bridge, if one has arrived. */
bool readLine(String& out);

// Wi-Fi setup over USB (Phase 7): the Mac's setup tool sends these.
/** Saves the Wi-Fi and link secret on the robot and joins at once. False if they can't be right (lengths). */
bool provision(const char* ssid, const char* pass, const char* secret);
/** Saves a new link secret, keeping the Wi-Fi (a new Mac, or a lost secret file). False if too short or long. */
bool setSecret(const char* secret);
/** Clears the saved Wi-Fi (takes effect on the next restart). */
void forget();
/** For Toki's setup screens: the last Wi-Fi attempt ("none", "trying", "saved", "no-network", "refused", "timeout"), when it ended, and the network tried. */
const char* setupResult();
uint32_t setupResultAt();
const char* triedSsid();
/** Toki has Wi-Fi details (saved, or built into a dev build). */
bool configured();
/** Where the Wi-Fi came from, its name, whether it's up and why not. Never the password or secret. */
void status(JsonObject out);
}  // namespace net
