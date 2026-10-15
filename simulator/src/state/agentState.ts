// Agent-state layer: turns the event stream into what Toki shows.
// Pure functions, no React, no DOM. This file moves into the bridge in Phase 4.
//
// Spec references: §3.2 derived signals, §3.3 priority, §4.2 expression map.

import type { Gesture, Question, StreamEvent, ToolCall } from "../replay/events";

export type Activity = "think" | "read" | "search" | "edit" | "run" | "test" | "web" | "subagent" | "other";
export type Mode = "idle" | "working" | "done" | "error" | "blocked"; // priority: blocked > error > done > working > idle
export type OneShotKind = "done" | "error" | "approved" | "denied" | "resolved-elsewhere" | "subagents";

export type OneShot = { kind: OneShotKind; at: number; detail?: string };

export type Config = {
  /** How long an activity stays current after its last turn event. (tune) */
  activityHoldMs: number;
  /** The shown activity changes no faster than this, so the face never twitches. (tune) */
  minDwellMs: number;
  /** How long the done one-shot outranks working. Spec: under 1.5 s. (tune) */
  oneShotMs: number;
  /**
   * How long error outranks working: 3 s of spiral eyes, then > <. A deliberate
   * exception to the 1.5 s one-shot rule (Gideon, 3 Oct): errors are worth a look.
   */
  errorMs: number;
  /** The boop (a tap on the face) is a one-shot. (tune) */
  boopMs: number;
  /** Quiet mode (double-tap) lasts this long, unless you double-tap again. Spec: 30 min. (tune) */
  quietMs: number;
  /** "Close the day?" waits this long for an answer, then gives up. (tune) */
  closeAskMs: number;
  /** After you close the day: the celebration (earned) or the yawn (quiet) plays, then the shutter comes down. (tune) */
  closeShowMs: number;
};

export const defaultConfig: Config = {
  activityHoldMs: 20_000,
  minDwellMs: 1_500,
  oneShotMs: 1_200,
  errorMs: 4_000,
  boopMs: 1_200,
  quietMs: 30 * 60_000,
  closeAskMs: 10_000,
  closeShowMs: 2_000,
};

export type Shown = { mode: Mode; activity: Activity | null; since: number };

export type AgentState = {
  now: number;
  sessions: { total: number; running: number; waiting: number };
  msg: string;
  tokensToday: number;
  prompt: { id: string; tool: string; hint: string; since: number; always?: string; question?: Question } | null;
  /** When the current turn began (your prompt), until it finishes: drives "long turn". */
  turnSince: number | null;
  /**
   * Subagents running now, by tool_use id: +1 on an Agent/Task call, −1 when its
   * result comes back. In Phase 4 the hooks' SubagentStart / SubagentStop feed
   * this too. Caveat: a background subagent returns its result at once.
   */
  subagents: string[];
  /** Latest raw activity, before smoothing. */
  activity: { kind: Activity; tool: ToolCall | null; at: number } | null;
  oneShots: OneShot[];
  // Touch on the face (spec §6). These are the robot's own states, not Claude's.
  /** When you last booped Toki (a tap on the face). */
  boopAt: number | null;
  /** Quiet mode (double-tap): until when. Only approvals get through. */
  quietUntil: number | null;
  /** "Close the day?" (long-press): when it was asked, while it waits for an answer. */
  closeAskAt: number | null;
  /**
   * The day is closed (spec §3.4): earned if a turn finished and nothing is left
   * blocked. A tap on the shutter reopens it (Gideon, 3 Oct); the day rollover at
   * 02:00 will too, once the bridge brings a clock.
   */
  dayClosed: { at: number; earned: boolean } | null;
  /** Turns finished today (since boot until the bridge brings a clock; reopening keeps it): decides whether closing is earned. */
  doneToday: number;
  /** What the face shows: raw state after priority and hysteresis. */
  shown: Shown;
  stats: {
    toolCalls: number;
    byActivity: Partial<Record<Activity, number>>;
    approvals: number;
    denials: number;
    errors: number;
    waitedOnYouMs: number;
  };
};

export function initialState(): AgentState {
  return {
    now: 0,
    sessions: { total: 0, running: 0, waiting: 0 },
    msg: "",
    tokensToday: 0,
    prompt: null,
    turnSince: null,
    subagents: [],
    activity: null,
    oneShots: [],
    boopAt: null,
    quietUntil: null,
    closeAskAt: null,
    dayClosed: null,
    doneToday: 0,
    shown: { mode: "idle", activity: null, since: 0 },
    stats: { toolCalls: 0, byActivity: {}, approvals: 0, denials: 0, errors: 0, waitedOnYouMs: 0 },
  };
}

const TEST_RE = /\b(npm (run )?test|npx (vitest|jest|playwright)|vitest|jest|pytest|playwright test|go test|cargo test|swift test|xcodebuild test)\b/;

export function classifyTool(tool: ToolCall): Activity {
  const n = tool.name;
  if (n === "Agent" || n === "Task") return "subagent";
  if (n === "Edit" || n === "Write" || n === "MultiEdit" || n === "NotebookEdit") return "edit";
  if (n === "Read" || n === "NotebookRead") return "read";
  if (n === "Grep" || n === "Glob" || n === "ToolSearch") return "search";
  if (n === "WebFetch" || n === "WebSearch" || /browser|chrome|navigate|fetch/i.test(n)) return "web";
  if (n === "Bash") return TEST_RE.test(tool.summary) ? "test" : "run";
  if (/search|find|query/i.test(n)) return "search";
  if (/read|get_|list_/i.test(n)) return "read";
  return "other";
}

function pushOneShot(s: AgentState, kind: OneShotKind, at: number, detail?: string) {
  s.oneShots = [...s.oneShots.slice(-19), { kind, at, detail }];
}

/** Applies one event. Returns a new state object (the input is not mutated). */
export function applyEvent(prev: AgentState, e: StreamEvent, cfg: Config = defaultConfig): AgentState {
  const s: AgentState = { ...prev, stats: { ...prev.stats, byActivity: { ...prev.stats.byActivity } }, now: e.t };

  switch (e.kind) {
    case "snapshot": {
      s.sessions = { total: e.total, running: e.running, waiting: e.waiting };
      s.tokensToday = e.tokensToday;
      if (e.msg.startsWith("done (") && !prev.msg.startsWith("done (")) {
        const failed = /error|fail/i.test(e.msg);
        pushOneShot(s, failed ? "error" : "done", e.t, e.msg);
        if (!failed) s.doneToday++;
        s.turnSince = null;
        s.subagents = []; // a finished turn has no foreground subagents left
      }
      s.msg = e.msg;
      if (e.prompt && e.waiting > 0) {
        if (!prev.prompt || prev.prompt.id !== e.prompt.id) s.prompt = { ...e.prompt, since: e.t };
      } else if (prev.prompt) {
        // Cleared without a decision from the robot: answered on the Mac.
        s.stats.waitedOnYouMs += e.t - prev.prompt.since;
        s.prompt = null;
        pushOneShot(s, "resolved-elsewhere", e.t);
      }
      break;
    }
    case "turn": {
      if (e.toolError) {
        s.stats.errors++;
        pushOneShot(s, "error", e.t);
      }
      if (e.results?.length && prev.subagents.length) {
        s.subagents = prev.subagents.filter((id) => !e.results!.includes(id));
      }
      if (e.role === "user" && !e.blocks.includes("tool_result")) {
        s.activity = { kind: "think", tool: null, at: e.t }; // a new prompt: Claude starts thinking
        s.turnSince ??= e.t;
      }
      if (e.role === "assistant") {
        const spawned = e.tools.filter((t) => classifyTool(t) === "subagent");
        if (spawned.length) {
          pushOneShot(s, "subagents", e.t, String(spawned.length));
          s.subagents = [...s.subagents, ...spawned.map((t, i) => t.id ?? `agent-${e.t}-${i}`)];
        }
        const last = e.tools[e.tools.length - 1];
        if (last) {
          const kind = classifyTool(last);
          s.activity = { kind, tool: last, at: e.t };
          for (const t of e.tools) {
            const k = classifyTool(t);
            s.stats.toolCalls++;
            s.stats.byActivity[k] = (s.stats.byActivity[k] ?? 0) + 1;
          }
        } else if (e.blocks.includes("thinking")) {
          s.activity = { kind: "think", tool: null, at: e.t };
        } else if (prev.activity) {
          s.activity = { ...prev.activity, at: e.t }; // text-only reply keeps the current activity alive
        }
      }
      break;
    }
    case "decision": {
      if (prev.prompt && prev.prompt.id === e.id) {
        s.stats.waitedOnYouMs += e.t - prev.prompt.since;
        s.prompt = null;
      }
      if (e.decision === "deny") s.stats.denials++;
      else s.stats.approvals++;
      pushOneShot(s, e.decision === "deny" ? "denied" : "approved", e.t);
      break;
    }
    case "prompt":
      if (!prev.prompt || prev.prompt.id !== e.id)
        s.prompt = { id: e.id, tool: e.tool, hint: e.hint, since: e.t, always: e.always, question: e.question };
      break;
    case "prompt-cleared":
      if (prev.prompt && prev.prompt.id === e.id) {
        s.stats.waitedOnYouMs += e.t - prev.prompt.since;
        s.prompt = null;
        pushOneShot(s, "resolved-elsewhere", e.t);
      }
      break;
    case "stop":
      pushOneShot(s, e.error ? "error" : "done", e.t);
      if (!e.error) s.doneToday++;
      s.turnSince = null;
      s.subagents = []; // a finished turn has no foreground subagents left
      break;
    case "gesture":
      applyGesture(s, e.gesture, e.target, e.t, cfg);
      break;
    case "device":
    case "repeat":
      break;
  }
  return s;
}

/**
 * What a touch means depends on what Toki is doing (spec §6). Blocked: only the
 * Allow / Deny buttons count (they arrive as decisions). "Close the day?": only
 * its two buttons. Otherwise a tap wakes Toki (Gideon, 3 Oct): it opens the
 * shutter, ends quiet mode, or just boops. A double-tap starts quiet mode, and a
 * long-press asks to close the day.
 */
function applyGesture(s: AgentState, gesture: Gesture, target: "face" | "yes" | "no", t: number, cfg: Config) {
  if (s.prompt) return;
  if (s.closeAskAt !== null && t - s.closeAskAt <= cfg.closeAskMs) {
    if (gesture !== "tap" || target === "face") return;
    s.closeAskAt = null;
    if (target === "yes") {
      s.dayClosed = { at: t, earned: s.doneToday > 0 };
      s.quietUntil = null;
    }
    return;
  }
  s.closeAskAt = null;
  if (s.dayClosed) {
    if (gesture === "tap") {
      // Reopened: usually "one more thing" the same evening, so the day's count
      // stays (Gideon, 3 Oct). Only the 02:00 rollover (with the bridge's clock) resets it.
      s.dayClosed = null;
      s.boopAt = t;
    }
    return;
  }
  if (gesture === "tap") {
    s.quietUntil = null;
    s.boopAt = t;
  } else if (gesture === "double-tap") {
    // The first tap of the two already booped; quiet takes over at once.
    s.boopAt = null;
    s.quietUntil = t + cfg.quietMs;
  } else if (gesture === "long-press") s.closeAskAt = t;
}

function latestOneShot(s: AgentState, kinds: OneShotKind[], now: number, windowMs: number): OneShot | null {
  for (let i = s.oneShots.length - 1; i >= 0; i--) {
    const o = s.oneShots[i];
    if (now - o.at > windowMs) return null;
    if (kinds.includes(o.kind)) return o;
  }
  return null;
}

/** What the face should show right now, before hysteresis. */
export function target(s: AgentState, now: number, cfg: Config): { mode: Mode; activity: Activity | null } {
  const working = s.activity && now - s.activity.at <= cfg.activityHoldMs ? s.activity.kind : null;
  if (s.prompt) return { mode: "blocked", activity: working };
  if (latestOneShot(s, ["error"], now, cfg.errorMs)) return { mode: "error", activity: working };
  if (latestOneShot(s, ["done"], now, cfg.oneShotMs)) return { mode: "done", activity: null };
  if (working) return { mode: "working", activity: working };
  return { mode: "idle", activity: null };
}

/** Advances time: applies priority and hysteresis to update what is shown. */
export function tick(prev: AgentState, now: number, cfg: Config = defaultConfig): AgentState {
  const want = target(prev, now, cfg);
  const cur = prev.shown;
  if (want.mode === cur.mode && want.activity === cur.activity) return prev.now === now ? prev : { ...prev, now };

  // Waking from idle, urgent states and one-shots switch at once; changes between
  // activities (and back to idle) wait out the dwell time.
  const immediate =
    cur.mode === "idle" || want.mode === "blocked" || cur.mode === "blocked" || want.mode === "error" || want.mode === "done";
  if (!immediate && now - cur.since < cfg.minDwellMs) return { ...prev, now };
  return { ...prev, now, shown: { ...want, since: now } };
}

/** Folds events up to `now` (inclusive) into a state, from scratch. */
export function stateAt(events: StreamEvent[], now: number, cfg: Config = defaultConfig, stepMs = 250): AgentState {
  let s = initialState();
  let nextTick = 0;
  for (const e of events) {
    if (e.t > now) break;
    while (nextTick < e.t) {
      s = tick(s, nextTick, cfg);
      nextTick += stepMs;
    }
    s = tick(applyEvent(s, e, cfg), e.t, cfg);
  }
  while (nextTick <= now) {
    s = tick(s, nextTick, cfg);
    nextTick += stepMs;
  }
  return tick(s, now, cfg);
}
