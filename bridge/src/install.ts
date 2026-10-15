// Installs Toki's hooks into Claude Code's user settings (docs/bridge-hooks.md §7),
// so every session reaches the bridge, not just the sandbox.
//
//   npm --prefix bridge run hooks -- status
//   npm --prefix bridge run hooks -- install                 shows the change and a code; writes nothing
//   npm --prefix bridge run hooks -- install --confirm CODE  writes it (only if the file hasn't changed since)
//   npm --prefix bridge run hooks -- uninstall [--confirm CODE]
//   npm --prefix bridge run hooks -- sandbox                 regenerates bridge/sandbox/.claude/settings.json
//
// Rules (§1, §7): never overwrite settings that couldn't be read; back up first;
// write only the change that was shown (the code is a fingerprint of the file as
// read); touch only Toki's own entries.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE, NODE } from "./paths.ts";
import { STATUSLINE_MARKER, isToki, tokiHooks, tokiStatusLine, withToki, withoutToki } from "./hooks-config.ts";

const SETTINGS = process.env.TOKI_SETTINGS ?? join(homedir(), ".claude", "settings.json");
const SANDBOX = join(BRIDGE, "sandbox", ".claude", "settings.json");
const STATUSLINE = tokiStatusLine(NODE, join(BRIDGE, "statusline.mjs"));

type Read = { raw: string; settings: Record<string, unknown> };

/** Reads the settings safely: a BOM is stripped, a missing file is {}, anything unreadable stops everything. */
function read(path: string): Read {
  if (!existsSync(path)) return { raw: "", settings: {} };
  const raw = readFileSync(path, "utf8");
  const text = raw.replace(/^﻿/, "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
    return { raw, settings: parsed as Record<string, unknown> };
  } catch (e) {
    console.error(`Stopped: ${path} couldn't be read as JSON (${(e as Error).message}). Nothing was changed.`);
    process.exit(1);
  }
}

const code = (action: string, raw: string) => createHash("sha256").update(action).update(raw).digest("hex").slice(0, 8);
const pretty = (s: Record<string, unknown>) => JSON.stringify(s, null, 2) + "\n";

function diff(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "toki-"));
  writeFileSync(join(dir, "before.json"), before);
  writeFileSync(join(dir, "after.json"), after);
  try {
    execFileSync("diff", ["-u", "--label", `${SETTINGS} (now)`, "--label", `${SETTINGS} (after)`, join(dir, "before.json"), join(dir, "after.json")]);
    return "";
  } catch (e) {
    return String((e as { stdout?: Buffer }).stdout ?? "");
  }
}

/** What a change would do, without doing it: the diff and the code that confirms exactly this change. */
export function preview(action: "install" | "uninstall"): { nothing: boolean; diff: string; code: string; note?: string } {
  const { raw, settings } = read(SETTINGS);
  const next = pretty(action === "install" ? withToki(settings, STATUSLINE) : withoutToki(settings));
  const note =
    action === "install" && settings.statusLine && !JSON.stringify(settings.statusLine).includes(STATUSLINE_MARKER)
      ? "You already have a status line, so Toki leaves it alone (no context-fill feed)."
      : undefined;
  const before = raw ? pretty(settings) : "";
  // Formatting is normalised to 2-space JSON; the diff shows that too, if it changes anything.
  return { nothing: next === before, diff: next === before ? "" : diff(before, next), code: code(action, raw), note };
}

/** Makes the change shown by preview(), only if the file hasn't changed since (the code), after a backup. Returns what it did. */
export function apply(action: "install" | "uninstall", confirm: string): string[] {
  const { raw, settings } = read(SETTINGS);
  const next = pretty(action === "install" ? withToki(settings, STATUSLINE) : withoutToki(settings));
  if (confirm !== code(action, raw)) throw new Error(`${SETTINGS} changed since the preview, so nothing was written. Run it again to see the current change.`);
  const done: string[] = [];
  if (raw) {
    // Never overwrite an earlier backup: the first one may be the only copy of the original.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    let backup = `${SETTINGS}.toki-backup-${stamp}`;
    for (let n = 2; existsSync(backup); n++) backup = `${SETTINGS}.toki-backup-${stamp}-${n}`;
    copyFileSync(SETTINGS, backup);
    done.push(`Backed up the old settings to ${backup}`);
  }
  const tmp = `${SETTINGS}.toki-tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, SETTINGS);
  done.push(action === "install" ? `Installed Toki's hooks in ${SETTINGS}.` : `Removed Toki's hooks from ${SETTINGS}.`);
  done.push("New Claude Code sessions pick this up; sessions already open may need restarting.");
  return done;
}

/** How to run this, in the words that fit how it was started (the toki command, or npm in the repo). */
const runAs = (action: string) => (process.env.TOKI_CLI ? `toki hooks ${action}` : `npm --prefix bridge run hooks -- ${action}`);

function change(action: "install" | "uninstall", confirm: string | undefined) {
  const p = preview(action);
  if (p.note) console.log(`Note: ${p.note}`);
  if (p.nothing) {
    console.log(action === "install" ? "Toki's hooks are already installed, exactly as they should be. Nothing to do." : "No Toki hooks to remove.");
    return;
  }
  if (!confirm) {
    console.log(p.diff);
    console.log(`To ${action}, run:\n  ${runAs(action)} --confirm ${p.code}`);
    console.log(`(The code only works while ${SETTINGS} stays exactly as it is now.)`);
    return;
  }
  try {
    for (const line of apply(action, confirm)) console.log(line);
  } catch (e) {
    console.error(`Stopped: ${(e as Error).message}`);
    process.exit(1);
  }
}

function status() {
  const { settings } = read(SETTINGS);
  const hooks = (settings.hooks as Record<string, unknown[]>) ?? {};
  const want = Object.keys(tokiHooks());
  const have = want.filter((e) => (hooks[e] ?? []).some(isToki));
  const others = Object.entries(hooks).reduce((n, [, entries]) => n + (Array.isArray(entries) ? entries.filter((x) => !isToki(x)).length : 0), 0);
  console.log(`${SETTINGS}: Toki hooks on ${have.length} of ${want.length} events; ${others} other hook entr${others === 1 ? "y" : "ies"} untouched.`);
  const current = pretty(withToki(settings, STATUSLINE)) === pretty(settings);
  const sl = JSON.stringify(settings.statusLine ?? null);
  console.log(`Status line: ${sl.includes(STATUSLINE_MARKER) ? "Toki's" : settings.statusLine ? "someone else's (left alone)" : "none"}.`);
  console.log(have.length === 0 ? "Not installed." : current ? "Installed and up to date." : "Installed, but out of date: run install to update.");
}

function sandbox() {
  writeFileSync(SANDBOX, pretty({ hooks: tokiHooks() }));
  console.log(`Wrote ${SANDBOX}`);
}

// Run directly (npm run hooks, or toki hooks); imported by the toki command's setup, it does nothing by itself.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, flag, value] = process.argv.slice(2);
  const confirm = flag === "--confirm" ? value : undefined;
  if (cmd === "install" || cmd === "uninstall") change(cmd, confirm);
  else if (cmd === "status") status();
  else if (cmd === "sandbox") sandbox();
  else console.log(`Usage: ${runAs("status | install [--confirm CODE] | uninstall [--confirm CODE]")}`);
}
