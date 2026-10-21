import type { AnimatedFace } from "./animator";
import { eyeLayout } from "./drawEyes";
import type { ManpuKind } from "./expressions";
import type { Gfx } from "./gfx";
import { mix, palette } from "./palette";
import { drawWifi } from "./setup";
import type { FaceTokens } from "./tokens";

// Manpu (漫符): manga symbols layered over the face (spec §4.1). They give the
// working states distinct silhouettes at the edge of vision, where pupil position
// alone doesn't read. Every manpu comes from the current expression or the turn
// length, which come from real events.
//
// Spec §7.4: pop in over manpu.in with a 10% overshoot (the sweat drop slides in
// instead); leave over manpu.out. The robot can't fade, so leaving is a shrink.
// Loops stay subtle; one-shots (puffs) are bold.

type Ctx = {
  g: Gfx;
  f: AnimatedFace;
  tk: FaceTokens;
  t: number; // ms since this manpu appeared
  k: number; // size, 0..~1.1 (pop in / shrink out)
  leaving: number; // 0 while on screen; 0..1 as it leaves
  grow: number; // long-turn growth, 1 = normal
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;

/**
 * "…": three dots above the middle of the face (thinking, waiting on you). Every
 * dot animates: they pop in one by one, hold, then all clear together and the
 * cycle starts again from none.
 */
function dots({ g, f, tk, t, k }: Ctx) {
  const [left] = eyeLayout(f, tk);
  const top = left.cy - left.ry - tk.outline - tk.border;
  const y = top - tk.dotsGap;
  const step = tk.dotsStepMs;
  const phase = t % (step * 4); // none, one, two, three
  for (let i = 0; i < 3; i++) {
    const p = (phase - (i + 1) * step) / Math.max(1, tk.manpuInMs);
    if (p < 0) continue;
    const pop = p < 0.7 ? (p / 0.7) * 1.15 : p < 1 ? 1.15 - ((p - 0.7) / 0.3) * 0.15 : 1; // 15% overshoot
    g.fillCircle(160 + (i - 1) * 12 * tk.manpuScale, y, 4.5 * tk.manpuScale * k * pop, palette.line);
  }
}

/** Sweat drop at the right temple: slides in from above, bobs gently; grows on a long turn. */
function sweat({ g, f, tk, t, k, grow }: Ctx) {
  const [, r] = eyeLayout(f, tk);
  const s = tk.manpuScale * grow * Math.min(1, k);
  const slide = easeOut(clamp01(t / tk.sweatSlideMs));
  const x = r.cx + r.rx + tk.outline + 8 * tk.manpuScale;
  const y = r.cy - r.ry * 0.9 - (1 - slide) * 18 + Math.sin(t / 600) * 1.5;
  const R = 7 * s;
  // Teardrop: a circle plus a triangle pointing up; ink outline first, then the fill.
  g.fillCircle(x, y + R, R + 2, palette.line);
  g.fillTriangle(x - R - 1.5, y + R * 0.7, x + R + 1.5, y + R * 0.7, x, y - R * 1.5, palette.line);
  g.fillCircle(x, y + R, R, palette.teal);
  g.fillTriangle(x - R, y + R * 0.75, x + R, y + R * 0.75, x, y - R * 1.2, palette.teal);
  g.fillCircle(x - R * 0.35, y + R * 0.75, R * 0.28, palette.shine);
}

/**
 * Magnifier (searching): a see-through lens over the lower edge of the right eye,
 * showing the eye underneath magnified, drifting slowly across it as if scanning.
 */
function magnifier({ g, f, tk, t, k }: Ctx) {
  const [, r] = eyeLayout(f, tk);
  const R = tk.lensR * k;
  if (R < 2) return;
  const drift = tk.lensDriftMs ? Math.sin((t / tk.lensDriftMs) * Math.PI * 2) : 0;
  const x = r.cx + drift * r.rx * 0.45;
  const y = r.cy + r.ry * tk.lensY;
  g.magnify(x, y, R, tk.lensZoom);
  // Glare: a small crescent of light on the glass, top left.
  g.fillArc(x, y, R * 0.62, R * 0.74, 200, 250, palette.shine);
  // Rim and handle.
  g.fillArc(x, y, R, R + tk.lensRim, 0, 360, palette.line);
  const hx = x + (R + tk.lensRim) * 0.7;
  const hy = y + (R + tk.lensRim) * 0.7;
  g.drawWideLine(hx, hy, hx + R * 0.75, hy + R * 0.75, tk.lensRim * 1.1, palette.line);
}

/** Polyline stroke through points: anti-aliased drawWideLine segments on the robot too. */
function stroke(g: Gfx, pts: [number, number][], r: number, c: string) {
  for (let i = 1; i < pts.length; i++) g.drawWideLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r, c);
}

/** Where the "www" wave runs: the time within its cycle, and which W is lifting. */
export function wwwPhase(t: number, tk: FaceTokens) {
  const cycle = tk.wwwWaveMs + tk.wwwPauseMs;
  return { cycle, at: t % cycle };
}

/**
 * "www" (the web): three hand-drawn Ws in the clear top-right corner, above the
 * right brow, right-aligned to the face. A travelling wave: W1 lifts with an ease,
 * and as it settles W2 lifts, then W3; then a short pause so the loop breathes.
 * Each W is a four-stroke polyline with round caps (no font); on the robot it's
 * one pre-rendered W sprite pushed three times at different heights.
 */
function www({ g, f, tk, t, k }: Ctx) {
  if (k <= 0.05) return;
  const [, r] = eyeLayout(f, tk);
  const W = tk.wwwW * k;
  const H = tk.wwwH * k;
  const right = 320 - 12; // spec §7.3: nothing within 12 px of the edge
  const top = Math.max(12 + tk.wwwLift, r.cy - r.ry - tk.outline - tk.border - tk.wwwAbove);
  const { at } = wwwPhase(t, tk);
  const step = tk.wwwWaveMs / 3; // each W starts a third of the wave after the last
  const bump = step * 1.5; // and lifts for one and a half steps, so the next starts as it settles
  for (let i = 0; i < 3; i++) {
    const p = (at - i * step) / bump;
    const lift = p > 0 && p < 1 ? Math.sin(Math.PI * p) ** 2 * tk.wwwLift : 0;
    const x0 = right - (3 - i) * W - (2 - i) * tk.wwwGap;
    const y0 = top - lift;
    const pts: [number, number][] = [
      [x0, y0],
      [x0 + W * 0.25, y0 + H],
      [x0 + W * 0.5, y0 + H * 0.35],
      [x0 + W * 0.75, y0 + H],
      [x0 + W, y0],
    ];
    stroke(g, pts, tk.wwwWeight, palette.line);
  }
}

/**
 * A four-point star with slightly concave sides and softly rounded tips: a
 * superellipse (exponent below 1 pulls the sides in), outlined with a round
 * stroke of the same colour to round the tips. On the robot, one pre-rendered
 * star sprite drawn at three scales.
 */
function star(g: Gfx, x: number, y: number, r: number, c: string, tk: FaceTokens) {
  if (r <= 0.5) return;
  const tip = Math.min(tk.sparkleTip, r * 0.3);
  const R = r - tip;
  const p = tk.sparkleConcave;
  const pts: [number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    pts.push([x + Math.sign(cx) * Math.abs(cx) ** (2 / p) * R, y + Math.sign(cy) * Math.abs(cy) ** (2 / p) * R]);
  }
  g.fillPolygon(pts, c);
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    g.drawWideLine(x0, y0, x1, y1, tip, c);
  }
}

/**
 * Sparkles (done): three cream stars, large, medium and small, in a loose cluster
 * at the top right, clear of the brow and the eye arc. They pop in largest first
 * (0 → 120% → 100%, staggered), twinkle on their own periods, then fade together
 * after sparkleHoldMs, or when the face changes. Tests pass will use star eyes and
 * gold sparkles round the face instead (spec §4.2), so the two stay distinct.
 */
function sparkles({ g, f, tk, t, leaving }: Ctx) {
  const [, r] = eyeLayout(f, tk);
  const ax = r.cx + r.rx + tk.outline + tk.sparkleX;
  const ay = r.cy - r.ry + tk.sparkleY;
  const stars = [
    // A loose cluster to the right of the eye arc: large, medium below right, small above right.
    { dx: -3, dy: -6, r: tk.sparkleLarge, period: 1_100 },
    { dx: 12, dy: 18, r: tk.sparkleMid, period: 1_500 },
    { dx: 14, dy: -24, r: tk.sparkleSmall, period: 1_900 },
  ];
  const hold = clamp01((t - tk.sparkleHoldMs) / tk.sparkleFadeMs);
  const fade = Math.max(hold, leaving);
  if (fade >= 1) return;
  const c = mix(palette.mustard, palette.face, fade); // kawaii pass: mustard, to read on cream
  stars.forEach((st, i) => {
    const local = t - i * tk.sparkleStaggerMs;
    if (local <= 0) return;
    const p = clamp01(local / tk.sparklePopMs);
    const pop = p < 0.6 ? (p / 0.6) * 1.2 : 1.2 - ((p - 0.6) / 0.4) * 0.2; // 0 → 120% → 100%
    const twinkle = p >= 1 ? 1 + Math.sin((local / st.period) * Math.PI * 2) * tk.sparkleTwinkle : 1;
    star(g, ax + st.dx, ay + st.dy, st.r * pop * twinkle, c, tk);
  });
}

/** Blush lines under the eyes (I approve). */
function blush({ g, f, tk, k }: Ctx) {
  for (const e of eyeLayout(f, tk)) {
    const y = e.cy + e.ry * 0.8;
    for (let i = -1; i <= 1; i++) {
      const x = e.cx + e.side * e.rx * 0.6 + i * 7 * tk.manpuScale;
      g.drawWideLine(x + 3 * k, y - 3 * k, x - 3 * k, y + 3 * k, 1.6 * k, palette.tomato);
    }
  }
}

/**
 * "zZZZ" (quiet mode; Gideon, 3 Oct): four letters, small to big, floating up
 * the right side of the face, from beside the right eye to the top-right corner. They pop in
 * one at a time, hold, then fade together, and the cycle starts again.
 */
function zzz({ g, tk, t, k }: Ctx) {
  if (k <= 0.05) return;
  const cycle = tk.zzzCycleMs;
  const at = t % cycle;
  const step = cycle / 6; // a letter every sixth of the cycle; the last sixth fades them
  const fade = clamp01((at - step * 5) / step);
  for (let i = 0; i < 4; i++) {
    const p = clamp01((at - i * step) / tk.manpuInMs);
    if (p <= 0) continue;
    const size = (tk.zzzSize + i * tk.zzzGrow) * Math.min(1, k);
    // From beside the right eye (first, small) up to the top-right corner (last,
    // big), right edges 12 px clear of the screen edge (spec §7.3).
    const x = 320 - 12 - tk.zzzStep * (3 - i) - g.textWidth(i === 0 ? "z" : "Z", size) / 2;
    const y = 12 + tk.zzzRise * (3 - i) + Math.sin(t / 700 + i) * 1.5;
    const c = mix(palette.line, palette.face, Math.max(1 - p, fade));
    g.drawString(i === 0 ? "z" : "Z", x, y, c, size, "top_center", true);
  }
}

/**
 * "?" (asked a question): a teal badge with a cream question mark, above the middle
 * of the face where blocked has its "…", bobbing gently.
 */
function question({ g, f, tk, t, k }: Ctx) {
  if (k <= 0.05) return;
  const [left] = eyeLayout(f, tk);
  const top = left.cy - left.ry - tk.outline - tk.border;
  // Bigger than the "…" it replaces, so asked and blocked part at the edge of vision.
  const R = 17 * Math.min(1.1, k);
  const y = Math.max(10 + R, top - tk.dotsGap - 6 + Math.sin(t / 500) * 1.5);
  g.fillCircle(160, y, R + 2.5, palette.line);
  g.fillCircle(160, y, R, palette.teal);
  g.drawString("?", 160, y + 1, palette.cream, 28 * Math.min(1, k), "middle_center", true);
}

/** Setup's Wi-Fi mark (face/setup.ts), in the web's top-right corner above the right brow. */
function wifiAt({ g, f, tk, t, k }: Ctx, on: boolean) {
  const [, r] = eyeLayout(f, tk);
  const top = r.cy - r.ry - tk.outline - tk.border - tk.wwwAbove;
  drawWifi(g, 320 - 12 - 24, Math.max(12 + 26, top + 18), t, on, k);
}

const DRAW: Record<ManpuKind, (c: Ctx) => void> = {
  dots,
  sweat,
  magnifier,
  www,
  sparkles,
  blush,
  zzz,
  question,
  wifi: (c) => wifiAt(c, false),
  wifiOn: (c) => wifiAt(c, true),
};

/** Tracks which manpu are on screen, so each pops in and shrinks out on its own clock. */
export class ManpuLayer {
  private live = new Map<ManpuKind, { since: number; leaving: number | null }>();

  draw(g: Gfx, want: ManpuKind[], f: AnimatedFace, tk: FaceTokens, now: number, grow: number) {
    for (const k of want) {
      const m = this.live.get(k);
      if (!m || m.leaving !== null) this.live.set(k, { since: m && m.leaving !== null ? now - tk.manpuInMs : now, leaving: null });
    }
    for (const [kind, m] of this.live) {
      if (!want.includes(kind) && m.leaving === null) m.leaving = now;
      let k: number;
      let leaving = 0;
      if (m.leaving !== null) {
        const p = (now - m.leaving) / tk.manpuOutMs;
        if (p >= 1) {
          this.live.delete(kind);
          continue;
        }
        k = 1 - easeOut(p);
        leaving = p;
      } else {
        // Pop in with a 10% overshoot.
        const p = clamp01((now - m.since) / tk.manpuInMs);
        k = p < 0.7 ? (p / 0.7) * 1.1 : 1.1 - ((p - 0.7) / 0.3) * 0.1;
      }
      DRAW[kind]({ g, f, tk, t: now - m.since, k, leaving, grow });
    }
  }
}
