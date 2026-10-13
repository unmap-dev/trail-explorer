/**
 * Geometry for trails: great-circle length, joining a trail's published segments into continuous
 * lines, sampling a line for elevation and summing its climb. Plain TypeScript with no imports, so
 * the app and `scripts/fetch-trails.mjs` (run by Node with type stripping) share one copy and the
 * numbers in data/trails.geojson are worked out exactly the way the app would work them out.
 * Unit-tested in test/geo.test.ts.
 *
 * Nothing here smooths, simplifies or moves a vertex. Joining reorders and reverses whole
 * segments; the only thing it adds is the straight step between two segment ends that are already
 * within `JOIN_TOLERANCE_M` of each other.
 */

/** [longitude, latitude] in WGS84. */
export type LngLat = [number, number];

/** Mean Earth radius (IUGG), the same constant the registry's elevation profile uses. */
export const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Segment ends closer than this are treated as one junction when segments are joined. Parks
 * Canada's segments of one trail leave digitising gaps of up to about 30 m (Consolation Lakes 27 m,
 * Lake Agnes 29 m); at 15 m those trails came apart and their start landed partway along.
 */
export const JOIN_TOLERANCE_M = 30;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Whether a value is a [lng, lat] pair inside WGS84's range. */
export function isLngLat(value: unknown): value is LngLat {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [lng, lat] = value as unknown[];
  return typeof lng === "number" && typeof lat === "number" && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

/** The angle between two points at the Earth's centre, in radians (haversine). */
function centralAngle(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in metres (haversine). */
export function haversine(a: LngLat, b: LngLat): number {
  return centralAngle(a, b) * EARTH_RADIUS_M;
}

/** Length of a line in metres: the sum of haversine distances between consecutive vertices. */
export function lineLength(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversine(line[i - 1]!, line[i]!);
  return total;
}

/** Length of every part together, in metres. Gaps between parts are not counted. */
export function linesLength(lines: readonly (readonly LngLat[])[]): number {
  return lines.reduce((sum, line) => sum + lineLength(line), 0);
}

/** [west, south, east, north] around every coordinate, or null for none. */
export function boundsOf(lines: readonly (readonly LngLat[])[]): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  for (const line of lines)
    for (const [lng, lat] of line) b = b ? [Math.min(b[0], lng), Math.min(b[1], lat), Math.max(b[2], lng), Math.max(b[3], lat)] : [lng, lat, lng, lat];
  return b;
}

/** Consecutive repeated vertices dropped; everything else as given. */
export function dedupe(line: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of line) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** `b` appended to `a`; a vertex shared exactly at the junction appears once. */
function concat(a: LngLat[], b: LngLat[]): LngLat[] {
  const last = a[a.length - 1]!;
  const first = b[0]!;
  return last[0] === first[0] && last[1] === first[1] ? [...a, ...b.slice(1)] : [...a, ...b];
}

/**
 * A trail's published segments joined into continuous lines, longest first.
 *
 * Starts from the longest segment and keeps attaching whichever remaining segment has an end
 * within `tolerance` metres of the line's head or tail (the nearest such end first), reversing it
 * when it runs the other way. When nothing more attaches, the next line starts from the longest
 * segment left. Segments are reordered and reversed, never edited.
 */
export function joinSegments(segments: readonly (readonly LngLat[])[], tolerance = JOIN_TOLERANCE_M): LngLat[][] {
  const pool = segments.map((s) => dedupe(s)).filter((s) => s.length >= 2);
  pool.sort((a, b) => lineLength(b) - lineLength(a));
  const lines: LngLat[][] = [];
  while (pool.length) {
    let line = pool.shift()!;
    for (;;) {
      const head = line[0]!;
      const tail = line[line.length - 1]!;
      let best: { index: number; at: "head" | "tail"; reverse: boolean; distance: number } | null = null;
      pool.forEach((seg, index) => {
        const s = seg[0]!;
        const e = seg[seg.length - 1]!;
        const options = [
          { at: "tail" as const, reverse: false, distance: haversine(tail, s) },
          { at: "tail" as const, reverse: true, distance: haversine(tail, e) },
          { at: "head" as const, reverse: false, distance: haversine(head, e) },
          { at: "head" as const, reverse: true, distance: haversine(head, s) },
        ];
        for (const o of options) if (o.distance <= tolerance && (!best || o.distance < best.distance)) best = { index, ...o };
      });
      if (!best) break;
      const { index, at, reverse } = best;
      const seg = pool.splice(index, 1)[0]!;
      const piece = reverse ? [...seg].reverse() : seg;
      line = at === "tail" ? concat(line, piece) : concat(piece, line);
    }
    lines.push(line);
  }
  return lines.sort((a, b) => lineLength(b) - lineLength(a));
}

/** The shortest distance between the ends of two lines, in metres: how far apart two parts are. */
export function gapBetween(a: readonly LngLat[], b: readonly LngLat[]): number {
  const ends = (l: readonly LngLat[]) => [l[0]!, l[l.length - 1]!];
  let best = Infinity;
  for (const p of ends(a)) for (const q of ends(b)) best = Math.min(best, haversine(p, q));
  return best;
}

// --- Sampling for elevation: identical to the registry's elevation-profile (test/geo.test.ts) ---

/** Coordinates per elevation request, as the registry profile sends them. */
export const ELEVATION_CHUNK = 500;
/** The elevation data's own cell; sampling finer only repeats heights. */
export const MIN_INTERVAL_M = 30;
/** A line is never sampled more than this. */
export const MAX_SAMPLES = 5000;

export interface Sample {
  /** Metres from the start, along the line. */
  distance: number;
  lng: number;
  lat: number;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

function alongGreatCircle(a: LngLat, b: LngLat, fraction: number): LngLat {
  const angle = centralAngle(a, b);
  if (angle === 0 || fraction <= 0) return a;
  if (fraction >= 1) return b;
  const wa = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const wb = Math.sin(fraction * angle) / Math.sin(angle);
  const [lng1, lat1, lng2, lat2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const x = wa * Math.cos(lat1) * Math.cos(lng1) + wb * Math.cos(lat2) * Math.cos(lng2);
  const y = wa * Math.cos(lat1) * Math.sin(lng1) + wb * Math.cos(lat2) * Math.sin(lng2);
  const z = wa * Math.sin(lat1) + wb * Math.sin(lat2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
}

/** The spacing `sampleLine` uses when given no interval: one request's worth, never under 30 m. */
export function defaultInterval(totalMetres: number): number {
  return Math.max(MIN_INTERVAL_M, totalMetres / (ELEVATION_CHUNK - 1));
}

/**
 * A point every `interval` metres along the line (default `defaultInterval`), the first at its
 * start and the last at its end, positions rounded to five decimals. The same algorithm as the
 * registry's `<ElevationProfile>`, so a profile drawn in the app samples the same points.
 */
export function sampleLine(coordinates: readonly LngLat[], interval?: number): Sample[] {
  if (coordinates.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i++) cumulative.push(cumulative[i - 1]! + haversine(coordinates[i - 1]!, coordinates[i]!));
  const total = cumulative[cumulative.length - 1]!;
  if (!(total > 0)) return [];
  const requested = interval !== undefined && Number.isFinite(interval) && interval > 0 ? interval : defaultInterval(total);
  const step = Math.max(requested, total / (MAX_SAMPLES - 1));
  const steps = Math.max(1, Math.ceil(total / step - 1e-9));
  const samples: Sample[] = [];
  let segment = 1;
  for (let k = 0; k <= steps; k++) {
    const distance = k === steps ? total : k * step;
    while (segment < coordinates.length - 1 && cumulative[segment]! < distance) segment++;
    const start = cumulative[segment - 1]!;
    const span = cumulative[segment]! - start;
    const [lng, lat] = alongGreatCircle(coordinates[segment - 1]!, coordinates[segment]!, span === 0 ? 0 : (distance - start) / span);
    samples.push({ distance, lng: round5(lng), lat: round5(lat) });
  }
  return samples;
}

export interface ClimbStats {
  gain: number;
  loss: number;
  min: number;
  max: number;
}

/**
 * Total climb and descent between consecutive heights, unsmoothed, skipping nulls (no data), plus
 * the lowest and highest. Null when no height is known. The same sums the registry profile shows.
 */
export function climb(elevations: readonly (number | null)[]): ClimbStats | null {
  let min = Infinity;
  let max = -Infinity;
  let gain = 0;
  let loss = 0;
  let previous: number | null = null;
  for (const e of elevations) {
    if (typeof e !== "number" || !Number.isFinite(e)) continue;
    min = Math.min(min, e);
    max = Math.max(max, e);
    if (previous !== null) {
      const change = e - previous;
      if (change > 0) gain += change;
      else loss -= change;
    }
    previous = e;
  }
  return previous === null ? null : { gain, loss, min, max };
}
