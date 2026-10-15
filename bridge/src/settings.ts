// Toki's settings, as the bridge sees them (Phase 7, spec §10.4). The robot is the
// source of truth (its NVS); the bridge keeps the last copy Toki reported in
// ~/StackChanData/settings.json, so the app can show them while Toki is offline and
// the diary knows when a day starts.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `label`: under Toki's face, 0 off, 1 words (READING), 2 detail (READING · render.ts).
 * No default: it appears once Toki reports it, so the app can tell older firmware.
 */
export type Settings = { brightness: number; rollover: number; label?: number };
export const DEFAULTS: Settings = { brightness: 140, rollover: 2 };

/** A change from the app: only known fields, only whole numbers in range. Null if there's nothing valid. */
export function validPatch(body: unknown): Partial<Settings> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : undefined);
  const brightness = int(b.brightness, 20, 255);
  const rollover = int(b.rollover, 0, 6);
  const label = int(b.label, 0, 2);
  if (brightness !== undefined) out.brightness = brightness;
  if (rollover !== undefined) out.rollover = rollover;
  if (label !== undefined) out.label = label;
  return Object.keys(out).length ? out : null;
}

/**
 * Only Toki's own page may change settings. The server listens on 127.0.0.1, but a
 * web page elsewhere could still try to post to it (or reach it through a DNS
 * rebinding trick), so the Host and Origin must both be this Mac's.
 */
export function fromOurPage(req: IncomingMessage): boolean {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  if (!local.test(host)) return false;
  if (!origin) return false; // browsers always send Origin on a POST
  try {
    return local.test(new URL(origin).host);
  } catch {
    return false;
  }
}

export class SettingsMirror {
  private file: string;
  private waiting: ((s: Settings) => void)[] = [];
  current: Settings | null;

  constructor(file = join(homedir(), "StackChanData", "settings.json")) {
    this.file = file;
    try {
      this.current = { ...DEFAULTS, ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      this.current = null; // never heard from Toki
    }
  }

  /** Toki reported its settings: keep them, and answer anyone waiting on a change. */
  update(s: Partial<Settings>) {
    const next = { ...DEFAULTS, ...this.current, ...s };
    if (JSON.stringify(next) !== JSON.stringify(this.current)) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(next));
      renameSync(`${this.file}.tmp`, this.file);
    }
    this.current = next;
    for (const w of this.waiting.splice(0)) w(next);
  }

  /** Resolves with Toki's next report, or null after `ms`. */
  next(ms = 2_000): Promise<Settings | null> {
    return new Promise((resolve) => {
      const done = (s: Settings | null) => {
        clearTimeout(timer);
        resolve(s);
      };
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== done);
        resolve(null);
      }, ms);
      this.waiting.push(done);
    });
  }

  rollover(): number {
    return this.current?.rollover ?? DEFAULTS.rollover;
  }
}
