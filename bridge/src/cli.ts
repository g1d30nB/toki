// toki: one command for everything Toki (Phase 7, spec §10.4). Installed by
// Homebrew; in the repo, run it with `node bridge/src/cli.ts`.
//
// Written for the setup brief: every command says what it's about to do, checks
// it worked, and ends with the one next thing to do. Anything that writes to the
// robot asks first, and says how to undo it. Works from any folder.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces, userInfo } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { apply as applyHooks, preview as previewHooks } from "./install.ts";
import { BRIDGE, DATA, HOME, NODE } from "./paths.ts";

const VERSION = JSON.parse(readFileSync(join(BRIDGE, "package.json"), "utf8")).version as string;
const FIRMWARE = join(HOME, "firmware", "bin"); // the prebuilt firmware, in a release
const BACKUPS = [join(DATA, "firmware-backup"), join(HOME, "firmware", "stock-backup")];
const FLASH_BYTES = 16 * 1024 * 1024; // the CoreS3's 16 MB flash
const AGENT = "local.toki.bridge";
const LINK_SECRET = join(DATA, "link-secret"); // shared with the robot; the bridge reads it (robot.ts)
process.env.TOKI_CLI = "1"; // so the hooks installer words its advice as `toki hooks …`

/** Inside `toki setup`, a failed step is retried by running setup again (it skips what's done). */
let inSetup = false;
// "this": the command as typed (toki wifi, toki flash, …).
const retry = (cmd: string) => (inSetup ? "toki setup" : cmd === "this" ? `toki ${process.argv.slice(2).join(" ")}`.trim() : cmd);

// ---------------------------------------------------------------------------
// Saying things
// ---------------------------------------------------------------------------
const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c("1");
const dim = c("2");
const green = c("32");
const amber = c("33");
const say = (s = "") => console.log(s);
const ok = (s: string) => say(`  ${green("✓")} ${s}`);
const no = (s: string) => say(`  ${amber("✗")} ${s}`);
const maybe = (s: string) => say(`  ${dim("–")} ${s}`);
const next = (s: string) => {
  if (!inSetup) say(`\n${bold("Next:")} ${s}\n`); // setup says what's next itself
};
const title = (s: string, what?: string) => {
  if (inSetup) return; // setup's stage heading stands in
  say(`\n${bold(s)}`);
  if (what) say(dim(what));
};
/** Stops with what went wrong and the one thing to try. */
function stop(what: string, fix: string): never {
  say();
  no(what);
  say(`  ${fix}\n`);
  process.exit(1);
}

/** The answer, or "" if input ends first (Ctrl+D, or nothing attached): no answer counts as no. */
function answerOf(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.once("close", () => resolve(""));
    rl.question(question).then(resolve, () => resolve(""));
  });
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await answerOf(rl, question)).trim();
  rl.close();
  return answer;
}

/**
 * A question whose answer isn't shown as it's typed (a Wi-Fi password). Keys are
 * read one by one with the terminal's echo off: muting readline instead first
 * wiped the question off the screen, then, fixed, still echoed what was typed
 * (both found 15 Oct). Return ends it, Backspace works, Ctrl+C stops toki.
 */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(""); // piped in: nothing to hide
  return new Promise((resolve) => {
    let typed = "";
    const finish = (value: string) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish(typed); // Return, or Ctrl+D
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n\n  Stopped. Nothing was sent to Toki.\n\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else if (ch >= " ") typed += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function confirm(question: string, word = "y"): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await answerOf(rl, `\n  ${question} `)).trim().toLowerCase();
  rl.close();
  return word === "y" ? answer === "y" || answer === "yes" : answer === word;
}

// ---------------------------------------------------------------------------
// Finding things
// ---------------------------------------------------------------------------
const have = (cmd: string) => spawnSync("/usr/bin/which", [cmd], { encoding: "utf8" }).status === 0;

function usbPort(): string | null {
  const ports = readdirSync("/dev").filter((f) => f.startsWith("cu.usbmodem"));
  return ports.length ? join("/dev", ports.sort()[0]) : null;
}

function needPort(): string {
  const port = usbPort();
  if (!port)
    stop(
      "Toki isn't showing up on USB.",
      `Plug the USB-C cable into the socket in Toki's base and into this Mac, then run ${retry("this")} again.\n  Some USB-C cables only charge and can't carry data: if Toki's screen is on but this Mac can't see it, try another cable.`,
    );
  return port;
}

/**
 * Who has Toki's USB cable open, in plain words, and how to free it. esptool only
 * says "Invalid head of packet" (found 14 Oct: a `toki wifi` from an hour before
 * was still waiting at its question in another window).
 */
function portHolder(port: string): { what: string; fix: string } | null {
  const pids = spawnSync("lsof", ["-t", port], { encoding: "utf8" })
    .stdout.split("\n")
    .filter((p) => p && Number(p) !== process.pid);
  if (!pids.length) return null;
  const cmd = spawnSync("ps", ["-o", "args=", "-p", pids.join(",")], { encoding: "utf8" }).stdout;
  if (/cli\.ts (wifi|setup)|toki-wifi\.py|toki-usb\.py/.test(cmd))
    return {
      what: "another toki command, probably a `toki wifi` or `toki setup` still waiting at a question in another Terminal window",
      fix: "Find that window and press Ctrl+C there. It hasn't changed anything on Toki.",
    };
  if (/record-stream\.py/.test(cmd)) return { what: "the stream recorder", fix: "Press Ctrl+C in the window where it's recording." };
  if (/esptool|arduino-cli/.test(cmd)) return { what: "a flash or upload that's still running", fix: "Let it finish, or press Ctrl+C in its window." };
  if (/serial-monitor|monitor|screen|minicom/.test(cmd)) return { what: "a serial monitor", fix: "Close it (the Arduino Serial Monitor, or Ctrl+C in its window)." };
  const name = cmd.trim().split("\n")[0].split(" ")[0].split("/").pop() || "unknown";
  return { what: `another program (${name}, process ${pids[0]})`, fix: `Close it. If you can't find it, this stops it:  kill ${pids[0]}` };
}

/** Stops, in plain words, if something else has the cable. */
function needPortFree(port: string, cmd: string) {
  const h = portHolder(port);
  if (h) stop(`Something else is using Toki's USB cable: ${h.what}.`, `${h.fix}\n  Then run  ${retry(cmd)}  again.`);
}

function needEsptool() {
  if (!have("esptool")) stop("esptool isn't installed (it talks to the robot's chip).", "Install it with:  brew install esptool");
}

function backups(): string[] {
  const out: string[] = [];
  for (const dir of BACKUPS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".bin") && statSync(join(dir, f)).size === FLASH_BYTES) out.push(join(dir, f));
  }
  return out;
}

async function bridgeStatus(): Promise<{ online: boolean; settings: { brightness: number; rollover: number; label?: number } | null } | null> {
  try {
    const r = await fetch("http://127.0.0.1:4747/api/settings", { signal: AbortSignal.timeout(1500) });
    return await r.json();
  } catch {
    return null;
  }
}

function agentRunning(): boolean {
  return spawnSync("launchctl", ["print", `gui/${userInfo().uid}/${AGENT}`], { stdio: "ignore" }).status === 0;
}

function hooksInstalled(): boolean {
  try {
    return readFileSync(join(homedir(), ".claude", "settings.json"), "utf8").includes("127.0.0.1:7151");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Talking to the robot over USB (Phase 7). One line down, one answer back, via a
// small Python helper: opening the port safely needs pyserial.
// ---------------------------------------------------------------------------
type RobotStatus = {
  result: string;
  firmware?: string; // missing on firmware before 0.1.0's setup support
  bluetooth?: "paired" | "connecting" | "pairing" | "waiting";
  head?: { yaw: number; pitch: number; calibrating: boolean }; // tenths of a degree from home
  status: { source: string; ssid: string; wifi: string; ip?: string; bridge: boolean; setup: string };
};

function python(): [string, string[]] | null {
  if (process.env.TOKI_PYTHON) return [process.env.TOKI_PYTHON, []];
  if (have("uv")) return ["uv", ["run", "--quiet", "--with", "pyserial", "python3"]];
  return null;
}

/** Asks Toki something over USB. null: no answer (not Toki, or not ready). "busy": something else has the port. */
function usb(port: string, msg: object, wait = 4): RobotStatus | null | "busy" {
  const py = python();
  if (!py) stop("Can't find the Python that talks to Toki over USB.", "Reinstall Toki with Homebrew (brew reinstall toki), which brings it along.");
  const r = spawnSync(py[0], [...py[1], join(BRIDGE, "tools", "toki-usb.py"), port, JSON.stringify(msg), String(wait)], { encoding: "utf8" });
  if (r.status === 3) return "busy";
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout.trim().split("\n").pop() ?? "");
  } catch {
    return null;
  }
}

function askRobot(port: string, msg: object = { setup: "status" }, wait = 4): RobotStatus | null {
  // macOS lets two programs open the cable at once, so a second one doesn't fail:
  // it garbles the conversation. Check first.
  needPortFree(port, "this");
  const r = usb(port, msg, wait);
  if (r === "busy") {
    needPortFree(port, "this");
    stop("Something else is using Toki's USB cable.", `Usually the stream recorder or an upload. Stop it (Ctrl+C in its window), then run ${retry("this")} again.`);
  }
  return r;
}

/** True if this Mac has an address on the same network as `ip` (each interface's own netmask). */
function sameNetwork(ip?: string): boolean {
  if (!ip) return false;
  const num = (a: string) => a.split(".").reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const mask = num(i.netmask);
      if (((num(i.address) & mask) >>> 0) === ((num(ip) & mask) >>> 0)) return true;
    }
  return false;
}

/** The link secret this Mac shares with the robot: the saved one, or a new one (saved only once Toki has it). */
function macSecret(): string {
  try {
    const s = readFileSync(LINK_SECRET, "utf8").trim();
    if (s.length >= 16) return s;
  } catch {
    // none yet
  }
  return randomBytes(32).toString("base64url");
}

function saveSecret(secret: string) {
  mkdirSync(DATA, { recursive: true });
  chmodSync(DATA, 0o700);
  writeFileSync(LINK_SECRET, secret + "\n", { mode: 0o600 });
  chmodSync(LINK_SECRET, 0o600);
}

function firmwareParts() {
  const parts = { bootloader: "toki.ino.bootloader.bin", partitions: "toki.ino.partitions.bin", bootApp: "boot_app0.bin", app: "toki.ino.bin" };
  const paths = Object.fromEntries(Object.entries(parts).map(([k, f]) => [k, join(FIRMWARE, f)])) as Record<keyof typeof parts, string>;
  return Object.values(paths).every(existsSync) ? paths : null;
}

const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, TOKI_HOME: HOME, TOKI_NODE: NODE, ...env } }).status ?? 1;

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------
async function status() {
  title(`Toki ${VERSION}`, "How everything is, right now. Nothing here changes anything.");
  const bridge = await bridgeStatus();
  say(`\n${bold("On this Mac")}`);
  if (bridge) ok("The bridge is running (it connects Claude Code, Toki and the scrapbook).");
  else no("The bridge isn't running.");
  if (agentRunning()) ok("It starts by itself when you log in.");
  else maybe("It doesn't start by itself at login yet.");
  if (hooksInstalled()) ok("Claude Code tells Toki what it's doing (Toki's hooks are installed).");
  else maybe("Claude Code isn't connected to Toki yet (no hooks).");

  say(`\n${bold("The robot")}`);
  if (bridge?.online) ok(`Toki is connected over Wi-Fi. Brightness ${Math.round(((bridge.settings?.brightness ?? 140) / 255) * 100)}%.`);
  else if (bridge) no("Toki isn't connected over Wi-Fi.");
  else maybe("Can't tell: the bridge isn't running.");
  const port = usbPort();
  // Plugged in? Ask Toki itself why not (found 14 Oct: two home networks).
  const robot = !bridge?.online && port ? usb(port, { setup: "status" }, 3) : null;
  if (robot && robot !== "busy") {
    const st = robot.status;
    if (st.wifi === "up" && !sameNetwork(st.ip)) say(`    Toki is on "${st.ssid}", and this Mac is on a different network. They need to share one.`);
    else if (st.wifi !== "up") say(`    ${st.ssid ? `Toki can't reach "${st.ssid}" right now.` : "Toki has no Wi-Fi yet."}  toki wifi  fixes that.`);
  }
  const holder = port ? portHolder(port) : null;
  if (port && holder) maybe(`Toki is plugged in by USB (${port}), but the cable is in use by ${holder.what}.`);
  else if (port) ok(`Toki is plugged in by USB (${port}).`);
  else maybe("Toki isn't plugged in by USB. That's fine day to day; it's needed for flashing and Wi-Fi setup.");
  const saved = backups();
  if (saved.length) ok(`The factory firmware is backed up (${basename(saved[0])}), so you can always go back.`);
  else maybe("The factory firmware isn't backed up yet. `toki backup` does it.");

  say(`\n${bold("Your scrapbook")}`);
  if (bridge) ok(`At ${SCRAPBOOK}  (toki open opens it).`);
  else maybe(`At ${SCRAPBOOK} once the bridge is running.`);
  say(`  ${dim(`Logs, recordings and the diary are in ${DATA}. They never leave this Mac.`)}`);

  if (!bridge && !backups().length) next("set everything up, step by step, with  toki setup");
  else if (!bridge) next("start the bridge with  toki start");
  else if (!hooksInstalled()) next("connect Claude Code with  toki hooks install");
  else if (!bridge.online) next("give Toki its Wi-Fi with  toki wifi  (Toki plugged in by USB)");
  else next("open the scrapbook with  toki open");
}

async function open() {
  if (!(await bridgeStatus())) stop("The bridge isn't running, so there's nothing to open.", "Start it with:  toki start");
  execFileSync("open", [SCRAPBOOK]);
  ok("Opened Toki's scrapbook in your browser.");
  say(dim(`  It's at ${SCRAPBOOK}. Its own window, in Safari: File, then Add to Dock.`));
}

function start() {
  title("Starting the bridge", "It runs in the background, starts by itself when you log in, and restarts if it ever stops.");
  run(NODE, [join(BRIDGE, "src", "agent.ts"), "install"]);
}

function stopBridge() {
  title("Stopping the bridge", "Toki keeps working over Bluetooth with the Claude app; the scrapbook and Wi-Fi link pause. `toki start` brings it back.");
  run(NODE, [join(BRIDGE, "src", "agent.ts"), "uninstall"]);
}

function hooks(args: string[]) {
  if (!args.length) args = ["status"];
  run(NODE, [join(BRIDGE, "src", "install.ts"), ...args]);
}

/**
 * Gives Toki its Wi-Fi over USB (shared by `toki wifi` and setup's stage 4). Toki
 * tries the new network first and keeps it only once it has joined; otherwise it
 * goes back. Toki and this Mac must share a network (found 14 Oct), so that's
 * checked both before and after.
 */
async function wifiFlow(port: string) {
  const r = askRobot(port);
  if (!r)
    stop(
      "Toki didn't answer over USB.",
      `If its face is on screen, unplug the cable, plug it back in and run ${retry("this")} again. If not, it may need Toki's firmware:  ${retry("toki flash")}`,
    );
  const st = r.status;
  if (st.wifi === "up" && sameNetwork(st.ip)) {
    ok(`Toki is on "${st.ssid}", and this Mac is on the same network.`);
    if (inSetup) return;
    if (!(await confirm("Give Toki a different network anyway? [y/N]"))) return say("\n  Nothing changed.\n");
  } else if (st.wifi === "up") {
    no(`Toki is on "${st.ssid}", but this Mac is on a different network.`);
    say("    They need to share one. Either switch this Mac's Wi-Fi to that network, or give Toki this Mac's network (2.4 GHz only).");
    for (;;) {
      const a = await ask(`\n  Switched this Mac to "${st.ssid}"? Press Return to check, or type n to give Toki a different network: `);
      if (a.toLowerCase() === "n") break;
      await sleep(3000); // a moment for the Mac to get its address
      if (sameNetwork(st.ip)) {
        ok(`This Mac and Toki now share "${st.ssid}".`);
        return;
      }
      no("This Mac still isn't on Toki's network.");
    }
  } else if (st.ssid) {
    maybe(`Toki knows "${st.ssid}" but can't reach it right now.`);
  } else {
    maybe("Toki doesn't have any Wi-Fi yet.");
  }

  say(dim("\n    Toki only uses 2.4 GHz Wi-Fi. Routers often give the 2.4 and 5 GHz networks different names."));
  const name = (await ask(st.ssid ? `  Wi-Fi name [Return for "${st.ssid}"]: ` : "  Wi-Fi name (capitals matter): ")) || st.ssid;
  if (!name) stop("No Wi-Fi name given.", `Run ${retry("toki wifi")} again and type the network's name exactly.`);
  const pass = await askHidden("  Password (nothing shows as you type, on purpose): ");
  // An empty answer is almost always a slip of the Return key, not an open network (found 15 Oct).
  if (!pass && !(await confirm(`No password: is "${name}" an open network, with no password at all? [y/N]`)))
    stop("No password given, so nothing was sent to Toki.", `Run ${retry("toki wifi")} again and type the password when it asks.`);
  if (pass && (pass.length < 8 || pass.length > 63)) stop("That password can't be right: Wi-Fi passwords are 8 to 63 characters.", `Run ${retry("toki wifi")} again and retype it.`);
  const secret = macSecret(); // keep the one in use, so nothing has to reconnect twice

  say(dim(`\n    Toki is trying "${name}" now (up to 25 seconds). Its face carries on as normal.`));
  const sent = askRobot(port, { setup: "wifi", ssid: name, pass, secret });
  if (!sent || sent.result !== "saved") stop("Toki turned those details down.", "The name must be 1 to 32 characters and the password 8 to 63. Run it again.");
  let now: RobotStatus | null = sent;
  const end = Date.now() + 40_000;
  while (now?.status.setup === "trying" || (!now && Date.now() < end)) {
    if (Date.now() > end) break;
    await sleep(1500);
    now = askRobot(port, { setup: "status" }, 2) ?? now;
  }
  const result = now?.status.setup;
  if (result !== "saved") {
    const why: Record<string, [string, string]> = {
      "no-network": [`Toki can't see a network called "${name}".`, "Check the name (capitals matter) and that it's a 2.4 GHz network."],
      refused: [`"${name}" turned Toki away.`, "The password is probably wrong: retype it."],
      timeout: [`Toki couldn't join "${name}" within 25 seconds.`, "The password may be wrong, or the network may be 5 GHz only."],
    };
    const [what, fix] = why[result ?? ""] ?? [`Toki didn't confirm it joined "${name}".`, "Try again; if it keeps happening, restart Toki first."];
    say();
    no(what);
    say(`    ${fix}`);
    // Only say Toki is back once Toki says so (lesson of 4 Oct); and only say "back
    // to the Wi-Fi it had" if it had one (found 15 Oct).
    if (!st.ssid) say(dim("    Toki still has no Wi-Fi, so nothing changed."));
    else {
      let back = false;
      for (let i = 0; i < 15 && !back; i++) {
        await sleep(2000);
        back = askRobot(port, { setup: "status" }, 2)?.status.wifi === "up";
      }
      say(
        back
          ? dim(`    Toki went back to "${st.ssid}", so it's no worse off.`)
          : amber(`    Toki is going back to "${st.ssid}" but hasn't reconnected yet. If it isn't back in a minute, unplug it and plug it in again.`),
      );
    }
    stop("Toki's Wi-Fi didn't change.", `Run ${retry("toki wifi")} again when you're ready.`);
  }
  saveSecret(secret);
  ok(`Toki joined "${name}" as ${now?.status.ip}, and saved it on itself.`);
  ok(`This Mac keeps the link secret that lets only it talk to Toki (${LINK_SECRET}, readable only by you).`);
  if (!sameNetwork(now?.status.ip))
    no(`This Mac isn't on "${name}", so the two can't talk yet. Switch this Mac's Wi-Fi to "${name}".`);
}

async function wifi() {
  title("Toki · Wi-Fi", "Saves your Wi-Fi on Toki itself, over the USB cable. Your password is never shown, logged or kept on this Mac.");
  await wifiFlow(needPort());
  next("check everything with  toki status");
}

/** True once a backup exists; false if the person said not now. */
async function backup(): Promise<boolean> {
  title("Back up the factory firmware", "A complete copy of the robot's 16 MB memory, as it came from the box. With it you can always put Toki back the way it was.");
  const saved = backups();
  if (saved.length) {
    ok(`There's already a backup: ${saved[0]}`);
    next("nothing. Keep that file safe (a second copy somewhere, like your password manager, is wise).");
    return true;
  }
  needEsptool();
  const port = needPort();
  const dir = BACKUPS[0];
  const file = join(dir, `stackchan-stock-${new Date().toISOString().slice(0, 10)}.bin`);
  say(`\n  This only reads from the robot; it changes nothing. It takes a few minutes.`);
  say(dim(`  The copy goes to ${file}`));
  needPortFree(port, "toki backup");
  if (!(await confirm("Start the backup? [y/N]"))) {
    say("\n  Stopped. Nothing was read or changed.\n");
    return false;
  }
  mkdirSync(dir, { recursive: true });
  if (run("esptool", ["--port", port, "--baud", "921600", "read-flash", "0", String(FLASH_BYTES), file]) !== 0)
    stop("The backup didn't finish.", `Check the cable is firmly in, then run  ${retry("toki backup")}  again.`);
  if (statSync(file).size !== FLASH_BYTES) stop("The backup is the wrong size, so it can't be trusted.", `Run  ${retry("toki backup")}  again.`);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(`${file}.sha256`, `${sha}  ${basename(file)}\n`);
  ok(`Backed up: ${file} (16 MB, checked)`);
  if (inSetup) say(dim("    Keep a second copy somewhere safe, like a password manager or cloud drive."));
  next("keep a second copy of that file somewhere safe, then  toki flash");
  return true;
}

/** True once the firmware is written; false if the person said not now. */
async function flash(fresh = false): Promise<boolean> {
  title("Put Toki on the robot", "This writes Toki's firmware onto the robot's chip, over the USB cable.");
  const parts = firmwareParts();
  if (!parts) stop("This copy of Toki has no prebuilt firmware in it.", "That's normal in the repo: flash with arduino-cli there. Installed with Homebrew, run  brew reinstall toki");
  needEsptool();
  if (!backups().length) stop("The factory firmware isn't backed up yet, and that backup is your way back.", `Run  ${retry("toki backup")}  first (it only reads; a few minutes).`);
  const port = needPort();
  say(`\n  ${bold("What happens:")} the robot restarts into a special mode, the new firmware is written`);
  say("  (about a minute), and it restarts as Toki.");
  if (fresh) say(`  ${bold("First time:")} this robot hasn't had Toki before, so there's nothing of Toki's to keep.`);
  else say(`  ${bold("What's kept:")} everything Toki has saved (its Wi-Fi, settings and Bluetooth pairing).`);
  say(`  ${bold("If you want to undo it:")}  toki restore  puts the factory firmware back.`);
  needPortFree(port, "toki flash");
  if (!(await confirm("Write Toki to the robot now? [y/N]"))) {
    say("\n  Stopped. Nothing was changed.\n");
    return false;
  }
  // Four parts at their own addresses, never the merged image: that would wipe the
  // part of memory where Toki keeps its Wi-Fi, settings and pairing.
  const code = run("esptool", [
    ...["--chip", "esp32s3", "--port", port, "--baud", "921600", "--before", "default-reset", "--after", "hard-reset"],
    ...["write-flash", "-z", "--flash-mode", "keep", "--flash-freq", "keep", "--flash-size", "keep"],
    ...["0x0", parts.bootloader, "0x8000", parts.partitions, "0xe000", parts.bootApp, "0x10000", parts.app],
  ]);
  if (code !== 0)
    stop(
      "The flash didn't finish.",
      `Nothing is broken: run  ${retry("toki flash")}  again. If the robot seems stuck, hold its reset button for 2 seconds (green light), then retry.`,
    );
  ok("Toki is on the robot. It's restarting now; its face appears in a few seconds.");
  next("if this is Toki's first time, give it your Wi-Fi with  toki wifi");
  return true;
}

// ---------------------------------------------------------------------------
// The head (Phase 7, found 15 Oct: after a factory restore the head rested tilted
// up and off-centre). Toki looks at "home"; you say whether that's level and
// facing you; if not, its motors switch off, you set the head by hand, and Toki
// saves that as home. Toki switches its motors back on by itself after 3 minutes
// if the Mac goes quiet, so they're never left off.
// ---------------------------------------------------------------------------
const deg = (tenths: number) => `${(tenths / 10).toFixed(1)}°`;

async function calibrateFlow(port: string) {
  // "Home" is level: the screen upright, facing forward. Toki's resting pose looks up
  // at you from there. Asking for "level and looking at you" mixed the two, and the
  // head was saved aimed at Gideon's eyes, about 34° too high (found 15 Oct).
  say(dim("  Toki is turning to its home position: level, with its screen standing straight up. Watch its head."));
  if (!askRobot(port, { setup: "calibrate", step: "home" })) stop("Toki didn't answer over USB.", `Run ${retry("toki calibrate")} again.`);
  await sleep(2500);
  for (let attempt = 1; ; attempt++) {
    if (
      await confirm(
        "Is Toki's screen standing straight up (not tilted back or forward), and facing straight ahead (not turned to one side)? [y/n]",
      )
    ) {
      askRobot(port, { setup: "calibrate", step: "resume" });
      ok("The head is right. Toki rests just a touch above this (3°), looking out at you.");
      return;
    }
    if (attempt > 3) {
      askRobot(port, { setup: "calibrate", step: "resume" });
      stop("Still not right after three goes.", `That's fine: run  toki calibrate  any time to try again. Toki works as it is meanwhile.`);
    }
    say("\n  Let's set it by hand. When you answer y, Toki's motors switch off and its head moves freely.");
    say(`  ${bold("Don't move the head until then:")} while the motors are on, it resists (that's normal).`);
    say(`  When they let go, the head may tip back. Set it so ${bold("the screen stands straight up")}, facing straight`);
    say("  ahead. Never force it.");
    if (!(await confirm("Ready for Toki to let go? [y/N]"))) {
      askRobot(port, { setup: "calibrate", step: "resume" });
      say("\n  Nothing changed. Run  toki calibrate  whenever you like.\n");
      return;
    }
    askRobot(port, { setup: "calibrate", step: "release" });
    await ask(`\n  Set the head and ${bold("keep holding it there")}, then press Return with your other hand. `);
    const saved = askRobot(port, { setup: "calibrate", step: "save" });
    if (!saved) stop("Toki didn't answer, so the position wasn't saved.", `Its motors come back on by themselves within 3 minutes. Run ${retry("toki calibrate")} again.`);
    ok(`Saved as home${saved.head ? ` (Toki measured ${deg(saved.head.yaw)} across, ${deg(saved.head.pitch)} up: about zero is right)` : ""}.`);
    say(dim("  You can let go now. Toki settles for a moment, then comes back to home so you can check."));
    await sleep(2500);
    askRobot(port, { setup: "calibrate", step: "home" });
    await sleep(2500);
  }
}

async function calibrate() {
  title("Toki's head", "Checks that Toki's head looks straight at you when it should, and sets it if not.");
  await calibrateFlow(needPort());
  next("nothing. Toki's head is set.");
}

// ---------------------------------------------------------------------------
// toki setup: the guided first run (docs/toki-setup.md). Nine stages; each checks
// whether it's already done first, so running setup again is always safe and
// carries on where it stopped. Nothing is written without a yes.
// ---------------------------------------------------------------------------
const STAGES = 9;
function stage(n: number, name: string, time: string, what: string) {
  say(`\n${bold(`Stage ${n} of ${STAGES} · ${name}`)}  ${dim(time)}`);
  say(dim(`  ${what}`));
}

/** Waits for Toki to answer over USB (after a flash or a restart). */
async function waitForRobot(port: string, seconds: number): Promise<RobotStatus | null> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const p = usbPort() ?? port; // the port can come back under a new name
    const r = usb(p, { setup: "status" }, 2);
    if (r && r !== "busy") return r;
    await sleep(2000);
  }
  return null;
}

async function setup() {
  inSetup = true;
  say(`\n${bold("Hello. Let's set up Toki.")}`);
  say("This puts Toki's firmware on your StackChan, links it to this Mac, and connects it to Claude.");
  say("It takes about 15 minutes.\n");
  say(`${bold("You'll need:")} the robot and its USB-C cable · your Wi-Fi name and password (Toki uses`);
  say("2.4 GHz Wi-Fi) · the Claude desktop app.\n");
  say(`${bold("Nothing here can break your robot.")} First we copy its factory firmware to this Mac, and`);
  say("`toki restore` puts it back exactly as it came. You can stop at any time (Ctrl+C) and run");
  say("`toki setup` again: it skips whatever is already done.");
  await ask(dim("\nPress Return to start. "));

  // 1 -------------------------------------------------------------------------
  stage(1, "Finding the robot", "under a minute", "Toki talks to this Mac over the USB-C cable for the first steps.");
  let port = needPort();
  let robot = askRobot(port);
  ok(`Found the robot on ${port}.`);
  if (!robot) maybe("It's running its factory firmware (or something other than Toki). That's expected the first time.");
  else ok(`It's running Toki${robot.firmware ? ` ${robot.firmware}` : " (an early build)"}.`);

  // 2 -------------------------------------------------------------------------
  stage(2, "Backing up the factory firmware", "about 3 minutes", "A complete copy of the robot's memory, as it came from the box: your way back.");
  if (!(await backup())) return say(dim("  Run  toki setup  when you're ready; it picks up here.\n"));

  // 3 -------------------------------------------------------------------------
  stage(3, "Putting Toki on the robot", "about 1 minute", "Writes Toki's firmware onto the robot's chip.");
  if (robot?.firmware === VERSION) ok(`Toki ${VERSION} is already on the robot.`);
  else {
    if (robot) say(`  The robot has Toki ${robot.firmware ?? "(an early build)"}; this Mac has ${VERSION}.`);
    if (!(await flash(!robot))) return say(dim("  Run  toki setup  when you're ready; it picks up here.\n"));
    say(dim("  Waiting for Toki to start up and answer…"));
    robot = await waitForRobot(port, 40);
    if (!robot) stop("Toki was written, but hasn't answered yet.", "Wait until its face appears, then run  toki setup  again.");
    port = usbPort() ?? port;
    ok(`Toki ${robot.firmware ?? ""} answered. Its face is on the robot now.`);
  }

  // 4 -------------------------------------------------------------------------
  stage(4, "Checking the head", "about a minute", "Every StackChan's head is set up slightly differently at the factory. Toki checks it looks straight at you.");
  await calibrateFlow(port);

  // 5 -------------------------------------------------------------------------
  stage(5, "Wi-Fi", "about 1 minute", "Toki and this Mac talk over Wi-Fi from now on, so they need to share a network.");
  await wifiFlow(port);

  // 6 -------------------------------------------------------------------------
  stage(6, "Starting the bridge", "under a minute", "A small program on this Mac that connects Claude, Toki and the scrapbook. It starts by itself when you log in.");
  if (agentRunning()) ok("The bridge is already running, and starts at login.");
  else {
    run(NODE, [join(BRIDGE, "src", "agent.ts"), "install"]);
    if (!agentRunning()) stop("The bridge didn't start.", "Run  toki setup  again; if it keeps happening,  toki status  shows more.");
  }
  say(dim("  Waiting for the bridge to find Toki over Wi-Fi…"));
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    found = (await bridgeStatus())?.online === true;
    if (!found) await sleep(2000);
  }
  if (!found) {
    // Toki is on this Mac's network but the bridge can't get in: the link secret
    // differs (a new Mac, or a lost file). Give Toki this Mac's.
    const st = askRobot(port)?.status;
    if (st?.wifi === "up" && sameNetwork(st.ip)) {
      say(dim("  Toki and the bridge don't share a link secret yet; giving Toki this Mac's…"));
      const secret = macSecret();
      if (askRobot(port, { setup: "secret", secret })?.result === "saved") saveSecret(secret);
      for (let i = 0; i < 15 && !found; i++) {
        await sleep(2000);
        found = (await bridgeStatus())?.online === true;
      }
    }
  }
  if (!found) stop("The bridge can't reach Toki over Wi-Fi.", "Check  toki status  (are they on the same network?), then run  toki setup  again.");
  ok("The bridge found Toki over Wi-Fi.");

  // 7 -------------------------------------------------------------------------
  stage(7, "Connecting Claude Code", "under a minute", "Claude Code tells Toki what it's doing, so Toki can follow along, ask for your OK and fill the scrapbook.");
  const change = previewHooks("install");
  const settingsFile = join(homedir(), ".claude", "settings.json");
  // Already connected, but through another copy of Toki (a project folder, an older install): say so (found 14 Oct).
  const elsewhere = hooksInstalled();
  if (change.nothing) ok("Claude Code is already connected to Toki.");
  else {
    if (elsewhere) {
      ok("Claude Code is already connected to Toki, through another copy of Toki (a project folder or an older install).");
      say(`  Switching it to this copy changes only Toki's entries in ${settingsFile}, after a backup. The exact change:`);
    } else {
      say(`  This adds Toki's hooks to ${settingsFile}. Only Toki's own entries`);
      say("  change, and a backup of the file is made first. The exact change:");
    }
    say(dim(change.diff.split("\n").map((l) => `    ${l}`).join("\n")));
    if (change.note) maybe(change.note);
    if (await confirm(elsewhere ? "Switch it to this copy of Toki? [y/N]" : "Connect Claude Code to Toki? [y/N]")) {
      for (const line of applyHooks("install", change.code)) ok(line);
    } else if (elsewhere) {
      maybe("Kept as it is. Everything carries on working as before.");
    } else {
      maybe("Skipped. Toki still follows the Claude desktop app over Bluetooth, but can't offer Always allow or fill in");
      say(dim("    the scrapbook's details. Any time later:  toki hooks install"));
    }
  }

  // 8 -------------------------------------------------------------------------
  stage(8, "Pairing with the Claude desktop app", "about 2 minutes", "The Claude app talks to Toki over Bluetooth. This one is done by hand, in the app.");
  robot = askRobot(port);
  if (robot?.bluetooth === "paired") ok("Toki is already paired with the Claude app.");
  else {
    say("  In the Claude desktop app:");
    say("    1. Help, then Troubleshooting, then Enable Developer Mode (once only).");
    say("    2. Developer, then Open Hardware Buddy…");
    say(`    3. Click Connect, and pick ${bold("Claude-Toki")} from the list.`);
    say("    4. Toki shows a 6-digit code on its face: type it into the Mac's prompt.");
    say("       (macOS may also ask to allow Bluetooth for Claude: allow it.)");
    say(dim("\n  If Toki isn't in the list, wait 30 seconds and click Connect again. Still not there? Check System"));
    say(dim("  Settings, Privacy & Security, Bluetooth: Claude must be on. If Connect does nothing at all, quit the"));
    say(dim("  Claude app completely (Cmd+Q) and open it again."));
    say(dim("  Waiting for the pairing (up to 5 minutes)…"));
    let shownCode = false;
    const end = Date.now() + 5 * 60_000;
    while (Date.now() < end) {
      robot = askRobot(port, { setup: "status" }, 2);
      if (robot?.bluetooth === "paired") break;
      if (robot?.bluetooth === "pairing" && !shownCode) {
        shownCode = true;
        say("  Toki is showing the code now. Type it into the Mac's prompt.");
      }
      await sleep(2000);
    }
    if (robot?.bluetooth !== "paired") stop("The pairing hasn't finished yet.", "That's fine: run  toki setup  again when you're ready; everything else is done.");
    ok("Toki is paired with the Claude app.");
  }

  // Toki says so too: "All set!" and a happy wiggle of the head (Gideon, 14 Oct).
  askRobot(port, { setup: "done" });
  const firstMeeting = rememberMeeting();

  // 9 -------------------------------------------------------------------------
  // The scrapbook makes itself; this is where a new owner learns it exists (15 Oct).
  stage(9, "Your scrapbook", "under a minute", "A diary of your days with Claude, in stickers. It fills itself as you work, and it never leaves this Mac.");
  say("  Every time you ask Claude something, a sticker lands on today's page. The moments that matter get");
  say("  stickers of their own: a push, an error, a long wait for your OK, the day you close.");
  if (firstMeeting) say(`  Today's page already has one: ${bold("NICE TO MEET YOU")}, the day you met Toki.`);
  say(`\n  It's always at  ${bold(SCRAPBOOK)}  while the bridge runs.`);
  const answer = (await ask("\n  Open it now? [Y/n] ")).trim().toLowerCase();
  if (answer === "" || answer.startsWith("y")) {
    execFileSync("open", [SCRAPBOOK]);
    ok("Opened in your browser.");
  }
  say(`\n  ${bold("Give it its own window")}, so it lives in your Dock like an app:`);
  if (macMajor() >= 14) say("    Safari: File, then Add to Dock, then Add. Toki's face appears in the Dock.");
  else say("    Safari: bookmark it (Cmd+D). (Add to Dock needs macOS 14 or later.)");
  say("    Chrome: the install icon at the right of the address bar, then Install.");
  say(dim("  From then on, click Toki in the Dock. Any time, in Terminal:  toki open"));

  // Done -----------------------------------------------------------------------
  say(`\n${green(bold("✓ Toki is set up."))}  ${dim("(Toki is saying hello.)")}`);
  say("\nTry it: ask Claude Code to edit a file. Toki's face changes as Claude works, and if");
  say("Claude needs your OK, Toki looks up and asks.\n");
  say("  toki open     the scrapbook");
  say("  toki status   how everything is, any time\n");
}

const SCRAPBOOK = "http://localhost:4747";

/** macOS's major version (14 = Sonoma), or 0 if it can't be read. */
function macMajor(): number {
  try {
    return parseInt(execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * The day you met Toki, for the scrapbook's NICE TO MEET YOU sticker: logged once
 * ever, into today's hooks log as the bridge writes it (UTC day), with a marker so
 * running setup again doesn't meet Toki twice. Returns true the first time.
 */
function rememberMeeting(): boolean {
  const marker = join(DATA, "met");
  if (existsSync(marker)) return false;
  const now = new Date();
  const hooks = join(DATA, "hooks");
  mkdirSync(hooks, { recursive: true });
  appendFileSync(join(hooks, `${now.toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ t: now.toISOString(), hook: { hook_event_name: "TokiMet", session_id: "toki-setup" } }) + "\n");
  writeFileSync(marker, `${now.toISOString()}\n`);
  return true;
}

async function restore() {
  title("Put the factory firmware back", "This writes your backup over the whole robot, as it came from the box. Toki and everything it saved are erased.");
  const saved = backups();
  if (!saved.length) stop("There's no backup to restore.", "If you never made one, M5Burner can reinstall the official StackChan firmware.");
  needEsptool();
  const port = needPort();
  say(`\n  Backup: ${saved[0]}`);
  needPortFree(port, "toki restore");
  if (!(await confirm('Type "restore" to go ahead:', "restore"))) return say("\n  Stopped. Nothing was changed.\n");
  if (run("esptool", ["--chip", "esp32s3", "--port", port, "--baud", "921600", "write-flash", "0x0", saved[0]]) !== 0)
    stop("The restore didn't finish.", "Run  toki restore  again; the backup file is untouched.");
  ok("The factory firmware is back. The robot restarts as a stock StackChan.");
  next("nothing. To come back to Toki later:  toki flash");
}

function help() {
  say(`\n${bold(`toki ${VERSION}`)}  ${dim("a desk robot that shows what your Claude agents are doing")}\n`);
  const rows: [string, string][] = [
    ["setup", "Set everything up, step by step. Safe to run again: it skips what's done."],
    ["status", "How everything is: the bridge, the robot, Claude Code. Changes nothing."],
    ["open", "Open the scrapbook and settings."],
    ["", ""],
    ["backup", "Copy the robot's factory firmware to this Mac (do this first)."],
    ["flash", "Put Toki's firmware on the robot, over USB."],
    ["wifi", "Give Toki your Wi-Fi, over USB."],
    ["hooks install", "Connect Claude Code to Toki (shows the change and asks first)."],
    ["calibrate", "Check Toki's head looks straight at you, and set it if not."],
    ["start", "Run the bridge now and at every login."],
    ["", ""],
    ["stop", "Stop the bridge (Toki carries on over Bluetooth)."],
    ["hooks uninstall", "Disconnect Claude Code from Toki."],
    ["restore", "Put the factory firmware back on the robot."],
  ];
  for (const [cmd, what] of rows) say(cmd ? `  toki ${cmd.padEnd(16)} ${dim(what)}` : "");
  say(`\n${dim("Not sure where you are? Start with  toki status")}\n`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "setup":
    await setup();
    break;
  case "status":
    await status();
    break;
  case "open":
    await open();
    break;
  case "start":
    start();
    break;
  case "stop":
    stopBridge();
    break;
  case "hooks":
    hooks(rest);
    break;
  case "wifi":
    await wifi();
    break;
  case "backup":
    await backup();
    break;
  case "calibrate":
    await calibrate();
    break;
  case "flash":
    await flash();
    break;
  case "restore":
    await restore();
    break;
  case "version":
  case "--version":
    say(`toki ${VERSION}`);
    break;
  case undefined:
  case "help":
  case "--help":
    help();
    break;
  default:
    say(`\n  "${cmd}" isn't a toki command.`);
    help();
    process.exit(1);
}
