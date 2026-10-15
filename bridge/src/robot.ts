// The bridge's Wi-Fi link to Toki (Phase 4, step 3). Toki listens on
// toki.local:7152; this dials in, says hello with the shared link secret, then:
//   - sends the clock on connect and every 10 minutes (the 02:00 rollover, and
//     the time sync Bluetooth loses);
//   - writes everything Toki echoes (Buddy lines, its answers, its log) to
//     ~/StackChanData/recordings, in the USB recorder's format, so the simulator
//     opens them the same way. This replaces the USB recorder.
// If Toki isn't there, it retries every 5 s, quietly.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { HOME } from "./paths.ts";

const HOST = process.env.TOKI_HOST ?? "toki.local";
const PORT = 7152;
const RETRY_MS = 5_000;
const CLOCK_MS = 10 * 60_000;
const RECORDINGS = join(homedir(), "StackChanData", "recordings");
// The link secret: written by the Wi-Fi setup tool, which also saves it on Toki
// over USB (Phase 7). firmware/toki/secrets.h is the older place, still read as a
// fallback on the Mac Toki was first built on.
export const LINK_SECRET = join(homedir(), "StackChanData", "link-secret");
const SECRETS = join(HOME, "firmware", "toki", "secrets.h");
// "@@" lines are Toki talking to the bridge itself (answers to held hooks).
const TAGS: Record<string, string> = { "<< ": "rx", ">> ": "tx", "## ": "dev", "@@ ": "ctl" };

export type RobotStatus = { state: "no-secret" | "connecting" | "connected" | "retrying"; since: string; recording: string | null; lines: number };

/** The link secret: the setup tool's file first, then the old secrets.h. Read again on every reconnect. */
async function readSecret(): Promise<string | null> {
  try {
    const s = (await readFile(LINK_SECRET, "utf8")).trim();
    if (s.length >= 16) return s;
  } catch {
    // not set up with the tool: try secrets.h
  }
  try {
    const m = /#define\s+TOKI_LINK_SECRET\s+"([^"]+)"/.exec(await readFile(SECRETS, "utf8"));
    return m && !m[1].startsWith("replace-with") ? m[1] : null;
  } catch {
    return null;
  }
}

const localStamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** ISO time with the local offset, like the USB recorder's records. */
function isoLocal(d: Date) {
  const off = -d.getTimezoneOffset();
  const p = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 23);
  return `${local}${off >= 0 ? "+" : "-"}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

export class RobotLink {
  status: RobotStatus = { state: "connecting", since: new Date().toISOString(), recording: null, lines: 0 };
  private socket: Socket | null = null;
  private clock: NodeJS.Timeout | null = null;

  // Plain fields, not constructor parameter properties: Node's type stripping can't erase those.
  private readonly onLine: (dir: string, line: string) => void;
  private readonly onConnect: () => void;

  constructor(hooks: { onLine?: (dir: string, line: string) => void; onConnect?: () => void } = {}) {
    this.onLine = hooks.onLine ?? (() => {});
    this.onConnect = hooks.onConnect ?? (() => {});
  }

  /** Sends one JSON message to Toki, if it's connected. */
  send(msg: unknown) {
    if (this.status.state === "connected") this.socket?.write(JSON.stringify(msg) + "\n");
  }

  async start() {
    const secret = await readSecret();
    if (!secret) {
      if (this.status.state !== "no-secret") console.log(`robot: no link secret yet (${LINK_SECRET}); run the Wi-Fi setup. Checking again every 10 s`);
      this.set("no-secret");
      setTimeout(() => this.start(), 10_000);
      return;
    }
    this.connect(secret);
  }

  private set(state: RobotStatus["state"]) {
    if (this.status.state !== state) this.status = { ...this.status, state, since: new Date().toISOString() };
  }

  private connect(secret: string) {
    this.set(this.status.state === "connected" ? "retrying" : this.status.state);
    const s = new Socket();
    this.socket = s;
    let buf = "";
    let out: WriteStream | null = null; // one ordered stream per connection: lines stay in order
    s.setNoDelay(true);
    s.setTimeout(40_000); // Toki logs fps every 10 s, so silence this long means it's gone
    s.connect(PORT, HOST, async () => {
      s.write(JSON.stringify({ hello: "toki", secret }) + "\n");
      this.sendClock();
      this.clock = setInterval(() => this.sendClock(), CLOCK_MS);
      await mkdir(RECORDINGS, { recursive: true });
      const file = join(RECORDINGS, `${localStamp(new Date())}.jsonl`);
      out = createWriteStream(file, { flags: "a" });
      this.status = { state: "connected", since: new Date().toISOString(), recording: file, lines: 0 };
      console.log(`robot: connected to ${HOST}, recording to ${file}`);
      this.onConnect();
    });
    s.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const text = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        const dir = TAGS[text.slice(0, 3)] ?? "log";
        const line = dir === "log" ? text : text.slice(3);
        this.status.lines++;
        this.onLine(dir, line);
        out?.write(JSON.stringify({ t: isoLocal(new Date()), dir, line }) + "\n");
      }
    });
    s.on("timeout", () => s.destroy());
    s.on("error", () => {}); // "close" follows; retrying is the answer to every error
    s.on("close", () => {
      out?.end();
      out = null;
      if (this.clock) clearInterval(this.clock);
      this.clock = null;
      if (this.status.state === "connected") console.log("robot: link closed; retrying every 5 s");
      this.set("retrying");
      // Read the secret again: the Wi-Fi setup may have just made a new one.
      setTimeout(async () => this.connect((await readSecret()) ?? secret), RETRY_MS);
    });
  }

  private sendClock() {
    const now = new Date();
    this.socket?.write(JSON.stringify({ time: Math.floor(now.getTime() / 1000), offset: -now.getTimezoneOffset() }) + "\n");
  }
}
