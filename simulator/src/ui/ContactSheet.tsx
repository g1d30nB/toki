import { useCallback, useMemo, useRef } from "react";
import { Screen } from "../face/Screen";
import { expressionIds, type ExpressionId, type ExpressionOverrides } from "../face/expressions";
import type { Lab } from "../face/render";
import type { FaceTokens } from "../face/tokens";
import { SETUP_FACE, type SetupScreen } from "../face/setup";
import { initialState } from "../state/agentState";

// Side-by-side views for design review. Each cell is a live, animating screen
// forced to one expression, with optional per-cell lab settings.

export type Cell = { label: string; expression: ExpressionId; lab?: Partial<Lab>; greyscale?: boolean; peripheral?: boolean };

type Shared = { tokens: FaceTokens; overrides: ExpressionOverrides; greyscale: boolean; peripheral: boolean };

function CellView({ cell, tokens, overrides, greyscale, peripheral, scale }: Shared & { cell: Cell; scale: number }) {
  const lab = useRef<Lab>({ expression: cell.expression, tokens, overrides });
  lab.current = { expression: cell.expression, tokens, overrides, ...cell.lab };
  const getLab = useCallback(() => lab.current, []);
  const state = useMemo(() => initialState(), []);
  const getState = useCallback(() => state, [state]);
  return (
    <figure className="space-y-1">
      <Screen
        getState={getState}
        getLab={getLab}
        scale={scale}
        greyscale={cell.greyscale ?? greyscale}
        peripheral={cell.peripheral ?? peripheral}
      />
      <figcaption className="font-mono text-[11px] text-stone-400">{cell.label}</figcaption>
    </figure>
  );
}

export function Sheet({ cells, cols, scale = 0.75, ...shared }: Shared & { cells: Cell[]; cols: number; scale?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {cells.map((c) => (
        <CellView key={c.label} cell={c} scale={scale} {...shared} />
      ))}
    </div>
  );
}

export const allExpressions: Cell[] = expressionIds.map((id) => ({ label: id, expression: id }));

// The pass-2 acceptance test: from the face alone, in greyscale at the edge of
// vision, idle, working and blocked must be clearly distinguishable. "read" is
// the working sub-state with no manpu, so it's the hardest case.
export const acceptance: Cell[] = (["idle", "read", "blocked"] as ExpressionId[]).map((id) => ({
  label: id === "read" ? "working (read)" : id,
  expression: id,
  lab: { hideChrome: true },
  greyscale: true,
  peripheral: true,
}));

export const edgesComparison: Cell[] = (["blocked", "idle"] as ExpressionId[]).flatMap((id) => [
  { label: `${id} · smooth (B, anti-aliased)`, expression: id, lab: { edges: "smooth" } },
  { label: `${id} · crisp (C, pixel)`, expression: id, lab: { edges: "crisp" } },
]);

// Toki's side of setup (Phase 7, face/setup.ts), in the order a new owner meets them.
const SETUP_SHEET: SetupScreen[] = [
  { screen: "hello" },
  { screen: "joining", ssid: "MyHomeWiFi" },
  { screen: "joined", ssid: "MyHomeWiFi" },
  { screen: "wifiFailed", ssid: "MyHomeWiFi" },
  { screen: "pairMe" },
  { screen: "pairCode", code: "482915" },
  { screen: "pairFailed" },
  { screen: "allSet" },
  { screen: "checkHead" },
  { screen: "calibrate" },
  { screen: "calibrated" },
];
export const setupScreens: Cell[] = SETUP_SHEET.map((s, i) => ({ label: `${i + 1}. ${s.screen}`, expression: SETUP_FACE[s.screen], lab: { setup: s } }));

export const mouthComparison: Cell[] = (["idle", "edit", "blocked", "denied"] as ExpressionId[]).flatMap((id) => [
  { label: `${id} · (a) minimal mouth`, expression: id, lab: { mouth: true } },
  { label: `${id} · (b) mouthless`, expression: id, lab: { mouth: false } },
]);

// Labels under the face (face/label.ts, 15 Oct): each labelled face as plain words
// and with what Claude is working on. The last pair checks the label against all
// four spawned minis, the lowest of which sits just above it.
const LABELLED: ExpressionId[] = ["think", "read", "search", "edit", "run", "test", "web", "working", "done", "error", "approved", "denied"];
export const labelComparison: Cell[] = [
  ...LABELLED.flatMap((id) => [
    { label: `${id} · words`, expression: id, lab: { label: "words" as const } },
    { label: `${id} · detail`, expression: id, lab: { label: "detail" as const } },
  ]),
  { label: "subagent ×3 · words", expression: "subagent", lab: { label: "words", subagents: 3 } },
  { label: "read + 4 minis · detail", expression: "read", lab: { label: "detail", subagents: 4 } },
];
