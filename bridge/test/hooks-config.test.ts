// Toki's entries in Claude Code's settings: run with `npm --prefix bridge test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tokiStatusLine, withToki, withoutToki } from "../src/hooks-config.ts";

const line = tokiStatusLine("/opt/homebrew/opt/node@24/bin/node", "/opt/homebrew/opt/toki/libexec/bridge/statusline.mjs");
const mine = {
  permissions: { allow: ["Bash(ls)"] },
  hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
  model: "opus",
  theme: "dark",
};

test("installing twice changes nothing, and the settings keep their order", () => {
  const once = withToki(mine, line);
  assert.deepEqual(Object.keys(once), ["permissions", "hooks", "model", "theme", "statusLine"]);
  const twice = withToki(once, line);
  assert.equal(JSON.stringify(twice), JSON.stringify(once), "an install with nothing to do must be a no-op, byte for byte");
  assert.deepEqual(Object.keys((twice.hooks as object) ?? {}).slice(0, 1), ["Stop"], "existing hook events keep their place");
});

test("uninstalling leaves the person's own entries exactly as they were", () => {
  assert.deepEqual(withoutToki(withToki(mine, line)), mine);
});
