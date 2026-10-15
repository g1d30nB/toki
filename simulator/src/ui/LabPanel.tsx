import { useState } from "react";
import {
  expressionIds,
  expressionSliders,
  lookupWith,
  type Expression,
  type ExpressionId,
  type ExpressionOverrides,
} from "../face/expressions";
import { defaultTokens, tokenRanges, type FaceTokens } from "../face/tokens";
import { Panel } from "./panels";

type Props = {
  expression: ExpressionId | null;
  onExpression: (id: ExpressionId | null) => void;
  tokens: FaceTokens;
  onTokens: (t: FaceTokens) => void;
  overrides: ExpressionOverrides;
  onOverrides: (o: ExpressionOverrides) => void;
  longTurn: boolean;
  onLongTurn: (v: boolean) => void;
  subagents: number | undefined;
  onSubagents: (n: number | undefined) => void;
  disconnected: boolean;
  onDisconnected: (v: boolean) => void;
};

// Optional parameters (like brows.len) default to 1 when an expression leaves them out.
const get = (e: Expression, path: string): number =>
  (path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], e) as number | undefined) ?? 1;

function set(o: Partial<Expression>, path: string, v: number): Partial<Expression> {
  const [a, b] = path.split(".");
  if (!b) return { ...o, [a]: v };
  const inner = (o as Record<string, Record<string, number> | undefined>)[a] ?? {};
  return { ...o, [a]: { ...inner, [b]: v } };
}

const Slider = (p: { label: string; value: number; min: number; max: number; step: number; changed: boolean; onChange: (v: number) => void }) => (
  <label className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 font-mono text-xs">
    <span className={p.changed ? "text-amber-300" : "text-stone-400"}>{p.label}</span>
    <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} className="accent-amber-400" />
    <span className="text-right text-stone-300">{p.value}</span>
  </label>
);

// Face lab: show any expression directly and tune it, and the face tokens, by eye.
export function LabPanel({
  expression,
  onExpression,
  tokens,
  onTokens,
  overrides,
  onOverrides,
  longTurn,
  onLongTurn,
  subagents,
  onSubagents,
  disconnected,
  onDisconnected,
}: Props) {
  const [copied, setCopied] = useState(false);
  const changedTokens = (Object.keys(tokens) as (keyof FaceTokens)[]).filter((k) => tokens[k] !== defaultTokens[k]);
  const changedExpressions = Object.keys(overrides).length;

  const copy = async () => {
    const diff = {
      tokens: Object.fromEntries(changedTokens.map((k) => [k, tokens[k]])),
      expressions: overrides,
    };
    await navigator.clipboard.writeText(JSON.stringify(diff, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const look = lookupWith(overrides);
  const pill = (active: boolean) => `rounded-md px-2 py-1 text-xs ${active ? "bg-amber-400 font-semibold text-stone-950" : "bg-stone-800"}`;

  return (
    <Panel title="Face lab">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button onClick={() => onExpression(null)} className={pill(expression === null)}>
          live (from recording)
        </button>
        {expressionIds.map((id) => (
          <button key={id} onClick={() => onExpression(id)} className={pill(expression === id)}>
            {id}
            {overrides[id] ? " •" : ""}
          </button>
        ))}
      </div>

      <label className="mb-3 flex items-center gap-2 text-xs text-stone-400">
        <input type="checkbox" checked={longTurn} onChange={(e) => onLongTurn(e.target.checked)} />
        Preview a long turn (sweat drop grows on working faces)
      </label>

      <label className="mb-3 flex items-center gap-2 text-xs text-stone-400">
        <input type="checkbox" checked={disconnected} onChange={(e) => onDisconnected(e.target.checked)} />
        Disconnected from the Claude app (Bluetooth symbol, top left)
      </label>

      <label className="mb-3 flex items-center gap-2 text-xs text-stone-400">
        Subagents running
        <select
          value={subagents ?? ""}
          onChange={(e) => onSubagents(e.target.value === "" ? undefined : Number(e.target.value))}
          className="rounded-md border border-stone-700 bg-stone-900 px-1.5 py-0.5"
        >
          <option value="">from recording</option>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-stone-500">(spawned mini eyes)</span>
      </label>

      {expression && (
        <details open className="mb-2">
          <summary className="cursor-pointer text-xs text-stone-400">Tune "{expression}"</summary>
          <div className="mt-2 space-y-1.5">
            {expressionSliders.map(({ path, label, min, max, step }) => {
              const value = get(look(expression), path);
              const o = overrides[expression];
              const changed = !!o && get({ ...look(expression) }, path) !== get(lookupWith({})(expression), path);
              return (
                <Slider
                  key={path}
                  label={label}
                  value={value}
                  min={min}
                  max={max}
                  step={step}
                  changed={changed}
                  onChange={(v) => onOverrides({ ...overrides, [expression]: set(o ?? {}, path, v) })}
                />
              );
            })}
            {overrides[expression] && (
              <button
                onClick={() => {
                  const next = { ...overrides };
                  delete next[expression];
                  onOverrides(next);
                }}
                className="rounded-md bg-stone-800 px-2 py-1 text-xs"
              >
                Reset "{expression}"
              </button>
            )}
          </div>
        </details>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-stone-400">
          Face tokens {changedTokens.length ? `(${changedTokens.length} changed)` : ""}
        </summary>
        <div className="mt-2 space-y-1.5">
          {(Object.keys(tokenRanges) as (keyof FaceTokens)[]).map((key) => {
            const [min, max, step] = tokenRanges[key]!;
            return (
              <Slider
                key={key}
                label={key}
                value={tokens[key]}
                min={min}
                max={max}
                step={step}
                changed={tokens[key] !== defaultTokens[key]}
                onChange={(v) => onTokens({ ...tokens, [key]: v })}
              />
            );
          })}
          <button onClick={() => onTokens(defaultTokens)} className="mt-1 rounded-md bg-stone-800 px-2 py-1 text-xs">
            Reset tokens
          </button>
        </div>
      </details>

      <button
        onClick={copy}
        disabled={!changedTokens.length && !changedExpressions}
        className="mt-3 rounded-md bg-stone-800 px-2 py-1 text-xs disabled:opacity-40"
      >
        {copied ? "Copied" : "Copy changes for Claude"}
      </button>
    </Panel>
  );
}
