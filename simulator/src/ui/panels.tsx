import type { Recording, StreamEvent } from "../replay/events";
import type { AgentState, Config } from "../state/agentState";

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
      <h2 className="mb-2 font-mono text-[11px] tracking-widest text-stone-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-4 font-mono text-xs">
    <span className="text-stone-500">{k}</span>
    <span className="truncate text-right text-stone-200">{v}</span>
  </div>
);

export function StatePanel({ s }: { s: AgentState }) {
  const shownFor = fmtTime(s.now - s.shown.since);
  return (
    <Panel title="Agent state">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-amber-300">{s.shown.mode}</span>
        {s.shown.activity && <span className="text-stone-300">· {s.shown.activity}</span>}
        <span className="ml-auto font-mono text-xs text-stone-500">for {shownFor}</span>
      </div>
      <Row k="raw activity" v={s.activity ? `${s.activity.kind}${s.activity.tool ? ` (${s.activity.tool.name})` : ""}` : "none"} />
      <Row k="sessions" v={`total ${s.sessions.total} · running ${s.sessions.running} · waiting ${s.sessions.waiting}`} />
      <Row k="prompt" v={s.prompt ? `${s.prompt.tool}: ${s.prompt.hint}` : "none"} />
      <Row k="msg" v={s.msg || "–"} />
      <Row k="tokens today" v={s.tokensToday.toLocaleString("en-GB")} />
      <div className="my-2 border-t border-stone-800" />
      <Row k="tool calls" v={s.stats.toolCalls} />
      <Row
        k="by activity"
        v={Object.entries(s.stats.byActivity)
          .map(([k, n]) => `${k} ${n}`)
          .join(" · ") || "–"}
      />
      <Row k="approvals / denials" v={`${s.stats.approvals} / ${s.stats.denials}`} />
      <Row k="waited on you" v={fmtTime(s.stats.waitedOnYouMs)} />
      <Row k="errors" v={s.stats.errors} />
      <Row k="quiet" v={s.quietUntil !== null && s.now < s.quietUntil ? `until ${fmtTime(s.quietUntil)}` : "off"} />
      <Row k="day" v={s.dayClosed ? (s.dayClosed.earned ? "closed (earned)" : "closed (quiet)") : `open · ${s.doneToday} done`} />
    </Panel>
  );
}

function describe(e: StreamEvent): [string, string] {
  switch (e.kind) {
    case "snapshot":
      return ["snap", `R${e.running} W${e.waiting}  ${e.prompt ? `PROMPT ${e.prompt.tool}: ${e.prompt.hint}` : e.msg}`];
    case "turn":
      return [
        e.role === "user" ? "you" : "claude",
        e.tools.length ? e.tools.map((t) => `${t.name} ${t.summary}`).join(" · ") : e.blocks.join(", "),
      ];
    case "decision":
      return ["robot", e.decision === "deny" ? "Deny" : "Allow"];
    case "prompt":
      return ["hook", `PROMPT ${e.tool}: ${e.hint}`];
    case "prompt-cleared":
      return ["hook", "prompt answered"];
    case "stop":
      return ["hook", e.error ? "turn failed" : "turn done"];
    case "gesture":
      return ["touch", `${e.gesture}${e.target === "face" ? "" : ` · ${e.target}`}`];
    case "device":
      return ["device", e.text];
    case "repeat":
      return ["repeat", `×${e.count}`];
  }
}

export function EventLog({ events, position }: { events: StreamEvent[]; position: number }) {
  // Snapshots dominate the stream, so show only those that change something visible.
  const shown: StreamEvent[] = [];
  let lastKey = "";
  // Clamp: right after switching recordings, position can still belong to the previous one.
  for (let i = Math.min(position, events.length) - 1; i >= 0 && shown.length < 60; i--) {
    const e = events[i];
    if (e.kind === "repeat") continue;
    if (e.kind === "snapshot") {
      const key = `${e.running}${e.waiting}${e.msg}${e.prompt?.id}`;
      if (key === lastKey) continue;
      lastKey = key;
    }
    shown.push(e);
  }
  return (
    <Panel title="Events (newest first)">
      <ol className="max-h-80 space-y-0.5 overflow-y-auto font-mono text-[11px]">
        {shown.map((e, i) => {
          const [who, what] = describe(e);
          return (
            <li key={`${e.t}-${i}`} className="flex gap-2">
              <span className="w-12 shrink-0 text-stone-600">{fmtTime(e.t)}</span>
              <span className="w-12 shrink-0 text-teal-400">{who}</span>
              <span className="truncate text-stone-300">{what}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

const SLIDERS: { key: keyof Config; label: string; min: number; max: number; step: number }[] = [
  { key: "activityHoldMs", label: "activity hold", min: 2_000, max: 60_000, step: 1_000 },
  { key: "minDwellMs", label: "min dwell", min: 0, max: 5_000, step: 100 },
  { key: "oneShotMs", label: "one-shot (done)", min: 400, max: 3_000, step: 100 },
  { key: "errorMs", label: "error hold", min: 1_000, max: 8_000, step: 100 },
];

export function ConfigPanel({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  return (
    <Panel title="State tokens (tune)">
      <div className="space-y-2">
        {SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 font-mono text-xs">
            <span className="text-stone-400">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={config[key]}
              onChange={(e) => onChange({ ...config, [key]: Number(e.target.value) })}
              className="accent-amber-400"
            />
            <span className="text-right text-stone-300">{(config[key] / 1000).toFixed(1)} s</span>
          </label>
        ))}
      </div>
    </Panel>
  );
}

export function RecordingInfo({ r }: { r: Recording }) {
  const counts = r.events.reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {});
  return (
    <p className="font-mono text-xs text-stone-500">
      {r.name} · {r.startedAt.toLocaleString("en-GB")} · {fmtTime(r.durationMs)} ·{" "}
      {Object.entries(counts)
        .map(([k, n]) => `${n} ${k}`)
        .join(", ")}
    </p>
  );
}
