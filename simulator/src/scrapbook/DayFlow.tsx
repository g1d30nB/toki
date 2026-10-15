import { useEffect, useMemo, useRef, useState } from "react";
import { WORK_KINDS, type DaySummary, type Moment, type WorkKind } from "../state/moments";
import { Stats, WorkBand, mostly } from "./Chip";
import { bandsOf, dayOfYear, hhmm, newestFirst, packBand, stickersFor } from "./layout";
import { faceWord, type Signature } from "./calendar";
import { DaySticker, metalWords } from "./DaySticker";
import { holoAt, type DayFinish } from "./finish";
import { PlacedSticker } from "./Sticker";

// One day, open (spec §9.1; rethought 4 Oct with Gideon). Newest first, like the
// list of days: the latest hour at the top, one band per hour. Each band is its own
// small sticker-bomb, latest first, and a busy hour is taller than a quiet one.
// Stretches of more than 30 minutes with nothing in them shrink to a one-line
// divider. The day's numbers sit at the top as chips; the stickers are the mess below.
// The look (15 Oct): a cream paper page, ruled like a notebook with a margin line,
// each hour on a little mustard tag (scrapbook.css).

const HOUR_COL = 84;

function Band({ stickers, width, seed, hour, holo, first }: { stickers: Moment[]; width: number; seed: string; hour: number; holo: Set<number>; first: boolean }) {
  const { placed, height } = useMemo(() => packBand(stickers, width - HOUR_COL, seed), [stickers, width, seed]);
  return (
    <div style={{ display: "flex", borderTop: first ? undefined : "2px dashed rgb(29 43 83 / 0.18)" }}>
      <div style={{ width: HOUR_COL, paddingTop: 12, flexShrink: 0 }}>
        <span className="tk-hour-tag">{String(hour).padStart(2, "0")}:00</span>
      </div>
      <div style={{ position: "relative", flex: 1, height }}>
        {placed.map((p, i) => (
          <PlacedSticker key={i} p={p} finish={holo.has(p.m.t) ? "holo" : undefined} />
        ))}
      </div>
    </div>
  );
}

export function DayFlow({ day, summary, moments, signature, finish }: { day: string; summary: DaySummary; moments: Moment[]; signature?: Signature; finish?: DayFinish }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stickers = useMemo(() => stickersFor(moments), [moments]);
  const bands = useMemo(() => newestFirst(bandsOf(stickers)), [stickers]);
  const holo = useMemo(() => holoAt(stickers, finish), [stickers, finish]);
  const date = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const from = summary.firstAt ? hhmm(summary.firstAt) : "";
  const to = summary.lastAt ? hhmm(summary.lastAt) : "";
  const span = from && to ? (from === to ? from : `${from} to ${to}`) : "";
  const kinds = WORK_KINDS.filter((k) => (summary.byKind?.[k] ?? 0) > 0).sort((a, b) => summary.byKind![b]! - summary.byKind![a]!);
  const models = Object.entries(summary.byModel ?? {}).sort((a, b) => b[1] - a[1]);
  const caption = [
    `Waited on you ${summary.waitedOnYouMin} min`,
    `sparkled ${summary.sparkles} time${summary.sparkles === 1 ? "" : "s"}`,
    summary.errors ? `${summary.errors} spiral-eye moment${summary.errors === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      ref={ref}
      className="tk-card"
      style={{
        padding: "26px 28px 20px",
      }}
    >
      <header style={{ marginBottom: 18, display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tk-display" style={{ fontSize: 15, fontWeight: 600, color: "var(--tk-muted)" }}>
            Day {dayOfYear(day)}
            {span && ` · ${span}`}
          </div>
          <h2 className="tk-display" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 2 }}>
            {date}
          </h2>
          {/* Day one, before any work: a welcome instead of a row of zeros. */}
          {summary.prompts === 0 && (
            <p className="tk-display" style={{ fontSize: 20, fontWeight: 600, marginTop: 14, maxWidth: 560, lineHeight: 1.35 }}>
              Your first stickers appear as Claude works: one for everything you ask, and more for the moments that matter. Come back this evening.
            </p>
          )}
          {summary.prompts > 0 && (
          <div style={{ marginTop: 16 }}>
            <Stats
              items={[
                { n: summary.prompts, word: "asked", dot: "var(--tk-tomato)" },
                { n: summary.toolCalls, word: "tool calls", dot: "var(--tk-teal)" },
                { n: summary.approvals, word: "approved", dot: "var(--tk-mustard)" },
                { n: `${summary.waitedOnYouMin} min`, word: "waited on you", dot: "#7376e6" },
                { n: summary.sparkles, word: "✦ sparkles" },
                ...(summary.sessions > 0 ? [{ n: summary.sessions, word: summary.sessions === 1 ? "session" : "sessions" }] : []),
              ]}
            />
          </div>
          )}
          {/* The day's work by kind, and who did it (Work Report reference, 15 Oct). */}
          <WorkBand kinds={kinds.map((k) => [k, summary.byKind![k]!] as [WorkKind, number])} models={models} />
          {mostly(summary.byActivity) && <p style={{ fontSize: 14, color: "var(--tk-muted)", marginTop: 10 }}>{mostly(summary.byActivity)}</p>}
        </div>
        {/* The day's summary sticker: its signature face, in metal on an outlier day. */}
        {signature && summary.prompts > 0 && (
          <div style={{ width: 132, flexShrink: 0, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <DaySticker sig={signature} finish={finish} w={finish?.metal ? 112 : 96} tilt={-6} />
            </div>
            <div style={{ marginTop: 8 }}>
              <span
                className="tk-chip"
                style={{
                  background: finish?.metal === "gold" ? "var(--tk-mustard)" : finish?.metal ? "#dfe4ec" : "var(--tk-paper)",
                  fontSize: 13,
                }}
              >
                {finish?.metal ? `${finish.metal === "gold" ? "Gold" : "Silver"} day` : `${faceWord(signature.face).charAt(0)}${faceWord(signature.face).slice(1).toLowerCase()} day`}
              </span>
            </div>
            {finish?.metal && <div style={{ fontSize: 12, color: "var(--tk-muted)", marginTop: 6, lineHeight: 1.3 }}>{metalWords(finish).replace(/^\w+: /, "")}</div>}
          </div>
        )}
      </header>
      {/* The ruled part of the page: only where the hours are (Gideon, 15 Oct: the
          header is plain paper). It reaches the card's edges, past its padding. */}
      <div
        style={{
          margin: "0 -28px -20px",
          padding: "8px 28px 20px",
          borderRadius: "0 0 15px 15px",
          background: `linear-gradient(90deg, transparent ${HOUR_COL + 26}px, rgb(228 87 46 / 0.35) ${HOUR_COL + 26}px, rgb(228 87 46 / 0.35) ${HOUR_COL + 28}px, transparent ${HOUR_COL + 28}px), repeating-linear-gradient(transparent 0 31px, rgb(115 118 230 / 0.16) 31px 32px)`,
        }}
      >
        {bands.map((b, i) =>
        b.kind === "hour" ? (
          <Band key={i} stickers={b.stickers} width={width - 56} seed={`${day}-${b.from}`} hour={b.hour} holo={holo} first={i === 0} />
        ) : (
          <div key={i} className="tk-display" style={{ fontSize: 15, fontWeight: 600, color: "var(--tk-muted)", textAlign: "center", padding: "10px 0", borderTop: "2px dashed rgb(29 43 83 / 0.18)" }}>
            A quiet stretch, {hhmm(b.from)} to {hhmm(b.to)}
          </div>
        ),
      )}
        {summary.prompts > 0 && (
          <footer className="tk-display" style={{ borderTop: "2px dashed rgb(29 43 83 / 0.18)", paddingTop: 14, textAlign: "center", fontSize: 19, fontWeight: 700 }}>
            {caption}
          </footer>
        )}
      </div>
    </section>
  );
}
