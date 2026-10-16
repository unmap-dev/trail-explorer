/**
 * Point MapLibre at the worker the app serves from `public/maplibre/`.
 *
 * MapLibre GL JS 6 runs a module worker resolved from `import.meta.url`, which does not survive
 * Turbopack's module graph (maplibre-gl-js#8126): without this the worker fails to load and the map
 * never fires `load`. The app's `scripts/copy-maplibre-worker.mjs` copies the worker before `dev`
 * and `build`. Under a base path (apps/apps-host serves each app at `/<app>`) the URL follows it.
 *
 * Imported for its side effect before the first map is created.
 */
import { maplibregl } from "@unmap/maps";
import { BASE_PATH } from "./config";

maplibregl.setWorkerUrl(`${BASE_PATH}/maplibre/maplibre-gl-worker.mjs`);
