import type { Eye } from "./drawEyes";
import type { Gfx } from "./gfx";
import { palette } from "./palette";
import type { FaceTokens } from "./tokens";

// Spawned minis: one little face (a pair of mini eyes with little brows) per
// running subagent (spec §4.2), up to miniCap. The eyes are deliberately simpler
// than Toki's: iris and pupil only, no highlight, no ring, so they read as spawn,
// not clones. Each pops in with a
// squash and stretch, blinks on its own timer, sometimes glances at the main
// eyes, and pops out (shrink with a small overshoot) when its subagent finishes.
// On the robot: one pre-rendered mini sprite, pushed per slot.

type Mini = {
  id: string;
  slot: number;
  born: number; // when its pop-in starts (staggered)
  leaving: number | null;
  nextBlink: number;
  blinkAt: number;
  nextGlance: number;
  glanceAt: number;
};

// Small seeded random generator, so captures repeat.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Where minis land, in arrival order: hand-placed spots around the face that
 * look scattered (each with its own tilt and size), close to the eyes, clear of
 * the brows, the mouth and each other. Fixed, so the face never reshuffles.
 */
export function miniSlots(tk: FaceTokens): { x: number; y: number; tilt: number; size: number }[] {
  return [1, 2, 3, 4].map((n) => {
    const k = (f: string) => tk[`miniS${n}${f}` as keyof FaceTokens];
    return { x: k("x"), y: k("y"), tilt: k("tilt"), size: k("size") };
  });
}

export class MiniLayer {
  private minis: Mini[] = [];
  private rand = rng(11);
  /** When the newest mini started arriving, and where: the main eyes glance at it. */
  lastSpawn: { at: number; x: number; y: number } | null = null;

  /** 0..1: how present the minis are, eased; the main eyes shrink by this. */
  presence = 0;
  private lastNow = 0;

  update(ids: string[], now: number, tk: FaceTokens) {
    const want = ids.slice(0, tk.miniCap);
    const slots = miniSlots(tk);
    // Arrivals: each takes the first free slot; several at once are staggered.
    let stagger = 0;
    for (const id of want) {
      const m = this.minis.find((x) => x.id === id);
      if (m && m.leaving === null) continue;
      if (m) this.minis = this.minis.filter((x) => x !== m);
      const used = new Set(this.minis.filter((x) => x.leaving === null).map((x) => x.slot));
      const slot = slots.findIndex((_, i) => !used.has(i));
      if (slot < 0) continue;
      const born = now + stagger;
      stagger += tk.miniStaggerMs;
      this.minis.push({
        id,
        slot,
        born,
        leaving: null,
        nextBlink: born + lerp(1_500, 5_000, this.rand()),
        blinkAt: -1e9,
        nextGlance: born + lerp(4_000, 9_000, this.rand()),
        glanceAt: -1e9,
      });
      this.lastSpawn = { at: born, x: slots[slot].x, y: slots[slot].y };
    }
    // Departures: pop out.
    for (const m of this.minis) if (m.leaving === null && !want.includes(m.id)) m.leaving = now;
    this.minis = this.minis.filter((m) => m.leaving === null || now - m.leaving < tk.miniOutMs);

    const target = this.minis.some((m) => m.leaving === null) ? 1 : 0;
    const dt = Math.min(100, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const step = tk.miniShrinkMs ? dt / tk.miniShrinkMs : 1;
    this.presence = target > this.presence ? Math.min(1, this.presence + step) : Math.max(0, this.presence - step);
  }

  draw(g: Gfx, now: number, tk: FaceTokens, mainEyes: Eye[]) {
    const slots = miniSlots(tk);
    this.minis.forEach((m, i) => {
      const s = slots[m.slot];
      let sx = 1;
      let sy = 1;
      if (m.leaving !== null) {
        // Pop out: a small swell, then a quick shrink.
        const p = clamp01((now - m.leaving) / tk.miniOutMs);
        const k = p < 0.3 ? lerp(1, 1.12, p / 0.3) : lerp(1.12, 0, (p - 0.3) / 0.7);
        sx = sy = k;
      } else {
        // Pop in: squash and stretch, overshooting to 1.15, settling at 1.
        const p = clamp01((now - m.born) / tk.miniInMs);
        if (p <= 0) return;
        const k = p < 0.6 ? lerp(0, 1.15, p / 0.6) : lerp(1.15, 1, (p - 0.6) / 0.4);
        const squash = Math.sin(p * Math.PI) * 0.22;
        sx = k * (1 + squash);
        sy = k * (1 - squash);
      }
      // Own blink timer, so they never blink together.
      if (now >= m.nextBlink) {
        m.blinkAt = now;
        m.nextBlink = now + lerp(2_500, 6_000, this.rand());
      }
      const bp = (now - m.blinkAt) / tk.blinkMs;
      const blink = bp >= 0 && bp <= 1 ? Math.max(0.12, Math.abs(bp - 0.5) * 2) : 1;
      // Now and then, a glance at the main eyes.
      if (now >= m.nextGlance) {
        m.glanceAt = now;
        m.nextGlance = now + lerp(5_000, 10_000, this.rand());
      }
      const gp = (now - m.glanceAt) / 900;
      const glance = gp >= 0 && gp <= 1 ? Math.sin(gp * Math.PI) : 0;
      const nearest = mainEyes.reduce((a, b) => (Math.abs(b.cx - s.x) < Math.abs(a.cx - s.x) ? b : a));
      const dx = nearest.cx - s.x;
      const dy = nearest.cy - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const bob = tk.miniBob ? Math.sin(now / 700 + i * 1.7) * tk.miniBob : 0;

      const R = tk.miniR * s.size;
      const pr = R * tk.miniPupil;
      // They always look a little towards Toki; the occasional glance looks further.
      const off = (R - pr) * (tk.miniLook + 0.35 * glance);
      // Each spot has its own tilt: the whole little face is rotated about its centre.
      const ta = (s.tilt * Math.PI) / 180;
      const rot = (px: number, py: number): [number, number] => [
        s.x + px * Math.cos(ta) - py * Math.sin(ta),
        s.y + bob + px * Math.sin(ta) + py * Math.cos(ta),
      ];
      for (const side of [-1, 1]) {
        const ex = side * (R + tk.miniGap / 2 * s.size) * sx;
        const [x, y] = rot(ex, 0);
        // Kawaii pass: a tiny navy eye with a shine on the side it's looking towards.
        g.fillEllipse(x, y, R * sx, R * sy * blink, palette.line);
        if (blink > 0.5) g.fillCircle(x + (dx / d) * off - R * 0.2, y + (dy / d) * off - R * 0.25, Math.max(1.5, pr * 0.75 * sx), palette.shine);
        // Little brows: short cream strokes, inner ends a touch higher (eager).
        const by = -R * sy - tk.miniBrowGap;
        const half = (tk.miniBrowLen / 2) * sx * s.size;
        const lift = half * Math.sin((tk.miniBrowAngle * Math.PI) / 180);
        const [ax, ay] = rot(ex - side * half, by - lift);
        const [bx, bY] = rot(ex + side * half, by + lift);
        g.drawWideLine(ax, ay, bx, bY, tk.miniBrowWeight * Math.min(sx, 1), palette.line);
      }
    });
  }
}
