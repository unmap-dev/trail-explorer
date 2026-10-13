"use client";

import { BASE_PATH } from "@/lib/kit/config";
import { parseTrails, type TrailCollection } from "@/lib/trails";
import { useAsync } from "@/lib/use-async";

/** The data file is missing: the honest empty state, never sample trails. */
export class TrailsNotFetched extends Error {
  constructor() {
    super("data/trails.geojson has not been fetched");
    this.name = "TrailsNotFetched";
  }
}

/** Where the app serves data/trails.geojson from (scripts/copy-data.mjs puts it there). */
export const TRAILS_URL = `${BASE_PATH}/data/trails.geojson`;

/**
 * The trail collection, loaded after the map has started. This is the demo's own static file, not
 * an Unmap API call. A 404 is `TrailsNotFetched`; a file that does not validate is the
 * `TrailDataError` from parseTrails, with every problem listed.
 */
export function useTrailData() {
  return useAsync<TrailCollection>("trails", async (signal) => {
    const res = await fetch(TRAILS_URL, { signal });
    if (res.status === 404) throw new TrailsNotFetched();
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return parseTrails(await res.json());
  });
}
