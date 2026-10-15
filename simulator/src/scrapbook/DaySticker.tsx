import { faceWord, type Signature } from "./calendar";
import type { DayFinish } from "./finish";
import { FINISH_FILTER, Foil } from "./Foil";
import { STICKER_SHADOW } from "./Sticker";
import { faceSticker } from "./stickers";

// The day's summary sticker (spec §9.5): its signature face, in silver or gold on
// an outlier day. Shared by the open day, the strips and the calendar.

const shadow = STICKER_SHADOW;

export function DaySticker({ sig, finish, w, tilt = 0 }: { sig: Signature; finish?: DayFinish; w: number | string; tilt?: number }) {
  const img = faceSticker(sig.face);
  const metal = finish?.metal;
  const style = { width: w, transform: `rotate(${tilt}deg)`, filter: shadow };
  return metal ? (
    <Foil finish={metal} mask={img.url} style={style} title={metalWords(finish!)}>
      <img src={img.url} alt={faceWord(sig.face)} style={{ width: "100%", display: "block", filter: FINISH_FILTER[metal] }} />
    </Foil>
  ) : (
    <img src={img.url} alt={faceWord(sig.face)} style={{ ...style, display: "block" }} />
  );
}

/** Intensity, never achievement (spec §9.5): it says how the day compares, not that it was good. */
export function metalWords(f: DayFinish): string {
  const b = f.busierThan;
  const vs = b ? `busier than ${b.n} of your last ${b.of} days` : "";
  return f.metal === "gold" ? `Gold: your busiest day in 30${b ? `, ${vs}` : ""}` : `Silver: ${vs}`;
}

/** A holo moment, in words for the strip and calendar marks. */
export function holoWords(f: DayFinish): string {
  const parts = [...f.firstShips.map((p) => `first ship for ${p}`), f.runAt !== undefined ? "a long run that didn't need you" : null].filter(Boolean);
  return `Holo: ${parts.join(", ")}`;
}
