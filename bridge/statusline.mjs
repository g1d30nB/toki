#!/usr/bin/env node
// Toki's status line (Phase 4, step 7b). Claude Code runs this on every update with
// the session's status as JSON on stdin. It passes that to the bridge (context
// fill and rate limits, for the "cheeks puff as context fills" face later) and
// prints a short line. Never waits on the bridge: a 300 ms budget, then it gives up
// silently, so the status line is never slow and never breaks if the bridge is down.

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  let d = {};
  try {
    d = JSON.parse(input);
  } catch {}
  const pct = d.context_window?.used_percentage;
  const model = d.model?.display_name ?? "Claude";
  process.stdout.write(`${model} · ${pct == null ? "–" : Math.round(pct)}% context`);
  try {
    await fetch("http://127.0.0.1:7151/statusline", { method: "POST", body: input, signal: AbortSignal.timeout(300) });
  } catch {}
});
