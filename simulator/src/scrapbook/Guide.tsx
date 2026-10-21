import { useEffect, useRef, useState } from "react";
import { renderCell } from "../dev/capture";
import { Gfx } from "../face/gfx";
import { FaceRenderer } from "../face/render";
import { defaultTokens } from "../face/tokens";
import { initialState } from "../state/agentState";
import type { ExpressionId } from "../face/expressions";
import type { Lab } from "../face/render";
import type { Moment, MomentKind, WorkKind } from "../state/moments";
import type { Finish } from "./Foil";
import { StickerArt } from "./Sticker";
import type { SymbolKind } from "./stickers";

// The guide (Gideon, 4 Oct): what each face and sticker means, in the rail. For the
// first days with Toki ("what's the sweaty one?"), and for reading the scrapbook.
// Every thumbnail is drawn by the robot's own face renderer, so it matches the glass.

/** `whole`: show the whole screen, not just the face (the link icon sits in the corner). */
type Entry = { id: ExpressionId; name: string; means: string; atMs?: number; lab?: Partial<Lab>; whole?: boolean };
const crop = (e: Entry): [number, number, number, number] => (e.whole ? [0, 0, 320, 240] : [24, 6, 272, 204]);

const FACES: { group: string; entries: Entry[] }[] = [
  {
    group: "While Claude works",
    entries: [
      { id: "idle", name: "Idle", means: "Nothing running. Content, slow blinks." },
      { id: "think", name: "Thinking", means: "Claude is answering without tools." },
      { id: "read", name: "Reading", means: "Reading files: eyes sweep side to side." },
      { id: "search", name: "Searching", means: "Grep or glob: a magnifier, darting eyes." },
      { id: "edit", name: "Editing", means: "Writing a file: a smile, tongue out of one side." },
      { id: "run", name: "Running a command", means: "Eyes follow text scrolling up." },
      { id: "test", name: "Testing", means: "Tests running: worried mouth, a sweat drop." },
      { id: "web", name: "On the web", means: "Searching or fetching: the www wave." },
      { id: "subagent", name: "Subagents", means: "One mini face per subagent, up to four.", lab: { subagents: 3 } },
    ],
  },
  {
    group: "Needs you",
    entries: [
      { id: "blocked", name: "Needs your OK", means: "Waiting for approval. Allow or Deny on the screen; the head rises." },
      { id: "asked", name: "A question for you", means: "Answer it in Claude: Toki has no buttons for questions." },
    ],
  },
  {
    group: "Moments",
    entries: [
      { id: "done", name: "Done", means: "A turn finished: happy arcs, three sparkles." },
      { id: "error", name: "Something failed", means: "Spiral eyes, then cross. Held for 4 s." },
      { id: "approved", name: "You approved", means: "Eyes squeezed shut, a big smile." },
      { id: "denied", name: "You denied", means: "“Oh, okay.” Then back to work." },
      { id: "boop", name: "Boop", means: "You tapped the face: a giggle.", atMs: 700 },
    ],
  },
  {
    group: "Your day",
    entries: [
      { id: "quiet", name: "Quiet mode", means: "Double-tap: only approvals get through. Tap to wake." },
      { id: "closed", name: "Day closed", means: "Long-press, then Close: star eyes, then the shutter." },
      { id: "sleepy", name: "Closed early", means: "A big yawn, then drowsy as the shutter comes most of the way down." },
      { id: "night", name: "Night", means: "Asleep behind the shutter. Tap to reopen the day." },
      { id: "idle", name: "Link down", means: "Bluetooth with a red cross, top left: no link to the Claude app.", lab: { disconnected: true }, whole: true },
    ],
  },
];

const thumbs = new Map<string, string>();
/** Toki's screen, small: rendered once per face, rounded like the glass. */
function thumb(e: Entry): string {
  const key = `${e.id}:${JSON.stringify(e.lab ?? {})}:${e.atMs ?? ""}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  const screen = renderCell({ label: e.id, expression: e.id, atMs: e.atMs ?? 1_200, lab: { hideChrome: true, ...e.lab } });
  // Just the face (the screen's empty margins cut away), at 2x for sharpness.
  const c = document.createElement("canvas");
  c.width = 144;
  c.height = 108;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.roundRect(0, 0, 144, 108, 12);
  g.clip();
  g.imageSmoothingQuality = "high";
  g.drawImage(screen, ...crop(e), 0, 0, 144, 108);
  const url = c.toDataURL("image/png");
  thumbs.set(key, url);
  return url;
}

/**
 * The face, alive: shown while a row is hovered, because some faces differ only in
 * how they move (reading sweeps, running scrolls up, idle drifts).
 */
function LiveFace({ e }: { e: Entry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const out = ref.current?.getContext("2d");
    if (!out) return;
    const screen = document.createElement("canvas");
    screen.width = 320;
    screen.height = 240;
    const gfx = new Gfx(screen.getContext("2d")!);
    const face = new FaceRenderer();
    const state = initialState();
    const lab = { expression: e.id, tokens: defaultTokens, overrides: {}, hideChrome: true, ...e.lab };
    const start = performance.now() - 1_000; // already settled into the face
    let raf = 0;
    const frame = (now: number) => {
      face.draw(gfx, state, now - start, lab);
      out.clearRect(0, 0, 144, 108);
      out.drawImage(screen, ...crop(e), 0, 0, 144, 108);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [e]);
  return <canvas ref={ref} width={144} height={108} style={{ width: 72, height: 54, borderRadius: 6 }} />;
}

function FaceRow({ e }: { e: Entry }) {
  const [live, setLive] = useState(false);
  return (
    <div onMouseEnter={() => setLive(true)} onMouseLeave={() => setLive(false)}>
      <Row pic={live ? <LiveFace e={e} /> : <img src={thumb(e)} alt="" style={{ width: 72, height: 54, borderRadius: 6 }} />} name={e.name} means={e.means} />
    </div>
  );
}

// Stickers: a fake moment of each kind is enough to draw it.
const fake = (kind: MomentKind, face = "working", extra: Partial<Moment> = {}): Moment => ({ t: 0, kind, face, ...extra });
const KIND_OF: Partial<Record<SymbolKind, WorkKind>> = { frame: "images", page: "documents", envelope: "email" };
const turn = (symbol: SymbolKind): Moment => {
  const kind = KIND_OF[symbol];
  if (kind) return fake("asked", "working", { n: 3, ctx: { kind } });
  const face: Partial<Record<SymbolKind, string>> = { www: "web", magnifier: "search", sweat: "test", dots: "think", minis: "subagent", terminal: "run", sparkles: "working" };
  return fake("asked", face[symbol] ?? "working", { n: symbol === "sparkles" ? 1 : 4, detail: symbol === "sparkles" ? "done" : undefined });
};

const STICKERS: { group: string; entries: { m: Moment; name: string; means: string; finish?: Finish }[] }[] = [
  {
    group: "One per turn",
    entries: [
      { m: turn("sparkles"), name: "Quick win", means: "A short turn that finished." },
      { m: turn("dots"), name: "Just talk", means: "Claude answered without tools." },
      { m: turn("terminal"), name: "Commands", means: "Mostly running commands." },
      { m: turn("www"), name: "Web", means: "Research: searching or fetching." },
      { m: turn("frame"), name: "Images", means: "Made or edited pictures." },
      { m: turn("page"), name: "Documents", means: "Wrote a document, sheet or deck." },
      { m: turn("envelope"), name: "Email", means: "Read, drafted or sent mail." },
      { m: turn("magnifier"), name: "Searching", means: "Mostly grep and glob." },
      { m: turn("sweat"), name: "Tests", means: "Mostly running tests." },
      { m: turn("minis"), name: "Subagents", means: "Subagents did the work." },
      { m: fake("asked", "edit", { n: 12 }), name: "Long turn", means: "8+ tool calls: Toki's face for its main work. Bigger means more work." },
    ],
  },
  {
    group: "Events",
    entries: [
      { m: fake("met", "approved"), name: "Nice to meet you", means: "The day you set Toki up." },
      { m: fake("hello", "approved"), name: "Hello world", means: "The day's first session." },
      { m: fake("shipped", "done"), name: "Shipped", means: "A push or a merge." },
      { m: fake("error", "error"), name: "Oops", means: "Something failed." },
      { m: fake("your-turn", "blocked", { n: 6 }), name: "Your turn", means: "Claude waited over 5 minutes for you." },
      { m: fake("denied", "denied"), name: "Nope", means: "You denied a request." },
      { m: fake("always", "approved"), name: "Always", means: "You allowed it with a rule." },
      { m: fake("question", "asked"), name: "Question", means: "Claude asked you something." },
      { m: fake("subagents", "subagent"), name: "Subagents", means: "A burst of subagents at once." },
      { m: fake("context-full", "sleepy"), name: "Context full", means: "The conversation was compacted." },
      { m: fake("yolo", "web"), name: "YOLO mode", means: "Auto mode: tools run without asking." },
      { m: fake("plan", "think"), name: "Plan mode", means: "Claude planned before acting." },
      { m: fake("quiet", "quiet"), name: "Leave me alone", means: "You put Toki in quiet mode." },
      { m: fake("closed", "closed", { detail: "earned" }), name: "Closed", means: "You closed the day after a day's work." },
    ],
  },
  {
    // Spec §9.5. Point at one: the light follows the pointer.
    group: "Rare finishes",
    entries: [
      { m: fake("asked", "test", { n: 12 }), finish: "silver", name: "Silver day", means: "One of your busiest days of the last 30. How intense, not how good." },
      { m: fake("asked", "web", { n: 12 }), finish: "gold", name: "Gold day", means: "Your busiest day of the last 30, far above an ordinary one." },
      { m: fake("shipped", "done"), finish: "holo", name: "Holo", means: "A rare moment: a project's first ship, or the longest run that didn't need you." },
    ],
  },
];

const soft = "var(--tk-muted)";

function remember(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, set] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : s === "1";
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next) => {
      set(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // private window: just don't remember
      }
    },
  ];
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = remember(`toki.guide.${id}`, false);
  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="tk-display flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[var(--tk-cream)]"
        style={{ fontSize: 16, fontWeight: 700 }}
      >
        {title}
        <span style={{ color: soft }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ padding: "4px 2px 0" }}>{children}</div>}
    </div>
  );
}

const Row = ({ pic, name, means }: { pic: React.ReactNode; name: string; means: string }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 6px" }}>
    <div style={{ width: 72, flexShrink: 0, display: "flex", justifyContent: "center" }}>{pic}</div>
    <div style={{ minWidth: 0 }}>
      <div className="tk-display" style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.15 }}>
        {name}
      </div>
      <div style={{ fontSize: 12, color: soft, lineHeight: 1.3 }}>{means}</div>
    </div>
  </div>
);

const Group = ({ title }: { title: string }) => (
  <div className="tk-display" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--tk-tomato)", margin: "10px 6px 2px" }}>
    {title}
  </div>
);

export function Guide() {
  return (
    <div className="tk-card-sm" style={{ padding: "10px 8px 8px" }}>
      <div className="tk-display" style={{ fontSize: 13, fontWeight: 700, color: "var(--tk-muted)", margin: "0 8px" }}>
        Guide
      </div>
      <Section id="faces" title="Toki's faces">
        <div style={{ fontSize: 12, color: soft, margin: "2px 6px 0" }}>Hover a face to see it move.</div>
        {FACES.map((g) => (
          <div key={g.group}>
            <Group title={g.group} />
            {g.entries.map((e) => (
              <FaceRow key={e.name} e={e} />
            ))}
          </div>
        ))}
      </Section>
      <Section id="stickers" title="Stickers">
        {STICKERS.map((g) => (
          <div key={g.group}>
            <Group title={g.group} />
            {g.entries.map((e) => (
              <Row key={e.name} pic={<StickerArt m={e.m} w={e.m.kind === "question" ? 34 : 60} still finish={e.finish} style={{ position: "relative" }} />} name={e.name} means={e.means} />
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
