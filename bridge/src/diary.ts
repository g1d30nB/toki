// The diary (Phase 5, spec §9; data kept sustainable 4 Oct, spec §10.4). Three layers
// in ~/StackChanData:
//   hooks/YYYY-MM-DD.jsonl           raw: every Claude Code hook (UTC dates)
//   recordings/<local stamp>.jsonl   raw: Toki's stream, Buddy lines and its own log
//   diary/YYYY-MM-DD.json            frozen: a finished day's moments and numbers
//   diary/days.json                  every frozen day's numbers, for the day list
// While a day's raw logs exist, it's derived from them (so changing a sticker rule
// redraws it) and re-frozen. Raw logs are deleted after 30 days, matching Claude
// Code's own transcript cleanup; from then on the frozen day is the diary.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseRecording } from "../../simulator/src/replay/parseRecording.ts";
import { dayOf, mergeSources, momentsFromHooks, momentsFromRecording, summariseDay, type DaySummary, type Moment } from "../../simulator/src/state/moments.ts";

export type Day = { summary: DaySummary; moments: Moment[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RAW_HOOKS = /^(probe-|statusline-)?\d{4}-\d{2}-\d{2}\.jsonl$/; // only files the bridge writes
const RAW_RECORDING = /^\d{4}-\d{2}-\d{2}_\d{6}\.jsonl$/;
const LOG_MAX = 5_000_000; // bytes; the login agent's log is emptied past this

/** The calendar dates either side of a day: a local day with a 02:00 rollover spans files from neighbouring UTC dates. */
function around(day: string): string[] {
  const t = Date.parse(`${day}T12:00:00Z`);
  return [-1, 0, 1].map((k) => new Date(t + k * 86_400_000).toISOString().slice(0, 10));
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** `rollover`: the hour a new day starts (Toki's setting, 2 by default). */
export function createDiary({ root = join(homedir(), "StackChanData"), now = () => Date.now(), keepDays = 30, rollover = (): number => 2 } = {}) {
  const HOOKS = join(root, "hooks");
  const RECORDINGS = join(root, "recordings");
  const FROZEN = join(root, "diary");
  const INDEX = join(FROZEN, "days.json");
  const LOG = join(root, "logs", "bridge.log");

  const list = (dir: string) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };

  /** Raw files that could hold moments for this day. */
  function sources(day: string): string[] {
    const dates = around(day);
    const pick = (dir: string, re: RegExp) =>
      list(dir)
        .filter((f) => re.test(f) && !f.startsWith("probe-") && !f.startsWith("statusline-") && dates.includes(f.slice(0, 10)))
        .map((f) => join(dir, f));
    return [...pick(HOOKS, RAW_HOOKS), ...pick(RECORDINGS, RAW_RECORDING)];
  }

  function derive(day: string, files: string[]): Day {
    const hookRecords: { t: string; hook: Record<string, unknown> }[] = [];
    const fromRecordings: Moment[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (f.startsWith(HOOKS)) {
        for (const line of text.split("\n")) {
          try {
            if (line) hookRecords.push(JSON.parse(line));
          } catch {
            // a torn last line while the bridge is writing: skip it
          }
        }
      } else {
        const rec = parseRecording(f.split("/").pop() ?? f, text);
        if (rec.events.length) fromRecordings.push(...momentsFromRecording(rec.startedAt.getTime(), rec.events));
      }
    }
    hookRecords.sort((a, b) => a.t.localeCompare(b.t));
    const fromHooks = momentsFromHooks(hookRecords as Parameters<typeof momentsFromHooks>[0]);
    const moments = mergeSources(fromHooks, fromRecordings).filter((m) => dayOf(m.t, rollover()) === day);
    return { summary: summariseDay(day, moments), moments };
  }

  // --- the frozen layer ---
  const readJson = <T>(path: string): T | null => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return null;
    }
  };
  /** Write via a temporary file, so a crash never leaves half a day behind. */
  const writeJson = (path: string, v: unknown) => {
    mkdirSync(FROZEN, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(v));
    renameSync(`${path}.tmp`, path);
  };
  let index: Record<string, DaySummary> | null = null;
  const days = () => (index ??= readJson<Record<string, DaySummary>>(INDEX) ?? {});

  const frozenPath = (day: string) => join(FROZEN, `${day}.json`);
  /** A day is over once the next day's 02:00 rollover has passed: nothing more can land in it. */
  const isOver = (day: string) => dayOf(now(), rollover()) > day;

  function freeze(day: string, d: Day) {
    const old = readJson<Day>(frozenPath(day));
    if (old && JSON.stringify(old) === JSON.stringify(d)) return;
    writeJson(frozenPath(day), d);
    days()[day] = d.summary;
    writeJson(INDEX, days());
  }

  // --- reading a day ---
  const cache = new Map<string, { key: string; day: Day }>();

  function loadDay(day: string): Day | null {
    if (!DAY.test(day)) return null;
    const files = sources(day);
    if (!files.length) return readJson<Day>(frozenPath(day)); // raw gone: the frozen day is the diary
    const key = `${rollover()}|` + files.map((f) => `${f}:${statSync(f).size}`).join("|");
    const hit = cache.get(day);
    if (hit && hit.key === key) return hit.day;
    const d = derive(day, files);
    cache.set(day, { key, day: d });
    if (isOver(day)) freeze(day, d);
    return d;
  }

  /** Every day with moments, newest first, with its numbers. */
  function listDays(): DaySummary[] {
    const fromRaw = new Set<string>();
    for (const f of [...list(HOOKS), ...list(RECORDINGS)]) if (DAY.test(f.slice(0, 10))) for (const d of around(f.slice(0, 10))) fromRaw.add(d);
    const out = new Map<string, DaySummary>();
    for (const [d, s] of Object.entries(days())) out.set(d, s);
    for (const d of fromRaw) {
      const s = loadDay(d)?.summary;
      if (s) out.set(d, s);
    }
    return [...out.values()].filter((s) => s.moments > 0).sort((a, b) => b.day.localeCompare(a.day));
  }

  /**
   * Housekeeping, run at start and every few hours: freeze every finished day, then
   * delete raw files older than `keepDays`, but only once every day they could hold
   * is frozen. Returns what it deleted, for the log.
   */
  function tidy(): string[] {
    const today = dayOf(now(), rollover());
    const removed: string[] = [];
    for (const [dir, re] of [
      [HOOKS, RAW_HOOKS],
      [RECORDINGS, RAW_RECORDING],
    ] as const) {
      for (const f of list(dir)) {
        if (!re.test(f)) continue;
        const date = f.replace(/^(probe-|statusline-)/, "").slice(0, 10);
        if (daysBetween(date, today) <= keepDays) continue;
        // Freeze its days first (and check they really were) before letting go of the file.
        const covered = around(date).filter((d) => d < today);
        for (const d of covered) loadDay(d);
        if (!covered.every((d) => existsSync(frozenPath(d)))) continue;
        unlinkSync(join(dir, f));
        removed.push(join(dir, f));
      }
    }
    // Reading every day freezes the finished ones whose raw files are still young too.
    listDays();
    try {
      if (statSync(LOG).size > LOG_MAX) truncateSync(LOG, 0);
    } catch {
      // no log yet
    }
    return removed;
  }

  return { loadDay, listDays, tidy };
}
