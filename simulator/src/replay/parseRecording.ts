import type { Recording, StreamEvent, ToolCall } from "./events";

// Parses a recorder file (~/StackChanData/recordings/*.jsonl): one JSON object
// per line, {t: ISO time, dir: "rx" | "tx" | "dev" | "log", line: raw text}.
// Raw lines are dropped after parsing; only the normalised events are kept.

type RawRecord = { t: string; dir: "rx" | "tx" | "dev" | "log"; line: string };

const SUMMARY_MAX = 80;

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const pick =
    o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.query ?? o.url ?? o.description ?? o.prompt;
  const s = typeof pick === "string" ? pick : "";
  const firstLine = s.split("\n")[0];
  return firstLine.length > SUMMARY_MAX ? firstLine.slice(0, SUMMARY_MAX - 1) + "…" : firstLine;
}

function parseTurn(d: Record<string, unknown>, t: number): StreamEvent {
  const role = d.role === "user" ? "user" : "assistant";
  const tools: ToolCall[] = [];
  const blocks: string[] = [];
  let toolError = false;
  const results: string[] = [];
  if (Array.isArray(d.content)) {
    for (const b of d.content as Record<string, unknown>[]) {
      const type = typeof b.type === "string" ? b.type : "?";
      blocks.push(type);
      if (type === "tool_use")
        tools.push({ id: typeof b.id === "string" ? b.id : undefined, name: String(b.name ?? "?"), summary: summariseInput(b.input) });
      if (type === "tool_result") {
        if (b.is_error === true) toolError = true;
        if (typeof b.tool_use_id === "string") results.push(b.tool_use_id);
      }
    }
  } else {
    blocks.push("text");
  }
  return { kind: "turn", t, role, tools, blocks, toolError, results };
}

function parseRx(line: string, t: number): StreamEvent | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof d.evt === "string") return d.evt === "turn" ? parseTurn(d, t) : null;
  if (typeof d.total === "number") {
    const p = d.prompt as Record<string, unknown> | undefined;
    return {
      kind: "snapshot",
      t,
      total: d.total,
      running: Number(d.running ?? 0),
      waiting: Number(d.waiting ?? 0),
      msg: String(d.msg ?? ""),
      entries: Array.isArray(d.entries) ? d.entries.map(String) : [],
      tokens: Number(d.tokens ?? 0),
      tokensToday: Number(d.tokens_today ?? 0),
      prompt: p ? { id: String(p.id), tool: String(p.tool ?? ""), hint: String(p.hint ?? "") } : undefined,
    };
  }
  return null; // commands (status polls), time sync: not needed for replay
}

function parseTx(line: string, t: number): StreamEvent | null {
  if (!line.includes('"permission"')) return null;
  try {
    const d = JSON.parse(line);
    if (d.cmd === "permission") return { kind: "decision", t, id: String(d.id), decision: d.decision === "deny" ? "deny" : "once" };
  } catch {
    /* ignore */
  }
  return null;
}

function parseDev(line: string, t: number): StreamEvent | null {
  const m = /^repeat (\d+)$/.exec(line);
  if (m) return { kind: "repeat", t, count: Number(m[1]) };
  if (line.startsWith("servo")) return null; // servo test lines
  return { kind: "device", t, text: line };
}

export function parseRecording(name: string, text: string): Recording {
  const raws: RawRecord[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      raws.push(JSON.parse(l));
    } catch {
      /* skip a torn line, e.g. if the recorder was killed mid-write */
    }
  }
  if (!raws.length) return { name, startedAt: new Date(), durationMs: 0, events: [] };

  const t0 = Date.parse(raws[0].t);
  const events: StreamEvent[] = [];
  for (const r of raws) {
    const t = Date.parse(r.t) - t0;
    const e =
      r.dir === "rx" ? parseRx(r.line, t) : r.dir === "tx" ? parseTx(r.line, t) : r.dir === "dev" ? parseDev(r.line, t) : null;
    if (e) events.push(e);
  }
  const durationMs = events.length ? events[events.length - 1].t : 0;
  return { name, startedAt: new Date(t0), durationMs, events };
}
