import { expressionIds, type ExpressionId } from "../face/expressions";
import { Gfx } from "../face/gfx";
import { FaceRenderer, type Lab } from "../face/render";
import { defaultTokens } from "../face/tokens";
import { initialState } from "../state/agentState";

// Off-screen captures for design review. Renders each cell by stepping the
// animation clock directly (no requestAnimationFrame), so it works even when
// the browser tab is hidden, and every capture is reproducible.

export type CaptureCell = {
  label: string;
  expression: ExpressionId;
  atMs?: number; // how long after the expression begins (default 1500 ms)
  lab?: Partial<Lab>;
  /** Lab settings that change over time, e.g. subagents arriving: ms since the switch. */
  labAt?: (ms: number) => Partial<Lab>;
  filter?: string; // canvas filter, e.g. greyscale and blur for edge of vision
  scale?: number; // drawn size, 1 = 320 x 240
};

export function renderCell(cell: CaptureCell): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 240;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const g = new Gfx(ctx);
  const face = new FaceRenderer();
  const lab: Lab = { expression: cell.expression, tokens: defaultTokens, overrides: {}, ...cell.lab };
  const state = initialState();
  // Start on a neutral face, switch at t = 1000 ms, then step at 60 fps to the moment.
  const switchAt = 1000;
  const end = switchAt + (cell.atMs ?? 1500);
  for (let t = 0; t <= end; t += 1000 / 60) {
    const timed = cell.labAt ? { ...lab, ...cell.labAt(t - switchAt) } : lab;
    face.draw(g, state, t, t < switchAt ? { ...timed, expression: "working" } : timed);
  }
  return c;
}

export function captureSheet(title: string, cells: CaptureCell[], cols: number): string {
  const scale = cells[0]?.scale ?? 1;
  const W = 320 * scale;
  const H = 240 * scale;
  const pad = 16;
  const lab = 26;
  const rows = Math.ceil(cells.length / cols);
  const out = document.createElement("canvas");
  out.width = cols * (W + pad) + pad;
  out.height = 48 + rows * (H + lab + pad);
  const x = out.getContext("2d")!;
  x.fillStyle = "#0c0a09";
  x.fillRect(0, 0, out.width, out.height);
  x.fillStyle = "#e7e5e4";
  x.font = "600 20px system-ui";
  x.fillText(title, pad, 32);
  cells.forEach((cell, i) => {
    const cx = pad + (i % cols) * (W + pad);
    const cy = 48 + Math.floor(i / cols) * (H + lab + pad);
    x.save();
    if (cell.filter) x.filter = cell.filter;
    x.imageSmoothingEnabled = cell.lab?.edges !== "crisp";
    x.drawImage(renderCell(cell), cx, cy, W, H);
    x.restore();
    x.fillStyle = "#a8a29e";
    x.font = "14px ui-monospace, Menlo, monospace";
    x.fillText(cell.label, cx, cy + H + 18);
  });
  return out.toDataURL("image/png");
}

export async function saveCapture(name: string, dataUrl: string) {
  const r = await fetch(`/api/capture/${encodeURIComponent(name)}`, { method: "POST", body: dataUrl });
  return r.text();
}

export const allCells = (): CaptureCell[] => expressionIds.map((id) => ({ label: id, expression: id }));
