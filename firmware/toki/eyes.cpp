// Port of simulator/src/face/drawEyes.ts. Hybrid edges (decided 3 Oct): filled
// shapes are plain (aliased) M5GFX primitives; lines are drawWideLine, which
// M5GFX anti-aliases.
#include <math.h>

#include "face.h"

namespace toki {

namespace {

inline int ri(float v) { return (int)lroundf(v); }

void wideLine(M5Canvas& g, float x0, float y0, float x1, float y1, float r, uint32_t c) {
  g.drawWideLine(ri(x0), ri(y0), ri(x1), ri(y1), r, c);
}

/** Where a straight lid line crosses the eye's ellipse grown by `outer`, if it does. */
bool chord(const Eye& e, float outer, float y0, float slope, float& u0, float& u1) {
  const float A = e.rx + outer, B = e.ry + outer, d = y0 - e.cy;
  const float a = 1 / (A * A) + (slope * slope) / (B * B);
  const float b = (2 * d * slope) / (B * B);
  const float c = (d * d) / (B * B) - 1;
  const float disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const float r = sqrtf(disc);
  u0 = (-b - r) / (2 * a);
  u1 = (-b + r) / (2 * a);
  return true;
}

/** Lid edge: cover one side of the line with ground, then redraw it as linework. */
void lid(M5Canvas& g, const Eye& e, const Tokens& tk, float y0, float slope, bool coverAbove) {
  const float outer = tk.outline + tk.border;
  const float left = e.cx - e.rx - outer - 1, top = e.cy - e.ry - outer - 1;
  const float w = (e.rx + outer + 1) * 2, h = (e.ry + outer + 1) * 2;
  auto yAt = [&](float x) { return y0 + slope * (x - e.cx); };

  g.setClipRect(ri(left), ri(top), ri(w), ri(h));
  const float yl = yAt(left), yr = yAt(left + w);
  if (coverAbove) {
    g.fillRect(ri(left), ri(top), ri(w), ri(fmaxf(0, fminf(yl, yr) - top)), kGround);
    g.fillTriangle(ri(left), ri(fminf(yl, yr)), ri(left + w), ri(fminf(yl, yr)), ri(yl < yr ? left + w : left), ri(fmaxf(yl, yr)), kGround);
  } else {
    const float bottom = top + h;
    g.fillRect(ri(left), ri(fmaxf(yl, yr)), ri(w), ri(fmaxf(0, bottom - fmaxf(yl, yr))), kGround);
    g.fillTriangle(ri(left), ri(fmaxf(yl, yr)), ri(left + w), ri(fmaxf(yl, yr)), ri(yl > yr ? left + w : left), ri(fminf(yl, yr)), kGround);
  }
  g.clearClipRect();

  float u0, u1;
  if (!chord(e, tk.outline / 2, y0, slope, u0, u1)) return;
  const float x0 = e.cx + u0, x1 = e.cx + u1;
  // The cream border sits only on the covered side, never across the iris.
  const float shift = (coverAbove ? -1 : 1) * (tk.border / 2);
  wideLine(g, x0, yAt(x0) + shift, x1, yAt(x1) + shift, tk.outline / 2 + tk.border / 2, kCream);
  wideLine(g, x0, yAt(x0), x1, yAt(x1), tk.outline / 2, kInk);
}

/**
 * Fills the part of an ellipse (radii A, B about the eye centre) that lies inside a
 * circle (cx0, cy0, R), as a strip of triangles across its width.
 */
void fillEllipseInsideCircle(M5Canvas& g, const Eye& e, float A, float B, float cx0, float cy0, float R, uint32_t c) {
  const int steps = 28;
  bool have = false;
  float px = 0, pt = 0, pb = 0;
  for (int i = 0; i <= steps; i++) {
    const float x = -A + (2 * A * i) / steps;
    const float ey = B * sqrtf(fmaxf(0, 1 - (x * x) / (A * A)));
    const float dx = e.cx + x - cx0;
    if (fabsf(dx) >= R) {
      have = false;
      continue;
    }
    const float cyH = sqrtf(R * R - dx * dx);
    const float t = fmaxf(e.cy - ey, cy0 - cyH);
    const float b = fminf(e.cy + ey, cy0 + cyH);
    if (t >= b) {
      have = false;
      continue;
    }
    const float X = e.cx + x;
    if (have) {
      g.fillTriangle(ri(px), ri(pt), ri(X), ri(t), ri(px), ri(pb), c);
      g.fillTriangle(ri(X), ri(t), ri(X), ri(b), ri(px), ri(pb), c);
    }
    px = X;
    pt = t;
    pb = b;
    have = true;
  }
}

/** Smiling lower lid: the bottom of the eye itself takes a gentle upward curve. */
void smileLid(M5Canvas& g, const Eye& e, const Tokens& tk, float amount) {
  const float o = tk.outline, bd = tk.border;
  const float R = e.rx * tk.smileCurve;
  const float topY = e.cy + e.ry - amount * e.ry * 2;
  const float cy0 = topY + R;
  fillEllipseInsideCircle(g, e, e.rx + o, e.ry + o, e.cx, cy0, R, kInk);
  fillEllipseInsideCircle(g, e, e.rx + o + bd, e.ry + o + bd, e.cx, cy0, R - o, kCream);
  fillEllipseInsideCircle(g, e, e.rx + o + bd + 1, e.ry + o + bd + 1, e.cx, cy0, R - o - bd, kGround);
}

void closedEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float y = e.cy + e.ry * 0.2f;
  wideLine(g, e.cx - e.rx, y, e.cx + e.rx, y, tk.outline / 2 + tk.border, kCream);
  wideLine(g, e.cx - e.rx, y, e.cx + e.rx, y, tk.outline / 2, kInk);
}

void eyeRings(M5Canvas& g, const Eye& e, const Tokens& tk) {
  g.fillEllipse(ri(e.cx), ri(e.cy), ri(e.rx + tk.outline + tk.border), ri(e.ry + tk.outline + tk.border), kCream);
  g.fillEllipse(ri(e.cx), ri(e.cy), ri(e.rx + tk.outline), ri(e.ry + tk.outline), kInk);
  g.fillEllipse(ri(e.cx), ri(e.cy), ri(e.rx), ri(e.ry), kCream);
}

void roundEye(M5Canvas& g, const Eye& e, const AnimatedFace& f, const Tokens& tk, bool sparkle) {
  const float open = fminf(f.open, 1);
  if (open < 0.08f) return closedEye(g, e, tk);
  eyeRings(g, e, tk);

  // Iris and pupil, kept inside the eye.
  const float ir = tk.irisR * f.pupilScale * fminf(1, e.rx / tk.eyeRx);
  const float travelX = fmaxf(0, e.rx - ir - 3), travelY = fmaxf(0, e.ry - ir - 3);
  const float ix = e.cx + f.pupilX * travelX + f.saccadeX;
  const float iy = e.cy + f.pupilY * travelY + f.saccadeY;
  g.fillCircle(ri(ix), ri(iy), ri(ir), kMustard);
  g.fillCircle(ri(ix), ri(iy), ri(fmaxf(2, ir * (tk.pupilR / tk.irisR))), kInk);
  const float hr = tk.highlightR * f.highlight;
  g.fillCircle(ri(ix - ir * 0.36f), ri(iy - ir * 0.4f), ri(hr), kCream);
  g.fillCircle(ri(ix + ir * 0.34f), ri(iy + ir * 0.34f), ri(hr * 0.45f), kCream);
  if (sparkle) {
    // A four-point star in the highlight: reserved for success moments.
    const float sx = ix - ir * 0.36f, sy = iy - ir * 0.4f, L = tk.highlightR * 2.2f, w = tk.highlightR * 0.55f;
    g.fillTriangle(ri(sx - L), ri(sy), ri(sx + L), ri(sy), ri(sx), ri(sy - w), kCream);
    g.fillTriangle(ri(sx - L), ri(sy), ri(sx + L), ri(sy), ri(sx), ri(sy + w), kCream);
    g.fillTriangle(ri(sx), ri(sy - L), ri(sx), ri(sy + L), ri(sx - w), ri(sy), kCream);
    g.fillTriangle(ri(sx), ri(sy - L), ri(sx), ri(sy + L), ri(sx + w), ri(sy), kCream);
  }

  // Top lid: level; it only opens and closes.
  if (open < 0.99f) lid(g, e, tk, e.cy - e.ry + (1 - open) * e.ry * 2 * 0.6f, 0, true);
  if (f.smile > 0.01f) smileLid(g, e, tk, f.smile);
  if (f.squint > 0.01f) lid(g, e, tk, e.cy + e.ry - f.squint * e.ry, 0, false);
}

void spiralEye(M5Canvas& g, const Eye& e, const Tokens& tk, uint32_t now) {
  eyeRings(g, e, tk);
  const float turns = 2.5f;
  const int steps = 40;
  const float spin = (now / 160.0f) * e.side;
  float px = e.cx, py = e.cy;
  for (int i = 1; i <= steps; i++) {
    const float a = ((float)i / steps) * turns * PI * 2 + spin;
    const float rr = ((float)i / steps) * 0.82f;
    const float x = e.cx + cosf(a) * e.rx * rr, y = e.cy + sinf(a) * e.ry * rr;
    wideLine(g, px, py, x, y, tk.outline / 2, kInk);
    px = x;
    py = y;
  }
}

void arcEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float cy = e.cy + e.ry * 0.45f, r = e.rx, t = tk.outline + 4;
  g.fillArc(ri(e.cx), ri(cy), ri(r - t / 2 - tk.border), ri(r + t / 2 + tk.border), 200, 340, kCream);
  g.fillArc(ri(e.cx), ri(cy), ri(r - t / 2), ri(r + t / 2), 202, 338, kInk);
}

/** Content closed eyes: a downward curve, like a sleeping smile (quiet, sleepy, night). */
void sleepEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float r = e.rx * 0.85f, cy = e.cy - e.ry * 0.3f, t = tk.outline + 2;
  g.fillArc(ri(e.cx), ri(cy), ri(r - t / 2 - tk.border), ri(r + t / 2 + tk.border), 22, 158, kCream);
  g.fillArc(ri(e.cx), ri(cy), ri(r - t / 2), ri(r + t / 2), 24, 156, kInk);
}

/**
 * Star eyes (day closed, earned): the eye becomes a mustard four-point star with
 * concave sides, the same navy outline and cream border as the round eye, and one
 * highlight. Filled as a triangle fan; the outline is drawWideLine segments.
 */
void starEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float R = e.ry * 1.05f, ex = 2 / tk.sparkleConcave;
  constexpr int n = 32;
  float px[n], py[n];
  for (int i = 0; i < n; i++) {
    const float a = ((float)i / n) * PI * 2, c = cosf(a), s = sinf(a);
    px[i] = e.cx + copysignf(powf(fabsf(c), ex), c) * R;
    py[i] = e.cy + copysignf(powf(fabsf(s), ex), s) * R;
  }
  for (int i = 0; i < n; i++) wideLine(g, px[i], py[i], px[(i + 1) % n], py[(i + 1) % n], tk.outline / 2 + tk.border, kCream);
  for (int i = 0; i < n; i++) {
    const int j = (i + 1) % n;
    g.fillTriangle(ri(e.cx), ri(e.cy), ri(px[i]), ri(py[i]), ri(px[j]), ri(py[j]), kMustard);
  }
  for (int i = 0; i < n; i++) wideLine(g, px[i], py[i], px[(i + 1) % n], py[(i + 1) % n], tk.outline / 2, kInk);
  g.fillCircle(ri(e.cx - R * 0.16f), ri(e.cy - R * 0.18f), ri(tk.highlightR * 0.9f), kCream);
}

void chevronEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float dx = e.rx * 0.75f * -e.side, h = e.ry * 0.55f;
  const float tipX = e.cx + dx * 0.6f, backX = e.cx - dx * 0.6f;
  const float radii[2] = {tk.outline / 2 + tk.border, tk.outline / 2};
  const uint32_t colours[2] = {kCream, kInk};
  for (int i = 0; i < 2; i++) {
    wideLine(g, backX, e.cy - h, tipX, e.cy, radii[i], colours[i]);
    wideLine(g, tipX, e.cy, backX, e.cy + h, radii[i], colours[i]);
  }
}

void brow(M5Canvas& g, const Eye& e, const AnimatedFace& f, const Tokens& tk) {
  const float a = ((f.brows.angle + (e.side == 1 ? f.brows.tilt : 0)) * PI) / 180;
  const float y = e.cy - e.ry - tk.outline - tk.border - tk.browGap - f.brows.y;
  const float half = (tk.browLength * f.brows.len) / 2;
  const float ix = e.cx - e.side * half * cosf(a), iy = y - half * sinf(a);
  const float ox = e.cx + e.side * half * cosf(a), oy = y + half * sinf(a);
  wideLine(g, ix, iy, ox, oy, tk.browWeight, kCream);
}

}  // namespace

void eyeLayout(const AnimatedFace& f, const Tokens& tk, Eye out[2]) {
  const float wide = fmaxf(0, f.open - 1);
  const float baseRx = tk.eyeRx + (fmaxf(tk.eyeRx, tk.eyeRy) - tk.eyeRx) * f.roundness;
  for (int i = 0; i < 2; i++) {
    const int side = i == 0 ? -1 : 1;
    out[i] = Eye{160 + side * tk.eyeSpacing / 2, tk.eyeY + f.offsetY, (baseRx * f.scale * (1 + wide * 0.6f)) / sqrtf(f.stretch),
                 tk.eyeRy * f.scale * (1 + wide * 0.8f) * f.stretch, side};
  }
}

void drawEyes(M5Canvas& g, const AnimatedFace& f, const Tokens& tk, uint32_t now) {
  Eye eyes[2];
  eyeLayout(f, tk, eyes);
  for (const Eye& e : eyes) {
    brow(g, e, f, tk);
    switch (f.shape) {
      case EyeShape::Spiral: spiralEye(g, e, tk, now); break;
      case EyeShape::Arc: arcEye(g, e, tk); break;
      case EyeShape::Line: chevronEye(g, e, tk); break;
      case EyeShape::Sleep: sleepEye(g, e, tk); break;
      case EyeShape::Star: starEye(g, e, tk); break;
      default: roundEye(g, e, f, tk, f.shape == EyeShape::Sparkle); break;
    }
  }
}

}  // namespace toki
