// Port of simulator/src/face/drawEyes.ts, kawaii pass (Gideon, 21 Oct): dark
// features on a cream screen. An open eye is a solid navy disc with white shines
// (three while it's fully round, two once a lid narrows it) and no separate pupil:
// looking moves the whole eye. Closed eyes are thin, even lines. Hybrid edges
// (decided 3 Oct): filled shapes are plain primitives; lines are drawWideLine.
#include <math.h>

#include "face.h"

namespace toki {

namespace {

inline int ri(float v) { return (int)lroundf(v); }

void wideLine(M5Canvas& g, float x0, float y0, float x1, float y1, float r, uint32_t c) {
  g.drawWideLine(ri(x0), ri(y0), ri(x1), ri(y1), r, c);
}

/** A lid: cover one side of a straight line with the screen. */
void lid(M5Canvas& g, const Eye& e, float y0, float slope, bool coverAbove) {
  const float left = e.cx - e.rx - 2, top = e.cy - e.ry - 2;
  const float w = (e.rx + 2) * 2, h = (e.ry + 2) * 2;
  auto yAt = [&](float x) { return y0 + slope * (x - e.cx); };
  g.setClipRect(ri(left), ri(top), ri(w), ri(h));
  const float yl = yAt(left), yr = yAt(left + w);
  if (coverAbove) {
    g.fillRect(ri(left), ri(top), ri(w), ri(fmaxf(0, fminf(yl, yr) - top)), kFace);
    g.fillTriangle(ri(left), ri(fminf(yl, yr)), ri(left + w), ri(fminf(yl, yr)), ri(yl < yr ? left + w : left), ri(fmaxf(yl, yr)), kFace);
  } else {
    const float bottom = top + h;
    g.fillRect(ri(left), ri(fmaxf(yl, yr)), ri(w), ri(fmaxf(0, bottom - fmaxf(yl, yr))), kFace);
    g.fillTriangle(ri(left), ri(fmaxf(yl, yr)), ri(left + w), ri(fmaxf(yl, yr)), ri(yl > yr ? left + w : left), ri(fminf(yl, yr)), kFace);
  }
  g.clearClipRect();
  // The flat cut is the lid: no line (Gideon, 21 Oct: on a solid eye it only showed
  // where it poked out at the sides).
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

/** Smiling eyes: the bottom of the eye is cut away by an upward curve. */
void smileLid(M5Canvas& g, const Eye& e, const Tokens& tk, float amount) {
  const float R = e.rx * tk.smileCurve;
  const float topY = e.cy + e.ry - amount * e.ry * 2;
  fillEllipseInsideCircle(g, e, e.rx + 1, e.ry + 1, e.cx, topY + R, R, kFace);
}

/** A four-point star with concave sides, filled as a fan from its centre. */
void fillStar(M5Canvas& g, float x, float y, float R, float concave, uint32_t c, float* outX = nullptr, float* outY = nullptr) {
  constexpr int n = 32;
  const float ex = 2 / concave;
  float px[n], py[n];
  for (int i = 0; i < n; i++) {
    const float a = ((float)i / n) * PI * 2, co = cosf(a), s = sinf(a);
    px[i] = x + copysignf(powf(fabsf(co), ex), co) * R;
    py[i] = y + copysignf(powf(fabsf(s), ex), s) * R;
    if (outX) {
      outX[i] = px[i];
      outY[i] = py[i];
    }
  }
  for (int i = 0; i < n; i++) g.fillTriangle(ri(x), ri(y), ri(px[i]), ri(py[i]), ri(px[(i + 1) % n]), ri(py[(i + 1) % n]), c);
}

void closedEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float y = e.cy + e.ry * 0.2f;
  wideLine(g, e.cx - e.rx * 0.8f, y, e.cx + e.rx * 0.8f, y, tk.lineWeight, kLine);
}

void roundEye(M5Canvas& g, const Eye& base, const AnimatedFace& f, const Tokens& tk, bool sparkle) {
  const float open = fminf(f.open, 1);
  if (open < 0.08f) return closedEye(g, base, tk);
  // No separate pupil: looking moves the whole eye a little.
  Eye e = base;
  e.cx += f.pupilX * tk.lookTravel + f.saccadeX;
  e.cy += f.pupilY * tk.lookTravel + f.saccadeY;
  g.fillEllipse(ri(e.cx), ri(e.cy), ri(e.rx), ri(e.ry), kLine);

  // The shines: big top left, medium right, small low in the middle while the eye
  // is fully round; once narrowed, two side by side in the part still showing.
  const float r = fminf(e.rx, e.ry);
  const float glossy = fminf(1.3f, f.highlight);
  const bool narrowed = open < 0.99f || f.smile > 0.01f || f.squint > 0.01f || fabsf(f.lidTilt) > 0.5f;
  float big = r * tk.shineBig * f.highlight;
  float bx = e.cx - e.rx * 0.15f, by = e.cy - e.ry * 0.22f;
  float sx = e.cx + e.rx * 0.04f, sy = e.cy + e.ry * 0.5f;
  if (narrowed) {
    const float top = open < 0.99f ? e.cy - e.ry + (1 - open) * e.ry * 2 * 0.6f : e.cy - e.ry;
    float bottom = e.cy + e.ry;
    if (f.smile > 0.01f) bottom = fminf(bottom, e.cy + e.ry - f.smile * e.ry * 2);
    if (f.squint > 0.01f) bottom = fminf(bottom, e.cy + e.ry - f.squint * e.ry);
    const float mid = (top + bottom) / 2, h = bottom - top;
    big = fminf(big, h * 0.3f);
    by = mid - h * 0.06f;
    sx = e.cx + e.rx * 0.38f;
    sy = mid + h * 0.12f;
  }
  if (sparkle) fillStar(g, bx, by, big * 1.5f, 0.7f, kShine);  // success: the big shine is a star
  else g.fillCircle(ri(bx), ri(by), ri(big), kShine);
  if (!narrowed) g.fillCircle(ri(e.cx + e.rx * 0.5f), ri(e.cy + e.ry * 0.14f), ri(r * tk.shineMid * glossy), kShine);
  g.fillCircle(ri(sx), ri(sy), ri(fmaxf(1, r * tk.shineSmall * glossy)), kShine);

  // Top lid: opens and closes, and slants down towards the nose for a scowl.
  if (open < 0.99f || fabsf(f.lidTilt) > 0.5f)
    lid(g, e, e.cy - e.ry + (1 - open) * e.ry * 2 * 0.6f, -e.side * tanf(f.lidTilt * PI / 180), true);
  if (f.smile > 0.01f) smileLid(g, e, tk, f.smile);
  if (f.squint > 0.01f) lid(g, e, e.cy + e.ry - f.squint * e.ry, 0, false);
}

/** Draws an arc of a circle as one even line; degrees clockwise from the right (y down). */
void arcLine(M5Canvas& g, float cx, float cy, float r, float from, float to, float weight) {
  const int n = 16;
  float px = cx + cosf(from * PI / 180) * r, py = cy + sinf(from * PI / 180) * r;
  for (int i = 1; i <= n; i++) {
    const float a = (from + (to - from) * i / n) * PI / 180;
    const float nx = cx + cosf(a) * r, ny = cy + sinf(a) * r;
    wideLine(g, px, py, nx, ny, weight, kLine);
    px = nx;
    py = ny;
  }
}

void spiralEye(M5Canvas& g, const Eye& e, const Tokens& tk, uint32_t now) {
  const float turns = 2.5f;
  const int steps = 40;
  const float spin = (now / 160.0f) * e.side;
  float px = e.cx, py = e.cy;
  for (int i = 1; i <= steps; i++) {
    const float a = ((float)i / steps) * turns * PI * 2 + spin;
    const float rr = ((float)i / steps) * 0.9f;
    const float x = e.cx + cosf(a) * e.rx * rr, y = e.cy + sinf(a) * e.ry * rr;
    wideLine(g, px, py, x, y, tk.lineWeight, kLine);
    px = x;
    py = y;
  }
}

/** Happy arcs: ^ ^ (done). */
void arcEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  arcLine(g, e.cx, e.cy + e.ry * 0.35f, e.rx * 0.78f, 200, 340, tk.lineWeight * 1.15f);
}

/** Content closed eyes: a downward curve (quiet, sleepy, night), with three lashes when content. */
void sleepEye(M5Canvas& g, const Eye& e, const Tokens& tk, bool lashes) {
  const float r = e.rx * 0.8f, cy = e.cy - e.ry * 0.15f;
  arcLine(g, e.cx, cy, r, 20, 160, tk.lineWeight * 1.15f);
  if (!lashes) return;
  for (int k = 0; k < 3; k++) {
    // From just inside the end of the curve, fanning outwards: down-out, out, up-out.
    const float along = (e.side == 1 ? 24 - k * 4 : 156 + k * 4) * PI / 180;
    const float ox = e.cx + cosf(along) * r, oy = cy + sinf(along) * r;
    const float up = (-30 + k * 36) * PI / 180;
    const float L = tk.lashLen * (1 - k * 0.08f);
    wideLine(g, ox, oy, ox + e.side * cosf(up) * L, oy - sinf(up) * L, tk.lineWeight * 0.85f, kLine);
  }
}

/** Star eyes (day closed, earned): a mustard four-point star, outlined, with one shine. */
void starEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float R = e.ry * 1.05f;
  constexpr int n = 32;
  float px[n], py[n];
  fillStar(g, e.cx, e.cy, R, tk.sparkleConcave, kMustard, px, py);
  for (int i = 0; i < n; i++) wideLine(g, px[i], py[i], px[(i + 1) % n], py[(i + 1) % n], tk.lineWeight, kLine);
  g.fillCircle(ri(e.cx + R * 0.16f), ri(e.cy - R * 0.18f), ri(R * 0.14f), kShine);
}

/** The squeeze: > < (approved, boop). */
void chevronEye(M5Canvas& g, const Eye& e, const Tokens& tk) {
  const float dx = e.rx * 0.75f * -e.side, h = e.ry * 0.5f;
  const float tipX = e.cx + dx * 0.6f, backX = e.cx - dx * 0.6f;
  const float r = tk.lineWeight * 1.25f;
  wideLine(g, backX, e.cy - h, tipX, e.cy, r, kLine);
  wideLine(g, tipX, e.cy, backX, e.cy + h, r, kLine);
}

/** Brows: a filled crescent above each eye, thick in the middle, tapering to points. */
void brow(M5Canvas& g, const Eye& e, const AnimatedFace& f, const Tokens& tk) {
  const float half = (tk.browLength * f.brows.len) / 2;
  if (half < 1) return;
  const float a = ((f.brows.angle + (e.side == 1 ? f.brows.tilt : 0)) * PI) / 180;
  const float y = e.cy - e.ry - tk.browGap - f.brows.y;
  const float sag = (f.brows.curve < 0 ? tk.browCurve : f.brows.curve) * half;
  const float ca = cosf(a), sa = sinf(a);
  float tx0 = 0, ty0 = 0, bx0 = 0, by0 = 0;
  for (int i = 0; i <= 16; i++) {
    const float u = -1 + (2.0f * i) / 16;
    const float lx = u * half;
    const float mid = -sag * (1 - u * u);
    const float t = (tk.browThick / 2) * powf(1 - u * u, 0.7f) + 0.6f;
    const float x = e.cx + e.side * lx * ca;
    const float tx = x, ty = y + mid - t + lx * sa;
    const float bx = x, by = y + mid + t + lx * sa;
    if (i > 0) {
      g.fillTriangle(ri(tx0), ri(ty0), ri(tx), ri(ty), ri(bx0), ri(by0), kLine);
      g.fillTriangle(ri(tx), ri(ty), ri(bx), ri(by), ri(bx0), ri(by0), kLine);
    }
    tx0 = tx;
    ty0 = ty;
    bx0 = bx;
    by0 = by;
  }
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

void drawCheeks(M5Canvas& g, const AnimatedFace& f, const Tokens& tk) {
  if (f.cheeks <= 0.01f) return;
  Eye eyes[2];
  eyeLayout(f, tk, eyes);
  for (const Eye& e : eyes)
    g.fillEllipse(ri(e.cx + e.side * tk.cheekX), ri(e.cy + tk.cheekY * fminf(1.15f, f.scale)), ri(tk.cheekRx * f.cheeks), ri(tk.cheekRy * f.cheeks), kCheek);
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
      case EyeShape::Sleep: sleepEye(g, e, tk, f.lashes); break;
      case EyeShape::Star: starEye(g, e, tk); break;
      default: roundEye(g, e, f, tk, f.shape == EyeShape::Sparkle); break;
    }
  }
}

}  // namespace toki
