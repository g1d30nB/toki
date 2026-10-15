// Toki's settings (Phase 7, spec §10.4). Kept on the robot in NVS (namespace
// "toki"), so they survive flashing just as the Bluetooth pairing does. A value
// that was never set falls back to its default here, so a fresh robot behaves
// exactly as before. The bridge reads and changes them over Wi-Fi:
//   bridge → Toki  {"settings": {"brightness": 90}}   (any subset; {} just asks)
//   Toki → bridge  @@ {"settings": {"brightness": 90, "rollover": 2, "label": 2}}
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

namespace settings {

struct Values {
  uint8_t brightness = 140;  // screen backlight, 20..255 (below 20 the face is hard to see)
  uint8_t rollover = 2;      // the hour (0..6) a new day starts: late nights belong to the day before
  uint8_t label = 2;         // under the face: 0 off, 1 words (READING), 2 detail (READING · render.ts)
};

/** Loads the saved values (call once in setup). */
void begin();
const Values& get();
/**
 * Applies the fields present in `patch`, clamped to their ranges. Returns true if
 * anything changed. Changes are saved after 2 s without another change, so
 * dragging a slider doesn't wear the flash.
 */
bool apply(JsonObjectConst patch, uint32_t now);
/** Saves pending changes once things have been quiet for 2 s. Call every loop. */
void loop(uint32_t now);
void toJson(JsonObject out);

}  // namespace settings
