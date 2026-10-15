// Toki's bridge (Phase 4, docs/bridge-hooks.md). Receives Claude Code hooks over
// http, answers at once, logs a trimmed copy, and turns each hook into the stream
// events the state layer already understands (simulator/src/state/hooks.ts).
//
//   node bridge/src/server.ts        (Node 24 runs TypeScript directly)
//
// Endpoints, on 127.0.0.1 only:
//   POST /hook/<Event>   a Claude Code hook (bridge/sandbox/.claude/settings.json)
//   GET  /events         server-sent stream of normalised events (the simulator's "Live from bridge")
//   GET  /status         Toki's Wi-Fi link, sessions seen, and who's listening
//
// It also dials Toki over Wi-Fi (robot.ts): the clock, and the recordings.
//
// Rules (bridge-hooks.md §1): never block Claude Code, so every hook gets an empty
// 200 straight away and the work happens after; payloads carry transcript
// content, so the log goes to ~/StackChanData, never into the repo.

import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, open } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { HookNormaliser, type HookPayload } from "../../simulator/src/state/hooks.ts";
import type { StreamEvent } from "../../simulator/src/replay/events.ts";
import { RobotLink } from "./robot.ts";
import { SessionColours } from "./sessions.ts";
import { createDiary } from "./diary.ts";
import { HOME } from "./paths.ts";
import { fromOurPage, SettingsMirror, validPatch } from "./settings.ts";

// Toki's settings (Phase 7): the robot holds them; the bridge keeps the last copy.
const settings = new SettingsMirror();
// The diary: frozen days kept, raw logs tidied after 30 days (spec §10.4).
const { listDays, loadDay, tidy } = createDiary({ rollover: () => settings.rollover() });
const housekeeping = () => {
  try {
    for (const f of tidy()) console.log(`${new Date().toISOString()} tidy: deleted ${f} (older than 30 days, its days are frozen)`);
  } catch (e) {
    console.error("tidy:", e);
  }
};
setTimeout(housekeeping, 10_000).unref(); // once settled after start, then every 6 hours
setInterval(housekeeping, 6 * 3_600_000).unref();

const PORT = Number(process.env.PORT ?? 7151);
const LOG_DIR = join(homedir(), "StackChanData", "hooks");
const MAX_BODY = 1_000_000; // a hook payload bigger than this is dropped, not parsed
const MAX_STRING = 2_000; // per bridge-hooks.md §2: cap every logged string

const startedAt = Date.now();
const normaliser = new HookNormaliser();
const listeners = new Set<ServerResponse>();
const robot = new RobotLink({
  onLine: (dir, line) => {
    if (dir !== "ctl") return;
    try {
      const m = JSON.parse(line) as { answer?: string; decision?: string; settings?: Record<string, number> };
      if (m.answer && isDecision(m.decision)) answer(m.answer, m.decision, "Toki");
      if (m.settings) settings.update(m.settings);
    } catch {
      // not ours
    }
  },
  // A reconnecting Toki learns about prompts it missed.
  onConnect: () => {
    sendLeds(true);
    robot.send({ settings: {} }); // ask for its settings
    for (const [id, p] of held) robot.send({ prompt: { id, tool: p.tool, hint: p.hint, always: p.always } });
  },
});

// ---------------------------------------------------------------------------
// Approvals (bridge-hooks.md §4). A PermissionRequest hook is held open until
// someone answers on Toki or the simulator, someone else answers first (the Mac,
// or Toki over Bluetooth: the session moves on), or 110 s pass. Silence (an empty
// 200) is always safe: Claude Code then asks the normal way. Nothing is ever
// approved without a tap.
// ---------------------------------------------------------------------------
const HOLD_MS = 110_000;
type Decision = "allow" | "deny" | "always";
const isDecision = (d: unknown): d is Decision => d === "allow" || d === "deny" || d === "always";
/** `suggestions` are the payload's permission_suggestions, returned as-is for Always allow (step 5). */
type Held = {
  res: ServerResponse;
  session: string;
  tool: string;
  hint: string;
  always?: string;
  suggestions?: unknown[];
  timer: NodeJS.Timeout;
};
const held = new Map<string, Held>();

function release(id: string, body: string, why: string) {
  const h = held.get(id);
  if (!h) return;
  held.delete(id);
  clearTimeout(h.timer);
  if (!h.res.writableEnded) {
    if (body) h.res.setHeader("Content-Type", "application/json");
    h.res.end(body);
  }
  robot.send({ cleared: id });
  console.log(`${new Date().toISOString().slice(11, 19)} prompt ${id.slice(0, 12)} released: ${why}`);
}

function answer(id: string, decision: Decision, who: string) {
  const h = held.get(id);
  if (!h) return;
  // Always allow hands Claude Code its own suggestions back, and Claude Code writes
  // the rule itself (bridge-hooks.md §4). Never without suggestions to hand back.
  if (decision === "always" && !h.suggestions?.length) return;
  const out = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision:
        decision === "deny"
          ? { behavior: "deny", message: `Denied on ${who}` }
          : decision === "always"
            ? { behavior: "allow", updatedPermissions: h.suggestions }
            : { behavior: "allow" },
    },
  };
  release(id, JSON.stringify(out), `${decision} from ${who}`);
  // For the diary: which way, from where, and for Always allow the rule in words.
  // Logged beside the hooks, as Toki's own event (the diary's ALWAYS sticker).
  log({ hook_event_name: "TokiDecision", session_id: h.session, tool_name: h.tool, decision, who, rule: decision === "always" ? h.always : undefined }).catch(() => {});
  broadcast({ kind: "decision", t: Date.now() - startedAt, id, decision: decision === "deny" ? "deny" : "once" });
}

type Session = { id: string; project: string; mode: string; lastEvent: string; lastAt: string; events: number };
const sessions = new Map<string, Session>();
const colours = new SessionColours();

// Session dots on Toki's LEDs (step 7c): sent when they change, and every 30 s so
// a Toki that restarted catches up. Toki drops them if they stop coming.
let lastLeds = "";
let lastLedsAt = 0;
function sendLeds(force = false) {
  const leds = JSON.stringify(colours.frame(Date.now()));
  if (!force && leds === lastLeds && Date.now() - lastLedsAt < 30_000) return;
  lastLeds = leds;
  lastLedsAt = Date.now();
  robot.send({ leds: JSON.parse(leds) });
}
setInterval(() => sendLeds(), 5_000).unref();

/** Drops the heavy, private fields and caps every string, so the log stays small. */
function trim(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_STRING ? v.slice(0, MAX_STRING) + "…" : v;
  if (Array.isArray(v)) return v.map(trim);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "tool_response" && k !== "transcript_path") out[k] = trim(x);
    return out;
  }
  return v;
}

/**
 * Reads only the model name from the end of a session's transcript (never its
 * text) and logs it as {hook_event_name: "TokiModel"}. Only files inside
 * ~/.claude are read; anything else is ignored.
 */
async function logModel(session: string, path: string) {
  const root = join(homedir(), ".claude") + "/";
  if (!resolve(path).startsWith(root)) return;
  try {
    const fh = await open(path);
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n").reverse();
      for (const line of lines) {
        let d: { type?: string; message?: { model?: unknown } };
        try {
          d = JSON.parse(line);
        } catch {
          continue; // the cut first line, or a partial write
        }
        const model = d.message?.model;
        if (d.type === "assistant" && typeof model === "string" && !model.startsWith("<")) {
          await log({ hook_event_name: "TokiModel", session_id: session, model });
          return;
        }
      }
    } finally {
      await fh.close();
    }
  } catch {
    // no transcript (yet): the turn simply has no model
  }
}

async function log(payload: unknown) {
  const day = new Date().toISOString().slice(0, 10);
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(join(LOG_DIR, `${day}.jsonl`), JSON.stringify({ t: new Date().toISOString(), hook: trim(payload) }) + "\n");
}

// Context fill per session (step 7b), logged only when it moves: the data for the
// "cheeks puff as context fills" face, which isn't designed yet.
const fill = new Map<string, number>();
function statusLine(body: string) {
  let d: { session_id?: string; context_window?: { used_percentage?: number | null }; rate_limits?: unknown };
  try {
    d = JSON.parse(body);
  } catch {
    return;
  }
  const id = d.session_id ?? "?";
  const pct = d.context_window?.used_percentage;
  if (typeof pct !== "number" || fill.get(id) === Math.round(pct)) return;
  fill.set(id, Math.round(pct));
  const day = new Date().toISOString().slice(0, 10);
  const line = JSON.stringify({ t: new Date().toISOString(), session: id, context: Math.round(pct), rate_limits: d.rate_limits });
  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(join(LOG_DIR, `statusline-${day}.jsonl`), line + "\n"))
    .catch(() => {});
}

function broadcast(e: StreamEvent) {
  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of listeners) res.write(line);
}

/** `res` is given only for PermissionRequest: it's held until answered. Everything else was answered already. */
function handleHook(event: string, body: string, req?: IncomingMessage, res?: ServerResponse) {
  let p: HookPayload;
  try {
    p = JSON.parse(body) as HookPayload;
  } catch {
    res?.end(); // silence is the safe answer
    return;
  }
  const now = new Date();
  const id = p.session_id ?? "?";
  const s = sessions.get(id);
  const project = p.cwd ? basename(p.cwd) : (s?.project ?? "?");
  if (!s) console.log(`${now.toISOString().slice(11, 19)} new session ${id.slice(0, 8)} in ${project}`);
  sessions.set(id, {
    id,
    project,
    mode: p.permission_mode ?? s?.mode ?? "?",
    lastEvent: event,
    lastAt: now.toISOString(),
    events: (s?.events ?? 0) + 1,
  });
  colours.touch(id, event, Date.now());
  sendLeds();
  for (const e of normaliser.normalise(p, Date.now() - startedAt)) {
    // A question (AskUserQuestion) isn't held: it's answered in Claude, so the hook
    // gets its empty reply at once. Toki still hears about it, and when it's gone.
    if (e.kind === "prompt" && e.question) robot.send({ prompt: { id: e.id, tool: e.tool, hint: e.hint, question: e.question } });
    if (e.kind === "prompt" && res && !e.question) {
      held.set(e.id, {
        res,
        session: id,
        tool: e.tool,
        hint: e.hint,
        always: e.always,
        suggestions: Array.isArray((p as { permission_suggestions?: unknown }).permission_suggestions) ? p.permission_suggestions : undefined,
        timer: setTimeout(() => release(e.id, "", "no answer in 110 s"), HOLD_MS),
      });
      // Claude Code gave up on the hook (its own timeout, or the session ended).
      res.on("close", () => release(e.id, "", "hook closed"));
      robot.send({ prompt: { id: e.id, tool: e.tool, hint: e.hint, always: e.always } });
    }
    if (e.kind === "prompt-cleared") {
      release(e.id, "", "answered elsewhere");
      robot.send({ cleared: e.id }); // also for prompts never held (questions); repeats are harmless
    }
    broadcast(e);
  }
  if (res && !res.writableEnded && ![...held.values()].some((h) => h.res === res)) res.end();
  log(p).catch((err) => console.error("log failed:", err.message));
  // Which model did the turn: hooks don't say, the transcript does (the scrapbook's
  // "who did the work", 15 Oct). Logged after the Stop, as Toki's own event.
  const transcript = (p as { transcript_path?: unknown }).transcript_path;
  if (event === "Stop" && typeof transcript === "string") logModel(id, transcript);
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "POST" && url.startsWith("/hook/")) {
    const event = url.slice("/hook/".length).replace(/[^\w]/g, "");
    let body = "";
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) body += c;
    });
    req.on("end", () => {
      if (event === "PermissionRequest" && size <= MAX_BODY) return handleHook(event, body, req, res);
      res.end(); // answer first: Claude Code is waiting on this
      if (size <= MAX_BODY) handleHook(event, body);
    });
    return;
  }
  if (req.method === "POST" && url === "/statusline") {
    // The status line's feed (step 7b): context fill and rate limits, logged when
    // they change. Answered at once; the script never waits on it anyway.
    let body = "";
    req.on("data", (c: Buffer) => {
      if (body.length < MAX_BODY) body += c;
    });
    req.on("end", () => {
      res.end();
      statusLine(body);
    });
    return;
  }
  if (req.method === "POST" && url === "/answer") {
    // The simulator's Allow / Deny: {"id": "<prompt id>", "decision": "allow" | "deny"},
    // or the Claude Code band's, which adds "from": "band" so the diary says where.
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      try {
        const m = JSON.parse(body) as { id?: string; decision?: string; from?: string };
        if (m.id && isDecision(m.decision)) answer(m.id, m.decision, m.from === "band" ? "the Claude Code band" : "the simulator");
      } catch {
        // ignore
      }
      res.end();
    });
    return;
  }
  if (req.method === "GET" && url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": toki bridge\n\n");
    // A simulator that joins late sees the prompts already waiting.
    for (const [id, h] of held)
      res.write(`data: ${JSON.stringify({ kind: "prompt", t: Date.now() - startedAt, id, tool: h.tool, hint: h.hint, always: h.always })}\n\n`);
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
    return;
  }
  if (req.method === "GET" && url === "/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        {
          startedAt: new Date(startedAt).toISOString(),
          robot: robot.status,
          held: [...held.keys()],
          // The held prompts in full, for the Claude Code band (mods/toki-band).
          prompts: [...held].map(([id, h]) => ({ id, session: h.session, project: sessions.get(h.session)?.project ?? "?", tool: h.tool, hint: h.hint, always: h.always ?? null })),
          colours: colours.colours(),
          listeners: listeners.size,
          sessions: [...sessions.values()],
        },
        null,
        2,
      ),
    );
    return;
  }
  res.statusCode = 404;
  res.end();
});

// ---------------------------------------------------------------------------
// The scrapbook (Phase 5, spec §9.3): private, on this Mac only, at
// http://localhost:4747. For now the diary's data:
//   GET /api/days        every day with moments, newest first, with its numbers
//   GET /api/day/<date>  one day's moments and numbers
// ---------------------------------------------------------------------------
const SCRAPBOOK_PORT = Number(process.env.SCRAPBOOK_PORT ?? 4747);
const SCRAPBOOK_DIST = join(HOME, "simulator", "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** Sends a change to Toki and answers with what Toki saved, so the page shows the truth. */
function changeSettings(req: IncomingMessage, json: (v: unknown, status?: number) => void) {
  if (!fromOurPage(req)) return json({ error: "Only Toki's own page can change settings." }, 403);
  let body = "";
  req.on("data", (c) => {
    if (body.length < 10_000) body += c;
  });
  req.on("end", async () => {
    let patch = null;
    try {
      patch = validPatch(JSON.parse(body));
    } catch {
      // not JSON
    }
    if (!patch) return json({ error: "Nothing to change." }, 400);
    if (robot.status.state !== "connected") return json({ error: "Toki isn't connected over Wi-Fi, so nothing was changed." }, 503);
    const reply = settings.next();
    robot.send({ settings: patch });
    const saved = await reply;
    if (!saved) return json({ error: "Toki didn't answer within 2 seconds, so the change may not have landed." }, 504);
    json({ online: true, settings: saved });
  });
}

const scrapbook = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const json = (v: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(v));
  };
  try {
    if (url === "/api/days") return json(listDays());
    // Settings (Phase 7): read them (the last copy, even with Toki away), or change them on Toki.
    if (url === "/api/settings" && req.method === "GET") return json({ online: robot.status.state === "connected", settings: settings.current });
    if (url === "/api/settings" && req.method === "POST") return void changeSettings(req, json);
    const m = /^\/api\/day\/(\d{4}-\d{2}-\d{2})$/.exec(url);
    if (m) {
      const day = loadDay(m[1]);
      return day ? json(day) : json({ error: "no such day" }, 404);
    }
    // The page itself: the simulator's scrapbook build (npm --prefix simulator run build).
    const file = url === "/" ? "scrapbook.html" : url.slice(1);
    const path = join(SCRAPBOOK_DIST, file);
    if (!path.startsWith(SCRAPBOOK_DIST) || file.includes("..") || !existsSync(path) || file === "index.html") {
      if (url === "/") return void res.end("Build the scrapbook first: npm --prefix simulator run build");
      return json({ error: "not found" }, 404);
    }
    res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
    createReadStream(path).pipe(res);
  } catch (e) {
    console.error("scrapbook:", e);
    json({ error: "failed" }, 500);
  }
});
scrapbook.on("error", (e) => console.error("scrapbook server:", e.message));
scrapbook.listen(SCRAPBOOK_PORT, "127.0.0.1", () => console.log(`Scrapbook on http://localhost:${SCRAPBOOK_PORT}`));

// Keep server-sent streams alive through proxies.
setInterval(() => {
  for (const res of listeners) res.write(": ping\n\n");
}, 15_000).unref();

// Another bridge already has the port (say, one started by hand while the login
// agent is installed): say so and leave. The agent retries every 30 s.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") console.error(`${new Date().toISOString()} port ${PORT} is in use: another bridge is running. Exiting.`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`${new Date().toISOString()} Toki bridge on http://127.0.0.1:${PORT} (hooks logged to ${LOG_DIR})`);
  robot.start();
});
