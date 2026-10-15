// Normalised stream events: what the agent-state layer consumes.
// The same shapes will come from the bridge in Phase 4, whatever the source
// (Buddy over BLE, Claude Code hooks), so the state layer never sees raw JSON.

export type ToolCall = {
  /** The tool_use id, when the stream includes it: matches the later tool_result. */
  id?: string;
  name: string;
  /** Short, human-readable summary of the input: a command, a path, a query. */
  summary: string;
};

export type Gesture = "tap" | "double-tap" | "long-press";

/**
 * Claude asked you a question (AskUserQuestion, step 6). Toki doesn't answer it
 * (Gideon, 3 Oct: on a 2-inch screen the targets are too small and the question
 * needs reading): it shows that a question is waiting, and you answer in Claude.
 * `header` is Claude's short label for the question (12 characters at most).
 */
export type Question = { header: string };

export type StreamEvent =
  | {
      kind: "snapshot";
      t: number; // ms since the start of the recording
      total: number;
      running: number;
      waiting: number;
      msg: string;
      entries: string[];
      tokens: number;
      tokensToday: number;
      prompt?: { id: string; tool: string; hint: string };
    }
  | {
      kind: "turn";
      t: number;
      role: "user" | "assistant";
      tools: ToolCall[];
      /** Content block types in order, e.g. ["thinking", "tool_use"]. */
      blocks: string[];
      /** True when a tool_result in this turn is flagged as an error. */
      toolError: boolean;
      /** tool_use ids answered by tool_result blocks in this turn (a subagent finishing, say). */
      results?: string[];
    }
  | { kind: "decision"; t: number; id: string; decision: "once" | "deny" }
  // From Claude Code hooks, via the bridge (Phase 4). Buddy carries these inside
  // snapshots; hooks say them outright.
  /**
   * Claude is waiting for your permission (PermissionRequest). `always` is what
   * "Always allow" would do, in words, when Claude offered a rule (hooks only).
   */
  | { kind: "prompt"; t: number; id: string; tool: string; hint: string; always?: string; question?: Question }
  /** That permission was answered somewhere (the tool ran, was denied, or the turn moved on). */
  | { kind: "prompt-cleared"; t: number; id: string }
  /** The turn finished (Stop), or failed (StopFailure). */
  | { kind: "stop"; t: number; error: boolean }
  /**
   * A touch on the robot's face (spec §6). The screen does the hit-testing:
   * `target` is the button under the finger, or "face". What the gesture means
   * depends on the state, so the state layer decides.
   */
  | { kind: "gesture"; t: number; gesture: Gesture; target: "face" | "yes" | "no" }
  | { kind: "device"; t: number; text: string }
  /** The robot collapsed this many identical snapshots into one line. */
  | { kind: "repeat"; t: number; count: number };

export type Recording = {
  name: string;
  startedAt: Date;
  durationMs: number;
  events: StreamEvent[];
};
