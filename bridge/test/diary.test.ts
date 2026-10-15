// The diary's three layers (spec §10.4): run with `npm --prefix bridge test`.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createDiary } from "../src/diary.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A data folder with one prompt and its finish at noon (UTC) on each given date. */
function dataFor(dates: string[]) {
  const root = mkdtempSync(join(tmpdir(), "toki-diary-"));
  roots.push(root);
  mkdirSync(join(root, "hooks"));
  mkdirSync(join(root, "recordings"));
  for (const d of dates) {
    const hook = (t: string, h: Record<string, unknown>) => JSON.stringify({ t: `${d}T${t}Z`, hook: { session_id: "s1", cwd: "/x/Toki", ...h } });
    writeFileSync(
      join(root, "hooks", `${d}.jsonl`),
      [hook("12:00:00", { hook_event_name: "UserPromptSubmit", prompt: "hi" }), hook("12:05:00", { hook_event_name: "Stop" })].join("\n") + "\n",
    );
  }
  return root;
}
const at = (iso: string) => () => Date.parse(iso);

test("a finished day is frozen; today isn't", () => {
  const root = dataFor(["2026-09-01", "2026-09-02"]);
  const diary = createDiary({ root, now: at("2026-09-02T15:00:00Z") });
  assert.equal(diary.listDays().length, 2);
  assert.ok(existsSync(join(root, "diary", "2026-09-01.json")));
  assert.ok(!existsSync(join(root, "diary", "2026-09-02.json")));
});

test("raw files over 30 days old are deleted, and the day still reads the same from its frozen copy", () => {
  const root = dataFor(["2026-09-01", "2026-10-03"]);
  writeFileSync(join(root, "hooks", "notes.txt"), "not ours");
  const before = createDiary({ root, now: at("2026-10-04T15:00:00Z") }).loadDay("2026-09-01");
  const diary = createDiary({ root, now: at("2026-10-04T15:00:00Z") });
  const removed = diary.tidy();
  assert.deepEqual(removed, [join(root, "hooks", "2026-09-01.jsonl")]);
  assert.ok(existsSync(join(root, "hooks", "2026-10-03.jsonl")), "young raw files stay");
  assert.ok(existsSync(join(root, "hooks", "notes.txt")), "files the bridge didn't write are never touched");
  // Compared as stored: JSON drops keys whose value is undefined.
  assert.deepEqual(diary.loadDay("2026-09-01"), JSON.parse(JSON.stringify(before)));
  assert.deepEqual(
    diary.listDays().map((s) => s.day),
    ["2026-10-03", "2026-09-01"],
  );
});

test("a raw file is kept if its days can't be frozen", () => {
  const root = dataFor(["2026-09-01"]);
  mkdirSync(join(root, "diary"));
  // A folder where the frozen file should go: freezing that day fails, so nothing is deleted.
  mkdirSync(join(root, "diary", "2026-08-31.json"));
  const diary = createDiary({ root, now: at("2026-10-04T15:00:00Z") });
  assert.throws(() => diary.tidy());
  assert.ok(existsSync(join(root, "hooks", "2026-09-01.jsonl")));
});

test("the day list survives with no raw files at all", () => {
  const root = dataFor(["2026-09-01"]);
  createDiary({ root, now: at("2026-10-04T15:00:00Z") }).tidy();
  assert.ok(!existsSync(join(root, "hooks", "2026-09-01.jsonl")));
  const index = JSON.parse(readFileSync(join(root, "diary", "days.json"), "utf8"));
  assert.ok(index["2026-09-01"].moments > 0);
  assert.equal(createDiary({ root, now: at("2026-10-04T15:00:00Z") }).listDays()[0].day, "2026-09-01");
});
