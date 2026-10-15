import type { ReactNode } from "react";
import type { WorkKind } from "../state/moments";

// Small shared pieces of the scrapbook's look (scrapbook.css): a chip is a word
// with a coloured dot, "● Code 23", in place of the old monospace capitals.

export const KIND_COLOUR: Record<WorkKind, string> = {
  code: "var(--tk-ink)", // navy: it sits on the teal band
  research: "#7376e6",
  images: "var(--tk-tomato)",
  documents: "var(--tk-mustard)",
  email: "#e86aa6",
  other: "var(--tk-muted)",
};

export const KIND_WORD: Record<WorkKind, string> = {
  code: "Code",
  research: "Research",
  images: "Images",
  documents: "Documents",
  email: "Email",
  other: "Other",
};

export function Chip({ dot, children, n, title }: { dot?: string; children: ReactNode; n?: number | string; title?: string }) {
  return (
    <span className="tk-chip" title={title}>
      {dot && <span className="dot" style={{ background: dot }} />}
      {children}
      {n !== undefined && <span className="n">{n}</span>}
    </span>
  );
}

/** What Toki was mostly doing, in words: "mostly running commands, then reading". */
const ACTIVITY_WORD: Record<string, string> = {
  run: "running commands",
  read: "reading",
  edit: "editing",
  search: "searching",
  web: "on the web",
  test: "testing",
  think: "thinking",
  subagent: "with subagents",
  other: "other tools",
};
export function mostly(byActivity: Record<string, number>): string {
  const top = Object.entries(byActivity)
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n > 0)
    .slice(0, 3)
    .map(([k]) => ACTIVITY_WORD[k] ?? k);
  if (!top.length) return "";
  return `Mostly ${top[0]}${top.length > 1 ? `, then ${top.slice(1).join(" and ")}` : ""}.`;
}

/** The day's (or month's) numbers as a scorecard: "52" over "● Asked". */
export function Stats({ items }: { items: { n: number | string; word: string; dot?: string }[] }) {
  return (
    <div className="tk-stats">
      {items.map((it) => (
        <div key={it.word} className="tk-stat">
          <div className="n">{typeof it.n === "number" ? it.n.toLocaleString("en-GB") : it.n}</div>
          <div className="w">
            {it.dot && <i style={{ background: it.dot }} />}
            {it.word}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The kinds of work and who did them, as words in the teal band: "● Code 31   ● Images 4   by Opus 5.5". */
export function WorkBand({ kinds, models }: { kinds: [WorkKind, number][]; models: [string, number][] }) {
  if (!kinds.length && !models.length) return null;
  return (
    <div
      className="tk-display flex flex-wrap items-center"
      style={{ gap: "6px 22px", marginTop: 14, padding: "9px 14px 7px", background: "var(--tk-teal)", borderRadius: 8, color: "var(--tk-paper)", fontSize: 17, fontWeight: 600 }}
    >
      {kinds.map(([k, n]) => (
        <span key={k} className="inline-flex items-center gap-2">
          <span style={{ width: 10, height: 10, borderRadius: 999, background: KIND_COLOUR[k], boxShadow: "0 0 0 2px var(--tk-paper)", marginTop: -2 }} />
          {KIND_WORD[k]} <b style={{ fontWeight: 800 }}>{n}</b>
        </span>
      ))}
      {models.map(([m, n]) => (
        <span key={m} style={{ opacity: 0.9 }}>
          by {m}
          {models.length > 1 ? ` ×${n}` : ""}
        </span>
      ))}
    </div>
  );
}
