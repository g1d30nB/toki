// The scrapbook's layout rules, kept free of React so they can be tested
// (Phase 5; rethought 4 Oct with Gideon: one scrolling diary, newest day first,
// each day running down the page from morning to evening, hour by hour).

import type { Moment } from "../state/moments";
import { ACTIVITY_SYMBOL, EVENT_STICKERS, KIND_SYMBOL, eventAspect, stickerSize, type SymbolKind } from "./stickers";

const TURN_FACE: Record<string, string> = { other: "working" };

/**
 * One sticker per turn (Gideon, 3 Oct: the pile was unreadable): you ask, Claude
 * works, done. Its face is the turn's main activity, and it grows with the work
 * done (`n` tool calls). A permission request and its answer are one sticker (the
 * answer); boops within 2 minutes are one. Finished turns are counted in the
 * labels (sparkles), not stuck on separately.
 */
export function stickersFor(moments: Moment[]): Moment[] {
  const out: Moment[] = [];
  const turns = new Map<string, { m: Moment; work: Record<string, number> }>();
  const pending = new Map<string, Moment>(); // a request waiting for its answer
  const close = (key: string) => {
    const t = turns.get(key);
    if (!t) return;
    const top = Object.entries(t.work).sort((a, b) => b[1] - a[1])[0];
    if (top) t.m.face = TURN_FACE[top[0]] ?? top[0];
    if (top) t.m.ctx = { ...t.m.ctx, work: t.work };
    turns.delete(key);
    return t;
  };
  for (const m of moments) {
    const key = m.session ?? "_";
    if (m.kind === "asked") {
      close(key);
      const sticker: Moment = { ...m, n: 0 };
      turns.set(key, { m: sticker, work: {} });
      out.push(sticker);
    } else if (m.kind === "work") {
      let t = turns.get(key);
      if (!t) {
        // Work with no prompt seen (Buddy-only stretches): it starts a turn of its own.
        const sticker: Moment = { ...m, kind: "asked", n: 0 };
        t = { m: sticker, work: {} };
        turns.set(key, t);
        out.push(sticker);
      }
      t.m.n = (t.m.n ?? 0) + 1;
      if (m.detail) t.work[m.detail] = (t.work[m.detail] ?? 0) + 1;
    } else if (m.kind === "done") {
      const t = close(key);
      if (t) {
        t.m.detail = "done"; // finished: a quick one becomes sparkles
        t.m.ctx = { ...t.m.ctx, ms: m.t - t.m.t, reply: m.ctx?.reply };
      }
    } else if (m.kind === "blocked" || m.kind === "question") {
      pending.set(key, { ...m });
      if (m.kind === "question") out.push(pending.get(key)!);
    } else if (m.kind === "approved" || m.kind === "denied" || m.kind === "always") {
      const p = pending.get(key);
      pending.delete(key);
      if (p?.kind !== "question") out.push({ ...m });
    } else if (m.kind === "boop") {
      const prev = [...out].reverse().find((x) => x.kind === "boop");
      if (prev && m.t - prev.t < 120_000) prev.n = (prev.n ?? 1) + 1;
      else out.push({ ...m, n: 1 });
    } else {
      out.push({ ...m });
    }
  }
  for (const key of [...turns.keys()]) close(key);
  // A request never answered (still waiting, or the session ended) keeps its own sticker.
  for (const p of pending.values()) if (p.kind === "blocked") out.push(p);
  return out.sort((a, b) => a.t - b.t);
}

export type Look = { type: "event" } | { type: "face"; face: string } | { type: "symbol"; kind: SymbolKind };

/**
 * What a moment looks like (Gideon, 3 Oct: variety). Lettered stickers for events;
 * for a turn, work that isn't code is its kind's symbol (frame, page, envelope, www),
 * a quick win is sparkles, a long one (8+ tool calls) is Toki's real
 * face, everyday work is its activity's symbol; Toki's face for everything with
 * character (answers, errors, boops, quiet, closing).
 */
export function lookOf(m: Moment): Look {
  if (EVENT_STICKERS[m.kind]) return { type: "event" };
  if (m.kind === "asked") {
    const n = m.n ?? 0;
    // Work that isn't code says so first: images, documents, email, research.
    const kind = m.ctx?.kind && KIND_SYMBOL[m.ctx.kind];
    if (kind && n < 8) return { type: "symbol", kind };
    if (n <= 2 && m.detail === "done") return { type: "symbol", kind: "sparkles" };
    if (n < 8 && ACTIVITY_SYMBOL[m.face]) return { type: "symbol", kind: ACTIVITY_SYMBOL[m.face] };
  }
  return { type: "face", face: m.face };
}

/** How big a sticker is (1 = full size): its kind, then a turn grows with its work. */
export function sizeOf(m: Moment): number {
  const look = lookOf(m);
  const grow = m.kind === "asked" ? 1 + Math.min(0.9, Math.log2(1 + (m.n ?? 0)) * 0.2) : m.kind === "boop" ? 1 + Math.min(0.4, ((m.n ?? 1) - 1) * 0.1) : 1;
  // "…" turns (Claude answered without a tool) are many and quiet (Gideon, 3 Oct).
  const quiet = look.type === "symbol" && look.kind === "dots" ? 0.6 : 1;
  return stickerSize(m) * grow * quiet;
}

// Sticker widths in pixels at size 1. The page scrolls, so stickers keep a real size.
export const FACE_PX = 150;
export const SYMBOL_PX = 105;
export const ART_PX = 190;
// Taller art is narrower, so every sticker carries about the same weight: the drawn
// stickers (21 Oct) keep the area of a 4:3 one, so a one-line word runs wider.
const ART_SCALE: Partial<Record<string, number>> = { question: 0.5, closed: 0.85, quiet: 0.8 };

export function widthPx(m: Moment, s: number): number {
  const ev = EVENT_STICKERS[m.kind];
  const aspect = eventAspect(m);
  if (ev?.art && aspect) return ART_PX * s * Math.sqrt(aspect / (4 / 3)) * (m.kind === "question" ? 0.6 : 1);
  if (ev?.art) return ART_PX * s * (m.kind === "closed" && m.detail !== "earned" ? 0.7 : (ART_SCALE[m.kind] ?? 1));
  if (ev) return ev.text(m).length * 15 * s + 30;
  return (lookOf(m).type === "symbol" ? SYMBOL_PX : FACE_PX) * s;
}

/** Small seeded random, so a page is always laid out the same way. */
export function rng(seed: string) {
  let a = 0;
  for (const c of seed) a = (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function dayOfYear(day: string) {
  const d = new Date(`${day}T12:00:00`);
  return Math.round((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

/** ISO week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function weekNumber(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow); // the Thursday of this week decides its year
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
}

/** A day, hour by hour: bands with stickers, and the quiet stretches between them. */
export type Band = { kind: "hour"; hour: number; from: number; stickers: Moment[] } | { kind: "quiet"; from: number; to: number };

const QUIET_MS = 30 * 60_000;

/**
 * The day as bands down the page, morning first. Each hour with moments is a band;
 * a gap of more than 30 minutes with nothing in it becomes one quiet divider,
 * named with its times ("ah, lunch").
 */
export function bandsOf(stickers: Moment[]): Band[] {
  const out: Band[] = [];
  let last: Moment | null = null;
  for (const m of stickers) {
    const hourStart = new Date(m.t).setMinutes(0, 0, 0);
    const band = out[out.length - 1];
    // A gap inside one hour stays in its band: dividers only sit between hours.
    if (band?.kind === "hour" && band.from === hourStart) band.stickers.push(m);
    else {
      if (last && m.t - last.t > QUIET_MS) out.push({ kind: "quiet", from: last.t, to: m.t });
      out.push({ kind: "hour", hour: new Date(m.t).getHours(), from: hourStart, stickers: [m] });
    }
    last = m;
  }
  return out;
}

/**
 * The same day, newest first (Gideon, 4 Oct): the latest hour at the top and, within
 * each hour, the latest sticker first, so an open day reads like the list of days
 * around it. Quiet dividers keep their times in clock order ("12:10 – 14:56").
 */
export function newestFirst(bands: Band[]): Band[] {
  return bands.map((b) => (b.kind === "hour" ? { ...b, stickers: [...b.stickers].reverse() } : b)).reverse();
}

export type Placed = { m: Moment; x: number; y: number; r: number; s: number; w: number; z: number };

/** About how tall a sticker draws at width `w` (drawn art by its own shape; else 4:3, the "?" square). */
export function heightPx(m: Moment, w: number): number {
  const ev = EVENT_STICKERS[m.kind];
  if (ev && !ev.art) return 44;
  const aspect = eventAspect(m);
  if (aspect) return w / aspect;
  if (m.kind === "question") return w;
  return w * 0.75;
}

/**
 * One hour's sticker-bomb, `width` pixels wide, in reading order: left to right,
 * wrapping like a line of text (Gideon, 4 Oct: exact minutes made towers and dead
 * space; the hour label and the hover carry the time). Each sticker drops onto the
 * pile below it (a skyline), tucking a little under the one above, and may slide
 * sideways to land higher. So a busy hour grows downwards instead of crushing into
 * a heap, and the band is exactly as tall as its pile. Returns its height too.
 */
/**
 * Each sticker its own size (Gideon, 15 Oct: repeats looked stamped out). Event
 * stickers vary about ±20%, faces and symbols ±12%; and the same sticker twice in
 * a row is pushed clearly bigger or smaller than the last. Seeded, so a page
 * always comes out the same.
 */
function varied(m: Moment, rand: () => number, last: Map<string, number>): number {
  const spread = EVENT_STICKERS[m.kind] ? 0.2 : 0.12;
  const key = EVENT_STICKERS[m.kind] ? m.kind : `${m.kind}:${m.face}`;
  let k = 1 + (rand() * 2 - 1) * spread;
  const prev = last.get(key);
  if (prev !== undefined && Math.abs(k - prev) < spread * 0.6) k = prev >= 1 ? 1 - spread * (0.5 + rand() * 0.5) : 1 + spread * (0.5 + rand() * 0.5);
  last.set(key, k);
  return k;
}

export function packBand(stickers: Moment[], width: number, seed: string): { placed: Placed[]; height: number } {
  const rand = rng(seed);
  const STEP = 4; // skyline resolution, px
  const cols = Math.max(1, Math.ceil(width / STEP));
  const sky = new Array<number>(cols).fill(14); // the pile's bottom edge per column
  const margin = 16;
  const placed: Placed[] = [];
  let cursor = margin; // where the next sticker's left edge goes, wrapping at the right
  const lastScale = new Map<string, number>(); // per look: the last one's size
  stickers.forEach((m, i) => {
    const s = sizeOf(m) * varied(m, rand, lastScale);
    const w = widthPx(m, s);
    const h = heightPx(m, w);
    const foot = w * 0.7; // die-cut edges may overlap; the middle may not
    if (cursor + w > width - margin) cursor = margin + rand() * 30;
    const x0 = cursor + w / 2;
    cursor += w * 0.82 + rand() * 14;
    let best = { x: x0, top: Infinity };
    for (const dx of [0, -30, 30, -60, 60]) {
      const x = Math.min(width - margin - w / 2, Math.max(margin + w / 2, x0 + dx));
      const a = Math.max(0, Math.floor((x - foot / 2) / STEP));
      const b = Math.min(cols - 1, Math.ceil((x + foot / 2) / STEP));
      let floor = 0;
      for (let c = a; c <= b; c++) floor = Math.max(floor, sky[c]);
      // Tuck under the pile a little; sliding sideways costs, so stickers stay near their minute.
      const top = floor - h * 0.25 + Math.abs(dx) * 0.35;
      if (top < best.top) best = { x, top: Math.max(8, top) };
    }
    const y = best.top + h / 2 + (rand() - 0.5) * 8;
    const a = Math.max(0, Math.floor((best.x - foot / 2) / STEP));
    const b = Math.min(cols - 1, Math.ceil((best.x + foot / 2) / STEP));
    for (let c = a; c <= b; c++) sky[c] = Math.max(sky[c], y + h / 2);
    placed.push({ m, x: best.x, y, r: (rand() - 0.5) * 18, s, w, z: i + (EVENT_STICKERS[m.kind] ? 1000 : 0) });
  });
  const bottom = Math.max(0, ...placed.map((p) => p.y + heightPx(p.m, p.w) / 2));
  return { placed, height: Math.max(90, bottom + 16) };
}

/**
 * A collapsed day's highlights, newest first: every event sticker, then its
 * biggest turns, up to `max`. Calm and legible (Gideon's choice, 4 Oct).
 */
export function highlightsOf(stickers: Moment[], max = 14): Moment[] {
  const events = stickers.filter((m) => EVENT_STICKERS[m.kind]);
  const turns = stickers
    .filter((m) => !EVENT_STICKERS[m.kind] && (m.kind === "asked" || m.kind === "approved" || m.kind === "boop"))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
  // Newest first, like the open day and the list of days.
  return [...events.slice(0, max), ...turns.slice(0, Math.max(0, max - events.length))].sort((a, b) => b.t - a.t);
}
