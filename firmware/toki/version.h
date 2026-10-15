// Toki's firmware version. packaging/build-release.ts writes this from
// bridge/package.json before building a release, so `toki setup` can tell
// whether the robot already runs the version this Mac has.
#pragma once
#define TOKI_VERSION "0.1.4"
