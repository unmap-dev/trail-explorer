#!/usr/bin/env node
/**
 * Serve the trail collection as a static file: data/trails.geojson → public/data/trails.geojson.
 * The app fetches it after the map has started (it is the largest thing on the page), and a
 * missing file is the honest empty state "trail data has not been fetched yet", never sample
 * trails. Runs before `dev` and `build`; the copy is generated and .gitignore'd.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const source = path.join(process.cwd(), "data", "trails.geojson");
const dest = path.join(process.cwd(), "public", "data", "trails.geojson");

if (existsSync(source)) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  console.log("[trails] copied data/trails.geojson -> public/data/trails.geojson");
} else {
  rmSync(dest, { force: true });
  console.log("[trails] data/trails.geojson does not exist yet: the app will say so. Run `node scripts/fetch-trails.mjs`.");
}
