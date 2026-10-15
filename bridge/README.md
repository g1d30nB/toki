# bridge

Runs on the Mac. Merges Hardware Buddy (BLE), Claude Code hooks and Mac system events into one agent state, keeps the event log and serves the local scrapbook.

Personal data lives in `~/StackChanData`, never in this repo.

## Run it

```bash
npm --prefix bridge start
```

Node 24, no dependencies. It listens on `127.0.0.1:7151` only:
- `POST /hook/<Event>`: Claude Code hooks (see `sandbox/` and `docs/bridge-hooks.md`)
- `GET /events`: normalised events, streamed (the simulator's **Live from bridge**)
- `GET /status`: sessions seen

Hook payloads are logged, trimmed, to `~/StackChanData/hooks/YYYY-MM-DD.jsonl`.

## Layout

- `src/server.ts`: the bridge. The hook-to-event translation lives in `simulator/src/state/hooks.ts`, beside the state layer it feeds, where it's tested.
- `sandbox/`: open a Claude Code session here to send hooks to the bridge without touching your global settings.
- `test/hook-probe.mjs`: the step 1 test receiver (up, down, stalled).
- `tools/record-stream.py`: records the robot's USB echo.
