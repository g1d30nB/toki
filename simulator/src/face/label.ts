import type { AgentState } from "../state/agentState";
import type { ToolCall } from "../replay/events";
import type { ExpressionId } from "./expressions";

// The label under Toki's face (Gideon, 15 Oct: "labels at the bottom of the screen
// where we can fit one in"). The face still carries the state at the edge of
// vision; the label is for when you look straight at Toki. A data label (spec
// §7.1): monospace, the verb in capitals. Only on faces with a free lower edge:
// never over the approval or question chrome, the shutter, quiet mode or setup.
//
// Two variants for review: "words" names the face; "detail" adds what Claude is
// working on (a file, a command, a site), which the face can't say.

export type LabelMode = "off" | "words" | "detail";

const VERB: Partial<Record<ExpressionId, string>> = {
  think: "THINKING",
  read: "READING",
  search: "SEARCHING",
  edit: "EDITING",
  run: "RUNNING",
  test: "TESTING",
  web: "ON THE WEB",
  working: "WORKING",
  done: "DONE",
  error: "FAILED",
  approved: "ALLOWED",
  denied: "DENIED",
};

/** Faces whose label can carry the tool's object. */
const WITH_OBJECT: ExpressionId[] = ["read", "search", "edit", "run", "test", "web", "working", "error"];

export type FaceLabel = { verb: string; object?: string };

export function faceLabel(id: ExpressionId, s: AgentState, mode: LabelMode, preview?: { object?: string; subagents?: number }): FaceLabel | null {
  if (mode === "off") return null;
  const subagents = preview?.subagents ?? s.subagents.length;
  const verb = id === "subagent" || (subagents > 0 && WITH_OBJECT.includes(id) && id !== "error") ? `${subagents || 1} SUBAGENT${subagents === 1 ? "" : "S"}` : VERB[id];
  if (!verb) return null;
  if (mode === "words" || !WITH_OBJECT.includes(id) || verb.includes("SUBAGENT")) return { verb };
  // The face follows the state layer's hysteresis; the latest tool may already be the
  // next kind of work. Name its object only when it belongs to the face shown.
  const a = s.activity;
  const matches = !!a && (a.kind === id || (id === "working" && a.kind === "other") || id === "error");
  const object = preview?.object ?? (a?.tool && matches ? labelObject(a.tool) : "");
  // "ON THE WEB · " leaves too little room for a site's name: with an object it's just WEB.
  return object ? { verb: id === "web" ? "WEB" : verb, object } : { verb };
}

/**
 * What a tool is working on, as few characters as possible: a file's name, a
 * command's first step, a site's host, a search in quotes.
 */
export function labelObject(tool: ToolCall): string {
  let t = tool.summary.trim();
  if (!t) return "";
  if (tool.name === "Bash") {
    // Skip `cd somewhere &&`; keep the first command of a chain, without redirections.
    const steps = t.split(/\s*(?:&&|\|\||;|\|)\s*/).filter((x) => x && !/^cd\s/.test(x));
    t = (steps[0] ?? t).replace(/\s+\d?>&?\d?\S*/g, "").trim();
    return t;
  }
  const url = /^https?:\/\/([^/\s]+)/.exec(t);
  if (url) return url[1].replace(/^www\./, "");
  if (/^[^\s]+\/[^\s]+$/.test(t) && !t.includes("*")) return t.split("/").pop() ?? t; // a path: its file
  if (tool.name === "Grep" || tool.name === "Glob" || tool.name === "WebSearch") return `"${t}"`;
  return t;
}
