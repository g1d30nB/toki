#!/usr/bin/env node
// Cleans a Recraft sticker SVG into a master for the scrapbook and print
// (Phase 5, step 5.5; spec §9.7). Run:
//
//   node art/tools/clean-sticker.mjs <raw.svg> <name> [original.svg]
//
// (original.svg: when <raw.svg> is a human-edited copy, the untouched original
// to archive; edits are recorded in art/stickers/edits.json by the caller)
//
// writes art/stickers/<name>.svg and keeps the untouched original, with its
// content credentials (C2PA), as art/stickers/raw/<name>.svg: the record of what
// the model made, before human edits.
//
// Why (Gideon, 3 Oct): Recraft builds a sticker from hundreds of small pieces. Its
// white border is many fragments with hairline gaps, and faint grey "shadow"
// pieces sit round the edge: invisible on paper, a broken border with smudges on
// Toki's navy. So:
//   1. near-invisible pieces (fill-opacity < 0.5) and full-canvas backgrounds go;
//   2. every colour snaps to the palette (light greys to white, dark tones to navy,
//      mid greys to the slate used for shading);
//   3. one solid white silhouette goes under the whole design (every piece, drawn
//      white with a round stroke), and a navy outline inside it hugging the art,
//      like Toki's face and symbol stickers (Gideon, 21 Oct: the old thin navy edge
//      outside the white read as a stray hairline). No gaps are possible.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [, , input, name, maybeOriginal] = process.argv;
const original = maybeOriginal && !maybeOriginal.startsWith("--") ? maybeOriginal : undefined;
if (!input || !name || !/^[\w-]+$/.test(name)) {
  console.error("Usage: node art/tools/clean-sticker.mjs <raw.svg> <name>");
  process.exit(1);
}
// TOKI_ART_OUT lets a review round clean candidates somewhere else first.
const OUT = process.env.TOKI_ART_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "stickers");

// The lead palette (simulator/src/face/palette.ts), plus white and the blush pink.
const PALETTE = {
  white: [255, 255, 255],
  cream: [246, 236, 214],
  tomato: [228, 87, 46],
  mustard: [242, 177, 52],
  teal: [42, 157, 143],
  navy: [29, 43, 83],
  slate: [91, 107, 140],
  blush: [242, 174, 172],
};
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

function snap([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 510;
  // Greys (and near-greys) by lightness: they're border, shadow or shading.
  // Warm off-whites are cream (lettering, faces): only neutral whites stay white, or
  // cream letters vanish into the white border.
  if (max - min < 28) return light > 0.72 ? (r - b > 8 ? PALETTE.cream : PALETTE.white) : light < 0.32 ? PALETTE.navy : PALETTE.slate;
  let best = PALETTE.white;
  let bestD = Infinity;
  // Blush is only for genuinely pink tones (blue above green): beige lettering
  // must never turn pink.
  const pinkish = r > 190 && b > g + 6;
  for (const [k, c] of Object.entries(PALETTE)) {
    if (k === "blush" && !pinkish) continue;
    // Weighted RGB distance: close enough to how the eye ranks colours for six of them.
    const d = 2 * (r - c[0]) ** 2 + 4 * (g - c[1]) ** 2 + 3 * (b - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// Never overwrite a master that was edited by hand (art/stickers/edits.json "handEdited").
try {
  const edits = JSON.parse(readFileSync(join(OUT, "edits.json"), "utf8"));
  if (edits.handEdited?.[name] && !process.argv.includes("--force")) {
    console.error(`${name}.svg was edited by hand (${edits.handEdited[name].in}, ${edits.handEdited[name].on}); not overwriting it. Add --force to replace it anyway.`);
    process.exit(1);
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const raw = readFileSync(input, "utf8");
const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? "0 0 2048 2048";
const [, , vw, vh] = viewBox.split(/\s+/).map(Number);

// Each piece: <path [transform] fill="rgb(r,g,b)" [fill-opacity="x"] d="..."/>
const pieces = [];
let dropped = 0;
for (const m of raw.matchAll(/<path\b([^>]*?)\/>/g)) {
  const attrs = m[1];
  const d = /\sd="([^"]+)"/.exec(attrs)?.[1];
  const rgb = /fill="rgb\((\d+),(\d+),(\d+)\)"/.exec(attrs);
  const opacity = Number(/fill-opacity="([\d.]+)"/.exec(attrs)?.[1] ?? 1);
  const transform = /transform="([^"]+)"/.exec(attrs)?.[1];
  if (!d || !rgb || opacity < 0.5) {
    dropped++;
    continue;
  }
  // A background covering the whole canvas.
  if (/^M 0 0 L [\d.]+ 0 L [\d.]+ [\d.]+ L 0 [\d.]+ L 0 0 z$/.test(d.trim())) {
    dropped++;
    continue;
  }
  // Trim coordinates to one decimal: a third smaller, no visible difference at this scale.
  const short = d.replace(/(\d+\.\d)\d+/g, "$1");
  pieces.push({ d: short, transform, colour: hex(snap([+rgb[1], +rgb[2], +rgb[3]])) });
}

const outline = Math.round(Math.min(vw, vh) * 0.022); // the navy outline round the design
const border = Math.round(Math.min(vw, vh) * 0.04); // the white die-cut outside it
const t = (p) => (p.transform && p.transform !== "translate(0,0)" ? ` transform="${p.transform}"` : "");
// Pad the canvas so the new border never touches its edge.
const pad = outline + border + 4;
const out = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${vw + 2 * pad} ${vh + 2 * pad}">`,
  `<!-- ${name}: generated with Recraft V4.1 SVG (raw/${name}.svg), cleaned by art/tools/clean-sticker.mjs. Art: all rights reserved, see art/LICENSE. -->`,
  `<g fill="#ffffff" stroke="#ffffff" stroke-width="${2 * (outline + border)}" stroke-linejoin="round">`,
  ...pieces.map((p) => `<path${t(p)} d="${p.d}"/>`),
  `</g>`,
  `<g fill="${hex(PALETTE.navy)}" stroke="${hex(PALETTE.navy)}" stroke-width="${2 * outline}" stroke-linejoin="round">`,
  ...pieces.map((p) => `<path${t(p)} d="${p.d}"/>`),
  `</g>`,
  ...pieces.map((p) => `<path${t(p)} fill="${p.colour}" d="${p.d}"/>`),
  `</svg>`,
].join("\n");

mkdirSync(join(OUT, "raw"), { recursive: true });
copyFileSync(original ?? input, join(OUT, "raw", `${name}.svg`));
writeFileSync(join(OUT, `${name}.svg`), out + "\n");
const counts = pieces.reduce((a, p) => ((a[p.colour] = (a[p.colour] ?? 0) + 1), a), {});
console.log(`${name}: ${pieces.length} pieces kept, ${dropped} dropped; ${Math.round(out.length / 1024)} KB; colours ${JSON.stringify(counts)}`);
