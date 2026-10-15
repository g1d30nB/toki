// The month and year views (spec §9.2; built 15 Oct). Each day is drawn as one
// face on a shade of its busyness. The spec said "most frequent face", but that is
// "running a command" every single day; so a day shows its signature face instead:
// the face it had most more of than usual, against the 30 days up to and including
// it. A day's face never changes once the day is over, since later days don't count.

import type { DaySummary, WorkKind } from "../state/moments";

const DAY_MS = 86_400_000;
const toTime = (day: string) => new Date(`${day}T12:00:00`).getTime();

export type Signature = { face: string; lift: number };

/** Each day's signature face: highest share of the day over its share of the last 30 days (3+ moments). */
export function signatureFaces(days: DaySummary[], minCount = 3): Record<string, Signature> {
  const sorted = [...days].filter((d) => d.faces).sort((a, b) => a.day.localeCompare(b.day));
  const out: Record<string, Signature> = {};
  for (const d of sorted) {
    const own = d.faces!;
    const n = Object.values(own).reduce((a, b) => a + b, 0);
    if (!n) continue;
    const from = toTime(d.day) - 29 * DAY_MS;
    const base: Record<string, number> = {};
    let total = 0;
    for (const e of sorted) {
      const t = toTime(e.day);
      if (t < from || e.day > d.day) continue;
      for (const [f, k] of Object.entries(e.faces!)) {
        base[f] = (base[f] ?? 0) + k;
        total += k;
      }
    }
    const candidates = Object.keys(own).filter((f) => own[f] >= minCount);
    let best: Signature | null = null;
    for (const f of candidates.length ? candidates : Object.keys(own)) {
      const lift = own[f] / n / (base[f] / total);
      if (!best || lift > best.lift || (lift === best.lift && own[f] > own[best.face])) best = { face: f, lift };
    }
    if (best) out[d.day] = best;
  }
  return out;
}

/** How busy a day was, 0 to 1. Square-rooted, so a quiet day still shows. */
export const density = (moments: number, most: number) => (most > 0 ? Math.sqrt(Math.min(1, moments / most)) : 0);

const pad = (n: number) => String(n).padStart(2, "0");

/** Months as "YYYY-MM", newest first: from the first month with a day up to this month. */
export function monthsOf(days: DaySummary[], today: string): string[] {
  if (!days.length) return [];
  const first = days.map((d) => d.day).sort()[0];
  let [y, m] = first.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const out: string[] = [];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out.reverse();
}

export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** A month's calendar, Monday first: blank cells (null) before the 1st and after the last day. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth(month); d++) cells.push(`${month}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** A stretch's numbers, for the month and year labels. */
export function totals(days: DaySummary[]) {
  const sum = (k: "prompts" | "toolCalls" | "approvals" | "sparkles" | "errors") => days.reduce((a, d) => a + d[k], 0);
  const byKind: Partial<Record<WorkKind, number>> = {};
  const byModel: Record<string, number> = {};
  for (const d of days) {
    for (const [k, n] of Object.entries(d.byKind ?? {})) byKind[k as WorkKind] = (byKind[k as WorkKind] ?? 0) + (n ?? 0);
    for (const [k, n] of Object.entries(d.byModel ?? {})) byModel[k] = (byModel[k] ?? 0) + n;
  }
  return { days: days.length, prompts: sum("prompts"), toolCalls: sum("toolCalls"), approvals: sum("approvals"), sparkles: sum("sparkles"), errors: sum("errors"), byKind, byModel };
}

/** The signature face in two or three words, set as a data label under it. */
export const FACE_WORD: Record<string, string> = {
  idle: "IDLE",
  think: "TALK",
  read: "READING",
  search: "SEARCHING",
  edit: "EDITING",
  run: "COMMANDS",
  test: "TESTS",
  web: "WEB",
  subagent: "SUBAGENTS",
  working: "WORKING",
  blocked: "APPROVALS",
  asked: "QUESTIONS",
  done: "DONE",
  error: "ERRORS",
  approved: "APPROVED",
  denied: "DENIED",
  boop: "BOOPS",
  quiet: "QUIET",
  closed: "CLOSED",
  sleepy: "CLOSED EARLY",
  cheeks: "CONTEXT FULL",
};
export const faceWord = (f: string) => FACE_WORD[f] ?? f.toUpperCase();
