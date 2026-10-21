// Face tokens: every number that shapes Toki's face, by name, so design notes
// like "eyes 10% bigger" or "slower blinks" change one value.
// Motion values follow spec §7.4; all are (tune).

export type FaceTokens = {
  // Geometry, in screen pixels (320 x 240)
  eyeY: number; // eye centre height
  eyeSpacing: number; // distance between eye centres
  eyeRx: number; // eye half-width
  eyeRy: number; // eye half-height
  outline: number; // navy outline thickness (sticker linework)
  border: number; // cream die-cut border outside the outline, so it reads on the navy ground
  irisR: number;
  pupilR: number;
  highlightR: number;
  // Kawaii pass (21 Oct): solid dark eyes with two shines, one thin line weight,
  // pink cheeks on every face, small arched brows.
  lineWeight: number; // stroke radius of every line: closed eyes, lids, brows, lashes
  shineBig: number; // the big shine, top right: radius as a fraction of the eye
  shineMid: number; // the third shine, on the right: only while the eye is fully round
  shineSmall: number; // the small shine, low in the middle
  lookTravel: number; // px the whole eye moves when Toki looks (the eyes have no separate pupil)
  cheekRx: number; // cheek half-width
  cheekRy: number;
  cheekX: number; // cheek centre, outwards from the eye's centre
  cheekY: number; // and down from it
  browCurve: number; // how arched the brows are: 0 straight, 0.5 a half-moon
  browThick: number; // a brow is a crescent: this thick in the middle, tapering to points
  lashLen: number; // the three lashes on lashed closed eyes

  smileCurve: number; // radius of the smiling lower lid, in eye widths: smaller is a rounder curve
  manpuScale: number;
  dotsStepMs: number; // "…" adds a dot every this many ms
  dotsGap: number; // "…" height above the eyes
  lensR: number; // search magnifier lens radius
  lensZoom: number; // how much the lens magnifies
  lensRim: number;
  lensY: number; // lens height on the eye, as a fraction of the eye's half-height (down is positive)
  lensDriftMs: number; // one slow sweep across the eye; 0 holds still
  wwwW: number; // web: width of each W
  wwwH: number;
  wwwGap: number;
  wwwWeight: number; // stroke radius: lighter than the brows so a 17 px W doesn't close up
  wwwAbove: number; // how far above the top of the right eye the Ws sit
  wwwLift: number; // how far each W lifts in the wave
  wwwWaveMs: number; // W1, W2, W3 lift in turn over this time
  wwwPauseMs: number; // then rest, so the loop breathes
  sweatSlideMs: number; // the sweat drop slides in instead of popping
  zzzSize: number; // quiet: the first "z" (text stays 20 px or more, spec §7.3)
  zzzGrow: number; // each Z after it is this much bigger
  zzzStep: number; // px between letters, left to right
  zzzRise: number; // px each letter climbs above the last
  zzzCycleMs: number; // pop in one by one, hold, fade, repeat
  zzzFirstUp: number; // the first, smallest z sits this much higher (face review, 21 Oct)
  tearMs: number; // sleepy: how long the yawn tears show (the yawn's intro is 2 s)
  sparkleLarge: number; // done: star radii, px (the smallest stays 8 px or more across)
  sparkleMid: number;
  sparkleSmall: number;
  sparkleConcave: number; // superellipse exponent: lower pulls the sides further in
  sparkleTip: number; // tip rounding radius
  sparkleX: number; // cluster position from the right eye's outer edge
  sparkleY: number; // and from its top
  sparklePopMs: number;
  sparkleStaggerMs: number;
  sparkleTwinkle: number; // scale pulse once in
  sparkleHoldMs: number; // then fade
  sparkleFadeMs: number;
  miniR: number; // spawned minis (subagents): each mini eye's radius; 7 is the 14 px minimum
  miniGap: number; // between a mini's two eyes
  miniBrowGap: number; // little brows above the mini eyes
  miniBrowLen: number;
  miniBrowWeight: number;
  miniBrowAngle: number; // degrees; positive lifts the inner ends
  miniPupil: number; // pupil as a fraction of the mini
  miniLook: number; // how far minis' pupils lean towards Toki's eyes at rest (0..0.6)
  miniCap: number; // most minis shown at once
  // Where each mini lands, in arrival order: hand-placed to look scattered, close
  // to the eyes, clear of brows, mouth and each other (Gideon, 3 Oct).
  miniS1x: number; // spot 1: centre, tilt (degrees) and size
  miniS1y: number;
  miniS1tilt: number;
  miniS1size: number;
  miniS2x: number; // spot 2: centre, tilt (degrees) and size
  miniS2y: number;
  miniS2tilt: number;
  miniS2size: number;
  miniS3x: number; // spot 3: centre, tilt (degrees) and size
  miniS3y: number;
  miniS3tilt: number;
  miniS3size: number;
  miniS4x: number; // spot 4: centre, tilt (degrees) and size
  miniS4y: number;
  miniS4tilt: number;
  miniS4size: number;
  miniInMs: number; // pop in: squash and stretch
  miniStaggerMs: number; // between minis arriving together
  miniOutMs: number; // pop out: shrink with a small overshoot
  miniShrink: number; // main eyes scale down by this while minis are present
  miniShrinkMs: number; // ease time for that
  miniGlanceMs: number; // main eyes glance at a new mini, then settle
  miniBob: number; // px; 0 turns the bob off
  manpuInMs: number; // pop in, 10% overshoot (spec §7.4 manpu.in)
  manpuOutMs: number; // spec manpu.out; shrinks away (the robot can't fade)
  longTurnMin: number; // minutes before the sweat drop appears and grows (spec §4.2 long turn)
  mouthY: number; // below the eye centres
  mouthWidth: number;
  mouthWeight: number; // stroke radius
  mouthX: number; // horizontal offset from the centre line, px (0 = centred)
  tongueSide: number; // edit's tongue: 1 right corner, -1 left, 0 middle
  hintY: number; // blocked: the tool and hint line
  hintSize: number;
  buttonY: number; // blocked: Allow / Deny pills
  buttonH: number;
  labelY: number; // the label under the face (face/label.ts): top of its line
  labelHoldMs: number; // a new label waits this long, so fast tool calls don't flicker it
  labelInMs: number; // and fades in over this long (stepping from the ground, no transparency)
  giggleHops: number; // boop: once the eyes close, the whole face hops this many times (Gideon, 3 Oct)
  giggleMs: number; // over this long
  gigglePx: number; // first hop height; each one after is smaller
  linkX: number; // disconnected: the Bluetooth symbol's centre, top left (top right belongs to the manpu)
  linkY: number;
  linkH: number; // its height
  linkAfterMs: number; // shown only after this long without a link, so reboots and blips don't flicker it
  shutterSlat: number; // night shutter: slat pitch, px
  shutterDropMs: number; // a full drop under gravity, before its small bounce
  shutterRiseMs: number; // rolling up (blocked, or the day reopens)
  doubleTapMs: number; // touch: a second tap within this is a double-tap
  longPressMs: number; // touch: held this long is a long-press
  browGap: number; // brow height above the top of the eye
  browLength: number;
  browWeight: number; // stroke radius

  // Motion, in milliseconds
  blinkMin: number;
  blinkMax: number;
  blinkMs: number;
  doubleBlinkChance: number; // 0 to 1
  saccadeMin: number;
  saccadeMax: number;
  saccadePx: number; // largest tiny eye shift
  breathIdleMs: number;
  breathBusyMs: number;
  breathPx: number;
  transitionMs: number; // expression change
};

export const defaultTokens: FaceTokens = {
  eyeY: 100,
  eyeSpacing: 124,
  eyeRx: 32,
  eyeRy: 34,
  outline: 6,
  border: 0,
  irisR: 27,
  pupilR: 14,
  highlightR: 6,
  lineWeight: 2.6,
  shineBig: 0.33,
  shineMid: 0.21,
  shineSmall: 0.13,
  lookTravel: 7,
  cheekRx: 15.5,
  cheekRy: 12,
  cheekX: 31,
  cheekY: 54,
  browCurve: 0.3,
  browThick: 6,
  lashLen: 17,

  smileCurve: 2.4,
  manpuScale: 1.5,
  dotsStepMs: 450,
  dotsGap: 10,
  lensR: 26,
  lensZoom: 1.5,
  lensRim: 3.5,
  lensY: 0.3,
  lensDriftMs: 5_000,
  wwwW: 17,
  wwwH: 11,
  wwwGap: 3,
  wwwWeight: 1.75,
  wwwAbove: 31,
  wwwLift: 5,
  wwwWaveMs: 1_500,
  wwwPauseMs: 500,
  sweatSlideMs: 320,
  zzzSize: 20,
  zzzGrow: 3,
  zzzStep: 16,
  zzzRise: 18,
  zzzCycleMs: 3_000,
  zzzFirstUp: 7,
  tearMs: 2_000,
  sparkleLarge: 14,
  sparkleMid: 10,
  sparkleSmall: 7,
  sparkleConcave: 0.62,
  sparkleTip: 1.2,
  sparkleX: 13,
  sparkleY: 12,
  sparklePopMs: 200,
  sparkleStaggerMs: 120,
  sparkleTwinkle: 0.12,
  sparkleHoldMs: 10_000,
  sparkleFadeMs: 400,
  miniR: 7.5,
  miniGap: 3,
  miniBrowGap: 3,
  miniBrowLen: 10,
  miniBrowWeight: 1.5,
  miniBrowAngle: 10,
  miniPupil: 0.4,
  miniLook: 0.3,
  miniCap: 4,
  miniS1x: 282,
  miniS1y: 184,
  miniS1tilt: 8,
  miniS1size: 1.0,
  miniS2x: 38,
  miniS2y: 180,
  miniS2tilt: -6,
  miniS2size: 0.92,
  miniS3x: 204,
  miniS3y: 186,
  miniS3tilt: 5,
  miniS3size: 0.86,
  miniS4x: 38,
  miniS4y: 76,
  miniS4tilt: -10,
  miniS4size: 0.9,
  miniInMs: 180,
  miniStaggerMs: 70,
  miniOutMs: 160,
  miniShrink: 0.1,
  miniShrinkMs: 250,
  miniGlanceMs: 700,
  miniBob: 0.75,
  manpuInMs: 120,
  manpuOutMs: 200,
  longTurnMin: 10,
  mouthY: 60, // below the line across the cheeks (face review, 21 Oct; was 50)
  mouthWidth: 34,
  mouthWeight: 2.6,
  mouthX: 0,
  tongueSide: 1,
  hintY: 161,
  hintSize: 22, // Baloo 2, 22 px (spec §7.3: text minimum 20 px)
  buttonY: 184,
  buttonH: 48,
  labelY: 204,
  labelHoldMs: 1_200,
  labelInMs: 220,
  giggleHops: 3,
  giggleMs: 540,
  gigglePx: 7,
  linkX: 24,
  linkY: 26,
  linkH: 22,
  linkAfterMs: 5_000,
  shutterSlat: 12,
  shutterDropMs: 800,
  shutterRiseMs: 600,
  doubleTapMs: 350,
  longPressMs: 700,
  browGap: 10,
  browLength: 40,
  browWeight: 2.6,

  blinkMin: 5_000, // Gideon, 3 Oct: was 2.5 to 6 s, a little distracting on the robot
  blinkMax: 12_000,
  blinkMs: 120,
  doubleBlinkChance: 0.15,
  saccadeMin: 1_000,
  saccadeMax: 4_000,
  saccadePx: 6,
  breathIdleMs: 4_000,
  breathBusyMs: 2_500,
  breathPx: 2,
  transitionMs: 220,
};

export const tokenRanges: Partial<Record<keyof FaceTokens, [number, number, number]>> = {
  eyeY: [70, 140, 1],
  eyeSpacing: [80, 200, 2],
  eyeRx: [16, 60, 1],
  eyeRy: [16, 70, 1],
  outline: [0, 12, 1],
  border: [0, 8, 1],
  irisR: [8, 40, 1],
  pupilR: [4, 30, 1],
  highlightR: [0, 14, 1],
  lineWeight: [1, 5, 0.1],
  shineBig: [0.1, 0.5, 0.01],
  shineMid: [0, 0.4, 0.01],
  shineSmall: [0, 0.3, 0.01],
  lookTravel: [0, 16, 0.5],
  cheekRx: [0, 32, 1],
  cheekRy: [0, 24, 1],
  cheekX: [-10, 50, 1],
  cheekY: [10, 70, 1],
  browCurve: [0, 0.6, 0.02],
  browThick: [1, 12, 0.5],
  lashLen: [0, 16, 0.5],
  smileCurve: [0.8, 4, 0.1],
  manpuScale: [0.5, 2, 0.05],
  dotsStepMs: [150, 1_200, 50],
  dotsGap: [0, 40, 1],
  lensR: [10, 40, 1],
  lensZoom: [1, 2.5, 0.05],
  lensRim: [1, 8, 0.5],
  lensY: [-0.6, 1, 0.05],
  lensDriftMs: [0, 12_000, 250],
  wwwW: [10, 30, 1],
  wwwH: [6, 20, 1],
  wwwGap: [0, 10, 1],
  wwwWeight: [0.75, 4, 0.25],
  wwwAbove: [10, 50, 1],
  wwwLift: [0, 10, 0.5],
  wwwWaveMs: [600, 3_000, 50],
  wwwPauseMs: [0, 2_000, 50],
  sweatSlideMs: [0, 1_000, 10],
  zzzSize: [20, 30, 1],
  zzzGrow: [0, 6, 0.5],
  zzzStep: [10, 30, 1],
  zzzRise: [0, 20, 1],
  zzzCycleMs: [1_500, 6_000, 100],
  zzzFirstUp: [0, 20, 1],
  tearMs: [500, 4_000, 100],
  sparkleLarge: [5, 16, 0.5],
  sparkleMid: [4, 12, 0.5],
  sparkleSmall: [4, 10, 0.5],
  sparkleConcave: [0.4, 1, 0.02],
  sparkleTip: [0, 3, 0.1],
  sparkleX: [0, 40, 1],
  sparkleY: [-20, 50, 1],
  sparklePopMs: [80, 500, 10],
  sparkleStaggerMs: [0, 300, 10],
  sparkleTwinkle: [0, 0.3, 0.01],
  sparkleHoldMs: [500, 15_000, 100],
  sparkleFadeMs: [100, 1_500, 50],
  miniR: [7, 14, 0.5],
  miniGap: [0, 10, 0.5],
  miniBrowGap: [0, 10, 0.5],
  miniBrowLen: [4, 20, 0.5],
  miniBrowWeight: [0.75, 4, 0.25],
  miniBrowAngle: [-30, 30, 1],
  miniPupil: [0.25, 0.7, 0.01],
  miniLook: [0, 0.6, 0.05],
  miniCap: [1, 4, 1],
  miniS1x: [20, 300, 1],
  miniS1y: [20, 228, 1],
  miniS1tilt: [-30, 30, 1],
  miniS1size: [0.6, 1.3, 0.01],
  miniS2x: [20, 300, 1],
  miniS2y: [20, 228, 1],
  miniS2tilt: [-30, 30, 1],
  miniS2size: [0.6, 1.3, 0.01],
  miniS3x: [20, 300, 1],
  miniS3y: [20, 228, 1],
  miniS3tilt: [-30, 30, 1],
  miniS3size: [0.6, 1.3, 0.01],
  miniS4x: [20, 300, 1],
  miniS4y: [20, 228, 1],
  miniS4tilt: [-30, 30, 1],
  miniS4size: [0.6, 1.3, 0.01],
  miniInMs: [80, 400, 10],
  miniStaggerMs: [0, 200, 10],
  miniOutMs: [80, 400, 10],
  miniShrink: [0, 0.2, 0.01],
  miniShrinkMs: [0, 800, 10],
  miniGlanceMs: [0, 1_500, 50],
  miniBob: [0, 3, 0.25],
  manpuInMs: [0, 500, 10],
  manpuOutMs: [0, 800, 10],
  longTurnMin: [1, 60, 1],
  mouthY: [30, 100, 1],
  mouthWidth: [8, 60, 1],
  mouthWeight: [1, 6, 0.5],
  mouthX: [-30, 30, 1],
  tongueSide: [-1, 1, 1],
  hintY: [120, 190, 1],
  hintSize: [12, 26, 1],
  buttonY: [150, 200, 1],
  buttonH: [36, 70, 1],
  labelY: [190, 220, 1],
  labelHoldMs: [0, 4_000, 100],
  labelInMs: [0, 800, 20],
  giggleHops: [0, 6, 1],
  giggleMs: [200, 1_500, 20],
  gigglePx: [0, 12, 0.5],
  linkX: [12, 160, 1],
  linkY: [12, 120, 1],
  linkH: [14, 36, 1],
  linkAfterMs: [0, 30_000, 500],
  shutterSlat: [6, 24, 1],
  shutterDropMs: [300, 2_000, 50],
  shutterRiseMs: [200, 1_500, 50],
  doubleTapMs: [200, 600, 10],
  longPressMs: [400, 1_500, 50],
  browGap: [0, 40, 1],
  browLength: [10, 60, 1],
  browWeight: [1, 10, 0.5],
  blinkMin: [800, 8_000, 100],
  blinkMax: [1_500, 20_000, 100],
  blinkMs: [60, 400, 10],
  saccadePx: [0, 16, 1],
  breathPx: [0, 6, 0.5],
  transitionMs: [0, 800, 10],
};
