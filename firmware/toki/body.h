// Toki's body: the servo moves and LEDs (spec §5). The servos are loud, so the
// head moves only to interrupt: rising to meet your eyes when Claude needs you,
// a nod when you approve, turning away for quiet mode, and a wiggle when you
// close an earned day. Everything ambient stays on the screen.
#pragma once

#include <stdint.h>

#include "state.h"

namespace toki {

class Body {
 public:
  void begin();
  /** Call every loop: starts moves on state changes and runs the ones scheduled. */
  void update(uint32_t now, const AgentState& s);
  /** You approved on the robot: the head nods when it settles. */
  void approved(uint32_t now) { approvedAt_ = now; }
  /** A happy wiggle of the head: an earned close, and the first time setup finishes ("All set!"). */
  void celebrate(uint32_t now);

  // Calibration (Phase 7, `toki calibrate`). While any of these is in play the
  // body makes no moves of its own; after 3 minutes without a word from the Mac
  // it resumes by itself, so the motors are never left off.
  /** Head to home (level, straight ahead) and hold there: "is that right?" */
  void holdHome(uint32_t now);
  /** Motors off: the head can be set by hand. */
  void release(uint32_t now);
  /** Where the head is now becomes home; motors on; back to the resting angle. */
  void saveHome(uint32_t now);
  /** The head's measured angles (tenths of a degree from home): just after saveHome, about 0, 0. */
  void headAngles(int& yaw, int& pitch);
  /** Motors on, back to the resting angle, normal moves again. */
  void resume(uint32_t now);
  bool calibrating() const { return paused_; }
  /** Session dots from the bridge (step 7c): one colour per LED pair, already dimmed. */
  void setDots(const uint8_t rgb[6][3], uint32_t now);

 private:
  struct Step {
    uint32_t at;
    int16_t yaw, pitch, speed;
  };
  void clear() { count_ = 0; }
  void schedule(uint32_t at, int yaw, int pitch, int speed);
  void leds(uint32_t now, bool blocked);

  Step steps_[8];
  int count_ = 0;
  int yaw_ = 0, pitch_ = 0;  // the last target sent
  bool wasBlocked_ = false, wasQuiet_ = false, wasClosed_ = false;
  bool paused_ = false;  // calibrating: no moves of our own
  uint32_t pausedUntil_ = 0;
  /** A move that starts from where the head physically is (it may have been moved by hand), never a snap. */
  void glide(int yaw, int pitch, int speed);
  uint32_t approvedAt_ = 0;
  uint32_t ledAt_ = 0;
  bool ledOn_ = false;  // the amber glow is showing
  uint8_t dots_[6][3] = {};
  uint32_t dotsAt_ = 0;
  bool haveDots_ = false, dotsShown_ = false, dotsDirty_ = true;
};

}  // namespace toki
