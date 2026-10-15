import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../replay/events";
import { expressionFor } from "../face/expressions";
import { stateAt } from "./agentState";
import { HookNormaliser, describeSuggestions, readQuestion, summarise, type HookPayload } from "./hooks";

// Payloads shaped like the ones logged from a desktop session on 3 Oct (bridge-hooks.md §2).
const S = "da4d9797";
const hook = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({
  hook_event_name,
  session_id: S,
  cwd: "/Users/g/Projects/StackChan Robot/bridge/sandbox",
  permission_mode: "default",
  ...extra,
});

function run(hooks: [number, HookPayload][]): StreamEvent[] {
  const n = new HookNormaliser();
  return hooks.flatMap(([t, p]) => n.normalise(p, t));
}

describe("summarise", () => {
  it.each([
    ["Bash", { command: "npm   test\n -- auth" }, "npm test -- auth"],
    ["Write", { file_path: "/Users/g/Projects/StackChan Robot/probe.txt", content: "hello" }, "StackChan Robot/probe.txt"],
    ["Grep", { pattern: "TODO" }, "TODO"],
    ["WebFetch", { url: "https://example.com", prompt: "x" }, "https://example.com"],
  ])("%s", (tool, input, want) => {
    expect(summarise(tool, input)).toBe(want);
  });
});

describe("hooks → stream events", () => {
  it("a write that needs permission: working, blocked, then cleared when it runs", () => {
    const events = run([
      [1_000, hook("UserPromptSubmit")],
      [3_000, hook("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/a/b/probe.txt" }, tool_use_id: "toolu_1" })],
      [3_030, hook("PermissionRequest", { tool_name: "Write", tool_input: { file_path: "/a/b/probe.txt" }, tool_use_id: null })],
      [5_700, hook("PostToolUse", { tool_name: "Write", tool_use_id: "toolu_1" })],
      [9_300, hook("Stop")],
    ]);
    expect(events.map((e) => e.kind)).toEqual(["turn", "turn", "prompt", "prompt-cleared", "turn", "stop"]);
    expect(expressionFor(stateAt(events, 3_500))).toBe("blocked");
    expect(stateAt(events, 3_500).prompt).toMatchObject({ tool: "Write", hint: "b/probe.txt" });
    expect(expressionFor(stateAt(events, 6_000))).toBe("edit");
    expect(expressionFor(stateAt(events, 9_400))).toBe("done");
  });

  it("a denied permission clears the prompt", () => {
    const events = run([
      [1_000, hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm x" } })],
      [2_000, hook("PermissionDenied", { tool_name: "Bash" })],
    ]);
    expect(events.map((e) => e.kind)).toEqual(["prompt", "prompt-cleared"]);
    expect(stateAt(events, 2_100).prompt).toBeNull();
  });

  it("a failed tool and a failed turn read as errors", () => {
    const events = run([
      [1_000, hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "false" }, tool_use_id: "t" })],
      [1_100, hook("PostToolUseFailure", { tool_name: "Bash", tool_use_id: "t" })],
    ]);
    expect(expressionFor(stateAt(events, 1_200))).toBe("error");
    expect(run([[1, hook("StopFailure")]])).toEqual([{ kind: "stop", t: 1, error: true }]);
  });

  it("subagents count from Agent calls and their results; the phantom SubagentStop is ignored", () => {
    const events = run([
      [1_000, hook("PreToolUse", { tool_name: "Agent", tool_input: { description: "Explore" }, tool_use_id: "a1" })],
      [1_500, hook("SubagentStart", { agent_type: "Explore" })],
      [4_000, hook("PostToolUse", { tool_name: "Agent", tool_use_id: "a1" })],
      [6_000, hook("SubagentStop", { agent_type: "general-purpose" })],
    ]);
    expect(stateAt(events, 2_000).subagents).toEqual(["a1"]);
    expect(stateAt(events, 4_100).subagents).toEqual([]);
    expect(events.filter((e) => e.t === 6_000)).toEqual([]);
  });

  it("sessions keep their own prompts", () => {
    const n = new HookNormaliser();
    const a = n.normalise(hook("PermissionRequest", { session_id: "A", tool_name: "Bash" }), 1);
    const b = n.normalise(hook("PostToolUse", { session_id: "B", tool_name: "Bash" }), 2);
    expect(a[0].kind).toBe("prompt");
    expect(b.map((e) => e.kind)).toEqual(["turn"]);
  });
});

describe("Always allow, in words", () => {
  it.each([
    [[{ type: "setMode", mode: "acceptEdits", destination: "session" }], "All edits, this session"],
    [[{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" }], "Bash(npm test), this project"],
    [[{ type: "addRules", rules: [{ toolName: "WebFetch" }], destination: "userSettings" }], "WebFetch, everywhere"],
    [["Bash(npm *)"], "Bash(npm *)"],
    [[{ type: "somethingNew", destination: "session" }], "A change (somethingNew), this session"],
    [[], undefined],
    [undefined, undefined],
  ])("%j", (suggestions, want) => {
    expect(describeSuggestions(suggestions as unknown[] | undefined)).toBe(want);
  });

  it("travels with the prompt", () => {
    const [e] = new HookNormaliser().normalise(
      hook("PermissionRequest", { tool_name: "Write", permission_suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] }),
      1,
    );
    expect(e).toMatchObject({ kind: "prompt", always: "All edits, this session" });
  });
});

describe("questions (AskUserQuestion, step 6)", () => {
  // As logged from a desktop session on 3 Oct.
  const colour = {
    questions: [
      {
        question: "Which of these three colours do you prefer?",
        header: "Colour",
        options: [
          { label: "Red", description: "Red" },
          { label: "Green", description: "Green" },
        ],
        multiSelect: false,
      },
    ],
  };

  it("reads the header only: the question is answered in Claude", () => {
    expect(readQuestion(colour)).toEqual({ header: "Colour" });
    expect(readQuestion({})).toEqual({ header: "" });
  });

  it("a question is the asked face, never Allow / Deny or Always allow", () => {
    const events = run([
      [1_000, hook("PreToolUse", { tool_name: "AskUserQuestion", tool_input: colour, tool_use_id: "q1" })],
      [1_020, hook("PermissionRequest", { tool_name: "AskUserQuestion", tool_input: colour, permission_suggestions: [{ type: "setMode", mode: "acceptEdits" }] })],
      [5_000, hook("PostToolUse", { tool_name: "AskUserQuestion", tool_use_id: "q1" })],
    ]);
    const s = stateAt(events, 1_100);
    expect(expressionFor(s)).toBe("asked");
    expect(s.prompt?.always).toBeUndefined();
    expect(s.prompt?.question).toEqual({ header: "Colour" });
    expect(stateAt(events, 5_100).prompt).toBeNull(); // answered in Claude: Toki lets go
  });
});
