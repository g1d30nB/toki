// Lead palette (spec §7.1): navy linework, tomato, mustard, teal, cream.
// Values are placeholders until the art direction pass; keep them RGB565-friendly.
export const palette = {
  ground: "#14213d", // calm dark navy for the everyday working face (§7.2)
  navy: "#1d2b53",
  ink: "#0b1530",
  cream: "#f6ecd6",
  tomato: "#e4572e",
  mustard: "#f2b134",
  teal: "#2a9d8f",
  dim: "#5b6b8c",
} as const;

/**
 * Mixes two hex colours. On the robot's flat navy ground, stepping a shape's
 * colour towards the ground is how it "fades" (M5GFX has no transparency).
 */
export function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const k = Math.max(0, Math.min(1, t));
  const v = [1, 3, 5].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k));
  return "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("");
}
