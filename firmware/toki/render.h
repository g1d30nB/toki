// Composes Toki's screen: face, mouth, minis, manpu and the approval chrome.
// Port of simulator/src/face/render.ts (and manpu.ts, minis.ts).
#pragma once

#include "face.h"

namespace toki {

// dots, sweat, magnifier, www, sparkles, blush, zzz, question, then setup's Wi-Fi
// mark (joining, joined) and sleepy's yawn tears: the Manpu_* bits in face_data.h.
constexpr int kManpuKinds = 11;

/** Toki's side of setup (Phase 7; port of simulator/src/face/setup.ts), in the order a new owner meets them. */
enum class SetupScreen : uint8_t { None, Hello, Joining, Joined, WifiFailed, PairMe, PairCode, PairFailed, AllSet, CheckHead, Calibrate, Calibrated };

/**
 * Toki's typeface (Gideon, 15 Oct): Baloo 2, as smooth (anti-aliased) fonts built
 * by firmware/fonts/make-vlw.py, loaded once and shared. Bold 28 for buttons and
 * titles, Medium 28 for lines, the 22s for the label, hints and text that has to
 * shrink, and a digits-only cut for the pairing code.
 */
enum class Baloo : uint8_t { Bold28, Medium28, Bold22, Medium22, Digits54 };
void useFont(M5Canvas& g, Baloo f);

/** Mixes two RGB888 colours: on the flat navy ground, stepping towards it is how things "fade". */
uint32_t mix(uint32_t a, uint32_t b, float t);

class ManpuLayer {
 public:
  void draw(M5Canvas& g, uint16_t want, const AnimatedFace& f, const Tokens& tk, uint32_t now, float grow);

 private:
  struct Live {
    bool on = false, leaving = false;
    uint32_t since = 0, leftAt = 0;
  };
  Live live_[kManpuKinds];
};

class MiniLayer {
 public:
  void update(const uint32_t* ids, int count, uint32_t now, const Tokens& tk);
  void draw(M5Canvas& g, uint32_t now, const Tokens& tk, const Eye mainEyes[2]);
  bool visible() const;
  bool lastSpawn(uint32_t& at, float& x, float& y) const;
  float presence = 0;  // 0..1, eased: the main eyes shrink by this

 private:
  struct Mini {
    bool used;
    uint32_t id;
    int slot;
    uint32_t born;
    bool leaving;
    uint32_t leftAt, nextBlink, blinkAt, nextGlance, glanceAt;
  };
  struct Spot {
    float x, y, tilt, size;
  };
  static void slots(const Tokens& tk, Spot out[4]);
  float rand();
  Mini minis_[8] = {};
  uint32_t rng_ = 11, lastNow_ = 0, spawnAt_ = 0;
  float spawnX_ = 0, spawnY_ = 0;
  bool haveSpawn_ = false;
};

/**
 * The night shutter (spec §3.4): comes down over the face once the day is closed,
 * fully with a CLOSED sign when earned, most of the way when quiet. Blocked rolls
 * it up. Port of simulator/src/face/shutter.ts.
 */
class Shutter {
 public:
  void update(uint32_t now, float target, const Tokens& tk);
  void draw(M5Canvas& g, const Tokens& tk, bool earned) const;
  float pos = 0;  // fraction of the screen covered, 0 open .. 1 fully down

 private:
  float vel_ = 0;  // fraction per second, down is positive
  uint32_t last_ = 0;
  bool have_ = false;
};

/** Everything the screen needs to know this frame. */
struct FaceInput {
  ExpressionId expression;
  const uint32_t* subagents = nullptr;  // running subagent ids
  int subagentCount = 0;
  uint32_t turnMs = 0;  // how long the current turn has run (long turn)
  const char* promptTool = "Bash";
  const char* promptHint = "npm test";
  float shutter = 0;  // night shutter target: 0 open, 1 earned, 0.8 quiet
  bool disconnected = false;  // no secure link to the Claude app for linkAfterMs
  const char* always = "";    // what Always allow would do, in words ("" = not on offer)
  bool alwaysAsk = false;     // the "Always allow?" confirm screen is up
  const char* questionHeader = "";  // asked: Claude's short label for the question
  SetupScreen setup = SetupScreen::None;  // a setup screen instead of the usual
  const char* setupSsid = "";             // joining / joined / couldn't join: the network
  uint32_t setupCode = 0;                 // the pairing code
  uint8_t labelMode = 2;          // the label under the face: 0 off, 1 words, 2 detail (settings)
  const char* labelObject = "";   // what the latest tool works on, when it belongs to this face
};

class FaceRenderer {
 public:
  /** Draws a frame. Returns true if anything was drawn in the bottom band (rows 192+). */
  bool draw(M5Canvas& g, const FaceInput& in, uint32_t now, const Tokens& tk);

 private:
  FaceAnimator anim_;
  ManpuLayer manpu_;
  MiniLayer minis_;
  Shutter shutter_;
  bool earned_ = true;  // the last close: full shutter with its sign, or most of the way
  ExpressionId lastId_ = ExpressionId::Count;
  uint32_t sparklesFrom_ = 0;
  bool haveSparkles_ = false;

  /** The label under the face. Returns true while it changes (the bottom band must be pushed). */
  bool drawLabel(M5Canvas& g, ExpressionId id, const FaceInput& in, uint32_t now, const Tokens& tk);
  bool labelOn_ = false;
  char labelVerb_[24] = "", labelObj_[40] = "";
  uint32_t labelAt_ = 0;
};

}  // namespace toki
