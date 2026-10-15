import { useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

// The finish on a sticker (spec §9.5): silver, gold or holo. Wraps the sticker and
// lays a sheen and a glare over it, cut to its shape; the light follows the pointer
// across it. With reduced motion the sheen stays put. Styles in index.css.

export type Finish = "silver" | "gold" | "holo";

/** Metal drops the sticker's colour so the foil carries it (gold is a toned grey). */
export const FINISH_FILTER: Record<Finish, string> = {
  silver: "grayscale(1) contrast(1.15) brightness(1.12)",
  gold: "grayscale(1) sepia(1) saturate(3.6) hue-rotate(-10deg) brightness(1.06) contrast(1.08)",
  holo: "",
};

const still = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** `mask`: the sticker's image, so the sheen keeps to its die-cut. Without one, its box. */
export function Foil({ finish, mask, children, style, ...rest }: { finish: Finish; mask?: string; children: ReactNode; style?: CSSProperties } & HTMLAttributes<HTMLSpanElement>) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || still()) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const leave = () => {
    ref.current?.style.removeProperty("--mx");
    ref.current?.style.removeProperty("--my");
  };
  return (
    <span
      ref={ref}
      {...rest}
      className={`foil foil-${finish}`}
      onPointerMove={(e) => {
        move(e);
        rest.onPointerMove?.(e);
      }}
      onPointerLeave={(e) => {
        leave();
        rest.onPointerLeave?.(e);
      }}
      style={{ ...(mask ? ({ "--mask": `url("${mask}")` } as CSSProperties) : {}), ...style }}
    >
      {children}
      <span className="foil-sheen" aria-hidden />
      <span className="foil-glare" aria-hidden />
    </span>
  );
}
