// Runs the bridge at login and keeps it running, as a macOS launch agent
// (Phase 4, step 7a). Easily undone.
//
//   npm --prefix bridge run agent -- install     writes the agent and starts it now
//   npm --prefix bridge run agent -- uninstall   stops it and removes it
//   npm --prefix bridge run agent -- status
//
// The bridge's own log goes to ~/StackChanData/logs/bridge.log (it names
// sessions and projects, so never into the repo).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { BRIDGE, DATA, HOME, NODE } from "./paths.ts";

const LABEL = "local.toki.bridge";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG = join(DATA, "logs", "bridge.log");
const DOMAIN = `gui/${userInfo().uid}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(NODE)}</string>
    <string>${esc(join(BRIDGE, "src", "server.ts"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(BRIDGE)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKI_HOME</key><string>${esc(HOME)}</string>
    <key>TOKI_NODE</key><string>${esc(NODE)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${esc(LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(LOG)}</string>
</dict>
</plist>
`;
}

const launchctl = (...args: string[]) => {
  try {
    return execFileSync("launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? "");
  }
};

const cmd = process.argv[2];
if (cmd === "install") {
  mkdirSync(dirname(LOG), { recursive: true });
  mkdirSync(dirname(PLIST), { recursive: true });
  if (existsSync(PLIST)) launchctl("bootout", `${DOMAIN}/${LABEL}`);
  writeFileSync(PLIST, plist());
  launchctl("bootstrap", DOMAIN, PLIST);
  console.log(`Installed ${PLIST}: the bridge now starts at login and restarts if it stops.`);
  console.log(`Its log: ${LOG}`);
  console.log("If a bridge is already running in a Terminal window, close it: the agent takes over within 30 s.");
} else if (cmd === "uninstall") {
  launchctl("bootout", `${DOMAIN}/${LABEL}`);
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.log("Removed the login agent; the bridge is stopped. Start it by hand with: npm --prefix bridge start");
} else if (cmd === "status") {
  const out = launchctl("print", `${DOMAIN}/${LABEL}`);
  const state = /state = (\w+)/.exec(out)?.[1];
  const pid = /pid = (\d+)/.exec(out)?.[1];
  console.log(existsSync(PLIST) ? `Login agent installed; ${state ? `state ${state}${pid ? `, pid ${pid}` : ""}` : "not loaded"}.` : "Login agent not installed.");
} else {
  console.log("Usage: npm --prefix bridge run agent -- install | uninstall | status");
}
