import type { ExpressionId, ManpuKind } from "./expressions";
import type { Gfx } from "./gfx";
import { mix, palette } from "./palette";

// Toki's side of setup (Phase 7; Gideon, 14 Oct: "Toki joins in"). Each screen is
// one of Toki's own faces, lifted to make room for up to two lines underneath, in
// the robot's fonts: FreeSans Bold for the title, FreeSans for the line, and the
// seven-segment digits for the pairing code. On the robot they follow real state,
// not a script: no Wi-Fi and no pairing yet says hello; joining shows while Toki
// tries a network; and so on (docs/toki-setup.md).

export type SetupScreen =
  | { screen: "hello" } // brand new: no Wi-Fi, never paired
  | { screen: "joining"; ssid: string } // trying a network from the setup tool
  | { screen: "joined"; ssid: string } // it worked (a few seconds)
  | { screen: "wifiFailed"; ssid: string } // it didn't; back to what it had (a few seconds)
  | { screen: "pairMe" } // on Wi-Fi, never paired with the Claude app
  | { screen: "pairCode"; code: string } // the passkey, while macOS asks for it
  | { screen: "pairFailed" } // the pairing didn't finish
  | { screen: "allSet" } // the first time everything's connected (a few seconds)
  | { screen: "checkHead" } // head at home (level, straight ahead): "is that right?"
  | { screen: "calibrate" } // motors off: set the head by hand
  | { screen: "calibrated" }; // saved as home (a few seconds)

export type SetupName = SetupScreen["screen"];

/** Toki's face on each screen: its own expressions, so setup already looks like Toki. */
export const SETUP_FACE: Record<SetupName, ExpressionId> = {
  hello: "approved", // the reference frame of the character: ^ ^, blush, smile
  joining: "think",
  joined: "approved",
  wifiFailed: "denied",
  pairMe: "idle",
  pairCode: "blocked", // patient round eyes, as when Toki waits for your OK
  pairFailed: "denied",
  allSet: "closed", // star eyes and sparkles, the earned close without its shutter
  checkHead: "idle", // pupils centred: looking straight out
  calibrate: "quiet", // eyes closed, content: Toki relaxes while you set its head
  calibrated: "approved",
};

/** Manpu that differ from the face's own: Wi-Fi arcs while joining, none of think's "…". */
export const SETUP_MANPU: Partial<Record<SetupName, ManpuKind[]>> = {
  joining: ["wifi"],
  joined: ["wifiOn"],
  pairCode: [],
  calibrate: [], // quiet's "zZZZ" would read as sleep, not "relax"
};

/** How far the face moves up, and how small it gets, to make room underneath. */
export function setupFrame(s: SetupScreen): { lift: number; scale: number } {
  return s.screen === "pairCode" ? { lift: 22, scale: 0.62 } : { lift: 22, scale: 1 };
}

export const SETUP_TITLE_Y = 156;
export const SETUP_LINE_Y = 190;

/** `command`: a command to type, set in monospace after the line (the data-label face, spec §7.1). */
export function setupLines(s: SetupScreen): { title: string; line?: string; command?: string } {
  switch (s.screen) {
    case "hello":
      return { title: "Hi, I'm Toki", line: "On your Mac, run", command: "toki setup" };
    case "joining":
      return { title: `Joining ${s.ssid}`, line: "A few seconds…" };
    case "joined":
      return { title: `On ${s.ssid}`, line: "Wi-Fi is done" };
    case "wifiFailed":
      return { title: `Couldn't join ${s.ssid}`, line: "Nothing changed. Try again" };
    case "pairMe":
      // The Mac shows the steps; Toki only points there (the line must stay 20 px).
      return { title: "Now pair me with Claude", line: "The steps are on your Mac" };
    case "pairCode":
      return { title: "Type this code on your Mac" };
    case "pairFailed":
      return { title: "Pairing didn't finish", line: "Click Connect again in the app" };
    case "allSet":
      return { title: "All set!", line: "Nice to meet you" };
    case "checkHead":
      return { title: "Am I looking at you?", line: "Answer on your Mac" };
    case "calibrate":
      return { title: "Set my head level", line: "Gently, facing you" };
    case "calibrated":
      return { title: "That's home now", line: "Thank you" };
  }
}

/** As the robot's fitFont: 28 px, or 22 when that doesn't fit (titles carry a network name of any length). */
function fit(g: Gfx, s: string, max: number, bold: boolean): number {
  return g.textWidth(s, 28, false, bold) <= max ? 28 : 22;
}

/** The words (and the pairing code) under the face. */
export function drawSetupChrome(g: Gfx, s: SetupScreen) {
  const { title, line, command } = setupLines(s);
  if (s.screen === "pairCode") {
    g.drawString(title, 160, 112, palette.line, fit(g, title, 296, false), "top_center", false);
    // On the robot: a digits-only cut of Baloo 2 Bold, 54 px.
    g.drawString(s.code, 160, 196, palette.line, 54, "middle_center", true);
    return;
  }
  g.drawString(title, 160, SETUP_TITLE_Y, palette.line, fit(g, title, 296, true), "top_center", true);
  const soft = mix(palette.line, palette.face, 0.3);
  if (line && command) {
    // Two pieces centred as one: the words, then the command in monospace.
    const gap = 8;
    // Both at 28 px if they fit side by side, else both at 22.
    const both = (px: number) => g.textWidth(line, px, false, false) + gap + g.textWidth(command, px, false, true);
    const px = both(28) <= 296 ? 28 : 22;
    const wl = g.textWidth(line, px, false, false);
    const x0 = 160 - both(px) / 2;
    g.drawString(line, x0, SETUP_LINE_Y, soft, px, "top_left", false);
    g.drawString(command, x0 + wl + gap, SETUP_LINE_Y, palette.line, px, "top_left", true);
  } else if (line) g.drawString(line, 160, SETUP_LINE_Y, soft, fit(g, line, 296, false), "top_center", false);
}

/**
 * The Wi-Fi mark, top right where the web's "www" sits: a dot and three arcs.
 * Joining, the arcs light up one after another like a searching signal; joined,
 * all three are lit. Unlit arcs step towards the ground (no transparency on the robot).
 */
export function drawWifi(g: Gfx, cx: number, cy: number, t: number, on: boolean, k: number) {
  if (k <= 0.05) return;
  const lit = on ? 3 : Math.floor(t / 420) % 4; // 0..3 arcs lit, then round again
  const dim = mix(palette.line, palette.face, 0.75);
  g.fillCircle(cx, cy, 3.2 * k, palette.line);
  for (let i = 0; i < 3; i++) {
    const r = (8 + i * 6.5) * k;
    g.fillArc(cx, cy, r, r + 3.6 * k, 225, 315, i < lit ? palette.line : dim);
  }
}
