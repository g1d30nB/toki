import { useMemo } from "react";
import type { DaySummary, Moment } from "../state/moments";
import { highlightsOf, hhmm, sizeOf, stickersFor, widthPx } from "./layout";
import type { Signature } from "./calendar";
import { DaySticker, metalWords } from "./DaySticker";
import { holoAt, type DayFinish } from "./finish";
import { StickerArt } from "./Sticker";

// A day, closed (rethought 4 Oct): one strip of its highlights (every event
// sticker, then its biggest moments), newest first. Seven of them fit on a
// screen, so the old week view lives on as the list itself. Click to open.


export function DayStrip({ day, summary, moments, onOpen, signature, finish }: { day: string; summary: DaySummary; moments: Moment[] | null; onOpen: () => void; signature?: Signature; finish?: DayFinish }) {
  const stickers = useMemo(() => (moments ? stickersFor(moments) : []), [moments]);
  const highlights = useMemo(() => highlightsOf(stickers), [stickers]);
  const holo = useMemo(() => holoAt(stickers, finish), [stickers, finish]);
  const date = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const span = summary.firstAt && summary.lastAt ? `${hhmm(summary.firstAt)} to ${hhmm(summary.lastAt)}` : "";
  return (
    <button onClick={onOpen} className="tk-card-sm group flex w-full items-center gap-5 px-5 text-left transition-transform hover:-translate-y-0.5" style={{ minHeight: 108 }}>
      <div style={{ width: 150, flexShrink: 0 }}>
        <div className="tk-display" style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.05 }}>
          {date}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--tk-muted)", marginTop: 3 }}>{span}</div>
        <div className="tk-display" style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
          {summary.prompts} asked · ✦ {summary.sparkles}
        </div>
      </div>
      {/* An outlier day leads with its summary sticker in metal. */}
      {signature && finish?.metal && (
        <div title={metalWords(finish)} style={{ flexShrink: 0 }}>
          <DaySticker sig={signature} finish={finish} w={64} tilt={-5} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-3">
        {highlights.map((m, i) => (
          // Small and level in a strip; the same art as the open day.
          <StickerArt key={i} m={m} pinnable={false} finish={holo.has(m.t) ? "holo" : undefined} w={Math.min(130, widthPx(m, sizeOf(m)) * 0.5)} style={{ flexShrink: 0, position: "relative" }} />
        ))}
        {!moments && <span className="tk-display" style={{ fontSize: 16, color: "var(--tk-muted)" }}>…</span>}
      </div>
      <span className="tk-pill opacity-0 transition-opacity group-hover:opacity-100" style={{ fontSize: 14, flexShrink: 0 }}>
        Open
      </span>
    </button>
  );
}
