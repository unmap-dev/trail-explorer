/**
 * Point MapLibre at the worker the demo serves from `public/maplibre/`.
 *
 * MapLibre GL JS 6 runs a module worker resolved from `import.meta.url`, which does not survive
 * Turbopack's module graph (maplibre-gl-js#8126): without this the worker fails to load and the map
 * never fires `load`. The demo's `scripts/copy-maplibre-worker.mjs` copies the worker before `dev`
 * and `build`. Under a base path (apps/demos serves each demo at `/<demo>`) the URL follows it.
 *
 * Imported for its side effect before the first map is created.
 */
import { maplibregl } from "@unmap/maps";
import { BASE_PATH } from "./config";

maplibregl.setWorkerUrl(`${BASE_PATH}/maplibre/maplibre-gl-worker.mjs`);
