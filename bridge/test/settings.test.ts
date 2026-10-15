// Toki's settings on the bridge (Phase 7): run with `npm --prefix bridge test`.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fromOurPage, SettingsMirror, validPatch } from "../src/settings.ts";

test("a change keeps only known settings, as whole numbers in range", () => {
  assert.deepEqual(validPatch({ brightness: 90 }), { brightness: 90 });
  assert.deepEqual(validPatch({ brightness: 90, rollover: 4, wifi: "x" }), { brightness: 90, rollover: 4 });
  assert.equal(validPatch({ brightness: 5 }), null, "too dim to see the face");
  assert.equal(validPatch({ brightness: 90.5 }), null);
  assert.equal(validPatch({ rollover: 7 }), null);
  assert.equal(validPatch("brightness=90"), null);
  assert.deepEqual(validPatch({ label: 1 }), { label: 1 }, "the label under the face: off, words, detail");
  assert.equal(validPatch({ label: 3 }), null);
});

test("only Toki's own page can change settings", () => {
  const req = (host: string, origin?: string) => ({ headers: { host, origin } }) as unknown as IncomingMessage;
  assert.ok(fromOurPage(req("localhost:4747", "http://localhost:4747")));
  assert.ok(fromOurPage(req("127.0.0.1:4747", "http://localhost:5174")), "the dev preview, through its proxy");
  assert.ok(!fromOurPage(req("localhost:4747", "https://evil.example")), "another website");
  assert.ok(!fromOurPage(req("evil.example:4747", "http://evil.example:4747")), "DNS rebinding");
  assert.ok(!fromOurPage(req("localhost:4747")), "no Origin");
});

test("the bridge keeps Toki's last report, and a waiting change hears the reply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toki-settings-"));
  try {
    const file = join(dir, "settings.json");
    const s = new SettingsMirror(file);
    assert.equal(s.current, null);
    assert.equal(s.rollover(), 2);
    const reply = s.next(500);
    s.update({ brightness: 90, rollover: 3 });
    assert.deepEqual(await reply, { brightness: 90, rollover: 3 });
    assert.deepEqual(new SettingsMirror(file).current, { brightness: 90, rollover: 3 }, "survives a restart");
    s.update({ label: 1 });
    assert.equal(new SettingsMirror(file).current?.label, 1, "the label, once newer firmware reports it");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).rollover, 3);
    assert.equal(await s.next(20), null, "no reply: gives up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
