import type { CSSProperties, HTMLAttributes } from "react";
import { useCard } from "./CardLayer";
import { FINISH_FILTER, Foil, type Finish } from "./Foil";
import { palette } from "../face/palette";
import type { Moment } from "../state/moments";
import { lookOf, type Placed } from "./layout";
import { EVENT_STICKERS, QUIET_CLOSE_ART, describe, faceSticker, symbolSticker } from "./stickers";

// One sticker, in real pixels (the page scrolls, so stickers keep a real size).
// The real lettered art where it exists; Toki's die-cut faces and symbols
// otherwise; lettering placeholders for events still waiting for their art.

/**
 * Stickers on paper have no shadow (Gideon, 15 Oct: a sticker is pressed flat onto
 * the page; it doesn't lift off it). The white die-cut edge separates it. The old
 * soft black blur suited the dark navy page.
 */
export const STICKER_SHADOW = "none";
const shadow = STICKER_SHADOW;

/**
 * Hover shows the sticker's card; click pins it (`pinnable`). In a collapsed day's
 * strip a click opens the day instead, so strips only hover. `still`: no card (the
 * copy inside the card itself).
 */
export function StickerArt({ m, w, style, still, pinnable = true, finish }: { m: Moment; w: number; style?: CSSProperties; still?: boolean; pinnable?: boolean; finish?: Finish }) {
  const card = useCard();
  const hover: HTMLAttributes<HTMLElement> =
    still || !card
      ? {}
      : {
          onMouseEnter: (e) => card.show(m, e.currentTarget),
          onMouseLeave: () => card.hide(),
          onClick: pinnable
            ? (e) => {
                e.stopPropagation();
                card.show(m, e.currentTarget, true);
              }
            : undefined,
          style: { cursor: pinnable ? "pointer" : undefined },
        };
  const ev = EVENT_STICKERS[m.kind];
  if (ev?.art) {
    const art = m.kind === "closed" && m.detail !== "earned" ? QUIET_CLOSE_ART : ev.art;
    // SUBAGENTS carries its count on a small badge: the art can't know it.
    const count = m.kind === "subagents" && (m.n ?? 1) > 1 ? m.n : null;
    if (finish)
      return (
        <Foil finish={finish} mask={art} {...hover} style={{ width: w, filter: shadow, ...hover.style, ...style }}>
          <img src={art} alt={ev.text(m)} style={{ width: "100%", display: "block", filter: FINISH_FILTER[finish] || undefined }} />
        </Foil>
      );
    return (
      <div {...hover} style={{ width: w, filter: shadow, ...hover.style, ...style }}>
        <img src={art} alt={ev.text(m)} style={{ width: "100%", display: "block" }} />
        {count && (
          <div
            style={{
              position: "absolute",
              right: -4,
              top: -4,
              background: palette.mustard,
              color: palette.ink,
              border: `3px solid ${palette.cream}`,
              boxShadow: `0 0 0 2px ${palette.ink}`,
              borderRadius: 999,
              padding: "1px 8px",
              font: `900 ${Math.max(13, w * 0.11)}px ui-rounded, system-ui, sans-serif`,
            }}
          >
            ×{count}
          </div>
        )}
      </div>
    );
  }
  if (ev) {
    const lettered = (
      <div
        {...(finish ? {} : hover)}
        style={{
          ...(finish ? {} : hover.style),
          background: ev.bg,
          color: ev.fg,
          border: `4px solid ${palette.cream}`,
          boxShadow: `0 0 0 2px ${palette.ink}`,
          borderRadius: 12,
          padding: "4px 12px",
          font: `900 ${Math.max(12, w / Math.max(4, ev.text(m).length) * 1.3)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
          filter: finish ? FINISH_FILTER[finish] || undefined : shadow,
          ...(finish ? {} : style),
        }}
      >
        {ev.text(m)}
      </div>
    );
    return finish ? (
      <Foil finish={finish} {...hover} style={{ borderRadius: 12, filter: shadow, ...hover.style, ...style }}>
        {lettered}
      </Foil>
    ) : (
      lettered
    );
  }
  const look = lookOf(m);
  const img = look.type === "symbol" ? symbolSticker(look.kind) : faceSticker(look.type === "face" ? look.face : m.face);
  if (finish)
    return (
      <Foil finish={finish} mask={img.url} {...hover} style={{ width: w, filter: shadow, ...hover.style, ...style }}>
        <img src={img.url} alt={describe(m)} style={{ width: "100%", display: "block", filter: FINISH_FILTER[finish] || undefined }} />
      </Foil>
    );
  return <img {...hover} src={img.url} alt={describe(m)} style={{ width: w, filter: shadow, ...hover.style, ...style }} />;
}

/** A sticker placed in a band: centred on its spot, tilted, later ones on top. */
export function PlacedSticker({ p, finish }: { p: Placed; finish?: Finish }) {
  return (
    <StickerArt
      m={p.m}
      w={p.w}
      finish={finish}
      style={{ position: "absolute", left: p.x, top: p.y, transform: `translate(-50%, -50%) rotate(${p.r}deg)`, zIndex: p.z }}
    />
  );
}
