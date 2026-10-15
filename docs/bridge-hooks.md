---
title: Bridge hooks (Phase 4 design)
project: StackChan Robot
status: draft, additive to behaviour spec v0.5 (§3.1, §6, §10)
updated: 2026-10-03
source: lessons from Coucou (github.com/Louis-CFM/coucou, MIT code), read 3 Oct. Every field and response shape below is taken from Coucou's code, not from Anthropic's docs: *verify each against https://code.claude.com/docs/en/hooks before building.*
---

# Bridge hooks

How the bridge (§10) receives Claude Code hooks, answers approvals and questions from the robot, and installs itself. Nothing here changes the face, the firmware or the Buddy path. It fills in the "hooks" half of §3.1.

## 1. Rules

1. **Never block Claude Code.** If the bridge is closed, slow or crashed, every hook exits at once with no output and Claude Code carries on as if Toki weren't there.
2. **Silence is the safe answer.** Anything the relay doesn't recognise prints nothing, so Claude Code falls back to asking in the terminal or the app.
3. **Never approve without a touch on the robot.** No auto-allow, no remembered answers in the bridge. "Always allow" is written by Claude Code itself (§4).
4. **Never overwrite `~/.claude/settings.json`.** Dated backup, merge, show the diff, write only after Gideon confirms. Uninstall removes only Toki's entries.
5. **Hooks carry transcript content.** Their payloads go to `~/StackChanData` like the Buddy recordings, never into the repo.

## 2. Transport

Two options. The earlier finding (CLAUDE.md, 2 Oct) favoured `"type": "http"` hooks.

| | http hooks | command relay (Coucou's way) |
|---|---|---|
| Fire-and-forget events | `"async": true`, no relay binary | relay connects in ≤ 300 ms, writes, exits |
| Approvals and questions | sync http, bridge holds the response | relay holds the socket, prints the decision |
| Bridge down | *verify:* does Claude Code fail open, and how fast? | guaranteed: connect fails, exit 0, no output |
| Payload size | whole payload | relay drops fields and truncates strings |

**Result (3 Oct, step 1): http hooks, no relay.** Tested from a desktop Code session in `bridge/sandbox/` (hooks only apply to sessions whose project is that folder) against `bridge/test/hook-probe.mjs`:

| Bridge | Effect on the session | Approval prompt |
|---|---|---|
| up, answers at once | none | normal; Buddy still delivers it to Toki |
| down (connection refused) | none ("just as fast") | normal |
| stalled (accepts, never answers) | each event waits out its timeout, then continues | **appears at once, without waiting for the hook**; the first answer wins |

- The docs agree: connection failure and non-2xx are non-blocking errors; a timed-out hook renders no decision.
- **http hooks are synchronous** (`async` is for command hooks only), so Claude waits on every event. The bridge must answer fire-and-forget events at once (reply first, process after), and their `timeout` is **1 s**, bounding a stall to about a second per event.
- **`SessionStart` doesn't support http hooks** (command and mcp_tool only). Not needed: every payload carries `session_id`, so the first event from a new id starts the session.
- **Every desktop turn ends with a `SubagentStop` the user never saw** (about 3 s after `Stop`), probably the app's own background helper. The mini count must ignore a `SubagentStop` with no matching `SubagentStart`.
- **`permission_suggestions` are objects, not rule strings**, and depend on the tool: for a Write in Manual mode it was `[{"type":"setMode","mode":"acceptEdits","destination":"session"}]` ("accept edits this session"). `tool_use_id` was null. Always allow (§4) must show what the suggestion actually does.

**Original plan:** http first, because it's simpler. The first Phase 4 test is to kill the bridge mid-session and time what Claude Code does. If http doesn't fail open within about a second, switch to a small command relay that follows Coucou's rules:
- connect budget 300 ms, whole run 2 s for fire-and-forget events;
- a deadline on the main thread, so a socket that accepts and then stalls can't wedge a session;
- drop `tool_response` and `transcript_path`, and cap every string at 2,000 characters;
- add `cwd` if missing.

## 3. Events

| Event | Timeout (s) | Waits? | Feeds |
|---|---|---|---|
| SessionEnd (SessionStart is command-only; the first event from a new `session_id` starts a session) | 1 | no | session identity and colour (§3.2, §4.3) |
| UserPromptSubmit | 1 | no | turn start, long-turn timer |
| PreToolUse, PostToolUse, PostToolUseFailure | 1 | no | activity, outcome (§3.2) |
| PreToolUse, matcher `AskUserQuestion` | 130 | **yes** | question on the robot (§5) |
| PermissionRequest | 120 | **yes** | approval on the robot (§4) |
| Notification | 1 | no | waiting for input, rate limit |
| Stop, StopFailure | 1 | no | done, error |
| SubagentStart, SubagentStop | 1 | no | mini count (§4.2, replaces the Buddy-derived count when hooks are present) |
| PreCompact, PostCompact | 1 | no | CONTEXT FULL sticker |

`permission_mode` is read from every payload (§3.2).

**Approval uses `PermissionRequest`, not a blocking `PreToolUse`.** §3.1 says "a blocking hook before each tool call". `PermissionRequest` only fires when Claude Code would have asked anyway, so tool calls that are already allowed never wait on the bridge.

## 4. Approvals, including "Always allow"

The relay or bridge holds the request until Toki answers, then returns:

- **Allow:** `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
- **Deny:** same, with `"behavior":"deny","message":"Denied on Toki"`
- **Always allow:** `behavior: allow` plus `"updatedPermissions": <the payload's permission_suggestions>`. Claude Code then writes the rule itself. This closes the open item in CLAUDE.md.
- **No answer by 110 s:** print nothing; the normal prompt takes over.

**On the robot (keeps §6 as it is).** The blocked layout stays two targets, Deny and Allow, at ≥ 100 × 64 px. **Long-press Allow** offers "Always allow?", with a second tap to confirm. A permanent rule earns a deliberate gesture, and a third button would squeeze the targets below §6's minimum. Shown only when the request came through hooks and carries `permission_suggestions`; on the Buddy path, long-press does nothing. *(Design in the simulator's approval screen; tune the hold time.)*

**Verified (3 Oct, step 4):** deny through the hook is honoured, and in a desktop session Buddy's answer lands first (the held hook is then let go). So Always allow must answer only the hook, never Buddy.

**Verify first (original notes):**
- Deny is honoured. Coucou's docs cite an upstream bug where `deny` on `PermissionRequest` was ignored (anthropics/claude-code #19298, unverified). Fallback: `PreToolUse` with `permissionDecision`.
- **Double prompts in the desktop app.** A desktop Code session would raise the same approval through Buddy *and* the hook. Test which arrives first and whether answering one clears the other. Until then the state layer treats them as one blocked state, matched by session and tool; the first answer wins and the other is dropped.

## 5. Questions (`AskUserQuestion`)

**Built (3 Oct, step 6): Toki shows that a question is waiting; you answer in Claude.** `AskUserQuestion` arrives as `PreToolUse` and as a `PermissionRequest` (whose `updatedInput.answers` could answer it), but option rows were too easy to mis-tap and a question needs reading. The bridge doesn't hold question hooks. The design below is kept for reference only.

Gives "Blocked: asked a question" (§4.2) something to do. From Claude Code 2.1.85 the tool arrives as `PreToolUse` with matcher `AskUserQuestion` (per Coucou; *verify*).

- **Input:** `tool_input.questions`, 1 to 4 questions; each has `question`, `header` (≤ 12 characters), 2 to 4 `options` (`label`, `description`) and `multiSelect`.
- **Answer:** `permissionDecision: "allow"` with `updatedInput: {questions, answers}`, where `answers` maps question text to a label (a list of labels for multi-select, from 2.1.136).
- **On the robot:** one question at a time, option labels as chips, single tap answers a single-select. Multi-select, free text and anything that doesn't fit go back to the Mac: a "Reply on Mac" chip prints nothing, and Claude Code asks there. *(Layout to design in the simulator.)*
- If the payload doesn't parse, print nothing.

## 6. Status-line feed

**Built (3 Oct, step 7b):** `bridge/statusline.mjs`, installed only where no status line exists. **The desktop app doesn't run status lines**, so context fill only arrives from terminal sessions; for desktop work, CONTEXT FULL comes from `PreCompact`. Fields confirmed in the docs: `context_window.used_percentage` (input tokens only; may be null early) and `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`).

The status-line JSON carries `context_window.used_percentage` (cheeks, §4.2) and, per Coucou, `rate_limits` with a `five_hour` window (*verify*). One relay can feed both to the bridge.

- **Usage** is logged as a pressure signal for the scrapbook (heavy days, §9.5). No new face for now.
- **The status line is a single slot.** If one is already configured, the installer wraps it (calls the existing command and passes its output through) instead of replacing it.

## 7. Installer

- A `bridge` command shows status, previews the diff and installs or uninstalls.
- **Read:** strip a UTF-8 BOM. A missing file means start from `{}`. Any other read or parse failure stops the install with a message; never write over settings that couldn't be read.
- **Merge:** for each event, remove Toki's existing entries (marked by a unique string in the command or URL) and append the new one. Other hooks are untouched.
- **Backup:** `settings.json.toki-backup-<date>` beside the original.
- **Write:** only the diff Gideon was shown (compare a fingerprint of the bytes read).

## 8. Not taken from Coucou

- Their island timers (15 s, 60 s, 3 min absence) belong to a screen overlay. Toki's presence comes from §3.4.
- Their per-agent pills for other CLIs: Toki is Claude only.
- Their macOS relay runs process lookups to find the terminal. Not needed: Toki doesn't jump to terminals.

## 9. Phase 4 test order

1. Kill-the-bridge test (§2): pick http or the relay.
2. Allow and deny from the robot on a terminal session.
3. Always allow: confirm the rule lands in settings and the next identical call doesn't ask.
4. Double prompt in a desktop Code session (§4).
5. AskUserQuestion round trip.
6. Status-line wrap with an existing status line.
