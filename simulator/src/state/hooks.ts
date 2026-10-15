// Claude Code hooks → stream events (Phase 4, docs/bridge-hooks.md §3). The
// bridge feeds every hook payload through here, so the state layer sees the same
// events whether they came from Buddy over Bluetooth or from hooks.
//
// Plain TypeScript with type-only imports, so the bridge runs it directly with
// Node's type stripping (no build step).

import type { Question, StreamEvent, ToolCall } from "../replay/events";

/** The fields Toki reads from a hook payload. Everything else is ignored. */
export type HookPayload = {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string | null;
  agent_type?: string;
  /** What "Always allow" would add, as Claude Code's permission-update objects (bridge-hooks.md §2). */
  permission_suggestions?: unknown[];
};

const WHERE: Record<string, string> = {
  session: "this session",
  localSettings: "this project",
  projectSettings: "this project",
  userSettings: "everywhere",
};

/**
 * "Always allow", in words, for the robot's confirm screen: what the suggested
 * permission updates would actually do, short enough for one 20 px line beside
 * the "Always" button ("All edits, this session"). Unknown shapes are described
 * generically, never hidden: a permanent rule must say what it is.
 */
export function describeSuggestions(suggestions: unknown[] | undefined): string | undefined {
  if (!Array.isArray(suggestions) || !suggestions.length) return undefined;
  const parts = suggestions.map((raw) => {
    if (typeof raw === "string") return raw; // the docs' example shape: "Bash(npm *)"
    const s = (raw ?? {}) as Record<string, unknown>;
    const where = typeof s.destination === "string" ? WHERE[s.destination] : undefined;
    const tail = where ? `, ${where}` : "";
    if (s.type === "setMode" && s.mode === "acceptEdits") return `all edits${tail}`;
    if (s.type === "setMode" && typeof s.mode === "string") return `${s.mode} mode${tail}`;
    if (s.type === "addRules" && Array.isArray(s.rules)) {
      const rules = (s.rules as { toolName?: string; ruleContent?: string }[]).map((r) =>
        r.ruleContent ? `${r.toolName ?? "?"}(${r.ruleContent})` : (r.toolName ?? "?"),
      );
      return `${rules.join(" + ")}${tail}`;
    }
    if (s.type === "addDirectories" && Array.isArray(s.directories)) {
      return `folder ${(s.directories as string[]).map(shortPath).join(" + ")}${tail}`;
    }
    return `a change (${String(s.type ?? "unknown")})${tail}`;
  });
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * AskUserQuestion's input, as logged on 3 Oct: {questions: [{question, header,
 * options: [{label, description}], multiSelect}]}. Toki only needs the header
 * of the first question, as context; the question is answered in Claude.
 */
export function readQuestion(input: Record<string, unknown> | undefined): Question {
  const qs = input?.questions;
  const q = (Array.isArray(qs) ? qs[0] : undefined) as { header?: unknown } | undefined;
  return { header: typeof q?.header === "string" ? q.header : "" };
}

/** The last two segments of a path, like Buddy's hint: "StackChan Robot/notes.txt". */
export function shortPath(p: string): string {
  return p.split("/").filter(Boolean).slice(-2).join("/");
}

/** A short, human-readable summary of a tool's input: a command, a path, a query. */
export function summarise(tool: string, input: Record<string, unknown> | undefined): string {
  const str = (k: string) => (typeof input?.[k] === "string" ? (input[k] as string) : "");
  let s = "";
  if (tool === "Bash") s = str("command");
  else if (str("file_path")) s = shortPath(str("file_path"));
  else if (str("notebook_path")) s = shortPath(str("notebook_path"));
  else s = str("pattern") || str("url") || str("query") || str("description") || str("prompt");
  if (!s && input) s = (Object.values(input).find((v) => typeof v === "string") as string | undefined) ?? "";
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 120 ? s.slice(0, 119) + "…" : s;
}

/**
 * Stateful, because a permission prompt has to be cleared later: hooks say when
 * Claude asks, but not when you answer. The prompt clears when the same session
 * moves on (the tool runs or fails, is denied, the turn ends, or you type again).
 */
export class HookNormaliser {
  private pending = new Map<string, string>(); // session id → open prompt id
  private seq = 0;

  normalise(p: HookPayload, t: number): StreamEvent[] {
    const session = p.session_id ?? "?";
    const out: StreamEvent[] = [];
    const clear = () => {
      const id = this.pending.get(session);
      if (id === undefined) return;
      this.pending.delete(session);
      out.push({ kind: "prompt-cleared", t, id });
    };
    const tool = p.tool_name ?? "";
    const call = (): ToolCall => ({ id: p.tool_use_id ?? undefined, name: tool, summary: summarise(tool, p.tool_input) });

    switch (p.hook_event_name) {
      case "UserPromptSubmit":
        clear();
        out.push({ kind: "turn", t, role: "user", tools: [], blocks: ["text"], toolError: false });
        break;
      case "PreToolUse":
        out.push({ kind: "turn", t, role: "assistant", tools: [call()], blocks: ["tool_use"], toolError: false });
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        clear();
        out.push({
          kind: "turn",
          t,
          role: "user",
          tools: [],
          blocks: ["tool_result"],
          toolError: p.hook_event_name === "PostToolUseFailure",
          results: p.tool_use_id ? [p.tool_use_id] : undefined,
        });
        break;
      case "PermissionRequest": {
        clear();
        const id = `${session}#${++this.seq}`;
        this.pending.set(session, id);
        // A question arrives as a permission request for AskUserQuestion: it gets the
        // asked face, never Allow / Deny (and never Always allow).
        const question = tool === "AskUserQuestion" ? readQuestion(p.tool_input) : undefined;
        out.push({
          kind: "prompt",
          t,
          id,
          tool: tool || "?",
          hint: summarise(tool, p.tool_input),
          always: question ? undefined : describeSuggestions(p.permission_suggestions),
          question,
        });
        break;
      }
      case "PermissionDenied":
        clear();
        break;
      case "Stop":
      case "StopFailure":
        clear();
        out.push({ kind: "stop", t, error: p.hook_event_name === "StopFailure" });
        break;
      // Logged by the bridge, no face yet: Notification, SubagentStart / SubagentStop
      // (a phantom SubagentStop ends every desktop turn, see bridge-hooks.md §2),
      // PreCompact / PostCompact (the CONTEXT FULL sticker, later).
    }
    return out;
  }
}
