// Builds a Toki release (Phase 7, spec §10.4): one tarball holding everything a
// Homebrew install needs, and the formula that installs it.
//
//   node packaging/build-release.ts            → packaging/dist/toki-<version>.tar.gz
//                                                 packaging/homebrew/toki.rb (url and sha256 filled in)
//   node packaging/build-release.ts --url URL  → the formula points at URL instead
//                                                 (the GitHub release asset, once there is one)
//
// The firmware is built with TOKI_NO_SECRETS and checked: if any value from
// secrets.h is in it, the build stops. Personal files (secrets.h, CLAUDE.md,
// notes, recordings) are never copied in: only the paths listed below are.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "bridge", "package.json"), "utf8")).version as string;
const NAME = `toki-${VERSION}`;
const WORK = join(ROOT, "packaging", ".build"); // gitignored
const STAGE = join(WORK, NAME);
const DIST = join(ROOT, "packaging", "dist"); // gitignored
const urlArg = process.argv.indexOf("--url");

const step = (s: string) => console.log(`\n▸ ${s}`);
const sh = (cmd: string, args: string[], cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

rmSync(WORK, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
mkdirSync(DIST, { recursive: true });

step("The scrapbook page");
sh("npm", ["--prefix", "simulator", "run", "build"]);

step("The firmware, with no Wi-Fi or secret in it");
// Stamp the version, so `toki setup` can tell whether a robot is up to date.
const versionH = join(ROOT, "firmware", "toki", "version.h");
const stamped = readFileSync(versionH, "utf8").replace(/#define TOKI_VERSION "[^"]*"/, `#define TOKI_VERSION "${VERSION}"`);
writeFileSync(versionH, stamped);
const fwBuild = join(WORK, "firmware-build");
// Source paths are compiled into the firmware (assert messages); rewrite this Mac's
// home folder to "~" so the release says nothing about who built it.
const home = homedir();
const mapHome = `-ffile-prefix-map=${home}=~`;
sh("arduino-cli", [
  "compile",
  "firmware/toki",
  "--build-path",
  fwBuild,
  "--build-property",
  `compiler.cpp.extra_flags=-DTOKI_NO_SECRETS ${mapHome}`,
  "--build-property",
  `compiler.c.extra_flags=${mapHome}`,
]);
const fwOut = join(STAGE, "firmware", "bin");
mkdirSync(fwOut, { recursive: true });
for (const f of ["toki.ino.bin", "toki.ino.bootloader.bin", "toki.ino.partitions.bin", "boot_app0.bin"]) cpSync(join(fwBuild, f), join(fwOut, f));
// The proof that nothing personal went in.
const secretsH = join(ROOT, "firmware", "toki", "secrets.h");
if (existsSync(secretsH)) {
  const app = readFileSync(join(fwOut, "toki.ino.bin"));
  for (const [, key, value] of readFileSync(secretsH, "utf8").matchAll(/#define\s+(TOKI_\w+)\s+"([^"]+)"/g)) {
    if (value.length >= 4 && app.includes(Buffer.from(value))) throw new Error(`${key} from secrets.h is in the firmware. Stopping: nothing was released.`);
  }
  console.log("  checked: nothing from secrets.h is in the firmware");
}
for (const f of ["toki.ino.bin", "toki.ino.bootloader.bin"]) {
  if (readFileSync(join(fwOut, f)).includes(Buffer.from(home))) throw new Error(`This Mac's home folder (${home}) is in ${f}. Stopping: nothing was released.`);
}
console.log("  checked: no path from this Mac is in the firmware");

step("The bridge, the scrapbook and the tools");
const copy = (from: string, filter?: (src: string) => boolean) => cpSync(join(ROOT, from), join(STAGE, from), { recursive: true, filter });
const notTest = (src: string) => !/\.test\.tsx?$/.test(src);
copy("bridge/src", notTest);
copy("bridge/statusline.mjs");
copy("bridge/package.json");
copy("bridge/tools/toki-usb.py");
copy("simulator/dist");
// The bridge runs the simulator's state layer directly (TypeScript, no build).
for (const dir of ["simulator/src/state", "simulator/src/replay"]) {
  mkdirSync(join(STAGE, dir), { recursive: true });
  for (const f of readdirSync(join(ROOT, dir))) if (/\.ts$/.test(f) && notTest(f)) cpSync(join(ROOT, dir, f), join(STAGE, dir, f));
}
copy("LICENSE");
copy("art/LICENSE");
copy("README.md");

step("The tarball");
const tarball = join(DIST, `${NAME}.tar.gz`);
// No macOS extras (._ files, extended attributes) in the archive.
execFileSync("tar", ["--no-mac-metadata", "-czf", tarball, "-C", WORK, NAME], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
console.log(`  ${tarball}\n  sha256 ${sha256}`);

step("The formula");
const url = urlArg > 0 ? process.argv[urlArg + 1] : pathToFileURL(tarball).href;
const template = readFileSync(join(ROOT, "packaging", "homebrew", "toki.rb.template"), "utf8");
const formula = template.replaceAll("{{VERSION}}", VERSION).replaceAll("{{URL}}", url).replaceAll("{{SHA256}}", sha256);
writeFileSync(join(ROOT, "packaging", "homebrew", "toki.rb"), formula);
console.log(`  packaging/homebrew/toki.rb → ${url}`);
