// Toki: the robot firmware (Phase 3, step 7).
//
// Connects to the Claude desktop app's Hardware Buddy over Bluetooth, turns the
// stream into Toki's state (state.cpp, a port of the simulator's agent-state
// layer), and draws the face every frame (render.cpp). When Claude asks for
// permission, the Allow / Deny buttons answer it. Touch on the face: a tap boops
// (or wakes Toki), a double-tap starts quiet mode, a long-press asks to close the
// day, and the night shutter comes down. The pairing code appears on
// screen when the Mac pairs. Every line from the desktop is echoed to USB for the
// recorder (bridge/tools/record-stream.py). The body (body.cpp) moves the head
// only to interrupt, and glows amber while Claude waits on you.

#include <ArduinoJson.h>
#include <M5StackChan.h>

#include "body.h"
#include "buddy.h"
#include "net.h"
#include "render.h"
#include "settings.h"
#include "version.h"
#include "state.h"

using namespace toki;

static M5Canvas canvas(&M5.Display);
static FaceRenderer renderer;
static AgentState state;
static Body body;

// Only rows that can change are sent each frame (a full frame is 34 ms over SPI).
static const int FACE_BAND = 192;
static int lastBand = 240;

// ---------------------------------------------------------------------------
// Echo for the recorder, to USB and to the bridge over Wi-Fi (which writes the
// recording to ~/StackChanData). Identical lines are counted, not repeated.
// ---------------------------------------------------------------------------
static String lastEchoed;
static uint32_t repeats = 0;

/** A "## ..." log line, to USB and the bridge. */
static void logf(const char* fmt, ...) {
  char buf[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  Serial.printf("## %s\n", buf);
  net::send("##", buf);
}

static void echo(bool incoming, const String& line) {
  if (incoming && line == lastEchoed) {
    repeats++;
    return;
  }
  if (repeats) logf("repeat %lu", (unsigned long)repeats);
  repeats = 0;
  if (incoming) lastEchoed = line;
  Serial.printf("%s %s\n", incoming ? "<<" : ">>", line.c_str());
  net::send(incoming ? "<<" : ">>", line.c_str());
}

static void send(const JsonDocument& doc) {
  String s;
  serializeJson(doc, s);
  echo(false, s);
  buddy::send(s);
}

static void ack(const char* cmd, bool ok) {
  JsonDocument d;
  d["ack"] = cmd;
  d["ok"] = ok;
  d["n"] = 0;
  send(d);
}

// ---------------------------------------------------------------------------
// The Buddy protocol: commands, snapshots and turn events
// ---------------------------------------------------------------------------
static void handleCommand(JsonDocument& doc) {
  const char* cmd = doc["cmd"] | "";
  if (!strcmp(cmd, "status")) {
    JsonDocument d;
    d["ack"] = "status";
    d["ok"] = true;
    d["n"] = 0;
    d["data"]["name"] = buddy::deviceName();
    d["data"]["sec"] = buddy::secure();
    d["data"]["bat"]["usb"] = true;
    d["data"]["sys"]["up"] = millis() / 1000;
    d["data"]["sys"]["heap"] = ESP.getFreeHeap();
    send(d);
  } else if (!strcmp(cmd, "owner") || !strcmp(cmd, "name")) {
    ack(cmd, true);
  } else if (!strcmp(cmd, "unpair")) {
    buddy::clearBonds();
    ack("unpair", true);
  } else if (!strcmp(cmd, "char_begin") || !strcmp(cmd, "permission")) {
    // Folder push is declined (no ack, so the desktop times out); permission isn't sent to us.
  } else {
    ack(cmd, false);
  }
}

/**
 * What a tool works on, in as few characters as possible, for the label under the
 * face: a command's first real step, a file's name, a site's host, a search in
 * quotes. Port of labelObject in simulator/src/face/label.ts.
 */
static void toolObject(const char* name, JsonObjectConst input, char* out, size_t n) {
  out[0] = 0;
  const bool bash = !strcmp(name, "Bash");
  const char* src = bash ? (input["command"] | "") : "";
  if (!bash) {
    for (const char* k : {"file_path", "notebook_path", "pattern", "url", "query"}) {
      src = input[k] | "";
      if (*src) break;
    }
  }
  if (!*src) return;
  char buf[160];
  strlcpy(buf, src, sizeof buf);
  if (bash) {
    // The first step of a chain that isn't `cd`, without redirections (2>&1, >/dev/null).
    char* step = nullptr;
    for (char* p = buf;;) {
      char* e = p;
      while (*e && *e != ';' && *e != '|' && !(*e == '&' && e[1] == '&')) e++;
      const char sep = *e;
      *e = 0;
      while (*p == ' ') p++;
      if (*p && strncmp(p, "cd ", 3) != 0) {
        step = p;
        break;
      }
      if (!sep) break;
      p = e + ((sep == '&' || (sep == '|' && e[1] == '|')) ? 2 : 1);
    }
    if (!step) {  // nothing but `cd`: show it as it is
      strlcpy(buf, src, sizeof buf);
      step = buf;
    }
    size_t o = 0;
    for (char* w = strtok(step, " "); w && o < n - 1; w = strtok(nullptr, " ")) {
      if (w[0] == '>' || (isdigit((unsigned char)w[0]) && w[1] == '>')) continue;
      o += snprintf(out + o, n - o, "%s%s", o ? " " : "", w);
    }
    return;
  }
  if (!strncmp(buf, "http://", 7) || !strncmp(buf, "https://", 8)) {
    char* host = strstr(buf, "//") + 2;
    if (!strncmp(host, "www.", 4)) host += 4;
    host[strcspn(host, "/ ?#")] = 0;
    strlcpy(out, host, n);
    return;
  }
  const bool quote = !strcmp(name, "Grep") || !strcmp(name, "Glob") || !strcmp(name, "WebSearch");
  if (!quote && strchr(buf, '/') && !strchr(buf, ' ') && !strchr(buf, '*')) {
    strlcpy(out, strrchr(buf, '/') + 1, n);
    return;
  }
  if (quote) snprintf(out, n, "\"%s\"", buf);
  else strlcpy(out, buf, n);
}

static void handleTurn(JsonDocument& doc, uint32_t now) {
  const bool user = !strcmp(doc["role"] | "", "user");
  ToolCall tools[8];
  uint32_t results[8];
  int toolCount = 0, resultCount = 0;
  bool thinking = false, toolResult = false, toolError = false;
  for (JsonObject b : doc["content"].as<JsonArray>()) {
    const char* type = b["type"] | "";
    if (!strcmp(type, "tool_use") && toolCount < 8) {
      ToolCall& c = tools[toolCount++];
      c.idHash = hashId(b["id"] | "");
      c.kind = AgentState::classify(b["name"] | "", b["input"]["command"] | "");
      toolObject(b["name"] | "", b["input"], c.object, sizeof c.object);
    } else if (!strcmp(type, "tool_result")) {
      toolResult = true;
      if (b["is_error"] | false) toolError = true;
      if (resultCount < 8) results[resultCount++] = hashId(b["tool_use_id"] | "");
    } else if (!strcmp(type, "thinking")) {
      thinking = true;
    }
  }
  state.turn(now, user, tools, toolCount, thinking, toolResult, toolError, results, resultCount);
}

static void handleLine(const String& line, uint32_t now) {
  echo(true, line);
  // Keep only the fields Toki uses: turn events can be 4 KB of transcript.
  static JsonDocument filter;
  if (filter.isNull()) {
    for (const char* k : {"cmd", "evt", "role", "total", "running", "waiting", "msg", "tokens_today"}) filter[k] = true;
    filter["prompt"] = true;
    JsonObject c = filter["content"].add<JsonObject>();
    for (const char* k : {"type", "name", "id", "tool_use_id", "is_error"}) c[k] = true;
    for (const char* k : {"command", "file_path", "notebook_path", "pattern", "url", "query"}) c["input"][k] = true;
  }
  JsonDocument doc;
  if (deserializeJson(doc, line, DeserializationOption::Filter(filter))) return;
  if (doc["cmd"].is<const char*>()) {
    handleCommand(doc);
  } else if (doc["evt"].is<const char*>()) {
    if (doc["evt"] == "turn") handleTurn(doc, now);
  } else if (doc["total"].is<int>()) {
    state.snapshot(now, doc["total"] | 0, doc["running"] | 0, doc["waiting"] | 0, doc["msg"] | "", doc["tokens_today"] | 0L,
                   doc["prompt"]["id"] | "", doc["prompt"]["tool"] | "", doc["prompt"]["hint"] | "");
  }
}

// ---------------------------------------------------------------------------
// Screen and touch
// ---------------------------------------------------------------------------
/** Which button is under (x, y), as drawn in render.cpp: 1 right, -1 left, 0 neither. */
static int buttonAt(int x, int y) {
  if (y < kTokens.buttonY) return 0;
  if (x >= 164) return 1;
  if (x >= 8 && x < 156) return -1;
  return 0;
}

// Touch (spec §6), recognised as in the simulator's Screen.tsx. Allow / Deny answer
// on the press, and that touch is then used up (so its release can't wake Toki or
// reopen the day). Otherwise: a tap on release, a second tap within doubleTapMs is
// a double-tap, and holding for longPressMs is a long-press.
static struct {
  bool down = false, used = false, haveTap = false;
  uint32_t downAt = 0, lastTap = 0;
  int x = 0, y = 0;
} touch;

static void gesture(uint32_t now, Gesture g, Target target) {
  static const char* const kNames[] = {"tap", "double-tap", "long-press"};
  static const char* const kTargets[] = {"face", "yes", "no"};
  logf("touch %s %s", kNames[(int)g], kTargets[(int)target]);
  // Moments only Toki knows, for the diary (Phase 5): quiet mode, the day closing or reopening.
  const bool wasQuiet = state.quiet(now), wasClosed = state.dayClosed();
  state.gesture(now, g, target);
  if (state.quiet(now) && !wasQuiet) logf("moment quiet");
  if (state.dayClosed() && !wasClosed) logf("moment closed %s", state.earned() ? "earned" : "quiet");
  if (!state.dayClosed() && wasClosed) logf("moment reopened");
}

/**
 * Answers the prompt. Allow and Deny go down every path it came by (Buddy and the
 * bridge's held hook) and Claude Code takes the first. Always allow goes only to
 * the hook: Buddy's plain "once" would otherwise win the race and no rule would be
 * written (step 4 finding).
 */
static bool alwaysAsk = false;  // the "Always allow?" confirm screen (step 5)

static void answer(uint32_t now, Answer a) {
  if (a != Answer::Always && state.buddyPrompt()) {
    JsonDocument d;
    d["cmd"] = "permission";
    d["id"] = state.promptId();
    d["decision"] = a == Answer::Allow ? "once" : "deny";
    send(d);
  }
  if (state.hookPrompt()) {
    JsonDocument d;
    d["answer"] = state.hookPromptId();
    d["decision"] = a == Answer::Allow ? "allow" : a == Answer::Deny ? "deny" : "always";
    String s;
    serializeJson(d, s);
    net::send("@@", s.c_str());
  }
  state.decision(now, state.promptId(), a != Answer::Deny);
  if (a != Answer::Deny) body.approved(now);
  alwaysAsk = false;
}

static void handleTouch(uint32_t now) {
  auto t = M5.Touch.getDetail();
  if (!state.blocked()) alwaysAsk = false;
  // With Always allow on offer (the bridge holds the prompt and Claude offered a
  // rule), Allow waits for the release so a hold can open the confirm screen.
  const bool holdable = state.hookPrompt() && *state.promptAlways() && net::bridgeUp() && !state.question();
  // A question is answered in Claude (step 6): no taps answer anything while it's up.
  if (state.question()) {
    if (t.wasPressed()) touch.used = true, touch.down = true;
    if (t.wasReleased()) touch.down = false;
    return;
  }
  if (t.wasPressed()) {
    touch.down = true;
    touch.used = false;
    touch.downAt = now;
    touch.x = t.x;
    touch.y = t.y;
    const int b = buttonAt(t.x, t.y);
    if (state.blocked() && !alwaysAsk && b && !(b > 0 && holdable)) {
      answer(now, b > 0 ? Answer::Allow : Answer::Deny);
      touch.used = true;
    }
  } else if (touch.down && !touch.used && t.isPressed() && now - touch.downAt >= kTokens.longPressMs) {
    touch.used = true;
    if (state.blocked() && !alwaysAsk && holdable && buttonAt(touch.x, touch.y) > 0) {
      alwaysAsk = true;
      logf("always allow? %s", state.promptAlways());
    } else {
      gesture(now, Gesture::LongPress, Target::Face);
    }
  } else if (touch.down && t.wasReleased()) {
    touch.down = false;
    if (touch.used) return;
    if (state.blocked()) {
      const int b = buttonAt(touch.x, touch.y);
      if (alwaysAsk) {
        if (b > 0) answer(now, Answer::Always);
        else if (b < 0) alwaysAsk = false;  // Cancel: back to the normal prompt
      } else if (b > 0 && holdable) {
        answer(now, Answer::Allow);  // a short tap on Allow: once
      }
      return;
    }
    const bool dbl = touch.haveTap && now - touch.lastTap < kTokens.doubleTapMs;
    Target target = Target::Face;
    if (state.closeAsking(now)) {
      const int b = buttonAt(touch.x, touch.y);
      if (b) target = b > 0 ? Target::Yes : Target::No;
    }
    gesture(now, dbl ? Gesture::DoubleTap : Gesture::Tap, target);
    touch.haveTap = !dbl;
    touch.lastTap = now;
  }
}

// ---------------------------------------------------------------------------
// The bridge: the clock (Phase 4, step 3) and held approvals (step 4). It sends
// {"time": <unix seconds>, "offset": <minutes east of UTC>} on connect and every
// 10 minutes, which also covers the clock change.
// ---------------------------------------------------------------------------
static int32_t utcOffsetMin = 0;
static bool haveClock = false;

/** Tells the bridge Toki's settings (Phase 7): on request, and after every change. */
static void sendSettings() {
  JsonDocument d;
  settings::toJson(d["settings"].to<JsonObject>());
  String s;
  serializeJson(d, s);
  net::send("@@", s.c_str());
}

static void handleBridge(const String& line) {
  JsonDocument d;
  if (deserializeJson(d, line)) return;
  // Settings (Phase 7): {"settings": {...}} changes any of them; {"settings": {}} just asks.
  if (d["settings"].is<JsonObject>()) {
    if (settings::apply(d["settings"].as<JsonObjectConst>(), millis())) {
      M5.Display.setBrightness(settings::get().brightness);
      logf("settings: brightness %u, rollover %u", settings::get().brightness, settings::get().rollover);
    }
    sendSettings();
  }
  // Approvals held by the bridge (step 4): {"prompt": {id, tool, hint}} and {"cleared": id}.
  if (d["prompt"].is<JsonObject>()) {
    JsonObject q = d["prompt"]["question"];
    state.hookPromptOpened(millis(), d["prompt"]["id"] | "", d["prompt"]["tool"] | "", d["prompt"]["hint"] | "",
                           d["prompt"]["always"] | "", q.isNull() ? nullptr : (const char*)(q["header"] | ""));
    logf("bridge prompt %s", (const char*)(d["prompt"]["id"] | ""));
  }
  if (d["cleared"].is<const char*>()) state.hookPromptClosed(millis(), d["cleared"]);
  // Session dots (step 7c): {"leds": [[r,g,b] x 6]}, already dimmed by the bridge.
  if (d["leds"].is<JsonArray>()) {
    uint8_t rgb[6][3] = {};
    int i = 0;
    for (JsonArray c : d["leds"].as<JsonArray>()) {
      if (i >= 6) break;
      for (int k = 0; k < 3; k++) rgb[i][k] = c[k] | 0;
      i++;
    }
    body.setDots(rgb, millis());
  }
  if (d["time"].is<long>()) {
    timeval tv{(time_t)d["time"].as<long>(), 0};
    settimeofday(&tv, nullptr);
    utcOffsetMin = d["offset"] | 0;
    if (!haveClock) logf("clock set (offset %ld min)", (long)utcOffsetMin);
    haveClock = true;
  }
}

// ---------------------------------------------------------------------------
// Setup over the USB cable (Phase 7): the Mac's Wi-Fi setup tool sends one JSON
// line and Toki answers with one "## setup {...}" line. Physical access is the
// permission: whoever holds the cable owns the robot. The password and the link
// secret are never sent back.
//   {"setup": "status"}
//   {"setup": "wifi", "ssid": "...", "pass": "...", "secret": "..."}
//   {"setup": "secret", "secret": "..."}   a new link secret, keeping the Wi-Fi
//   {"setup": "forget"}
//   {"setup": "done"}   setup finished: "All set!" and a happy wiggle
//   {"setup": "calibrate", "step": "home" | "release" | "save" | "resume"}
//       head to home and hold / motors off to set it by hand / save as home / back to normal
//   {"setup": "face", "name": "error", "ms": 60000}   the face tour (bridge/tools/face-tour.py):
//       hold one expression for review; an unknown name ends the tour
// The reply also says which firmware this is and whether the Claude app is paired.
// ---------------------------------------------------------------------------
static uint32_t allSetUntil = 0;  // "All set!" shows until then (setup's last step sends "done")
static SetupScreen calibScreen = SetupScreen::None;  // the head check, while toki calibrate runs
static uint32_t calibratedUntil = 0;                 // "That's home now" shows until then
static ExpressionId tourFace = ExpressionId::Count;  // the face tour: this face, until tourUntil
static uint32_t tourUntil = 0;
static const uint32_t kTourSubagents[] = {1, 2, 3};

/** The face tour overrides what Claude is doing, with invented examples for the chrome and label. */
static void applyTour(FaceInput& in, uint32_t now) {
  if (!tourUntil || (int32_t)(tourUntil - now) <= 0) return;
  in.expression = tourFace;
  in.setup = SetupScreen::None;
  in.subagents = kTourSubagents;
  in.subagentCount = tourFace == ExpressionId::Subagent ? 3 : 0;
  in.promptTool = "Bash";
  in.promptHint = "npm test";
  in.always = "";
  in.alwaysAsk = false;
  in.questionHeader = "Which colour?";
  in.shutter = tourFace == ExpressionId::Closed || tourFace == ExpressionId::Night ? 1 : tourFace == ExpressionId::Sleepy ? 0.8f : 0;
  in.labelObject = tourFace == ExpressionId::Web ? "example.com" : tourFace == ExpressionId::Search ? "\"sparkles\"" : "sticker.ts";
}

/**
 * Toki's side of setup (Phase 7): which setup screen to show, from what's true on
 * the robot, never a script. The pairing code and a failed pairing come first;
 * then a Wi-Fi attempt and its result (for 4 s); then "All set!"; then, if Claude
 * isn't waiting on you, hello (brand new) or "pair me" (on Wi-Fi, never paired).
 */
static SetupScreen setupScreen(uint32_t now, ExpressionId face, const char*& ssid) {
  // Calibrating (toki calibrate) comes first: the head is in someone's hands.
  if (calibScreen != SetupScreen::None && body.calibrating()) return calibScreen;
  if (calibratedUntil && (int32_t)(calibratedUntil - now) > 0) return SetupScreen::Calibrated;
  if (buddy::passkey()) return SetupScreen::PairCode;
  if (buddy::pairingFailedRecently(now)) return SetupScreen::PairFailed;
  const char* r = net::setupResult();
  ssid = net::triedSsid();
  if (!strcmp(r, "trying")) return SetupScreen::Joining;
  if (strcmp(r, "none") && now - net::setupResultAt() < 4000)
    return !strcmp(r, "saved") ? SetupScreen::Joined : SetupScreen::WifiFailed;
  if (allSetUntil && (int32_t)(allSetUntil - now) > 0) return SetupScreen::AllSet;
  if (face == ExpressionId::Blocked || face == ExpressionId::Asked) return SetupScreen::None;  // Claude needs you: that wins
  if (!buddy::bonded()) return net::configured() ? SetupScreen::PairMe : SetupScreen::Hello;
  return SetupScreen::None;
}

static void setupReply(const char* result) {
  JsonDocument d;
  d["result"] = result;
  d["firmware"] = TOKI_VERSION;
  int yaw, pitch;
  body.headAngles(yaw, pitch);
  d["head"]["yaw"] = yaw;  // tenths of a degree from home, measured
  d["head"]["pitch"] = pitch;
  d["head"]["calibrating"] = body.calibrating();
  // Bluetooth with the Claude app: "paired" once the encrypted link is up.
  d["bluetooth"] = buddy::secure() ? "paired" : buddy::connected() ? "connecting" : buddy::passkey() ? "pairing" : "waiting";
  net::status(d["status"].to<JsonObject>());
  JsonObject s = d["settings"].to<JsonObject>();
  settings::toJson(s);
  String out;
  serializeJson(d, out);
  Serial.printf("## setup %s\n", out.c_str());
}

static void handleUsbLine(const String& line) {
  JsonDocument d;
  if (deserializeJson(d, line) || !d["setup"].is<const char*>()) return;
  const char* what = d["setup"];
  if (!strcmp(what, "status")) {
    setupReply("ok");
  } else if (!strcmp(what, "wifi")) {
    const bool ok = net::provision(d["ssid"] | "", d["pass"] | "", d["secret"] | "");
    logf("setup: wi-fi %s", ok ? "saved" : "refused");
    setupReply(ok ? "saved" : "invalid");
  } else if (!strcmp(what, "secret")) {
    const bool ok = net::setSecret(d["secret"] | "");
    logf("setup: link secret %s", ok ? "saved" : "refused");
    setupReply(ok ? "saved" : "invalid");
  } else if (!strcmp(what, "done")) {
    allSetUntil = millis() + 5000;
    body.celebrate(millis());
    logf("setup: all set");
    setupReply("ok");
  } else if (!strcmp(what, "calibrate")) {
    const char* step = d["step"] | "";
    const uint32_t now = millis();
    if (!strcmp(step, "home")) {
      body.holdHome(now);
      calibScreen = SetupScreen::CheckHead;
    } else if (!strcmp(step, "release")) {
      body.release(now);
      calibScreen = SetupScreen::Calibrate;
    } else if (!strcmp(step, "save")) {
      body.saveHome(now);
      calibScreen = SetupScreen::None;
      calibratedUntil = now + 3000;
    } else {  // resume, or anything else: back to normal
      body.resume(now);
      calibScreen = SetupScreen::None;
    }
    logf("setup: calibrate %s", step);
    setupReply("ok");
  } else if (!strcmp(what, "face")) {
    tourFace = ExpressionId::Count;
    for (int i = 0; i < (int)ExpressionId::Count; i++)
      if (!strcmp(kExpressionNames[i], d["name"] | "")) tourFace = (ExpressionId)i;
    tourUntil = tourFace != ExpressionId::Count ? millis() + (uint32_t)(d["ms"] | 60000) : 0;
    setupReply(tourFace != ExpressionId::Count ? "ok" : "ended");
  } else if (!strcmp(what, "forget")) {
    net::forget();
    setupReply("forgotten");
  }
}

static void readUsb() {
  static String buf;
  while (Serial.available()) {
    const int ch = Serial.read();
    if (ch == '\n') {
      handleUsbLine(buf);
      buf = "";
    } else if (ch >= 0 && ch != '\r' && buf.length() < 512) {
      buf += (char)ch;
    }
  }
}

/**
 * Day rollover, 02:00 local by default (spec §3.4; a setting since Phase 7): late
 * nights belong to the day they started in. A day never closed is simply
 * reopened, with its count cleared.
 */
static void checkNewDay() {
  static long lastDay = -1;
  if (!haveClock) return;
  const long rolloverHour = settings::get().rollover;
  const long day = (long)((time(nullptr) + utcOffsetMin * 60L - rolloverHour * 3600L) / 86400L);
  // Only forwards: moving the rollover hour later can make "today" step back, and
  // that mustn't count as a new day starting.
  if (lastDay >= 0 && day > lastDay) {
    state.newDay();
    logf("new day");
  }
  if (day > lastDay) lastDay = day;
}

void setup() {
  Serial.setTxTimeoutMs(0);  // never wait on USB: blocking writes froze the face
  M5StackChan.begin();
  Serial.begin(115200);
  settings::begin();
  M5.Display.setBrightness(settings::get().brightness);
  body.begin();

  // Bluetooth and Wi-Fi first, so they get the internal RAM they need. The
  // canvas (153 KB) goes in PSRAM: Wi-Fi and Bluetooth together leave too little
  // internal RAM for it (Phase 4; it costs about 2x draw time).
  const String name = buddy::deviceName();
  buddy::begin(name.c_str());
  net::begin();
  canvas.setColorDepth(16);
  canvas.setPsram(true);
  canvas.createSprite(320, 240);
  M5.Display.startWrite();
  logf("boot %s, canvas in PSRAM, internal free %u, largest %u", name.c_str(), heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
       heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
}

void loop() {
  static uint32_t frames = 0, lastReport = 0, drawUs = 0, pushUs = 0;
  static bool wasConnected = false, wasSecure = false;
  static uint32_t lastLinkMs = 0;  // when the secure link was last up (boot counts, so a reboot gets linkAfterMs to reconnect)
  M5StackChan.update();
  const uint32_t now = millis();

  if (buddy::connected() != wasConnected || buddy::secure() != wasSecure) {
    wasConnected = buddy::connected();
    wasSecure = buddy::secure();
    logf("link %s%s", wasConnected ? "connected" : "disconnected", wasSecure ? ", secure" : "");
  }
  if (buddy::secure()) lastLinkMs = now;
  readUsb();
  net::loop(now);
  settings::loop(now);
  String fromBridge;
  while (net::readLine(fromBridge)) handleBridge(fromBridge);
  checkNewDay();
  String line;
  while (buddy::readLine(line)) handleLine(line, now);
  handleTouch(now);
  state.tick(now);
  body.update(now, state);

  const uint32_t t0 = micros();
  bool bottom = true;
  {
    FaceInput in;
    in.expression = state.expression(now);
    in.setup = setupScreen(now, in.expression, in.setupSsid);
    in.setupCode = buddy::passkey();
    in.subagents = state.subagents();
    in.subagentCount = state.subagentCount();
    in.turnMs = state.turnMs(now);
    in.promptTool = state.promptTool();
    in.promptHint = state.promptHint();
    in.shutter = state.shutter(now);
    in.disconnected = !buddy::secure() && now - lastLinkMs > kTokens.linkAfterMs;
    in.always = net::bridgeUp() ? state.promptAlways() : "";
    in.alwaysAsk = alwaysAsk;
    in.questionHeader = state.questionHeader();
    in.labelMode = settings::get().label;
    in.labelObject = state.labelObject(in.expression);
    applyTour(in, now);
    bottom = renderer.draw(canvas, in, now, kTokens);
  }
  const uint32_t t1 = micros();
  const int band = bottom ? 240 : FACE_BAND;
  const int rows = band > lastBand ? band : lastBand;
  lastBand = band;
  // A plain push: the canvas is in PSRAM now, and we'd wait for a DMA transfer anyway.
  M5.Display.pushImage(0, 0, 320, rows, (const lgfx::swap565_t*)canvas.getBuffer());
  const uint32_t t2 = micros();

  frames++;
  drawUs += t1 - t0;
  pushUs += t2 - t1;
  if (now - lastReport > 10000) {
    logf("fps %.1f (draw %.1f ms, push %.1f ms), face %s, heap %u", frames * 1000.0f / (now - lastReport),
                  drawUs / 1000.0f / frames, pushUs / 1000.0f / frames, kExpressionNames[(int)state.expression(now)],
                  heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    frames = drawUs = pushUs = 0;
    lastReport = now;
  }
}
