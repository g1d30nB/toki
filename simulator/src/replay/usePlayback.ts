import { useCallback, useEffect, useRef, useState } from "react";
import type { Recording, StreamEvent } from "./events";
import { Player } from "./player";
import { defaultConfig, initialState, type Config } from "../state/agentState";

const UI_HZ = 10; // panels refresh at 10 Hz; the face canvas draws every frame
const GAP_SKIP_MS = 30_000; // with "skip quiet gaps" on, jump over silences longer than this

export function usePlayback(recording: Recording | null) {
  const playerRef = useRef<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [skipGaps, setSkipGaps] = useState(true);
  const [config, setConfigState] = useState<Config>(defaultConfig);
  const [, setUiTick] = useState(0);

  const live = useRef({ playing, speed, skipGaps });
  live.current = { playing, speed, skipGaps };

  useEffect(() => {
    // With no recording, a live sandbox: time runs on its own, so touches on the face play out.
    playerRef.current = new Player(recording?.events ?? [], config);
    setPlaying(false);
    setUiTick((n) => n + 1);
    // A new recording starts from the current config (setConfig applies later changes).
  }, [recording]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const p = playerRef.current;
      if (p && !recording) p.advanceTo(p.state.now + dt);
      else if (p && recording && live.current.playing) {
        let t = p.state.now + dt * live.current.speed;
        if (live.current.skipGaps) {
          const next = p.nextEventAfter(p.state.now);
          if (next !== null && next - p.state.now > GAP_SKIP_MS) t = Math.max(t, next - 1_000);
        }
        if (t >= recording.durationMs) {
          t = recording.durationMs;
          setPlaying(false);
        }
        p.advanceTo(t);
      }
      if (now - lastUi > 1000 / UI_HZ) {
        lastUi = now;
        setUiTick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  const seek = useCallback((t: number) => {
    playerRef.current?.seek(t);
    setUiTick((n) => n + 1);
  }, []);

  const setConfig = useCallback((c: Config) => {
    setConfigState(c);
    playerRef.current?.setConfig(c);
  }, []);

  const empty = useRef(initialState());
  const getState = useCallback(() => playerRef.current?.state ?? empty.current, []);
  /** A touch on the simulated face, applied now (not saved into the recording). */
  const inject = useCallback((e: StreamEvent) => {
    playerRef.current?.inject(e);
    setUiTick((n) => n + 1);
  }, []);

  return {
    player: playerRef.current,
    getState,
    inject,
    playing,
    setPlaying,
    speed,
    setSpeed,
    skipGaps,
    setSkipGaps,
    seek,
    config,
    setConfig,
  };
}
