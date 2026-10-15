import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../replay/events";
import { classifyTool, defaultConfig, stateAt } from "./agentState";
import { SHUTTER_QUIET, expressionFor, shutterFor } from "../face/expressions";

const snap = (t: number, extra: Partial<Extract<StreamEvent, { kind: "snapshot" }>> = {}): StreamEvent => ({
  kind: "snapshot",
  t,
  total: 1,
  running: 1,
  waiting: 0,
  msg: "",
  entries: [],
  tokens: 0,
  tokensToday: 0,
  ...extra,
});
const toolTurn = (t: number, name: string, summary = ""): StreamEvent => ({
  kind: "turn",
  t,
  role: "assistant",
  tools: [{ name, summary }],
  blocks: ["tool_use"],
  toolError: false,
});

describe("classifyTool", () => {
  it.each([
    ["Read", "", "read"],
    ["Grep", "", "search"],
    ["Edit", "", "edit"],
    ["Write", "", "edit"],
    ["Bash", "git status", "run"],
    ["Bash", "npm test -- auth", "test"],
    ["Bash", "npx vitest run", "test"],
    ["WebFetch", "", "web"],
    ["mcp__Claude_Browser__navigate", "", "web"],
    ["Agent", "", "subagent"],
  ])("%s %s -> %s", (name, summary, want) => {
    expect(classifyTool({ name, summary })).toBe(want);
  });
});

describe("agent state", () => {
  it("is idle with no events", () => {
    expect(stateAt([], 10_000).shown.mode).toBe("idle");
  });

  it("shows the activity of the latest tool call, then decays to idle", () => {
    const ev = [snap(0), toolTurn(1_000, "Read")];
    expect(stateAt(ev, 2_000).shown).toMatchObject({ mode: "working", activity: "read" });
    expect(stateAt(ev, 1_000 + defaultConfig.activityHoldMs + 2_000).shown.mode).toBe("idle");
  });

  it("does not twitch: a quick second tool waits out the dwell time", () => {
    const ev = [toolTurn(0, "Read"), toolTurn(300, "Grep")];
    expect(stateAt(ev, 600).shown.activity).toBe("read");
    expect(stateAt(ev, 300 + defaultConfig.minDwellMs + 300).shown.activity).toBe("search");
  });

  it("goes blocked at once on a prompt, and records the wait when the robot answers", () => {
    const prompt = { id: "p1", tool: "Write", hint: "a.txt" };
    const ev: StreamEvent[] = [
      toolTurn(0, "Write"),
      snap(100, { waiting: 1, prompt }),
      { kind: "decision", t: 4_100, id: "p1", decision: "once" },
      snap(4_200),
    ];
    expect(stateAt(ev, 150).shown.mode).toBe("blocked");
    const after = stateAt(ev, 4_300);
    expect(after.shown.mode).not.toBe("blocked");
    expect(after.stats.approvals).toBe(1);
    expect(after.stats.waitedOnYouMs).toBe(4_000);
  });

  it("notes a prompt answered on the Mac", () => {
    const prompt = { id: "p2", tool: "Bash", hint: "ls" };
    const ev = [snap(0, { waiting: 1, prompt }), snap(2_000)];
    const s = stateAt(ev, 2_100);
    expect(s.prompt).toBeNull();
    expect(s.oneShots.at(-1)?.kind).toBe("resolved-elsewhere");
  });

  it("shows done briefly when a turn finishes", () => {
    const ev = [toolTurn(0, "Bash", "ls"), snap(5_000, { msg: "done (success), 2 turns" })];
    expect(stateAt(ev, 5_100).shown.mode).toBe("done");
    expect(stateAt(ev, 5_000 + defaultConfig.oneShotMs + 500).shown.mode).toBe("working");
  });
});

describe("turn length", () => {
  it("starts at your prompt and ends when the turn is done", () => {
    const ev: StreamEvent[] = [
      { kind: "turn", t: 1_000, role: "user", tools: [], blocks: ["text"], toolError: false },
      toolTurn(2_000, "Read"),
      snap(9_000, { msg: "done (success), 1 turn" }),
    ];
    expect(stateAt(ev, 5_000).turnSince).toBe(1_000);
    expect(stateAt(ev, 9_500).turnSince).toBeNull();
  });
});

describe("subagents running", () => {
  const spawn = (t: number, ids: string[]): StreamEvent => ({
    kind: "turn",
    t,
    role: "assistant",
    tools: ids.map((id) => ({ id, name: "Agent", summary: "explore" })),
    blocks: ids.map(() => "tool_use"),
    toolError: false,
  });
  const finish = (t: number, ids: string[]): StreamEvent => ({
    kind: "turn",
    t,
    role: "user",
    tools: [],
    blocks: ids.map(() => "tool_result"),
    toolError: false,
    results: ids,
  });

  it("counts Agent calls up and their results down", () => {
    const ev = [spawn(1_000, ["a", "b"]), spawn(2_000, ["c"]), finish(5_000, ["b"]), finish(7_000, ["a", "c"])];
    expect(stateAt(ev, 1_500).subagents).toEqual(["a", "b"]);
    expect(stateAt(ev, 3_000).subagents).toHaveLength(3);
    expect(stateAt(ev, 6_000).subagents).toEqual(["a", "c"]);
    expect(stateAt(ev, 8_000).subagents).toEqual([]);
  });

  it("clears when the turn is done", () => {
    const ev = [spawn(1_000, ["a"]), snap(4_000, { msg: "done (success), 1 turn" })];
    expect(stateAt(ev, 4_100).subagents).toEqual([]);
  });
});

describe("error hold", () => {
  it("holds error for errorMs, longer than other one-shots", () => {
    const ev: StreamEvent[] = [
      toolTurn(0, "Bash", "npm run build"),
      { kind: "turn", t: 1_000, role: "user", tools: [], blocks: ["tool_result"], toolError: true },
      toolTurn(1_500, "Read"),
    ];
    expect(stateAt(ev, 1_000 + defaultConfig.errorMs - 200).shown.mode).toBe("error");
    expect(stateAt(ev, 1_000 + defaultConfig.errorMs + defaultConfig.minDwellMs + 300).shown.mode).toBe("working");
  });
});

describe("touch on the face (spec §6)", () => {
  const touch = (t: number, gesture: "tap" | "double-tap" | "long-press", target: "face" | "yes" | "no" = "face"): StreamEvent => ({
    kind: "gesture",
    t,
    gesture,
    target,
  });
  const face = (events: StreamEvent[], now: number) => expressionFor(stateAt(events, now));

  it("a tap boops, then the face returns", () => {
    expect(face([touch(1_000, "tap")], 1_500)).toBe("boop");
    expect(face([touch(1_000, "tap")], 1_000 + defaultConfig.boopMs + 100)).toBe("idle");
  });

  it("double-tap starts quiet mode; it hides working and errors, but not approvals", () => {
    const quiet = [touch(1_000, "double-tap"), toolTurn(2_000, "Read")];
    expect(face(quiet, 2_500)).toBe("quiet");
    expect(face([...quiet, snap(3_000, { msg: "done (error), 1 turns" })], 3_200)).toBe("quiet");
    expect(face([...quiet, snap(3_000, { waiting: 1, prompt: { id: "p", tool: "Bash", hint: "ls" } })], 3_200)).toBe("blocked");
    expect(face([...quiet, touch(4_000, "tap")], 4_100)).toBe("boop");
    expect(face([...quiet, touch(4_000, "tap")], 4_000 + defaultConfig.boopMs + 100)).toBe("read");
    expect(face([...quiet, touch(4_000, "tap"), touch(4_200, "double-tap")], 4_500)).toBe("quiet");
    expect(face(quiet, 1_000 + defaultConfig.quietMs + 1)).toBe("idle");
  });

  it("long-press asks to close the day; Not yet or silence leaves it open", () => {
    expect(face([touch(1_000, "long-press")], 2_000)).toBe("closeAsk");
    expect(face([touch(1_000, "long-press"), touch(2_000, "tap", "no")], 2_100)).toBe("idle");
    expect(face([touch(1_000, "long-press")], 1_000 + defaultConfig.closeAskMs + 1)).toBe("idle");
  });

  it("closing an earned day celebrates, then the shutter comes fully down", () => {
    const events = [snap(500, { msg: "done (success), 1 turns" }), touch(1_000, "long-press"), touch(2_000, "tap", "yes")];
    expect(face(events, 2_100)).toBe("closed");
    const later = stateAt(events, 2_000 + defaultConfig.closeShowMs + 1);
    expect(expressionFor(later)).toBe("night");
    expect(shutterFor(later)).toBe(1);
  });

  it("closing a quiet day yawns and brings the shutter most of the way down", () => {
    const events = [touch(1_000, "long-press"), touch(2_000, "tap", "yes")];
    expect(face(events, 2_100)).toBe("sleepy");
    expect(shutterFor(stateAt(events, 2_000 + defaultConfig.closeShowMs + 1))).toBe(SHUTTER_QUIET);
  });

  it("blocked lifts the shutter; a tap reopens the day", () => {
    const closed = [touch(1_000, "long-press"), touch(1_500, "tap", "yes")];
    const ask = snap(9_000, { waiting: 1, prompt: { id: "p", tool: "Bash", hint: "ls" } });
    const s = stateAt([...closed, ask], 9_100);
    expect(expressionFor(s)).toBe("blocked");
    expect(shutterFor(s)).toBe(0);
    expect(face([...closed, touch(9_000, "long-press")], 9_100)).toBe("night");
    expect(face([...closed, touch(9_000, "tap")], 9_100)).toBe("boop");
    expect(shutterFor(stateAt([...closed, touch(9_000, "tap")], 9_100))).toBe(0);
  });

  it("reopening keeps the day's count, so closing again is still earned", () => {
    const earned = [snap(500, { msg: "done (success), 1 turns" }), touch(1_000, "long-press"), touch(1_500, "tap", "yes")];
    const again = [...earned, touch(9_000, "tap"), touch(12_000, "long-press"), touch(12_500, "tap", "yes")];
    expect(face(again, 12_600)).toBe("closed");
    expect(shutterFor(stateAt(again, 12_500 + defaultConfig.closeShowMs + 1))).toBe(1);
  });

  it("touches are ignored while blocked (only Allow / Deny count)", () => {
    const ask = snap(1_000, { waiting: 1, prompt: { id: "p", tool: "Bash", hint: "ls" } });
    expect(face([ask, touch(1_500, "long-press")], 1_600)).toBe("blocked");
    expect(face([ask, touch(1_500, "long-press"), snap(2_000)], 2_100)).toBe("idle");
  });
});
