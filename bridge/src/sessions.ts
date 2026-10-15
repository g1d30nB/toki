// Session colours on Toki's LEDs (spec §4.3; Phase 4, step 7c, Gideon's option A):
// one dot per active session, in that session's colour, brighter while it works,
// faint while it idles. Amber stays the one "waiting on you" signal: Toki's own
// glow takes over the LEDs while blocked, and no session colour is amber-like.

export type Rgb = [number, number, number];

// Six hues, none near amber (255, 120, 0) or the face's mustard, all distinct on LEDs.
const COLOURS: Rgb[] = [
  [0, 200, 170], // teal
  [40, 110, 255], // blue
  [150, 70, 255], // violet
  [255, 60, 140], // pink
  [80, 220, 60], // green
  [200, 200, 200], // white
];
const WORKING = 0.25; // brightness while a turn is running
const IDLE = 0.06; // and while it's open but quiet
const STALE_MS = 10 * 60_000; // quiet this long and the dot goes, freeing its colour

type Slot = { id: string; working: boolean; lastAt: number };

export class SessionColours {
  private slots: (Slot | null)[] = COLOURS.map(() => null);

  /** A hook from this session: it's alive, and maybe starting or ending a turn, or ending altogether. */
  touch(id: string, event: string, now: number) {
    let i = this.slots.findIndex((s) => s?.id === id);
    if (event === "SessionEnd") {
      if (i >= 0) this.slots[i] = null;
      return;
    }
    if (i < 0) {
      this.expire(now);
      i = this.slots.findIndex((s) => s === null);
      if (i < 0) return; // seven or more sessions: the extras go without a dot
      this.slots[i] = { id, working: false, lastAt: now };
    }
    const s = this.slots[i]!;
    s.lastAt = now;
    if (event === "UserPromptSubmit" || event === "PreToolUse") s.working = true;
    if (event === "Stop" || event === "StopFailure") s.working = false;
  }

  private expire(now: number) {
    this.slots = this.slots.map((s) => (s && now - s.lastAt > STALE_MS ? null : s));
  }

  /** What the LEDs show: one colour per slot, [0,0,0] for an empty one (slot k = LED pair k). */
  frame(now: number): Rgb[] {
    this.expire(now);
    return this.slots.map((s, i) => {
      if (!s) return [0, 0, 0];
      const k = s.working ? WORKING : IDLE;
      return COLOURS[i].map((c) => Math.round(c * k)) as Rgb;
    });
  }

  /** Which colour each session has, for /status. */
  colours(): Record<string, number> {
    return Object.fromEntries(this.slots.flatMap((s, i) => (s ? [[s.id, i]] : [])));
  }
}
