import { defaultConfig, type AgentState, type Config } from "../state/agentState";

// What each state looks like, as face parameters (spec §4.1, §4.2).
// Brows carry the emotion; lids only open and close.

export type EyeShape = "round" | "arc" | "line" | "sparkle" | "spiral" | "star" | "sleep";
/** Looping eye behaviours layered on top of the pose. */
export type Gaze = "still" | "scan" | "dart" | "scroll-up" | "look-around" | "follow-www";
// Kawaii pass (21 Oct) adds: open (an open smile, coloured inside, with a tongue),
// blep (a straight mouth with the tongue out), cat (ω) and shout (an open, cross mouth).
export type MouthShape = "none" | "line" | "smile" | "o" | "pout" | "tongue" | "wobble" | "yawn" | "open" | "blep" | "cat" | "shout";
export type ManpuKind = "dots" | "sweat" | "magnifier" | "www" | "sparkles" | "blush" | "zzz" | "question" | "wifi" | "wifiOn"; // wifi*: setup only

export type Brows = {
  y: number; // px above the default brow height; positive raises
  angle: number; // degrees; positive lifts the inner ends (worried, pleading), negative lowers them (determined)
  tilt: number; // degrees added to the right brow only (sceptical asymmetry)
  len?: number; // length multiplier; below 1 is shorter, closer, more relaxed
  curve?: number; // arch, replacing the browCurve token: 0 is a straight stroke (cross)
};

export type Expression = {
  shape: EyeShape;
  /** Shown first for ms, then `shape`. */
  intro?: { shape: EyeShape; ms: number };
  scale: number; // eye size multiplier
  roundness: number; // 0 = the default oval, 1 = a circle
  open: number; // 0 closed .. 1 fully open (lids only open and close); above 1 widens the eye
  smile: number; // 0..1 lower lids curving up: smiling eyes
  squint: number; // 0..1 straight lower lid rising (concentration)
  pupil: { x: number; y: number }; // -1..1; up is negative
  pupilScale: number;
  highlight: number; // highlight size multiplier: bigger is glossier
  gaze: Gaze;
  brows: Brows;
  mouth: MouthShape;
  /** px the mouth moves up (negative) or down from mouthY: blocked keeps clear of the hint. */
  mouthShift: number;
  manpu: ManpuKind[];
  /** Blink-interval multiplier: below 1 blinks more often (nervous), above 1 less. */
  blinkRate: number;
  /** Blink-duration multiplier: above 1 is slower and softer. */
  blinkSoftness: number;
  busy: boolean; // breathing speeds up
  /** px the face slides up to make room. */
  slide: number;
  /** Pink cheeks (kawaii pass): 1 as usual, more for a blush, 0 for none. */
  cheeks: number;
  /** Three lashes at the outer end of closed eyes (content, sleepy). */
  lashes: boolean;
  /** Degrees the top lid slants down towards the nose: a scowl (cross, after an error). */
  lidTilt: number;
};

const base: Expression = {
  shape: "round",
  scale: 1,
  roundness: 1, // kawaii pass: round eyes everywhere
  open: 1,
  smile: 0,
  squint: 0,
  pupil: { x: 0, y: 0 },
  pupilScale: 1,
  highlight: 1,
  gaze: "still",
  brows: { y: 0, angle: 0, tilt: 0 },
  mouth: "none",
  mouthShift: 0,
  manpu: [],
  blinkRate: 1,
  blinkSoftness: 1,
  busy: true,
  slide: 0,
  cheeks: 1,
  lashes: false,
  lidTilt: 0,
};

const e = (over: Partial<Expression>): Expression => ({ ...base, ...over });

// At the edge of vision only idle, working and blocked must be told apart, so
// plain working states share one base face (spec §4.2, decided 3 Oct).
const WORKING: Partial<Expression> = { roundness: 1, pupil: { x: 0, y: 0.1 }, brows: { y: 0, angle: -2, tilt: 0 }, mouth: "line" };

// Toki sits low on the desk and looks up at you, so "at you" is slightly up.
const AT_YOU = { x: 0, y: -0.25 };

export const expressions = {
  // The face seen most: relaxed and content, a calmer cousin of done. Level lids
  // lowered by about a third, smiling lower lids, eyes up and out at the room,
  // level brows, slow soft blinks.
  // Pass 3: pupils centred; the top lid rests just above the iris, not across it;
  // the bottom of the eye itself curves up; brows lower, shorter and relaxed.
  // The same family as approved, at lower energy.
  // Kawaii pass (21 Oct): calm round eyes whose bottoms curve up a little, a small
  // smile, slow soft blinks, eyes wandering round the room.
  idle: e({
    roundness: 1,
    // Smiling eyes, the bottoms curved up: content, and at the edge of vision a
    // half-moon, never the same round discs as working (the acceptance test).
    open: 1,
    smile: 0.42,
    pupil: { x: 0, y: 0 },
    gaze: "look-around",
    brows: { y: -2, angle: 0, tilt: 0, len: 0.8 },
    mouth: "smile",
    blinkRate: 1.5,
    blinkSoftness: 1.8,
    busy: false,
  }),
  think: e({ pupil: { x: -0.55, y: -0.6 }, brows: { y: 3, angle: -13, tilt: 8 }, manpu: ["dots"], mouth: "pout" }),
  // Pass 3: read and run share the working face; only their eye loops differ,
  // in motion (scanning lines; following output up the screen).
  read: e({ ...WORKING, gaze: "scan" }),
  search: e({ open: 0.75, squint: 0.35, pupilScale: 0.85, gaze: "dart", brows: { y: -3, angle: -10, tilt: 0 }, manpu: ["magnifier"], mouth: "line" }),
  // Kawaii pass: the tongue out, concentrating (the reference's tongue face).
  edit: e({ pupil: { x: 0.1, y: 0.35 }, brows: { y: -2, angle: 6, tilt: 0 }, mouth: "blep" }),
  // Tuned by Gideon (3 Oct): eyes up and slightly left, right brow raised.
  run: e({ ...WORKING, pupil: { x: -0.2, y: -0.65 }, brows: { y: 0, angle: -2, tilt: 10 }, gaze: "scroll-up" }),
  // Worried: brows up in the middle, the top lids a little lowered, a nervous mouth.
  test: e({ open: 0.85, pupil: { x: 0, y: 0.1 }, blinkRate: 0.45, brows: { y: 5, angle: 12, tilt: 0 }, manpu: ["sweat"], mouth: "wobble" }),
  // Eyes up and out to the corner, drifting left to right in time with the "www" wave.
  web: e({ gaze: "follow-www", pupil: { x: 1, y: -1 }, brows: { y: 5, angle: 0, tilt: 10 }, manpu: ["www"], mouth: "o" }),
  // Subagents: spawned mini eyes appear around the face, one per running subagent
  // (drawn by the minis layer, on any face but blocked). This pose shows while
  // Toki has nothing else to do but wait on them. Brows and mouth as before.
  subagent: e({ pupilScale: 0.9, brows: { y: 5, angle: 4, tilt: 0 }, mouth: "o" }),
  working: e(WORKING),
  // The most different face, readable from across the desk: bigger, round,
  // wide-open eyes, raised brows, "…", slid up above the hint and buttons.
  // Pass 3: big, glossy, patient eyes. No stars: stars mean success, so they're
  // reserved for success moments.
  blocked: e({
    shape: "round",
    highlight: 1.2,
    scale: 1.18,
    roundness: 1,
    pupil: AT_YOU,
    pupilScale: 1.1,
    brows: { y: 4, angle: 8, tilt: 0 },
    manpu: ["dots"],
    // No mouth (Gideon, 3 Oct): the eyes, brows and "…" carry the waiting.
    mouth: "none",
    blinkRate: 1.3,
    // Eyes centred at y 84: as high as the brows and "…" allow while staying
    // 12 px clear of the top edge (spec §7.3); the mouth stays clear of the hint.
    slide: -22,
  }),
  // Sparkles (a small cream star cluster) set finishing apart from your approval
  // (blush). Tests pass will be bolder: star eyes and gold sparkles (spec §4.2).
  // Kawaii pass: happy closed eyes ^ ^, a cat's ω, the sparkles.
  done: e({ shape: "arc", brows: { y: 4, angle: 0, tilt: 0 }, mouth: "cat", manpu: ["sparkles"], busy: false }),
  // Spiral eyes for 3 s (Gideon, 3 Oct; was 0.5 s), then > < (spec §4.2).
  // Kawaii pass: after the spiral, cross (the reference's angry face): a scowl, the
  // brows straight and slanted, an open shout.
  error: e({
    shape: "round",
    intro: { shape: "spiral", ms: 3_000 },
    open: 0.82,
    lidTilt: 22,
    pupil: { x: 0, y: 0.2 },
    brows: { y: -1, angle: -26, tilt: 0, curve: 0 },
    mouth: "shout",
  }),
  // Your answers from the robot (spec §4.2): a happy squint and blush; a respectful "oh, okay".
  // Kawaii pass: the squeeze > < and an open smile, cheeks flushed.
  approved: e({ shape: "line", brows: { y: 5, angle: 2, tilt: 0 }, mouth: "open", cheeks: 1.25, busy: false }),
  // "Oh, okay": a little deflated. Lids lowered, brows up in the middle, a small frown.
  denied: e({ open: 0.75, pupil: { x: 0, y: 0.2 }, brows: { y: 3, angle: 12, tilt: 0 }, mouth: "pout" }),

  // Claude asked you a question (spec §4.2 "Blocked: asked a question"; Gideon,
  // 3 Oct: answered in Claude, not on Toki). Blocked's big patient eyes, but one
  // brow raised, quizzical, and a teal "?" above where blocked has its "…".
  asked: e({
    shape: "round",
    highlight: 1.2,
    scale: 1.12,
    roundness: 1,
    pupil: AT_YOU,
    pupilScale: 1.1,
    brows: { y: 2, angle: 4, tilt: 14 },
    manpu: ["question"],
    mouth: "none",
    blinkRate: 1.3,
    // No buttons below, so the face sits lower than blocked's (Gideon, 3 Oct: "jammed at the top").
    slide: -2,
  }),

  // Touch (spec §6, step 6). A tap on the face is a boop: a surprised, wide-eyed
  // moment with brows up, then a giggle squint.
  // Kawaii pass: a moment's surprise, then the squeeze > < and an open smile: a giggle.
  boop: e({
    shape: "line",
    intro: { shape: "round", ms: 280 },
    pupilScale: 0.85,
    brows: { y: 9, angle: 4, tilt: 0 },
    mouth: "open",
    cheeks: 1.25,
    busy: false,
  }),
  // Quiet mode (double-tap): eyes closed, content, "zZZZ" climbing in the corner
  // (Gideon, 3 Oct; was "shh"). Only approvals get through until it ends.
  quiet: e({ shape: "sleep", lashes: true, brows: { y: -2, angle: 0, tilt: 0, len: 0.85 }, mouth: "smile", manpu: ["zzz"], busy: false }),
  // "Close the day?" (long-press): hopeful eyes slid up above the question and
  // two booth buttons. Smiling lids and no "…" keep it apart from blocked.
  closeAsk: e({
    roundness: 1,
    highlight: 1.15,
    smile: 0.12,
    pupil: AT_YOU,
    pupilScale: 1.05,
    brows: { y: 5, angle: 7, tilt: 0 },
    slide: -22,
    busy: false,
  }),
  // Day closed, earned: star eyes and sparkles, then the shutter comes down.
  closed: e({ shape: "star", brows: { y: 7, angle: 0, tilt: 0 }, mouth: "open", cheeks: 1.2, manpu: ["sparkles"], busy: false }),
  // Day closed, quiet: a soft yawn, then the shutter comes most of the way down.
  sleepy: e({ shape: "sleep", lashes: true, brows: { y: -3, angle: 5, tilt: 0, len: 0.85 }, mouth: "yawn", busy: false }),
  // After closing: asleep under the shutter. It sits low, so after a quiet close
  // the sleeping eyes peek out from the gap under the shutter.
  night: e({ shape: "sleep", brows: { y: -4, angle: 0, tilt: 0, len: 0.8 }, mouth: "none", busy: false, slide: 96 }),
} satisfies Record<string, Expression>;

export type ExpressionId = keyof typeof expressions;
export const expressionIds = Object.keys(expressions) as ExpressionId[];

/** Live edits from the Face lab, layered over the defaults above. */
export type ExpressionOverrides = Partial<Record<ExpressionId, Partial<Expression>>>;
export type ExpressionLookup = (id: ExpressionId) => Expression;

export function lookupWith(overrides: ExpressionOverrides): ExpressionLookup {
  return (id) => {
    const o = overrides[id];
    if (!o) return expressions[id];
    const base = expressions[id] as Expression;
    return { ...base, ...o, brows: { ...base.brows, ...o.brows }, pupil: { ...base.pupil, ...o.pupil } };
  };
}

/** The numeric expression parameters the lab exposes as sliders. */
export const expressionSliders: { path: string; label: string; min: number; max: number; step: number }[] = [
  { path: "open", label: "open", min: 0, max: 1.2, step: 0.01 },
  { path: "smile", label: "smile", min: 0, max: 0.6, step: 0.01 },
  { path: "squint", label: "squint", min: 0, max: 0.8, step: 0.01 },
  { path: "scale", label: "scale", min: 0.6, max: 1.5, step: 0.01 },
  { path: "roundness", label: "roundness", min: 0, max: 1, step: 0.05 },
  { path: "pupil.x", label: "pupil x", min: -1, max: 1, step: 0.05 },
  { path: "pupil.y", label: "pupil y", min: -1, max: 1, step: 0.05 },
  { path: "pupilScale", label: "pupil scale", min: 0.5, max: 1.5, step: 0.05 },
  { path: "highlight", label: "highlight ×", min: 0.5, max: 2.5, step: 0.05 },
  { path: "brows.y", label: "brows height", min: -12, max: 20, step: 1 },
  { path: "brows.angle", label: "brows angle", min: -30, max: 30, step: 1 },
  { path: "brows.tilt", label: "brows tilt (R)", min: -20, max: 20, step: 1 },
  { path: "brows.len", label: "brows length ×", min: 0.4, max: 1.4, step: 0.05 },
  { path: "slide", label: "slide", min: -80, max: 20, step: 1 },
  { path: "mouthShift", label: "mouth shift", min: -30, max: 30, step: 1 },
  { path: "blinkRate", label: "blink interval ×", min: 0.3, max: 3, step: 0.1 },
  { path: "blinkSoftness", label: "blink softness ×", min: 0.5, max: 3, step: 0.1 },
  { path: "cheeks", label: "cheeks ×", min: 0, max: 1.6, step: 0.05 },
  { path: "lidTilt", label: "lid tilt (scowl)", min: -30, max: 40, step: 1 },
  { path: "brows.curve", label: "brows arch", min: 0, max: 0.6, step: 0.02 },
];

const ANSWER_MS = 1_200; // the approve / deny reaction is a one-shot (spec: under 1.5 s)

export function expressionFor(s: AgentState, cfg: Config = defaultConfig): ExpressionId {
  const { mode, activity } = s.shown;
  // Blocked always surfaces: through quiet mode, and up through a closed shutter.
  // A question is blocked too, but gets its own face (never Allow / Deny).
  if (mode === "blocked") return s.prompt?.question || s.prompt?.tool === "AskUserQuestion" ? "asked" : "blocked";
  if (s.closeAskAt !== null && s.now - s.closeAskAt <= cfg.closeAskMs) return "closeAsk";
  if (s.dayClosed) {
    if (s.now - s.dayClosed.at < cfg.closeShowMs) return s.dayClosed.earned ? "closed" : "sleepy";
    return "night";
  }
  if (s.boopAt !== null && s.now - s.boopAt < cfg.boopMs) return "boop";
  const last = s.oneShots[s.oneShots.length - 1];
  if (last && s.now - last.at < ANSWER_MS) {
    if (last.kind === "approved") return "approved";
    if (last.kind === "denied") return "denied";
  }
  // Quiet mode hides everything but approvals (and your own boops).
  if (s.quietUntil !== null && s.now < s.quietUntil) return "quiet";
  // Waiting on subagents: the subagent pose, even once Toki's own activity has gone quiet.
  if (s.subagents.length && (mode === "idle" || (mode === "working" && activity === "subagent"))) return "subagent";
  if (mode === "done" || mode === "error" || mode === "idle") return mode;
  if (activity === "other" || !activity) return "working";
  return activity;
}

/**
 * Night shutter, as a fraction of the screen it covers: earned closes it fully;
 * a quiet close leaves a gap at the bottom for the sleeping eyes (Gideon, 3 Oct: "almost all the way down").
 */
export const SHUTTER_QUIET = 0.8;

export function shutterFor(s: AgentState, cfg: Config = defaultConfig): number {
  if (!s.dayClosed || s.shown.mode === "blocked") return 0;
  if (s.now - s.dayClosed.at < cfg.closeShowMs) return 0;
  return s.dayClosed.earned ? 1 : SHUTTER_QUIET;
}
