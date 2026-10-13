/**
 * Reading a GPX file in the browser: tracks (<trk>/<trkseg>/<trkpt>), routes (<rte>/<rtept>) and
 * waypoints (<wpt>). The file never leaves the page; only the points the elevation profile samples
 * are sent, and only when the visitor asks for a profile. Plain TypeScript (it takes a DOMParser,
 * the browser's own XML reader); unit-tested in test/gpx.test.ts.
 *
 * A file is accepted whole or refused with one reason. A malformed coordinate is never skipped
 * quietly: a track with a hole in it would draw and measure a different walk.
 */
import { dedupe, lineLength, type LngLat } from "./geo";

export const MAX_GPX_BYTES = 10 * 1024 * 1024;
export const MAX_GPX_POINTS = 100_000;

export type GpxErrorCode = "too-large" | "not-xml" | "not-gpx" | "empty" | "bad-coordinates" | "too-few-points" | "too-many-points";

export class GpxError extends Error {
  constructor(
    readonly code: GpxErrorCode,
    /** Where, for `bad-coordinates`: e.g. `trkpt 12`. */
    readonly where?: string,
  ) {
    super(where ? `${code}: ${where}` : code);
    this.name = "GpxError";
  }
}

export interface GpxWaypoint {
  name: string | null;
  coordinates: LngLat;
}

export interface GpxTrack {
  /** The file's own name for itself, if it has one. */
  name: string | null;
  /** Each track segment and route with two or more points, in file order. */
  lines: LngLat[][];
  waypoints: GpxWaypoint[];
  /** Every point read, waypoints included. */
  points: number;
  /** Total length of the lines, haversine, in metres. */
  metres: number;
}

/** Elements by local name in any namespace: GPX 1.0, 1.1 and none all work. */
const all = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS("*", name));
const child = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name) ?? null;
const text = (el: Element | null) => el?.textContent?.trim() || null;

function point(el: Element, where: string): LngLat {
  const lat = el.getAttribute("lat");
  const lon = el.getAttribute("lon");
  const y = lat === null || lat.trim() === "" ? NaN : Number(lat);
  const x = lon === null || lon.trim() === "" ? NaN : Number(lon);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) throw new GpxError("bad-coordinates", where);
  return [x, y];
}

/** A GPX document as lines and waypoints, or a GpxError naming what is wrong with it. */
export function parseGpx(source: string, parser: DOMParser = new DOMParser()): GpxTrack {
  if (source.length > MAX_GPX_BYTES) throw new GpxError("too-large");
  if (!source.trim()) throw new GpxError("empty");
  const doc = parser.parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) throw new GpxError("not-xml");
  const root = doc.documentElement;
  if (root.localName !== "gpx") throw new GpxError("not-gpx");

  let points = 0;
  const count = (n: number) => {
    points += n;
    if (points > MAX_GPX_POINTS) throw new GpxError("too-many-points");
  };
  const lines: LngLat[][] = [];
  let shortLine = false;
  const addLine = (els: Element[], tag: string) => {
    count(els.length);
    const line = dedupe(els.map((p, i) => point(p, `${tag} ${i + 1}`)));
    if (line.length >= 2) lines.push(line);
    else if (els.length) shortLine = true;
  };
  for (const seg of all(root, "trkseg")) addLine(all(seg, "trkpt"), "trkpt");
  for (const rte of all(root, "rte")) addLine(all(rte, "rtept"), "rtept");
  const wpts = all(root, "wpt");
  count(wpts.length);
  const waypoints = wpts.map((w, i) => ({ name: text(child(w, "name")), coordinates: point(w, `wpt ${i + 1}`) }));

  if (!lines.length && !waypoints.length) throw new GpxError(shortLine ? "too-few-points" : "empty");
  const metadata = all(root, "metadata")[0];
  const name = text(metadata ? child(metadata, "name") : null) ?? text(all(root, "trk")[0] ? child(all(root, "trk")[0]!, "name") : null) ?? text(all(root, "rte")[0] ? child(all(root, "rte")[0]!, "name") : null);
  return { name, lines, waypoints, points, metres: lines.reduce((m, l) => m + lineLength(l), 0) };
}

/** The line a file's profile follows: its longest track segment or route. */
export function longestLine(track: Pick<GpxTrack, "lines">): LngLat[] {
  return track.lines.reduce<LngLat[]>((best, l) => (lineLength(l) > lineLength(best) ? l : best), []);
}
