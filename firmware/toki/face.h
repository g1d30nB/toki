// Toki's face on the robot: a port of simulator/src/face (animator, eyes, brows,
// mouth). The face *data* (tokens, expressions, palette) is generated into
// face_data.h; this file is the drawing and motion code. Keep the two sides in
// step: when the simulator's drawing code changes, port the change here.
#pragma once

#include <M5Unified.h>

#include "face_data.h"

namespace toki {

struct Eye {
  float cx, cy, rx, ry;
  int side;  // -1 left, +1 right
};

struct Pose {
  float scale, roundness, open, smile, squint;
  Vec2 pupil;
  float pupilScale, highlight;
  Brows brows;
  float slide, mouthShift;
  EyeShape shape;
  Mouth mouth;
};

struct AnimatedFace {
  EyeShape shape;
  Mouth mouth;
  float scale, roundness;
  float open;  // after blinks
  float smile, squint;
  float pupilX, pupilY;  // -1..1, after gaze loops
  float pupilScale, highlight;
  float saccadeX, saccadeY;  // px
  Brows brows;
  float mouthShift;
  float stretch;  // squash and stretch on expression change: 1 = rest
  float offsetY;  // breathing plus slide, px
};

// Eases between expressions and layers blinks, saccades, gaze loops and
// breathing on top (spec §4.2, §7.4). Mirrors simulator/src/face/animator.ts.
class FaceAnimator {
 public:
  AnimatedFace update(uint32_t now, ExpressionId target, const Tokens& tk);
  uint32_t since() const { return changedAt_; }

 private:
  Pose targetPose(uint32_t now) const;
  Pose poseAt(uint32_t now, const Tokens& tk) const;
  float blinkAmount(uint32_t now) const;
  Vec2 gazeOffset(uint32_t now, Gaze gaze, const Tokens& tk);
  float rand();

  uint32_t rng_ = 7;
  ExpressionId current_ = ExpressionId::Idle;
  Pose from_{};
  bool haveFrom_ = false;
  uint32_t changedAt_ = 0;

  uint32_t nextBlink_ = 0, blinkStart_ = 0;
  float blinkLen_ = 120;
  bool doubleBlink_ = false;

  uint32_t nextSaccade_ = 0, saccadeAt_ = 0;
  float sx_ = 0, sy_ = 0, sfx_ = 0, sfy_ = 0;

  uint32_t gazeT0_ = 0;
  float dartX_ = 0, dartY_ = 0;
  uint32_t dartNext_ = 0;
  float glanceX_ = 0;
  uint32_t glanceUntil_ = 0, glanceNext_ = 4000;

  float breathPhase_ = 0;
  uint32_t lastNow_ = 0;
};

const Expression& expression(ExpressionId id);
Pose poseOf(const Expression& e);

void eyeLayout(const AnimatedFace& f, const Tokens& tk, Eye out[2]);
void drawEyes(M5Canvas& g, const AnimatedFace& f, const Tokens& tk, uint32_t now);
void drawMouth(M5Canvas& g, const AnimatedFace& f, const Tokens& tk, uint32_t now);

}  // namespace toki
