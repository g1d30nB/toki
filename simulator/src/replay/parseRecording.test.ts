import { describe, expect, it } from "vitest";
import { parseRecording } from "./parseRecording";

const rec = (t: string, dir: string, line: string) => JSON.stringify({ t: `2026-10-02T09:00:${t}+01:00`, dir, line });

describe("parseRecording", () => {
  const text = [
    rec("00.000", "dev", "ble connected"),
    rec("00.500", "rx", '{"cmd":"status"}'),
    rec("01.000", "rx", '{"total":2,"running":1,"waiting":1,"msg":"approve: Bash","entries":["x"],"tokens":10,"tokens_today":20,"prompt":{"id":"p","tool":"Bash","hint":"ls"}}'),
    rec("02.000", "tx", '{"cmd":"permission","id":"p","decision":"once"}'),
    rec("03.000", "rx", '{"evt":"turn","role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test\\nmore"}}]}'),
    rec("04.000", "dev", "repeat 12"),
    "{torn line",
  ].join("\n");

  it("normalises events with times relative to the start", () => {
    const r = parseRecording("x.jsonl", text);
    expect(r.events.map((e) => e.kind)).toEqual(["device", "snapshot", "decision", "turn", "repeat"]);
    expect(r.events[1]).toMatchObject({ t: 1000, waiting: 1, tokensToday: 20, prompt: { id: "p" } });
    expect(r.events[3]).toMatchObject({ t: 3000, tools: [{ name: "Bash", summary: "npm test" }] });
    expect(r.durationMs).toBe(4000);
  });
});
