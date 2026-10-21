// Port of simulator/src/face/drawMouth.ts, kawaii pass (Gideon, 21 Oct): thin navy
// lines the weight of the brows, and bolder shapes where the face needs them: an
// open smile with a tongue, the tongue out, a cat's ω, an open shout.
#include <math.h>

#include "face.h"

namespace toki {

namespace {
inline int ri(float v) { return (int)lroundf(v); }

struct Span {
  float l, r;
};

/**
 * A tongue inside an open mouth (Gideon, 21 Oct): two rounded humps on top with a
 * notch between them, a split down the middle, and a body that fills the bottom of
 * the mouth. Thin horizontal slices from top to bottom, each the tongue's width cut
 * to the mouth's (`mouth(y, span)`, less `inset`). Port of tongue() in drawMouth.ts.
 */
template <typename MouthSpan>
void tongue(M5Canvas& g, float cx, float top, float bottom, float half, MouthSpan mouth, float inset) {
  const float rr = half * 0.46f, d = half - rr;  // two humps, just apart: a clear U notch
  // The mouth shrunk by `inset` in every direction, so navy runs under and beside the tongue.
  auto inner = [&](float y, Span& out) -> bool {
    float l = -1e6f, r = 1e6f;
    for (int i = -4; i <= 4; i++) {
      const float dy = inset * i / 4;
      Span m;
      if (!mouth(y + dy, m)) return false;
      const float k = sqrtf(inset * inset - dy * dy);
      l = fmaxf(l, m.l + k);
      r = fminf(r, m.r - k);
    }
    out = {l, r};
    return r > l;
  };
  auto spansAt = [&](float y, Span* out) -> int {
    Span m;
    if (!inner(y, m)) return 0;
    const float l = m.l, r = m.r;
    Span parts[2];
    int n = 1;
    parts[0] = {-1e6f, 1e6f};
    const float dy = y - (top + rr);
    if (dy < 0) {
      const float hw = sqrtf(fmaxf(0, rr * rr - dy * dy));
      parts[0] = {cx - d - hw, cx - d + hw};
      parts[1] = {cx + d - hw, cx + d + hw};
      n = 2;
      if (parts[0].r >= parts[1].l) {
        parts[0].r = parts[1].r;
        n = 1;
      } else if (parts[1].l - parts[0].r < 1.2f) {
        parts[0].r = cx - 0.6f;
        parts[1].l = cx + 0.6f;
      }
    }
    int k = 0;
    for (int i = 0; i < n; i++) {
      const Span s{fmaxf(parts[i].l, l), fminf(parts[i].r, r)};
      if (s.r > s.l) out[k++] = s;
    }
    return k;
  };
  Span prev[2], cur[2];
  float prevY = roundf(top);
  int np = spansAt(prevY, prev);
  for (float yy = prevY + 1; yy <= roundf(bottom); yy += 1) {
    const int nc = spansAt(yy, cur);
    if (nc == np) {
      for (int i = 0; i < nc; i++) {
        g.fillTriangle(ri(prev[i].l), ri(prevY), ri(prev[i].r), ri(prevY), ri(cur[i].r), ri(yy), kTomato);
        g.fillTriangle(ri(prev[i].l), ri(prevY), ri(cur[i].r), ri(yy), ri(cur[i].l), ri(yy), kTomato);
      }
    } else {
      for (int i = 0; i < np; i++) g.fillRect(ri(prev[i].l), ri(prevY), ri(prev[i].r - prev[i].l), ri(yy - prevY), kTomato);
    }
    for (int i = 0; i < nc; i++) prev[i] = cur[i];
    np = nc;
    prevY = yy;
  }
  // The split down the middle, in navy so it reads as a gap (Gideon).
  g.drawWideLine(ri(cx), ri(top + rr * 0.5f), ri(cx), ri(top + (bottom - top) * 0.68f), fmaxf(1, half * 0.09f), kLine);
}
}  // namespace

void drawMouth(M5Canvas& g, const AnimatedFace& f, const Tokens& tk, uint32_t now) {
  const float x = 160 + tk.mouthX;
  const float y = tk.eyeY + f.offsetY + tk.mouthY + f.mouthShift;
  const float w = tk.mouthWidth / 2, r = tk.mouthWeight;
  auto line = [&](float x0, float y0, float x1, float y1, float rad, uint32_t c) { g.drawWideLine(ri(x0), ri(y0), ri(x1), ri(y1), rad, c); };
  auto arc = [&](float cx, float cy, float R, float from, float to) {
    const int n = 14;
    float px = cx + cosf(from * PI / 180) * R, py = cy + sinf(from * PI / 180) * R;
    for (int i = 1; i <= n; i++) {
      const float a = (from + (to - from) * i / n) * PI / 180;
      const float nx = cx + cosf(a) * R, ny = cy + sinf(a) * R;
      line(px, py, nx, ny, r, kLine);
      px = nx;
      py = ny;
    }
  };
  switch (f.mouth) {
    case Mouth::None:
      return;
    case Mouth::Line:
      line(x - w * 0.55f, y, x + w * 0.55f, y, r, kLine);
      return;
    case Mouth::Smile:
      arc(x, y - w * 0.5f, w * 0.82f, 28, 152);
      return;
    case Mouth::Pout:
      arc(x, y + w * 0.55f, w * 0.7f, 205, 335);
      return;
    case Mouth::O:
      // A small round "o", filled like the other open mouths (face review, 21 Oct).
      g.fillEllipse(ri(x), ri(y), ri(w * 0.42f), ri(w * 0.55f), kLine);
      return;
    case Mouth::Cat: {
      const float R = w * 0.38f;
      arc(x - R, y - R * 0.5f, R, 15, 165);
      arc(x + R, y - R * 0.5f, R, 15, 165);
      return;
    }
    case Mouth::Open: {
      // An open smile: a D on its back, navy inside, a tomato tongue at the bottom.
      const float top = y - w * 0.3f, half = w * 1.05f, depth = w * 1.3f;
      float px = x + half, py = top;
      for (int i = 1; i <= 20; i++) {
        const float a = PI * i / 20;
        const float nx = x + cosf(a) * half, ny = top + sinf(a) * depth;
        g.fillTriangle(ri(x), ri(top), ri(px), ri(py), ri(nx), ri(ny), kLine);
        px = nx;
        py = ny;
      }
      tongue(g, x, top + depth * 0.42f, top + depth, half * 0.62f, [&](float yy, Span& s) {
        const float t = (yy - top) / depth;
        if (t < 0 || t > 1) return false;
        const float hw = half * sqrtf(1 - t * t);
        s = {x - hw, x + hw};
        return true;
      }, r);
      return;
    }
    case Mouth::Blep: {
      // The tongue out of one side of a smile (face review, 21 Oct); tongueSide picks
      // the corner. It hangs tilted 7° outwards, drawn reaching up past the smile;
      // then everything above the smile line is trimmed back to the face, so its top
      // follows the line exactly. Port of drawMouth.ts.
      const float side = tk.tongueSide != 0 ? tk.tongueSide : 1;
      const float R = w * 0.82f, cy = y - w * 0.5f;
      const float tx = x + w * 0.3f * side;
      const float ty = cy + sqrtf(R * R - (tx - x) * (tx - x));
      const float tw = w * 0.42f, up = tw * 0.8f, len = tw * 1.05f;
      const float a = -7 * side * PI / 180, ca = cosf(a), sa = sinf(a);
      auto rx = [&](float px, float py) { return tx + px * ca - py * sa; };
      auto ry = [&](float px, float py) { return ty + px * sa + py * ca; };
      g.fillTriangle(ri(rx(-tw, -up)), ri(ry(-tw, -up)), ri(rx(tw, -up)), ri(ry(tw, -up)), ri(rx(tw, len)), ri(ry(tw, len)), kTomato);
      g.fillTriangle(ri(rx(-tw, -up)), ri(ry(-tw, -up)), ri(rx(tw, len)), ri(ry(tw, len)), ri(rx(-tw, len)), ri(ry(-tw, len)), kTomato);
      g.fillCircle(ri(rx(0, len)), ri(ry(0, len)), ri(tw), kTomato);
      // The trim: the face colour over everything above the smile, across the tongue.
      const float edge = R * cosf(22 * PI / 180), roof = ty - up - tw;
      float px = 0, py = 0;
      for (int i = 0; i <= 12; i++) {
        const float xx = fmaxf(x - edge, fminf(x + edge, tx - tw * 1.4f + tw * 2.8f * i / 12));
        const float yy = cy + sqrtf(R * R - (xx - x) * (xx - x));
        if (i) {
          g.fillTriangle(ri(px), ri(py), ri(xx), ri(yy), ri(xx), ri(roof), kFace);
          g.fillTriangle(ri(px), ri(py), ri(xx), ri(roof), ri(px), ri(roof), kFace);
        }
        px = xx;
        py = yy;
      }
      line(rx(0, 0), ry(0, 0), rx(0, len + tw * 0.35f), ry(0, len + tw * 0.35f), r * 0.45f, kLine);
      arc(x, cy, R, 22, 158);
      return;
    }
    case Mouth::Shout: {
      // Cross or shocked: an open mouth, wider at the bottom, a tongue inside.
      const float tw = w * 0.45f, bw = w * 0.8f, h = w * 1.45f;
      const float qx[4] = {x - tw, x + tw, x + bw, x - bw}, qy[4] = {y - h * 0.4f, y - h * 0.4f, y + h * 0.6f, y + h * 0.6f};
      g.fillTriangle(ri(qx[0]), ri(qy[0]), ri(qx[1]), ri(qy[1]), ri(qx[2]), ri(qy[2]), kLine);
      g.fillTriangle(ri(qx[0]), ri(qy[0]), ri(qx[2]), ri(qy[2]), ri(qx[3]), ri(qy[3]), kLine);
      // Rounded corners, as in the reference: the edge stroked with a round pen.
      for (int i = 0; i < 4; i++) line(qx[i], qy[i], qx[(i + 1) % 4], qy[(i + 1) % 4], r, kLine);
      // Humps as wide as the mouth where they sit, so the tongue fills it, as in the reference.
      tongue(g, x, y + h * 0.6f - h * 0.55f, y + h * 0.6f + r, tw + (bw - tw) * 0.6f, [&](float yy, Span& s) {
        // The stroke puts the true edge a pen's width outside the quad, below it too.
        const float t = (yy - (y - h * 0.4f)) / h;
        if (t < 0 || yy > y + h * 0.6f + r) return false;
        const float hw = tw + (bw - tw) * fminf(t, 1) + r;
        s = {x - hw, x + hw};
        return true;
      }, r);
      return;
    }
    case Mouth::Tongue: {
      arc(x, y - w * 0.45f, w * 0.7f, 30, 150);
      g.fillCircle(ri(x + w * 0.5f * tk.tongueSide), ri(y + w * (tk.tongueSide != 0 ? 0.32f : 0.4f)), ri(r * 2.4f), kTomato);
      return;
    }
    case Mouth::Yawn: {
      // A big, slow yawn: a tall oval that opens wide and closes again, every 2.4 s
      // from when the face began (now is the face's own clock), so it yawns on cue.
      const float p = fminf(1, (now % 2400) / 1800.0f);
      const float open = 0.5f + 0.5f * sinf(p * PI);
      const float rx = w * 0.8f, ry = w * 1.25f * open;
      g.fillEllipse(ri(x), ri(y + 6), ri(rx), ri(ry), kLine);
      tongue(g, x, y + 6 + ry * 0.25f, y + 6 + ry, rx * 0.62f, [&](float yy, Span& s) {
        const float t = (yy - (y + 6)) / ry;
        if (fabsf(t) > 1) return false;
        const float hw = rx * sqrtf(1 - t * t);
        s = {x - hw, x + hw};
        return true;
      }, r);
      return;
    }
    case Mouth::Wobble: {
      // Nervous: a wavering line that shimmers slightly.
      const float phase = now / 180.0f;
      float px = x - w * 0.8f, py = y;
      for (int i = 1; i <= 8; i++) {
        const float nx = x - w * 0.8f + (i / 8.0f) * w * 1.6f, ny = y + sinf(i * 1.6f + phase) * 2.5f;
        line(px, py, nx, ny, r * 0.9f, kLine);
        px = nx;
        py = ny;
      }
      return;
    }
    default:
      return;
  }
}

}  // namespace toki
