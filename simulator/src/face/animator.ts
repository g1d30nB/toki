import { expressions, type ExpressionLookup, type Brows, type EyeShape, type Expression, type ExpressionId, type Gaze, type MouthShape } from "./expressions";
import type { FaceTokens } from "./tokens";

// Turns a target expression into the face for this frame: eases between
// expressions and layers blinks, tiny saccades, gaze loops and breathing on top,
// so the face is never frozen (spec §4.2 rules, §7.4 tokens).
// Written as plain state + update(), so it ports to the firmware's loop().

export type AnimatedFace = {
  shape: EyeShape;
  mouth: MouthShape;
  scale: number;
  roundness: number;
  open: number; // after blinks
  smile: number;
  squint: number;
  pupilX: number; // -1..1, after gaze loops
  pupilY: number;
  pupilScale: number;
  highlight: number;
  saccadeX: number; // px
  saccadeY: number;
  brows: Brows;
  mouthShift: number;
  stretch: number; // squash and stretch on expression change: 1 = rest
  offsetY: number; // breathing plus slide, px
};

// Small seeded random generator, so a replay looks the same every time.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

type Pose = Pick<
  Expression,
  "scale" | "roundness" | "open" | "smile" | "squint" | "pupil" | "pupilScale" | "highlight" | "brows" | "slide" | "mouthShift"
> & {
  shape: EyeShape;
  mouth: MouthShape;
};

function blend(a: Pose, b: Pose, t: number): Pose {
  return {
    scale: lerp(a.scale, b.scale, t),
    roundness: lerp(a.roundness, b.roundness, t),
    open: lerp(a.open, b.open, t),
    smile: lerp(a.smile, b.smile, t),
    squint: lerp(a.squint, b.squint, t),
    pupil: { x: lerp(a.pupil.x, b.pupil.x, t), y: lerp(a.pupil.y, b.pupil.y, t) },
    pupilScale: lerp(a.pupilScale, b.pupilScale, t),
    highlight: lerp(a.highlight, b.highlight, t),
    brows: {
      y: lerp(a.brows.y, b.brows.y, t),
      angle: lerp(a.brows.angle, b.brows.angle, t),
      tilt: lerp(a.brows.tilt, b.brows.tilt, t),
      len: lerp(a.brows.len ?? 1, b.brows.len ?? 1, t),
    },
    slide: lerp(a.slide, b.slide, t),
    mouthShift: lerp(a.mouthShift, b.mouthShift, t),
    // Discrete parts swap at the midpoint, hidden in the squeeze.
    shape: t < 0.5 ? a.shape : b.shape,
    mouth: t < 0.5 ? a.mouth : b.mouth,
  };
}

export class FaceAnimator {
  private rand = rng(7);
  private current: ExpressionId = "idle";
  private from: Pose = { ...expressions.idle };
  private changedAt = -1e9;

  private nextBlink = 0;
  private blinkStart = -1e9;
  private blinkLen = 120;
  private doubleBlink = false;

  private nextSaccade = 0;
  private saccade = { x: 0, y: 0, fromX: 0, fromY: 0, at: -1e9 };

  private gazeT0 = 0;
  private dart = { x: 0, y: 0, next: 0 };
  private glance = { x: 0, until: 0, next: 4_000 };

  private breathPhase = 0;
  private lastNow = 0;
  private look: ExpressionLookup = (id) => expressions[id];

  /** When the current expression began: manpu and intros time themselves from it. */
  get since() {
    return this.changedAt;
  }

  private targetPose(now: number): Pose {
    const to = this.look(this.current);
    const intro = to.intro && now - this.changedAt < to.intro.ms ? to.intro.shape : to.shape;
    return { ...to, shape: intro };
  }

  private poseAt(now: number, tk: FaceTokens): Pose {
    const k = tk.transitionMs ? clamp01((now - this.changedAt) / tk.transitionMs) : 1;
    return blend(this.from, this.targetPose(now), easeInOut(k));
  }

  update(now: number, target: ExpressionId, tk: FaceTokens, look?: ExpressionLookup): AnimatedFace {
    if (look) this.look = look;
    const dt = Math.min(100, Math.max(0, now - this.lastNow));
    this.lastNow = now;

    if (target !== this.current) {
      this.from = this.poseAt(now, tk); // hand over smoothly, even mid-transition
      this.current = target;
      this.changedAt = now;
      this.gazeT0 = now;
    }
    const to = this.look(this.current);
    const k = tk.transitionMs ? clamp01((now - this.changedAt) / tk.transitionMs) : 1;
    const pose = this.poseAt(now, tk);

    // A shape change (round to arc, say) is hidden in a quick squeeze; squash and stretch otherwise.
    const shapeChange = this.from.shape !== this.targetPose(now).shape && k < 1;
    const squeeze = shapeChange ? 1 - Math.sin(k * Math.PI) * 0.85 : 1;
    const stretch = k < 1 ? 1 - Math.sin(k * Math.PI) * 0.08 - Math.sin(k * Math.PI * 2) * 0.025 : 1;

    // Blinks: 2.5 to 6 s apart (scaled by the expression), 15% doubles; idle blinks slower and softer.
    if (now >= this.nextBlink) {
      this.blinkStart = now;
      this.blinkLen = tk.blinkMs * to.blinkSoftness;
      this.doubleBlink = this.rand() < tk.doubleBlinkChance;
      this.nextBlink = now + lerp(tk.blinkMin, tk.blinkMax, this.rand()) * to.blinkRate;
    }
    const blink = this.blinkAmount(now);

    // Tiny saccades: every 1 to 4 s, a 2 to 6 px shift that takes 40 ms.
    if (now >= this.nextSaccade) {
      const a = this.rand() * Math.PI * 2;
      const r = lerp(2, tk.saccadePx, this.rand());
      this.saccade = { fromX: this.saccade.x, fromY: this.saccade.y, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, at: now };
      this.nextSaccade = now + lerp(tk.saccadeMin, tk.saccadeMax, this.rand());
    }
    const sk = clamp01((now - this.saccade.at) / 40);

    const gaze = this.gazeOffset(now, to.gaze, tk);

    // Breathing: ±2 px, 4 s at idle, 2.5 s when busy.
    const period = to.busy ? tk.breathBusyMs : tk.breathIdleMs;
    this.breathPhase = (this.breathPhase + dt / period) % 1;
    const breath = Math.sin(this.breathPhase * Math.PI * 2) * tk.breathPx;

    return {
      shape: pose.shape,
      mouth: pose.mouth,
      scale: pose.scale,
      roundness: pose.roundness,
      open: pose.open * blink * squeeze,
      smile: pose.smile,
      squint: pose.squint,
      pupilX: pose.pupil.x + gaze.x,
      pupilY: pose.pupil.y + gaze.y,
      pupilScale: pose.pupilScale,
      highlight: pose.highlight,
      saccadeX: lerp(this.saccade.fromX, this.saccade.x, sk),
      saccadeY: lerp(this.saccade.fromY, this.saccade.y, sk),
      brows: pose.brows,
      mouthShift: pose.mouthShift,
      stretch,
      offsetY: breath + pose.slide,
    };
  }

  private blinkAmount(now: number) {
    const one = (start: number) => {
      const p = (now - start) / this.blinkLen;
      if (p < 0 || p > 1) return 1;
      return Math.abs(p - 0.5) * 2; // close then open
    };
    let v = one(this.blinkStart);
    if (this.doubleBlink) v = Math.min(v, one(this.blinkStart + this.blinkLen * 1.6));
    return v;
  }

  private gazeOffset(now: number, gaze: Gaze, tk: FaceTokens) {
    const t = now - this.gazeT0;
    switch (gaze) {
      case "scan": {
        // Reading: short sweeps left to right, then a quick return to the next line.
        const p = (t % 1_400) / 1_400;
        const x = p < 0.82 ? lerp(-0.55, 0.55, p / 0.82) : lerp(0.55, -0.55, (p - 0.82) / 0.18);
        return { x, y: (Math.floor(t / 1_400) % 3) * 0.12 - 0.12 };
      }
      case "scroll-up": {
        // Running a command: eyes ride the output up the screen, then drop back.
        const p = (t % 1_100) / 1_100;
        return { x: 0, y: p < 0.85 ? lerp(0.45, -0.35, p / 0.85) : lerp(-0.35, 0.45, (p - 0.85) / 0.15) };
      }
      case "dart": {
        if (now >= this.dart.next) {
          this.dart = { x: (this.rand() - 0.5) * 1.1, y: (this.rand() - 0.5) * 0.7, next: now + lerp(280, 700, this.rand()) };
        }
        return { x: this.dart.x, y: this.dart.y };
      }
      case "follow-www": {
        // The web: drift left to right as W1, W2, W3 lift in turn, then ease back
        // during the pause. Same clock as the wave (both start with the expression).
        const cycle = tk.wwwWaveMs + tk.wwwPauseMs;
        const at = t % cycle;
        const p = at < tk.wwwWaveMs ? easeInOut(at / tk.wwwWaveMs) : 1 - easeInOut((at - tk.wwwWaveMs) / tk.wwwPauseMs);
        return { x: lerp(-0.6, 0, p), y: 0 };
      }
      case "look-around": {
        // Idle: now and then, a slow glance to one side of the room and back.
        if (now >= this.glance.next) {
          this.glance = { x: this.rand() < 0.5 ? -0.6 : 0.6, until: now + 1_600, next: now + lerp(6_000, 11_000, this.rand()) };
        }
        const into = clamp01((now - (this.glance.until - 1_600)) / 400);
        const out = clamp01((now - this.glance.until) / 400);
        return { x: this.glance.x * easeInOut(into) * (1 - easeInOut(out)), y: 0 };
      }
      default:
        return { x: 0, y: 0 };
    }
  }
}
