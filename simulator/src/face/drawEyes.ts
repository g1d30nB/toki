import type { AnimatedFace } from "./animator";
import type { Gfx } from "./gfx";
import { palette } from "./palette";
import type { FaceTokens } from "./tokens";

// Treatment B, "sticker-sheet character" (spec §7.2): round eyes with an amber
// iris and highlights, navy linework, and a cream die-cut border so the navy
// outline still reads against the navy ground. Only M5GFX primitives are used.

export type Eye = { cx: number; cy: number; rx: number; ry: number; side: -1 | 1 };

/** Where a straight lid line crosses the eye's outer ellipse, if it does. */
function chord(e: Eye, outer: number, y0: number, slope: number): [number, number] | null {
  const A = e.rx + outer;
  const B = e.ry + outer;
  const d = y0 - e.cy;
  const a = 1 / (A * A) + (slope * slope) / (B * B);
  const b = (2 * d * slope) / (B * B);
  const c = (d * d) / (B * B) - 1;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  const r = Math.sqrt(disc);
  return [(-b - r) / (2 * a), (-b + r) / (2 * a)];
}

/** Draws a lid edge: cover one side of the line with ground, then redraw the line as linework. */
function lid(g: Gfx, e: Eye, tk: FaceTokens, y0: number, slope: number, coverAbove: boolean) {
  const outer = tk.outline + tk.border;
  const left = e.cx - e.rx - outer - 1;
  const top = e.cy - e.ry - outer - 1;
  const w = (e.rx + outer + 1) * 2;
  const h = (e.ry + outer + 1) * 2;
  const yAt = (x: number) => y0 + slope * (x - e.cx);

  g.setClipRect(left, top, w, h);
  const yl = yAt(left);
  const yr = yAt(left + w);
  if (coverAbove) {
    g.fillRect(left, top, w, Math.max(0, Math.min(yl, yr) - top), palette.ground);
    g.fillTriangle(left, Math.min(yl, yr), left + w, Math.min(yl, yr), yl < yr ? left + w : left, Math.max(yl, yr), palette.ground);
  } else {
    const bottom = top + h;
    g.fillRect(left, Math.max(yl, yr), w, Math.max(0, bottom - Math.max(yl, yr)), palette.ground);
    g.fillTriangle(left, Math.max(yl, yr), left + w, Math.max(yl, yr), yl > yr ? left + w : left, Math.min(yl, yr), palette.ground);
  }
  g.clearClipRect();

  // The lid edge runs along the outline's centreline, so it joins the outline cleanly.
  const ch = chord(e, tk.outline / 2, y0, slope);
  if (!ch) return;
  const [u0, u1] = ch;
  const x0 = e.cx + u0;
  const x1 = e.cx + u1;
  // The cream die-cut border sits only on the covered (outside) side of the lid,
  // never inside the eye, where it would draw a pale band across the iris.
  const shift = (coverAbove ? -1 : 1) * (tk.border / 2);
  g.drawWideLine(x0, yAt(x0) + shift, x1, yAt(x1) + shift, tk.outline / 2 + tk.border / 2, palette.cream);
  g.drawWideLine(x0, yAt(x0), x1, yAt(x1), tk.outline / 2, palette.ink);
}

function roundEye(g: Gfx, e: Eye, f: AnimatedFace, tk: FaceTokens, sparkle: boolean) {
  const open = Math.min(f.open, 1);
  if (open < 0.08) return closedEye(g, e, tk);

  // Die-cut border, navy outline, cream eye.
  g.fillEllipse(e.cx, e.cy, e.rx + tk.outline + tk.border, e.ry + tk.outline + tk.border, palette.cream);
  g.fillEllipse(e.cx, e.cy, e.rx + tk.outline, e.ry + tk.outline, palette.ink);
  g.fillEllipse(e.cx, e.cy, e.rx, e.ry, palette.cream);

  // Iris and pupil, kept inside the eye.
  const ir = tk.irisR * f.pupilScale * Math.min(1, e.rx / tk.eyeRx);
  const travelX = Math.max(0, e.rx - ir - 3);
  const travelY = Math.max(0, e.ry - ir - 3);
  const ix = e.cx + f.pupilX * travelX + f.saccadeX;
  const iy = e.cy + f.pupilY * travelY + f.saccadeY;
  g.fillCircle(ix, iy, ir, palette.mustard);
  g.fillCircle(ix, iy, Math.max(2, ir * (tk.pupilR / tk.irisR)), palette.ink);
  // The shine scales with the eye, so a small eye (asked) keeps its proportions.
  const hr = tk.highlightR * f.highlight * Math.min(1, e.rx / tk.eyeRx);
  g.fillCircle(ix - ir * 0.36, iy - ir * 0.4, hr, palette.cream);
  g.fillCircle(ix + ir * 0.34, iy + ir * 0.34, hr * 0.45, palette.cream);
  if (sparkle) {
    // A four-point star in the highlight: reserved for success moments.
    const sx = ix - ir * 0.36;
    const sy = iy - ir * 0.4;
    const L = tk.highlightR * 2.2;
    const w = tk.highlightR * 0.55;
    g.fillTriangle(sx - L, sy, sx + L, sy, sx, sy - w, palette.cream);
    g.fillTriangle(sx - L, sy, sx + L, sy, sx, sy + w, palette.cream);
    g.fillTriangle(sx, sy - L, sx, sy + L, sx - w, sy, palette.cream);
    g.fillTriangle(sx, sy - L, sx, sy + L, sx + w, sy, palette.cream);
  }

  // Top lid: level; it only opens and closes (brows carry the emotion).
  if (open < 0.99) {
    // At open = 1 the lid sits on the top of the eye; at 0 it has come 60% of the way down.
    const y0 = e.cy - e.ry + (1 - open) * e.ry * 2 * 0.6;
    lid(g, e, tk, y0, 0, true);
  }
  if (f.smile > 0.01) smileLid(g, e, tk, f.smile);
  // Lower lid: rises when squinting.
  if (f.squint > 0.01) {
    const y0 = e.cy + e.ry - f.squint * e.ry;
    lid(g, e, tk, y0, 0, false);
  }
}

/**
 * The part of an ellipse that lies inside a circle, as a polygon: a vertical
 * strip sampled across the ellipse's width.
 */
function ellipseInsideCircle(e: Eye, A: number, B: number, cx0: number, cy0: number, R: number, steps = 28): [number, number][] {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = -A + (2 * A * i) / steps;
    const ey = B * Math.sqrt(Math.max(0, 1 - (x * x) / (A * A)));
    const dx = e.cx + x - cx0;
    if (Math.abs(dx) >= R) continue;
    const cyH = Math.sqrt(R * R - dx * dx);
    const t = Math.max(e.cy - ey, cy0 - cyH);
    const b = Math.min(e.cy + ey, cy0 + cyH);
    if (t >= b) continue;
    top.push([e.cx + x, t]);
    bottom.push([e.cx + x, b]);
  }
  return [...top, ...bottom.reverse()];
}

/**
 * Smiling lower lid: the bottom of the eye itself takes a gentle upward curve.
 * The eye is clipped to the curve, and the outline and die-cut border follow it,
 * exactly as they follow the rest of the eye. No stroke is drawn inside the eye.
 */
function smileLid(g: Gfx, e: Eye, tk: FaceTokens, amount: number) {
  const o = tk.outline;
  const bd = tk.border;
  const R = e.rx * tk.smileCurve;
  const topY = e.cy + e.ry - amount * e.ry * 2; // where the curve crosses the middle of the eye
  const cy0 = topY + R;
  // Inside the circle is below the curve. Rings, from the eye outwards:
  // navy outline, then cream border, then the ground.
  g.fillPolygon(ellipseInsideCircle(e, e.rx + o, e.ry + o, e.cx, cy0, R), palette.ink);
  g.fillPolygon(ellipseInsideCircle(e, e.rx + o + bd, e.ry + o + bd, e.cx, cy0, R - o), palette.cream);
  g.fillPolygon(ellipseInsideCircle(e, e.rx + o + bd + 1, e.ry + o + bd + 1, e.cx, cy0, R - o - bd), palette.ground);
}

function closedEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const y = e.cy + e.ry * 0.2;
  g.drawWideLine(e.cx - e.rx, y, e.cx + e.rx, y, tk.outline / 2 + tk.border, palette.cream);
  g.drawWideLine(e.cx - e.rx, y, e.cx + e.rx, y, tk.outline / 2, palette.ink);
}

/** Spiral eyes: a dizzy moment before > < (error). */
function spiralEye(g: Gfx, e: Eye, tk: FaceTokens, t: number) {
  g.fillEllipse(e.cx, e.cy, e.rx + tk.outline + tk.border, e.ry + tk.outline + tk.border, palette.cream);
  g.fillEllipse(e.cx, e.cy, e.rx + tk.outline, e.ry + tk.outline, palette.ink);
  g.fillEllipse(e.cx, e.cy, e.rx, e.ry, palette.cream);
  const turns = 2.5;
  const steps = 40;
  const spin = (t / 160) * e.side;
  let px = e.cx;
  let py = e.cy;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2 + spin;
    const rr = (i / steps) * 0.82;
    const x = e.cx + Math.cos(a) * e.rx * rr;
    const y = e.cy + Math.sin(a) * e.ry * rr;
    g.drawWideLine(px, py, x, y, tk.outline / 2, palette.ink);
    px = x;
    py = y;
  }
}

/** Happy arcs: ^ ^ (done). */
function arcEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const cy = e.cy + e.ry * 0.45;
  const r = e.rx;
  const t = tk.outline + 4;
  g.fillArc(e.cx, cy, r - t / 2 - tk.border, r + t / 2 + tk.border, 200, 340, palette.cream);
  g.fillArc(e.cx, cy, r - t / 2, r + t / 2, 202, 338, palette.ink);
}

/**
 * Content closed eyes: a downward curve, like a sleeping smile (quiet, sleepy,
 * night). The curve sits a little above the eye's centre.
 */
function sleepEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const r = e.rx * 0.85;
  const cy = e.cy - e.ry * 0.3;
  const t = tk.outline + 2;
  g.fillArc(e.cx, cy, r - t / 2 - tk.border, r + t / 2 + tk.border, 22, 158, palette.cream);
  g.fillArc(e.cx, cy, r - t / 2, r + t / 2, 24, 156, palette.ink);
}

/** Points round a four-point star with slightly concave sides (a superellipse below 1). */
export function starPoints(x: number, y: number, R: number, concave: number, n = 32): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([x + Math.sign(c) * Math.abs(c) ** (2 / concave) * R, y + Math.sign(s) * Math.abs(s) ** (2 / concave) * R]);
  }
  return pts;
}

/**
 * Star eyes (day closed, earned; tests pass later): the eye itself becomes a
 * mustard four-point star, with the same navy outline and cream die-cut border
 * as the round eye, and one highlight.
 */
function starEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const R = e.ry * 1.05;
  const pts = starPoints(e.cx, e.cy, R, tk.sparkleConcave);
  const ring = (r: number, c: string) => {
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      g.drawWideLine(x0, y0, x1, y1, r, c);
    }
  };
  ring(tk.outline / 2 + tk.border, palette.cream);
  g.fillPolygon(pts, palette.mustard);
  ring(tk.outline / 2, palette.ink);
  g.fillCircle(e.cx - R * 0.16, e.cy - R * 0.18, tk.highlightR * 0.9, palette.cream);
}

/** Squeezed chevrons: > < (error). */
function chevronEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const dx = e.rx * 0.75 * -e.side; // left eye points right (>), right eye points left (<)
  const h = e.ry * 0.55;
  const tipX = e.cx + dx * 0.6;
  const backX = e.cx - dx * 0.6;
  for (const [r, c] of [
    [tk.outline / 2 + tk.border, palette.cream],
    [tk.outline / 2, palette.ink],
  ] as const) {
    g.drawWideLine(backX, e.cy - h, tipX, e.cy, r, c);
    g.drawWideLine(tipX, e.cy, backX, e.cy + h, r, c);
  }
}

/** Brows: one short stroke per eye. Angle lifts the inner ends; tilt raises the right brow only. */
function brow(g: Gfx, e: Eye, f: AnimatedFace, tk: FaceTokens) {
  const a = ((f.brows.angle + (e.side === 1 ? f.brows.tilt : 0)) * Math.PI) / 180;
  const y = e.cy - e.ry - tk.outline - tk.border - tk.browGap - f.brows.y;
  const half = (tk.browLength * (f.brows.len ?? 1)) / 2;
  if (half < 1) return; // brows.len 0: no brows (the small asked face)
  const ix = e.cx - e.side * half * Math.cos(a); // inner end, towards the middle of the face
  const iy = y - half * Math.sin(a);
  const ox = e.cx + e.side * half * Math.cos(a);
  const oy = y + half * Math.sin(a);
  // Solid cream: a navy-cored stroke read as a hollow pill against the navy ground.
  g.drawWideLine(ix, iy, ox, oy, tk.browWeight, palette.cream);
}

/** Where the eyes are this frame: manpu and the mouth position themselves from these. */
export function eyeLayout(f: AnimatedFace, tk: FaceTokens): Eye[] {
  const wide = Math.max(0, f.open - 1);
  // Roundness pulls the width towards the height: 1 is a circle.
  const baseRx = tk.eyeRx + (Math.max(tk.eyeRx, tk.eyeRy) - tk.eyeRx) * f.roundness;
  return ([-1, 1] as const).map((side) => ({
    cx: 160 + (side * tk.eyeSpacing) / 2,
    cy: tk.eyeY + f.offsetY,
    rx: (baseRx * f.scale * (1 + wide * 0.6)) / Math.sqrt(f.stretch),
    ry: tk.eyeRy * f.scale * (1 + wide * 0.8) * f.stretch,
    side,
  }));
}

export function drawEyes(g: Gfx, f: AnimatedFace, tk: FaceTokens, now = 0) {
  for (const e of eyeLayout(f, tk)) {
    brow(g, e, f, tk);
    if (f.shape === "spiral") spiralEye(g, e, tk, now);
    else if (f.shape === "arc") arcEye(g, e, tk);
    else if (f.shape === "line") chevronEye(g, e, tk);
    else if (f.shape === "sleep") sleepEye(g, e, tk);
    else if (f.shape === "star") starEye(g, e, tk);
    else roundEye(g, e, f, tk, f.shape === "sparkle");
  }
}
