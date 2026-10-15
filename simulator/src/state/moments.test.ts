import { describe, expect, it } from "vitest";
import { dayOf, mergeSources, momentsFromHooks, momentsFromRecording, summariseDay, type Moment } from "./moments";

const at = (s: string) => `2026-10-03T${s}.000Z`;
const h = (t: string, hook_event_name: string, extra: Record<string, unknown> = {}) => ({
  t: at(t),
  hook: { hook_event_name, session_id: "s1", cwd: "/Users/g/Projects/my-website", permission_mode: "default", ...extra },
});

describe("moments from hooks", () => {
  const ms = momentsFromHooks([
    h("10:00:00", "UserPromptSubmit"),
    h("10:00:02", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "/a" } }),
    h("10:00:03", "PreToolUse", { tool_name: "Write", tool_input: { file_path: "/b" } }),
    h("10:00:03", "PermissionRequest", { tool_name: "Write" }),
    h("10:07:03", "PostToolUse", { tool_name: "Write" }),
    h("10:07:10", "PreToolUse", { tool_name: "Agent", tool_input: { description: "x" } }),
    h("10:07:11", "PreToolUse", { tool_name: "Agent", tool_input: { description: "y" } }),
    h("10:09:00", "Stop", { permission_mode: "auto" }),
  ]);
  const kinds = ms.map((m) => m.kind);

  it("tells the day's story in order", () => {
    expect(kinds).toEqual(["hello", "asked", "work", "work", "blocked", "approved", "your-turn", "work", "subagents", "work", "yolo", "done"]);
  });
  it("knows how long Claude waited on you, and says YOUR TURN past 5 minutes", () => {
    expect(ms.find((m) => m.kind === "approved")?.n).toBe(7);
    expect(ms.find((m) => m.kind === "your-turn")?.n).toBe(7);
  });
  it("counts a burst of subagents as one sticker", () => {
    expect(ms.filter((m) => m.kind === "subagents")).toHaveLength(1);
    expect(ms.find((m) => m.kind === "subagents")?.n).toBe(2);
  });
  it("keeps the project (private) and the face for each sticker", () => {
    expect(ms[0].project).toBe("my-website");
    expect(ms.find((m) => m.kind === "work" && m.detail === "edit")?.face).toBe("edit");
  });
  it("sums the day without scores", () => {
    const s = summariseDay("2026-10-03", ms);
    expect(s).toMatchObject({ prompts: 1, toolCalls: 4, approvals: 1, waitedOnYouMin: 7, sparkles: 1, subagents: 2, sessions: 1 });
  });
});

describe("moments from Toki's recordings", () => {
  it("reads Buddy's approvals and Toki's own log", () => {
    const start = Date.parse(at("09:00:00"));
    const ms = momentsFromRecording(start, [
      { kind: "snapshot", t: 0, total: 1, running: 1, waiting: 1, msg: "", entries: [], tokens: 0, tokensToday: 0, prompt: { id: "p", tool: "Bash", hint: "ls" } },
      { kind: "decision", t: 4_000, id: "p", decision: "once" },
      { kind: "device", t: 5_000, text: "moment quiet" },
      { kind: "device", t: 6_000, text: "moment closed earned" },
    ]);
    expect(ms.map((m) => m.kind)).toEqual(["blocked", "approved", "quiet", "closed"]);
    expect(ms[3].face).toBe("closed");
  });
});

describe("merging sources", () => {
  it("drops a recording moment the hooks already have; keeps what only Toki knows", () => {
    const hook: Moment[] = [{ t: 1_000, kind: "blocked", face: "blocked" }];
    const rec: Moment[] = [
      { t: 1_200, kind: "blocked", face: "blocked" },
      { t: 9_000, kind: "blocked", face: "blocked" },
      { t: 9_500, kind: "quiet", face: "quiet" },
    ];
    expect(mergeSources(hook, rec).map((m) => m.t)).toEqual([1_000, 9_000, 9_500]);
  });
});

describe("the diary's day", () => {
  it("rolls over at 02:00 local, so late nights belong to the day they started", () => {
    expect(dayOf(new Date(2026, 9, 3, 23, 30).getTime())).toBe("2026-10-03");
    expect(dayOf(new Date(2026, 9, 4, 1, 59).getTime())).toBe("2026-10-03");
    expect(dayOf(new Date(2026, 9, 4, 2, 1).getTime())).toBe("2026-10-04");
  });
});

import { weekNumber } from "../scrapbook/layout";

describe("week numbers", () => {
  it.each([
    ["2026-09-28", 40],
    ["2026-10-04", 40],
    ["2026-10-05", 41],
    ["2026-01-01", 1],
    ["2027-01-01", 53],
  ])("%s is week %i", (day, want) => {
    expect(weekNumber(day)).toBe(want);
  });
});
