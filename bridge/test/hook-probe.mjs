// Phase 4, step 1: a throwaway hook receiver for the bridge-down test.
// Logs every Claude Code hook it receives to ~/StackChanData/hooks/ (payloads
// carry transcript content, so never into the repo) and answers at once with an
// empty 200, which Claude Code reads as "no decision".
//
//   node bridge/test/hook-probe.mjs          answer at once
//   STALL=1 node bridge/test/hook-probe.mjs  accept and never answer (stall test)
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 7151;
const dir = join(homedir(), "StackChanData", "hooks");
mkdirSync(dir, { recursive: true });
const file = join(dir, `probe-${new Date().toISOString().slice(0, 10)}.jsonl`);
const stall = process.env.STALL === "1";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let event = "?";
    try {
      event = JSON.parse(body).hook_event_name;
    } catch {}
    appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), path: req.url, stall, body }) + "\n");
    console.log(new Date().toISOString().slice(11, 23), event, stall ? "(stalling)" : "");
    if (!stall) res.end();
  });
}).listen(PORT, "127.0.0.1", () => console.log(`hook probe on http://127.0.0.1:${PORT}${stall ? " (STALL)" : ""}, logging to ${file}`));
