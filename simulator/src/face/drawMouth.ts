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
      // An open smile: a D on its back, navy inside, the tongue at the bottom.
      const top = y - w * 0.3;
      const half = w * 1.05;
      const depth = w * 1.3;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * (i / 20);
        pts.push([x + Math.cos(a) * half, top + Math.sin(a) * depth]);
      }
      g.fillPolygon(pts, c);
      const span = (yy: number): Span | null => {
        const t = (yy - top) / depth;
        if (t < 0 || t > 1) return null;
        const hw = half * Math.sqrt(1 - t * t);
        return [x - hw, x + hw];
      };
      tongue(g, x, top + depth * 0.42, top + depth, half * 0.62, span, r);
      return;
    }
    case "blep": {
      // The tongue out: a straight mouth, the tongue hanging below it.
      g.drawWideLine(x - w * 0.75, y, x + w * 0.75, y, r, c);
      const tw = w * 0.42;
      g.fillRect(x - tw, y, tw * 2, tw * 0.9, palette.tomato);
      g.fillCircle(x, y + tw * 0.9, tw, palette.tomato);
      g.drawWideLine(x, y, x, y + tw * 1.2, r * 0.45, c);
      return;
    }
    case "shout": {
      // Cross or shocked: an open mouth, wider at the bottom, a tongue inside.
      const tw = w * 0.45;
      const bw = w * 0.8;
      const h = w * 1.45;
      const quad: [number, number][] = [
        [x - tw, y - h * 0.4],
        [x + tw, y - h * 0.4],
        [x + bw, y + h * 0.6],
        [x - bw, y + h * 0.6],
      ];
      g.fillPolygon(quad, c);
      // Rounded corners, as in the reference: the edge stroked with a round pen.
      for (let i = 0; i < 4; i++) g.drawWideLine(quad[i][0], quad[i][1], quad[(i + 1) % 4][0], quad[(i + 1) % 4][1], r, c);
      const span = (yy: number): Span | null => {
        // The stroke puts the true edge a pen's width outside the quad, below it too.
        const t = (yy - (y - h * 0.4)) / h;
        if (t < 0 || yy > y + h * 0.6 + r) return null;
        const hw = tw + (bw - tw) * Math.min(t, 1) + r;
        return [x - hw, x + hw];
      };
      // Humps as wide as the mouth where they sit, so the tongue fills it, as in the reference.
      tongue(g, x, y + h * 0.6 - h * 0.55, y + h * 0.6 + r, tw + (bw - tw) * 0.6, span, r);
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
      const rx = w * 0.7;
      const ry = w * 1.1 * open;
      g.fillEllipse(x, y + 6, rx, ry, c);
      const span = (yy: number): Span | null => {
        const t = (yy - (y + 6)) / ry;
        if (Math.abs(t) > 1) return null;
        const hw = rx * Math.sqrt(1 - t * t);
        return [x - hw, x + hw];
      };
      tongue(g, x, y + 6 + ry * 0.25, y + 6 + ry, rx * 0.62, span, r);
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


/** A horizontal run of pixels: left and right x. */
type Span = [number, number];

/**
 * A tongue inside an open mouth (Gideon, 21 Oct: a properly shaped tongue, not an
 * ellipse): two rounded humps on top with a notch between them, a split down the
 * middle, and a body that fills the bottom of the mouth, following its outline.
 * Drawn as thin horizontal slices from `top` to `bottom`, each the tongue's width
 * at that height cut to the mouth's, shrunk by `inset` all round so navy runs
 * cleanly under and beside it (Gideon). The robot draws the same slices with
 * fillTriangle.
 */
function tongue(
  g: Gfx,
  cx: number,
  top: number,
  bottom: number,
  half: number,
  mouth: (y: number) => Span | null,
  inset: number,
) {
  // Two humps, just apart, so the notch between them is a clear U (Gideon).
  const rr = half * 0.46;
  const d = half - rr;
  // The mouth shrunk by `inset` in every direction: at each height, the narrowest
  // of the mouth's spans within `inset` above and below, less the disc's half-width there.
  const inner = (y: number): Span | null => {
    let l = -Infinity;
    let r = Infinity;
    for (let i = -4; i <= 4; i++) {
      const dy = (inset * i) / 4;
      const m = mouth(y + dy);
      if (!m) return null;
      const k = Math.sqrt(inset * inset - dy * dy);
      l = Math.max(l, m[0] + k);
      r = Math.min(r, m[1] - k);
    }
    return r > l ? [l, r] : null;
  };
  const spansAt = (y: number): Span[] => {
    const m = inner(y);
    if (!m) return [];
    const [l, r] = m;
    let parts: Span[] = [[-Infinity, Infinity]];
    const dy = y - (top + rr);
    if (dy < 0) {
      const hw = Math.sqrt(Math.max(0, rr * rr - dy * dy));
      parts = [
        [cx - d - hw, cx - d + hw],
        [cx + d - hw, cx + d + hw],
      ];
      if (parts[0][1] >= parts[1][0]) parts = [[parts[0][0], parts[1][1]]];
      else if (parts[1][0] - parts[0][1] < 1.2) parts = [[parts[0][0], cx - 0.6], [cx + 0.6, parts[1][1]]];
    }
    return parts.map(([a, b]): Span => [Math.max(a, l), Math.min(b, r)]).filter(([a, b]) => b > a);
  };
  // Whole-pixel slices, as on the robot (half-pixel edges let the navy show through).
  let prevY = Math.round(top);
  let prev = spansAt(prevY);
  for (let yy = prevY + 1; yy <= Math.round(bottom); yy++) {
    const cur = spansAt(yy);
    if (cur.length === prev.length) {
      cur.forEach((s, i) =>
        g.fillPolygon(
          [
            [prev[i][0], prevY],
            [prev[i][1], prevY],
            [s[1], yy],
            [s[0], yy],
          ],
          palette.tomato,
        ),
      );
    } else prev.forEach((s) => g.fillRect(s[0], prevY, s[1] - s[0], yy - prevY, palette.tomato));
    prev = cur;
    prevY = yy;
  }
  // The split down the middle, in navy so it reads as a gap (Gideon): from the
  // notch to about two thirds of the way down.
  g.drawWideLine(cx, top + rr * 0.5, cx, top + (bottom - top) * 0.68, Math.max(1, half * 0.09), palette.line);
}
