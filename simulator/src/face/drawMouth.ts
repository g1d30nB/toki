import type { AnimatedFace } from "./animator";
import type { Gfx } from "./gfx";
import { palette } from "./palette";
import type { FaceTokens } from "./tokens";

// Mouths, kawaii pass (Gideon, 21 Oct): thin navy lines the weight of the brows,
// and bolder shapes where the face needs them: an open smile with a tongue, the
// tongue out, a cat's ω, an open shout. Insides are navy; tongues tomato.

export function drawMouth(g: Gfx, f: AnimatedFace, tk: FaceTokens, now: number) {
  // Anchored on the face's centre line; mouthX is a deliberate offset (default 0).
  const x = 160 + tk.mouthX;
  const y = tk.eyeY + f.offsetY + tk.mouthY + f.mouthShift;
  const w = tk.mouthWidth / 2;
  const r = tk.mouthWeight;
  const c = palette.line;
  const arc = (cx: number, cy: number, R: number, from: number, to: number, weight = r) => {
    const n = 14;
    let px = cx + Math.cos((from * Math.PI) / 180) * R;
    let py = cy + Math.sin((from * Math.PI) / 180) * R;
    for (let i = 1; i <= n; i++) {
      const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      const nx = cx + Math.cos(a) * R;
      const ny = cy + Math.sin(a) * R;
      g.drawWideLine(px, py, nx, ny, weight, c);
      px = nx;
      py = ny;
    }
  };
  switch (f.mouth) {
    case "none":
      return;
    case "line":
      g.drawWideLine(x - w * 0.55, y, x + w * 0.55, y, r, c);
      return;
    case "smile":
      // The bottom of a circle: a small U.
      arc(x, y - w * 0.5, w * 0.82, 28, 152);
      return;
    case "pout":
      // A small frown: an n.
      arc(x, y + w * 0.55, w * 0.7, 205, 335);
      return;
    case "o":
      g.fillEllipse(x, y, w * 0.4 + r, w * 0.55 + r, c);
      g.fillEllipse(x, y, Math.max(1, w * 0.4 - r * 0.7), Math.max(1, w * 0.55 - r * 0.7), palette.face);
      return;
    case "cat": {
      // ω: two small smiles side by side.
      const R = w * 0.38;
      arc(x - R, y - R * 0.5, R, 15, 165);
      arc(x + R, y - R * 0.5, R, 15, 165);
      return;
    }
    case "open": {
      // An open smile: a D on its back, navy inside, a tomato tongue at the bottom.
      const top = y - w * 0.3;
      const half = w * 1.05;
      const depth = w * 1.3;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * (i / 20);
        pts.push([x + Math.cos(a) * half, top + Math.sin(a) * depth]);
      }
      g.fillPolygon(pts, c);
      g.fillEllipse(x, top + depth * 0.72, half * 0.55, depth * 0.24, palette.tomato);
      return;
    }
    case "blep": {
      // The tongue out: a straight mouth, the tongue hanging below it.
      g.drawWideLine(x - w * 0.75, y, x + w * 0.75, y, r, c);
      const tw = w * 0.42;
      g.fillRect(x - tw, y, tw * 2, tw * 0.9, palette.tomato);
      g.fillCircle(x, y + tw * 0.9, tw, palette.tomato);
      g.drawWideLine(x, y + r, x, y + tw * 1.2, r * 0.5, mixLine());
      return;
    }
    case "shout": {
      // Cross or shocked: an open mouth, wider at the bottom, a tongue inside.
      const tw = w * 0.5;
      const bw = w * 0.75;
      const h = w * 1.1;
      g.fillPolygon(
        [
          [x - tw, y - h * 0.4],
          [x + tw, y - h * 0.4],
          [x + bw, y + h * 0.6],
          [x - bw, y + h * 0.6],
        ],
        c,
      );
      g.fillEllipse(x, y + h * 0.45, bw * 0.6, h * 0.18, palette.tomato);
      return;
    }
    case "tongue": {
      // Concentration: a small smile with the tongue poking out of one corner.
      arc(x, y - w * 0.45, w * 0.7, 30, 150);
      // tongueSide: 1 pokes out of the right corner, -1 the left, 0 the middle.
      g.fillCircle(x + w * 0.5 * tk.tongueSide, y + w * (tk.tongueSide ? 0.32 : 0.4), r * 2.4, palette.tomato);
      return;
    }
    case "yawn": {
      // A big, slow yawn: a tall oval that opens and closes once every 2.4 s.
      const open = 0.55 + 0.45 * Math.sin(Math.min(1, (now % 2_400) / 1_600) * Math.PI);
      g.fillEllipse(x, y + 6, w * 0.7, w * 1.1 * open, c);
      g.fillEllipse(x, y + 6 + w * 0.6 * open, w * 0.45, Math.max(1, w * 0.3 * open), palette.tomato);
      return;
    }
    case "wobble": {
      // Nervous: a wavering line that shimmers slightly.
      const phase = now / 180;
      let px = x - w * 0.8;
      let py = y;
      for (let i = 1; i <= 8; i++) {
        const nx = x - w * 0.8 + (i / 8) * w * 1.6;
        const ny = y + Math.sin(i * 1.6 + phase) * 2.5;
        g.drawWideLine(px, py, nx, ny, r * 0.9, c);
        px = nx;
        py = ny;
      }
      return;
    }
  }
}

/** The groove down the middle of the tongue: a darker tomato. */
const mixLine = () => "#b8401f";
