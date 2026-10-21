import { renderCell } from "../dev/capture";
import { expressionIds, type ExpressionId } from "../face/expressions";
import { mix, palette } from "../face/palette";
import type { Moment, MomentKind } from "../state/moments";
// The real stickers (art/: all rights reserved, see art/LICENSE).

// Stickers (spec §9.4). Three kinds, for variety with meaning (Gideon, 3 Oct):
// - Face stickers: Toki's real face, for moments with character (long turns,
//   answers, errors, boops), rendered by the robot's own face renderer, die-cut.
// - Symbol stickers: the face's manpu as stickers in their own right, for everyday
//   work (www, magnifier, sweat drop, "…", mini eyes, >_) and quick wins (sparkles).
// - Event stickers: lettering placeholders for now (Phase 5.2) in the lead
//   palette. The hand-lettered set comes later (5.5, spec §9.7).

const faceCache = new Map<string, { url: string; aspect: number }>();

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** The face's silhouette, grown by r pixels and filled with one colour: the die-cut layers. */
function grown(src: HTMLCanvasElement, r: number, colour: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext("2d")!;
  // Stamp the shape at offsets round a circle (and two inner rings so nothing is
  // missed), every 1.5 px of the circle: 24 stamps left a scalloped, spiky edge on
  // sharp shapes like the sparkles, hidden only while stickers had a soft shadow.
  for (const k of [1, 0.66, 0.33]) {
    const n = Math.max(24, Math.ceil((2 * Math.PI * r * k) / 1.5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.drawImage(src, Math.cos(a) * r * k, Math.sin(a) * r * k);
    }
  }
  // Firm up the edge: stamps of the shape's soft (anti-aliased) rim leave a faint,
  // half-transparent haze at the outside, grey on paper. A steep curve keeps a
  // pixel or two of smoothing and drops the haze.
  const img = g.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  for (let i = 3; i < px.length; i += 4) px[i] = Math.max(0, Math.min(255, (px[i] - 40) * 3));
  g.putImageData(img, 0, 0);
  // ...then flood it with the colour, keeping the shape.
  g.globalCompositeOperation = "source-in";
  g.fillStyle = colour;
  g.fillRect(0, 0, out.width, out.height);
  return out;
}

/**
 * Toki's face as a die-cut sticker (spec §9.4): rendered once per expression by
 * the robot's own face renderer, cut out of its screen, then given a sticker shape
 * round it. Kawaii pass (21 Oct; Gideon's sticker-sheet reference): the screen is
 * cream now, so the features are cut from it and set on a round cream body (a
 * circle, as in the reference; an oval didn't suit Toki) with a navy outline, a
 * warm shade along the bottom, a gloss highlight, and a white die-cut border.
 */
export function faceSticker(face: string): { url: string; aspect: number } {
  const hit = faceCache.get(face);
  if (hit) return hit;
  const { url, aspect } = mochi(faceCut(face), kindOfFace(face));
  const result = { url, aspect };
  faceCache.set(face, result);
  return result;
}

/** Toki's features for a face, cut out of the robot's own rendering of its screen. */
function faceCut(face: string): HTMLCanvasElement {
  const screen = renderCell({ label: face, expression: face as ExpressionId, atMs: 1_200, lab: { hideChrome: true } });
  // Cut the face out: the flat cream screen becomes transparent.
  const pad = 40;
  const cut = document.createElement("canvas");
  cut.width = 320 + pad * 2;
  cut.height = 240 + pad * 2;
  const cg = cut.getContext("2d")!;
  cg.drawImage(screen, pad, pad);
  const img = cg.getImageData(0, 0, cut.width, cut.height);
  const [gr, gg, gb] = hex(palette.face);
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i] - gr) + Math.abs(img.data[i + 1] - gg) + Math.abs(img.data[i + 2] - gb) < 18) img.data[i + 3] = 0;
  }
  cg.putImageData(img, 0, 0);
  return cut;
}

/**
 * A lettered sticker drawn in code (Gideon, 21 Oct: the generated OOPS art didn't
 * match the kawaii stickers): the word in Baloo 2 ExtraBold, Toki's own typeface,
 * each letter in its own colour with a gloss and the faces' bottom shade, bouncing
 * and tilting a little; one chunky navy outline round them all; Toki's face tucked
 * in at the end; the white die-cut round everything.
 */
const letterCache = new Map<string, { url: string; aspect: number }>();
export function letterSticker(text: string, colours: string[], face?: string): { url: string; aspect: number } {
  const key = `${text}|${colours.join()}|${face ?? ""}`;
  const hit = letterCache.get(key);
  if (hit) return hit;
  const size = 150;
  const font = `800 ${size}px "Baloo 2"`;
  const pen = 17; // the navy outline round the letters
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  // Lines (split at "\n"), each centred under the widest; Toki to the right of them all.
  const kern = -6;
  const lineH = size * 1.02;
  const lines = text.split("\n").map((t) => {
    // Spaces wide enough to survive the fat outline.
    const widths = [...t].map((ch) => (ch === " " ? size * 0.38 : m.measureText(ch).width));
    return { t, widths, w: widths.reduce((a, w) => a + w + kern, 0) - kern };
  });
  const block = Math.max(...lines.map((l) => l.w));
  const d = face ? (lines.length > 1 ? 230 : 190) : 0; // Toki's head
  const W = block + (face ? d - 4 : 0) + 200;
  const H = lines.length * lineH + size * 0.35 + 200;
  const c = document.createElement("canvas");
  c.width = Math.ceil(W);
  c.height = Math.ceil(H);
  const g = c.getContext("2d")!;
  // Each letter's place: a little bounce and tilt, the same every time; colours run
  // through the letters, skipping spaces.
  const placed: { ch: string; x: number; y: number; w: number; tilt: number; colour: string }[] = [];
  let n = 0;
  lines.forEach((l, k) => {
    let x = 100 + (block - l.w) / 2;
    const base = 100 + size * 0.8 + k * lineH;
    [...l.t].forEach((ch, i) => {
      if (ch !== " ") {
        placed.push({ ch, x: x + l.widths[i] / 2, y: base + [0, -10, 4, -6, 8, -4][n % 6], w: l.widths[i], tilt: [-0.07, 0.05, -0.03, 0.06, -0.05, 0.04][n % 6], colour: colours[n % colours.length] });
        n++;
      }
      x += l.widths[i] + kern;
    });
  });
  const at = (p: (typeof placed)[number], draw: (gg: CanvasRenderingContext2D) => void, gg = g) => {
    gg.save();
    gg.translate(p.x, p.y);
    gg.rotate(p.tilt);
    gg.font = font;
    gg.textAlign = "center";
    gg.textBaseline = "alphabetic";
    draw(gg);
    gg.restore();
  };
  // The outline: every letter stroked fat in navy, merging into one plate.
  for (const p of placed)
    at(p, (gg) => {
      gg.lineJoin = "round";
      gg.lineWidth = pen * 2;
      gg.strokeStyle = palette.line;
      gg.strokeText(p.ch, 0, 0);
      gg.fillStyle = palette.line;
      gg.fillText(p.ch, 0, 0);
    });
  // Then each letter on its own layer: its colour, the bottom shade, a gloss.
  for (const p of placed) {
    const l = document.createElement("canvas");
    l.width = c.width;
    l.height = c.height;
    const lg = l.getContext("2d")!;
    at(p, (gg) => {
      gg.fillStyle = p.colour;
      gg.fillText(p.ch, 0, 0);
    }, lg);
    shade(l, 6, 9);
    lg.globalCompositeOperation = "source-atop";
    lg.fillStyle = "rgba(255,255,255,0.85)";
    lg.beginPath();
    // On the top-left shoulder, rotated with the letter.
    const gx = -p.w * 0.3;
    const gy = -size * 0.58;
    lg.ellipse(p.x + gx * Math.cos(p.tilt) - gy * Math.sin(p.tilt), p.y + gx * Math.sin(p.tilt) + gy * Math.cos(p.tilt), size * 0.045, size * 0.085, 0.55 + p.tilt, 0, Math.PI * 2);
    lg.fill();
    g.drawImage(l, 0, 0);
  }
  // Toki, small, against the end of the word.
  if (face) {
    const { canvas: h } = mochi(faceCut(face), kindOfFace(face), false);
    const mid = 100 + (lines.length * lineH) / 2 + size * 0.12;
    g.drawImage(h, 100 + block - 12, mid - d / 2, d, d);
  }
  const result = dieCut(c, 0, 20);
  letterCache.set(key, result);
  return result;
}

/** Sticker linework (Gideon's reference): a medium navy outline, then a white die-cut border. */
const OUTLINE = 8;
const BORDER = 13;

/**
 * Three kinds of round face sticker (Gideon's references, 21 Oct), so a page of them
 * feels varied; each face always gets the same kind:
 * - soft: a strong shadow crescent down the right, a curved gloss streak (the crown)
 * - cool: the soft kind's shadow in pale blue, two round gloss dots
 * - bubble: a clean body with two round gloss dots, big and small
 */
type RoundKind = "soft" | "cool" | "bubble";
const ROUND_KINDS: RoundKind[] = ["soft", "cool", "bubble"];
// In turn down the list of faces, so each kind gets a third of them.
const kindOfFace = (face: string): RoundKind => ROUND_KINDS[Math.max(0, expressionIds.indexOf(face as ExpressionId)) % 3];

/** The face's features on a round cream body fitted round them. */
function mochi(cut: HTMLCanvasElement, kind: RoundKind, border = true): { url: string; aspect: number; canvas: HTMLCanvasElement } {
  const data = cut.getContext("2d")!.getImageData(0, 0, cut.width, cut.height).data;
  let x0 = cut.width, y0 = cut.height, x1 = 0, y1 = 0;
  for (let y = 0; y < cut.height; y++)
    for (let x = 0; x < cut.width; x++)
      if (data[(y * cut.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  // A circle round the features: just past the furthest drawn pixel from their centre.
  const fx = (x0 + x1 + 1) / 2;
  const fy = (y0 + y1 + 1) / 2;
  let far = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (data[(y * cut.width + x) * 4 + 3] > 8) far = Math.max(far, Math.hypot(x - fx, y - fy));
  const R = far + 10;
  const edge = OUTLINE + BORDER;
  const out = document.createElement("canvas");
  out.width = out.height = Math.ceil((R + edge) * 2);
  const g = out.getContext("2d")!;
  const c = out.width / 2;
  const disc = (r: number, colour: string, dx = 0, dy = 0) => {
    g.fillStyle = colour;
    g.beginPath();
    g.arc(c + dx, c + dy, r, 0, Math.PI * 2);
    g.fill();
  };
  const dot = (ax: number, ay: number, r: number) => disc(r, "#ffffff", ax * R, ay * R);
  if (border) disc(R + edge, "#ffffff");
  disc(R + OUTLINE, palette.line);
  g.save();
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.clip();
  if (kind === "soft") {
    // A strong shadow crescent down the right and bottom, then a curved gloss streak.
    disc(R, mix(palette.face, palette.cheek, 0.38));
    disc(R * 0.94, palette.face, -R * 0.12, -R * 0.09);
    g.strokeStyle = "#ffffff";
    g.lineCap = "round";
    g.lineWidth = R * 0.07;
    g.beginPath();
    g.arc(c, c, R * 0.78, Math.PI * 1.13, Math.PI * 1.36);
    g.stroke();
    dot(-0.3, -0.8, R * 0.035);
  } else if (kind === "cool") {
    // The soft kind's shadow in a pale blue (Gideon, 21 Oct: the crescent didn't work),
    // with two round gloss dots, so the three kinds differ at a glance.
    disc(R, mix(palette.face, palette.water, 0.3));
    disc(R * 0.94, palette.face, -R * 0.12, -R * 0.09);
    dot(-0.5, -0.55, R * 0.09);
    dot(-0.3, -0.72, R * 0.045);
  } else {
    // Clean, with a faint shade and two round gloss dots.
    disc(R, mix(palette.face, palette.cheek, 0.16));
    disc(R * 0.97, palette.face, -R * 0.04, -R * 0.05);
    dot(-0.48, -0.56, R * 0.11);
    dot(-0.24, -0.74, R * 0.055);
  }
  g.restore();
  g.drawImage(cut, c - fx, c - fy);
  return { url: border ? out.toDataURL("image/png") : "", aspect: 1, canvas: out };
}

/**
 * The faces' shading on any drawing (Gideon, 21 Oct): a soft band along its lower
 * right edges, where the light from the top left doesn't reach. The band is the
 * drawing's silhouette less itself nudged up and left, laid over the drawing in a
 * translucent navy (multiplied, so each colour darkens in its own hue).
 */
function shade(c: HTMLCanvasElement, dx = 7, dy = 11) {
  const band = document.createElement("canvas");
  band.width = c.width;
  band.height = c.height;
  const b = band.getContext("2d")!;
  b.drawImage(c, 0, 0);
  b.globalCompositeOperation = "source-in";
  b.fillStyle = palette.line;
  b.fillRect(0, 0, band.width, band.height);
  b.globalCompositeOperation = "destination-out";
  b.drawImage(c, -dx, -dy);
  const g = c.getContext("2d")!;
  g.save();
  g.globalCompositeOperation = "multiply";
  g.globalAlpha = 0.16;
  g.drawImage(band, 0, 0);
  g.restore();
}

/**
 * Any drawing (on a transparent canvas, with room round it) as a die-cut sticker:
 * from the outside in, a white die-cut border, a navy outline (none for drawings
 * that are navy already), then the drawing. Trimmed to what's there. Was a thick
 * navy backing inside a cream border (Gideon, 21 Oct: too heavy).
 */
function dieCut(cut: HTMLCanvasElement, outline = OUTLINE, border = BORDER): { url: string; aspect: number } {
  const sticker = document.createElement("canvas");
  sticker.width = cut.width;
  sticker.height = cut.height;
  const sg = sticker.getContext("2d")!;
  sg.drawImage(grown(cut, outline + border, "#ffffff"), 0, 0);
  if (outline > 0) sg.drawImage(grown(cut, outline, palette.line), 0, 0);
  sg.drawImage(cut, 0, 0);
  // Trim to what's there.
  const data = sg.getImageData(0, 0, sticker.width, sticker.height).data;
  let x0 = sticker.width, y0 = sticker.height, x1 = 0, y1 = 0;
  for (let y = 0; y < sticker.height; y++)
    for (let x = 0; x < sticker.width; x++)
      if (data[(y * sticker.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const trimmed = document.createElement("canvas");
  trimmed.width = Math.max(1, x1 - x0 + 1);
  trimmed.height = Math.max(1, y1 - y0 + 1);
  trimmed.getContext("2d")!.drawImage(sticker, -x0, -y0);
  return { url: trimmed.toDataURL("image/png"), aspect: trimmed.width / trimmed.height };
}

export type SymbolKind = "www" | "magnifier" | "sweat" | "dots" | "minis" | "terminal" | "sparkles" | "frame" | "page" | "envelope";

const symbolCache = new Map<SymbolKind, { url: string; aspect: number }>();

/** A four-point star with concave sides, like done's sparkles. */
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  g.fillStyle = c;
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    g.lineTo(x + Math.sign(cx) * Math.abs(cx) ** (2 / 0.62) * r, y + Math.sign(cy) * Math.abs(cy) ** (2 / 0.62) * r);
  }
  g.fill();
}

/** The manpu, drawn big on their own, then die-cut like the faces. */
export function symbolSticker(kind: SymbolKind): { url: string; aspect: number } {
  const hit = symbolCache.get(kind);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 260;
  c.height = 200;
  const g = c.getContext("2d")!;
  g.lineCap = "round";
  g.lineJoin = "round";
  const line = (pts: [number, number][], w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  switch (kind) {
    case "www":
      // On a pale water-blue tag.
      g.fillStyle = mix(palette.water, "#ffffff", 0.7);
      g.beginPath();
      g.roundRect(44, 52, 172, 90, 30);
      g.fill();
      for (let i = 0; i < 3; i++) {
        const x0 = 62 + i * 48;
        const y0 = 82 - (i === 1 ? 10 : 0);
        line([[x0, y0], [x0 + 10, y0 + 34], [x0 + 20, y0 + 12], [x0 + 30, y0 + 34], [x0 + 40, y0]], 8, palette.line);
      }
      break;
    case "magnifier":
      // As on the face: a water-blue rim and handle, a pale glass with a glint.
      g.fillStyle = mix(palette.water, "#ffffff", 0.75);
      g.beginPath();
      g.arc(118, 88, 38, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = palette.water;
      g.lineWidth = 10;
      g.stroke();
      line([[148, 118], [178, 148]], 15, palette.water);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 6;
      g.beginPath();
      g.arc(118, 88, 24, Math.PI * 1.1, Math.PI * 1.45);
      g.stroke();
      break;
    case "sweat": {
      g.fillStyle = palette.water;
      g.beginPath();
      g.moveTo(130, 44);
      g.bezierCurveTo(150, 80, 168, 104, 168, 124);
      g.arc(130, 124, 38, 0, Math.PI);
      g.bezierCurveTo(92, 104, 110, 80, 130, 44);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(116, 128, 9, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "dots":
      // In a white thought bubble, its tail at the bottom left.
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(130, 96, 92, 54, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(62, 160, 13, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 3; i++) {
        g.fillStyle = palette.line;
        g.beginPath();
        g.arc(86 + i * 44, 100, 15, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case "minis":
      // Two little faces, a pair of eyes each with little brows: subagents.
      for (const [cx, cy, s] of [
        [92, 104, 1],
        [170, 92, 0.85],
      ] as const)
        for (const side of [-1, 1]) {
          const x = cx + side * 20 * s;
          // Each little face on its own small cream head.
          if (side === -1) {
            g.fillStyle = palette.face;
            g.beginPath();
            g.ellipse(cx, cy - 2 * s, 44 * s, 40 * s, 0, 0, Math.PI * 2);
            g.fill();
          }
          // As on the face: navy eyes with a white shine, navy brows.
          g.fillStyle = palette.line;
          g.beginPath();
          g.arc(x, cy, 16 * s, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#ffffff";
          g.beginPath();
          g.arc(x - 4 * s, cy - 5 * s, 5.5 * s, 0, Math.PI * 2);
          g.fill();
          line([[x - side * 10 * s, cy - 28 * s], [x + side * 10 * s, cy - 24 * s]], 5 * s, palette.line);
        }
      break;
    case "terminal":
      // On a little pale teal screen.
      g.fillStyle = mix(palette.teal, "#ffffff", 0.72);
      g.beginPath();
      g.roundRect(46, 46, 168, 108, 24);
      g.fill();
      g.fillStyle = palette.line;
      g.font = "800 84px ui-monospace, Menlo, monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(">_", 130, 100);
      break;
    case "sparkles":
      // As on done's face: all three mustard.
      star(g, 108, 100, 46, palette.mustard);
      star(g, 172, 62, 26, palette.mustard);
      star(g, 178, 138, 18, palette.mustard);
      break;
    // Kinds of work beyond code (Work Report reference, 15 Oct). Each sits at a slight
    // tilt, like a sticker slapped on, and stays in Toki's five colours.
    case "frame": {
      // Images: a mustard frame round a teal sky, a cream sun and tomato hills.
      g.translate(130, 100);
      g.rotate(-0.07);
      g.fillStyle = palette.mustard;
      g.beginPath();
      g.roundRect(-78, -58, 156, 116, 10);
      g.fill();
      g.fillStyle = palette.teal;
      g.fillRect(-62, -42, 124, 84);
      g.fillStyle = palette.cream;
      g.beginPath();
      g.arc(30, -18, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = palette.tomato;
      g.beginPath();
      g.moveTo(-62, 42);
      g.lineTo(-24, -6);
      g.lineTo(4, 22);
      g.lineTo(26, 4);
      g.lineTo(62, 42);
      g.closePath();
      g.fill();
      g.setTransform(1, 0, 0, 1, 0, 0);
      break;
    }
    case "page": {
      // Documents: a cream page, its corner folded, lines of navy text.
      g.translate(130, 100);
      g.rotate(0.06);
      g.fillStyle = palette.cream;
      g.beginPath();
      g.moveTo(-52, -70);
      g.lineTo(26, -70);
      g.lineTo(52, -44);
      g.lineTo(52, 70);
      g.lineTo(-52, 70);
      g.closePath();
      g.fill();
      g.fillStyle = palette.mustard;
      g.beginPath();
      g.moveTo(26, -70);
      g.lineTo(26, -44);
      g.lineTo(52, -44);
      g.closePath();
      g.fill();
      for (const [y, w] of [[-34, 52], [-12, 84], [10, 84], [32, 62]] as const) line([[-34, y], [-34 + w, y]], 7, palette.navy);
      g.setTransform(1, 0, 0, 1, 0, 0);
      break;
    }
    case "envelope": {
      // Email: a tomato envelope, its flap drawn in cream.
      g.translate(130, 100);
      g.rotate(0.08);
      g.fillStyle = palette.tomato;
      g.beginPath();
      g.roundRect(-80, -52, 160, 104, 9);
      g.fill();
      line([[-70, -42], [0, 10], [70, -42]], 8, palette.cream);
      line([[-70, 42], [-24, 0]], 6, palette.cream);
      line([[70, 42], [24, 0]], 6, palette.cream);
      g.setTransform(1, 0, 0, 1, 0, 0);
      break;
    }
  }
  shade(c);
  // Symbols are drawn big and shown small (about a third of a face's scale), so their
  // linework is heavier to match the faces' on the page.
  const result = dieCut(c, 9, 15);
  symbolCache.set(kind, result);
  return result;
}

/** Everyday work as symbols: the activity's manpu (run gets its own, >_). */
export const ACTIVITY_SYMBOL: Record<string, SymbolKind> = {
  web: "www",
  search: "magnifier",
  test: "sweat",
  think: "dots",
  subagent: "minis",
  run: "terminal",
};

/** A turn's kind of work, when it isn't code: its own symbol (research is the www wave). */
export const KIND_SYMBOL: Record<string, SymbolKind> = {
  images: "frame",
  documents: "page",
  email: "envelope",
  research: "www",
};

/**
 * `art`: the sticker, drawn on first use. Since 21 Oct every lettered sticker is
 * drawn in code (letterSticker), each with Toki's face for the moment; the generated
 * art from step 5.5 stays in art/stickers for reference.
 */
type EventStyle = { text: (m: Moment) => string; bg: string; fg: string; art?: () => { url: string; aspect: number } };

const { tomato: T, mustard: M, teal: E, cream: C, water: B } = palette;
const drawn = (text: string, colours: string[], face?: string) => () => letterSticker(text, colours, face);

// The catalogue's wording where it fits (spec §9.4).
export const EVENT_STICKERS: Partial<Record<MomentKind, EventStyle>> = {
  hello: { text: () => "HELLO WORLD", bg: M, fg: palette.ink, art: drawn("HELLO\nWORLD", [T, M, E, B, C], "boop") },
  met: { text: () => "NICE TO MEET YOU", bg: E, fg: C, art: drawn("NICE TO\nMEET YOU!", [E, M, T, C], "done") },
  "your-turn": { text: (m) => `YOUR TURN · ${m.n ?? 5} MIN`, bg: T, fg: C, art: drawn("YOUR\nTURN!!", [T, M, E, C], "blocked") },
  shipped: { text: () => "SHIPPED!!", bg: T, fg: C, art: drawn("SHIPPED!!", [T, M, E, C, B], "closed") },
  error: { text: () => "OOPS!!", bg: T, fg: C, art: drawn("OOPS!!", [T, M, E, C, E, M], "error") },
  "context-full": { text: () => "CONTEXT FULL", bg: C, fg: T, art: drawn("CONTEXT\nFULL!", [C, T, M, E], "test") },
  yolo: { text: () => "YOLO MODE", bg: M, fg: palette.ink, art: drawn("YOLO\nMODE", [M, T, E, C], "edit") },
  plan: { text: () => "PLAN MODE", bg: E, fg: C, art: drawn("PLAN\nMODE", [E, C, M, B], "think") },
  quiet: { text: () => "LEAVE ME ALONE!!", bg: C, fg: palette.ink, art: drawn("LEAVE ME\nALONE!!", [B, C, M, T], "quiet") },
  closed: { text: (m) => (m.detail === "earned" ? "CLOSED" : "zzz"), bg: T, fg: C, art: drawn("CLOSED", [T, M, E, C], "approved") },
  subagents: { text: (m) => `SUBAGENTS ×${m.n ?? 1}`, bg: E, fg: C, art: drawn("SUBAGENTS", [E, M, T, C], "subagent") },
  denied: { text: () => "NOPE!", bg: C, fg: T, art: drawn("NOPE!", [T, M, E, C], "denied") },
  always: { text: () => "ALWAYS", bg: E, fg: C, art: drawn("ALWAYS", [E, M, T, B, C], "idle") },
  question: { text: () => "?", bg: E, fg: C, art: drawn("?", [B]) },
};

/** The quiet close (the day closed itself, or without much done) gets zzz, not CLOSED. */
export const QUIET_CLOSE_ART = drawn("Zzz", [B, C, B], "sleepy");

/** A drawn event sticker's width over height, or undefined where there's no canvas (tests). */
export function eventAspect(m: Moment): number | undefined {
  const ev = EVENT_STICKERS[m.kind];
  if (!ev?.art || typeof document === "undefined") return undefined;
  return (m.kind === "closed" && m.detail !== "earned" ? QUIET_CLOSE_ART : ev.art)().aspect;
}

/** How big a moment's sticker is, in page units (1000 wide): events loud, routine work small. */
export function stickerSize(m: Moment): number {
  if (EVENT_STICKERS[m.kind]) return 1;
  switch (m.kind) {
    case "work":
      return 0.42;
    case "asked":
      return 0.55; // a turn: it grows with the work done
    case "boop":
      return 0.45;
    case "done":
      return 0.55;
    default:
      return 0.6; // approved, blocked and the like
  }
}

const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** What hovering a sticker says: its moment, in plain words. */
export function describe(m: Moment): string {
  const what: Record<MomentKind, string> = {
    hello: "first session of the day",
    met: "the day you met Toki",
    shipped: "shipped: a push or a merge",
    asked: m.n ? `you asked Claude · ${m.n} tool call${m.n === 1 ? "" : "s"}` : "you asked Claude",
    work: `working: ${m.detail ?? "?"}${m.n && m.n > 1 ? ` ×${m.n}` : ""}`,
    blocked: `needed your permission${m.detail ? ` (${m.detail})` : ""}`,
    approved: m.n ? `approved after ${m.n} min` : "approved",
    denied: "denied",
    always: "always allowed",
    question: "asked you a question",
    "your-turn": `waited ${m.n} min for you`,
    error: `something failed${m.detail ? ` (${m.detail})` : ""}`,
    done: "finished",
    subagents: `${m.n} subagents`,
    "context-full": "context full: compacted",
    yolo: "YOLO mode on",
    plan: "plan mode on",
    quiet: "quiet mode",
    closed: m.detail === "earned" ? "you closed the day (earned)" : "you closed the day",
    boop: m.n && m.n > 1 ? `boop ×${m.n}` : "boop",
  };
  return `${time(m.t)} · ${what[m.kind]}${m.project ? ` · ${m.project}` : ""}`;
}
