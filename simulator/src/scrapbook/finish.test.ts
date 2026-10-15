import { describe, expect, it } from "vitest";
import type { DaySummary } from "../state/moments";
import { finishesFor } from "./finish";

const days = (moments: number[], extra: Record<number, Partial<DaySummary>> = {}): DaySummary[] =>
  moments.map((n, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, moments: n, ...extra[i] }) as DaySummary);

describe("metal", () => {
  const ordinary = Array(15).fill(100);
  it("nothing shines before 14 days of history", () => {
    expect(finishesFor(days([100, 500]))["2026-10-02"]?.metal).toBeUndefined();
  });
  it("gold: the busiest of the last 30 days, far above an ordinary day", () => {
    const f = finishesFor(days([...ordinary, 300]));
    expect(f["2026-10-16"]).toMatchObject({ metal: "gold", busierThan: { n: 15, of: 16 } });
  });
  it("silver: in the top 10%, clearly above an ordinary day", () => {
    const f = finishesFor(days([...ordinary.slice(0, 14), 300, 140]));
    expect(f["2026-10-16"].metal).toBe("silver");
  });
  it("a busiest day that's barely above ordinary doesn't shine", () => {
    expect(finishesFor(days([...ordinary, 110]))["2026-10-16"].metal).toBeUndefined();
  });
  it("is scarce: a steady climb doesn't gild every day", () => {
    const climb = Array.from({ length: 30 }, (_, i) => 100 + i * 5);
    const golds = Object.values(finishesFor(days(climb))).filter((f) => f.metal === "gold").length;
    expect(golds).toBe(0);
  });
  it("a light user still gets the odd gold day (it's relative)", () => {
    const f = finishesFor(days([...Array(15).fill(5), 12]));
    expect(f["2026-10-16"].metal).toBe("gold");
  });
});

describe("holo", () => {
  it("a project's first ship, once; history before the warm-up still counts", () => {
    const d = days(Array(17).fill(100), { 2: { shipped: ["toki"] }, 15: { shipped: ["toki", "site"] }, 16: { shipped: ["site"] } });
    const f = finishesFor(d);
    expect(f["2026-10-16"].firstShips).toEqual(["site"]);
    expect(f["2026-10-17"].firstShips).toEqual([]);
  });
  it("the longest run that needed nothing from you, 40+ tools", () => {
    const d = days(Array(16).fill(100), { 3: { longestRun: { tools: 50, t: 1 } }, 14: { longestRun: { tools: 45, t: 2 } }, 15: { longestRun: { tools: 61, t: 3 } } });
    const f = finishesFor(d);
    expect(f["2026-10-15"].runAt).toBeUndefined(); // 45 < 50 earlier in the window
    expect(f["2026-10-16"].runAt).toBe(3);
  });
});

describe("which stickers go holo", () => {
  it("the first SHIPPED of a first-time project, and the long run's turn", async () => {
    const { holoAt } = await import("./finish");
    const st = [
      { t: 30, kind: "shipped", project: "site" },
      { t: 10, kind: "shipped", project: "site" },
      { t: 20, kind: "shipped", project: "old" },
      { t: 5, kind: "asked" },
    ];
    expect([...holoAt(st, { firstShips: ["site"], runAt: 5 })].sort()).toEqual([10, 5].sort());
    expect(holoAt(st, undefined).size).toBe(0);
  });
});
