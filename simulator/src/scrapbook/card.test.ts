import { describe, expect, it } from "vitest";
import { momentsFromHooks, shipCommand } from "../state/moments";
import { cardFor, duration } from "./card";
import { stickersFor } from "./layout";

const cwd = "/Users/g/Projects/Toki";
const h = (t: string, hook_event_name: string, extra: Record<string, unknown> = {}) => ({
  t: `2026-10-03T${t}.000Z`,
  hook: { hook_event_name, session_id: "s1", cwd, permission_mode: "default", ...extra },
});

describe("shipCommand", () => {
  it("finds a push or a merge run as a command", () => {
    expect(shipCommand("git push origin main")).toBe("git push origin main");
    expect(shipCommand(`cd "${cwd}" && npm test && git push`)).toBe("git push");
    expect(shipCommand("gh pr merge 12 --squash; echo ok")).toBe("gh pr merge 12 --squash");
  });
  it("ignores it in a commit message, a grep pattern or a heredoc", () => {
    expect(shipCommand(`git commit -m "Don't git push yet"`)).toBeUndefined();
    expect(shipCommand(`grep -n 'git push' src/a.ts`)).toBeUndefined();
    expect(shipCommand(`python3 - <<'EOF'\nprint("git push")\nEOF\necho done`)).toBeUndefined();
  });
});

describe("cards", () => {
  const ms = momentsFromHooks([
    h("10:00:00", "UserPromptSubmit", { prompt: "Make the scrapbook scroll down the page", session_title: "Scrapbook rethink" }),
    h("10:00:02", "PreToolUse", { tool_name: "Bash", tool_input: { command: `cd "${cwd}" && npm test` } }),
    h("10:00:03", "PermissionRequest", { tool_name: "Bash", tool_input: { command: `cd "${cwd}" && npm test` } }),
    h("10:00:05", "TokiDecision", { tool_name: "Bash", decision: "always", who: "Toki", rule: "Bash(npm test), this project" }),
    h("10:00:06", "PostToolUse", { tool_name: "Bash" }),
    h("10:00:07", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` } }),
    h("10:00:08", "PostToolUseFailure", { tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, error: "String not found" }),
    h("10:02:00", "Stop", { last_assistant_message: "Done: it scrolls." }),
    h("10:03:00", "UserPromptSubmit", { prompt: "go", permission_mode: "auto" }),
    h("10:03:01", "PreToolUse", { tool_name: "Read", tool_input: { file_path: `${cwd}/b` }, permission_mode: "auto" }),
    h("10:13:01", "Stop", { permission_mode: "default" }),
  ]);
  const card = (kind: string) => cardFor(ms.find((m) => m.kind === kind)!);

  it("ALWAYS says who answered and the rule; commands lose their cd prefix", () => {
    expect(card("always")).toMatchObject({ headline: "Always allowed on Toki", facts: ["Rule: Bash(npm test), this project"], code: "Bash · npm test" });
  });
  it("OOPS says what failed, with the path relative to the project", () => {
    expect(card("error")).toMatchObject({ headline: "Edit failed", code: "src/a.ts\nString not found" });
  });
  it("YOLO says what it was before, how long it lasted and what ran", () => {
    expect(card("yolo").facts).toEqual(["Auto, was Manual", "1 tool call ran without asking", "On for 10 min"]);
  });
  it("a turn quotes your prompt and Claude's last words, with the work and time", () => {
    const turn = cardFor(stickersFor(ms).find((m) => m.kind === "asked")!);
    expect(turn).toMatchObject({ quote: "Make the scrapbook scroll down the page", reply: "Done: it scrolls.", facts: ["Code work", "2 tool calls", "test 1 · edit 1", "Took 2 min"] });
  });
  it("every card carries the session's title", () => {
    expect(card("yolo").foot).toContain("Scrapbook rethink");
    expect(card("error").foot).toContain("Toki");
  });
  it("durations read plainly", () => {
    expect([duration(4_000), duration(6 * 60_000), duration(80 * 60_000)]).toEqual(["4 s", "6 min", "1 h 20 min"]);
  });
});

describe("card text", () => {
  it("drops markdown marks from Claude's words", () => {
    const m = { t: 0, kind: "done" as const, face: "done", ctx: { reply: "**Round 2** is in: open `http://x` or [the page](http://y)" } };
    expect(cardFor(m).reply).toBe("Round 2 is in: open http://x or the page");
  });
});

describe("tool names", () => {
  it("reads MCP tools as server and tool", () => {
    expect(cardFor({ t: 0, kind: "error", face: "error", ctx: { tool: "mcp__Claude_Browser__browser_batch" } }).headline).toBe("Claude Browser: browser batch failed");
  });
});
