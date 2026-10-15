// A small drawing API shaped like M5GFX (the robot's graphics library), so code
// written against it in the browser ports to the firmware almost line for line.
// Only primitives M5GFX has natively: no paths, gradients or shadows.

// All of Toki's text is Baloo 2 (Gideon, 15 Oct: to match the cute face), as on
// the robot, where it's a smooth (anti-aliased) M5GFX font in four cuts: bold and
// medium, 28 and 22 px (firmware/fonts/make-vlw.py). Bundled in src/fonts, never
// fetched. `mono` is kept in the API but no longer changes the face.
const BALOO = '"Baloo 2", ui-rounded, system-ui, sans-serif';
const PRINTABLE = Array.from({ length: 0x5e }, (_, i) => String.fromCharCode(0x21 + i)).join("");

export type Datum = "top_left" | "top_center" | "middle_center" | "bottom_center";

export class Gfx {
  readonly width = 320;
  readonly height = 240;

  constructor(private ctx: CanvasRenderingContext2D) {}

  /** Like M5GFX setClipRect: later drawing only lands inside this rectangle. */
  setClipRect(x: number, y: number, w: number, h: number) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
  }

  clearClipRect() {
    this.ctx.restore();
  }

  /**
   * Draws the frame so far, magnified by `zoom` about (cx, cy), inside a circle
   * of radius r: a see-through lens. On the robot: read the source rect into a
   * small sprite, pushRotateZoom it into a lens sprite, mask outside the circle
   * with the transparent colour, and push it with transparency.
   */
  magnify(cx: number, cy: number, r: number, zoom: number) {
    const s = r / zoom;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.clip();
    this.ctx.drawImage(this.ctx.canvas, cx - s, cy - s, s * 2, s * 2, cx - r, cy - r, r * 2, r * 2);
    this.ctx.restore();
  }

  fillScreen(c: string) {
    this.fillRect(0, 0, this.width, this.height, c);
  }

  fillRect(x: number, y: number, w: number, h: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, w, h);
  }

  fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
    this.ctx.fill();
  }

  drawRoundRect(x: number, y: number, w: number, h: number, r: number, c: string, thickness = 1) {
    this.ctx.strokeStyle = c;
    this.ctx.lineWidth = thickness;
    this.ctx.beginPath();
    this.ctx.roundRect(x + thickness / 2, y + thickness / 2, w - thickness, h - thickness, r);
    this.ctx.stroke();
  }

  fillCircle(x: number, y: number, r: number, c: string) {
    this.fillEllipse(x, y, r, r, c);
  }

  fillEllipse(x: number, y: number, rx: number, ry: number, c: string) {
    if (rx <= 0 || ry <= 0) return;
    this.ctx.fillStyle = c;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** Thick arc, like M5GFX fillArc: angles in degrees, 0 = right, clockwise. */
  fillArc(x: number, y: number, r0: number, r1: number, a0: number, a1: number, c: string) {
    const rad = (d: number) => (d * Math.PI) / 180;
    this.ctx.fillStyle = c;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r1, rad(a0), rad(a1));
    this.ctx.arc(x, y, r0, rad(a1), rad(a0), true);
    this.ctx.closePath();
    this.ctx.fill();
  }

  /**
   * Filled polygon. On the robot this is a triangle strip of fillTriangle calls
   * (aliased) or a pre-rendered anti-aliased mask (treatment B, see CLAUDE.md).
   */
  fillPolygon(pts: [number, number][], c: string) {
    if (pts.length < 3) return;
    this.ctx.fillStyle = c;
    this.ctx.beginPath();
    this.ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i][0], pts[i][1]);
    this.ctx.closePath();
    this.ctx.fill();
  }

  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.closePath();
    this.ctx.fill();
  }

  /** Thick line with round ends, like M5GFX drawWideLine. */
  drawWideLine(x0: number, y0: number, x1: number, y1: number, r: number, c: string) {
    this.ctx.strokeStyle = c;
    this.ctx.lineWidth = r * 2;
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
  }

  /**
   * Text placed as M5GFX places a smooth font: by the tallest and deepest glyphs
   * of the printable set (maxAscent, maxDescent), not the browser's em box.
   */
  drawString(s: string, x: number, y: number, c: string, size = 16, datum: Datum = "top_left", bold = false, _mono = false) {
    this.ctx.fillStyle = c;
    this.ctx.font = font(size, bold);
    const { a, d } = this.metrics(size, bold);
    this.ctx.textAlign = datum === "top_left" ? "left" : "center";
    this.ctx.textBaseline = "alphabetic";
    const base = datum === "middle_center" ? y - (a + d) / 2 + a : datum === "bottom_center" ? y - d : y + a;
    this.ctx.fillText(s, x, base);
  }

  textWidth(s: string, size = 16, _mono = false, bold = false) {
    this.ctx.font = font(size, bold);
    return this.ctx.measureText(s).width;
  }

  private metricCache = new Map<string, { a: number; d: number }>();
  private metrics(size: number, bold: boolean) {
    const key = `${size}|${bold}|${document.fonts?.status ?? ""}`;
    let m = this.metricCache.get(key);
    if (!m) {
      const t = this.ctx.measureText(PRINTABLE);
      m = { a: Math.ceil(t.actualBoundingBoxAscent), d: Math.ceil(t.actualBoundingBoxDescent) };
      this.metricCache.set(key, m);
    }
    return m;
  }
}

const font = (size: number, bold: boolean) => `${bold ? 700 : 500} ${size}px ${BALOO}`;
