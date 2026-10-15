// Where Toki's files are (Phase 7). In the repo, the repo itself. Installed with
// Homebrew, the `toki` wrapper sets TOKI_HOME and TOKI_NODE to Homebrew's stable
// "opt" paths, so anything written into settings or launch agents keeps working
// after `brew upgrade` (the versioned Cellar paths would break).

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The root: holds bridge/, simulator/ and firmware/. */
export const HOME = process.env.TOKI_HOME ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The node to write into launch agents and the status line: one that survives upgrades. */
export const NODE = process.env.TOKI_NODE ?? process.execPath;
/** Personal data: logs, recordings, the diary, the link secret. Never in the repo. */
export const DATA = join(homedir(), "StackChanData");
export const BRIDGE = join(HOME, "bridge");
