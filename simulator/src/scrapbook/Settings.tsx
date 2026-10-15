import { useEffect, useRef, useState } from "react";

// Settings (Phase 7, spec §10.4). They live on Toki itself (its NVS), so they
// survive updates and reflashing; the bridge passes changes over Wi-Fi and keeps
// the last copy, so this page can show them while Toki is away.

type Values = { brightness: number; rollover: number; label?: number }; // label: older firmware doesn't report it
type State = { online: boolean; settings: Values | null };

const percent = (b: number) => Math.round((b / 255) * 100);
/** The label under Toki's face (settings `label`: 0, 1, 2), with what each looks like. */
const LABELS = [
  { name: "Off", example: "(nothing under the face)" },
  { name: "Words", example: "READING" },
  { name: "Detail", example: "READING · render.ts" },
];

async function save(patch: Partial<Values>): Promise<State> {
  const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Something went wrong.");
  return body;
}

export function Settings() {
  const [state, setState] = useState<State | null>(null);
  const [brightness, setBrightness] = useState<number | null>(null); // while dragging
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = () =>
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: State) => setState(s))
      .catch(() => setNote({ ok: false, text: "The bridge isn't answering on this Mac." }));
  useEffect(() => {
    load();
    const t = window.setInterval(load, 5_000); // notices Toki coming and going
    return () => window.clearInterval(t);
  }, []);

  const change = (patch: Partial<Values>, wait = 0) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const s = await save(patch);
        setState(s);
        setNote({ ok: true, text: "Saved on Toki." });
      } catch (e) {
        setNote({ ok: false, text: (e as Error).message });
        load();
      }
    }, wait);
  };

  const s = state?.settings;
  const shown = brightness ?? s?.brightness ?? 140;
  // Changes need Toki on Wi-Fi, and Toki must have said what it has (older firmware never does).
  const disabled = !state?.online || !s;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="tk-title" style={{ fontSize: 68, paddingTop: 12 }}>
        Settings
      </h1>
      <p style={{ fontSize: 16, marginTop: 8 }}>Kept on Toki itself, so they survive updates and reflashing.</p>
      <div className="mt-5 space-y-5">
        <Status state={state} />

        <Card title="Screen">
          <label className="tk-display" style={{ display: "block", fontSize: 19, fontWeight: 700 }}>
            Brightness <span className="tk-chip" style={{ marginLeft: 8, fontSize: 13, padding: "4px 9px 2px" }}>{percent(shown)}%</span>
          </label>
          <input
            type="range"
            min={20}
            max={255}
            value={shown}
            disabled={disabled}
            onChange={(e) => {
              const v = Number(e.target.value);
              setBrightness(v);
              change({ brightness: v }, 120); // live as you drag, without flooding Toki
            }}
            onPointerUp={() => setBrightness(null)}
            onKeyUp={() => setBrightness(null)}
            style={{ width: "100%", marginTop: 12, accentColor: "var(--tk-tomato)" }}
          />
          <Hint>Toki's screen changes as you drag. It never goes fully dark, so you can always see the face.</Hint>

          <div className="tk-display" style={{ fontSize: 19, fontWeight: 700, marginTop: 24 }}>
            Label under the face
          </div>
          <div className="tk-seg mt-2" style={{ width: 330, opacity: disabled || s?.label === undefined ? 0.5 : 1 }} role="group" aria-label="Label under the face">
            {LABELS.map((l, i) => (
              <button key={l.name} aria-pressed={(s?.label ?? 2) === i} disabled={disabled || s?.label === undefined} onClick={() => change({ label: i })}>
                {l.name}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12, display: "inline-block", padding: "6px 14px 4px", background: "var(--tk-ink)", color: "var(--tk-cream)", borderRadius: 10 }} className="tk-display">
            <span style={{ fontSize: 17, fontWeight: 600 }}>{LABELS[s?.label ?? 2].example}</span>
          </div>
          <Hint>
            {s && s.label === undefined
              ? "Toki needs newer firmware for this. Run toki flash, then come back."
              : "Detail shows the file, command or site Claude is working on, so anyone at your desk can read it. Words just names what Toki is doing."}
          </Hint>
        </Card>

        <Card title="Your day">
          <label className="tk-display" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 19, fontWeight: 700 }}>
            A new day starts at
            <select
              value={s?.rollover ?? 2}
              disabled={disabled}
              onChange={(e) => change({ rollover: Number(e.target.value) })}
              className="tk-display"
              style={{ fontSize: 17, fontWeight: 700, background: "var(--tk-paper)", color: "var(--tk-ink)", border: "2px solid var(--tk-ink)", borderRadius: 10, padding: "3px 8px 1px", boxShadow: "2px 2px 0 var(--tk-ink)" }}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <Hint>Work after midnight but before this time counts as the day before, on Toki and in the scrapbook. Days already more than 30 days old keep the boundaries they had.</Hint>
        </Card>

        {note && (
          <p className="tk-chip" style={{ fontSize: 14 }}>
            <span className="dot" style={{ background: note.ok ? "var(--tk-teal)" : "var(--tk-mustard)", border: "1.5px solid var(--tk-ink)" }} />
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}

function Status({ state }: { state: State | null }) {
  if (!state) return <p className="tk-display" style={{ fontSize: 17, fontWeight: 600 }}>Asking the bridge…</p>;
  const ok = state.online && !!state.settings;
  return (
    <div className="tk-card-sm" style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", fontSize: 15 }}>
      <span style={{ width: 14, height: 14, borderRadius: 999, flexShrink: 0, background: ok ? "var(--tk-teal)" : "var(--tk-mustard)", border: "2px solid var(--tk-ink)" }} />
      <span>
        {ok
          ? "Toki is connected over Wi-Fi. Changes go straight to the robot."
          : state.online
            ? "Toki is connected, but hasn't reported its settings. It needs the firmware with settings in it; until then nothing here can change."
            : state.settings
              ? "Toki isn't connected over Wi-Fi right now. These are its last saved settings; to change them, switch Toki on and wait a few seconds."
              : "Toki hasn't reported its settings yet. Once it's on and connected over Wi-Fi, they'll appear here."}
      </span>
    </div>
  );
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="tk-card" style={{ padding: "20px 24px 22px" }}>
    <h2 className="tk-display" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, marginBottom: 14 }}>
      {title}
    </h2>
    {children}
  </section>
);

const Hint = ({ children }: { children: React.ReactNode }) => <p style={{ fontSize: 13.5, color: "var(--tk-muted)", marginTop: 10, lineHeight: 1.45 }}>{children}</p>;
