import type { Gfx } from "./gfx";
import { mix, palette } from "./palette";
import type { FaceTokens } from "./tokens";

// The night shutter (spec §3.4): when you close the day, a Tokyo shop-front
// shutter comes down over the face. Earned days close it fully, with a CLOSED
// sign; quiet days leave a gap at the bottom, where the sleeping eyes peek out.
// Blocked rolls it up; it drops again once you've answered.
//
// Plain state + update(), so it ports to the firmware's loop(). The robot draws
// it with fillRect and fillRoundRect only.

export class Shutter {
  /** Fraction of the screen covered, 0 (open) to 1 (fully down). */
  pos = 0;
  private vel = 0; // fraction per second, down is positive
  private last = -1;

  update(now: number, target: number, tk: FaceTokens) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (target > this.pos + 1e-3 || (this.vel !== 0 && target > 0)) {
      // Falls under gravity: a full drop takes shutterDropMs, then one small bounce.
      const g = 2 / (tk.shutterDropMs / 1000) ** 2;
      this.vel += g * dt;
      this.pos += this.vel * dt;
      if (this.pos >= target) {
        this.pos = target;
        this.vel = this.vel > 0.6 ? -this.vel * 0.18 : 0;
      }
    } else if (target < this.pos) {
      // Rolls up at an even speed.
      this.vel = 0;
      this.pos = Math.max(target, this.pos - dt / (tk.shutterRiseMs / 1000));
    }
  }

  draw(g: Gfx, tk: FaceTokens, earned: boolean) {
    const y = Math.round(this.pos * 240);
    if (y < 1) return;
    const slat = palette.dim;
    const shine = mix(palette.dim, palette.cream, 0.3);
    g.fillRect(0, 0, 320, y, slat);
    // Slats: a dark groove and a light lip each, counted up from the bottom rail.
    for (let yy = y - 8 - tk.shutterSlat; yy > -tk.shutterSlat; yy -= tk.shutterSlat) {
      g.fillRect(0, yy, 320, 2, palette.ink);
      g.fillRect(0, yy + 2, 320, 1, shine);
    }
    // Bottom rail and its handle.
    g.fillRect(0, y - 8, 320, 8, palette.ink);
    g.fillRect(0, y - 7, 320, 3, shine);
    g.fillRoundRect(142, y - 7, 36, 5, 2, palette.tomato);
    // The hand-lettered CLOSED sign hangs in the middle of a fully closed shutter.
    if (earned) {
      const cy = y - 120;
      if (cy > -30) {
        g.fillRoundRect(94, cy - 23, 132, 46, 9, palette.cream);
        g.fillRoundRect(97, cy - 20, 126, 40, 7, palette.tomato);
        g.drawString("CLOSED", 160, cy + 1, palette.cream, 28, "middle_center", true);
      }
    }
  }
}
