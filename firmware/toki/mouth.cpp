// Port of simulator/src/face/drawMouth.ts: a minimal mouth (decided 3 Oct).
#include <math.h>

#include "face.h"

namespace toki {

void drawMouth(M5Canvas& g, const AnimatedFace& f, const Tokens& tk, uint32_t now) {
  const int x = (int)lroundf(160 + tk.mouthX);
  const float y = tk.eyeY + f.offsetY + tk.mouthY + f.mouthShift;
  const float w = tk.mouthWidth / 2, r = tk.mouthWeight;
  auto line = [&](float x0, float y0, float x1, float y1, float rad, uint32_t c) {
    g.drawWideLine((int)lroundf(x0), (int)lroundf(y0), (int)lroundf(x1), (int)lroundf(y1), rad, c);
  };
  switch (f.mouth) {
    case Mouth::None:
      return;
    case Mouth::Line:
      line(x - w * 0.7f, y, x + w * 0.7f, y, r, kCream);
      return;
    case Mouth::Smile: {
      const float R = w * 1.3f;
      g.fillArc(x, (int)lroundf(y - R * 0.55f), (int)lroundf(R - r), (int)lroundf(R + r), 35, 145, kCream);
      return;
    }
    case Mouth::O:
      g.fillEllipse(x, (int)lroundf(y), (int)lroundf(w * 0.55f + r), (int)lroundf(w * 0.7f + r), kCream);
      g.fillEllipse(x, (int)lroundf(y), (int)lroundf(w * 0.55f - r * 0.6f), (int)lroundf(w * 0.7f - r * 0.6f), kGround);
      return;
    case Mouth::Pout: {
      const float R = w * 0.9f;
      g.fillArc(x, (int)lroundf(y + R * 0.6f), (int)lroundf(R - r), (int)lroundf(R + r), 215, 325, kCream);
      return;
    }
    case Mouth::Tongue: {
      const float R = w * 1.1f;
      g.fillArc(x, (int)lroundf(y - R * 0.55f), (int)lroundf(R - r), (int)lroundf(R + r), 40, 140, kCream);
      const float side = tk.tongueSide;
      g.fillCircle((int)lroundf(x + R * 0.55f * side), (int)lroundf(y + R * (side != 0 ? 0.55f : 0.75f)), (int)lroundf(r * 2.2f), kTomato);
      return;
    }
    case Mouth::Yawn: {
      // A big, slow yawn: a tall oval that opens and closes once every 2.4 s.
      const float open = 0.55f + 0.45f * sinf(fminf(1, (now % 2400) / 1600.0f) * PI);
      const int cy = (int)lroundf(y + 6);
      g.fillEllipse(x, cy, (int)lroundf(w * 0.8f + r), (int)lroundf(w * 1.3f * open + r), kCream);
      g.fillEllipse(x, cy, (int)lroundf(w * 0.8f - r * 0.6f), (int)lroundf(fmaxf(1, w * 1.3f * open - r * 0.6f)), kInk);
      return;
    }
    case Mouth::Wobble: {
      const float phase = now / 180.0f;
      float px = x - w, py = y;
      for (int i = 1; i <= 8; i++) {
        const float nx = x - w + (i / 8.0f) * w * 2;
        const float ny = y + sinf(i * 1.6f + phase) * 2.5f;
        line(px, py, nx, ny, r * 0.8f, kCream);
        px = nx;
        py = ny;
      }
      return;
    }
  }
}

}  // namespace toki
