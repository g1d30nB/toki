# `toki setup`: the guided first run (Phase 7, step 3)

Draft for review, 14 Oct 2026. The design brief is spec §10.4: written like the
old "for Dummies" books. Every step says what's going on, what just happened and
what happens next; it checks each step worked; it reassures, because hardware
feels breakable; failures are explained in plain words with one thing to try.

## Who it's for

Someone who has just bought a StackChan K151, has a Mac with the Claude desktop
app, and has run `brew install g1d30nB/toki/toki`. Probably a developer; possibly
a newbie tinkerer. Either way, they've never flashed a robot.

## How it behaves

- **One command, run again any time.** Every stage first checks whether it's
  already done and, if so, says "✓ already done" and moves on. Stopping half-way
  (Ctrl+C, a closed lid, a lunch break) is always safe; running `toki setup`
  again picks up where it left off. No hidden state file: the checks are the state.
- **Nothing is written without a yes.** The robot, `~/.claude/settings.json` and
  the login agent are each changed only after the stage says what will change and
  the person agrees.
- **The way back comes first.** The factory backup is stage 2, and nothing that
  writes to the robot runs without it.
- **Numbered stages, always visible:** "Stage 3 of 7 · Putting Toki on the robot".
- **About 15 minutes,** said up front, with a time on each stage.

## The stages

### 0 · Welcome

> Hello. This sets up Toki: the firmware on your StackChan, the link to this Mac,
> and the connection to Claude. It takes about 15 minutes.
>
> You'll need: the robot and its USB-C cable · your Wi-Fi name and password (Toki
> uses 2.4 GHz Wi-Fi) · the Claude desktop app.
>
> Nothing here can break your robot. The first thing we do is copy its factory
> firmware to this Mac, and `toki restore` puts it back exactly as it came.
> You can stop at any time (Ctrl+C) and run `toki setup` again to carry on.

### 1 · Finding the robot (under a minute)

Plug in; Toki appears as `/dev/cu.usbmodem…`.
- Not found: "Some USB-C cables only charge and can't carry data. If the robot's
  screen is on but this Mac can't see it, try another cable." (A real trap.)
- Something else holds the port (a recorder, an upload): say what and how to stop it.
- Reports what's on the robot: **factory firmware**, **Toki x.y** (older, same or
  newer), or **something else**.

### 2 · Backing up the factory firmware (about 3 minutes)

Skipped if a 16 MB backup already exists. Reads only; changes nothing. Saved to
`~/StackChanData/firmware-backup/` with a checksum. Ends with: "Keep a second copy
somewhere safe (a password manager or cloud drive)."

### 3 · Putting Toki on the robot (about 1 minute)

Skipped if the robot already runs this version. Says what's kept (anything Toki
saved: Wi-Fi, settings, pairing) and how to undo (`toki restore`). Asks; flashes
the four parts; waits for Toki to answer over USB, so success is confirmed, not
assumed. The robot's own screen takes over from here (see decision 3).

### 4 · Wi-Fi (about 1 minute)

Asks Toki over USB what it's on. If it's joined and this Mac shares the network:
✓ done. Otherwise the Wi-Fi flow from `toki wifi` (try first, keep only if joined,
fall back otherwise), then **the same-network check** (lesson of 14 Oct): compare
Toki's address with this Mac's. If they differ:

> Toki is on "MyHomeWiFi", and this Mac is on a different network. They need to
> share one: switch this Mac's Wi-Fi to "MyHomeWiFi", or give Toki this Mac's
> network (if it's 2.4 GHz).

### 5 · Starting the bridge (under a minute)

Installs the login agent and waits up to 30 s for it to find Toki over Wi-Fi.
"The bridge is a small program on this Mac that connects Claude, Toki and the
scrapbook. It starts by itself when you log in."

### 6 · Connecting Claude Code (under a minute)

Shows exactly what will be added to `~/.claude/settings.json` (Toki's hooks; a
backup is made first; nothing else is touched) and asks. Skippable, with the
consequence said plainly: "Without this, Toki still follows the Claude desktop app
over Bluetooth, but can't offer Always allow or fill the scrapbook's details."

### 7 · Pairing with the Claude desktop app (about 2 minutes)

The one stage done by hand, in the app. Numbered steps, with what you'll see:
the passkey appears on Toki's face; type it into the Mac's prompt. Setup watches
for the pairing to complete and confirms it. The known trap, said in advance: "If
Connect does nothing, quit the Claude app completely (Cmd+Q) and open it again."

### 9 · Your scrapbook (under a minute)

Added 15 Oct: the scrapbook makes itself, so this is where a new owner learns it
exists. Two lines on what it is (a diary of your days with Claude, in stickers,
that fills itself and never leaves this Mac), the address, "Open it now? [Y/n]",
then how to give it its own window: Safari's File, then Add to Dock (macOS 14+;
older Macs are told to bookmark it), or Chrome's install icon. Setup logs the day
you met Toki once (`TokiMet`, marker `~/StackChanData/met`), so day one's page
opens with a NICE TO MEET YOU sticker and a welcome line instead of zeros.

### Done

> ✓ Toki is set up. Try it: ask Claude Code to edit a file. Toki's face changes
> as Claude works, and if Claude needs your OK, Toki looks up and asks.
>
> `toki open` shows the scrapbook (in Safari: File, then Add to Dock, gives it its
> own window). `toki status` tells you how everything is, any time.

## What the build needs (not visible to the person)

- Toki reports its **firmware version** and its **Bluetooth pairing state** in the
  USB `{"setup": "status"}` reply (the release build stamps the version in).
- The Wi-Fi flow moves into the `toki` command (shared with `toki wifi`).
- A **test on a factory-reset robot**: `toki restore` (Gideon's backup), then
  `toki setup` from stage 1, then back to his Toki. A fresh macOS user account
  stands in for a stranger's Mac (empty home folder, no hooks, no data).

## Decisions for Gideon

**Decided 14 Oct: all four as recommended** (terminal first; hooks skippable;
Toki joins in on its own screen, built as a second batch, simulator first; no
calibration in v1).

1. **Terminal or browser?** Recommended: terminal first. It works everywhere and
   is the most robust, and the robot's own screen carries the friendly part
   (decision 3). A browser walkthrough with photos (where the USB port is, what the
   reset button looks like) is friendlier for newcomers but needs its own small
   server before the bridge exists. Could come later as an illustrated guide page.
2. **Hooks: required or skippable?** Recommended: strongly suggested, skippable.
3. **Toki joins in.** Recommended: yes. After the flash, the robot's screen shows
   setup from its side: a first-boot face ("Hi, I'm Toki"), "Waiting for Wi-Fi",
   the pairing passkey (already exists), and a happy face when setup completes. It
   makes the moment feel like meeting a character, not configuring a device.
4. **Servo calibration.** Gideon's unit came with its head zero far off (45° read
   as nearly straight up). Recommended: leave it out of v1 setup; add a `toki
   calibrate` later if other units need it, once there's a second robot to compare.
