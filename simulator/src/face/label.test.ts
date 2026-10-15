import { describe, expect, it } from "vitest";
import { initialState } from "../state/agentState";
import { faceLabel, labelObject } from "./label";

describe("labelObject: what a tool is working on, in a few characters", () => {
  it("a command's first real step, without cd or redirections", () => {
    expect(labelObject({ name: "Bash", summary: 'cd "/x/StackChan Robot" && npx vitest run 2>&1 | grep Tests' })).toBe("npx vitest run");
    expect(labelObject({ name: "Bash", summary: "git status" })).toBe("git status");
  });
  it("a file's name, a site's host, a search in quotes", () => {
    expect(labelObject({ name: "Read", summary: "scrapbook/layout.ts" })).toBe("layout.ts");
    expect(labelObject({ name: "WebFetch", summary: "https://www.docs.m5stack.com/en/StackChan" })).toBe("docs.m5stack.com");
    expect(labelObject({ name: "Grep", summary: "faceSticker" })).toBe('"faceSticker"');
    expect(labelObject({ name: "Glob", summary: "src/**/*.ts" })).toBe('"src/**/*.ts"');
  });
});

describe("faceLabel", () => {
  const s = { ...initialState(), activity: { kind: "read" as const, tool: { name: "Read", summary: "face/render.ts" }, at: 0 } };
  it("words name the face; detail adds the object", () => {
    expect(faceLabel("read", s, "words")).toEqual({ verb: "READING" });
    expect(faceLabel("read", s, "detail")).toEqual({ verb: "READING", object: "render.ts" });
  });
  it("no label where the lower edge is taken, or Toki is resting", () => {
    for (const id of ["idle", "blocked", "asked", "quiet", "night", "boop"] as const) expect(faceLabel(id, s, "detail")).toBeNull();
    expect(faceLabel("read", s, "off")).toBeNull();
  });
  it("the web's verb shortens when a site follows", () => {
    expect(faceLabel("web", s, "words")).toEqual({ verb: "ON THE WEB" });
    expect(faceLabel("web", s, "detail", { object: "docs.m5stack.com" })).toEqual({ verb: "WEB", object: "docs.m5stack.com" });
  });
  it("no object from the next kind of work while the face catches up", () => {
    const next = { ...s, activity: { kind: "run" as const, tool: { name: "Bash", summary: "git status" }, at: 0 } };
    expect(faceLabel("read", next, "detail")).toEqual({ verb: "READING" });
    expect(faceLabel("run", next, "detail")).toEqual({ verb: "RUNNING", object: "git status" });
  });
  it("subagents are counted", () => {
    expect(faceLabel("subagent", s, "detail", { subagents: 3 })).toEqual({ verb: "3 SUBAGENTS" });
    expect(faceLabel("read", s, "detail", { subagents: 1 })).toEqual({ verb: "1 SUBAGENT" });
  });
});
