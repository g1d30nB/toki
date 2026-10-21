import type { AnimatedFace } from "./animator";
import type { Gfx } from "./gfx";
import { palette } from "./palette";
import type { FaceTokens } from "./tokens";

// Kawaii pass (Gideon, 21 Oct; his kawaii sticker sheet): dark features on a cream
// screen. An open eye is a solid navy disc with two white shines, big top right and
// small bottom left; it has no separate pupil, so when Toki looks the whole eye
// moves a little (lookTravel). Closed eyes are thin, even lines: a blink, ^, > <,
// a sleepy curve (with lashes when content), a spiral. Only M5GFX primitives.

export type Eye = { cx: number; cy: number; rx: number; ry: number; side: -1 | 1 };

/** Where a straight line crosses the eye's ellipse, if it does. */
function chord(e: Eye, y0: number, slope: number): [number, number] | null {
  const A = e.rx;
  const B = e.ry;
  const d = y0 - e.cy;
  const a = 1 / (A * A) + (slope * slope) / (B * B);
  const b = (2 * d * slope) / (B * B);
  const c = (d * d) / (B * B) - 1;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  const r = Math.sqrt(disc);
  return [(-b - r) / (2 * a), (-b + r) / (2 * a)];
}

/** A lid: cover one side of a straight line with the screen, then draw the line across the eye. */
function lid(g: Gfx, e: Eye, tk: FaceTokens, y0: number, slope: number, coverAbove: boolean) {
  const left = e.cx - e.rx - 2;
  const top = e.cy - e.ry - 2;
  const w = (e.rx + 2) * 2;
  const h = (e.ry + 2) * 2;
  const yAt = (x: number) => y0 + slope * (x - e.cx);
  g.setClipRect(left, top, w, h);
  const yl = yAt(left);
  const yr = yAt(left + w);
  if (coverAbove) {
    g.fillRect(left, top, w, Math.max(0, Math.min(yl, yr) - top), palette.face);
    g.fillTriangle(left, Math.min(yl, yr), left + w, Math.min(yl, yr), yl < yr ? left + w : left, Math.max(yl, yr), palette.face);
  } else {
    const bottom = top + h;
    g.fillRect(left, Math.max(yl, yr), w, Math.max(0, bottom - Math.max(yl, yr)), palette.face);
    g.fillTriangle(left, Math.max(yl, yr), left + w, Math.max(yl, yr), yl > yr ? left + w : left, Math.min(yl, yr), palette.face);
  }
  g.clearClipRect();
  // The lid's edge: a line across the eye, a little wider than it, as a drawn lid would be.
  const ch = chord(e, y0, slope);
  if (!ch) return;
  const over = tk.lineWeight;
  const x0 = e.cx + ch[0] - over;
  const x1 = e.cx + ch[1] + over;
  g.drawWideLine(x0, yAt(x0), x1, yAt(x1), tk.lineWeight, palette.line);
}

function roundEye(g: Gfx, base: Eye, f: AnimatedFace, tk: FaceTokens, sparkle: boolean) {
  const open = Math.min(f.open, 1);
  if (open < 0.08) return closedEye(g, base, tk);
  // No separate pupil: looking moves the whole eye a little.
  const e: Eye = { ...base, cx: base.cx + f.pupilX * tk.lookTravel + f.saccadeX, cy: base.cy + f.pupilY * tk.lookTravel + f.saccadeY };
  g.fillEllipse(e.cx, e.cy, e.rx, e.ry, palette.line);

  // The shines, the kawaii signature (Gideon's reference, 21 Oct): a big one top
  // left, a medium one on the right and a small one low in the middle while the eye
  // is fully round; once a lid narrows it (from the top or the bottom), the medium
  // one goes and two remain. They scale with the eye; `highlight` makes them glossier.
  const r = Math.min(e.rx, e.ry);
  const glossy = Math.min(1.3, f.highlight);
  const narrowed = open < 0.99 || f.smile > 0.01 || f.squint > 0.01 || Math.abs(f.lidTilt) > 0.5;
  let big = r * tk.shineBig * f.highlight;
  let bx = e.cx - e.rx * 0.15;
  let by = e.cy - e.ry * 0.22;
  let sx = e.cx + e.rx * 0.04;
  let sy = e.cy + e.ry * 0.5;
  if (narrowed) {
    // Two shines, side by side in the part of the eye still showing: the top half
    // of smiling eyes, the bottom half of cross or half-lidded ones.
    const top = open < 0.99 ? e.cy - e.ry + (1 - open) * e.ry * 2 * 0.6 : e.cy - e.ry;
    const bottom = Math.min(e.cy + e.ry, f.smile > 0.01 ? e.cy + e.ry - f.smile * e.ry * 2 : e.cy + e.ry, f.squint > 0.01 ? e.cy + e.ry - f.squint * e.ry : e.cy + e.ry);
    const mid = (top + bottom) / 2;
    big = Math.min(big, (bottom - top) * 0.3);
    by = mid - (bottom - top) * 0.06;
    sx = e.cx + e.rx * 0.38;
    sy = mid + (bottom - top) * 0.12;
  }
  if (sparkle) {
    // Success: the big shine becomes a four-point star.
    g.fillPolygon(starPoints(bx, by, big * 1.5, 0.7), palette.shine);
  } else g.fillCircle(bx, by, big, palette.shine);
  if (!narrowed) g.fillCircle(e.cx + e.rx * 0.5, e.cy + e.ry * 0.14, r * tk.shineMid * glossy, palette.shine);
  g.fillCircle(sx, sy, r * tk.shineSmall * glossy, palette.shine);

  // Top lid: it opens and closes (half-lidded faces, blinks), and slants down
  // towards the nose for a scowl (lidTilt).
  if (open < 0.99 || Math.abs(f.lidTilt) > 0.5) {
    const y0 = e.cy - e.ry + (1 - open) * e.ry * 2 * 0.6;
    lid(g, e, tk, y0, -e.side * Math.tan((f.lidTilt * Math.PI) / 180), true);
  }
  if (f.smile > 0.01) smileLid(g, e, tk, f.smile);
  // Lower lid: rises when squinting.
  if (f.squint > 0.01) lid(g, e, tk, e.cy + e.ry - f.squint * e.ry, 0, false);
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

/** Smiling eyes: the bottom of the eye is cut away by an upward curve, a happy squint. */
function smileLid(g: Gfx, e: Eye, tk: FaceTokens, amount: number) {
  const R = e.rx * tk.smileCurve;
  const topY = e.cy + e.ry - amount * e.ry * 2; // where the curve crosses the middle of the eye
  g.fillPolygon(ellipseInsideCircle(e, e.rx + 1, e.ry + 1, e.cx, topY + R, R), palette.face);
}

/** A blink: one thin line. */
function closedEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const y = e.cy + e.ry * 0.2;
  g.drawWideLine(e.cx - e.rx * 0.8, y, e.cx + e.rx * 0.8, y, tk.lineWeight, palette.line);
}

/** Draws a curve through the points as one even line. */
function polyline(g: Gfx, pts: [number, number][], r: number, c: string) {
  for (let i = 1; i < pts.length; i++) g.drawWideLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r, c);
}

/** Points along a circle's arc, degrees clockwise from the right (y down). */
function arcPoints(cx: number, cy: number, r: number, from: number, to: number, n = 16): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });
}

/** Spiral eyes: a dizzy moment before > < (error). */
function spiralEye(g: Gfx, e: Eye, tk: FaceTokens, t: number) {
  const turns = 2.5;
  const steps = 40;
  const spin = (t / 160) * e.side;
  const pts: [number, number][] = [[e.cx, e.cy]];
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2 + spin;
    const rr = (i / steps) * 0.9;
    pts.push([e.cx + Math.cos(a) * e.rx * rr, e.cy + Math.sin(a) * e.ry * rr]);
  }
  polyline(g, pts, tk.lineWeight, palette.line);
}

/** Happy arcs: ^ ^ (done). */
function arcEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const r = e.rx * 0.78;
  polyline(g, arcPoints(e.cx, e.cy + e.ry * 0.35, r, 200, 340), tk.lineWeight * 1.15, palette.line);
}

/** Content closed eyes: a downward curve, like a sleeping smile (quiet, sleepy, night). */
function sleepEye(g: Gfx, e: Eye, tk: FaceTokens, lashes: boolean) {
  const r = e.rx * 0.8;
  const cy = e.cy - e.ry * 0.15;
  polyline(g, arcPoints(e.cx, cy, r, 20, 160), tk.lineWeight * 1.15, palette.line);
  if (!lashes) return;
  // Three short lashes fanning out and up from the outer end of the curve, each
  // starting a little further along it (the reference's content face).
  for (let k = 0; k < 3; k++) {
    // From just inside the end of the curve, fanning outwards: down-out, out, up-out.
    const along = ((e.side === 1 ? 24 - k * 4 : 156 + k * 4) * Math.PI) / 180;
    const ox = e.cx + Math.cos(along) * r;
    const oy = cy + Math.sin(along) * r;
    const up = ((-30 + k * 36) * Math.PI) / 180;
    const L = tk.lashLen * (1 - k * 0.08);
    g.drawWideLine(ox, oy, ox + e.side * Math.cos(up) * L, oy - Math.sin(up) * L, tk.lineWeight * 0.85, palette.line);
  }
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

/** Star eyes (day closed, earned): the eye becomes a mustard four-point star, outlined, with one shine. */
function starEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const R = e.ry * 1.05;
  const pts = starPoints(e.cx, e.cy, R, tk.sparkleConcave);
  g.fillPolygon(pts, palette.mustard);
  polyline(g, [...pts, pts[0]], tk.lineWeight, palette.line);
  g.fillCircle(e.cx + R * 0.16, e.cy - R * 0.18, R * 0.14, palette.shine);
}

/** The squeeze: > < (approved, the end of error). */
function chevronEye(g: Gfx, e: Eye, tk: FaceTokens) {
  const dx = e.rx * 0.75 * -e.side; // left eye points right (>), right eye points left (<)
  const h = e.ry * 0.5;
  const tipX = e.cx + dx * 0.6;
  const backX = e.cx - dx * 0.6;
  const r = tk.lineWeight * 1.25;
  g.drawWideLine(backX, e.cy - h, tipX, e.cy, r, palette.line);
  g.drawWideLine(tipX, e.cy, backX, e.cy + h, r, palette.line);
}

/**
 * Brows: a small filled crescent above each eye, thick in the middle and tapering
 * to points (Gideon, 21 Oct). Angle lifts the inner ends; tilt raises the right
 * brow only; curve 0 makes a straight, tapered stroke (cross).
 */
function brow(g: Gfx, e: Eye, f: AnimatedFace, tk: FaceTokens) {
  const half = (tk.browLength * (f.brows.len ?? 1)) / 2;
  if (half < 1) return; // brows.len 0: no brows (the small asked face)
  const a = ((f.brows.angle + (e.side === 1 ? f.brows.tilt : 0)) * Math.PI) / 180;
  const y = e.cy - e.ry - tk.browGap - f.brows.y;
  const sag = (f.brows.curve ?? tk.browCurve) * half; // how far the middle rises above the ends
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const at = (lx: number, ly: number): [number, number] => [e.cx + e.side * lx * Math.cos(a), y + ly + lx * Math.sin(a)];
  for (let i = 0; i <= 16; i++) {
    const u = -1 + (2 * i) / 16; // -1 inner end .. 1 outer end
    const lx = u * half;
    const mid = -sag * (1 - u * u);
    // Thickest in the middle, tapering to points: a crescent moon.
    const t = (tk.browThick / 2) * Math.pow(1 - u * u, 0.7) + 0.6;
    top.push(at(lx, mid - t));
    bottom.push(at(lx, mid + t));
  }
  g.fillPolygon([...top, ...bottom.reverse()], palette.line);
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

/** Pink cheeks under the outer corners of the eyes, on every face (kawaii pass). */
export function drawCheeks(g: Gfx, f: AnimatedFace, tk: FaceTokens) {
  if (f.cheeks <= 0.01) return;
  for (const e of eyeLayout(f, tk)) {
    g.fillEllipse(e.cx + e.side * tk.cheekX, e.cy + tk.cheekY * Math.min(1.15, f.scale), tk.cheekRx * f.cheeks, tk.cheekRy * f.cheeks, palette.cheek);
  }
}

export function drawEyes(g: Gfx, f: AnimatedFace, tk: FaceTokens, now = 0) {
  for (const e of eyeLayout(f, tk)) {
    brow(g, e, f, tk);
    if (f.shape === "spiral") spiralEye(g, e, tk, now);
    else if (f.shape === "arc") arcEye(g, e, tk);
    else if (f.shape === "line") chevronEye(g, e, tk);
    else if (f.shape === "sleep") sleepEye(g, e, tk, f.lashes);
    else if (f.shape === "star") starEye(g, e, tk);
    else roundEye(g, e, f, tk, f.shape === "sparkle");
  }
}
