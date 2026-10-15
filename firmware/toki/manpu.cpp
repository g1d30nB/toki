// Port of simulator/src/face/manpu.ts: manga symbols over the face (spec §4.1).
#include <math.h>
#include <string.h>

#include "render.h"

namespace toki {

namespace {

inline int ri(float v) { return (int)lroundf(v); }
float clamp01(float x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
float easeOut(float x) { return 1 - powf(1 - x, 3); }

void wideLine(M5Canvas& g, float x0, float y0, float x1, float y1, float r, uint32_t c) {
  g.drawWideLine(ri(x0), ri(y0), ri(x1), ri(y1), r, c);
}

struct Ctx {
  M5Canvas& g;
  const AnimatedFace& f;
  const Tokens& tk;
  float t;        // ms since this manpu appeared
  float k;        // size, 0..~1.1 (pop in / shrink out)
  float leaving;  // 0 on screen; 0..1 as it leaves
  float grow;     // long-turn growth, 1 = normal
  Eye eyes[2];
};

void dots(Ctx& c) {
  // "…": pops in one by one, holds, then all clear together.
  const Eye& left = c.eyes[0];
  const float y = left.cy - left.ry - c.tk.outline - c.tk.border - c.tk.dotsGap;
  const float step = c.tk.dotsStepMs;
  const float phase = fmodf(c.t, step * 4);
  for (int i = 0; i < 3; i++) {
    const float p = (phase - (i + 1) * step) / fmaxf(1, c.tk.manpuInMs);
    if (p < 0) continue;
    const float pop = p < 0.7f ? (p / 0.7f) * 1.15f : p < 1 ? 1.15f - ((p - 0.7f) / 0.3f) * 0.15f : 1;
    c.g.fillCircle(ri(160 + (i - 1) * 12 * c.tk.manpuScale), ri(y), ri(4.5f * c.tk.manpuScale * c.k * pop), kCream);
  }
}

void sweat(Ctx& c) {
  // Sweat drop at the right temple: slides in, bobs gently; grows on a long turn.
  const Eye& r = c.eyes[1];
  const float s = c.tk.manpuScale * c.grow * fminf(1, c.k);
  const float slide = easeOut(clamp01(c.t / c.tk.sweatSlideMs));
  const float x = r.cx + r.rx + c.tk.outline + 8 * c.tk.manpuScale;
  const float y = r.cy - r.ry * 0.9f - (1 - slide) * 18 + sinf(c.t / 600) * 1.5f;
  const float R = 7 * s;
  c.g.fillCircle(ri(x), ri(y + R), ri(R + 2), kInk);
  c.g.fillTriangle(ri(x - R - 1.5f), ri(y + R * 0.7f), ri(x + R + 1.5f), ri(y + R * 0.7f), ri(x), ri(y - R * 1.5f), kInk);
  c.g.fillCircle(ri(x), ri(y + R), ri(R), kTeal);
  c.g.fillTriangle(ri(x - R), ri(y + R * 0.75f), ri(x + R), ri(y + R * 0.75f), ri(x), ri(y - R * 1.2f), kTeal);
  c.g.fillCircle(ri(x - R * 0.35f), ri(y + R * 0.75f), ri(R * 0.28f), kCream);
}

// --- Magnifier ---------------------------------------------------------------
// A see-through lens: copy the square under the lens straight from the canvas
// buffer, zoom it with pushRotateZoom into a lens sprite, paint the transparent
// key outside the circle, and push it back with transparency.
M5Canvas* lensSrc = nullptr;
M5Canvas* lensDst = nullptr;
int lensSrcSide = 0, lensDstSide = 0;
constexpr uint32_t kLensKey = 0x010203;  // a colour the face never uses

void magnifier(Ctx& c) {
  const Eye& r = c.eyes[1];
  const float R = c.tk.lensR * c.k;
  if (R < 2) return;
  const float drift = c.tk.lensDriftMs > 0 ? sinf((c.t / c.tk.lensDriftMs) * PI * 2) : 0;
  const int x = ri(r.cx + drift * r.rx * 0.45f);
  const int y = ri(r.cy + r.ry * c.tk.lensY);

  // The glass shows the face only once the lens has popped in to full size.
  if (c.k >= 0.98f) {
    const int dst = ri(c.tk.lensR) * 2 + 2;
    const int src = (int)ceilf(dst / c.tk.lensZoom);
    if (!lensSrc || lensSrcSide != src || lensDstSide != dst) {
      delete lensSrc;
      delete lensDst;
      lensSrc = new M5Canvas(&c.g);
      lensDst = new M5Canvas(&c.g);
      lensSrc->setColorDepth(16);
      lensDst->setColorDepth(16);
      lensSrc->createSprite(src, src);
      lensDst->createSprite(dst, dst);
      lensSrcSide = src;
      lensDstSide = dst;
    }
    // Copy the source square row by row (both buffers use the same 16-bit format).
    const int sx = x - src / 2, sy = y - src / 2;
    auto* from = (uint16_t*)c.g.getBuffer();
    auto* to = (uint16_t*)lensSrc->getBuffer();
    for (int row = 0; row < src; row++) {
      const int yy = sy + row;
      for (int col = 0; col < src; col++) {
        const int xx = sx + col;
        to[row * src + col] = (xx >= 0 && xx < 320 && yy >= 0 && yy < 240) ? from[yy * 320 + xx] : from[0];
      }
    }
    lensDst->fillScreen(kLensKey);
    lensSrc->pushRotateZoom(lensDst, dst / 2.0f, dst / 2.0f, 0, c.tk.lensZoom, c.tk.lensZoom);
    lensDst->fillArc(dst / 2, dst / 2, ri(c.tk.lensR), ri(c.tk.lensR * 1.5f), 0, 360, kLensKey);
    lensDst->pushSprite(&c.g, x - dst / 2, y - dst / 2, kLensKey);
  }
  c.g.fillArc(x, y, ri(R * 0.62f), ri(R * 0.74f), 200, 250, kCream);  // glare
  c.g.fillArc(x, y, ri(R), ri(R + c.tk.lensRim), 0, 360, kCream);     // rim
  const float hx = x + (R + c.tk.lensRim) * 0.7f, hy = y + (R + c.tk.lensRim) * 0.7f;
  wideLine(c.g, hx, hy, hx + R * 0.75f, hy + R * 0.75f, c.tk.lensRim * 1.1f, kCream);  // handle
}

void www(Ctx& c) {
  // Three hand-drawn Ws above the right brow, lifting in a travelling wave.
  if (c.k <= 0.05f) return;
  const Eye& r = c.eyes[1];
  const float W = c.tk.wwwW * c.k, H = c.tk.wwwH * c.k;
  const float right = 320 - 12;
  const float top = fmaxf(12 + c.tk.wwwLift, r.cy - r.ry - c.tk.outline - c.tk.border - c.tk.wwwAbove);
  const float at = fmodf(c.t, c.tk.wwwWaveMs + c.tk.wwwPauseMs);
  const float step = c.tk.wwwWaveMs / 3, bump = step * 1.5f;
  for (int i = 0; i < 3; i++) {
    const float p = (at - i * step) / bump;
    const float lift = p > 0 && p < 1 ? powf(sinf(PI * p), 2) * c.tk.wwwLift : 0;
    const float x0 = right - (3 - i) * W - (2 - i) * c.tk.wwwGap;
    const float y0 = top - lift;
    const float xs[5] = {x0, x0 + W * 0.25f, x0 + W * 0.5f, x0 + W * 0.75f, x0 + W};
    const float ys[5] = {y0, y0 + H, y0 + H * 0.35f, y0 + H, y0};
    for (int k = 0; k < 4; k++) wideLine(c.g, xs[k], ys[k], xs[k + 1], ys[k + 1], c.tk.wwwWeight, kCream);
  }
}

void star(M5Canvas& g, float x, float y, float r, uint32_t col, const Tokens& tk) {
  // Four-point star: concave sides (superellipse), filled as a triangle fan from
  // the centre, tips rounded with a round stroke along the outline.
  if (r <= 0.5f) return;
  const float tip = fminf(tk.sparkleTip, r * 0.3f);
  const float R = r - tip, e = 2 / tk.sparkleConcave;
  const int n = 24;
  float px[n], py[n];
  for (int i = 0; i < n; i++) {
    const float a = ((float)i / n) * PI * 2, cx = cosf(a), cy = sinf(a);
    px[i] = x + copysignf(powf(fabsf(cx), e), cx) * R;
    py[i] = y + copysignf(powf(fabsf(cy), e), cy) * R;
  }
  for (int i = 0; i < n; i++) {
    const int j = (i + 1) % n;
    g.fillTriangle(ri(x), ri(y), ri(px[i]), ri(py[i]), ri(px[j]), ri(py[j]), col);
    if (tip > 0.3f) wideLine(g, px[i], py[i], px[j], py[j], tip, col);
  }
}

void sparkles(Ctx& c) {
  // Done: three cream stars pop in largest first, twinkle, then fade together.
  const Eye& r = c.eyes[1];
  const float ax = r.cx + r.rx + c.tk.outline + c.tk.sparkleX;
  const float ay = r.cy - r.ry + c.tk.sparkleY;
  const struct {
    float dx, dy, r, period;
  } stars[3] = {{-3, -6, c.tk.sparkleLarge, 1100}, {12, 18, c.tk.sparkleMid, 1500}, {14, -24, c.tk.sparkleSmall, 1900}};
  const float hold = clamp01((c.t - c.tk.sparkleHoldMs) / c.tk.sparkleFadeMs);
  const float fade = fmaxf(hold, c.leaving);
  if (fade >= 1) return;
  const uint32_t col = mix(kCream, kGround, fade);
  for (int i = 0; i < 3; i++) {
    const float local = c.t - i * c.tk.sparkleStaggerMs;
    if (local <= 0) continue;
    const float p = clamp01(local / c.tk.sparklePopMs);
    const float pop = p < 0.6f ? (p / 0.6f) * 1.2f : 1.2f - ((p - 0.6f) / 0.4f) * 0.2f;
    const float twinkle = p >= 1 ? 1 + sinf((local / stars[i].period) * PI * 2) * c.tk.sparkleTwinkle : 1;
    star(c.g, ax + stars[i].dx, ay + stars[i].dy, stars[i].r * pop * twinkle, col, c.tk);
  }
}

void blush(Ctx& c) {
  for (const Eye& e : c.eyes) {
    const float y = e.cy + e.ry * 0.8f;
    for (int i = -1; i <= 1; i++) {
      const float x = e.cx + e.side * e.rx * 0.6f + i * 7 * c.tk.manpuScale;
      wideLine(c.g, x + 3 * c.k, y - 3 * c.k, x - 3 * c.k, y + 3 * c.k, 1.6f * c.k, kTomato);
    }
  }
}

void zzz(Ctx& c) {
  // Quiet mode: "zZZZ" floating up the right side, small to big, popping in one
  // at a time, holding, then fading together. Right edges 12 px from the screen edge.
  if (c.k <= 0.05f) return;
  const float cycle = c.tk.zzzCycleMs, at = fmodf(c.t, cycle), step = cycle / 6;
  const float fade = clamp01((at - step * 5) / step);
  c.g.setTextDatum(top_right);
  for (int i = 0; i < 4; i++) {
    const float p = clamp01((at - i * step) / c.tk.manpuInMs);
    if (p <= 0) continue;
    // FreeSans bold at two sizes stands in for the simulator's 20 to 29 px.
    c.g.setFont(i < 2 ? &fonts::FreeSansBold12pt7b : &fonts::FreeSansBold18pt7b);
    c.g.setTextSize(i == 3 ? 1.15f : 1.0f);
    c.g.setTextColor(mix(kCream, kGround, fmaxf(1 - p, fade)));
    const float x = 320 - 12 - c.tk.zzzStep * (3 - i);
    const float y = 12 + c.tk.zzzRise * (3 - i) + sinf(c.t / 700 + i) * 1.5f;
    c.g.drawString(i == 0 ? "z" : "Z", ri(x), ri(y));
  }
  c.g.setTextSize(1);
}

void question(Ctx& c) {
  // "?" (asked a question): a teal badge with a cream question mark above the
  // middle of the face, where blocked has its "…", bigger so the two part at the
  // edge of vision; bobbing gently.
  if (c.k <= 0.05f) return;
  const Eye& left = c.eyes[0];
  const float top = left.cy - left.ry - c.tk.outline - c.tk.border;
  const float R = 17 * fminf(1.1f, c.k);
  const float y = fmaxf(10 + R, top - c.tk.dotsGap - 6 + sinf(c.t / 500) * 1.5f);
  c.g.fillCircle(160, ri(y), ri(R + 2.5f), kCream);
  c.g.fillCircle(160, ri(y), ri(R), kTeal);
  c.g.setFont(&fonts::FreeSansBold12pt7b);
  c.g.setTextColor(kCream);
  c.g.setTextDatum(middle_center);
  c.g.drawString("?", 160, ri(y + 1));
}

using DrawFn = void (*)(Ctx&);
// Same order as the Manpu_* bits in face_data.h.
/**
 * Setup's Wi-Fi mark, top right where the web's "www" sits: a dot and three arcs.
 * Joining, the arcs light up one after another; joined, all three are lit. Unlit
 * arcs step towards the ground (no transparency).
 */
void wifiMark(Ctx& c, bool on) {
  if (c.k <= 0.05f) return;
  const Eye& r = c.eyes[1];
  const float top = r.cy - r.ry - c.tk.outline - c.tk.border - c.tk.wwwAbove;
  const int cx = 320 - 12 - 24, cy = ri(fmaxf(12 + 26, top + 18));
  const int lit = on ? 3 : ((int)(c.t / 420)) % 4;
  const uint32_t dim = mix(kCream, kGround, 0.7f);
  c.g.fillCircle(cx, cy, ri(3.2f * c.k), kCream);
  for (int i = 0; i < 3; i++) {
    const float rr = (8 + i * 6.5f) * c.k;
    c.g.fillArc(cx, cy, ri(rr), ri(rr + 3.6f * c.k), 225, 315, i < lit ? kCream : dim);
  }
}
void wifi(Ctx& c) { wifiMark(c, false); }
void wifiOn(Ctx& c) { wifiMark(c, true); }

const DrawFn kDraw[kManpuKinds] = {dots, sweat, magnifier, www, sparkles, blush, zzz, question, wifi, wifiOn};

}  // namespace

uint32_t mix(uint32_t a, uint32_t b, float t) {
  t = clamp01(t);
  uint32_t out = 0;
  for (int shift = 16; shift >= 0; shift -= 8) {
    const float ca = (a >> shift) & 0xff, cb = (b >> shift) & 0xff;
    out |= ((uint32_t)lroundf(ca + (cb - ca) * t) & 0xff) << shift;
  }
  return out;
}

void ManpuLayer::draw(M5Canvas& g, uint16_t want, const AnimatedFace& f, const Tokens& tk, uint32_t now, float grow) {
  Ctx c{g, f, tk, 0, 0, 0, grow, {}};
  eyeLayout(f, tk, c.eyes);
  for (int i = 0; i < kManpuKinds; i++) {
    Live& m = live_[i];
    const bool wanted = want & (1u << i);
    if (wanted && (!m.on || m.leaving)) {
      m.since = m.on && m.leaving ? now - (uint32_t)tk.manpuInMs : now;
      m.on = true;
      m.leaving = false;
    }
    if (!m.on) continue;
    if (!wanted && !m.leaving) {
      m.leaving = true;
      m.leftAt = now;
    }
    if (m.leaving) {
      const float p = (now - m.leftAt) / tk.manpuOutMs;
      if (p >= 1) {
        m.on = false;
        continue;
      }
      c.k = 1 - easeOut(p);
      c.leaving = p;
    } else {
      const float p = clamp01((now - m.since) / tk.manpuInMs);
      c.k = p < 0.7f ? (p / 0.7f) * 1.1f : 1.1f - ((p - 0.7f) / 0.3f) * 0.1f;
      c.leaving = 0;
    }
    c.t = (float)(now - m.since);
    kDraw[i](c);
  }
}

}  // namespace toki
