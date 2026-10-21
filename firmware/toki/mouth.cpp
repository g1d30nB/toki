// Port of simulator/src/face/drawMouth.ts, kawaii pass (Gideon, 21 Oct): thin navy
// lines the weight of the brows, and bolder shapes where the face needs them: an
// open smile with a tongue, the tongue out, a cat's ω, an open shout.
#include <math.h>

#include "face.h"

namespace toki {

namespace {
inline int ri(float v) { return (int)lroundf(v); }
constexpr uint32_t kTongueGroove = 0xb8401f;  // a darker tomato, down the middle of the tongue
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
      g.fillEllipse(ri(x), ri(y), ri(w * 0.4f + r), ri(w * 0.55f + r), kLine);
      g.fillEllipse(ri(x), ri(y), ri(fmaxf(1, w * 0.4f - r * 0.7f)), ri(fmaxf(1, w * 0.55f - r * 0.7f)), kFace);
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
      g.fillEllipse(ri(x), ri(top + depth * 0.72f), ri(half * 0.55f), ri(depth * 0.24f), kTomato);
      return;
    }
    case Mouth::Blep: {
      // The tongue out: a straight mouth, the tongue hanging below it.
      line(x - w * 0.75f, y, x + w * 0.75f, y, r, kLine);
      const float tw = w * 0.42f;
      g.fillRect(ri(x - tw), ri(y), ri(tw * 2), ri(tw * 0.9f), kTomato);
      g.fillCircle(ri(x), ri(y + tw * 0.9f), ri(tw), kTomato);
      line(x, y + r, x, y + tw * 1.2f, r * 0.5f, kTongueGroove);
      return;
    }
    case Mouth::Shout: {
      // Cross or shocked: an open mouth, wider at the bottom, a tongue inside.
      const float tw = w * 0.5f, bw = w * 0.75f, h = w * 1.1f;
      g.fillTriangle(ri(x - tw), ri(y - h * 0.4f), ri(x + tw), ri(y - h * 0.4f), ri(x + bw), ri(y + h * 0.6f), kLine);
      g.fillTriangle(ri(x - tw), ri(y - h * 0.4f), ri(x + bw), ri(y + h * 0.6f), ri(x - bw), ri(y + h * 0.6f), kLine);
      g.fillEllipse(ri(x), ri(y + h * 0.45f), ri(bw * 0.6f), ri(h * 0.18f), kTomato);
      return;
    }
    case Mouth::Tongue: {
      arc(x, y - w * 0.45f, w * 0.7f, 30, 150);
      g.fillCircle(ri(x + w * 0.5f * tk.tongueSide), ri(y + w * (tk.tongueSide != 0 ? 0.32f : 0.4f)), ri(r * 2.4f), kTomato);
      return;
    }
    case Mouth::Yawn: {
      // A big, slow yawn: a tall oval that opens and closes once every 2.4 s.
      const float p = fminf(1, (now % 2400) / 1600.0f);
      const float open = 0.55f + 0.45f * sinf(p * PI);
      g.fillEllipse(ri(x), ri(y + 6), ri(w * 0.7f), ri(w * 1.1f * open), kLine);
      g.fillEllipse(ri(x), ri(y + 6 + w * 0.6f * open), ri(w * 0.45f), ri(fmaxf(1, w * 0.3f * open)), kTomato);
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
