import { useCallback, useEffect, useRef, useState } from "react";
import type { Gesture, Recording } from "./replay/events";
import { parseRecording } from "./replay/parseRecording";
import { usePlayback } from "./replay/usePlayback";
import { Screen } from "./face/Screen";
import type { ExpressionId, ExpressionOverrides } from "./face/expressions";
import type { Lab } from "./face/render";
import { defaultTokens, type FaceTokens } from "./face/tokens";
import { LabPanel } from "./ui/LabPanel";
import { Sheet, acceptance, allExpressions, edgesComparison, labelComparison, mouthComparison, setupScreens, type Cell } from "./ui/ContactSheet";
import { ConfigPanel, EventLog, Panel, RecordingInfo, StatePanel, fmtTime } from "./ui/panels";

const SPEEDS = [1, 10, 60];

// Design-review views shown under the main screen.
const VIEWS: Record<string, { title: string; cells: Cell[]; cols: number }> = {
  acceptance: { title: "Acceptance: idle · working · blocked (grey, edge of vision)", cells: acceptance, cols: 3 },
  all: { title: "All expressions", cells: allExpressions, cols: 4 },
  mouth: { title: "Mouth: (a) minimal vs (b) mouthless", cells: mouthComparison, cols: 2 },
  edges: { title: "Edges: smooth vs crisp (2×)", cells: edgesComparison, cols: 2 },
  setup: { title: "Setup screens (Toki joins in)", cells: setupScreens, cols: 4 },
  labels: { title: "Labels under the face: words vs detail", cells: labelComparison, cols: 4 },
};

export function App() {
  const [recording, setRecording] = useState<Recording | null>(null);
  // "Live from bridge" (Phase 4): the face follows Claude Code hooks streamed by the bridge.
  const [bridge, setBridge] = useState<"off" | "connecting" | "live" | "down">("off");
  // "Always allow?" confirm screen (step 5): opened by a long-press on Allow.
  const [alwaysAsk, setAlwaysAsk] = useState(false);
  const alwaysAskRef = useRef(false);
  alwaysAskRef.current = alwaysAsk;
  const [greyscale, setGreyscale] = useState(false);
  const [peripheral, setPeripheral] = useState(false);
  const [view, setView] = useState<keyof typeof VIEWS | "">("");
  const pb = usePlayback(recording);

  // Face lab: the canvas reads these through a ref, so slider drags don't restart it.
  const [labExpression, setLabExpression] = useState<ExpressionId | null>(null);
  const [tokens, setTokens] = useState<FaceTokens>(defaultTokens);
  const [overrides, setOverrides] = useState<ExpressionOverrides>({});
  const [longTurn, setLongTurn] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [labSubagents, setLabSubagents] = useState<number | undefined>(undefined);
  // Decided 3 Oct: minimal mouth (a) and smooth edges (B). The toggles stay for comparison.
  const [mouth, setMouth] = useState(true);
  const [edges, setEdges] = useState<"smooth" | "crisp">("smooth");
  const lab = useRef<Lab>({ expression: null, tokens: defaultTokens, overrides: {} });
  lab.current = { expression: labExpression, tokens, overrides, longTurn, mouth, edges, subagents: labSubagents, disconnected, alwaysAsk };
  const getLab = useCallback(() => lab.current, []);

  // Recordings are read in the browser only; nothing is uploaded or copied.
  const load = async (file: File | undefined) => {
    if (file) setRecording(parseRecording(file.name, await file.text()));
  };

  // In dev, the server lists ~/StackChanData/recordings (see vite.config.ts).
  const [available, setAvailable] = useState<{ name: string; bytes: number }[]>([]);
  const openNamed = async (name: string) => {
    const r = await fetch(`/api/recordings/${encodeURIComponent(name)}`);
    if (r.ok) setRecording(parseRecording(name, await r.text()));
  };
  useEffect(() => {
    fetch("/api/recordings")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { name: string; bytes: number }[]) => {
        setAvailable(list);
        // Open the newest real session straight away (skip tiny test or stalled files).
        const first = list.find((f) => f.bytes > 100_000);
        if (first) openNamed(first.name);
      })
      .catch(() => setAvailable([]));
  }, []);

  const s = pb.getState();
  // The confirm screen belongs to one prompt: it closes when that prompt goes.
  const promptId = s.prompt?.id ?? null;
  useEffect(() => setAlwaysAsk(false), [promptId]);

  // Live from bridge: each event the bridge streams is applied to the live face as
  // it arrives. EventSource reconnects on its own if the bridge restarts.
  const bridgeOn = bridge !== "off";
  const inject = pb.inject;
  useEffect(() => {
    if (!bridgeOn) return;
    const es = new EventSource("/bridge/events");
    es.onopen = () => setBridge("live");
    es.onerror = () => setBridge("down");
    es.onmessage = (m) => {
      try {
        inject(JSON.parse(m.data));
      } catch {
        // not an event: ignore
      }
    };
    return () => es.close();
  }, [bridgeOn, inject]);

  // Mouse on the face as a finger on the glass (spec §6). The screen hit-tests
  // the buttons; the state layer decides what a gesture means.
  const onGesture = useCallback(
    (gesture: Gesture | "press", x: number, y: number) => {
      const st = pb.getState();
      const button = y >= tokens.buttonY ? (x >= 164 ? "right" : x >= 8 && x < 156 ? "left" : null) : null;
      if (st.prompt) {
        const id = st.prompt.id;
        const answer = (decision: "allow" | "deny" | "always") => {
          pb.inject({ kind: "decision", t: 0, id, decision: decision === "deny" ? "deny" : "once" });
          setAlwaysAsk(false);
          // Live from bridge: the answer goes back to Claude Code through the held hook (step 4).
          if (bridge === "live") fetch("/bridge/answer", { method: "POST", body: JSON.stringify({ id, decision }) }).catch(() => {});
        };
        // A question (step 6) is answered in Claude: taps on Toki do nothing.
        if (st.prompt.question || st.prompt.tool === "AskUserQuestion") return;
        // "Always allow?" is showing: Cancel goes back, Always answers. Taps only.
        if (alwaysAskRef.current) {
          if (gesture === "tap" && button === "right") answer("always");
          else if (gesture === "tap" && button === "left") setAlwaysAsk(false);
          return;
        }
        // With Always allow on offer, Allow waits for the release (a tap allows once)
        // so a long-press can open the confirm screen. Otherwise both answer on the press.
        const holdable = button === "right" && !!st.prompt.always && bridge === "live";
        if (gesture === "press" && button && !holdable) {
          answer(button === "right" ? "allow" : "deny");
          return true; // used up: its release mustn't wake Toki or reopen the day
        }
        if (holdable && gesture === "tap") answer("allow");
        if (holdable && gesture === "long-press") setAlwaysAsk(true);
        return;
      }
      if (gesture === "press") return;
      const asking = st.closeAskAt !== null && st.now - st.closeAskAt <= pb.config.closeAskMs;
      const target = asking && button ? (button === "right" ? "yes" : "no") : "face";
      pb.inject({ kind: "gesture", t: 0, gesture, target });
    },
    [pb, tokens, bridge],
  );

  return (
    <div
      className="mx-auto max-w-6xl p-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        load(e.dataTransfer.files[0]);
      }}
    >
      <header className="mb-4 flex items-baseline gap-4">
        <h1 className="text-lg font-semibold">
          Toki <span className="text-stone-500">simulator</span>
        </h1>
        {available.length > 0 && (
          <select
            className="ml-auto rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm"
            value={bridge !== "off" ? "__bridge" : (recording?.name ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              setBridge(v === "__bridge" ? "connecting" : "off");
              if (v === "__bridge" || !v) setRecording(null);
              else openNamed(v);
            }}
          >
            <option value="">Live face (no recording): try the gestures</option>
            <option value="__bridge">Live from bridge (Claude Code hooks)</option>
            {available.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({(f.bytes / 1e6).toFixed(1)} MB)
              </option>
            ))}
          </select>
        )}
        {bridgeOn && (
          <span className={`text-xs ${bridge === "live" ? "text-teal-400" : "text-amber-300"}`}>
            {bridge === "live"
              ? "bridge: live"
              : bridge === "down"
                ? "bridge not running: node bridge/src/server.ts"
                : "connecting to bridge…"}
          </span>
        )}
        <label className={`${available.length ? "" : "ml-auto "}cursor-pointer rounded-md border border-stone-700 px-3 py-1.5 text-sm hover:border-amber-400`}>
          Open recording…
          <input type="file" accept=".jsonl" className="hidden" onChange={(e) => load(e.target.files?.[0])} />
        </label>
      </header>

      {!recording && (
        <div className="mb-4 rounded-lg border border-dashed border-stone-700 p-4 text-center text-sm text-stone-400">
          No recording loaded: choose one from the menu above, drop a <code>.jsonl</code> file here, or use the Face lab.
          The face is live: click it to boop (or wake it), double-click for quiet mode, hold for “Close the day?”.
          Recordings live in <code className="text-amber-300">~/StackChanData/recordings</code> and are never uploaded.
        </div>
      )}
      <>
          {recording && <RecordingInfo r={recording} />}
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,680px)_1fr]">
            <div className="space-y-3">
              <div className="flex w-full max-w-[680px] items-center justify-center rounded-2xl bg-stone-300 p-3 shadow-inner">
                <div className="flex w-full justify-center rounded-xl bg-stone-800 p-2">
                  <Screen
                    getState={pb.getState}
                    getLab={getLab}
                    scale={2}
                    greyscale={greyscale}
                    peripheral={peripheral}
                    onGesture={labExpression ? undefined : onGesture}
                  />
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={greyscale} onChange={(e) => setGreyscale(e.target.checked)} />
                  Greyscale
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={peripheral} onChange={(e) => setPeripheral(e.target.checked)} />
                  Edge of vision
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={mouth} onChange={(e) => setMouth(e.target.checked)} />
                  Mouth
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={edges === "crisp"} onChange={(e) => setEdges(e.target.checked ? "crisp" : "smooth")} />
                  Crisp pixels
                </label>
                <select
                  value={view}
                  onChange={(e) => setView(e.target.value as keyof typeof VIEWS)}
                  className="ml-auto rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs"
                >
                  <option value="">Compare: off</option>
                  {Object.entries(VIEWS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.title}
                    </option>
                  ))}
                </select>
              </div>
              {view && (
                <Sheet
                  cells={VIEWS[view].cells}
                  cols={VIEWS[view].cols}
                  scale={view === "edges" ? 2 : view === "acceptance" ? 1 : 0.75}
                  tokens={tokens}
                  overrides={overrides}
                  greyscale={greyscale}
                  peripheral={peripheral}
                />
              )}

              {recording && (
              <Panel title="Playback">
                <div className="flex items-center gap-3">
                  <button
                    className="w-20 rounded-md bg-amber-400 px-3 py-1.5 text-sm font-semibold text-stone-950"
                    onClick={() => pb.setPlaying(!pb.playing)}
                  >
                    {pb.playing ? "Pause" : "Play"}
                  </button>
                  {SPEEDS.map((x) => (
                    <button
                      key={x}
                      onClick={() => pb.setSpeed(x)}
                      className={`rounded-md px-2 py-1 font-mono text-xs ${pb.speed === x ? "bg-stone-200 text-stone-950" : "bg-stone-800"}`}
                    >
                      {x}×
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-2 text-xs text-stone-400">
                    <input type="checkbox" checked={pb.skipGaps} onChange={(e) => pb.setSkipGaps(e.target.checked)} />
                    skip quiet gaps
                  </label>
                </div>
                <div className="mt-3 flex items-center gap-3 font-mono text-xs">
                  <span className="w-14 text-stone-400">{fmtTime(s.now)}</span>
                  <input
                    type="range"
                    min={0}
                    max={recording.durationMs}
                    step={250}
                    value={s.now}
                    onChange={(e) => pb.seek(Number(e.target.value))}
                    className="flex-1 accent-amber-400"
                  />
                  <span className="w-14 text-right text-stone-500">{fmtTime(recording.durationMs)}</span>
                </div>
              </Panel>
              )}
            </div>

            <div className="space-y-4">
              <LabPanel
                expression={labExpression}
                onExpression={setLabExpression}
                tokens={tokens}
                onTokens={setTokens}
                overrides={overrides}
                onOverrides={setOverrides}
                longTurn={longTurn}
                disconnected={disconnected}
                onDisconnected={setDisconnected}
                onLongTurn={setLongTurn}
                subagents={labSubagents}
                onSubagents={setLabSubagents}
              />
              <StatePanel s={s} />
              <ConfigPanel config={pb.config} onChange={pb.setConfig} />
              {recording && <EventLog events={recording.events} position={pb.player?.position ?? 0} />}
            </div>
          </div>
      </>
    </div>
  );
}
