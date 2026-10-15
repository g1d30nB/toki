// Port of simulator/src/face/render.ts.
#include "render.h"

#include <math.h>
#include <string.h>

#include "fonts_baloo.h"

namespace toki {

namespace {
void fitFont(M5Canvas& g, const char* s, bool bold);
}  // namespace

// ---------------------------------------------------------------------------
// Baloo 2. Each cut keeps its own reader, so switching fonts mid-frame costs
// nothing: the glyph tables are read once, on first use.
// ---------------------------------------------------------------------------
namespace {
struct Cut {
  const uint8_t* data;
  uint32_t size;
  lgfx::PointerWrapper reader;
  lgfx::VLWfont font;
  bool loaded = false;
};
Cut kCuts[] = {
    {kBalooBold28, sizeof kBalooBold28},     {kBalooMedium28, sizeof kBalooMedium28}, {kBalooBold22, sizeof kBalooBold22},
    {kBalooMedium22, sizeof kBalooMedium22}, {kBalooDigits54, sizeof kBalooDigits54},
};
}  // namespace

void useFont(M5Canvas& g, Baloo f) {
  Cut& c = kCuts[(int)f];
  if (!c.loaded) {
    c.reader.set(c.data, c.size);
    c.loaded = c.font.loadFont(&c.reader);
  }
  if (c.loaded) g.setFont(&c.font);
  else g.setFont(&fonts::FreeSans12pt7b);  // never expected: the data is compiled in
}

namespace {

bool isWorking(ExpressionId id) {
  switch (id) {
    case ExpressionId::Think:
    case ExpressionId::Read:
    case ExpressionId::Search:
    case ExpressionId::Edit:
    case ExpressionId::Run:
    case ExpressionId::Test:
    case ExpressionId::Web:
    case ExpressionId::Subagent:
    case ExpressionId::Working:
      return true;
    default:
      return false;
  }
}

// Faces where the lower edge belongs to text and buttons, or where Toki is resting.
bool noMinis(ExpressionId id) {
  switch (id) {
    case ExpressionId::Blocked:
    case ExpressionId::Asked:
    case ExpressionId::CloseAsk:
    case ExpressionId::Quiet:
    case ExpressionId::Closed:
    case ExpressionId::Sleepy:
    case ExpressionId::Night:
      return true;
    default:
      return false;
  }
}

/** "Close the day?": the question, then two booth-style buttons where Deny / Allow sit. */
void drawCloseChrome(M5Canvas& g, const Tokens& tk) {
  useFont(g, Baloo::Bold22);
  g.setTextColor(kCream);
  g.setTextDatum(top_center);
  g.drawString("Close the day?", 160, (int)tk.hintY);
  const int y = (int)tk.buttonY, h = (int)tk.buttonH;
  g.fillRoundRect(8, y, 148, h, h / 2, kCream);
  g.fillRoundRect(11, y + 3, 142, h - 6, h / 2 - 3, kNavy);
  g.fillRoundRect(164, y, 148, h, h / 2, kCream);
  g.fillRoundRect(167, y + 3, 142, h - 6, h / 2 - 3, kMustard);
  g.setTextDatum(middle_center);
  useFont(g, Baloo::Bold28);
  g.drawString("Not yet", 82, y + h / 2);
  g.setTextColor(kInk);
  g.drawString("Close", 238, y + h / 2);
}

/**
 * Disconnected (Gideon, 3 Oct): a small Bluetooth symbol with a tomato cross, top
 * left, over everything. An approval can't arrive while it shows.
 */
void drawLinkLost(M5Canvas& g, const Tokens& tk) {
  const float h = tk.linkH / 2, w = h * 0.55f, x = tk.linkX, y = tk.linkY;
  const float r = fmaxf(1.25f, tk.linkH / 14);
  const uint32_t rune = mix(kCream, kGround, 0.3f);
  // The Bluetooth rune: a spine, and two chevrons crossing it.
  const float px[6] = {x - w, x + w, x, x, x + w, x - w};
  const float py[6] = {y - h / 2, y + h / 2, y + h, y - h, y - h / 2, y + h / 2};
  for (int i = 1; i < 6; i++) g.drawWideLine(lroundf(px[i - 1]), lroundf(py[i - 1]), lroundf(px[i]), lroundf(py[i]), r, rune);
  // The cross, to its right.
  const float cx = x + w + h * 0.73f, cy = y, c = h * 0.38f;  // centred on the rune, as in the mock
  g.drawWideLine(lroundf(cx - c), lroundf(cy - c), lroundf(cx + c), lroundf(cy + c), r * 1.15f, kTomato);
  g.drawWideLine(lroundf(cx - c), lroundf(cy + c), lroundf(cx + c), lroundf(cy - c), r * 1.15f, kTomato);
}

/**
 * The Always icon (Gideon, 3 Oct): a thick ∞ traced as one loop that ends in an
 * arrowhead at the bottom of the right lobe, pointing back into the crossing; the
 * gap it leaves there reads as the "\" passing under the "/". Port of drawAlways
 * in simulator/src/face/render.ts.
 */
void drawAlways(M5Canvas& g, float x, float y, uint32_t c, float w = 28) {
  const float A = w / 2, r = w / 15;
  auto at = [&](float t, float& px, float& py) {
    const float s = sinf(t), d = 1 + s * s;
    px = x + (A * cosf(t)) / d;
    py = y + (A * s * cosf(t)) / d;
  };
  const float start = PI / 2 + 0.42f, end = PI * 2 + 0.92f;
  const int n = (int)ceilf((end - start) * 9);
  float px, py;
  at(start, px, py);
  for (int i = 1; i <= n; i++) {
    float nx, ny;
    at(start + (end - start) * i / n, nx, ny);
    g.drawWideLine(lroundf(px), lroundf(py), lroundf(nx), lroundf(ny), r, c);
    px = nx;
    py = ny;
  }
  float ex, ey, bx, by;
  at(end, ex, ey);
  at(end - 0.08f, bx, by);
  const float dx = ex - bx, dy = ey - by, len = fmaxf(1e-3f, sqrtf(dx * dx + dy * dy));
  const float ux = dx / len, uy = dy / len, L = r * 3.4f, W = r * 2.6f;
  g.fillTriangle(lroundf(ex + ux * L), lroundf(ey + uy * L), lroundf(ex - uy * W), lroundf(ey + ux * W), lroundf(ex + uy * W),
                 lroundf(ey - ux * W), c);
}

/**
 * "Always allow?" (step 5): the rule in words, the scope after the last comma never
 * cut (the rule shortens instead), then Cancel / Always where Deny / Allow were.
 */
void drawAlwaysChrome(M5Canvas& g, const char* always, const Tokens& tk) {
  useFont(g, Baloo::Bold22);
  g.setTextColor(kCream);
  g.setTextDatum(top_center);
  char head[72], text[96];
  strncpy(head, always, sizeof head - 1);
  head[sizeof head - 1] = 0;
  const char* comma = strrchr(always, ',');
  const char* tail = comma ? comma : "";
  if (comma) head[comma - always] = 0;
  const int room = 296 - g.textWidth(tail);
  size_t n = strlen(head);
  bool cut = false;
  while (n > 1 && g.textWidth(head) > room - (cut ? g.textWidth("...") : 0)) {
    head[--n] = 0;
    cut = true;
  }
  snprintf(text, sizeof text, "%s%s%s", head, cut ? "..." : "", tail);
  g.drawString(text, 160, (int)tk.hintY);
  const int y = (int)tk.buttonY, h = (int)tk.buttonH;
  g.fillRoundRect(8, y, 148, h, h / 2, kCream);
  g.fillRoundRect(11, y + 3, 142, h - 6, h / 2 - 3, kNavy);
  g.fillRoundRect(164, y, 148, h, h / 2, kCream);
  g.fillRoundRect(167, y + 3, 142, h - 6, h / 2 - 3, kTeal);
  g.setTextDatum(middle_center);
  useFont(g, Baloo::Bold28);
  g.drawString("Cancel", 82, y + h / 2);
  g.drawString("Always", 216, y + h / 2);  // the wider word: left, clear of its loop
  drawAlways(g, 284, y + h / 2, kCream);
}

/**
 * Asked (step 6; Gideon, 3 Oct): a question is answered in Claude. Just where to
 * answer, in regular weight so it stays quiet (the spec's 20 px minimum holds).
 */
void drawQuestionChrome(M5Canvas& g, const FaceInput&, const Tokens& tk) {
  g.setTextColor(kCream);
  g.setTextDatum(middle_center);
  fitFont(g, "Question for you in Claude", false);
  g.drawString("Question for you in Claude", 160, (int)(tk.buttonY + tk.buttonH / 2));
}

void drawApprovalChrome(M5Canvas& g, const FaceInput& in, const Tokens& tk) {
  if (in.alwaysAsk && *in.always) return drawAlwaysChrome(g, in.always, tk);
  // The hint is a data label (spec §7.1): monospace, tool name in capitals.
  char tool[24];
  strncpy(tool, in.promptTool, sizeof tool - 1);
  tool[sizeof tool - 1] = 0;
  for (char* p = tool; *p; p++) *p = toupper(*p);
  char label[96];
  snprintf(label, sizeof label, "%s . %s", tool, in.promptHint);
  useFont(g, Baloo::Medium22);
  g.setTextColor(kCream);
  g.setTextDatum(top_center);
  // Trim to fit the screen, with an ellipsis.
  size_t n = strlen(label);
  while (n > 3 && g.textWidth(label) > 296) {
    label[--n] = 0;
    label[n - 1] = '.';
  }
  g.drawString(label, 160, (int)tk.hintY);
  const int y = (int)tk.buttonY, h = (int)tk.buttonH;
  g.fillRoundRect(8, y, 148, h, h / 2, kTomato);
  g.fillRoundRect(164, y, 148, h, h / 2, kTeal);
  useFont(g, Baloo::Bold28);
  g.setTextDatum(middle_center);
  g.drawString("Deny", 82, y + h / 2);
  // With Always allow on offer, Allow shifts left for the icon ("hold for more").
  g.drawString("Allow", *in.always ? 224 : 238, y + h / 2);
  if (*in.always) drawAlways(g, 282, y + h / 2, kCream);
}

// ---------------------------------------------------------------------------
// Setup screens (Phase 7; port of simulator/src/face/setup.ts). Toki's own face,
// lifted to make room for a bold title and one line in the robot's fonts.
// ---------------------------------------------------------------------------
ExpressionId setupFace(SetupScreen s) {
  switch (s) {
    case SetupScreen::Joining: return ExpressionId::Think;
    case SetupScreen::WifiFailed:
    case SetupScreen::PairFailed: return ExpressionId::Denied;
    case SetupScreen::PairMe: return ExpressionId::Idle;
    case SetupScreen::PairCode: return ExpressionId::Blocked;  // patient round eyes: Toki needs you
    case SetupScreen::AllSet: return ExpressionId::Closed;     // star eyes and sparkles
    case SetupScreen::CheckHead: return ExpressionId::Idle;    // pupils centred: looking straight out
    case SetupScreen::Calibrate: return ExpressionId::Quiet;   // eyes closed, content: relaxing while you set its head
    default: return ExpressionId::Approved;                    // hello, joined: the character's reference frame
  }
}

/** Sets the larger Baloo (28 px, else 22) at which `s` fits the 296 px the screen allows. */
void fitFont(M5Canvas& g, const char* s, bool bold) {
  useFont(g, bold ? Baloo::Bold28 : Baloo::Medium28);
  if (g.textWidth(s) > 296) useFont(g, bold ? Baloo::Bold22 : Baloo::Medium22);
}

void drawSetupChrome(M5Canvas& g, const FaceInput& in) {
  constexpr int kTitleY = 156, kLineY = 190;  // SETUP_TITLE_Y, SETUP_LINE_Y in setup.ts
  const uint32_t soft = mix(kCream, kGround, 0.25f);
  char title[64];
  const char* line = nullptr;
  const char* command = nullptr;
  switch (in.setup) {
    case SetupScreen::Hello: snprintf(title, sizeof title, "Hi, I'm Toki"); line = "On your Mac, run"; command = "toki setup"; break;
    case SetupScreen::Joining: snprintf(title, sizeof title, "Joining %s", in.setupSsid); line = "A few seconds..."; break;
    case SetupScreen::Joined: snprintf(title, sizeof title, "On %s", in.setupSsid); line = "Wi-Fi is done"; break;
    case SetupScreen::WifiFailed: snprintf(title, sizeof title, "Couldn't join %s", in.setupSsid); line = "Nothing changed. Try again"; break;
    case SetupScreen::PairMe: snprintf(title, sizeof title, "Now pair me with Claude"); line = "The steps are on your Mac"; break;
    case SetupScreen::PairFailed: snprintf(title, sizeof title, "Pairing didn't finish"); line = "Click Connect again in the app"; break;
    case SetupScreen::AllSet: snprintf(title, sizeof title, "All set!"); line = "Nice to meet you"; break;
    case SetupScreen::CheckHead: snprintf(title, sizeof title, "Am I looking at you?"); line = "Answer on your Mac"; break;
    case SetupScreen::Calibrate: snprintf(title, sizeof title, "Set my head level"); line = "Gently, facing you"; break;
    case SetupScreen::Calibrated: snprintf(title, sizeof title, "That's home now"); line = "Thank you"; break;
    case SetupScreen::PairCode: {
      g.setTextColor(kCream);
      g.setTextDatum(top_center);
      fitFont(g, "Type this code on your Mac", false);
      g.drawString("Type this code on your Mac", 160, 112);
      char pk[8];
      snprintf(pk, sizeof pk, "%06lu", (unsigned long)in.setupCode);
      g.setTextDatum(middle_center);
      useFont(g, Baloo::Digits54);
      g.drawString(pk, 160, 196);
      return;
    }
    default: return;
  }
  g.setTextColor(kCream);
  g.setTextDatum(top_center);
  fitFont(g, title, true);
  g.drawString(title, 160, kTitleY);
  if (!line) return;
  if (command) {
    // The words, then the command in bold, centred as one: both at 28 px if they fit, else 22.
    bool big = true;
    int wl = 0, wc = 0;
    for (;;) {
      useFont(g, big ? Baloo::Medium28 : Baloo::Medium22);
      wl = g.textWidth(line);
      useFont(g, big ? Baloo::Bold28 : Baloo::Bold22);
      wc = g.textWidth(command);
      if (!big || wl + 8 + wc <= 296) break;
      big = false;
    }
    const int x0 = 160 - (wl + 8 + wc) / 2;
    g.setTextDatum(top_left);
    useFont(g, big ? Baloo::Medium28 : Baloo::Medium22);
    g.setTextColor(soft);
    g.drawString(line, x0, kLineY);
    useFont(g, big ? Baloo::Bold28 : Baloo::Bold22);
    g.setTextColor(kCream);
    g.drawString(command, x0 + wl + 8, kLineY);
    return;
  }
  g.setTextColor(soft);
  fitFont(g, line, false);
  g.drawString(line, 160, kLineY);
}

}  // namespace

// ---------------------------------------------------------------------------
// The label under the face (Gideon, 15 Oct; port of simulator/src/face/label.ts).
// A data label: the verb in bold monospace capitals, then what Claude is working
// on. Only on faces with a free lower edge; never over chrome, shutter or setup.
// ---------------------------------------------------------------------------
namespace {

bool labelTakesObject(ExpressionId id) {
  switch (id) {
    case ExpressionId::Read: case ExpressionId::Search: case ExpressionId::Edit: case ExpressionId::Run:
    case ExpressionId::Test: case ExpressionId::Web: case ExpressionId::Working: case ExpressionId::Error: return true;
    default: return false;
  }
}

const char* labelWord(ExpressionId id) {
  switch (id) {
    case ExpressionId::Think: return "THINKING";
    case ExpressionId::Read: return "READING";
    case ExpressionId::Search: return "SEARCHING";
    case ExpressionId::Edit: return "EDITING";
    case ExpressionId::Run: return "RUNNING";
    case ExpressionId::Test: return "TESTING";
    case ExpressionId::Web: return "ON THE WEB";
    case ExpressionId::Working: return "WORKING";
    case ExpressionId::Done: return "DONE";
    case ExpressionId::Error: return "FAILED";
    case ExpressionId::Approved: return "ALLOWED";
    case ExpressionId::Denied: return "DENIED";
    default: return nullptr;
  }
}

}  // namespace

bool FaceRenderer::drawLabel(M5Canvas& g, ExpressionId id, const FaceInput& in, uint32_t now, const Tokens& tk) {
  // What the label should say now.
  char verb[24] = "";
  const char* obj = "";
  if (in.labelMode > 0) {
    const int subs = in.subagentCount;
    if (id == ExpressionId::Subagent || (subs > 0 && labelTakesObject(id) && id != ExpressionId::Error)) {
      snprintf(verb, sizeof verb, "%d SUBAGENT%s", subs ? subs : 1, subs == 1 ? "" : "S");
    } else if (const char* w = labelWord(id)) {
      strlcpy(verb, w, sizeof verb);
      if (in.labelMode == 2 && labelTakesObject(id) && in.labelObject && *in.labelObject) {
        obj = in.labelObject;
        if (id == ExpressionId::Web) strlcpy(verb, "WEB", sizeof verb);  // leaves room for the site
      }
    }
  }
  if (!*verb) {
    const bool was = labelOn_;
    labelOn_ = false;
    return was;  // one more push clears it from the screen
  }
  // A new verb follows the face at once; a new object waits labelHoldMs, so a burst
  // of tool calls reads as one steady line.
  if (!labelOn_ || strcmp(verb, labelVerb_)) {
    strlcpy(labelVerb_, verb, sizeof labelVerb_);
    strlcpy(labelObj_, obj, sizeof labelObj_);
    labelAt_ = now;
    labelOn_ = true;
  } else if (strcmp(obj, labelObj_) && now - labelAt_ >= tk.labelHoldMs) {
    strlcpy(labelObj_, obj, sizeof labelObj_);
    labelAt_ = now;
  }
  const float k = tk.labelInMs > 0 ? fminf(1, (now - labelAt_) / tk.labelInMs) : 1;
  const uint32_t cream = mix(kGround, kCream, k);
  const uint32_t soft = mix(kGround, mix(kCream, kGround, 0.3f), k);
  const int y = (int)tk.labelY;

  useFont(g, Baloo::Bold22);
  const int wv = g.textWidth(labelVerb_);
  g.setTextColor(cream);
  if (!*labelObj_) {
    g.setTextDatum(top_center);
    g.drawString(labelVerb_, 160, y);
    return k < 1;
  }
  // Verb, a middle dot, then the object, centred as one line; only the object is cut.
  constexpr int kGap = 10;
  useFont(g, Baloo::Medium22);
  char o[40];
  strlcpy(o, labelObj_, sizeof o);
  const int room = 296 - wv - 2 * kGap;
  size_t n = strlen(o);
  while (n > 3 && g.textWidth(o) > room) {
    o[--n] = 0;
    o[n - 1] = o[n - 2] = '.';
  }
  const int x0 = 160 - (wv + 2 * kGap + g.textWidth(o)) / 2;
  g.setTextDatum(top_left);
  useFont(g, Baloo::Bold22);
  g.drawString(labelVerb_, x0, y);
  g.fillSmoothCircle(x0 + wv + kGap, y + 10, 2.5f, soft);  // at the capitals' middle
  useFont(g, Baloo::Medium22);
  g.setTextColor(soft);
  g.drawString(o, x0 + wv + 2 * kGap, y);
  return k < 1;
}

bool FaceRenderer::draw(M5Canvas& g, const FaceInput& in, uint32_t now, const Tokens& tk) {
  const bool setup = in.setup != SetupScreen::None;
  const ExpressionId id = setup ? setupFace(in.setup) : in.expression;
  const bool blocked = id == ExpressionId::Blocked && !setup;
  g.fillScreen(kGround);
  AnimatedFace face = anim_.update(now, id, tk);
  // Setup screens lift the face (and for the pairing code, shrink it) to make room for words.
  if (setup) {
    face.offsetY -= 22;
    if (in.setup == SetupScreen::PairCode) face.scale *= 0.62f;
  }
  // The boop's giggle: once the eyes close, the whole face hops a few times,
  // each hop smaller, like shoulders shaking with a laugh (Gideon, 3 Oct).
  if (id == ExpressionId::Boop) {
    const float t = (float)(now - anim_.since()) - expression(id).introMs;
    if (t >= 0 && t < tk.giggleMs && tk.giggleHops > 0) {
      const float p = t / tk.giggleMs;
      face.offsetY -= fabsf(sinf(p * PI * tk.giggleHops)) * tk.gigglePx * (1 - p * 0.6f);
    }
  }

  // Minis: one per running subagent, kept off the faces that need the lower edge or are resting.
  minis_.update(in.subagents, noMinis(id) || setup ? 0 : in.subagentCount, now, tk);
  face.scale *= 1 - tk.miniShrink * minis_.presence;
  uint32_t spawnAt;
  float spawnX, spawnY;
  if (tk.miniGlanceMs > 0 && minis_.lastSpawn(spawnAt, spawnX, spawnY) && now >= spawnAt) {
    const float p = (now - spawnAt) / tk.miniGlanceMs;
    if (p <= 1) {
      const float w = sinf(PI * p);
      const float dx = spawnX - 160, dy = spawnY - (tk.eyeY + face.offsetY);
      const float d = fmaxf(1, sqrtf(dx * dx + dy * dy));
      face.pupilX += ((dx / d) * 0.9f - face.pupilX) * w;
      face.pupilY += ((dy / d) * 0.9f - face.pupilY) * w;
    }
  }

  drawEyes(g, face, tk, now);
  drawMouth(g, face, tk, now);
  Eye eyes[2];
  eyeLayout(face, tk, eyes);
  minis_.draw(g, now, tk, eyes);

  // Long turn: past longTurnMin, a sweat drop appears and grows to double size.
  const float longMs = tk.longTurnMin * 60000;
  const bool longTurn = isWorking(id) && in.turnMs > longMs;
  const float grow = longTurn ? 1 + fminf(1, (in.turnMs - longMs) / longMs) : 1;
  uint16_t want = expression(id).manpu;
  if (in.setup == SetupScreen::Joining) want = Manpu_Wifi;  // the Wi-Fi mark instead of think's "..."
  if (in.setup == SetupScreen::Joined) want = Manpu_WifiOn;
  if (in.setup == SetupScreen::PairCode || in.setup == SetupScreen::Calibrate) want = 0;  // no "..." or "zZZZ"
  if (longTurn) want |= Manpu_Sweat;
  // Done's sparkles linger over the next face for their full hold, unless
  // something urgent (blocked, error) takes over.
  if (id == ExpressionId::Done && lastId_ != ExpressionId::Done) {
    sparklesFrom_ = now;
    haveSparkles_ = true;
  }
  const bool lingering = haveSparkles_ && now - sparklesFrom_ < tk.sparkleHoldMs + tk.sparkleFadeMs;
  if (lingering && !blocked && id != ExpressionId::Asked && id != ExpressionId::Error && id != ExpressionId::CloseAsk &&
      id != ExpressionId::Night)
    want |= Manpu_Sparkles;
  lastId_ = id;
  manpu_.draw(g, want, face, tk, now, grow);

  // The night shutter comes down over everything once the day is closed.
  const float shut = setup ? 0 : in.shutter;
  if (shut > 0) earned_ = shut >= 1;
  shutter_.update(now, shut, tk);
  shutter_.draw(g, tk, earned_);

  if (setup) {
    drawSetupChrome(g, in);
    return true;  // the words sit in the bottom band
  }
  if (in.disconnected) drawLinkLost(g, tk);
  if (id == ExpressionId::CloseAsk) drawCloseChrome(g, tk);
  if (blocked) drawApprovalChrome(g, in, tk);
  if (id == ExpressionId::Asked) drawQuestionChrome(g, in, tk);
  // The label: only where the lower edge is free. It changes rarely, so it asks for
  // the bottom band only while it changes; the screen keeps it between pushes.
  const bool chrome = blocked || id == ExpressionId::Asked || id == ExpressionId::CloseAsk;
  const bool labelDirty = drawLabel(g, chrome || shutter_.pos > 0 ? ExpressionId::Count : id, in, now, tk);
  // Night sits low (its eyes peek out under the shutter), so it uses the bottom band too.
  return chrome || id == ExpressionId::Night || shutter_.pos > 0 || minis_.visible() || labelDirty;
}

}  // namespace toki
