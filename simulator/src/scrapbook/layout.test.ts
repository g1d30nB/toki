import { describe, expect, it } from "vitest";
import type { Moment } from "../state/moments";
import { bandsOf, newestFirst, packBand } from "./layout";

const at = (h: number, m: number) => new Date(2026, 9, 3, h, m).getTime();
const turn = (t: number, n = 3): Moment => ({ t, kind: "asked", face: "run", n, detail: "done" }) as Moment;

describe("bandsOf", () => {
  it("makes one band per hour and a quiet divider for gaps over 30 minutes", () => {
    const bands = bandsOf([turn(at(9, 5)), turn(at(9, 40)), turn(at(11, 0))]); // the 35 min inside 09:00 stays in its band
    expect(bands.map((b) => b.kind)).toEqual(["hour", "quiet", "hour"]);
  });
});

describe("packBand", () => {
  it("keeps every sticker inside the band and the band grows with the work", () => {
    const few = packBand([0, 5, 10].map((m) => turn(at(17, m))), 1000, "a");
    const many = packBand(Array.from({ length: 40 }, (_, i) => turn(at(17, i))), 1000, "a");
    expect(many.height).toBeGreaterThan(few.height * 2);
    for (const p of many.placed) {
      expect(p.x - p.w / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w / 2).toBeLessThanOrEqual(1000);
      expect(p.y).toBeLessThan(many.height);
    }
  });

  it("never stacks two stickers on the same spot", () => {
    const { placed } = packBand(Array.from({ length: 30 }, (_, i) => turn(at(17, 30 + (i % 3)))), 1000, "b");
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const [a, b] = [placed[i], placed[j]];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(Math.min(a.w, b.w) * 0.3);
      }
  });
});

describe("newestFirst", () => {
  it("puts the latest hour on top and the latest sticker first in each hour", () => {
    const bands = newestFirst(bandsOf([turn(at(9, 5)), turn(at(9, 20)), turn(at(11, 0)), turn(at(11, 30))]));
    expect(bands.map((b) => b.kind)).toEqual(["hour", "quiet", "hour"]);
    const first = bands[0];
    expect(first.kind === "hour" && first.stickers.map((m) => new Date(m.t).getMinutes())).toEqual([30, 0]);
  });
});
