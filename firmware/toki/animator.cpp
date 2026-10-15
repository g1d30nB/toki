// Port of simulator/src/face/animator.ts.
#include <math.h>

#include "face.h"

namespace toki {

namespace {
float lerp(float a, float b, float t) { return a + (b - a) * t; }
float easeInOut(float t) { return t < 0.5f ? 2 * t * t : 1 - powf(-2 * t + 2, 2) / 2; }
float clamp01(float t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

Pose blend(const Pose& a, const Pose& b, float t) {
  Pose p;
  p.scale = lerp(a.scale, b.scale, t);
  p.roundness = lerp(a.roundness, b.roundness, t);
  p.open = lerp(a.open, b.open, t);
  p.smile = lerp(a.smile, b.smile, t);
  p.squint = lerp(a.squint, b.squint, t);
  p.pupil = {lerp(a.pupil.x, b.pupil.x, t), lerp(a.pupil.y, b.pupil.y, t)};
  p.pupilScale = lerp(a.pupilScale, b.pupilScale, t);
  p.highlight = lerp(a.highlight, b.highlight, t);
  p.brows = {lerp(a.brows.y, b.brows.y, t), lerp(a.brows.angle, b.brows.angle, t), lerp(a.brows.tilt, b.brows.tilt, t),
             lerp(a.brows.len, b.brows.len, t)};
  p.slide = lerp(a.slide, b.slide, t);
  p.mouthShift = lerp(a.mouthShift, b.mouthShift, t);
  // Discrete parts swap at the midpoint, hidden in the squeeze.
  p.shape = t < 0.5f ? a.shape : b.shape;
  p.mouth = t < 0.5f ? a.mouth : b.mouth;
  return p;
}
}  // namespace

const Expression& expression(ExpressionId id) { return kExpressions[(int)id]; }

Pose poseOf(const Expression& e) {
  return Pose{e.scale, e.roundness, e.open, e.smile, e.squint, e.pupil, e.pupilScale, e.highlight,
              e.brows, e.slide, e.mouthShift, e.shape, e.mouth};
}

// Small seeded random generator (mulberry32), so motion repeats run to run.
float FaceAnimator::rand() {
  rng_ += 0x6d2b79f5u;
  uint32_t t = rng_;
  t = (t ^ (t >> 15)) * (1 | t);
  t = (t + ((t ^ (t >> 7)) * (61 | t))) ^ t;
  return ((t ^ (t >> 14)) & 0xffffffu) / 16777216.0f;
}

Pose FaceAnimator::targetPose(uint32_t now) const {
  const Expression& to = expression(current_);
  Pose p = poseOf(to);
  if (to.introMs && now - changedAt_ < to.introMs) p.shape = to.introShape;
  return p;
}

Pose FaceAnimator::poseAt(uint32_t now, const Tokens& tk) const {
  const float k = tk.transitionMs > 0 ? clamp01((now - changedAt_) / tk.transitionMs) : 1;
  return blend(from_, targetPose(now), easeInOut(k));
}

AnimatedFace FaceAnimator::update(uint32_t now, ExpressionId target, const Tokens& tk) {
  if (!haveFrom_) {
    from_ = poseOf(expression(current_));
    haveFrom_ = true;
  }
  const float dt = fminf(100, (float)(now - lastNow_));
  lastNow_ = now;

  if (target != current_) {
    from_ = poseAt(now, tk);  // hand over smoothly, even mid-transition
    current_ = target;
    changedAt_ = now;
    gazeT0_ = now;
  }
  const Expression& to = expression(current_);
  const float k = tk.transitionMs > 0 ? clamp01((now - changedAt_) / tk.transitionMs) : 1;
  const Pose pose = poseAt(now, tk);

  // A shape change is hidden in a quick squeeze; squash and stretch otherwise.
  const bool shapeChange = from_.shape != targetPose(now).shape && k < 1;
  const float squeeze = shapeChange ? 1 - sinf(k * PI) * 0.85f : 1;
  const float stretch = k < 1 ? 1 - sinf(k * PI) * 0.08f - sinf(k * PI * 2) * 0.025f : 1;

  // Blinks: blinkMin..blinkMax apart (scaled by the expression), some doubles.
  if (now >= nextBlink_) {
    blinkStart_ = now;
    blinkLen_ = tk.blinkMs * to.blinkSoftness;
    doubleBlink_ = rand() < tk.doubleBlinkChance;
    nextBlink_ = now + (uint32_t)(lerp(tk.blinkMin, tk.blinkMax, rand()) * to.blinkRate);
  }
  const float blink = blinkAmount(now);

  // Tiny saccades: every saccadeMin..saccadeMax, a 2..saccadePx shift over 40 ms.
  if (now >= nextSaccade_) {
    const float a = rand() * PI * 2;
    const float r = lerp(2, tk.saccadePx, rand());
    sfx_ = sx_;
    sfy_ = sy_;
    sx_ = cosf(a) * r;
    sy_ = sinf(a) * r * 0.6f;
    saccadeAt_ = now;
    nextSaccade_ = now + (uint32_t)lerp(tk.saccadeMin, tk.saccadeMax, rand());
  }
  const float sk = clamp01((now - saccadeAt_) / 40.0f);

  const Vec2 gaze = gazeOffset(now, to.gaze, tk);

  // Breathing: ±breathPx, slower at idle.
  const float period = to.busy ? tk.breathBusyMs : tk.breathIdleMs;
  breathPhase_ = fmodf(breathPhase_ + dt / period, 1.0f);
  const float breath = sinf(breathPhase_ * PI * 2) * tk.breathPx;

  AnimatedFace f;
  f.shape = pose.shape;
  f.mouth = pose.mouth;
  f.scale = pose.scale;
  f.roundness = pose.roundness;
  f.open = pose.open * blink * squeeze;
  f.smile = pose.smile;
  f.squint = pose.squint;
  f.pupilX = pose.pupil.x + gaze.x;
  f.pupilY = pose.pupil.y + gaze.y;
  f.pupilScale = pose.pupilScale;
  f.highlight = pose.highlight;
  f.saccadeX = lerp(sfx_, sx_, sk);
  f.saccadeY = lerp(sfy_, sy_, sk);
  f.brows = pose.brows;
  f.mouthShift = pose.mouthShift;
  f.stretch = stretch;
  f.offsetY = breath + pose.slide;
  return f;
}

float FaceAnimator::blinkAmount(uint32_t now) const {
  auto one = [&](uint32_t start) {
    if (now < start) return 1.0f;
    const float p = (now - start) / blinkLen_;
    if (p > 1) return 1.0f;
    return fabsf(p - 0.5f) * 2;  // close then open
  };
  float v = one(blinkStart_);
  if (doubleBlink_) v = fminf(v, one(blinkStart_ + (uint32_t)(blinkLen_ * 1.6f)));
  return v;
}

Vec2 FaceAnimator::gazeOffset(uint32_t now, Gaze gaze, const Tokens& tk) {
  const float t = (float)(now - gazeT0_);
  switch (gaze) {
    case Gaze::Scan: {
      // Reading: short sweeps left to right, then a quick return to the next line.
      const float p = fmodf(t, 1400) / 1400;
      const float x = p < 0.82f ? lerp(-0.55f, 0.55f, p / 0.82f) : lerp(0.55f, -0.55f, (p - 0.82f) / 0.18f);
      return {x, ((int)(t / 1400) % 3) * 0.12f - 0.12f};
    }
    case Gaze::ScrollUp: {
      // Running a command: eyes ride the output up the screen, then drop back.
      const float p = fmodf(t, 1100) / 1100;
      return {0, p < 0.85f ? lerp(0.45f, -0.35f, p / 0.85f) : lerp(-0.35f, 0.45f, (p - 0.85f) / 0.15f)};
    }
    case Gaze::Dart: {
      if (now >= dartNext_) {
        dartX_ = (rand() - 0.5f) * 1.1f;
        dartY_ = (rand() - 0.5f) * 0.7f;
        dartNext_ = now + (uint32_t)lerp(280, 700, rand());
      }
      return {dartX_, dartY_};
    }
    case Gaze::FollowWww: {
      // The web: drift left to right with the www wave, ease back in the pause.
      const float cycle = tk.wwwWaveMs + tk.wwwPauseMs;
      const float at = fmodf(t, cycle);
      const float p = at < tk.wwwWaveMs ? easeInOut(at / tk.wwwWaveMs) : 1 - easeInOut((at - tk.wwwWaveMs) / tk.wwwPauseMs);
      return {lerp(-0.6f, 0, p), 0};
    }
    case Gaze::LookAround: {
      // Idle: now and then, a slow glance to one side of the room and back.
      if (now >= glanceNext_) {
        glanceX_ = rand() < 0.5f ? -0.6f : 0.6f;
        glanceUntil_ = now + 1600;
        glanceNext_ = now + (uint32_t)lerp(6000, 11000, rand());
      }
      const float into = clamp01(((float)now - ((float)glanceUntil_ - 1600)) / 400);
      const float out = clamp01(((float)now - (float)glanceUntil_) / 400);
      return {glanceX_ * easeInOut(into) * (1 - easeInOut(out)), 0};
    }
    default:
      return {0, 0};
  }
}

}  // namespace toki
