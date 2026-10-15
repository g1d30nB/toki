import { useEffect, useRef } from "react";
import type { Gesture } from "../replay/events";
import type { AgentState } from "../state/agentState";
import { Gfx } from "./gfx";
import { palette } from "./palette";
import { FaceRenderer, type Lab } from "./render";

// Only the colours the face actually draws with; blended edge pixels snap to one of these.
// The first NEUTRALS entries are the neutrals.
const NEUTRALS = 3;
const PALETTE_RGB = [palette.ground, palette.ink, palette.cream, palette.mustard, palette.teal, palette.tomato].map((hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
);

/** Crisp edges: snap every pixel to the nearest palette colour, as aliased drawing would. */
function snapToPalette(ctx: CanvasRenderingContext2D) {
  const img = ctx.getImageData(0, 0, 320, 240);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let best = 0;
    let bestD = Infinity;
    // A grey pixel is an edge blend between neutrals (cream on navy): never let it
    // land on a hue, or edges sprout teal speckles that aliased drawing wouldn't make.
    const grey = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 40;
    const candidates = grey ? NEUTRALS : PALETTE_RGB.length;
    for (let p = 0; p < candidates; p++) {
      const c = PALETTE_RGB[p];
      const dist = (d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = p;
      }
    }
    [d[i], d[i + 1], d[i + 2]] = PALETTE_RGB[best];
  }
  ctx.putImageData(img, 0, 0);
}

type Props = {
  getState: () => AgentState;
  getLab: () => Lab;
  scale: number;
  greyscale: boolean;
  peripheral: boolean;
  /** Mouse on the screen as a finger on the glass: gestures in screen pixels (320 x 240). */
  /** Returns true when a "press" was used up (it answered Allow / Deny): the rest of that touch is ignored. */
  onGesture?: (gesture: Gesture | "press", x: number, y: number) => boolean | void;
};

// The robot's 320 x 240 screen. Draws every animation frame from the latest
// state, independently of React re-renders.
export function Screen({ getState, getLab, scale, greyscale, peripheral, onGesture }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Gesture recogniser, as on the robot: "press" fires at once (Allow / Deny),
  // a tap on release, a second tap soon after is a double-tap, and holding is a long-press.
  const touch = useRef({ down: 0, x: 0, y: 0, held: false, lastTap: -1e9, timer: 0 });

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 320, ((e.clientY - r.top) / r.height) * 240] as const;
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onGesture) return;
    const [x, y] = at(e);
    const t = touch.current;
    Object.assign(t, { down: performance.now(), x, y, held: false });
    window.clearTimeout(t.timer);
    if (onGesture("press", x, y)) {
      t.down = 0; // answered an approval: this touch is done
      return;
    }
    t.timer = window.setTimeout(() => {
      t.held = true;
      onGesture("long-press", x, y);
    }, getLab().tokens.longPressMs);
  };
  const onUp = () => {
    if (!onGesture) return;
    const t = touch.current;
    window.clearTimeout(t.timer);
    if (t.held || !t.down) return;
    t.down = 0;
    const now = performance.now();
    const double = now - t.lastTap < getLab().tokens.doubleTapMs;
    t.lastTap = double ? -1e9 : now;
    onGesture(double ? "double-tap" : "tap", t.x, t.y);
  };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const g = new Gfx(ctx);
    const face = new FaceRenderer();
    let raf = 0;
    const loop = (now: number) => {
      const lab = getLab();
      face.draw(g, getState(), now, lab);
      if (lab.edges === "crisp") snapToPalette(ctx);
      canvas.style.imageRendering = lab.edges === "crisp" ? "pixelated" : "auto";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getState, getLab]);

  // "Edge of vision" (spec §2): small, soft and low-contrast, roughly how the
  // face reads at the bottom of your field of view while you look at the laptop.
  const filters = [greyscale && "grayscale(1)", peripheral && "blur(2.5px) contrast(0.8)"].filter(Boolean).join(" ");

  return (
    <canvas
      ref={ref}
      width={320}
      height={240}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={() => window.clearTimeout(touch.current.timer)}
      className={`block rounded-md select-none ${onGesture ? "cursor-pointer" : ""}`}
      style={{
        // Fills the available width up to `scale` times native size, so it fits narrow panes.
        width: peripheral ? `${(0.6 / scale) * 100}%` : "100%",
        maxWidth: 320 * scale,
        aspectRatio: "4 / 3",
        filter: filters || undefined,
      }}
    />
  );
}
