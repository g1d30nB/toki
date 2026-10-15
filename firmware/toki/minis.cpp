// Port of simulator/src/face/minis.ts: one little face (a pair of mini eyes with
// little brows) per running subagent, up to miniCap (spec §4.2).
#include <math.h>

#include "render.h"

namespace toki {

namespace {
inline int ri(float v) { return (int)lroundf(v); }
float clamp01(float x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
float lerp(float a, float b, float t) { return a + (b - a) * t; }
}  // namespace

float MiniLayer::rand() {
  rng_ += 0x6d2b79f5u;
  uint32_t t = rng_;
  t = (t ^ (t >> 15)) * (1 | t);
  t = (t + ((t ^ (t >> 7)) * (61 | t))) ^ t;
  return ((t ^ (t >> 14)) & 0xffffffu) / 16777216.0f;
}

void MiniLayer::slots(const Tokens& tk, Spot out[4]) {
  // Hand-placed spots that look scattered, close to the eyes (tokens miniS1..4).
  out[0] = {tk.miniS1x, tk.miniS1y, tk.miniS1tilt, tk.miniS1size};
  out[1] = {tk.miniS2x, tk.miniS2y, tk.miniS2tilt, tk.miniS2size};
  out[2] = {tk.miniS3x, tk.miniS3y, tk.miniS3tilt, tk.miniS3size};
  out[3] = {tk.miniS4x, tk.miniS4y, tk.miniS4tilt, tk.miniS4size};
}

void MiniLayer::update(const uint32_t* ids, int count, uint32_t now, const Tokens& tk) {
  const int cap = (int)tk.miniCap;
  if (count > cap) count = cap;
  Spot s[4];
  slots(tk, s);
  uint32_t stagger = 0;
  for (int i = 0; i < count; i++) {
    Mini* m = nullptr;
    for (Mini& x : minis_)
      if (x.used && x.id == ids[i]) m = &x;
    if (m && !m->leaving) continue;
    if (m) m->used = false;
    // First free slot, among minis that aren't leaving.
    int slot = -1;
    for (int k = 0; k < 4 && slot < 0; k++) {
      bool taken = false;
      for (const Mini& x : minis_) taken |= x.used && !x.leaving && x.slot == k;
      if (!taken) slot = k;
    }
    if (slot < 0) continue;
    Mini* free = nullptr;
    for (Mini& x : minis_)
      if (!x.used && !free) free = &x;
    if (!free) continue;
    const uint32_t born = now + stagger;
    stagger += (uint32_t)tk.miniStaggerMs;
    *free = Mini{true, ids[i], slot, born, false, 0, born + (uint32_t)lerp(1500, 5000, rand()), 0, born + (uint32_t)lerp(4000, 9000, rand()), 0};
    spawnAt_ = born;
    spawnX_ = s[slot].x;
    spawnY_ = s[slot].y;
    haveSpawn_ = true;
  }
  // Departures pop out; finished ones free their slot.
  for (Mini& m : minis_) {
    if (!m.used) continue;
    bool still = false;
    for (int i = 0; i < count; i++) still |= ids[i] == m.id;
    if (!still && !m.leaving) {
      m.leaving = true;
      m.leftAt = now;
    }
    if (m.leaving && now - m.leftAt >= tk.miniOutMs) m.used = false;
  }
  bool any = false;
  for (const Mini& m : minis_) any |= m.used && !m.leaving;
  const float dt = fminf(100, (float)(now - lastNow_));
  lastNow_ = now;
  const float step = tk.miniShrinkMs > 0 ? dt / tk.miniShrinkMs : 1;
  presence = any ? fminf(1, presence + step) : fmaxf(0, presence - step);
}

bool MiniLayer::visible() const {
  for (const Mini& m : minis_)
    if (m.used) return true;
  return false;
}

bool MiniLayer::lastSpawn(uint32_t& at, float& x, float& y) const {
  if (!haveSpawn_) return false;
  at = spawnAt_;
  x = spawnX_;
  y = spawnY_;
  return true;
}

void MiniLayer::draw(M5Canvas& g, uint32_t now, const Tokens& tk, const Eye mainEyes[2]) {
  Spot s[4];
  slots(tk, s);
  int index = 0;
  for (Mini& m : minis_) {
    if (!m.used) continue;
    const Spot at = s[m.slot];
    float sx = 1, sy = 1;
    if (m.leaving) {
      const float p = clamp01((now - m.leftAt) / tk.miniOutMs);
      sx = sy = p < 0.3f ? lerp(1, 1.12f, p / 0.3f) : lerp(1.12f, 0, (p - 0.3f) / 0.7f);
    } else {
      if (now < m.born) continue;
      const float p = clamp01((now - m.born) / tk.miniInMs);
      const float k = p < 0.6f ? lerp(0, 1.15f, p / 0.6f) : lerp(1.15f, 1, (p - 0.6f) / 0.4f);
      const float squash = sinf(p * PI) * 0.22f;
      sx = k * (1 + squash);
      sy = k * (1 - squash);
    }
    if (now >= m.nextBlink) {
      m.blinkAt = now;
      m.nextBlink = now + (uint32_t)lerp(2500, 6000, rand());
    }
    const float bp = (now - m.blinkAt) / tk.blinkMs;
    const float blink = bp >= 0 && bp <= 1 ? fmaxf(0.12f, fabsf(bp - 0.5f) * 2) : 1;
    if (now >= m.nextGlance) {
      m.glanceAt = now;
      m.nextGlance = now + (uint32_t)lerp(5000, 10000, rand());
    }
    const float gp = (now - m.glanceAt) / 900.0f;
    const float glance = gp >= 0 && gp <= 1 ? sinf(gp * PI) : 0;
    const Eye& near = fabsf(mainEyes[0].cx - at.x) < fabsf(mainEyes[1].cx - at.x) ? mainEyes[0] : mainEyes[1];
    const float dx = near.cx - at.x, dy = near.cy - at.y;
    const float d = fmaxf(1, sqrtf(dx * dx + dy * dy));
    const float bob = tk.miniBob > 0 ? sinf(now / 700.0f + index * 1.7f) * tk.miniBob : 0;
    index++;

    const float R = tk.miniR * at.size, pr = R * tk.miniPupil;
    const float off = (R - pr) * (tk.miniLook + 0.35f * glance);
    // Each spot has its own tilt: the little face is rotated about its centre.
    const float ta = at.tilt * PI / 180, ct = cosf(ta), st = sinf(ta);
    auto rot = [&](float px, float py, float& ox, float& oy) {
      ox = at.x + px * ct - py * st;
      oy = at.y + bob + px * st + py * ct;
    };
    for (int side = -1; side <= 1; side += 2) {
      const float ex = side * (R + tk.miniGap / 2 * at.size) * sx;
      float x, y;
      rot(ex, 0, x, y);
      g.fillEllipse(ri(x), ri(y), ri(R * sx), ri(fmaxf(1, R * sy * blink)), kMustard);
      if (blink > 0.5f) g.fillEllipse(ri(x + dx / d * off), ri(y + dy / d * off), ri(pr * sx), ri(pr * sy * blink), kInk);
      const float by = -R * sy - tk.miniBrowGap;
      const float half = (tk.miniBrowLen / 2) * sx * at.size;
      const float lift = half * sinf(tk.miniBrowAngle * PI / 180);
      float ax, ay, bx, bY;
      rot(ex - side * half, by - lift, ax, ay);
      rot(ex + side * half, by + lift, bx, bY);
      g.drawWideLine(ri(ax), ri(ay), ri(bx), ri(bY), tk.miniBrowWeight * fminf(sx, 1), kCream);
    }
  }
}

}  // namespace toki
