import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Dev-only: lists and serves recordings from ~/StackChanData/recordings so the
// simulator can open them without a file dialog. The dev server listens on
// localhost only, and nothing from that folder is ever bundled or copied.
const RECORDINGS = join(homedir(), "StackChanData", "recordings");
const SAFE_NAME = /^[\w.-]+\.jsonl$/;
const CAPTURES = join(process.cwd(), "captures"); // gitignored: design-review images
const SAFE_PNG = /^[\w.-]+\.png$/;

function recordings(): Plugin {
  return {
    name: "toki-recordings",
    apply: "serve",
    configureServer(server) {
      // Saves a PNG posted by the page (design-review captures), to simulator/captures/.
      server.middlewares.use("/api/capture", async (req, res) => {
        const name = decodeURIComponent((req.url ?? "/").slice(1));
        if (req.method !== "POST" || !SAFE_PNG.test(name)) {
          res.statusCode = 400;
          res.end("bad request");
          return;
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const b64 = Buffer.concat(chunks).toString().replace(/^data:image\/png;base64,/, "");
        await mkdir(CAPTURES, { recursive: true });
        await writeFile(join(CAPTURES, name), Buffer.from(b64, "base64"));
        res.end(join(CAPTURES, name));
      });
      server.middlewares.use("/api/recordings", async (req, res) => {
        const name = decodeURIComponent((req.url ?? "/").slice(1));
        try {
          if (!name) {
            const files = (await readdir(RECORDINGS)).filter((f) => SAFE_NAME.test(f));
            const list = await Promise.all(
              files.map(async (f) => ({ name: f, bytes: (await stat(join(RECORDINGS, f))).size })),
            );
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(list.filter((f) => f.bytes > 0).sort((a, b) => b.name.localeCompare(a.name))));
            return;
          }
          if (!SAFE_NAME.test(name)) {
            res.statusCode = 400;
            res.end("bad name");
            return;
          }
          res.setHeader("Content-Type", "application/x-ndjson");
          createReadStream(join(RECORDINGS, name)).on("error", () => {
            res.statusCode = 404;
            res.end();
          }).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end("[]");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), recordings()],
  server: {
    host: "localhost",
    port: 5174,
    strictPort: true,
    // The scrapbook uses the sticker art in ../art (all rights reserved, see art/LICENSE).
    fs: { allow: [".."] },
    // "Live from bridge": the bridge (bridge/src/server.ts) on its own port, same origin for the page.
    proxy: {
      "/bridge": { target: "http://127.0.0.1:7151", rewrite: (p) => p.replace(/^\/bridge/, "") },
      // The scrapbook's data (Phase 5): the bridge's diary on localhost:4747.
      "/api": { target: "http://127.0.0.1:4747" },
    },
  },
  // Two pages: the simulator (index.html) and the scrapbook (scrapbook.html), which
  // the bridge serves from dist/ on localhost:4747.
  build: { rollupOptions: { input: { main: "index.html", scrapbook: "scrapbook.html" } } },
});
