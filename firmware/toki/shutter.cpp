// Port of simulator/src/face/shutter.ts: the night shutter (spec §3.4).
#include <math.h>

#include "render.h"

namespace toki {

void Shutter::update(uint32_t now, float target, const Tokens& tk) {
  const float dt = have_ ? fminf(0.1f, (now - last_) / 1000.0f) : 0;
  last_ = now;
  have_ = true;
  if (target > pos + 1e-3f || (vel_ != 0 && target > 0)) {
    // Falls under gravity: a full drop takes shutterDropMs, then one small bounce.
    const float d = tk.shutterDropMs / 1000.0f;
    vel_ += (2 / (d * d)) * dt;
    pos += vel_ * dt;
    if (pos >= target) {
      pos = target;
      vel_ = vel_ > 0.6f ? -vel_ * 0.18f : 0;
    }
  } else if (target < pos) {
    // Rolls up at an even speed.
    vel_ = 0;
    pos = fmaxf(target, pos - dt / (tk.shutterRiseMs / 1000.0f));
  }
}

void Shutter::draw(M5Canvas& g, const Tokens& tk, bool earned) const {
  const int y = (int)lroundf(pos * 240);
  if (y < 1) return;
  const uint32_t shine = mix(kDim, kCream, 0.3f);
  const int slat = (int)tk.shutterSlat;
  g.fillRect(0, 0, 320, y, kDim);
  // Slats: a dark groove and a light lip each, counted up from the bottom rail.
  for (int yy = y - 8 - slat; yy > -slat; yy -= slat) {
    g.fillRect(0, yy, 320, 2, kInk);
    g.fillRect(0, yy + 2, 320, 1, shine);
  }
  // Bottom rail and its handle.
  g.fillRect(0, y - 8, 320, 8, kInk);
  g.fillRect(0, y - 7, 320, 3, shine);
  g.fillRoundRect(142, y - 7, 36, 5, 2, kTomato);
  // The hand-lettered CLOSED sign hangs in the middle of a fully closed shutter.
  if (earned) {
    const int cy = y - 120;
    if (cy > -30) {
      g.fillRoundRect(94, cy - 23, 132, 46, 9, kCream);
      g.fillRoundRect(97, cy - 20, 126, 40, 7, kTomato);
      useFont(g, Baloo::Bold28);
      g.setTextColor(kCream);
      g.setTextDatum(middle_center);
      g.drawString("CLOSED", 160, cy + 1);
    }
  }
}

}  // namespace toki
