# Toki simulator

A 320 × 240 browser version of Toki's screen, driven by recorded Hardware Buddy streams. It's for designing and tuning the face before porting it to the firmware (spec §11, Phase 2).

```bash
npm --prefix simulator install
npm --prefix simulator run dev     # http://localhost:5174
npm --prefix simulator test        # parser and agent-state tests
```

Pick a recording from the menu. In dev, the menu lists `~/StackChanData/recordings`, served on localhost only. Or drop a `.jsonl` file onto the page. Recordings are never copied into the repo.

## What's what

| Path | Role | Future |
|---|---|---|
| `src/replay/parseRecording.ts` | recorder `.jsonl` to normalised events | becomes the bridge's Buddy adapter |
| `src/state/agentState.ts` | events to Toki's state: priority, hysteresis, stats | moves into the bridge unchanged |
| `src/face/gfx.ts` | drawing API shaped like M5GFX | the firmware uses M5GFX itself |
| `src/face/render.ts` | the face | ported to C++ for the firmware |
| `src/ui`, `src/App.tsx` | controls around the screen | simulator only |
