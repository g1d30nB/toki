// Toki's hook entries for Claude Code settings (docs/bridge-hooks.md §3), in one
// place: the installer writes them into ~/.claude/settings.json, and the sandbox's
// .claude/settings.json is generated from them too. Identical handlers in two
// settings files run once (Claude Code docs), so both can coexist.

export const BRIDGE_URL = "http://127.0.0.1:7151/hook";

/** Every Toki entry's URL contains this: how the installer finds (and only ever touches) its own entries. */
export const MARKER = "127.0.0.1:7151/hook/";

// Events Toki listens to, and how long Claude Code waits for the bridge.
// Fire-and-forget events: 1 s, so a hung bridge costs at most a second each
// (step 1). PermissionRequest is held open for an answer from Toki: 120 s.
// SessionStart is missing on purpose: it doesn't support http hooks.
const EVENTS: Record<string, number> = {
  UserPromptSubmit: 1,
  PreToolUse: 1,
  PostToolUse: 1,
  PostToolUseFailure: 1,
  PermissionRequest: 120,
  PermissionDenied: 1,
  Notification: 1,
  Stop: 1,
  StopFailure: 1,
  SubagentStart: 1,
  SubagentStop: 1,
  PreCompact: 1,
  PostCompact: 1,
  SessionEnd: 1,
};

export type HookEntry = { hooks: { type: "http"; url: string; timeout: number }[] };

export function tokiHooks(): Record<string, HookEntry[]> {
  return Object.fromEntries(
    Object.entries(EVENTS).map(([event, timeout]) => [event, [{ hooks: [{ type: "http", url: `${BRIDGE_URL}/${event}`, timeout }] }]]),
  );
}

/**
 * Toki's status line (step 7b): node runs bridge/statusline.mjs, which feeds the
 * bridge and prints a short line. Only added where there's no status line already;
 * Toki never replaces someone else's (wrapping one is for later, bridge-hooks.md §6).
 */
export const STATUSLINE_MARKER = "bridge/statusline.mjs";

export function tokiStatusLine(node: string, script: string) {
  return { type: "command", command: `"${node}" "${script}"` };
}

const isTokiStatusLine = (v: unknown) =>
  typeof (v as { command?: unknown })?.command === "string" && (v as { command: string }).command.includes(STATUSLINE_MARKER);

/** True for a hook entry that Toki put there. */
export function isToki(entry: unknown): boolean {
  const hooks = (entry as { hooks?: { url?: unknown }[] })?.hooks;
  return Array.isArray(hooks) && hooks.some((h) => typeof h?.url === "string" && h.url.includes(MARKER));
}

/** Settings with Toki's entries removed from every event (other hooks untouched; empty events dropped). */
export function withoutToki(settings: Record<string, unknown>): Record<string, unknown> {
  const out = { ...settings };
  const hooks = { ...((out.hooks as Record<string, unknown[]>) ?? {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    const kept = Array.isArray(entries) ? entries.filter((e) => !isToki(e)) : entries;
    if (Array.isArray(kept) && kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  if (isTokiStatusLine(out.statusLine)) delete out.statusLine;
  return out;
}

/**
 * `next` with its keys in `original`'s order, new keys after. Removing Toki's
 * entries and adding them back otherwise moves them to the end, so an install
 * that changes nothing looked like a change (found 14 Oct: a noisy diff of the
 * whole settings file, and "out of date" for an install that wasn't).
 */
function inOrderOf<T>(original: Record<string, unknown> | undefined, next: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(original ?? {})) if (k in next) out[k] = next[k];
  for (const k of Object.keys(next)) if (!(k in out)) out[k] = next[k];
  return out;
}

/** Settings with Toki's entries replaced by the current set, appended after any others. Key order is kept. */
export function withToki(settings: Record<string, unknown>, statusLine?: { type: string; command: string }): Record<string, unknown> {
  const out = withoutToki(settings);
  const hooks = { ...((out.hooks as Record<string, unknown[]>) ?? {}) };
  for (const [event, entries] of Object.entries(tokiHooks())) hooks[event] = [...(hooks[event] ?? []), ...entries];
  const next: Record<string, unknown> = { ...out, hooks: inOrderOf(settings.hooks as Record<string, unknown> | undefined, hooks) };
  // The status line is one slot: only take it if it's free.
  if (statusLine && next.statusLine === undefined) next.statusLine = statusLine;
  return inOrderOf(settings, next);
}
