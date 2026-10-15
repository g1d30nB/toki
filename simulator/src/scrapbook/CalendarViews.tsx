import { useMemo } from "react";
import { mix, palette } from "../face/palette";
import { WORK_KINDS, dayOf, type DaySummary, type WorkKind } from "../state/moments";
import { daysInMonth, density, faceWord, monthGrid, monthsOf, signatureFaces, totals, type Signature } from "./calendar";
import { Stats, WorkBand } from "./Chip";
import { DaySticker, holoWords, metalWords } from "./DaySticker";
import type { DayFinish } from "./finish";

// The month and year views (spec §9.2, built 15 Oct). Month: a calendar per month,
// newest first, each day its signature face on a shade of how busy it was. Year: a
// quilt, one row per month, one patch per day, which becomes the zine cover. Click
// any day to open it in the diary. Logic in calendar.ts.

const display = { fontFamily: "var(--tk-display)", fontWeight: 600 } as const;



/** Busier days glow warmer: navy, through teal, towards mustard at the very busiest. */
const shade = (k: number) => (k <= 0 ? "var(--tk-paper)" : k < 0.6 ? mix("#f4e6c2", palette.mustard, k / 0.6) : mix(palette.mustard, palette.tomato, ((k - 0.6) / 0.4) * 0.8));

const long = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function hint(s: DaySummary, sig?: Signature, f?: DayFinish) {
  const usual = sig && sig.lift >= 1.2 ? ` · ${faceWord(sig.face).toLowerCase()}: ${sig.lift.toFixed(1)}× your usual` : "";
  const shine = [f?.metal ? metalWords(f) : null, f && isHolo(f) ? holoWords(f) : null].filter(Boolean).map((x) => `\n${x}`).join("");
  return `${long(s.day)} · ${s.prompts} prompts · ${s.toolCalls} tool calls${usual}${shine}`;
}

const isHolo = (f?: DayFinish) => !!f && (f.firstShips.length > 0 || f.runAt !== undefined);
const METAL_RING = { silver: "#d7dde6", gold: "#f2c14e" } as const;

/** A small holo star in a day's corner: that day holds a rare moment. */
function HoloMark({ size }: { size: number }) {
  return (
    <span
      aria-label="holo moment"
      style={{
        position: "absolute",
        width: size,
        height: size,
        right: -size * 0.3,
        top: -size * 0.3,
        clipPath: "polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)",
        background: "conic-gradient(from 30deg, #ff5d5d, #ffcf3d, #5dff8f, #4fd1ff, #a46bff, #ff5dc8, #ff5d5d)",
        zIndex: 2,
      }}
    />
  );
}

function Labels({ days }: { days: DaySummary[] }) {
  const t = totals(days);
  const kinds = WORK_KINDS.filter((k) => t.byKind[k]).sort((a, b) => t.byKind[b]! - t.byKind[a]!);
  const models = Object.entries(t.byModel).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ marginTop: 16 }}>
      <Stats
        items={[
          { n: t.days, word: t.days === 1 ? "day" : "days" },
          { n: t.prompts, word: "asked", dot: "var(--tk-tomato)" },
          { n: t.toolCalls, word: "tool calls", dot: "var(--tk-teal)" },
          { n: t.approvals, word: "approved", dot: "var(--tk-mustard)" },
          { n: t.sparkles, word: "✦ sparkles" },
        ]}
      />
      <WorkBand kinds={kinds.map((k) => [k, t.byKind[k]!] as [WorkKind, number])} models={models} />
    </div>
  );
}

function useCalendar(days: DaySummary[]) {
  // (finishes come from the scrapbook, which also hands them to the diary)
  return useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d]));
    const most = Math.max(1, ...days.map((d) => d.moments));
    return { byDay, most, sig: signatureFaces(days) };
  }, [days]);
}

// --- Month ---

function MonthCell({ day, s, sig, f, k, today, onOpen }: { day: string; s?: DaySummary; sig?: Signature; f?: DayFinish; k: number; today: boolean; onOpen: (d: string) => void }) {
  const date = Number(day.slice(8));
  const ring = [f?.metal ? `inset 0 0 0 3px ${METAL_RING[f.metal]}` : null, today ? "0 0 0 3px var(--tk-tomato)" : null, "3px 3px 0 var(--tk-ink)"].filter(Boolean).join(", ");
  if (!s)
    return (
      <div style={{ aspectRatio: "1 / 0.92", borderRadius: 12, border: "2px dashed rgb(29 43 83 / 0.25)", boxShadow: today ? "0 0 0 3px var(--tk-tomato)" : undefined, padding: 8 }}>
        <span style={{ ...display, fontSize: 12, color: "var(--tk-muted)" }}>{date}</span>
      </div>
    );
  return (
    <button
      onClick={() => onOpen(day)}
      title={hint(s, sig, f)}
      className="group relative flex flex-col items-center justify-center transition-transform hover:-translate-y-0.5"
      style={{ aspectRatio: "1 / 0.92", borderRadius: 12, background: shade(k), border: "2px solid var(--tk-ink)", boxShadow: ring, padding: "8px 6px 6px" }}
    >
      <span style={{ ...display, position: "absolute", top: 5, left: 9, fontSize: 16, fontWeight: 800, color: "var(--tk-ink)" }}>{date}</span>
      <span style={{ ...display, position: "absolute", top: 7, right: 9, fontSize: 12, color: "var(--tk-ink)", opacity: 0.65 }}>{s.prompts}</span>
      {isHolo(f) && <HoloMark size={18} />}
      {sig && (
        <div style={{ width: "62%", marginTop: 10, display: "flex", justifyContent: "center" }}>
          <DaySticker sig={sig} finish={f} w="100%" tilt={((date * 37) % 9) - 4} />
        </div>
      )}
      {sig && (
        <span style={{ ...display, fontSize: 12, color: "var(--tk-ink)", marginTop: 3, whiteSpace: "nowrap" }}>
          {f?.metal && (
            <span style={{ background: palette.ink, color: METAL_RING[f.metal], fontWeight: 700, borderRadius: 4, padding: "1px 4px", marginRight: 4 }}>{f.metal === "gold" ? "Gold" : "Silver"}</span>
          )}
          {faceWord(sig.face).charAt(0) + faceWord(sig.face).slice(1).toLowerCase()}
        </span>
      )}
    </button>
  );
}

export function MonthView({ days, finishes, onOpen }: { days: DaySummary[]; finishes: Record<string, DayFinish>; onOpen: (day: string) => void }) {
  const { byDay, most, sig } = useCalendar(days);
  const today = dayOf(Date.now(), 2);
  return (
    <div className="space-y-3">
      {monthsOf(days, today).map((month) => {
        const inMonth = days.filter((d) => d.day.startsWith(month));
        const name = new Date(`${month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        return (
          <section key={month} className="tk-card" style={{ padding: "24px 26px 22px" }}>
            <header style={{ marginBottom: 16 }}>
              <h2 style={{ ...display, fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{name}</h2>
              {inMonth.length > 0 && <Labels days={inMonth} />}
            </header>
            <div className="grid grid-cols-7 gap-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
                <div key={w} style={{ ...display, fontSize: 10, color: "var(--tk-muted)", paddingLeft: 2 }}>
                  {w}
                </div>
              ))}
              {monthGrid(month).map((day, i) =>
                day ? (
                  <MonthCell key={day} day={day} s={byDay.get(day)} sig={sig[day]} f={finishes[day]} k={density(byDay.get(day)?.moments ?? 0, most)} today={day === today} onOpen={onOpen} />
                ) : (
                  <div key={`blank-${i}`} />
                ),
              )}
            </div>
          </section>
        );
      })}
      <Legend />
    </div>
  );
}

// --- Year ---

export function YearView({ days, finishes, onOpen }: { days: DaySummary[]; finishes: Record<string, DayFinish>; onOpen: (day: string) => void }) {
  const { byDay, most, sig } = useCalendar(days);
  const today = dayOf(Date.now(), 2);
  const years = [...new Set(monthsOf(days, today).map((m) => m.slice(0, 4)))];
  return (
    <div className="space-y-3">
      {years.map((year) => {
        // All twelve months, January at the top: the year reads as a quilt still being
        // filled in, with the days still to come faded.
        const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
        const inYear = days.filter((d) => d.day.startsWith(year));
        return (
          <section key={year} className="tk-card" style={{ padding: "24px 26px 22px" }}>
            <header style={{ marginBottom: 18 }}>
              <h2 style={{ ...display, fontSize: 48, fontWeight: 800, lineHeight: 1 }}>{year}</h2>
              <Labels days={inYear} />
            </header>
            <div style={{ display: "grid", gridTemplateColumns: "44px repeat(31, minmax(0, 1fr))", gap: 3 }}>
              <div />
              {Array.from({ length: 31 }, (_, i) => (
                <div key={i} style={{ ...display, fontSize: 9, color: "var(--tk-muted)", textAlign: "center" }}>
                  {(i + 1) % 5 === 0 || i === 0 ? i + 1 : ""}
                </div>
              ))}
              {months.map((month) => (
                <QuiltRow key={month} month={month} byDay={byDay} sig={sig} finishes={finishes} most={most} today={today} onOpen={onOpen} />
              ))}
            </div>
          </section>
        );
      })}
      <Legend />
    </div>
  );
}

function QuiltRow({ month, byDay, sig, finishes, most, today, onOpen }: { month: string; byDay: Map<string, DaySummary>; sig: Record<string, Signature>; finishes: Record<string, DayFinish>; most: number; today: string; onOpen: (d: string) => void }) {
  const label = new Date(`${month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" }).slice(0, 3).toUpperCase(); // en-GB says "Sept"
  const n = daysInMonth(month);
  return (
    <>
      <div style={{ ...display, fontSize: 11, fontWeight: 600, color: "var(--tk-muted)", alignSelf: "center" }}>{label}</div>
      {Array.from({ length: 31 }, (_, i) => {
        if (i >= n) return <div key={i} />;
        const day = `${month}-${String(i + 1).padStart(2, "0")}`;
        const s = byDay.get(day);
        const ring = day === today ? "0 0 0 2px var(--tk-tomato)" : undefined;
        if (!s) return <div key={i} style={{ aspectRatio: "1", borderRadius: 5, border: "1.5px dashed rgb(29 43 83 / 0.22)", boxShadow: ring, opacity: day > today ? 0.45 : 1 }} />;
        const g = sig[day];
        const f = finishes[day];
        const rings = [ring, f?.metal ? `inset 0 0 0 2px ${METAL_RING[f.metal]}` : null].filter(Boolean).join(", ") || undefined;
        return (
          <button
            key={i}
            onClick={() => onOpen(day)}
            title={hint(s, g, f)}
            className="flex items-center justify-center transition-transform hover:z-10 hover:scale-125"
            style={{ aspectRatio: "1", borderRadius: 6, background: shade(density(s.moments, most)), border: "1.5px solid var(--tk-ink)", boxShadow: rings, position: "relative" }}
          >
            {isHolo(f) && <HoloMark size={11} />}
            {g && (
              <div style={{ width: "92%" }}>
                <DaySticker sig={g} finish={f} w="100%" />
              </div>
            )}
          </button>
        );
      })}
    </>
  );
}

function Legend() {
  return (
    <div className="tk-card-sm flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ fontSize: 13 }}>
      <span className="tk-display" style={{ fontWeight: 700 }}>Quiet</span>
      <span className="flex gap-1">
        {[0.15, 0.4, 0.65, 0.85, 1].map((k) => (
          <span key={k} style={{ width: 16, height: 16, borderRadius: 4, background: shade(k), border: "1.5px solid var(--tk-ink)" }} />
        ))}
      </span>
      <span className="tk-display" style={{ fontWeight: 700 }}>Busy</span>
      <span style={{ color: "var(--tk-muted)" }}>
        Each face is the day's signature: what it had more of than usual. Silver and gold: your busiest days of the last 30. A holo star: a rare moment that day.
      </span>
    </div>
  );
}
