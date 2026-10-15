import { describe, expect, it } from "vitest";
import { kindOf, modelName, momentsFromHooks, summariseDay, turnKind } from "./moments";

describe("kindOf: what sort of work a tool call is", () => {
  it("knows code, research, images, documents and email by the tool", () => {
    expect(kindOf("Bash", { command: "npm test" })).toBe("code");
    expect(kindOf("mcp__Claude_Browser__browser_batch")).toBe("code");
    expect(kindOf("WebSearch")).toBe("research");
    expect(kindOf("mcp__f38c9b8d__search_vercel_documentation")).toBe("research");
    expect(kindOf("mcp__5a48655d__create_predictions")).toBe("images");
    expect(kindOf("mcp__Word__By_Anthropic___create_document")).toBe("documents");
    expect(kindOf("mcp__8135d7da__create_draft")).toBe("email");
    expect(kindOf("mcp__Spark__thread")).toBe("email");
  });
  it("knows a file by its type, and leaves housekeeping out", () => {
    expect(kindOf("Write", { file_path: "/x/cover.png" })).toBe("images");
    expect(kindOf("Write", { file_path: "/x/brief.docx" })).toBe("documents");
    expect(kindOf("Write", { file_path: "/x/app.ts" })).toBe("code");
    expect(kindOf("ToolSearch")).toBeNull();
    expect(kindOf("mcp__c4b4__slack_send_message")).toBe("other");
  });
  it("a turn takes its highest kind", () => {
    expect(turnKind(new Set(["code", "research"]))).toBe("research");
    expect(turnKind(new Set(["code", "images", "email"]))).toBe("email");
    expect(turnKind(new Set())).toBe("other");
  });
  it("names models plainly", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("something-else")).toBe("something-else");
  });
});

describe("a turn learns its kind and its model", () => {
  const h = (t: string, hook_event_name: string, extra: Record<string, unknown> = {}) => ({
    t: `2026-10-15T${t}.000Z`,
    hook: { hook_event_name, session_id: "s1", cwd: "/x/Toki", ...extra },
  });
  const ms = momentsFromHooks([
    h("10:00:00", "UserPromptSubmit", { prompt: "make a sticker" }),
    h("10:00:01", "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
    h("10:00:02", "PreToolUse", { tool_name: "mcp__5a48655d__create_predictions" }),
    h("10:01:00", "Stop"),
    h("10:01:01", "TokiModel", { model: "claude-opus-5-5" }),
    h("10:02:00", "UserPromptSubmit", { prompt: "thanks" }),
    h("10:02:05", "Stop"),
  ]);
  const turns = ms.filter((m) => m.kind === "asked");
  it("by its tools, and by the transcript's model", () => {
    expect(turns[0].ctx).toMatchObject({ kind: "images", model: "claude-opus-5-5" });
    expect(turns[1].ctx?.kind).toBeUndefined(); // no tools: an answer, not work
    expect(turns[1].ctx?.model).toBeUndefined();
  });
  it("and the day counts both", () => {
    const s = summariseDay("2026-10-15", ms);
    expect(s.byKind).toEqual({ images: 1 });
    expect(s.byModel).toEqual({ "Opus 5.5": 1 });
  });
});

describe("a turn's sticker shows its kind of work", () => {
  const turn = (kind: string | undefined, n: number, detail?: string) => ({ t: 0, kind: "asked" as const, face: "run", n, detail, ctx: kind ? { kind: kind as never } : {} });
  it("images, documents and email have their own symbols; research is www", async () => {
    const { lookOf } = await import("../scrapbook/layout");
    expect(lookOf(turn("images", 3))).toEqual({ type: "symbol", kind: "frame" });
    expect(lookOf(turn("documents", 1, "done"))).toEqual({ type: "symbol", kind: "page" });
    expect(lookOf(turn("email", 4))).toEqual({ type: "symbol", kind: "envelope" });
    expect(lookOf(turn("research", 4))).toEqual({ type: "symbol", kind: "www" });
  });
  it("code keeps its activity's symbol, and a long turn keeps Toki's face", async () => {
    const { lookOf } = await import("../scrapbook/layout");
    expect(lookOf(turn("code", 4))).toEqual({ type: "symbol", kind: "terminal" });
    expect(lookOf(turn("images", 12))).toEqual({ type: "face", face: "run" });
  });
});

describe("the day you met Toki", () => {
  it("setup's TokiMet is one sticker, and no HELLO WORLD", () => {
    const ms = momentsFromHooks([{ t: "2026-10-15T10:00:00.000Z", hook: { hook_event_name: "TokiMet", session_id: "toki-setup" } }]);
    expect(ms.map((m) => m.kind)).toEqual(["met"]);
    expect(summariseDay("2026-10-15", ms).moments).toBe(1);
  });
});
