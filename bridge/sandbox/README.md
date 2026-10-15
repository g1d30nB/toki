# Hook sandbox

Open a Claude Code session with **this folder** as its project to test the bridge.
Its `.claude/settings.json` sends every hook to the bridge on `127.0.0.1:7151`.
Those settings apply only to sessions whose project is this folder, so other
sessions (including ones on the repo root) are unaffected.

Hook payloads are logged to `~/StackChanData/hooks/`, never into the repo.
