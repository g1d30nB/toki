import type { AgentState } from "../state/agentState";
import { FaceAnimator } from "./animator";
import { drawCheeks, drawEyes, eyeLayout } from "./drawEyes";
import { MiniLayer } from "./minis";
import { drawMouth } from "./drawMouth";
import { ManpuLayer } from "./manpu";
import { expressionFor, lookupWith, shutterFor, type ExpressionId, type ExpressionOverrides } from "./expressions";
import { Shutter } from "./shutter";
import type { Question } from "../replay/events";
import { Gfx } from "./gfx";
import { mix, palette } from "./palette";
import type { FaceTokens } from "./tokens";
import { SETUP_FACE, SETUP_MANPU, drawSetupChrome, setupFrame, type SetupScreen } from "./setup";
import { faceLabel, type FaceLabel, type LabelMode } from "./label";

/** Lab overrides: preview any expression directly, and live-edit the tokens. */
export type Lab = {
  expression: ExpressionId | null;
  tokens: FaceTokens;
  overrides: ExpressionOverrides;
  /** Preview a long turn (sweat drop grown) without waiting 10 minutes. */
  longTurn?: boolean;
  /** Item 5 comparison: draw the mouth, or go mouthless. */
  mouth?: boolean;
  /**
   * Item 6: "smooth" = anti-aliased (treatment B), shown as the eye sees the
   * 200 ppi screen; "crisp" = every pixel snapped to the palette, as M5GFX's
   * plain (aliased) primitives draw it (treatment C).
   */
  edges?: "smooth" | "crisp";
  /** Acceptance test: hide the hint and buttons so only the face can signal. */
  hideChrome?: boolean;
  /** Preview this many running subagents (spawned mini eyes) instead of the recording's. */
  subagents?: number;
  /** Preview a question (step 6). Live, this comes with the prompt. */
  question?: Question;
  /** Preview "Always allow" (step 5): what it would do, in words. Live, this comes with the prompt. */
  always?: string;
  /** The "Always allow?" confirm screen (after a long-press on Allow). */
  alwaysAsk?: boolean;
  /** No link to the Claude app (on the robot: Bluetooth down for linkAfterMs). */
  disconnected?: boolean;
  /** Preview the night shutter: the fraction it covers (1 earned, 0.8 quiet). */
  shutter?: number;
  /** One of Toki's setup screens (Phase 7, face/setup.ts): a face plus words, instead of the usual. */
  setup?: SetupScreen;
  /** The label under the face (face/label.ts). Default "detail". */
  label?: LabelMode;
  /** Preview a label's object (a file, a command) without a live tool call. */
  labelObject?: string;
};

// Faces where the lower edge belongs to text and buttons, or where Toki is
// resting: spawned minis stay away.
const NO_MINIS: ExpressionId[] = ["blocked", "asked", "closeAsk", "quiet", "closed", "sleepy", "night"];


const WORKING: ExpressionId[] = ["think", "read", "search", "edit", "run", "test", "web", "subagent", "working"];

// One renderer per screen: it owns the animator, so motion carries across frames.
export class FaceRenderer {
  private anim = new FaceAnimator();
  private manpu = new ManpuLayer();
  private minis = new MiniLayer();
  private lastId: ExpressionId | null = null;
  private sparklesFrom = -1e9; // when the last done began: its sparkles linger after it
  private shutter = new Shutter();
  private earned = true; // the last close: full shutter with its sign, or most of the way
  private label: { text: string; l: FaceLabel; at: number } | null = null; // the label shown, and since when

  /**
   * The label under the face. The face itself changes with the state layer's own
   * hysteresis, so a new verb shows at once; a new object (the next file, the next
   * command) waits labelHoldMs, so a burst of tool calls reads as one steady line.
   */
  private drawLabel(g: Gfx, id: ExpressionId, s: AgentState, lab: Lab, wallMs: number) {
    const tk = lab.tokens;
    const l = faceLabel(id, s, lab.label ?? "detail", { object: lab.expression ? (lab.labelObject ?? sampleObject(id)) : undefined, subagents: lab.subagents });
    const text = l ? `${l.verb}|${l.object ?? ""}` : "";
    if (!l) {
      this.label = null;
      return;
    }
    const sameVerb = this.label?.l.verb === l.verb;
    if (!this.label || !sameVerb) this.label = { text, l, at: wallMs };
    else if (this.label.text !== text && wallMs - this.label.at >= tk.labelHoldMs) this.label = { text, l, at: wallMs };
    const shown = this.label.l;
    const k = tk.labelInMs > 0 ? Math.min(1, (wallMs - this.label.at) / tk.labelInMs) : 1;
    const cream = mix(palette.face, palette.line, k); // kawaii pass: navy on the cream screen
    const soft = mix(palette.face, mix(palette.line, palette.face, 0.35), k);
    const size = 22; // Baloo 2 Bold / Medium 22 on the robot
    const gap = 10; // each side of the middle dot, as on the robot
    const wv = g.textWidth(shown.verb, size, false, true);
    if (!shown.object) {
      g.drawString(shown.verb, 160, tk.labelY, cream, size, "top_center", true);
      return;
    }
    // Verb, a middle dot, then the object, centred as one line; only the object is cut.
    const obj = fit(g, shown.object, 296 - wv - 2 * gap, size);
    const x0 = 160 - (wv + 2 * gap + g.textWidth(obj, size)) / 2;
    g.drawString(shown.verb, x0, tk.labelY, cream, size, "top_left", true);
    g.fillCircle(x0 + wv + gap, tk.labelY + 10, 2.5, soft); // at the capitals' middle
    g.drawString(obj, x0 + wv + 2 * gap, tk.labelY, soft, size, "top_left", false);
  }

  draw(g: Gfx, s: AgentState, wallMs: number, lab: Lab) {
    const tk = lab.tokens;
    const setup = lab.setup;
    const id = setup ? SETUP_FACE[setup.screen] : (lab.expression ?? expressionFor(s));
    const blocked = id === "blocked" && !setup;

    g.fillScreen(palette.face); // kawaii pass: a cream screen
    // When blocked, the face slides up to make room for the buttons (spec §6).
    const look = lookupWith(lab.overrides);
    const face = this.anim.update(wallMs, id, tk, look);
    // The boop's giggle: once the eyes close, the whole face hops a few times,
    // each hop smaller, like shoulders shaking with a laugh (Gideon, 3 Oct).
    if (id === "boop") face.offsetY -= giggle(wallMs - this.anim.since - (look(id).intro?.ms ?? 0), tk);
    // Setup screens lift the face (and for the pairing code, shrink it) to make room for words.
    if (setup) {
      const frame = setupFrame(setup);
      face.offsetY -= frame.lift;
      face.scale *= frame.scale;
    }

    // Spawned minis: one per running subagent, on any face but blocked, where the
    // hint and buttons need the lower edge. They pop out when blocked, and back in after.
    const running =
      lab.subagents !== undefined
        ? Array.from({ length: lab.subagents }, (_, i) => `lab-${i + 1}`)
        : lab.expression
          ? []
          : s.subagents;
    this.minis.update(NO_MINIS.includes(id) || setup ? [] : running, wallMs, tk);
    // While minis are present, the main eyes shrink a little to make room...
    face.scale *= 1 - tk.miniShrink * this.minis.presence;
    // ...and glance at a newly spawned mini first, then settle.
    const spawn = this.minis.lastSpawn;
    if (spawn && tk.miniGlanceMs > 0) {
      const p = (wallMs - spawn.at) / tk.miniGlanceMs;
      if (p >= 0 && p <= 1) {
        const w = Math.sin(Math.PI * p); // look over, then ease back
        const dx = spawn.x - 160;
        const dy = spawn.y - (tk.eyeY + face.offsetY);
        const d = Math.hypot(dx, dy) || 1;
        face.pupilX += ((dx / d) * 0.9 - face.pupilX) * w;
        face.pupilY += ((dy / d) * 0.9 - face.pupilY) * w;
      }
    }

    drawCheeks(g, face, tk);
    drawEyes(g, face, tk, wallMs);
    // Mouths time their motion from when the face began (the yawn yawns once, on cue).
    if (lab.mouth !== false) drawMouth(g, face, tk, wallMs - this.anim.since);
    this.minis.draw(g, wallMs, tk, eyeLayout(face, tk));

    // Long turn (spec §4.2): past longTurnMin, a sweat drop appears and grows to double size.
    const longMs = tk.longTurnMin * 60_000;
    const turnMs = lab.longTurn ? longMs * 1.8 : s.turnSince !== null && !lab.expression ? s.now - s.turnSince : 0;
    const long = WORKING.includes(id) && turnMs > longMs;
    const grow = long ? 1 + Math.min(1, (turnMs - longMs) / longMs) : 1;
    const want = (setup && SETUP_MANPU[setup.screen]?.slice()) || look(id).manpu.slice();
    if (long && !want.includes("sweat")) want.push("sweat");
    // Done's sparkles linger over the next face for their full hold (Gideon, 3 Oct),
    // unless something urgent takes over: blocked or an error clears them at once.
    if (id === "done" && this.lastId !== "done") this.sparklesFrom = wallMs;
    const lingering = wallMs - this.sparklesFrom < tk.sparkleHoldMs + tk.sparkleFadeMs;
    if (lingering && !["blocked", "asked", "error", "closeAsk", "night"].includes(id) && !want.includes("sparkles")) want.push("sparkles");
    this.lastId = id;
    this.manpu.draw(g, want, face, tk, wallMs, grow);

    // The night shutter comes down over everything once the day is closed.
    const shut = setup ? 0 : (lab.shutter ?? (lab.expression ? (id === "night" ? 1 : 0) : shutterFor(s)));
    if (shut > 0) this.earned = shut >= 1;
    this.shutter.update(wallMs, shut, tk);
    this.shutter.draw(g, tk, this.earned);

    if (!setup && !lab.hideChrome && shut <= 0) this.drawLabel(g, id, s, lab, wallMs);
    if (lab.disconnected && !setup) drawLinkLost(g, tk);
    if (setup) {
      drawSetupChrome(g, setup);
      return;
    }

    if (id === "closeAsk" && !lab.hideChrome) {
      // "Close the day?" (spec §3.4): the question, then two booth-style buttons
      // in the same places as Deny / Allow, so your thumb already knows them.
      g.drawString("Close the day?", 160, tk.hintY, palette.line, tk.hintSize, "top_center", true);
      const mid = tk.buttonY + tk.buttonH / 2;
      pill(g, tk, 8, palette.face);
      g.drawString("Not yet", 82, mid, palette.line, 28, "middle_center", true);
      pill(g, tk, 164, palette.cheek);
      g.drawString("Close", 238, mid, palette.line, 28, "middle_center", true);
    }

    if (id === "asked" && !lab.hideChrome) drawQuestionChrome(g, tk, lab.question ?? (s.prompt && !lab.expression ? s.prompt.question : undefined));

    if (blocked && !lab.hideChrome) {
      const always = lab.always ?? (s.prompt && !lab.expression ? s.prompt.always : undefined);
      if (lab.alwaysAsk && always) drawAlwaysChrome(g, tk, always);
      else {
        // The hint is a data label (spec §7.1): monospace, tool name in capitals.
        const tool = s.prompt && !lab.expression ? s.prompt.tool : "Bash";
        const hint = s.prompt && !lab.expression ? s.prompt.hint : "npm test";
        const label = `${tool.toUpperCase()} · ${hint}`;
        g.drawString(fit(g, label, 296, tk.hintSize), 160, tk.hintY, palette.line, tk.hintSize, "top_center", false, true);
        const mid = tk.buttonY + tk.buttonH / 2;
        pill(g, tk, 8, palette.tomato);
        g.drawString("Deny", 82, mid, palette.cream, 28, "middle_center", true);
        pill(g, tk, 164, palette.teal);
        // With Always allow on offer, Allow shifts left and a small ∞ says "hold for more".
        g.drawString("Allow", always ? 224 : 238, mid, palette.cream, 28, "middle_center", true);
        if (always) drawAlways(g, 282, mid, palette.cream);
      }
    }
  }
}

/**
 * The Always icon (Gideon, 3 Oct): a thick ∞ drawn as one continuous loop that
 * ends in an arrowhead at the bottom of the right lobe, pointing back into the
 * crossing, with the "/" stroke passing over the "\" one. A lemniscate traced as
 * drawWideLine segments plus a filled triangle, so it ports straight to M5GFX.
 */
export function drawAlways(g: Gfx, x: number, y: number, c: string, w = 28) {
  const A = w / 2;
  const r = w / 15; // stroke radius: about 1.9 px at 28 px wide
  const at = (t: number): [number, number] => {
    const d = 1 + Math.sin(t) ** 2;
    return [x + (A * Math.cos(t)) / d, y + (A * Math.sin(t) * Math.cos(t)) / d];
  };
  const stroke = (t0: number, t1: number, rad: number, col: string) => {
    const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) * 9));
    let [px, py] = at(t0);
    for (let i = 1; i <= n; i++) {
      const [nx, ny] = at(t0 + ((t1 - t0) * i) / n);
      g.drawWideLine(px, py, nx, ny, rad, col);
      px = nx;
      py = ny;
    }
  };
  // One stroke: it leaves the crossing up into the left lobe, comes back over the
  // crossing as "/", round the right lobe, and stops short of the crossing in the
  // arrowhead. The gap it leaves is the "\\" passing under.
  const start = Math.PI / 2 + 0.42;
  const end = Math.PI * 2 + 0.92;
  stroke(start, end, r, c);
  // Arrowhead along the direction of travel.
  const [ex, ey] = at(end);
  const [bx, by] = at(end - 0.08);
  const dx = ex - bx;
  const dy = ey - by;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const L = r * 3.4;
  const W = r * 2.6;
  g.fillTriangle(ex + ux * L, ey + uy * L, ex - uy * W, ey + ux * W, ex + uy * W, ey - ux * W, c);
}

/**
 * "Always allow?" (step 5): after a long-press on Allow. Says exactly what the
 * rule would do, then Cancel / Always allow where Deny / Allow were. Cancel goes
 * back to the normal prompt; nothing is answered until a button is tapped.
 */
function drawAlwaysChrome(g: Gfx, tk: FaceTokens, always: string) {
  // The scope after the last comma ("this project") never gets cut: the rule shortens instead.
  const cut = always.lastIndexOf(", ");
  const tail = cut > 0 ? always.slice(cut) : "";
  const head = cut > 0 ? always.slice(0, cut) : always;
  const text = fitBold(g, head, 296 - g.textWidth(tail, tk.hintSize, false, true), tk.hintSize) + tail;
  g.drawString(text, 160, tk.hintY, palette.line, tk.hintSize, "top_center", true);
  const mid = tk.buttonY + tk.buttonH / 2;
  pill(g, tk, 8, palette.face);
  g.drawString("Cancel", 82, mid, palette.line, 28, "middle_center", true);
  pill(g, tk, 164, palette.teal);
  g.drawString("Always", 216, mid, palette.cream, 28, "middle_center", true); // the wider word: left, clear of its loop
  drawAlways(g, 284, mid, palette.cream);
}

/**
 * Asked (step 6; Gideon, 3 Oct): a question is answered in Claude, not on Toki.
 * Just where to answer, in regular weight so it stays quiet (the spec's 20 px
 * text minimum holds). No buttons, and no question label (Gideon: not needed).
 */
function drawQuestionChrome(g: Gfx, tk: FaceTokens, _q: Question | undefined) {
  g.drawString("Question for you in Claude", 160, tk.buttonY + tk.buttonH / 2, palette.line, fitSize(g, "Question for you in Claude", false), "middle_center", false);
}

/**
 * Disconnected (Gideon, 3 Oct): a small Bluetooth symbol with a tomato cross,
 * top left, over everything. Calm and dimmed, but it must never go unnoticed
 * that Toki can't hear Claude: an approval would never arrive.
 */
export function drawLinkLost(g: Gfx, tk: FaceTokens) {
  const h = tk.linkH / 2;
  const w = h * 0.55;
  const x = tk.linkX;
  const y = tk.linkY;
  const r = Math.max(1.25, tk.linkH / 14);
  const rune = mix(palette.line, palette.face, 0.25);
  // The Bluetooth rune: a spine, and two chevrons crossing it.
  const pts: [number, number][] = [
    [x - w, y - h / 2],
    [x + w, y + h / 2],
    [x, y + h],
    [x, y - h],
    [x + w, y - h / 2],
    [x - w, y + h / 2],
  ];
  for (let i = 1; i < pts.length; i++) g.drawWideLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r, rune);
  // The cross, to its right.
  const cx = x + w + h * 0.73; // a clear gap after the chevron tips
  const cy = y; // centred on the rune, as in the mock (Gideon, 3 Oct)
  const c = h * 0.38;
  g.drawWideLine(cx - c, cy - c, cx + c, cy + c, r * 1.15, palette.tomato);
  g.drawWideLine(cx - c, cy + c, cx + c, cy - c, r * 1.15, palette.tomato);
}

/** Height of the giggle hop at t ms into it: |sin| hops that shrink to nothing. */
export function giggle(t: number, tk: FaceTokens) {
  if (t < 0 || t >= tk.giggleMs || tk.giggleHops <= 0) return 0;
  const p = t / tk.giggleMs;
  return Math.abs(Math.sin(p * Math.PI * tk.giggleHops)) * tk.gigglePx * (1 - p * 0.6);
}

function fitBold(g: Gfx, s: string, maxW: number, size: number) {
  if (g.textWidth(s, size, false, true) <= maxW) return s;
  let t = s;
  while (t.length && g.textWidth(t + "…", size, false, true) > maxW) t = t.slice(0, -1);
  return t + "…";
}

function fit(g: Gfx, s: string, maxW: number, size: number) {
  if (g.textWidth(s, size, true) <= maxW) return s;
  let t = s;
  while (t.length && g.textWidth(t + "…", size, true) > maxW) t = t.slice(0, -1);
  return t + "…";
}

/** In the lab (a face picked by hand), a plausible object so the detail label can be judged. */
function sampleObject(id: ExpressionId): string | undefined {
  const SAMPLE: Partial<Record<ExpressionId, string>> = {
    read: "render.ts",
    search: '"faceSticker"',
    edit: "layout.ts",
    run: "git status",
    test: "npx vitest run",
    web: "docs.m5stack.com",
    working: "toki.ino",
    error: "npm run build",
  };
  return SAMPLE[id];
}

/** As the robot's fitFont: 28 px if it fits the 296 px the screen allows, else 22. */
export function fitSize(g: Gfx, s: string, bold: boolean): number {
  return g.textWidth(s, 28, false, bold) <= 296 ? 28 : 22;
}

/**
 * A button where Deny / Allow sit: a pill with a navy outline, like the
 * scrapbook's (kawaii pass). Left at x 8, right at x 164.
 */
function pill(g: Gfx, tk: FaceTokens, x: number, fill: string) {
  g.fillRoundRect(x, tk.buttonY, 148, tk.buttonH, tk.buttonH / 2, palette.line);
  g.fillRoundRect(x + 2.5, tk.buttonY + 2.5, 143, tk.buttonH - 5, tk.buttonH / 2 - 2.5, fill);
}
