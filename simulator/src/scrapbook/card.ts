// A sticker's card (Gideon, 4 Oct): hover or tap a sticker to see exactly what made
// it. Plain words first, then the facts in the data-label style, then the quotes.
// Private: prompts and commands are as private as the transcript. The scrapbook
// never leaves the Mac (spec §9.3).

import { modelName, type Moment } from "../state/moments";
import { hhmm } from "./layout";

export type Card = {
  headline: string;
  /** Short facts, set in the data-label style. */
  facts: string[];
  /** Commands, paths and errors: set in monospace. */
  code?: string;
  /** What you asked (or what Claude asked you). */
  quote?: string;
  /** Claude's last words on the turn. */
  reply?: string;
  /** When and where. */
  foot: string;
};

const MODE: Record<string, string> = {
  default: "Manual",
  acceptEdits: "Accept edits",
  plan: "Plan",
  auto: "Auto",
  bypassPermissions: "Bypass permissions",
  dontAsk: "Don't ask",
};
const KIND: Record<string, string> = {
  code: "code work",
  research: "research",
  images: "image work",
  documents: "document work",
  email: "email",
  other: "other work",
};
const modeName = (m?: string) => (m ? (MODE[m] ?? m) : "Manual");

export function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
/** Markdown marks read as noise in a card: bold, code ticks, headings, link brackets. */
const plain = (s?: string) => s?.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
/** MCP tools arrive as mcp__Server_Name__tool_name: shown as "Server Name: tool name". */
export const toolName = (t?: string) => {
  const m = t && /^mcp__(.+?)__(.+)$/.exec(t);
  return m ? `${m[1].replace(/_/g, " ")}: ${m[2].replace(/_/g, " ")}` : t;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function cardFor(m: Moment): Card {
  const c = { ...m.ctx, tool: toolName(m.ctx?.tool) };
  const action = c.tool ? `${c.tool}${c.target ? ` · ${c.target}` : ""}` : c.target;
  const who = c.who ? ` on ${c.who}` : "";
  const after = m.n ? ` after ${plural(m.n, "min", "min")}` : "";
  const foot = [hhmm(m.t), m.project, c.title].filter(Boolean).join(" · ");
  const card = (headline: string, more: Partial<Card> = {}): Card => ({ headline, facts: [], foot, ...more });

  switch (m.kind) {
    case "met":
      return card("You met Toki", { facts: ["Toki was set up on this Mac, and said hello", "Day one of the scrapbook"] });
    case "hello":
      return card("First session of the day", { facts: ["Toki said hello"] });
    case "shipped":
      return card("Shipped!", { facts: ["Work left the Mac: a push or a merge"], code: c.target });
    case "asked": {
      const n = m.n ?? 0;
      const mix = Object.entries(c.work ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ");
      // What sort of work, and who did it (from the Work Report reference, 15 Oct).
      const what = [n && c.kind ? KIND[c.kind] : null, c.model ? `by ${modelName(c.model)}` : null].filter(Boolean).join(", ");
      const facts = [what ? what[0].toUpperCase() + what.slice(1) : null, n ? plural(n, "tool call") : "No tools: Claude just answered", mix, c.ms ? `Took ${duration(c.ms)}` : null].filter((x): x is string => !!x);
      return card(m.detail === "done" && n <= 2 ? "A quick one, done" : n >= 8 ? "A long turn" : "You asked Claude", {
        facts,
        quote: plain(c.prompt),
        reply: plain(c.reply),
      });
    }
    case "blocked":
      return card("Claude needed your permission", { facts: ["Not answered here: the session moved on"], code: action });
    case "approved":
      return card(`Approved${after}${who}`, { code: action });
    case "denied":
      return card(`Denied${who}`, { code: action, facts: ["Claude didn't run it"] });
    case "always":
      return card(`Always allowed${who}`, { facts: c.rule ? [`Rule: ${c.rule}`] : ["Claude Code wrote a rule, so it won't ask again"], code: action });
    case "question":
      return card("Claude asked you a question", { quote: c.prompt, facts: ["Answered in Claude"] });
    case "your-turn":
      return card(`Waited ${plural(m.n ?? 0, "min", "min")} for you`, { facts: ["Claude was blocked on your answer"], code: action });
    case "error":
      return card(c.tool ? `${c.tool} failed` : "Something failed", { code: [c.target, c.error].filter(Boolean).join("\n") || undefined });
    case "done":
      return card("Finished", { reply: plain(c.reply) });
    case "subagents":
      return card(`${plural(m.n ?? 1, "subagent")} at once`, { facts: c.agents ?? [] });
    case "context-full":
      return card("Context full: compacted", {
        facts: [c.trigger === "manual" ? "You ran /compact" : "Claude Code compacted it to keep going"],
      });
    case "yolo":
    case "plan": {
      const facts = [
        c.from === "start" ? `${modeName(m.kind === "plan" ? "plan" : m.detail)}, from the start of the session` : `${modeName(m.kind === "plan" ? "plan" : m.detail)}, was ${modeName(c.from)}`,
        c.ran ? `${plural(c.ran, "tool call")} ${m.kind === "yolo" ? "ran without asking" : "while planning"}` : null,
        c.endedAt ? `On for ${duration(c.endedAt - m.t)}` : null,
      ].filter((x): x is string => !!x);
      return card(m.kind === "yolo" ? "YOLO mode on" : "Plan mode on", { facts });
    }
    case "quiet":
      return card("Quiet mode", { facts: ["You double-tapped Toki: everything but approvals hidden"] });
    case "closed":
      return card(m.detail === "earned" ? "You closed the day" : "You closed the day early", {
        facts: [m.detail === "earned" ? "After a day's work: star eyes, then the shutter" : "Before any work finished: a yawn, then the shutter"],
      });
    case "boop":
      return card(m.n && m.n > 1 ? `Boop ×${m.n}` : "Boop", { facts: ["You tapped Toki's face"] });
    case "work":
      return card(`Working: ${m.detail ?? "?"}`);
  }
}
