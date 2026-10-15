// The diary's moments (Phase 5, spec §9): every sticker on a page is a real moment.
// Derived on demand from the raw, append-only logs the bridge already keeps (hook
// payloads in ~/StackChanData/hooks, Toki's recordings in ~/StackChanData/
// recordings). Change these rules and the last 30 days redraw; older days are
// frozen by the bridge (spec §10.4).
//
// Plain TypeScript with type-only imports, so the bridge runs it directly.

import type { StreamEvent } from "../replay/events";
// The one value import carries its extension, so Node (the bridge) can resolve it.
import { classifyTool } from "./agentState.ts";
import type { HookPayload } from "./hooks";

export type MomentKind =
  | "hello" // first session of the day
  | "met" // toki setup finished: the day you met Toki (logged once, as TokiMet)
  | "shipped" // a push or a merge (spec §9.4 SHIPPED!!)
  | "asked" // you sent Claude a prompt
  | "work" // a tool call: `detail` is the activity (read, edit, run, test, web, search, subagent, other)
  | "blocked" // Claude needed your permission
  | "approved"
  | "denied"
  | "always" // you allowed, with a rule
  | "question" // Claude asked you a question
  | "your-turn" // it waited more than 5 minutes for you (`n` = minutes)
  | "error"
  | "done" // a turn finished
  | "subagents" // a burst of subagents (`n` = how many)
  | "context-full" // the conversation was compacted
  | "yolo" // auto mode or permission bypass came on
  | "plan" // plan mode came on
  | "quiet" // quiet mode (double-tap)
  | "closed" // you closed the day (`detail`: earned or quiet)
  | "boop";

export type Moment = {
  t: number; // epoch ms
  kind: MomentKind;
  /** The face Toki showed for this moment: its sticker. */
  face: string;
  session?: string;
  project?: string; // private: never published
  detail?: string;
  n?: number;
  /** What happened, for the sticker's card (private: never published). */
  ctx?: MomentContext;
};

/** A moment's story, from the hooks (rich) or Buddy (thin). Every text is clipped short. */
export type MomentContext = {
  title?: string; // the session's title
  prompt?: string; // what you asked
  tool?: string;
  target?: string; // the command, file or URL it acted on
  error?: string;
  from?: string; // YOLO / PLAN: the permission mode before
  ran?: number; // YOLO / PLAN: tool calls while it was on
  endedAt?: number; // YOLO / PLAN: when it went off
  who?: string; // who answered: Toki, the simulator
  rule?: string; // ALWAYS: the rule, in words
  reply?: string; // Claude's last words on the turn
  ms?: number; // how long the turn took
  kind?: WorkKind; // a turn: what sort of work it was (from its tools)
  model?: string; // a turn: which model did it (from the transcript, via the bridge)
  work?: Record<string, number>; // a turn's tool calls by activity
  trigger?: string; // CONTEXT FULL: manual or auto
  agents?: string[]; // SUBAGENTS: what each was for
};

/**
 * What sort of work a turn was (15 Oct, after a "work report" brief: a record of
 * activity, kept as a diary, not a ledger). One kind per turn, by the tools it
 * used, in this order of precedence: email, images, documents, research, code;
 * a turn with no tools is "other". Only tools Claude Code runs can be seen
 * (Cowork's never reach the bridge).
 */
export type WorkKind = "email" | "images" | "documents" | "research" | "code" | "other";
export const WORK_KINDS: WorkKind[] = ["email", "images", "documents", "research", "code", "other"];

const MEDIA_FILE = /\.(png|jpe?g|gif|webp|svg|heic|mp4|mov|webm|psd|afdesign)$/i;
const DOC_FILE = /\.(docx?|pptx?|xlsx?|pdf|key|pages|numbers|odt)$/i;
// Housekeeping that isn't work in itself: it doesn't decide a turn's kind.
const NOT_WORK = new Set(["ToolSearch", "Skill", "AskUserQuestion", "ExitPlanMode", "TodoWrite", "TaskStop", "ScheduleWakeup", "SendUserFile", "ReadNotifications"]);

/** The kind of one tool call, or null for housekeeping. MCP tools are judged by their tool name (connectors arrive as codes). */
export function kindOf(tool: string, input?: Record<string, unknown>): WorkKind | null {
  if (NOT_WORK.has(tool)) return null;
  const name = tool.toLowerCase();
  const file = String(input?.file_path ?? input?.path ?? "");
  if (/slack/.test(name)) return "other";
  if (/mail|gmail|outlook|inbox|_draft|draft$|thread|(^|_)reply|forward/.test(name)) return "email";
  if (/websearch|webfetch|search_docs|documentation|transcript|research|defuddle|wikipedia/.test(name)) return "research";
  if (/image|video|photo|predictions|replicate|canva|figma|recraft|sticker/.test(name) || MEDIA_FILE.test(file)) return "images";
  if (/docx|pptx|xlsx|word|powerpoint|excel|slides|spreadsheet|document|notion|pdf/.test(name) || DOC_FILE.test(file)) return "documents";
  if (/^(bash|edit|multiedit|write|read|grep|glob|notebookedit|lsp|agent|task)$/.test(name) || /browser|chrome|playwright|terminal|devtools|preview/.test(name)) return "code";
  return "other";
}

/** A turn's kind from the kinds of its tools: the highest in precedence wins. */
export function turnKind(kinds: Set<WorkKind>): WorkKind {
  return WORK_KINDS.find((k) => kinds.has(k)) ?? "other";
}

/** "claude-opus-5-5" → "Opus 5.5"; anything else as it came. */
export function modelName(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

/** Trimmed, first lines kept, at most `n` characters; undefined when empty. */
export function clip(v: unknown, n = 240): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+\n/g, "\n").trim();
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/**
 * The push or merge a shell command runs, if it runs one: `git push` or `gh pr merge`
 * as a command of its own, never inside quotes, a heredoc or a grep pattern (a
 * commit message that mentions "git push" isn't shipping).
 */
export function shipCommand(cmd: string): string | undefined {
  const bare = cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\2(\n|$)/g, " ") // heredocs
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const m = /(?:^|[;&|\n(]\s*)((?:git push|gh pr merge)\b[^;&|\n)]*)/.exec(bare);
  return m?.[1].trim();
}

/** Drops a leading `cd <project> &&`: noise in a card. */
const dropCd = (cmd: string) => cmd.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, "");

/** What a tool acted on, in a line: a command, a path (relative to the project), a URL, a query. */
function targetOf(input: Record<string, unknown> | undefined, cwd?: string): string | undefined {
  if (!input) return undefined;
  const pick = input.command ?? input.file_path ?? input.url ?? input.query ?? input.pattern ?? input.description ?? input.prompt;
  let s = typeof pick === "string" ? dropCd(pick).split("\n")[0] : undefined;
  if (s && cwd && s.startsWith(cwd + "/")) s = s.slice(cwd.length + 1);
  return clip(s, 160);
}

const YOUR_TURN_MS = 5 * 60_000; // spec §9.4: waited more than 5 min for me
const ACTIVITY_FACE: Record<string, string> = {
  read: "read",
  search: "search",
  edit: "edit",
  run: "run",
  test: "test",
  web: "web",
  subagent: "subagent",
  think: "think",
  other: "working",
};

const project = (cwd: string | undefined) => (cwd ? (cwd.split("/").filter(Boolean).pop() ?? "?") : undefined);

/** Moments from the bridge's hook log: [{t: ISO, hook: payload}], in time order. */
type LoggedHook = HookPayload & {
  permission_mode?: string;
  prompt?: string;
  session_title?: string;
  error?: string;
  last_assistant_message?: string;
  trigger?: string;
  // The bridge's own record of an answer it gave (TokiDecision).
  decision?: string;
  who?: string;
  rule?: string;
  model?: string; // TokiModel: the model that did the turn
};

export function momentsFromHooks(records: { t: string; hook: LoggedHook }[]): Moment[] {
  const out: Moment[] = [];
  const seen = new Set<string>();
  const mode = new Map<string, string>();
  const asked = new Map<string, { t: number; ctx: MomentContext }>(); // session → its open permission request
  const where = new Map<string, string>(); // session → project
  const titles = new Map<string, string>(); // session → its title
  const modeOn = new Map<string, Moment>(); // session → its YOLO / PLAN sticker while that mode is on
  const turns = new Map<string, { m: Moment; kinds: Set<WorkKind> }>(); // session → its open turn
  const lastTurn = new Map<string, Moment>(); // session → its last finished turn (the model arrives after the Stop)
  const finishTurn = (s: string) => {
    const open = turns.get(s);
    if (!open) return;
    // A turn with no tools was Claude answering, not a kind of work: no kind.
    if (open.kinds.size) open.m.ctx = { ...open.m.ctx, kind: turnKind(open.kinds) };
    lastTurn.set(s, open.m);
    turns.delete(s);
  };
  for (const { t: iso, hook: p } of records) {
    const t = Date.parse(iso);
    // The day you met Toki: setup's last step logs it once. Not a session, so no HELLO.
    if (p.hook_event_name === "TokiMet") {
      out.push({ t, kind: "met", face: "approved" });
      continue;
    }
    const s = p.session_id ?? "?";
    // A session's project is the folder it started in, even if it later cds elsewhere.
    if (!where.has(s) && project(p.cwd)) where.set(s, project(p.cwd)!);
    const proj = where.get(s);
    const base = { t, session: s, project: proj };
    if (p.session_title) titles.set(s, p.session_title);
    if (!seen.has(s)) {
      seen.add(s);
      if (seen.size === 1) out.push({ ...base, kind: "hello", face: "approved" });
    }
    // Mode changes: YOLO and PLAN stickers (spec §9.4).
    const m = p.permission_mode;
    if (m && m !== mode.get(s)) {
      const on = modeOn.get(s);
      if (on) {
        on.ctx = { ...on.ctx, endedAt: t };
        modeOn.delete(s);
      }
      // No mode seen yet: the session started in this mode.
      const ctx: MomentContext = { from: mode.get(s) ?? "start", ran: 0 };
      const sticker: Moment | null =
        m === "auto" || m === "bypassPermissions"
          ? { ...base, kind: "yolo", face: "web", detail: m, ctx }
          : m === "plan"
            ? { ...base, kind: "plan", face: "think", ctx }
            : null;
      if (sticker) {
        out.push(sticker);
        modeOn.set(s, sticker);
      }
      mode.set(s, m);
    }
    const tool = p.tool_name ?? "";
    // Something answered an open request: how long it waited on you.
    const answered = (kind: MomentKind, face: string, extra: MomentContext = {}) => {
      const open = asked.get(s);
      if (open === undefined) return;
      asked.delete(s);
      const n = Math.round((t - open.t) / 60_000);
      out.push({ ...base, kind, face, n, ctx: { ...open.ctx, ...extra } });
      if (t - open.t > YOUR_TURN_MS) out.push({ ...base, kind: "your-turn", face: "blocked", n, ctx: open.ctx });
    };
    switch (p.hook_event_name) {
      case "UserPromptSubmit": {
        answered("approved", "approved");
        finishTurn(s);
        const turn: Moment = { ...base, kind: "asked", face: "think", ctx: { prompt: clip(p.prompt) } };
        out.push(turn);
        turns.set(s, { m: turn, kinds: new Set() });
        break;
      }
      case "PreToolUse": {
        const activity = classifyTool({ name: tool, summary: typeof p.tool_input?.command === "string" ? p.tool_input.command : "" });
        if (tool !== "AskUserQuestion") out.push({ ...base, kind: "work", face: ACTIVITY_FACE[activity] ?? "working", detail: activity });
        const sort = kindOf(tool, p.tool_input);
        if (sort) turns.get(s)?.kinds.add(sort);
        const on = modeOn.get(s);
        if (on?.ctx) on.ctx.ran = (on.ctx.ran ?? 0) + 1;
        // SHIPPED!!: a push or a merge, the moment work leaves the Mac.
        const cmd = typeof p.tool_input?.command === "string" ? p.tool_input.command : "";
        const ship = tool === "Bash" ? shipCommand(cmd) : undefined;
        if (ship) out.push({ ...base, kind: "shipped", face: "done", ctx: { tool, target: clip(ship, 160) } });
        if (activity === "subagent") {
          const what = clip(p.tool_input?.description, 80) ?? clip(p.tool_input?.subagent_type, 80);
          out.push({ ...base, kind: "subagents", face: "subagent", n: 1, ctx: { agents: what ? [what] : [] } });
        }
        break;
      }
      case "PermissionRequest":
        asked.set(s, { t, ctx: { tool, target: targetOf(p.tool_input, p.cwd) } });
        out.push({
          ...base,
          kind: tool === "AskUserQuestion" ? "question" : "blocked",
          face: tool === "AskUserQuestion" ? "asked" : "blocked",
          detail: tool,
          ctx: tool === "AskUserQuestion" ? { prompt: clip((p.tool_input?.questions as { question?: string }[] | undefined)?.[0]?.question) } : asked.get(s)!.ctx,
        });
        break;
      case "TokiModel": {
        // The bridge read which model did the last turn (logged just after its Stop).
        const turn = lastTurn.get(s);
        if (turn && p.model) turn.ctx = { ...turn.ctx, model: p.model };
        break;
      }
      case "TokiDecision":
        // The bridge answered (from Toki or the simulator): which way, and the rule for Always.
        if (p.decision === "always") answered("always", "approved", { who: p.who, rule: p.rule });
        else if (p.decision === "deny") answered("denied", "denied", { who: p.who });
        else answered("approved", "approved", { who: p.who });
        break;
      case "PostToolUse":
        answered("approved", "approved");
        break;
      case "PermissionDenied":
        answered("denied", "denied");
        break;
      case "PostToolUseFailure":
        answered("approved", "approved");
        out.push({ ...base, kind: "error", face: "error", detail: tool, ctx: { tool, target: targetOf(p.tool_input, p.cwd), error: clip(p.error) } });
        break;
      case "Stop":
        asked.delete(s);
        finishTurn(s);
        out.push({ ...base, kind: "done", face: "done", ctx: { reply: clip(p.last_assistant_message, 200) } });
        break;
      case "StopFailure":
        asked.delete(s);
        out.push({ ...base, kind: "error", face: "error", ctx: { error: clip(p.error) } });
        break;
      case "PreCompact":
        out.push({ ...base, kind: "context-full", face: "sleepy", ctx: { trigger: p.trigger } });
        break;
    }
  }
  for (const s of [...turns.keys()]) finishTurn(s); // turns still going: their kind so far
  // Every sticker learns its session's title, wherever in the session it arrived.
  for (const m of out) {
    const title = m.session && titles.get(m.session);
    if (title && m.kind !== "work") m.ctx = { ...m.ctx, title: clip(title, 80) };
  }
  return mergeSubagents(out);
}

/**
 * Moments from one of Toki's recordings: Buddy's stream (desktop sessions, no
 * session ids) and Toki's own log lines (touches, quiet mode, the day closing).
 * `startedAt` is the recording's first timestamp; event times are offsets from it.
 */
export function momentsFromRecording(startedAt: number, events: StreamEvent[]): Moment[] {
  const out: Moment[] = [];
  let prompt = null as { id: string; at: number; ctx: MomentContext } | null; // cast: TS would narrow it to null for the whole loop
  let lastMsg = "";
  for (const e of events) {
    const t = startedAt + e.t;
    switch (e.kind) {
      case "turn":
        if (e.role === "user" && !e.blocks.includes("tool_result")) out.push({ t, kind: "asked", face: "think" });
        if (e.role === "assistant")
          for (const tool of e.tools) {
            const activity = classifyTool(tool);
            out.push({ t, kind: "work", face: ACTIVITY_FACE[activity] ?? "working", detail: activity });
            if (activity === "subagent") out.push({ t, kind: "subagents", face: "subagent", n: 1 });
          }
        if (e.toolError) out.push({ t, kind: "error", face: "error" });
        break;
      case "snapshot":
        if (e.prompt && e.waiting > 0 && prompt?.id !== e.prompt.id) {
          const ctx = { tool: e.prompt.tool, target: clip(e.prompt.hint, 160) };
          prompt = { id: e.prompt.id, at: t, ctx };
          const q = e.prompt.tool === "AskUserQuestion";
          out.push({ t, kind: q ? "question" : "blocked", face: q ? "asked" : "blocked", detail: e.prompt.tool, ctx });
        } else if (!e.prompt && prompt) {
          // Answered on the Mac: we don't know which way.
          if (t - prompt.at > YOUR_TURN_MS) out.push({ t, kind: "your-turn", face: "blocked", n: Math.round((t - prompt.at) / 60_000), ctx: prompt.ctx });
          prompt = null;
        }
        if (e.msg.startsWith("done (") && !lastMsg.startsWith("done (")) {
          const failed = /error|fail/i.test(e.msg);
          out.push({ t, kind: failed ? "error" : "done", face: failed ? "error" : "done" });
        }
        lastMsg = e.msg;
        break;
      case "decision":
        if (prompt) {
          const n = Math.round((t - prompt.at) / 60_000);
          out.push({ t, kind: e.decision === "deny" ? "denied" : "approved", face: e.decision === "deny" ? "denied" : "approved", n, ctx: { ...prompt.ctx, who: "Toki" } });
          if (t - prompt.at > YOUR_TURN_MS) out.push({ t, kind: "your-turn", face: "blocked", n, ctx: prompt.ctx });
          prompt = null;
        }
        break;
      case "device": {
        // Toki's own log: "touch tap face", "moment quiet", "moment closed earned".
        const m = /^moment (quiet|closed|reopened)(?: (\w+))?/.exec(e.text);
        if (m?.[1] === "quiet") out.push({ t, kind: "quiet", face: "quiet" });
        if (m?.[1] === "closed") out.push({ t, kind: "closed", face: m[2] === "earned" ? "closed" : "sleepy", detail: m[2] });
        if (/^touch tap face/.test(e.text)) out.push({ t, kind: "boop", face: "boop" });
        break;
      }
    }
  }
  return mergeSubagents(out);
}

/** Subagents launched within 30 s of each other are one burst: SUBAGENTS ×n. */
function mergeSubagents(ms: Moment[]): Moment[] {
  const out: Moment[] = [];
  for (const m of ms) {
    let prev: Moment | undefined;
    for (let i = out.length - 1; i >= 0 && !prev; i--) if (out[i].kind === "subagents" && out[i].session === m.session) prev = out[i];
    if (m.kind === "subagents" && prev && m.t - prev.t < 30_000) {
      prev.n = (prev.n ?? 1) + 1;
      if (m.ctx?.agents?.length) prev.ctx = { ...prev.ctx, agents: [...(prev.ctx?.agents ?? []), ...m.ctx.agents] };
    } else out.push(m);
  }
  return out;
}

/**
 * Hooks and Buddy often report the same moment (a desktop session sends both).
 * Hooks win: a recording moment is dropped if a hook moment of the same kind (and
 * activity) is within 5 s.
 */
export function mergeSources(fromHooks: Moment[], fromRecordings: Moment[]): Moment[] {
  const key = (m: Moment) => `${m.kind}:${m.kind === "work" ? m.detail : ""}`;
  const byKey = new Map<string, number[]>();
  for (const m of fromHooks) byKey.set(key(m), [...(byKey.get(key(m)) ?? []), m.t]);
  const extra = fromRecordings.filter((m) => {
    if (["quiet", "closed", "boop"].includes(m.kind)) return true; // only Toki knows these
    return !(byKey.get(key(m)) ?? []).some((t) => Math.abs(t - m.t) < 5_000);
  });
  return [...fromHooks, ...extra].sort((a, b) => a.t - b.t);
}

/** The diary's day: late nights belong to the day they started in (spec §3.4, 02:00 rollover). */
export function dayOf(t: number, rolloverHour = 2): string {
  const d = new Date(t - rolloverHour * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DaySummary = {
  day: string;
  moments: number;
  prompts: number;
  toolCalls: number;
  byActivity: Record<string, number>;
  byKind?: Partial<Record<WorkKind, number>>; // turns by kind (from 15 Oct; older frozen days lack it)
  byModel?: Record<string, number>; // turns by model, e.g. "Opus 5.5"
  faces?: Record<string, number>; // moments by Toki's face, for the month and year views (from 15 Oct)
  shipped?: string[]; // projects that shipped this day, for holo first ships (private)
  longestRun?: { tools: number; t: number }; // the biggest turn that finished without needing you, for holo
  approvals: number;
  denials: number;
  always: number;
  questions: number;
  errors: number;
  sparkles: number; // turns finished (done's sparkles)
  subagents: number;
  contextFull: number;
  waitedOnYouMin: number;
  sessions: number;
  projects: string[]; // private
  firstAt: number | null;
  lastAt: number | null;
};

/**
 * What holo needs from a day (spec §9.5): the projects that shipped, and the
 * biggest turn that finished without needing you (no approval, no question).
 */
function runsOf(ms: Moment[]): Pick<DaySummary, "shipped" | "longestRun"> {
  const shipped: string[] = [];
  for (const m of ms) if (m.kind === "shipped" && m.project && !shipped.includes(m.project)) shipped.push(m.project);
  const open = new Map<string, { t: number; tools: number; needsYou: boolean }>();
  let longestRun: DaySummary["longestRun"];
  for (const m of [...ms].sort((a, b) => a.t - b.t)) {
    const key = m.session ?? "_";
    if (m.kind === "asked") open.set(key, { t: m.t, tools: 0, needsYou: false });
    const turn = open.get(key);
    if (!turn) continue;
    if (m.kind === "work") turn.tools++;
    else if (["blocked", "question", "approved", "denied", "always"].includes(m.kind)) turn.needsYou = true;
    else if (m.kind === "done") {
      if (!turn.needsYou && turn.tools > (longestRun?.tools ?? 0)) longestRun = { tools: turn.tools, t: turn.t };
      open.delete(key);
    }
  }
  return { shipped, ...(longestRun ? { longestRun } : {}) };
}

/** The day's numbers, for the data labels (spec §9.1). A diary, not a report: counts only, no scores. */
export function summariseDay(day: string, ms: Moment[]): DaySummary {
  const count = (k: MomentKind) => ms.filter((m) => m.kind === k).length;
  const byActivity: Record<string, number> = {};
  for (const m of ms) if (m.kind === "work" && m.detail) byActivity[m.detail] = (byActivity[m.detail] ?? 0) + 1;
  const byKind: Partial<Record<WorkKind, number>> = {};
  const byModel: Record<string, number> = {};
  const faces: Record<string, number> = {};
  for (const m of ms) if (m.face) faces[m.face] = (faces[m.face] ?? 0) + 1;
  for (const m of ms) {
    if (m.kind !== "asked") continue;
    if (m.ctx?.kind) byKind[m.ctx.kind] = (byKind[m.ctx.kind] ?? 0) + 1;
    if (m.ctx?.model) byModel[modelName(m.ctx.model)] = (byModel[modelName(m.ctx.model)] ?? 0) + 1;
  }
  return {
    ...runsOf(ms),
    day,
    moments: ms.length,
    prompts: count("asked"),
    toolCalls: count("work"),
    byActivity,
    byKind,
    byModel,
    faces,
    approvals: count("approved") + count("always"),
    denials: count("denied"),
    always: count("always"),
    questions: count("question"),
    errors: count("error"),
    sparkles: count("done"),
    subagents: ms.filter((m) => m.kind === "subagents").reduce((n, m) => n + (m.n ?? 1), 0),
    contextFull: count("context-full"),
    waitedOnYouMin: ms.filter((m) => m.kind === "approved" || m.kind === "denied").reduce((n, m) => n + (m.n ?? 0), 0),
    sessions: new Set(ms.map((m) => m.session).filter(Boolean)).size,
    projects: [...new Set(ms.map((m) => m.project).filter((p): p is string => !!p))],
    firstAt: ms.length ? ms[0].t : null,
    lastAt: ms.length ? ms[ms.length - 1].t : null,
  };
}
