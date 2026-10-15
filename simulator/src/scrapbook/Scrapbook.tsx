import { useEffect, useMemo, useRef, useState } from "react";
import type { DaySummary, Moment } from "../state/moments";
import { signatureFaces } from "./calendar";
import { MonthView, YearView } from "./CalendarViews";
import { finishesFor } from "./finish";
import { faceSticker } from "./stickers";
import { DayFlow } from "./DayFlow";
import { DayStrip } from "./DayStrip";
import { Guide } from "./Guide";
import { weekNumber } from "./layout";

// Toki's scrapbook (Phase 5, spec §9): one scrolling diary (rethought 4 Oct with
// Gideon). Newest day first; one day open at a time, running down the page from
// morning to evening; the others collapsed to strips of their highlights. Only the
// last 7 days load, with older ones on request, so the page never gets silly long.
// A sticky rail lists the days with their density, for jumping. Private: served by
// the bridge on this Mac only.

type Day = { summary: DaySummary; moments: Moment[] };
type View = "days" | "month" | "year";
const VIEW_KEY = "toki.scrapbook.view";
/** The zoom is remembered per viewer; a private window or blocked storage just starts on days. */
function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "month" || v === "year" ? v : "days";
  } catch {
    return "days";
  }
}
const PAGE = 7;
/** ?preview-finishes: no warm-up, so silver, gold and holo can be reviewed before 14 days of history. */
const PREVIEW_FINISHES = (() => {
  try {
    return new URLSearchParams(location.search).has("preview-finishes");
  } catch {
    return false;
  }
})();
const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function Scrapbook() {
  const [days, setDays] = useState<DaySummary[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, Day>>({});
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(savedView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered; fine */
    }
  };
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetch("/api/days")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((list: DaySummary[]) => {
        setDays(list);
        setOpen((d) => d ?? list[0]?.day ?? null);
      })
      .catch(() => setError("The bridge isn't answering on localhost:4747."));
  }, []);

  // Load each visible day once (the bridge caches them).
  const visible = (days ?? []).slice(0, shown);
  const visibleKey = visible.map((d) => d.day).join();
  useEffect(() => {
    for (const d of visible) {
      if (data[d.day]) continue;
      fetch(`/api/day/${d.day}`)
        .then((r) => r.json())
        .then((p: Day) => setData((all) => ({ ...all, [d.day]: p })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const jump = (day: string) => {
    const i = (days ?? []).findIndex((d) => d.day === day);
    if (i >= shown) setShown(i + 1);
    setOpen(day);
    const fromCalendar = view !== "days";
    setView("days");
    // From the month or year, the diary has to render first: wait a frame longer.
    const go = () => refs.current[day]?.scrollIntoView({ behavior: fromCalendar ? "auto" : "smooth", block: "start" });
    requestAnimationFrame(() => (fromCalendar ? setTimeout(go, 60) : go()));
  };
  const most = Math.max(1, ...(days ?? []).map((d) => d.moments));
  // The day's signature face and its finish, from the whole diary (both look back 30 days only).
  const sig = useMemo(() => signatureFaces(days ?? []), [days]);
  const finishes = useMemo(() => finishesFor(days ?? [], PREVIEW_FINISHES ? { warmup: 0 } : {}), [days]);

  const prompts = (days ?? []).reduce((a, d) => a + d.prompts, 0);

  return (
    <div className="mx-auto max-w-[1500px] px-6 pb-10">
      {/* The title, straight on the mat. */}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6">
        <div>
          <div className="tk-chip" style={{ marginBottom: 12, background: "var(--tk-paper)", border: "1.5px solid var(--tk-ink)" }}>
            <span className="dot" style={{ background: "var(--tk-tomato)" }} />
            Private: never leaves this Mac
          </div>
          <h1 className="tk-title" style={{ fontSize: 80 }}>
            Toki's scrapbook
          </h1>
          {days && (
            // On a tomato label stuck to the mat (plain text over the grid was hard to
            // read; tomato, so the cream title doesn't make the top all cream).
            <p
              className="tk-display"
              style={{
                display: "inline-block",
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1.35,
                marginTop: 14,
                maxWidth: 640,
                padding: "8px 14px 6px",
                background: "var(--tk-tomato)",
                color: "var(--tk-paper)",
                border: "2px solid var(--tk-ink)",
                borderRadius: 10,
                transform: "rotate(-0.6deg)",
              }}
            >
              {intro(days.length, prompts)}
            </p>
          )}
        </div>
        {/* The zooms (spec §9.2): the diary of days, a calendar per month, the year's quilt. */}
        <div className="tk-seg" style={{ width: 300 }} role="group" aria-label="Zoom">
          {(["days", "month", "year"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "days" ? "Days" : v === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        <main className="min-w-0 flex-1 space-y-4">
          {error && <p className="tk-card-sm px-4 py-3">{error}</p>}
          {!days && !error && <p className="tk-display" style={{ fontSize: 20, fontWeight: 700 }}>Opening the scrapbook…</p>}
          {/* Nothing yet (Claude Code not connected, or set up a moment ago): say what will happen. */}
          {days && days.length === 0 && (
            <section className="tk-card flex items-center gap-6" style={{ padding: "28px 30px" }}>
              <img src={faceSticker("idle").url} alt="" style={{ width: 120, transform: "rotate(-5deg)", flexShrink: 0 }} />
              <div>
                <h2 className="tk-display" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.05 }}>
                  Nothing here yet
                </h2>
                <p style={{ fontSize: 16, marginTop: 8, lineHeight: 1.45, maxWidth: 560 }}>
                  The scrapbook fills itself as Claude works: a sticker for everything you ask, and more for the moments that matter. Ask Claude Code to do something, then come back.
                </p>
                <p style={{ fontSize: 13.5, marginTop: 8, color: "var(--tk-muted)" }}>
                  Still empty after a while? Run <code>toki status</code> in Terminal: it checks that Claude Code is connected to Toki.
                </p>
              </div>
            </section>
          )}
          {days && view === "month" && <MonthView days={days} finishes={finishes} onOpen={jump} />}
          {days && view === "year" && <YearView days={days} finishes={finishes} onOpen={jump} />}
          {view === "days" &&
            visible.map((d) => (
              <div
                key={d.day}
                ref={(el) => {
                  refs.current[d.day] = el;
                }}
                style={{ scrollMarginTop: 16 }}
              >
                {open === d.day && data[d.day] ? (
                  <DayFlow day={d.day} summary={data[d.day].summary} moments={data[d.day].moments} signature={sig[d.day]} finish={finishes[d.day]} />
                ) : (
                  <DayStrip day={d.day} summary={d} moments={data[d.day]?.moments ?? null} onOpen={() => jump(d.day)} signature={sig[d.day]} finish={finishes[d.day]} />
                )}
              </div>
            ))}
          {view === "days" && days && shown < days.length && (
            <div className="flex justify-center pt-2">
              <button onClick={() => setShown((n) => n + PAGE)} className="tk-pill quiet" style={{ fontSize: 16 }}>
                Older days ↓
              </button>
            </div>
          )}
          {days && days.length > 0 && (
            <p style={{ fontSize: 13, color: "var(--tk-on-mat)", paddingTop: 6 }}>
              {view === "days" ? "Hover a sticker to see what made it; click to pin it. Click a day to open it." : "Click a day to open it in the diary."}
            </p>
          )}
        </main>

        {/* The rail: recent days with how busy they were, by week, for jumping; then the guide. */}
        {/* Scrolls on its own once the guide is open, so it never runs off the screen. */}
        <nav className="sticky top-6 hidden max-h-[calc(100vh-48px)] w-64 shrink-0 space-y-4 overflow-y-auto pr-2 pb-2 md:block self-start">
          {days && days.length > 0 && (
          <div className="tk-card-sm px-3 py-3">
            {(days ?? []).slice(0, Math.max(shown, PAGE * 2)).map((d, i, all) => {
              const week = weekNumber(d.day);
              const newWeek = i === 0 || weekNumber(all[i - 1].day) !== week;
              const on = open === d.day && view === "days";
              return (
                <div key={d.day}>
                  {newWeek && (
                    <div className="tk-display" style={{ fontSize: 13, fontWeight: 700, color: "var(--tk-muted)", margin: `${i ? 12 : 0}px 6px 4px` }}>
                      Week {week}
                    </div>
                  )}
                  <button
                    onClick={() => jump(d.day)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left"
                    style={{ background: on ? "var(--tk-cream)" : undefined }}
                  >
                    <span className="tk-display" style={{ fontSize: 15, width: 92, fontWeight: on ? 800 : 600, paddingTop: 2 }}>
                      {short(d.day)}
                    </span>
                    <span className="h-2.5 flex-1 rounded-full" style={{ background: "#eadfc6", border: "1.5px solid var(--tk-ink)" }}>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(8, (d.moments / most) * 100)}%`, background: on ? "var(--tk-tomato)" : "var(--tk-mustard)" }}
                      />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          )}
          <Guide />
        </nav>
      </div>
    </div>
  );
}

/** The line under the title, in words that also work on day one. */
function intro(days: number, asked: number): string {
  const tail = "Every sticker is something that really happened.";
  if (days === 0) return `Your days with Claude gather here, newest first. ${tail}`;
  if (days === 1) return `Your first day with Claude. ${tail}`;
  const a = asked === 0 ? "" : ` and ${asked.toLocaleString("en-GB")} thing${asked === 1 ? "" : "s"} you asked`;
  return `${days} days with Claude so far${a}, newest first. ${tail}`;
}
