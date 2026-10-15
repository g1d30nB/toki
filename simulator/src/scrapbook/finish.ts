// Metallic and holo stickers (spec §9.5, built 15 Oct). Metal marks the outliers
// among *your own* days, so the month view mostly shows plain pages and the odd one
// that glints. Intensity, never achievement: silver and gold say how intense a day
// was, not that it was good. Holo marks a rare moment, not volume.
//
// Every rule looks only at the 30 days up to and including the day, so a day's
// finish never changes once it's over, and there's a warm-up: nothing shines until
// there are 14 days of history to compare with.

import type { DaySummary } from "../state/moments";

export type Metal = "silver" | "gold";
export type DayFinish = {
  metal?: Metal;
  /** How the day compares, in words for its label: "busier than 27 of your last 30 days". */
  busierThan?: { n: number; of: number };
  /** Projects shipping for the very first time: their SHIPPED sticker goes holo. */
  firstShips: string[];
  /** The turn (its start time) that ran longest without needing you: its sticker goes holo. */
  runAt?: number;
};

export const FINISH = {
  windowDays: 30,
  warmupDays: 14, // days with any activity in the window, this one included
  silverTop: 0.1, // top 10% of the window…
  silverOverMedian: 1.25, // …and clearly above an ordinary day
  goldOverMedian: 1.8, // the busiest of the window, and far above an ordinary day
  runMinTools: 40, // a long run: about the top 1% of turns
};

const DAY_MS = 86_400_000;
const toTime = (day: string) => new Date(`${day}T12:00:00`).getTime();
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function finishesFor(days: DaySummary[], { warmup = FINISH.warmupDays } = {}): Record<string, DayFinish> {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const out: Record<string, DayFinish> = {};
  const shippedBefore = new Set<string>();
  for (const [i, d] of sorted.entries()) {
    const from = toTime(d.day) - (FINISH.windowDays - 1) * DAY_MS;
    const win = sorted.slice(0, i + 1).filter((e) => toTime(e.day) >= from && e.moments > 0);
    const f: DayFinish = { firstShips: [] };
    const ready = win.length >= warmup;

    // Metal: how busy, against the window.
    if (ready && d.moments > 0) {
      const busier = win.filter((e) => e.moments > d.moments).length;
      const med = median(win.map((e) => e.moments));
      if (busier === 0 && d.moments >= FINISH.goldOverMedian * med) f.metal = "gold";
      else if (busier < Math.max(1, Math.round(FINISH.silverTop * win.length)) && d.moments >= FINISH.silverOverMedian * med) f.metal = "silver";
      if (f.metal) f.busierThan = { n: win.filter((e) => e.moments < d.moments).length, of: win.length };
    }

    // Holo: a project's first ship ever (history counts even during the warm-up).
    for (const p of d.shipped ?? []) {
      if (ready && !shippedBefore.has(p)) f.firstShips.push(p);
      shippedBefore.add(p);
    }
    // Holo: the longest run of the window that needed nothing from you.
    const run = d.longestRun;
    if (ready && run && run.tools >= FINISH.runMinTools && win.every((e) => e === d || (e.longestRun?.tools ?? 0) < run.tools)) f.runAt = run.t;

    out[d.day] = f;
  }
  return out;
}

/** Which of a day's stickers go holo (by their time): each first ship's earliest SHIPPED, and the long run's turn. */
export function holoAt(stickers: { t: number; kind: string; project?: string }[], f?: DayFinish): Set<number> {
  const out = new Set<number>();
  if (!f) return out;
  for (const p of f.firstShips) {
    const first = stickers.filter((m) => m.kind === "shipped" && m.project === p).sort((a, b) => a.t - b.t)[0];
    if (first) out.add(first.t);
  }
  if (f.runAt !== undefined && stickers.some((m) => m.kind === "asked" && m.t === f.runAt)) out.add(f.runAt);
  return out;
}
