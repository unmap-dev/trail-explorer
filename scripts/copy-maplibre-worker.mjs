#!/usr/bin/env node
/**
 * Copy MapLibre's worker into `public/` so the browser can load it.
 *
 * MapLibre GL JS 6 is ESM-only and runs a module worker. Its own docs are explicit that
 * `import.meta.url` "doesn't reliably resolve to the worker file inside the bundler's module
 * graph", so every bundler consumer needs a one-time `setWorkerUrl()` — see
 * maplibre.org's v5-to-v6 migration guide, and maplibre-gl-js#8126 for the Turbopack case
 * specifically, which is this one. This script and `lib/maplibre-worker.ts` are that setup.
 *
 * Since MapLibre 6.13 the worker is self-contained (`maplibre-gl-shared.mjs` ships empty), so it
 * is the only file copied. Serving it from `public/` rather than letting the bundler emit it is
 * the point: nothing rewrites its name or its imports there.
 *
 * What happens when it does not: the module worker fails to load, MapLibre never parses a tile,
 * so it never requests one, `load` never fires, and every map on the site sits at "the live map
 * did not finish loading". No failing request appears in the network panel and no MapLibre error
 * event fires — the only trace is one console line from inside the worker.
 *
 * Runs before both `dev` and `build`; the copies are generated, and .gitignore'd.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.join(
  path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")),
  "dist",
);
const dest = path.join(process.cwd(), "public", "maplibre");

mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
  console.log(`[maplibre] copied ${file} -> public/maplibre/${file}`);
}
