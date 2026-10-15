// Spec §5. Speeds are BSP units (0 to 1000); angles are tenths of a degree from
// the calibrated zero (level, facing you). Measured on 2 Oct: speeds up to 400
// rate 2 to 3 out of 5 for noise from the desk chair, so moves stay at 300 and
// only the dip and the celebration wiggle use the 600 maximum.
#include "body.h"

#include <M5StackChan.h>
#include <math.h>
#include <string.h>

namespace toki {

namespace {
// servo.rest.pitch: 3 degrees above home. Home is the screen standing straight up
// (M5Stack's factory convention, and what toki calibrate sets). It was 280 (28
// degrees) on top of Gideon's 3 Oct calibration, which set home 28 degrees below
// upright; on any factory robot that rested tipped back 28 degrees (found 15 Oct).
constexpr int kRestPitch = 30;
constexpr int kRise = 120;       // blocked: the head rises 12 degrees to meet your eyes
constexpr int kDip = 30;         // ...after a quick 3 degree dip (to upright), so the rise reads as intent
constexpr int kNod = 100;        // approve: a 10 degree nod
constexpr int kQuietYaw = 150;   // quiet mode: turned 15 degrees away
constexpr int kWiggle = 250;     // earned close: 25 degrees each way
constexpr int kSpeed = 300;      // servo.speed.rise / nod / glance
constexpr int kSpeedMax = 600;   // servo.speed.max

int clampYaw(int v) { return v < -800 ? -800 : v > 800 ? 800 : v; }
// From upright (home) to 85 degrees up; the library itself stops at 0 (it can't look below home).
int clampPitch(int v) { return v < 0 ? 0 : v > 850 ? 850 : v; }
}  // namespace

void Body::begin() {
  M5StackChan.Motion.setAutoTorqueReleaseEnabled(false);  // hold the rest pose silently
  yaw_ = 0;
  pitch_ = kRestPitch;
  M5StackChan.Motion.move(yaw_, pitch_, 150);
  M5StackChan.showRgbColor(0, 0, 0);
}

void Body::schedule(uint32_t at, int yaw, int pitch, int speed) {
  if (count_ < 8) steps_[count_++] = {at, (int16_t)clampYaw(yaw), (int16_t)clampPitch(pitch), (int16_t)speed};
}

void Body::celebrate(uint32_t now) {
  // The spec's spin, as a wiggle: the head turns only ±80 degrees.
  clear();
  schedule(now, kWiggle, kRestPitch, kSpeedMax);
  schedule(now + 400, -kWiggle, kRestPitch, kSpeedMax);
  schedule(now + 800, kWiggle, kRestPitch, kSpeedMax);
  schedule(now + 1200, 0, kRestPitch, kSpeed);
}

void Body::glide(int yaw, int pitch, int speed) {
  // The library starts a move from where it last sent the head; after a hand has
  // moved it, that would snap. Syncing reads the real position first.
  M5StackChan.Motion.setAutoAngleSyncEnabled(true);
  M5StackChan.Motion.move(clampYaw(yaw), clampPitch(pitch), speed);
  M5StackChan.Motion.setAutoAngleSyncEnabled(false);
  yaw_ = clampYaw(yaw);
  pitch_ = clampPitch(pitch);
}

void Body::holdHome(uint32_t now) {
  clear();
  M5StackChan.Motion.setTorqueEnabled(true);
  glide(0, 0, 150);
  paused_ = true;
  pausedUntil_ = now + 180000;
}

void Body::release(uint32_t now) {
  clear();
  M5StackChan.Motion.setTorqueEnabled(false);  // the head goes limp; it may tip back
  paused_ = true;
  pausedUntil_ = now + 180000;
}

void Body::saveHome(uint32_t now) {
  M5StackChan.Motion.setCurrentPostionAsHome();  // the library refuses a failed read rather than store it
  resume(now);
}

void Body::headAngles(int& yaw, int& pitch) {
  yaw = M5StackChan.Motion.getCurrentYawAngle();  // measured, not commanded
  pitch = M5StackChan.Motion.getCurrentPitchAngle();
}

void Body::resume(uint32_t now) {
  clear();
  M5StackChan.Motion.setTorqueEnabled(true);
  glide(0, kRestPitch, 150);
  paused_ = false;
}

void Body::update(uint32_t now, const AgentState& s) {
  const bool blocked = s.blocked();
  const bool quiet = s.quiet(now);
  const bool closed = s.dayClosed();
  const int restYaw = quiet ? kQuietYaw : 0;
  if (paused_) {
    // Calibrating: hold still, and never leave the motors off for good.
    if ((int32_t)(now - pausedUntil_) >= 0) resume(now);
    wasBlocked_ = blocked;
    wasQuiet_ = quiet;
    wasClosed_ = closed;
    leds(now, blocked);
    return;
  }

  if (blocked && !wasBlocked_) {
    // Rise to meet your eyes: a quick dip, then a slow rise, facing you.
    clear();
    schedule(now, 0, kRestPitch - kDip, kSpeedMax);
    schedule(now + 80, 0, kRestPitch + kRise, kSpeed);
  } else if (!blocked && wasBlocked_) {
    clear();
    if (now - approvedAt_ < 600) {
      // You approved on the robot: one small nod, then settle.
      schedule(now, 0, kRestPitch + kRise - kNod, kSpeed);
      schedule(now + 450, restYaw, kRestPitch, kSpeed);
    } else {
      schedule(now, restYaw, kRestPitch, kSpeed);  // settle down
    }
  } else if (!blocked && quiet != wasQuiet_) {
    clear();
    schedule(now, restYaw, kRestPitch, kSpeed);  // turn away slightly, or back
  }
  if (closed && !wasClosed_ && s.earned()) celebrate(now);
  wasBlocked_ = blocked;
  wasQuiet_ = quiet;
  wasClosed_ = closed;

  // Run what's due, in order. Moves are non-blocking: the BSP springs the servos
  // on its own task, so the face keeps drawing.
  int kept = 0;
  for (int i = 0; i < count_; i++) {
    const Step& st = steps_[i];
    if ((int32_t)(now - st.at) >= 0) {
      if (st.yaw != yaw_ || st.pitch != pitch_) M5StackChan.Motion.move(st.yaw, st.pitch, st.speed);
      yaw_ = st.yaw;
      pitch_ = st.pitch;
    } else {
      steps_[kept++] = st;
    }
  }
  count_ = kept;

  leds(now, blocked);
}

void Body::setDots(const uint8_t rgb[6][3], uint32_t now) {
  if (memcmp(rgb, dots_, sizeof dots_) != 0) dotsDirty_ = true;
  memcpy(dots_, rgb, sizeof dots_);
  dotsAt_ = now;
  haveDots_ = true;
}

void Body::leds(uint32_t now, bool blocked) {
  // A soft amber glow while Toki waits on you: a second cue when you're not
  // looking at the screen. Otherwise, one dim dot per active Claude session in its
  // colour (step 7c, from the bridge; gone if the bridge goes quiet for 90 s).
  // The LEDs sit behind an I2C expander, so they're only written when they change
  // (the glow at 20 Hz).
  if (!blocked) {
    const bool fresh = haveDots_ && now - dotsAt_ < 90000;
    if (ledOn_ || dotsDirty_ || fresh != dotsShown_) {
      for (int i = 0; i < 6; i++) {
        const uint8_t* c = dots_[i];
        // Pair i: LED i on the left strip, LED 6 + i on the right.
        M5StackChan.setRgbColor(i, fresh ? c[0] : 0, fresh ? c[1] : 0, fresh ? c[2] : 0);
        M5StackChan.setRgbColor(6 + i, fresh ? c[0] : 0, fresh ? c[1] : 0, fresh ? c[2] : 0);
      }
      M5StackChan.refreshRgb();
      dotsShown_ = fresh;
      dotsDirty_ = false;
    }
    ledOn_ = false;
    return;
  }
  if (ledOn_ && now - ledAt_ < 50) return;
  ledAt_ = now;
  ledOn_ = true;
  const float breath = 0.5f - 0.5f * cosf((now % 2400) / 2400.0f * 2 * PI);  // 0 → 1 → 0 over 2.4 s
  const float k = 0.12f + 0.28f * breath;
  M5StackChan.showRgbColor((uint8_t)(255 * k), (uint8_t)(120 * k), 0);
}

}  // namespace toki
