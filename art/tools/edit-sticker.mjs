#!/usr/bin/env node
// Human edits to a generated sticker, by region (Phase 5, step 5.5), applied to
// the raw SVG before clean-sticker.mjs. Every edit is recorded in
// art/stickers/edits.json, so the masters document what a person changed (spec
// §9.7: human selection and editing strengthen any claim to the art).
//
//   node art/tools/edit-sticker.mjs <raw.svg> <out.svg> '<ops JSON>'
//
// ops: [{ "remove": [x0, y0, x1, y1] }                       pieces wholly inside the box go
//       { "recolour": [x0, y0, x1, y1], "to": "#e4572e",       pieces wholly inside the box,
//         "where": "light" | "dark" | "any",                   of that lightness (or near the
//         "match": "#2a9d8f" }                                 "match" colour), change colour
//       { "patch": [[x0, y0, x1, y1], ...], "to": "#403f69",   rectangles drawn just after the
//         "after": n }                                          n-th piece (to fill what a removal uncovers)
//       { "cut": [x0, y0, x1, y1] }]                           in every outline, the run of points inside
//                                                               the box is dropped and its ends joined with
//                                                               a straight line (trims a limb off an outline)
// Coordinates are the SVG's own (its viewBox); a piece's box comes from its path.

import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output, opsJson] = process.argv;
if (!input || !output || !opsJson) {
  console.error("Usage: node art/tools/edit-sticker.mjs <raw.svg> <out.svg> '<ops JSON>'");
  process.exit(1);
}
const ops = JSON.parse(opsJson);
const svg = readFileSync(input, "utf8");

function box(d) {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]);
    x1 = Math.max(x1, nums[i]);
    y0 = Math.min(y0, nums[i + 1]);
    y1 = Math.max(y1, nums[i + 1]);
  }
  return [x0, y0, x1, y1];
}
const inside = (b, r) => b[0] >= r[0] && b[1] >= r[1] && b[2] <= r[2] && b[3] <= r[3];
const lightness = (attrs) => {
  const m = /fill="rgb\((\d+),(\d+),(\d+)\)"/.exec(attrs);
  return m ? (Math.max(+m[1], +m[2], +m[3]) + Math.min(+m[1], +m[2], +m[3])) / 510 : 0.5;
};

let removed = 0, recoloured = 0, index = -1;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
const patchesAfter = (n) =>
  ops
    .filter((op) => op.patch && op.after === n)
    .flatMap((op) => op.patch.map(([x0, y0, x1, y1]) => `<path fill="rgb(${rgb(op.to)})" d="M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} z"/>`))
    .join("");
const out = svg.replace(/<path\b([^>]*?)\/>/g, (whole, attrs) => {
  index++;
  const extra = patchesAfter(index);
  const res = edit(whole, attrs);
  return res + extra;
});

/** Drops each run of segments that end inside `r`, joining the gap with a straight line. */
function cut(d, r) {
  const segs = d.match(/[MLCz][^MLCz]*/g) ?? [];
  const end = (seg) => {
    const n = (seg.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    return n.length >= 2 ? [n[n.length - 2], n[n.length - 1]] : null;
  };
  const isIn = (p) => p && p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
  const out = [];
  let cutting = false;
  for (const seg of segs) {
    const p = end(seg);
    if (seg[0] !== "M" && seg[0] !== "z" && isIn(p)) {
      cutting = true;
      continue;
    }
    if (cutting && p && seg[0] !== "z") {
      out.push(`L ${p[0]} ${p[1]} `);
      cutting = false;
      continue;
    }
    cutting = false;
    out.push(seg);
  }
  return out.join("");
}

function edit(whole, attrs) {
  let d = /\sd="([^"]+)"/.exec(attrs)?.[1];
  if (!d) return whole;
  for (const op of ops)
    if (op.cut) {
      const trimmed = cut(d, op.cut);
      if (trimmed !== d) {
        attrs = attrs.replace(d, trimmed);
        d = trimmed;
        recoloured += 0;
      }
    }
  const b = box(d);
  let a = attrs;
  for (const op of ops) {
    if (op.remove && inside(b, op.remove)) {
      removed++;
      return "";
    }
    if (op.recolour && inside(b, op.recolour)) {
      const l = lightness(a);
      let ok = !op.where || op.where === "any" || (op.where === "light" ? l > 0.5 : l <= 0.5);
      // "match": only pieces close to this colour (so a sparkle turns red, not the border round it).
      if (op.match) {
        const m = /fill="rgb\((\d+),(\d+),(\d+)\)"/.exec(a);
        const t = [1, 3, 5].map((i) => parseInt(op.match.slice(i, i + 2), 16));
        ok = ok && !!m && Math.hypot(+m[1] - t[0], +m[2] - t[1], +m[3] - t[2]) < (op.tolerance ?? 60);
      }
      if (ok) {
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(op.to.slice(i, i + 2), 16));
        a = a.replace(/fill="rgb\([^)]*\)"/, `fill="rgb(${r},${g},${bl})"`);
        recoloured++;
      }
    }
  }
  return `<path${a}/>`;
}
writeFileSync(output, out);
console.log(`${removed} pieces removed, ${recoloured} recoloured`);
