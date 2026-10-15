import type { StreamEvent } from "./events";
import { applyEvent, defaultConfig, initialState, stateAt, tick, type AgentState, type Config } from "../state/agentState";

// Steps the agent state through a recording. Moving forward is incremental;
// moving backwards (a scrub) rebuilds from the start, which is fast enough.
export class Player {
  private cursor = 0;
  state: AgentState = initialState();

  constructor(
    private events: StreamEvent[],
    private cfg: Config = defaultConfig,
  ) {}

  setConfig(cfg: Config) {
    this.cfg = cfg;
    this.seek(this.state.now);
  }

  /** Index of the next event not yet applied: the log shows events before it. */
  get position() {
    return this.cursor;
  }

  seek(t: number) {
    this.state = stateAt(this.events, t, this.cfg);
    this.cursor = this.events.findIndex((e) => e.t > t);
    if (this.cursor < 0) this.cursor = this.events.length;
  }

  advanceTo(t: number) {
    if (t < this.state.now) return this.seek(t);
    let s = this.state;
    while (this.cursor < this.events.length && this.events[this.cursor].t <= t) {
      const e = this.events[this.cursor++];
      s = tick(applyEvent(tick(s, e.t, this.cfg), e, this.cfg), e.t, this.cfg);
    }
    this.state = tick(s, t, this.cfg);
  }

  /**
   * Applies an event that isn't in the recording (a touch on the simulated face)
   * at the current time. A later seek rebuilds from the recording and drops it.
   */
  inject(e: StreamEvent) {
    this.state = tick(applyEvent(this.state, { ...e, t: this.state.now }, this.cfg), this.state.now, this.cfg);
  }

  /** The time of the next event after t, for skipping long quiet gaps. */
  nextEventAfter(t: number): number | null {
    const e = this.events.find((x) => x.t > t);
    return e ? e.t : null;
  }
}
