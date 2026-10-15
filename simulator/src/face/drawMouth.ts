import type { AnimatedFace } from "./animator";
import type { Gfx } from "./gfx";
import { palette } from "./palette";
import type { FaceTokens } from "./tokens";

// Minimal mouth (spec §4.1): small cream strokes under the eyes, the same weight
// as the brows. It's a secondary cue: the eyes still carry the face.

export function drawMouth(g: Gfx, f: AnimatedFace, tk: FaceTokens, now: number) {
  // Anchored on the face's centre line; mouthX is a deliberate offset (default 0).
  const x = 160 + tk.mouthX;
  const y = tk.eyeY + f.offsetY + tk.mouthY + f.mouthShift;
  const w = tk.mouthWidth / 2;
  const r = tk.mouthWeight;
  const c = palette.cream;
  switch (f.mouth) {
    case "none":
      return;
    case "line":
      g.drawWideLine(x - w * 0.7, y, x + w * 0.7, y, r, c);
      return;
    case "smile": {
      // The bottom of a circle: a gentle U.
      const R = w * 1.3;
      g.fillArc(x, y - R * 0.55, R - r, R + r, 35, 145, c);
      return;
    }
    case "o":
      g.fillEllipse(x, y, w * 0.55 + r, w * 0.7 + r, c);
      g.fillEllipse(x, y, w * 0.55 - r * 0.6, w * 0.7 - r * 0.6, palette.ground);
      return;
    case "pout": {
      // A small upturned curve: an n.
      const R = w * 0.9;
      g.fillArc(x, y + R * 0.6, R - r, R + r, 215, 325, c);
      return;
    }
    case "tongue": {
      // Concentration: a small smile with the tongue poking out of one corner.
      const R = w * 1.1;
      g.fillArc(x, y - R * 0.55, R - r, R + r, 40, 140, c);
      // tongueSide: 1 pokes out of the right corner, -1 the left, 0 the middle.
      g.fillCircle(x + R * 0.55 * tk.tongueSide, y + R * (tk.tongueSide ? 0.55 : 0.75), r * 2.2, palette.tomato);
      return;
    }
    case "yawn": {
      // A big, slow yawn: a tall oval that opens and closes once every 2.4 s.
      const open = 0.55 + 0.45 * Math.sin(Math.min(1, (now % 2_400) / 1_600) * Math.PI);
      g.fillEllipse(x, y + 6, w * 0.8 + r, w * 1.3 * open + r, c);
      g.fillEllipse(x, y + 6, w * 0.8 - r * 0.6, Math.max(1, w * 1.3 * open - r * 0.6), palette.ink);
      return;
    }
    case "wobble": {
      // Nervous: a wavering line that shimmers slightly.
      const phase = now / 180;
      let px = x - w;
      let py = y;
      for (let i = 1; i <= 8; i++) {
        const nx = x - w + (i / 8) * w * 2;
        const ny = y + Math.sin(i * 1.6 + phase) * 2.5;
        g.drawWideLine(px, py, nx, ny, r * 0.8, c);
        px = nx;
        py = ny;
      }
      return;
    }
  }
}
