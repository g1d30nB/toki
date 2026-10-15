import { describe, expect, it } from "vitest";
import type { DaySummary } from "../state/moments";
import { density, monthGrid, monthsOf, signatureFaces, totals } from "./calendar";

const day = (d: string, faces: Record<string, number>, extra: Partial<DaySummary> = {}) =>
  ({ day: d, moments: Object.values(faces).reduce((a, b) => a + b, 0), prompts: 1, toolCalls: 2, approvals: 0, sparkles: 1, errors: 0, faces, ...extra }) as DaySummary;

describe("signature faces", () => {
  const days = [
    day("2026-10-01", { run: 50, test: 2, web: 10 }),
    day("2026-10-02", { run: 50, test: 20, web: 10 }),
    day("2026-10-03", { run: 50, web: 40, error: 1 }),
  ];
  const sig = signatureFaces(days);
  it("is what the day had more of than usual, not the most common face", () => {
    expect(sig["2026-10-02"].face).toBe("test");
    expect(sig["2026-10-03"].face).toBe("web");
  });
  it("ignores faces seen fewer than 3 times (one error isn't a day's character)", () => {
    expect(sig["2026-10-03"].face).not.toBe("error");
  });
  it("never changes when later days arrive", () => {
    expect(signatureFaces(days.slice(0, 2))["2026-10-02"]).toEqual(sig["2026-10-02"]);
  });
  it("leaves out days frozen before faces were counted", () => {
    expect(signatureFaces([{ ...days[0], faces: undefined }])).toEqual({});
  });
});

describe("calendar", () => {
  it("October 2026 starts on a Thursday: three blanks, Monday first", () => {
    const g = monthGrid("2026-10");
    expect(g.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(g.length % 7).toBe(0);
    expect(g.filter(Boolean)).toHaveLength(31);
  });
  it("months run newest first, from the first day with data to this month", () => {
    expect(monthsOf([day("2026-09-23", {}), day("2026-10-02", {})], "2026-12-01")).toEqual(["2026-12", "2026-11", "2026-10", "2026-09"]);
    expect(monthsOf([day("2025-12-30", {})], "2026-01-05")).toEqual(["2026-01", "2025-12"]);
  });
  it("a quiet day still shows", () => {
    expect(density(4, 400)).toBeCloseTo(0.1);
    expect(density(800, 400)).toBe(1);
  });
  it("adds up a stretch", () => {
    const t = totals([day("2026-10-01", {}, { byKind: { code: 3 }, byModel: { "Opus 5.5": 3 } }), day("2026-10-02", {}, { byKind: { code: 1, images: 2 } })]);
    expect(t).toMatchObject({ days: 2, prompts: 2, toolCalls: 4, byKind: { code: 4, images: 2 }, byModel: { "Opus 5.5": 3 } });
  });
});
