// render-bench: Phase 3, step 2. How fast can the robot draw Toki's face?
//
// Draws a stand-in face built from the same primitives as the simulator (see
// simulator/src/face) into an off-screen canvas, and times drawing and pushing
// to the panel separately, for each strategy we might use:
//   full     plain (aliased) shapes, whole-screen push
//   region   the same, pushing only the face area (320 x 160)
//   smooth   anti-aliased shapes (fillSmoothCircle, drawWideLine, fillSmoothRoundRect)
//   busy     smooth face plus many small extras (4 mini pairs, 3 stars, www)
//   lens     smooth face plus the magnifier (readRect, pushRotateZoom, masked lens)
//   canvas8  the full test on an 8-bit canvas in internal RAM instead of 16-bit PSRAM
// Results go to the screen and to USB serial as "## bench {json}" lines.
// At the end, the screen holds a side-by-side of aliased vs smooth edges on the
// real glass. The head is held at its rest pose; no other servo movement.

#include "bench.h"

void setup() { benchSetup(); }

void loop() { benchLoop(); }
