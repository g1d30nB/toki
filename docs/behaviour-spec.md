---
title: Peripheral Vision, behaviour spec
project: StackChan Robot
status: draft v0.5
updated: 2026-10-03 (web face: the "www" wave replaces the globe; subagents: spawned mini eyes; done: sparkles replace the music note)
changes_from_v0.4: Phase 1 findings on the hardware. Cowork is absent from the Buddy stream; tool types arrive near real time via Buddy; plan and auto mode come from hooks; context fill only via the status-line feed; servo noise measured and speed tokens added
changes_from_v0.3: constraints generalised beyond my desk; day boundaries (how the robot knows the day has ended and that I'm back) via a closing ritual, Mac system events and presence; NFC autonomy cards moved to "Later"; metallic and holo rarity stickers
changes_from_v0.2: sticker-bomb scrapbook replaces photo strips; visual references (folklore / street sticker art leads, pastel purikura is secondary); sticker catalogue; art pipeline; optional agent "cast"
changes_from_v0.1: face-led expression system (manpu); servos reserved for interruptions because they are loud; the scrapbook replaces the haiku zine; code / data / public split; timeline views
---

# Peripheral Vision

**The character is called Toki (時).** Toki is a play on the LLM "tokens" Claude processes. 時 (*toki*) is Japanese for "time", "hour" or "moment", which fits a companion that lives in real time alongside running agents. Before naming the repo, check the name doesn't collide with existing products.

**A Dangling String for agents.** A StackChan on the desk that makes the state of my Claude agents perceptible at the edge of attention. It asks for my eyes only when it genuinely needs me, and it keeps a scrapbook of our days together.

Values marked *(tune)* are starting points, to be set in the browser simulator and then on the device. Anything marked *(verify)* hasn't been checked on the hardware yet.

---

## 1. Thesis

Supervising agents has become an attention problem.
- Anthropic's own data: users approve 93% of permission prompts, experienced users run full auto-approve over 40% of the time, and the longest turns now run over 45 minutes.
- Approving every step is giving way to background awareness plus occasional judgement.

Weiser and Brown's Dangling String (Xerox PARC, 1995) made network traffic felt without anyone reading it. This project does the same for agents.

Three principles:

1. **Signal is continuous; state is rare.** The face carries a constant, glanceable read on what the agents are doing. The robot changes discretely only when a human decision is needed.
2. **The face carries the character; the body punctuates.** The servos are loud, so a head movement *is* an interruption. It is reserved for moments that deserve one, the way a phone vibrating is.
3. **Record the relationship, not the output.** The scrapbook is a diary of working together: waiting, struggling, shining. It is not a productivity report.

Delight is allowed only when it carries a signal.

---

## 2. Constraints from the desk

These were observed on my own set-up (photo, 23 Sept). They're written as the **typical case**: anyone using this will put it on a desk next to a laptop or under a monitor, and will have a similar view of it.

- **Placement:** on the desk surface, beside a laptop or under a monitor, face tilted up towards the user, at the bottom edge of their vision.
  - The edge of vision picks up movement and brightness well and detail and colour badly.
  - So face animation must read from **shape and motion**, not fine detail or colour.
- **Servos are loud** (confirmed on first use). Any head movement is audible across the room, and that sets the whole motion budget (§5).
- **Always plugged in** through USB-C in the base. The 550 mAh battery is effectively a UPS, and nothing depends on picking the robot up.
- **Touch surface = the face,** for everyone. On my desk it happens to sit next to my mouse hand; on others it may be on the other side or further away. The touchscreen remains the primary interaction surface regardless.
  - Targets are sized for a reach, not a resting hand.
  - Allow/deny positions can be **mirrored in settings** for left- or right-side placement *(tune)*.
  - The top-of-head touch strip is out of sight from the typical viewing angle, so it isn't a primary control.
- **Rotation arc:** all meaningful positions sit in a **±80° arc facing the user**, because the screen is unreadable beyond that. A full turn is reserved for the celebration.
- **Pitch safety:** stay within 5° to 85°. Never drive the servos to their end stops.

---

## 3. Signal model

### 3.1 Inputs

There are two sources, merged by an **agent-state layer** in the bridge on the Mac. The robot is driven only by that layer. If Anthropic changes the Buddy API, the vocabulary survives.

| Source | Covers | Gives us |
|---|---|---|
| **Hardware Buddy (BLE)** in the Claude desktop app | Claude Code Desktop. Cowork *(not seen in the stream, 1 Oct; verify per app update)* | counts of total/running/waiting (counts only, no session IDs), a one-line status message, recent transcript lines, output tokens, the approval prompt (id, tool, hint), and a turn event per message carrying its tool calls. Returns allow/deny. |
| **Claude Code hooks** | Claude Code in the terminal and in the desktop app | tool name and input before and after each call, notifications, stop and subagent-stop, session start and end, compaction, and the current `permission_mode` (plan, auto, …) on every event. A blocking hook before each tool call enables approval on the robot. |
| **Mac system events** (read by the bridge) | the computer itself | screen locked/unlocked, sleep/wake, keyboard and mouse idle time *(verify the exact macOS APIs in Phase 4)* |
| **The robot's own sensors** | the desk | presence (proximity sensor + on-device face detection), touch on the face, ambient light |

**Cowork gap (Phase 1, 1 Oct).** Two Cowork tasks produced nothing in the Buddy stream, while Claude Code sessions in the same app did. Until that changes, Cowork activity needs a Mac-side source. *(Open: look for one in Phase 4; re-test Buddy after each desktop app update.)*

**Important clarification:** the robot isn't limited to a feed from Claude. The bridge is our own software on the Mac and talks to the robot directly (Wi-Fi or USB). It can send anything it knows, and the robot can send back anything it senses or is told by touch. That is what makes explicit rituals like "close the day" possible (§3.4).

### 3.2 Derived signals

- **Activity:** which kind of tool is running (read, search, edit, run, test, web, subagent) and the call rate. These drive the working expressions. Buddy delivers the tool name near real time (a turn event per assistant message); hooks add it per session.
- **Outcome signals:** tests passed or failed, errors, retries.
- **Pressure signals:** turn length, context filling up, token spend. Buddy gives output tokens only. Context fill is available only from Claude Code's status-line feed (`context_window.used_percentage`), not from Buddy or hooks; compaction is a hook event.
- **Session identity:** each session gets a stable colour, arc position and melody. Needs hooks (`session_id`): Buddy sends counts, not sessions.
- **Mode:** plan, auto and bypass modes, from the `permission_mode` field that every hook carries. There is no mode-change event; the mode is read from the next hook.
- **Presence:** whether I'm at the desk, from the proximity sensor plus face detection on the camera, processed locally.
- **Time of day:** switches on night mode.

*Verified in Phase 1 (1 to 2 Oct): Buddy gives counts, the status line, tool names, output tokens and approvals; hooks give session identity, mode and compaction; context fill needs the status-line feed.*

### 3.3 Priority when several sessions compete

**blocked > error > done > working > idle.** The face and head show the most urgent session; the LEDs show all of them.

### 3.4 Day boundaries: away, welcome back, end of day

Inactivity in Claude alone is a weak signal: I might be reading, on a call, or away making tea. So each boundary combines signals, from weakest to strongest.

**Away (short):**
- No presence at the desk for 3 min *(tune)*, **or** the Mac locks.
- The robot goes sleepy and batches events.
- A BRB sticker is logged only if the absence lasts 10 min or more *(tune)*.

**Welcome back:**
- Triggered by the *first* of these after 30 min or more away *(tune)*:
  - presence detected (usually first: it sees me sit down before I type)
  - the Mac unlocks
  - new Claude activity
- The robot looks up with wide eyes and a "!", then shows a three-line digest of what happened while I was gone.

**End of day: explicit first, inferred as fallback.**
1. **The closing ritual (primary).** Long-press the face, and the robot asks "close the day?" with two booth-style buttons.
   - On yes: the shop shutter comes down on screen (a Tokyo shop-front shutter animation), the celebration plays if the day earned it, and today's scrapbook page is sealed.
   - Built (3 Oct): the buttons are **Not yet** and **Close**, in the Deny / Allow positions. The question gives up after 10 s *(tune)*. Earned: star eyes and sparkles for 2 s, then the shutter comes **fully** down with a hand-lettered CLOSED sign. Not earned: a yawn for 2 s, then the shutter comes **most of the way** down (80%), and the sleeping eyes peek out of the gap.
   - **A tap on the shutter reopens the day** (Gideon, 3 Oct). It keeps the day's count, so closing again the same evening is still earned; only the 02:00 rollover starts a fresh day. Approvals roll the shutter up, and it drops again once answered.
   - Closing the day is a small act of intent, like shutting a laptop lid with some ceremony. It is also the only thing that triggers the celebration spin, because a celebration needs me there to see it.
2. **Inferred close (fallback).** If I just walk away, the day closes quietly with no celebration when all of these hold:
   - no presence
   - no Claude activity
   - the Mac asleep or locked
   - for 90 min *(tune)*
   - after 18:00 (user-configurable)

   The page is sealed with a small "sleeping" sticker instead.
3. **Day rollover** for the scrapbook is at **02:00 local** (user-configurable), so late-night work belongs to the day it started in. If a day was never closed, it's sealed at rollover.
   - **Tell users.** Setup and the settings screen say this plainly, e.g. *"Toki's day ends at 2am, so late nights count as the day you started. It closes the day on its own after 6pm if you've gone."*

**Night mode** (dim, yawns, only blocked states surface) begins when the day is closed, or at a **fixed time set manually** by the user (default 19:00), whichever comes first.
- The ambient light sensor is deliberately not used for this. Desk lamps make it an unreliable read on daylight versus evening.

---

## 4. Expression system

The face is the primary channel. It's built from a small kit of parts, so there are many expressions but only a few things to draw.

### 4.1 Face parts

| Part | Variables |
|---|---|
| **Eyes** | open amount, shape (round, arc/happy, line, wide, spiral, sparkle, star), pupil position, size |
| **Eyelids** | top-lid angle (sleepy, focused, sceptical) |
| **Brows** | height, angle, per side (worried, determined, surprised, sceptical) |
| **Mouth** | line, smile, open, "o", wobble, tongue-out, pout |
| **Cheeks** | blush lines, puffed |
| **Manpu (漫符)** | overlay symbols: sweat drop, anger vein, sparkles, "?", "!", "…", "zzz", spiral, music note, speed lines, puff clouds, "www" |
| **Props** | tiny extras: fan, magnifying glass, coffee cup, sleeping cap *(use sparingly)* |

Manga's visual symbols were designed to read instantly at small sizes and a glance. They're native to kawaii and Tokyo, which ties the project to its cultural source rather than to generic emoji.

### 4.2 Expression map (first pass)

| Trigger | Expression | Loop / one-shot |
|---|---|---|
| Idle, no sessions | half-lidded, slow blinks, occasional look around | loop |
| **Reading files** | eyes scanning left and right in short sweeps | loop |
| **Searching (grep/glob)** | squint, pupils darting, small magnifying glass | loop |
| **Web search / fetch** | eyes up and out to the top-right corner, drifting left to right in time with a **"www" wave**: three hand-drawn Ws in the clear corner above the right brow, right-aligned, lifting in turn (W1, then W2 as W1 settles, then W3; 1.5 s wave + 0.5 s pause *(tune)*, lift 5 px). Each W is a four-stroke polyline with round caps, 17 px wide, stroke 3.5 px *(tune)*; on the robot, one pre-rendered W sprite pushed three times. No lens-like shapes: those belong to search. Oval eyes, open "o" mouth, one flat brow and one raised. | loop |
| **Editing / writing** | focused lids, tongue poking out at the corner | loop |
| **Running a command** | eyes follow imaginary text scrolling upwards | loop |
| **Tests running** | nervous brows, a small sweat drop appears | loop |
| **Tests pass** | **star eyes** (the eyes themselves turn to stars) and a burst of **gold** (mustard) sparkles spread round the face. Big and bold, so it can't be mistaken for done's small cream cluster. | one-shot, then back to working |
| **Tests fail / error** | spinning spiral eyes for 3 s, then > < with cross brows and a pout; held 4 s in all *(tune)* | one-shot, held longer (see rules) |
| **Retrying after an error** | determined brows, a small puff of effort | loop |
| **Subagents running** | **spawned minis**: one little face per running subagent (a pair of mini eyes with little brows), **capped at four** visible. Mini eyes are iris and pupil only (no highlight, no ring), so they read as spawn, not clones; each eye at least 14 px across (15 px *(tune)*). They land in four hand-placed spots that look scattered, close to the eyes (below and outside each eye, near the mouth, beside the left eye), each with its own slight tilt and size; clear of the brows and mouth, never overlapping the main eyes or each other. Spots are fixed per arrival order, so the face never reshuffles *(tune: miniS1..4)*. Each pops in with a squash and stretch (180 ms, staggered 70 ms when several arrive), blinks on its own timer, leans its gaze towards Toki and now and then glances at the main eyes. Toki's eyes shrink by 10% while any mini is present, and glance at each new one before settling. When a subagent finishes, its mini pops out (a small swell, then a quick shrink, 160 ms); when the last one goes, the eyes ease back to full size and the face returns to the state underneath. Minis show on any face except blocked, where the hint and buttons need the lower edge. The subagent pose (brows up a little, "o" mouth) shows while Toki is only waiting on them. Count source: Agent tool calls and their results in the Buddy stream; hooks' SubagentStart/SubagentStop in Phase 4. *(Caveat: a background subagent returns its result at once.)* | loop, per subagent |
| **Long turn (> 10 min *(tune)*)** | sweat drop grows, then the fan prop | escalating loop |
| **Context filling** | cheeks slowly puff: *full* | continuous, mapped to fill level *(depends on the status-line feed; fallback: CONTEXT FULL on compaction only)* |
| **Blocked: needs approval** | big patient eyes, brows raised, "…" | loop, plus the head moves (§5) |
| **Blocked: asked a question** | blocked's big patient eyes with one brow raised (the head-tilt *pose*), a big teal "?" badge where blocked has its "…", and one line, "Question for you in Claude" (regular weight). **Answered in Claude, never on Toki** (Gideon, 3 Oct): no buttons, taps do nothing | loop, plus the head moves |
| **Ignored for 5 min *(tune)*** | a tiny pout, then back to patient | one-shot |
| **Done** | happy arc eyes, small smile, and **sparkles**: three cream four-point stars (large 18 px, medium 13 px, small 9 px *(tune)*) in a loose cluster to the right of the right eye arc, clear of the brow and the arc. Each star has slightly concave sides and softly rounded tips (no glyph); on the robot, one pre-rendered star sprite at three scales. They pop in largest first (0 → 120% → 100% over 200 ms, staggered 120 ms), twinkle on their own periods (1.1 / 1.5 / 1.9 s, ±12%), then fade together (400 ms, stepping the colour to the navy ground) after 10 s, lingering over the next face; blocked or an error clears them at once. Stays the eyes' own shape, cream and small; tests pass changes the eyes and uses gold. | one-shot |
| **I approve** | happy squint, blush | one-shot |
| **I deny** | a respectful "oh, okay" mouth, then neutral | one-shot |
| **Tap on the face (a boop)** | surprised wide eyes (280 ms), then a giggle squint while the whole face hops three times, each hop smaller, like shoulders shaking with a laugh (7 px, 540 ms *(tune)*) | one-shot |
| **I leave the desk** (§3.4) | watches me go, then sleepy | transition |
| **Welcome back** (§3.4) | wide eyes, "!", then a greeting smile | one-shot |
| **Quiet mode** (double-tap) | eyes closed, content smile, "zZZZ" floating up the right side, small to big (Gideon, 3 Oct; was "shh") | loop for 30 min *(tune)*, or until a tap |
| **"Close the day?"** (long-press) | hopeful eyes above two booth buttons | waits for an answer |
| **Day closed, earned** | star eyes, sparkles, the shutter comes down | one-shot, plus the celebration spin |
| **Day closed, quiet** | a soft yawn, the shutter comes most of the way down (80%), sleeping eyes peeking out below | one-shot, no servo |
| **Night** | yawn, "zzz", then sleep | loop |
| **Disconnected** (no link to the Claude app for 5 s *(tune)*) | a small Bluetooth symbol with a tomato cross, top left, over any face (Gideon, 3 Oct). Top right belongs to the manpu. An approval can't arrive while it shows, so it must never go unnoticed. | loop, while the link is down |
| **Visitor wave (website)** | quick glance at the camera, eyes smile, sparkle | one-shot |

"Earned" is *(tune)*: at least one session finished that day and nothing is left blocked.

Rules:
- **Every expression must be triggered by something real.** No random emoting.
- **Loops are subtle and one-shots are bold.** One-shots last under 1.5 s *(tune)* and then settle back to the loop underneath.
  - **Exception: error holds 4 s** (3 s of spiral, then > <), because an error is worth catching at a glance (decided 3 Oct).
  - **Done's sparkles outlive the done face:** they finish their 10 s over whatever comes next, unless something urgent (blocked, error) takes over, which clears them at once.
- **Blinks, small eye movements and breathing run underneath everything,** so the face is never frozen.
- **Every expression must be recognisable in greyscale, at arm's length, from above.**

### 4.3 Session colour

Colour is a secondary cue only. Each session's colour appears on its LED dot and as a thin accent on the face (brow tint or a symbol colour). It's a small palette of 4 to 6 hues, validated on both screen and LEDs.

- **Built (3 Oct, Phase 4 step 7c):** LED dots only, one pair per active session (teal, blue, violet, pink, green, white; none amber-like, so amber stays "waiting on you"); brighter while working, faint while idle. **In use (Gideon):** at the rest angle the LEDs face away, so the dots add colour and delight but little meaning. The face accent is the place to carry session identity if it's ever needed.

---

## 5. Motion: servos only when it matters

**The servos are loud, so movement is used as the interruption itself.** Everything ambient happens on the screen, which is silent.

| Servo move | When | Detail |
|---|---|---|
| **Rise to meet my eyes** | blocked (approval or a question) | an 80 ms dip, then a slow rise at `servo.speed.rise`; 5% overshoot *(tune; the BSP's default spring doesn't overshoot, so this needs a custom spring)* |
| **Joint-attention glance** | blocked, with several sessions running | a glance towards the waiting session's arc position, then up at me: "that one, and I need you" |
| **Nod** | I approve | small, once |
| **Settle down** | the blocked state ends | slow return to rest |
| **Celebration spin** | I close the day and it was earned (§3.4) | the only full rotation |
| **Turn away slightly** | quiet mode starts | once, on entry |

- **Budget:** no servo movement at all while things are merely working. At most one or two moves per blocked event *(tune)*.
- **Everything else is simulated on screen,** including head tilts, bounces and a "looking around" drift, by moving and skewing the face.
- **Measured (2 Oct):** slower moves are quieter at peak but **never silent**: no speed rated below 2 on a 1 to 5 scale from the desk chair. Speeds up to 400 rated 2 to 3; above 600 rated 3 to 4. Pitch moves rate louder than yaw at the same speed. Slow moves last longer (speed 100: 4 s each way; 300: about 2 s).

| Token | Value | Notes |
|---|---|---|
| `servo.speed.rise` | 300 *(tune)* | BSP speed units, 0 to 1000 |
| `servo.speed.glance` | 300 *(tune)* | |
| `servo.speed.nod` | 300 *(tune)* | |
| `servo.speed.max` | 600 | never exceeded, except the celebration spin |
| `servo.rest.pitch` | 30 (3° above home) *(tune per desk)* | the held rest pose, facing the user. Home is the screen standing straight up, set per unit with `toki calibrate` (15 Oct; was 280 on a zero calibrated 28° lower) |

---

## 6. Interaction

| Gesture | Where | Meaning |
|---|---|---|
| **Tap the face** (a boop) | screen | "Seen it." Acknowledges, and opens the thought bubble into its full text. **A tap also wakes Toki** (Gideon, 3 Oct): it ends quiet mode, and on the night shutter it reopens the day. |
| **Allow / Deny targets** | screen, only while blocked | Big targets, at least 100 × 64 px *(tune)*; the face slides up to make room. |
| **Swipe the face** | screen | Cycle sessions; open today's scrapbook page on the robot. |
| **Double-tap the face** | screen | Quiet mode for 30 min *(tune)*. Only true blockers surface (errors and done are hidden too), sound is off, and the robot turns away slightly. Double-tap only starts it; a tap ends it. |
| **Long-press the face** | screen | "Close the day?" (§3.4). Held 700 ms *(tune)*; a double-tap is two taps within 350 ms *(tune)*. |

- **Touch rules (built 3 Oct):** while blocked, only Allow / Deny count, and they answer on the press. That touch is then used up, so lifting the finger can't also wake Toki or reopen the day.
| **Presence** | proximity sensor and camera | Automatic: switches between away and welcome back (§3.4). |

The NFC autonomy cards have moved to §14, "Later".

### Thought bubble

A small bubble in the corner shows a pictogram of the current activity (search, edit, terminal, web, test, thinking). Tapping it opens the Buddy status line or the tool hint as one line of text.

---

## 7. Look and feel

### 7.1 Visual references (collected 23 Sept)

**Lead reference: the folklore / street sticker sheet.**
- Dense die-cut characters with white borders.
- **Navy outlines, not black.**
- A warm, saturated palette: tomato, mustard, teal, navy, cream.
- Flat fills, big round eyes with highlights.
- Japanese folklore and street culture: kappa, tanuki, kitsune mask, shiba, wave-pattern (seigaiha) textiles.

This sits closest to the Shinjuku Studios world.

**Secondary reference: the hand-lettered sticker packs.**
- Marker lettering with attitude ("TOO HOT!!", "LEAVE ME ALONE!!").
- Speech bubbles, dripping and melting letters.
- The source for the text stickers (§9.4).

**Data-label layer: the holo-stickers-on-spec-cards reference** (`refs/holo-stickers-on-data-cards.png`).
- Clean, instrument-like data typography sits under the stickers:
  - monospace uppercase labels (INSTRUCTIONS, OUTPUT, CONFIDENCE)
  - pill tags, registration crosshairs, dot grids, barcode strips
  - distribution bars and small pie glyphs
- The layer gives the scrapbook's numbers a precise, machine voice, while the stickers stay loose and characterful on top.
- Restyle it into the lead palette (navy mono type on cream) rather than cold grey.
- **On the robot, every word is Baloo 2** (Gideon, 15 Oct: monospace didn't match the cute face). The label under the face, the approval hint, buttons, setup screens, the CLOSED sign and the pairing code are all Baloo 2 (SIL OFL), as anti-aliased M5GFX fonts: Bold and Medium at 28 and 22 px plus a digits-only Bold 54 (`firmware/fonts/make-vlw.py`). The monospace data-label voice stays in the scrapbook. The zZZZ and "?" manpu are drawings, not text, and keep their own shapes.

**Borrowed details: the pastel purikura illustration.**
- Booth UI as a reference for the approval screen: the pill-shaped スタート ("start") button makes approving feel like a small ritual.
- Sparkle-star eye highlights.
- Bubble lettering for one-shot captions.
- The full pastel palette is *not* adopted. It's Harajuku rather than Shinjuku, and too bright at the edge of vision all day.

All references are someone else's artwork. Take principles from them, never copy.

### 7.2 Face treatments to test in the simulator

- **A. Lineage.** Stack-chan's own geometry (dot eyes, line mouth), extended with brows, cheeks and manpu. Recoloured into the lead palette with navy linework.
- **B. Sticker-sheet character.** The face drawn as if it were one of the lead-reference stickers: round eyes with highlights, navy outline, warm fills.
- **C. Signage.** A pixel face with pixel manpu, in the language of Tokyo street signs and station displays.

**Starting position:** B, with A as the fallback if B is too busy at the edge of vision. Whichever wins must also work as **stickers** (§9), because the face is the scrapbook's raw material.

**Screen background:** a calm, dark navy for the everyday working face. The full graphic treatment (rays, dots, pattern, bubble lettering) is reserved for one-shot moments: done, the celebration, visitor waves. The decoration is the reward, not the resting state.

### 7.3 Screen rules

- 320 × 240, about 200 ppi, viewed from above and at an angle at the edge of vision.
- A dark ground with large, high-contrast shapes. Nothing important within 12 px of the edge *(tune)*.
- Text only when I choose to look. Minimum 20 px *(test)*; one line; never scrolling.
- Every expression must read in greyscale.
- **Edges: hybrid** (decided 3 Oct after a test on the glass).
  - Big filled shapes are plain (aliased): eyes, iris, pupils, highlights, mouth, minis. Lines are anti-aliased: brows, lids, the www, the lens rim, sparkle edges.
  - At forearm distance the 200 ppi panel hides the difference.
  - Plain fills cost about half the draw time of smooth ones, and need no pre-rendered eye images. M5GFX has no anti-aliased ellipse.

### 7.4 Screen motion tokens *(all tune)*

| Token | Value | Notes |
|---|---|---|
| `blink.interval` | random 5 to 12 s (was 2.5 to 6 s; slowed 3 Oct, it was a little distracting on the robot) | a 15% chance of a double blink |
| `blink.duration` | 120 ms | |
| `saccade.interval` | random 1 to 4 s | tiny eye shifts of 2 to 6 px, 40 ms each |
| `breath.period` | 4 s at idle, 2.5 s at peak activity | the face moves ±2 px vertically |
| `expression.transition` | 180 to 250 ms | squash and stretch on the eyes during the change |
| `oneshot.hold` | 0.8 to 1.5 s | then settles back to the loop underneath |
| `manpu.in` | pop in 120 ms with 10% overshoot | the sweat drop *slides* in instead |
| `manpu.out` | fade out 200 ms | |
| `face.tilt` (simulated) | up to ±8° skew/rotate | replaces servo tilts |
| `led.fade` | 400 ms | never snaps, except blocked, which goes still |
| `chime.max` | 2 per blocked event | never escalates beyond that |
| `sticker.slap` | 150 ms scale 1.3 → 0.95 → 1.0, 3 to 8° random rotation | when an event sticker lands on screen |
| `sticker.hold` | 1.0 s *(tune)* | |
| `sticker.peel` | 300 ms corner-curl and lift | then the sticker "flies" to today's page |

Animation principles to apply: anticipation, squash and stretch on the eyes, follow-through on the manpu, and ease-in-out everywhere. Target 30 fps.
- **Measured (3 Oct):** sending a full 320 × 240 frame to the panel takes 34 ms (SPI at 40 MHz), so full-screen redraws cap at about 29 fps whatever the drawing.
- The plan: redraw only the face region (23 ms to send), draw in internal RAM (smooth face 11 ms; PSRAM 23 ms), and overlap drawing the next frame with sending the last.
- To confirm during the port.

---

## 8. Sound

**Opt-in.** Sound is off by default. The settings screen explains what it adds in one line, so people choose knowingly: *"Hear which agent finished without looking: each one gets its own little station melody."*

- Each session gets a short **original** melody in the style of Tokyo station departure jingles, played on done. The real JR melodies are copyrighted.
- A soft chime when blocked, at most two per event.
- Tiny voice-like blips for one-shots (a giggle, "oh!") *(optional; test whether they're charming or annoying)*.
- Sound is off in quiet mode and at night.

---

## 9. The scrapbook (sticker-bomb diary)

**The agents' day and the two of us together**, kept as a highly visual scrapbook: one page per day, with stickers overlaid on a background, like a sticker-bombed laptop lid.

Context: this sits within the 2026 collage/scrapbook direction in web and editorial design (e.g. Figma's 2026 trends list "Collage": sticker graphics, torn textures, hand-drawn type). That's a nod to where the thinking comes from, not a brief.

### 9.1 What's on a page

- **Every sticker is a real moment.** The robot's actual expression at the time, or an event sticker ("SHIPPED!!", "ALL GREEN"). The 14:32 sticker is its real sweat-drop face from 14:32.
- **Layered in time order,** so later events sit on top.
- **Density is the data.** A quiet day is a sparse page; a hectic day is a dense pile of overlapping stickers. That's the Dangling String principle carried into the diary: you feel the day before you read it.
- **Data as doodles:** token usage, time waiting on me versus time I waited on it, sessions, test passes and fails. All drawn as hand-made marks (tallies, a coffee-cup gauge, a wobbly bar), not charts.
- **Data labels:** the day's numbers are set in the data-label style (§7.1), e.g. `DAY 267 · TOKENS ▮▮▮▯ · WAITED ON YOU 40 MIN · SPARKLES 6`. The labels sit under and between the stickers. The two textures together (precise machine labels, messy stickers on top) are the page's visual idea: the agents' data, annotated by a life lived around it.
  - It's a label vocabulary, not charts. No dashboard creep.
- **Captions:** hand-lettered event stickers plus a daily line such as "waited on you 40 min · sparkled 6 times · 2 spiral-eye moments". Short haiku are optional captions for notable tasks.
- **Us:** *opt-in only*, an occasional camera snap as a die-cut sticker (first approval of the day, the celebration). No photo strips.
- **Background:** a subtle pattern from the lead palette (seigaiha waves, grid or dots), dark enough for the stickers to pop.

### 9.2 Timeline views

**One scrolling diary** (rethought 4 Oct: a browser's natural direction is down, and a left-to-right day crammed the stickers). There's no Day/Week toggle.

- **Newest day first.** The last 7 days load, with "older days" on request, so the page never gets silly long.
- **One day open at a time,** newest first like the list of days (Gideon, 4 Oct): the latest hour at the top, the morning at the bottom, one band per hour.
  - Within an hour, the latest sticker comes first, in reading order (left to right, wrapping), each dropping onto the pile below. A busy hour is a taller band; density shows as length as well as pile.
  - Stretches over 30 minutes with nothing in them shrink to a one-line divider with their times.
- **The other days are strips** of their highlights: every event sticker, then the biggest turns, newest first. Seven strips fit on a screen, so the old week contact sheet lives on as the list itself.
- **A sticky rail** lists the days by week, each with a density bar, for jumping.

| Zoom | View |
|---|---|
| **Day** | the open day, with hover or tap on any sticker to see its moment |
| **Week** | the strips (built) |
| **Month** | calendar, Monday first, newest month first; each day shows its **signature face** on a density shade (built 15 Oct). Not the most frequent face, which is "running a command" every day: the face the day had most more of than the 30 days up to it (3+ moments), so it never changes once the day is over |
| **Year** | a quilt: a row per month, January to December, a patch per day with its signature face; days still to come faded (built 15 Oct). Becomes the zine cover |

All views are drawn from one **append-only event log** (time, session, event, expression, tokens) plus daily summaries. New views can be added later without losing history.

### 9.3 Private and printed

- **Private (local):** served by the bridge on the Mac (`localhost:4747`, installable as its own window). Everything: photos, project names, full haiku, per-session tokens, the sticker cards' prompts and commands. **It never leaves the Mac.**
- **No public scrapbook** (Gideon, 4 Oct). The weekly highlights published to gideonb.me are dropped, along with the publish step and its redaction rules.
- **Printed:** a monthly zine with real sticker sheets, produced through Shinjuku Studios.

**Guard-rail:** a diary, not a report. No productivity scores, no leaderboards, no "Wrapped".

### 9.4 Sticker catalogue (first pass)

**Two line styles, on purpose.** Event stickers have marker-style outlines with white die-cut borders, because they're objects stuck on the page. The robot's face and page backgrounds use the softer navy linework. Just as on a purikura strip: the picture underneath, the stamps on top.

**On the robot too.** When an event fires, its sticker slaps onto the robot's screen, holds, then peels off (§7.4) and lands on today's page. The scrapbook is literally a record of what the robot showed me.

| Sticker | Triggered by | Look |
|---|---|---|
| **SHIPPED!!** | a push or merge | bold block letters, speed lines |
| **MERGE ME** | pull request opened | speech bubble |
| **LGTM ♥** | I approve | heart with a face |
| **ALL GREEN** | tests pass | sparkles |
| **BUILD BROKEN** | tests or CI fail | broken heart |
| **MERGE CONFLICT** | a conflict | heart pierced by an arrow |
| **TOO MANY TOKENS!!** | heavy token day | dripping letters |
| **CONTEXT FULL** | the conversation gets compacted | melting heart |
| **YOUR TURN** | waited more than 5 min for me | finger pointing out of the sticker |
| **LEAVE ME ALONE!!** | quiet mode started (double-tap) | shouty lettering |
| **YOLO MODE** | auto mode or permission bypass detected (hook `permission_mode`: `auto` or `bypassPermissions`) | sunglasses |
| **PLAN MODE** | plan mode entered (hook `permission_mode`: `plan`) | sleepy cloud face |
| **CLOSED** | I close the day | the shop shutter with a hand-lettered sign |
| **zzz** | the day closed itself (inferred) | sleeping face |
| **rm -rf? NO WAY!!** | I deny a destructive command | shouty letters |
| **SUBAGENTS ×n** | a burst of subagents | little mini eyes in a row |
| **RETRY RETRY RETRY** | three attempts in a row | wobbly stacked lettering |
| **HELLO WORLD** | first session of the day | flower with a face |
| **BRB** | I leave the desk | coffee cup |
| **NEEDS REVIEW** | large diff | shy character |

Rules:
- A **fixed, hand-lettered library**, drawn once. Only numbers change, set in a matching hand-drawn typeface.
- **Tone:** cheeky, never mean. The joke lands on the situation, not on me or the agent.
- Plus the robot's own **expression stickers**, generated from the face kit (§4) with a white die-cut border.

### 9.5 Metallic and holo stickers (rarity)

Most days are plain stickers: density already carries everyday intensity. Metal marks the **outliers**, so the month view shows sparse pages, dense pages, and the occasional one that glints.

| Finish | Meaning | Threshold *(tune)* |
|---|---|---|
| **Silver** | a heavy day | top ~10% of *my* days by token use and activity |
| **Gold** | an extreme day | top ~2% of *my* days |
| **Holo rainbow** | a rare *moment*, not volume | e.g. a long autonomous run that finished green; a first ship on a project |

- **Intensity, never achievement.** Silver and gold record how intense a day was. They are not rewards for spending tokens; the "no Wrapped" guard-rail applies.
- **Relative to the user.** Thresholds are computed against a rolling 30 days of *my own* usage, never absolute token counts. A light user still gets the odd gold day, a heavy user doesn't get one every day, and it works for anyone using the open-source repo.
  - There's a warm-up: no metal until there are 14 days of history *(tune)*.
- **Scarcity is the point.** Gold appears only a few times a month at most, and holo is rarer still. If a third of pages shine, the shine means nothing.
- **Which sticker gets the finish:** the day's summary sticker becomes silver or gold. A holo finish goes on the event sticker for that moment.

**Built 15 Oct (web)** (`scrapbook/finish.ts`, tested; `Foil.tsx`):
- **Intensity** is the day's moments. Every rule looks only at the 30 days up to and including the day, so a finish never changes once the day is over. Warm-up: 14 days with activity in that window.
- **Silver:** in the top 10% of the window and at least 1.25× its median day. **Gold:** the busiest of the window and at least 1.8× its median. A steady climb gilds nothing; a light user still gets the odd gold.
- **The day's summary sticker is its signature face** (§9.2): in the open day's header, leading an outlier day's strip, and on the month and year tiles (with a metal ring).
- **Holo** goes on the sticker itself: a project's first SHIPPED ever (history before the warm-up still counts), and the turn that ran longest without needing you (no approval, no question; 40+ tool calls, about the top 1%) in its 30 days. The calendar marks a holo day with a small rainbow star.
- Metal greys or golds the sticker (CSS filter) so the foil carries the colour; the sheen and glare are masked to the die-cut and follow the pointer; reduced motion keeps them still. `?preview-finishes` turns the warm-up off for review.
- Not yet: the robot's rainbow glint (stickers don't slap onto the robot's screen yet), and true line-art foil versions of the art stickers.

**Holo and metal art is line-art only** (`refs/holo-stickers-line-art.png`). Metal versions of a sticker drop the colour fills and keep a bold outline, so the foil carries the colour, the way real spot-foil printing works. Every sticker has two versions: full colour, and outline-for-foil.

**How each medium renders it:**
- **Web:** a rainbow sheen follows the mouse or finger across the sticker. It uses layered gradients and blend modes, with light position driven by the pointer; see pokemon-cards-css by Simon Goellner for the technique. Phone tilt (gyroscope) is optional, because iOS requires a permission prompt, so pointer and touch are the default. Honour `prefers-reduced-motion` with a static sheen.
- **Robot screen:** the small screen can't really shimmer. When a metal or holo sticker slaps on, a quick rainbow glint sweeps across it (about 400 ms *(tune)*), which reads well even at the edge of vision.
- **Print:** real holographic or metallic vinyl for those stickers in the zine's sticker sheets. Check options with the Shinjuku Studios print supplier.

### 9.6 The agent cast *(parked, 24 Sept)*

The robot is the host. Each kind of work gets a character from the lead reference's folklore world, which appears as stickers and optionally as a cameo on screen:
- **kappa:** tests
- **tanuki:** search
- **kitsune:** web
- **small yokai:** subagents

A strong talking point, but significant extra drawing.

### 9.7 Art pipeline

- **Formats.** Masters are SVG, for the scrapbook web page and print. For the robot they're pre-rendered to small bitmaps, because the ESP32 can't draw complex vectors fast enough.
- **Exploration.** Replicate (recraft-v4.1-svg) for fast variations and to find the style.
- **Decision: the full sticker set is generated** with Replicate (recraft-v4.1-svg), art-directed and curated by me. I edit and assemble the results into a consistent system.
- **Ownership caveat.** Copyright in purely AI-generated images is legally uncertain.
  - The US Copyright Office requires human authorship.
  - The UK has a "computer-generated works" provision that is under review.

  Human selection, editing and arrangement strengthen any claim. Keep the edited SVG masters and a record of the edits. Check Recraft's terms for commercial and print use. *(Not legal advice; confirm before selling stickers through Shinjuku Studios.)*
- **Don't** prompt "in the style of" any reference illustrator.
- **Check** Recraft's commercial terms before anything goes to print through Shinjuku Studios.

---

## 10. Architecture

```
Claude desktop app ──BLE (Hardware Buddy)──┐
                                           ▼
Claude Code (terminal) ──hooks──► BRIDGE (Mac, always running)
                                   ├─ agent-state layer (merge, priority, modes)
                                   ├─ event log + daily summaries  → ~/StackChanData (never in git)
                                   ├─ haiku writer (Claude, small model)
                                   └─ local scrapbook server (localhost; never published)
                                           │
                                   Wi-Fi / USB
                                           ▼
                                   STACKCHAN FIRMWARE
                                   (face renderer, expressions, servos, LEDs,
                                    sound, touch, presence)

Optional hosted piece: tiny server function for live state + visitor waves.
```

### 10.1 Open-source repo

The repo contains **only the machinery**. Anyone with a StackChan clones it and gets their own diary.

```
peripheral-vision/
  firmware/        robot code
  bridge/          state layer, hooks, log, scrapbook server
  scrapbook/       page templates and timeline views
  art/             faces, manpu, stickers, pictograms
  docs/            this spec, setup guide for beginners
```

- **Personal data** lives in a separate folder on the Mac and is excluded by `.gitignore` from day one.
- **Secrets** live in a local `.env`, which is never committed.
- **Licences:** MIT for code. **All rights reserved on the art** (faces, stickers, lettering, pictograms), stated clearly in the README and in an `art/LICENSE` file. The repo can include the art so the software works out of the box, but it may not be reused, remixed or sold. This protects the Shinjuku Studios assets. See the ownership caveat in §9.7.
- **README caveat:** the Hardware Buddy API is unofficial and may break.

### 10.2 Firmware base (open decision, Phase 1)

- Port Anthropic's Arduino reference (built for the M5StickC Plus) to the CoreS3, using M5Stack's StackChan library for the servos.
- Or start from MoveCall's ESP-IDF Buddy port, which already runs on a CoreS3.

**Leaning Arduino:** simpler to follow step by step.

### 10.3 Bridge hooks (Phase 4)

How the bridge receives hooks, answers approvals and questions from the robot (including "Always allow" via `updatedPermissions`), reads the status-line feed and installs itself safely: see `docs/bridge-hooks.md` (draft, 3 Oct, from lessons in Coucou). Additive to §3.1 and §6; the blocked layout keeps two targets, with Always allow on a long-press of Allow.

### 10.4 Install and setup (Phase 7, decided 4 Oct)

Anyone who buys a StackChan can install Toki on it and on their Mac, and run it as Gideon does: Claude Code hooks, the bridge, the robot over Wi-Fi.

- **Homebrew formula in our own tap**, not a cask: `brew install g1d30nB/toki/toki`. Toki ships as scripts, a `toki` command and a background service (`brew services`), not a .app, so Gatekeeper never applies. (Homebrew's main cask repo disables casks that fail Gatekeeper from 1 Sept 2026; a menu-bar app can come later as an optional cask in the same tap.)
- **Prebuilt firmware** in the formula, flashed with esptool. Owners never need the Arduino toolchain.
- **Everything personal lives on the robot** (NVS), not in code: Wi-Fi, the link secret, servo calibration, brightness, mirrored Allow/Deny, night time, rollover. Wi-Fi and the secret go over the USB cable during setup.
- **`toki setup`** walks through it: back up the stock firmware, flash Toki, Wi-Fi and secret, calibrate the servos, install the hooks (diff, then confirm), start the service, pair Buddy in the Claude app.
- **One window** (the bridge's page, installable to the Dock): Scrapbook, Device (connection, firmware, update) and Settings.
- **Data:** each day's moments are frozen after the 02:00 rollover and kept; raw logs are deleted after 30 days (matching Claude Code's own transcript cleanup).

**The setup experience is a design deliverable, not an afterthought** (Gideon, 4 Oct). Write it like the old "for Dummies" books: the audience knows development, but some are newbie tinkerers, so it must be very, very simple, with every step explained.
- At every step say **what's going on, what just happened, and what happens next.**
- **Reassure.** It feels like you could break a £90 robot. Say plainly what can't go wrong, what can, and how to undo it (the stock backup comes first, always, and restoring it is one command).
- Check each step worked before moving on, and say so ("✓ Toki answered over Wi-Fi").
- When something fails, say what it means in plain words and the one thing to try.
- Never assume toolchain knowledge; never leave the user staring at a silent terminal.
- **Every command works from any folder** (4 Oct: a new Terminal window starts in the home folder, and a relative path failed).
- **Never reassure without checking.** "Toki is no worse off" must come from Toki confirming it, not from the plan (4 Oct: the Wi-Fi tool said it while Toki was off Wi-Fi).
- Status, proven 4 Oct: settings and Wi-Fi live on the robot; a build with no Wi-Fi details in it joins from what Toki saved.
- **Ship bottles, not just the formula** (found 10 Oct). Without a ready-made package ("bottle"), Homebrew treats installing Toki as a build and refuses unless Apple's Xcode and Command Line Tools match the macOS version; on Gideon's Mac (macOS 27, Xcode 26.3) it stopped. Many developers lag on those. Once the tap is on GitHub, its CI (`brew test-bot`) builds bottles, so strangers install without any Apple developer tools check.
- **Toki depends on keg-only `node@24`,** never plain `node`, which would change the user's own `node` for every project (found 10 Oct).

---

## 11. Phases

0. **Unbox and protect** *(evening 1)*. Set up with the stock firmware and play with it. Then back up the factory image before touching anything.
1. **See the stream** *(1 to 2 days)*. Get the Hardware Buddy data from my real Cowork sessions onto the device, unstyled, and record what actually arrives. Test servo speed against noise.
2. **Design in the browser** *(the core design phase)*. Build a 320 × 240 simulator of the face, expression system, manpu and approval screen, driven by the recorded session data. Test directions A, B and C, tune the tokens, film comparisons.
3. **Body** *(on the device)*. Port the chosen face renderer and expressions to the firmware; add servos, LEDs and touch.
4. **Bridge.** State layer, hooks, event log, priority across sessions. **Start from `docs/bridge-hooks.md`**: its §9 is the test order, and §4 to §5 add two robot screens (Always allow on a long-press of Allow; answering questions) to design in the simulator first.
5. **Scrapbook.** Local server, day and week views first, then month and year; the sticker pipeline.
6. **Delight.** Metallic and holo rarity, melodies, the closing ritual, the live wave on gideonb.me. (The weekly highlights publish was dropped, 4 Oct.)
7. **Installable** (§10.4). Settings on the robot (NVS) with Wi-Fi over USB; the `toki` command and Homebrew formula; `toki setup`, tested on a factory-reset robot; Device and Settings tabs.
8. **Live with it** for a month, then publish the repo, film it, write it up, and print the first zine.

---

## 12. Risks

- **The Hardware Buddy API is unsupported and sits behind Developer Mode.** Mitigation: the state layer, plus hooks as a second source.
- **Auto mode shrinks the number of permission prompts over time.** So the project is anchored on ambient awareness and the diary, with approval as just one state.
- **Servo noise.** Mitigation: servos are used only for interruptions; everything else is on screen.
- **Privacy:** the camera and microphone never go to a third-party cloud, and presence detection runs locally. The scrapbook stays on the Mac and is never published (4 Oct).
- **Expression overload:** a face that's always emoting becomes noise. Mitigation: subtle loops, bold one-shots, and every expression triggered by something real.
- **Scope creep.** The phases are ordered; the scrapbook doesn't start until the face and bridge work.

---

## 13. Open questions for Gideon

**Decided (24 Sept):**
- **Name:** Toki (時).
- **Sound:** opt-in, with a one-line explanation of its value.
- **Night mode:** a fixed time, set manually. No light sensor.
- **Public scrapbook:** ~~weekly highlights, approved before publishing~~. Dropped 4 Oct: the scrapbook stays private on the Mac.
- **Sticker set:** generated with Replicate (recraft-v4.1-svg), art-directed and curated.

- **Art licence:** all rights reserved on the art, MIT on the code.
- **Agent cast:** parked.
- **Default times:** day rollover at 02:00; the earliest the day can close itself is 18:00. Both are user-configurable and explained to users at setup.

**Still open:** none. The design phase is ready for Phase 0.
---

## 14. Later (parked, not in this plan)

### NFC autonomy cards

Karpathy's "autonomy slider" as a physical object: a printed deck of NFC cards, designed as art cards, possibly as a Shinjuku Studios product.
- **Plan:** agents propose and never execute.
- **Review Everything:** every tool call waits for me.
- **Trusted:** only destructive or external actions wait.
- **Focus** and **Night:** as modes on demand.

How it would work: the robot reads the card (it has an NFC reader), the state layer writes the current mode, and the blocking hook consults that mode before every tool call. It works on terminal Claude Code; its effect on the desktop Buddy path is limited *(verify)*.

Worth revisiting once the core is living on the desk.
