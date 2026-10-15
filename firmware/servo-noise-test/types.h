#pragma once
#include <stdint.h>

struct Trial {
  const char* name;
  int yaw, pitch;  // the "out" pose; every trial returns to rest afterwards
  int speed;       // 0 to 1000 in the BSP
};

struct Measure {
  float quietDb, peakDb, meanDb;
  uint32_t outMs, backMs;
};
