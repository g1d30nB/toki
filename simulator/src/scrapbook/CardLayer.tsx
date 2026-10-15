import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Moment } from "../state/moments";
import { cardFor } from "./card";
import { StickerArt } from "./Sticker";

// One card for the whole page (Gideon, 4 Oct): hover a sticker to see what made it;
// click or tap to pin it there (a click elsewhere or Esc lets go). The card sits
// beside the sticker, on whichever side has room.

type Api = { show: (m: Moment, el: Element, pin?: boolean) => void; hide: () => void };
const CardContext = createContext<Api | null>(null);
export const useCard = () => useContext(CardContext);

const WIDTH = 340;
const mono = { fontFamily: "ui-monospace, Menlo, monospace" }; // commands and errors only

export function CardProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ m: Moment; el: Element; pinned: boolean } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const api = useMemo<Api>(
    () => ({
      show: (m, el, pin = false) => {
        window.clearTimeout(hideTimer.current);
        setShown((s) => (s?.pinned && !pin ? s : { m, el, pinned: pin }));
      },
      hide: () => {
        hideTimer.current = window.setTimeout(() => setShown((s) => (s?.pinned ? s : null)), 120);
      },
    }),
    [],
  );
  useEffect(() => {
    if (!shown?.pinned) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && shown.el.contains(e.target as Node)) return;
      setShown(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", close);
    };
  }, [shown]);
  return (
    <CardContext.Provider value={api}>
      {children}
      {shown && <CardView m={shown.m} el={shown.el} onEnter={() => window.clearTimeout(hideTimer.current)} onLeave={api.hide} />}
    </CardContext.Provider>
  );
}

function CardView({ m, el, onEnter, onLeave }: { m: Moment; el: Element; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  const [, redraw] = useState(0);
  // Follow the sticker when the page scrolls or resizes.
  useEffect(() => {
    const again = () => redraw((n) => n + 1);
    window.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    return () => {
      window.removeEventListener("scroll", again, true);
      window.removeEventListener("resize", again);
    };
  }, []);
  useLayoutEffect(() => {
    const r = el.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const right = r.right + 12;
    const left = right + WIDTH < vw - 8 ? right : Math.max(8, r.left - 12 - WIDTH);
    const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8);
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  });
  const c = cardFor(m);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={c.headline}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="tk-card"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: WIDTH,
        maxWidth: "calc(100vw - 16px)",
        zIndex: 5000,
        padding: "14px 16px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <StickerArt m={m} w={56} style={{ flexShrink: 0, position: "relative" }} still />
        <div className="tk-display" style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.1 }}>
          {c.headline}
        </div>
      </div>
      {/* What you asked, as a speech bubble. */}
      {c.quote && (
        <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--tk-lavender)", border: "2px solid var(--tk-ink)", borderRadius: "14px 14px 14px 4px", fontSize: 14, lineHeight: 1.4 }}>
          {c.quote}
        </div>
      )}
      {c.facts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
          {c.facts.map((f, i) => (
            <span key={i} className="tk-chip" style={{ fontSize: 13, padding: "5px 10px 3px" }}>
              {f}
            </span>
          ))}
        </div>
      )}
      {c.code && (
        <pre
          style={{
            ...mono,
            marginTop: 10,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--tk-ink)",
            color: "var(--tk-cream)",
            borderRadius: 10,
            padding: "7px 10px",
            // Errors are saved at 240 characters at most, so this is nearly always all of it;
            // anything longer scrolls (the card stays open while the pointer is over it).
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {c.code}
        </pre>
      )}
      {c.reply && (
        <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.4 }}>
          <span className="tk-display" style={{ fontWeight: 700, color: "var(--tk-teal)" }}>
            Claude:{" "}
          </span>
          {c.reply}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--tk-muted)" }}>{c.foot}</div>
    </div>
  );
}
