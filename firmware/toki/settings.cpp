#include "settings.h"

#include <Preferences.h>

namespace settings {
namespace {
Values values;
bool dirty = false;
uint32_t changedAt = 0;
constexpr uint32_t kSaveAfterMs = 2000;
}  // namespace

void begin() {
  Preferences p;
  if (!p.begin("toki", true)) return;  // nothing saved yet: defaults
  values.brightness = p.getUChar("brightness", values.brightness);
  values.rollover = p.getUChar("rollover", values.rollover);
  values.label = p.getUChar("label", values.label);
  p.end();
}

const Values& get() { return values; }

bool apply(JsonObjectConst patch, uint32_t now) {
  const Values before = values;
  if (patch["brightness"].is<int>()) values.brightness = constrain(patch["brightness"].as<int>(), 20, 255);
  if (patch["rollover"].is<int>()) values.rollover = constrain(patch["rollover"].as<int>(), 0, 6);
  if (patch["label"].is<int>()) values.label = constrain(patch["label"].as<int>(), 0, 2);
  const bool changed = values.brightness != before.brightness || values.rollover != before.rollover || values.label != before.label;
  if (changed) {
    dirty = true;
    changedAt = now;
  }
  return changed;
}

void loop(uint32_t now) {
  if (!dirty || now - changedAt < kSaveAfterMs) return;
  Preferences p;
  if (!p.begin("toki", false)) return;  // try again next loop
  p.putUChar("brightness", values.brightness);
  p.putUChar("rollover", values.rollover);
  p.putUChar("label", values.label);
  p.end();
  dirty = false;
  Serial.printf("## settings saved: brightness %u, rollover %u, label %u\n", values.brightness, values.rollover, values.label);
}

void toJson(JsonObject out) {
  out["brightness"] = values.brightness;
  out["rollover"] = values.rollover;
  out["label"] = values.label;
}

}  // namespace settings
