// The benchmark itself; see render-bench.ino for what it measures.
// (In a .cpp file because the Arduino builder mangles templates and lambdas in .ino files.)

#include <M5StackChan.h>

static const int REST_PITCH = 280;  // matches buddy-stream: 28 degrees above level
static const int FRAMES = 90;

static M5Canvas canvas(&M5.Display);    // 320 x 240, 16-bit, PSRAM
static M5Canvas region(&M5.Display);    // 320 x 160, 16-bit, PSRAM: the face area only
static M5Canvas canvas8(&M5.Display);   // 320 x 240, 8-bit, internal RAM
static M5Canvas lensSrc(&canvas);       // small source square for the magnifier
static M5Canvas lensDst(&canvas);       // the zoomed, masked lens

// Palette (simulator/src/face/palette.ts)
static uint32_t GROUND, INK, CREAM, MUSTARD, TEAL, TOMATO;
static const uint32_t KEY = 0xF81F;  // transparent key for the lens

struct Result {
  const char* name;
  float drawMs, pushMs;
};
static Result results[8];
static int nResults = 0;

// ---------------------------------------------------------------------------
// The stand-in face: two eyes (die-cut border, navy outline, cream eye, amber
// iris, pupil, two highlights), lids, brows and a mouth; pupils move each frame
// so nothing can be cached. `smooth` switches to the anti-aliased primitives.
// ---------------------------------------------------------------------------
static void drawFace(M5Canvas& c, int frame, bool smooth, int yOff = 0) {
  c.fillScreen(GROUND);
  const float t = frame / 30.0f;
  const int px = (int)(sinf(t * 2) * 8);
  const int py = (int)(cosf(t * 1.3f) * 5);
  for (int side = -1; side <= 1; side += 2) {
    const int cx = 160 + side * 64;
    const int cy = 106 + yOff;
    if (smooth) {
      // Smooth: M5GFX has no anti-aliased ellipse, so these eyes are circles.
      c.fillSmoothCircle(cx, cy, 39 + 9, CREAM);
      c.fillSmoothCircle(cx, cy, 39 + 6, INK);
      c.fillSmoothCircle(cx, cy, 39, CREAM);
      c.fillSmoothCircle(cx + px, cy + py, 27, MUSTARD);
      c.fillSmoothCircle(cx + px, cy + py, 14, INK);
      c.fillSmoothCircle(cx + px - 10, cy + py - 11, 6, CREAM);
      c.fillSmoothCircle(cx + px + 9, cy + py + 9, 3, CREAM);
      c.drawWideLine(cx - 30, cy - 25, cx + 30, cy - 25, 3.0f, INK);  // lid
      c.drawWideLine(cx - 17, cy - 62, cx + 17, cy - 62 - side * 3, 4.0f, CREAM);  // brow
    } else {
      c.fillEllipse(cx, cy, 36 + 9, 42 + 9, CREAM);
      c.fillEllipse(cx, cy, 36 + 6, 42 + 6, INK);
      c.fillEllipse(cx, cy, 36, 42, CREAM);
      c.fillCircle(cx + px, cy + py, 27, MUSTARD);
      c.fillCircle(cx + px, cy + py, 14, INK);
      c.fillCircle(cx + px - 10, cy + py - 11, 6, CREAM);
      c.fillCircle(cx + px + 9, cy + py + 9, 3, CREAM);
      c.fillRect(cx - 30, cy - 28, 60, 6, INK);
      c.fillRect(cx - 17, cy - 66, 34, 8, CREAM);
    }
  }
  // Mouth: a small smile arc (fillArc is aliased either way).
  c.fillArc(160, 150 + yOff, 14, 19, 35, 145, CREAM);
}

static void drawStar(M5Canvas& c, int x, int y, int r) {
  // Four-point star as two thin diamonds (fillTriangle): the shape a
  // pre-rendered star sprite would replace on the final firmware.
  const int w = r / 3;
  c.fillTriangle(x - r, y, x + r, y, x, y - w, CREAM);
  c.fillTriangle(x - r, y, x + r, y, x, y + w, CREAM);
  c.fillTriangle(x, y - r, x, y + r, x - w, y, CREAM);
  c.fillTriangle(x, y - r, x, y + r, x + w, y, CREAM);
}

static void drawExtras(M5Canvas& c, int frame) {
  // Four mini pairs (subagents)
  const int xs[4] = {285, 35, 220, 100};
  const int ys[4] = {211, 211, 219, 219};
  for (int i = 0; i < 4; i++) {
    for (int s = -1; s <= 1; s += 2) {
      const int x = xs[i] + s * 9;
      c.fillSmoothCircle(x, ys[i], 7, MUSTARD);
      c.fillSmoothCircle(x + 2, ys[i] - 2, 3, INK);
      c.drawWideLine(x - 5, ys[i] - 12, x + 5, ys[i] - 11, 1.5f, CREAM);
    }
  }
  // Three sparkles and the www wave
  drawStar(c, 283, 80, 9);
  drawStar(c, 298, 104, 6);
  drawStar(c, 300, 62, 4);
  for (int w = 0; w < 3; w++) {
    const int x0 = 251 + w * 20;
    const int y0 = 18 - (int)(sinf(frame / 10.0f + w) * 3);
    const int xs2[5] = {x0, x0 + 4, x0 + 8, x0 + 12, x0 + 17};
    const int ys2[5] = {y0, y0 + 11, y0 + 4, y0 + 11, y0};
    for (int k = 0; k < 4; k++) c.drawWideLine(xs2[k], ys2[k], xs2[k + 1], ys2[k + 1], 1.75f, CREAM);
  }
}

static void drawLens(int frame) {
  // The magnifier: copy a 34 x 34 square of the frame, zoom it 1.5x into a
  // 52 x 52 lens, mask outside the circle with the key colour, push with
  // transparency, then draw the rim.
  const int x = 224 + (int)(sinf(frame / 20.0f) * 16);
  const int y = 118;
  canvas.readRect(x - 17, y - 17, 34, 34, (uint16_t*)lensSrc.getBuffer());
  lensDst.fillScreen(KEY);
  lensSrc.pushRotateZoom(&lensDst, 26, 26, 0, 1.5f, 1.5f);
  lensDst.fillArc(26, 26, 26, 40, 0, 360, KEY);
  lensDst.pushSprite(&canvas, x - 26, y - 26, KEY);
  canvas.fillArc(x, y, 26, 29, 0, 360, CREAM);
  canvas.drawWideLine(x + 20, y + 20, x + 38, y + 38, 3.5f, CREAM);
}

// ---------------------------------------------------------------------------

static void report(const char* name, uint32_t drawUs, uint32_t pushUs) {
  Result r{name, drawUs / 1000.0f / FRAMES, pushUs / 1000.0f / FRAMES};
  results[nResults++] = r;
  const float total = r.drawMs + r.pushMs;
  Serial.printf("## bench {\"test\":\"%s\",\"frames\":%d,\"draw_ms\":%.2f,\"push_ms\":%.2f,\"frame_ms\":%.2f,\"fps\":%.1f}\n",
                name, FRAMES, r.drawMs, r.pushMs, total, 1000.0f / total);
}

static void run(const char* name, void (*draw)(int), void (*push)()) {
  uint32_t drawUs = 0, pushUs = 0;
  for (int f = 0; f < FRAMES; f++) {
    uint32_t t0 = micros();
    draw(f);
    uint32_t t1 = micros();
    push();
    M5.Display.waitDMA();
    uint32_t t2 = micros();
    drawUs += t1 - t0;
    pushUs += t2 - t1;
  }
  report(name, drawUs, pushUs);
}

static void showResults() {
  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.setFont(&fonts::Font2);
  d.drawString("render bench (ms per frame)", 8, 6);
  d.drawString("test       draw   push   total   fps", 8, 30);
  for (int i = 0; i < nResults; i++) {
    const Result& r = results[i];
    const float total = r.drawMs + r.pushMs;
    d.setTextColor(total <= 33.3f ? TFT_GREEN : TFT_ORANGE, TFT_BLACK);
    char line[64];
    snprintf(line, sizeof line, "%-9s %6.1f %6.1f %7.1f %6.1f", r.name, r.drawMs, r.pushMs, total, 1000.0f / total);
    d.drawString(line, 8, 52 + i * 20);
  }
  d.setTextColor(TFT_DARKGREY, TFT_BLACK);
  d.drawString("green = 30 fps or better. Edge test next.", 8, 214);
}

static void showEdges() {
  // Left half: plain (aliased) shapes. Right half: anti-aliased. Same face,
  // on the real glass, to judge by eye at desk distance.
  canvas.fillScreen(GROUND);
  canvas.setClipRect(0, 0, 160, 240);
  drawFace(canvas, 0, false, 0);
  canvas.setClipRect(160, 0, 160, 240);
  drawFace(canvas, 0, true, 0);
  canvas.clearClipRect();
  canvas.drawFastVLine(160, 0, 240, TEAL);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(CREAM);
  canvas.drawString("plain", 8, 222);
  canvas.drawRightString("smooth", 312, 222);
  canvas.pushSprite(0, 0);
}

void benchSetup() {
  M5StackChan.begin();
  Serial.begin(115200);
  M5StackChan.showRgbColor(0, 0, 0);
  M5.Display.setBrightness(140);
  M5StackChan.Motion.setAutoTorqueReleaseEnabled(false);
  M5StackChan.Motion.move(0, REST_PITCH, 150);

  auto& d = M5.Display;
  GROUND = d.color888(0x14, 0x21, 0x3d);
  INK = d.color888(0x0b, 0x15, 0x30);
  CREAM = d.color888(0xf6, 0xec, 0xd6);
  MUSTARD = d.color888(0xf2, 0xb1, 0x34);
  TEAL = d.color888(0x2a, 0x9d, 0x8f);
  TOMATO = d.color888(0xe4, 0x57, 0x2e);

  canvas.setPsram(true);
  canvas.setColorDepth(16);
  canvas.createSprite(320, 240);
  region.setPsram(true);
  region.setColorDepth(16);
  region.createSprite(320, 160);
  canvas8.setPsram(false);
  canvas8.setColorDepth(8);
  bool have8 = canvas8.createSprite(320, 240);
  lensSrc.setColorDepth(16);
  lensSrc.createSprite(34, 34);
  lensDst.setColorDepth(16);
  lensDst.createSprite(52, 52);

  delay(2500);  // let the head settle
  Serial.printf("## bench start, free internal %u, psram %u, canvas8 %s\n", heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                heap_caps_get_free_size(MALLOC_CAP_SPIRAM), have8 ? "ok" : "unavailable");

  run("full", [](int f) { drawFace(canvas, f, false); }, [] { canvas.pushSprite(0, 0); });
  run("region", [](int f) { drawFace(region, f, false, -26); }, [] { region.pushSprite(0, 26); });
  run("smooth", [](int f) { drawFace(canvas, f, true); }, [] { canvas.pushSprite(0, 0); });
  run("busy", [](int f) { drawFace(canvas, f, true); drawExtras(canvas, f); }, [] { canvas.pushSprite(0, 0); });
  run("lens", [](int f) { drawFace(canvas, f, true); drawLens(f); }, [] { canvas.pushSprite(0, 0); });
  if (have8) run("canvas8", [](int f) { drawFace(canvas8, f, true); }, [] { canvas8.pushSprite(0, 0); });
  Serial.println("## bench done");
  showResults();
}

void benchLoop() {
  static bool edges = false;
  static uint32_t lastPrint = 0;
  // Re-print the results every 5 s, so they can be read whenever USB is opened.
  if (millis() - lastPrint > 5000) {
    lastPrint = millis();
    for (int i = 0; i < nResults; i++) {
      const Result& r = results[i];
      const float total = r.drawMs + r.pushMs;
      Serial.printf("## bench {\"test\":\"%s\",\"draw_ms\":%.2f,\"push_ms\":%.2f,\"frame_ms\":%.2f,\"fps\":%.1f}\n", r.name,
                    r.drawMs, r.pushMs, total, 1000.0f / total);
    }
  }
  static uint32_t lastSwap = 0;
  M5StackChan.update();
  auto t = M5.Touch.getDetail();
  if (t.wasPressed()) Serial.printf("## touch %d,%d\n", t.x, t.y);  // diagnosing taps not registering
  // Alternate between the results and the edge test every 8 s (or on a tap).
  if (t.wasPressed() || millis() - lastSwap > 8000) {
    lastSwap = millis();
    edges = !edges;
    if (edges) showEdges();
    else showResults();
  }
  delay(10);
}
