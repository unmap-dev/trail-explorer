"use client";

/**
 * <ElevationProfile> - the ground elevation along a line, on your shadcn Chart.
 *
 * Give it a line: a route's coordinates (from `@unmap/routing`, or `<RoutingPanel onRoute>`), the
 * GeoJSON LineString a drawing tool produced, or your own `[lng, lat]` pairs. It samples the line
 * every `interval` metres along the great circle, asks the unmap elevation API for the heights
 * (500 points per request, one billed call each), and charts them with the distance, gain, loss,
 * lowest and highest point. Hover the chart and a marker follows along the line on the map; hover
 * the line and the chart follows.
 *
 * It adds only an invisible line to hover and the marker, on top of the map; draw the line itself
 * with `<RouteLine>` or your drawing tool. Both survive a style swap. A new line cancels the
 * request in flight, and the same line passed again sends nothing. Requests are debounced: a line
 * that keeps changing (a vertex being dragged) is sent once it holds still for 300 ms, because
 * every request is billed, a cancelled one included. The client's own retries are off for the
 * same reason: a failure that could pass on a second try (a rate limit, a service that did not
 * answer) offers a Retry button instead, and nothing is resent behind your back.
 *
 * Gain is the headline number. While a new line loads, the previous profile stays on screen,
 * dimmed, and the first load holds the space the result will take, so nothing jumps. The chart
 * is hidden from screen readers: the statistics carry the numbers, and a polite live region reads
 * out the distance and gain when a profile arrives. The source line under the chart is the
 * attribution the elevation data's licence requires; keep it visible.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Elevation } from "@unmap/elevation";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Spinner } from "@/components/ui/spinner";
import { HELPER_KEY, accentColor, themeMeta, tokenColor, useLayerSet, type LayerSpec } from "@/lib/map-layers";
import { cn } from "@/lib/utils";

/** The last resort when your design system has no --background for the marker's ring. */
const FALLBACK_HALO = "#ffffff";

// --- profile helpers (kept identical across both lanes) ---

/** [longitude, latitude]. */
export type ProfileLngLat = [number, number];

/** A GeoJSON geometry, as far as the profile reads one. */
type AnyGeometry = { type: string; coordinates?: unknown } | null;

/**
 * A line to profile: `[lng, lat]` pairs, a GeoJSON LineString, a Feature holding one, or a
 * FeatureCollection (such as the drawing tool's value), whose last LineString is profiled.
 */
export type ElevationLine =
  | ProfileLngLat[]
  | { type: "LineString"; coordinates: ProfileLngLat[] }
  | { type: "Feature"; geometry: AnyGeometry; properties?: unknown }
  | { type: "FeatureCollection"; features: { type?: string; geometry: AnyGeometry; properties?: unknown }[] };

/** Labels and number formatting. */
export type ProfileLang = "en" | "fr";

/** Where the pointer is: over the chart, or over the line on the map. */
export type HoverSource = "chart" | "map";

/** One point along the line. */
export interface ProfileSample {
  /** Metres from the start, measured along the line. */
  distance: number;
  lng: number;
  lat: number;
}

/** A sample with its ground elevation. */
export interface ProfilePoint extends ProfileSample {
  /** Position in the profile, from 0. */
  index: number;
  /** Metres in the active DEM datum, or null for missing data. Global source models and datums vary. */
  elevation: number | null;
}

export interface ProfileStats {
  /** Length of the line in metres. */
  distance: number;
  /** Total climb in metres, between consecutive samples that have a height. */
  gain: number;
  /** Total descent in metres, as a positive number. */
  loss: number;
  min: number;
  max: number;
}

/** What `onProfile` (Vue: `@profile`) receives. `stats` is null when no sample has a height. */
export interface ElevationProfileData {
  points: ProfilePoint[];
  stats: ProfileStats | null;
}

/**
 * Profiles already fetched, by request key (the samples' positions): a line asked for again is
 * answered from here at once, with no request. A `Map` fits; so does anything with `get` and `set`.
 */
export interface ProfileCache {
  get(key: string): ProfilePoint[] | undefined;
  set(key: string, points: ProfilePoint[]): void;
}

/** `Elevation.get` from `@unmap/elevation`, as the profile calls it. */
export type ElevationGet = (
  points: ProfileLngLat[],
  options: { signal?: AbortSignal },
) => Promise<(number | null)[]>;

/**
 * Why a profile failed: the key was refused (or its plan does not cover this), the gateway is rate
 * limiting, the request was too large to send, the service did not answer, or anything else.
 */
export type ProfileErrorKind = "key" | "rateLimited" | "tooLarge" | "unavailable" | "failed";

/**
 * Nothing to show, waiting for heights, charted, or failed. While a new line loads, `previous`
 * holds the profile on screen, so it stays there (dimmed) instead of collapsing to a spinner.
 */
export type ProfileState =
  | { status: "idle" }
  | { status: "loading"; previous?: ProfilePoint[] }
  | { status: "ready"; points: ProfilePoint[] }
  | { status: "error"; kind: ProfileErrorKind };

export type StatName = "distance" | "gain" | "loss" | "min" | "max";

/**
 * Coordinates per request. The gateway takes 1,000, but the edge refuses a URL over 16 KB, which
 * is about 700 coordinates at six decimals. 500 at five decimals is about 12 KB.
 */
export const ELEVATION_CHUNK = 500;
/**
 * A line that changes faster than this sends one request, for where it settles. Every request is
 * billed, and a cancelled one still is: without the wait, dragging a drawn vertex would send one
 * line per pointer move.
 */
export const PROFILE_DEBOUNCE_MS = 300;
/** The elevation data's own cell. Sampling finer only repeats the same heights. */
export const MIN_INTERVAL_M = 30;
/** A line is never sampled more than this: ten requests. */
export const MAX_SAMPLES = 5000;

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

/** Five decimals is about a metre: finer than the data, and short in a request's URL. */
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** The angle between two points at the Earth's centre, in radians (haversine). */
function centralAngle(a: ProfileLngLat, b: ProfileLngLat): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `fraction` of the way from `a` to `b` along the great circle. */
function alongGreatCircle(a: ProfileLngLat, b: ProfileLngLat, fraction: number): ProfileLngLat {
  const angle = centralAngle(a, b);
  if (angle === 0 || fraction <= 0) return a;
  if (fraction >= 1) return b;
  const wa = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const wb = Math.sin(fraction * angle) / Math.sin(angle);
  const lng1 = toRadians(a[0]);
  const lat1 = toRadians(a[1]);
  const lng2 = toRadians(b[0]);
  const lat2 = toRadians(b[1]);
  const x = wa * Math.cos(lat1) * Math.cos(lng1) + wb * Math.cos(lat2) * Math.cos(lng2);
  const y = wa * Math.cos(lat1) * Math.sin(lng1) + wb * Math.cos(lat2) * Math.sin(lng2);
  const z = wa * Math.sin(lat1) + wb * Math.sin(lat2);
  return [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))];
}

function isLngLat(value: unknown): value is ProfileLngLat {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [lng, lat] = value as unknown[];
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

/** A LineString's coordinates, or undefined for any other geometry. */
function lineStringCoordinates(geometry: AnyGeometry | undefined): unknown {
  return geometry?.type === "LineString" ? geometry.coordinates : undefined;
}

/**
 * The line's coordinates, with invalid points and repeats dropped. Anything that is not a line is
 * empty. From a FeatureCollection, the last LineString: a drawing tool appends each shape it
 * finishes, so that is the newest line, and points and polygons beside it are skipped.
 */
export function lineCoordinates(line: ElevationLine | null | undefined): ProfileLngLat[] {
  let raw: unknown;
  if (Array.isArray(line)) raw = line;
  else if (line?.type === "LineString") raw = line.coordinates;
  else if (line?.type === "Feature") raw = lineStringCoordinates(line.geometry);
  else if (line?.type === "FeatureCollection" && Array.isArray(line.features)) {
    for (let index = line.features.length - 1; index >= 0 && raw === undefined; index--) {
      raw = lineStringCoordinates(line.features[index]?.geometry);
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: ProfileLngLat[] = [];
  for (const point of raw) {
    if (!isLngLat(point)) continue;
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    out.push([point[0], point[1]]);
  }
  return out;
}

/** Cumulative metres at each vertex; the first is 0. */
function measure(coordinates: ProfileLngLat[]): number[] {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index++) {
    cumulative.push(cumulative[index - 1]! + centralAngle(coordinates[index - 1]!, coordinates[index]!) * EARTH_RADIUS_M);
  }
  return cumulative;
}

/** Length of a line in metres. */
export function lineLength(coordinates: ProfileLngLat[]): number {
  const cumulative = measure(coordinates);
  return cumulative[cumulative.length - 1]!;
}

/**
 * A point every `interval` metres along the line, the first at its start and the last at its end.
 * Without an interval: as many as one request carries (500), never closer than 30 m. Never more
 * than 5,000 points, whatever the interval.
 */
export function sampleLine(coordinates: ProfileLngLat[], interval?: number): ProfileSample[] {
  if (coordinates.length < 2) return [];
  const cumulative = measure(coordinates);
  const total = cumulative[cumulative.length - 1]!;
  if (!(total > 0)) return [];
  const requested =
    interval !== undefined && Number.isFinite(interval) && interval > 0
      ? interval
      : Math.max(MIN_INTERVAL_M, total / (ELEVATION_CHUNK - 1));
  const step = Math.max(requested, total / (MAX_SAMPLES - 1));
  // The epsilon keeps a step that divides the line exactly, up to rounding, from adding a sample
  // a hair before the end (a 501st point, and a second request).
  const steps = Math.max(1, Math.ceil(total / step - 1e-9));
  const samples: ProfileSample[] = [];
  let segment = 1;
  for (let k = 0; k <= steps; k++) {
    const distance = k === steps ? total : k * step;
    while (segment < coordinates.length - 1 && cumulative[segment]! < distance) segment++;
    const start = cumulative[segment - 1]!;
    const span = cumulative[segment]! - start;
    const [lng, lat] = alongGreatCircle(
      coordinates[segment - 1]!,
      coordinates[segment]!,
      span === 0 ? 0 : (distance - start) / span,
    );
    samples.push({ distance, lng: round5(lng), lat: round5(lat) });
  }
  return samples;
}

/** Changes exactly when the samples do, so an equal line passed again sends nothing. */
export function sampleKey(samples: ProfileSample[]): string {
  return samples.map((sample) => `${sample.lng},${sample.lat}`).join("|");
}

type LineFeature = { type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: ProfileLngLat[] } };
type PointFeature = { type: "Feature"; properties: Record<string, never>; geometry: { type: "Point"; coordinates: ProfileLngLat } };

/**
 * The samples as one LineString, for the invisible line the map hovers. Drawn from the samples, not
 * the line's own vertices, so the pointer and the marker stay on the path the chart plots.
 */
export function profileLine(samples: ProfileSample[]): { type: "FeatureCollection"; features: LineFeature[] } {
  return {
    type: "FeatureCollection",
    features:
      samples.length >= 2
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: samples.map((sample): ProfileLngLat => [sample.lng, sample.lat]) },
            },
          ]
        : [],
  };
}

/** The marker at the hovered sample, or nothing. Its own source, so a hover never re-tiles the line. */
export function profileMarker(point: ProfileSample | null): { type: "FeatureCollection"; features: PointFeature[] } {
  return {
    type: "FeatureCollection",
    features: point ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [point.lng, point.lat] } }] : [],
  };
}

/** Heights for every sample: 500 per request, all requests at once, answered in order. */
export async function fetchElevations(
  get: ElevationGet,
  samples: ProfileSample[],
  signal: AbortSignal,
): Promise<(number | null)[]> {
  const chunks: ProfileLngLat[][] = [];
  for (let start = 0; start < samples.length; start += ELEVATION_CHUNK) {
    chunks.push(samples.slice(start, start + ELEVATION_CHUNK).map((sample): ProfileLngLat => [sample.lng, sample.lat]));
  }
  const answers = await Promise.all(chunks.map((chunk) => get(chunk, { signal })));
  return answers.flat();
}

/** Samples with their heights. Anything but a finite number is null, never 0. */
export function toPoints(samples: ProfileSample[], elevations: (number | null)[]): ProfilePoint[] {
  return samples.map((sample, index) => {
    const elevation = elevations[index];
    return {
      index,
      distance: sample.distance,
      lng: sample.lng,
      lat: sample.lat,
      elevation: typeof elevation === "number" && Number.isFinite(elevation) ? elevation : null,
    };
  });
}

/** Distance, gain, loss, lowest and highest. Samples with no height are skipped. Null when none has one. */
export function profileStats(points: ProfilePoint[]): ProfileStats | null {
  let min = Infinity;
  let max = -Infinity;
  let gain = 0;
  let loss = 0;
  let previous: number | null = null;
  for (const point of points) {
    if (point.elevation === null) continue;
    if (point.elevation < min) min = point.elevation;
    if (point.elevation > max) max = point.elevation;
    if (previous !== null) {
      const change = point.elevation - previous;
      if (change > 0) gain += change;
      else loss -= change;
    }
    previous = point.elevation;
  }
  if (previous === null) return null;
  return { distance: points[points.length - 1]!.distance, gain, loss, min, max };
}

/** The index of the sample nearest [lng, lat], or -1 when there are none. */
export function nearestPoint(points: ProfileSample[], lng: number, lat: number): number {
  const scale = Math.cos(toRadians(lat));
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const dx = (point.lng - lng) * scale;
    const dy = point.lat - lat;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** The data index a chart pointer event names, whatever type the chart library hands it in. */
export function chartIndex(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * By status and code rather than `instanceof ElevationError`, which a duplicated bundle breaks. An
 * error with no HTTP status never reached the gateway (the network, or the page went offline).
 */
export function profileErrorKind(caught: unknown): ProfileErrorKind {
  const error = typeof caught === "object" && caught !== null ? (caught as { status?: unknown; code?: unknown }) : {};
  const status = typeof error.status === "number" ? error.status : 0;
  if (status === 401 || status === 403 || error.code === "billing_required") return "key";
  if (status === 429) return "rateLimited";
  if (status === 414) return "tooLarge";
  if (status === 0 || status >= 500) return "unavailable";
  return "failed";
}

/**
 * Whether the same request could succeed if sent again: only a rate limit or a service that did
 * not answer. A refused key, an oversized request or a rejected one would fail the same way, and
 * every retry is a billed call.
 */
export function canRetry(kind: ProfileErrorKind): boolean {
  return kind === "rateLimited" || kind === "unavailable";
}

export function isAbort(caught: unknown): boolean {
  return typeof caught === "object" && caught !== null && (caught as { name?: unknown }).name === "AbortError";
}

export const PROFILE_COPY: Record<
  ProfileLang,
  Record<
    "label" | "chart" | "empty" | "loading" | "noCoverage" | "noHeight" | "retry" | "source" | "sourceLink" | "sourceUrl" | StatName | ProfileErrorKind,
    string
  >
> = {
  en: {
    label: "Elevation profile",
    chart: "Elevation (m)",
    empty: "Draw or route a line to see its elevation profile.",
    loading: "Loading elevation...",
    noCoverage: "No elevation data along this line.",
    noHeight: "No data",
    retry: "Retry",
    source: "Elevation by Unmap.",
    sourceLink: "Supplier credits and licences",
    sourceUrl: "https://unmap.dev/attribution",
    key: "The API key was refused. Check the key and its plan.",
    rateLimited: "Too many requests. Wait a moment, then retry.",
    tooLarge: "This line is too long to send in one request. Try a shorter line.",
    unavailable: "The elevation service didn't answer. Retry in a moment.",
    failed: "Elevation couldn't be loaded for this line.",
    distance: "Distance",
    gain: "Gain",
    loss: "Loss",
    min: "Lowest",
    max: "Highest",
  },
  fr: {
    label: "Profil d'altitude",
    chart: "Altitude (m)",
    empty: "Tracez une ligne ou un itinéraire pour voir son profil d'altitude.",
    loading: "Chargement de l'altitude...",
    noCoverage: "Aucune donnée d'altitude le long de cette ligne.",
    noHeight: "Aucune donnée",
    retry: "Réessayer",
    source: "Altitude par Unmap.",
    sourceLink: "Mentions et licences des fournisseurs",
    sourceUrl: "https://unmap.dev/fr/attribution",
    key: "La clé API a été refusée. Vérifiez la clé et son forfait.",
    rateLimited: "Trop de requêtes. Patientez un instant, puis réessayez.",
    tooLarge: "Cette ligne est trop longue pour une seule requête. Essayez une ligne plus courte.",
    unavailable: "Le service d'altitude n'a pas répondu. Réessayez dans un instant.",
    failed: "L'altitude n'a pas pu être chargée pour cette ligne.",
    distance: "Distance",
    gain: "Dénivelé positif",
    loss: "Dénivelé négatif",
    min: "Plus bas",
    max: "Plus haut",
  },
};

function numberFormat(lang: ProfileLang, digits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** `850 m` under a kilometre, `12.3 km` (fr: `12,3 km`) from there. */
export function formatDistance(metres: number, lang: ProfileLang): string {
  return metres < 1000
    ? `${numberFormat(lang, 0).format(metres)} m`
    : `${numberFormat(lang, 1).format(metres / 1000)} km`;
}

/** Whole metres: a 30 m DEM has no decimals worth printing. */
export function formatElevation(metres: number, lang: ProfileLang): string {
  return `${numberFormat(lang, 0).format(metres)} m`;
}

/** A height for the chart's tooltip: whole metres, or "No data" where the elevation data has none. */
export function formatHeight(metres: number | null | undefined, lang: ProfileLang): string {
  return typeof metres === "number" && Number.isFinite(metres) ? formatElevation(metres, lang) : PROFILE_COPY[lang].noHeight;
}

export function statRows(stats: ProfileStats, lang: ProfileLang): [StatName, string][] {
  return [
    ["distance", formatDistance(stats.distance, lang)],
    ["gain", formatElevation(stats.gain, lang)],
    ["loss", formatElevation(stats.loss, lang)],
    ["min", formatElevation(stats.min, lang)],
    ["max", formatElevation(stats.max, lang)],
  ];
}

/** What a screen reader hears when a profile arrives: its length and its climb. */
export function profileAnnouncement(stats: ProfileStats, lang: ProfileLang): string {
  const distance = formatDistance(stats.distance, lang);
  const gain = formatElevation(stats.gain, lang);
  return lang === "fr"
    ? `${PROFILE_COPY.fr.label} : ${distance}, dénivelé positif de ${gain}.`
    : `${PROFILE_COPY.en.label}: ${distance}, ${gain} gain.`;
}

/** A value and its unit apart, so the unit can sit quieter than the number: `1,047 m` is `["1,047", "m"]`. */
export function splitUnit(value: string): [string, string] {
  const at = value.lastIndexOf(" ");
  return at < 0 ? [value, ""] : [value.slice(0, at), value.slice(at + 1)];
}

/** The chart's one series, on your --chart-1. */
export function profileChartConfig(lang: ProfileLang) {
  return { elevation: { label: PROFILE_COPY[lang].chart, color: "var(--chart-1)" } };
}

// --- end profile helpers ---

/**
 * An axis tick: the value and its unit joined by a no-break space. Recharts breaks tick text at
 * ordinary spaces whenever it measures a label as too wide, and it measures unevenly, so `1,600 m`
 * would fall onto two lines while `2,200 m` beside it stayed on one.
 */
export function tickLabel(value: string): string {
  const [number, unit] = splitUnit(value);
  return unit ? `${number}\u00a0${unit}` : number;
}

export interface ElevationProfileProps {
  /** unmap API key. */
  apiKey: string;
  /** Gateway base URL. Defaults to the unmap production gateway. */
  gateway?: string;
  /**
   * The line: `[lng, lat]` pairs, a GeoJSON LineString, or a Feature holding one. Sent once it has
   * held still for 300 ms; each request is one billed call per 500 samples.
   */
  line?: ElevationLine | null;
  /** Metres between samples. Default: as many as one request carries (500), never finer than 30 m. */
  interval?: number;
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Source id and layer-id prefix. Defaults to a generated id. The marker's source is `<id>-marker`. */
  id?: string;
  /** Labels and number formatting. Defaults to English. */
  lang?: ProfileLang;
  /** Marker colour. Defaults to the theme's route colour or your --primary, per the Map's accent. */
  color?: string;
  /**
   * Profiles already fetched, e.g. a `new Map()` you keep. A line whose samples are in it is shown
   * at once with no request; each profile fetched is put in it. Clear it when the key changes.
   */
  cache?: ProfileCache;
  /** The profile once it loads; null when there is none (no line, or a failure). */
  onProfile?: (profile: ElevationProfileData | null) => void;
  /** The sample under the pointer, on the chart or on the line; null when the pointer leaves. */
  onHover?: (point: ProfilePoint | null) => void;
  className?: string;
}

const NO_POINTS: ProfilePoint[] = [];

/** Gain leads; the rest follow in reading order. */
const STAT_ORDER: StatName[] = ["gain", "distance", "loss", "min", "max"];
const HEADLINE: StatName = "gain";

/**
 * One row under a narrow panel (gain above, four beside each other), one line from 24rem up. A
 * container query, so it follows the panel the profile sits in, not the window.
 */
const STATS_GRID = "grid grid-cols-4 items-end gap-x-4 gap-y-2 @sm:grid-cols-[auto_repeat(4,minmax(0,1fr))]";
const HEADLINE_CELL = "col-span-4 @sm:col-span-1 @sm:pr-2";

export function ElevationProfile({
  apiKey,
  gateway,
  line,
  interval,
  mapId,
  id,
  lang = "en",
  color,
  cache,
  onProfile,
  onHover,
  className,
}: ElevationProfileProps) {
  const generated = `unmap-elevation-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const sourceId = id ?? generated;
  const markerId = `${sourceId}-marker`;
  const hitId = `${sourceId}-hit`;
  const copy = PROFILE_COPY[lang];

  // Parsed once per `line` value, and keyed on the content, so a line passed again as a new array
  // is the same line: no request, no setData.
  const parsed = useMemo(() => lineCoordinates(line), [line]);
  const lineKey = useMemo(() => parsed.map((point) => point.join(",")).join("|"), [parsed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const coordinates = useMemo(() => parsed, [lineKey]);
  const samples = useMemo(() => sampleLine(coordinates, interval), [coordinates, interval]);
  const requestKey = useMemo(() => sampleKey(samples), [samples]);
  // The client's own retries are off: each would be another billed call the Retry button never offered.
  const client = useMemo(() => new Elevation({ key: apiKey, gateway, retry: false }), [apiKey, gateway]);

  // A line that is already there starts loading, so the first paint is not the empty prompt.
  const [state, setState] = useState<ProfileState>(() => (samples.length >= 2 ? { status: "loading" } : { status: "idle" }));
  // Bumped by Retry: the same samples, asked again.
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState<{ index: number; from: HoverSource } | null>(null);
  const points = state.status === "ready" ? state.points : NO_POINTS;
  const stats = useMemo(() => profileStats(points), [points]);
  const activePoint = active ? (points[active.index] ?? null) : null;
  const mapPoint = active?.from === "map" ? activePoint : null;
  const config = useMemo(() => profileChartConfig(lang) satisfies ChartConfig, [lang]);

  const latest = useRef({ samples, points, onProfile, onHover, cache });
  latest.current = { samples, points, onProfile, onHover, cache };

  useEffect(() => {
    const current = latest.current.samples;
    setActive(null);
    if (current.length < 2) {
      setState({ status: "idle" });
      latest.current.onProfile?.(null);
      return;
    }
    // A profile already fetched for these samples is shown at once: no wait, no request.
    const cached = latest.current.cache?.get(requestKey);
    if (cached) {
      setState({ status: "ready", points: cached });
      latest.current.onProfile?.({ points: cached, stats: profileStats(cached) });
      return;
    }
    const controller = new AbortController();
    let live = true;
    // The profile on screen stays there, dimmed, until the new one replaces it.
    setState((previous) => ({
      status: "loading",
      previous: previous.status === "ready" ? previous.points : previous.status === "loading" ? previous.previous : undefined,
    }));
    // Every request is billed, a cancelled one included: wait for the line to hold still.
    const timer = setTimeout(() => {
      fetchElevations((chunk, options) => client.get(chunk, options), current, controller.signal).then(
        (elevations) => {
          if (!live) return;
          const next = toPoints(current, elevations);
          latest.current.cache?.set(requestKey, next);
          setState({ status: "ready", points: next });
          latest.current.onProfile?.({ points: next, stats: profileStats(next) });
        },
        (caught: unknown) => {
          if (!live || isAbort(caught)) return;
          // One part failed, so the other parts are worth nothing: stop paying for them.
          controller.abort();
          setState({ status: "error", kind: profileErrorKind(caught) });
          latest.current.onProfile?.(null);
        },
      );
    }, PROFILE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
    // `latest` carries the samples; `requestKey` changes exactly when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, client, attempt]);

  const reported = useRef<ProfilePoint | null>(null);
  useEffect(() => {
    if (reported.current === activePoint) return;
    reported.current = activePoint;
    latest.current.onHover?.(activePoint);
  }, [activePoint]);

  const activate = useCallback((index: number, from: HoverSource) => {
    setActive((current) => (current?.index === index && current.from === from ? current : { index, from }));
  }, []);
  // Each source clears only its own hover: leaving the chart never drops a marker the map put there.
  const release = useCallback((from: HoverSource) => {
    setActive((current) => (current?.from === from ? null : current));
  }, []);

  // Two sources: the hover moves only the marker, so the line is never re-tiled under the pointer.
  const lineData = useMemo(() => profileLine(samples), [samples]);
  const markerData = useMemo(() => profileMarker(activePoint), [activePoint]);
  const metadata = { [HELPER_KEY]: true };

  const { map } = useLayerSet({
    mapId,
    sourceId,
    data: lineData,
    // On top of everything, labels included, and under the marker, which is added after it.
    beforeId: null,
    layers: (live) => [
      {
        id: hitId,
        type: "line",
        source: sourceId,
        // A tool's own layers, not data: the feature inspector and the time slider skip them.
        metadata,
        layout: { "line-cap": "round", "line-join": "round" },
        // Invisible but still hit-tested: MapLibre queries a line by its width, not its opacity.
        paint: { "line-color": accentColor(live, color, themeMeta(live).route?.color), "line-width": 16, "line-opacity": 0 },
      } as LayerSpec,
    ],
  });

  useLayerSet({
    mapId,
    sourceId: markerId,
    data: markerData,
    // On top of everything: the marker is a pointer, not data.
    beforeId: null,
    key: color ?? "",
    layers: (live) => [
      {
        id: `${sourceId}-point`,
        type: "circle",
        source: markerId,
        metadata,
        paint: {
          "circle-radius": 6,
          "circle-color": accentColor(live, color, themeMeta(live).route?.color),
          "circle-stroke-width": 2,
          "circle-stroke-color": tokenColor(live, "--background") ?? FALLBACK_HALO,
        },
      } as LayerSpec,
    ],
  });

  useEffect(() => {
    if (!map) return;
    const move = (event: { lngLat?: { lng: number; lat: number } }) => {
      const current = latest.current.points;
      if (!event.lngLat || current.length === 0) return;
      const index = nearestPoint(current, event.lngLat.lng, event.lngLat.lat);
      if (index >= 0) activate(index, "map");
    };
    const leave = () => release("map");
    map.on("mousemove", hitId, move as never);
    map.on("mouseleave", hitId, leave as never);
    return () => {
      map.off("mousemove", hitId, move as never);
      map.off("mouseleave", hitId, leave as never);
    };
  }, [map, hitId, activate, release]);

  // What the chart shows: the profile, or while the next one loads, the one before it.
  const shown = state.status === "ready" ? state.points : state.status === "loading" ? state.previous : undefined;
  const shownStats = useMemo(() => (shown ? profileStats(shown) : null), [shown]);
  const loading = state.status === "loading";
  const total = shown && shown.length > 0 ? shown[shown.length - 1]!.distance : 0;
  const rows = shownStats ? statRows(shownStats, lang) : [];
  const ordered = STAT_ORDER.map((name) => [name, rows.find(([row]) => row === name)?.[1] ?? ""] as const);

  return (
    <div
      data-unmap-elevation-profile=""
      role="group"
      aria-label={copy.label}
      className={cn("@container flex w-full min-w-0 flex-col gap-3", className)}
    >
      {state.status === "idle" ? (
        <p data-unmap-elevation-empty="" className="text-sm text-muted-foreground">
          {copy.empty}
        </p>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription data-unmap-elevation-error="">{copy[state.kind]}</AlertDescription>
          {canRetry(state.kind) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 justify-self-start"
              onClick={() => setAttempt((count) => count + 1)}
            >
              {copy.retry}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {state.status === "ready" && !stats ? (
        <Alert role="status">
          <AlertDescription>{copy.noCoverage}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !shownStats ? (
        // The first load holds the result's shape: the statistics, the chart's height, the source.
        <div data-unmap-elevation-skeleton="" className="flex flex-col gap-3">
          <dl aria-hidden="true" className={STATS_GRID}>
            {STAT_ORDER.map((name) => (
              <div
                key={name}
                data-unmap-elevation-stat={name}
                data-unmap-elevation-headline={name === HEADLINE ? "" : undefined}
                className={name === HEADLINE ? HEADLINE_CELL : undefined}
              >
                <dt className="text-xs text-muted-foreground">{copy[name]}</dt>
                <dd>
                  <span
                    className={cn(
                      "block animate-pulse rounded-md bg-muted motion-reduce:animate-none",
                      name === HEADLINE ? "h-6 w-20" : "h-4 w-12",
                    )}
                  />
                </dd>
              </div>
            ))}
          </dl>
          <div data-unmap-elevation-loading="" className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-label={copy.loading} />
            <span aria-hidden="true">{copy.loading}</span>
          </div>
          <p data-unmap-elevation-source="" className="text-xs text-muted-foreground">
            {copy.source}
          </p>
        </div>
      ) : null}
      {shownStats && (state.status === "ready" || loading) ? (
        <div data-unmap-elevation-result="" data-stale={loading ? "true" : undefined} aria-busy={loading} className="relative">
          <div
            className={cn(
              "flex flex-col gap-3 transition-opacity duration-200 ease-out motion-reduce:transition-none",
              loading && "pointer-events-none opacity-50",
            )}
          >
            <dl data-unmap-elevation-stats="" className={STATS_GRID}>
              {ordered.map(([name, value]) => {
                const [amount, unit] = splitUnit(value);
                return name === HEADLINE ? (
                  <div key={name} data-unmap-elevation-stat={name} data-unmap-elevation-headline="" className={HEADLINE_CELL}>
                    <dt className="text-xs text-muted-foreground">{copy[name]}</dt>
                    <dd className="text-2xl leading-none font-semibold tabular-nums">
                      {amount} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
                    </dd>
                  </div>
                ) : (
                  <div key={name} data-unmap-elevation-stat={name} className="min-w-0 text-xs">
                    <dt className="text-muted-foreground">{copy[name]}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                );
              })}
            </dl>
            {/* The statistics carry the numbers; the chart is for the eye and the pointer. */}
            <div data-unmap-elevation-chart="" aria-hidden="true">
              <ChartContainer config={config} className="aspect-auto h-40 w-full">
                <LineChart
                  data={shown}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  onMouseMove={(chartState: { activeTooltipIndex?: unknown }) => {
                    const index = chartIndex(chartState.activeTooltipIndex);
                    if (index !== null && index < latest.current.points.length) activate(index, "chart");
                  }}
                  onMouseLeave={() => release("chart")}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="distance"
                    type="number"
                    domain={[0, total]}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tickFormatter={(value: number) => tickLabel(formatDistance(value, lang))}
                  />
                  <YAxis
                    type="number"
                    domain={["auto", "auto"]}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(value: number) => tickLabel(formatElevation(value, lang))}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        indicator="dot"
                        labelFormatter={(_label, payload) => formatDistance(Number(payload?.[0]?.payload?.distance ?? 0), lang)}
                        formatter={(value) => (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{copy.chart}</span>
                            <span className="font-medium tabular-nums">
                              {formatHeight(typeof value === "number" ? value : null, lang)}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Line
                    dataKey="elevation"
                    type="linear"
                    stroke="var(--color-elevation)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  {mapPoint ? (
                    <ReferenceLine x={mapPoint.distance} stroke="var(--color-elevation)" strokeDasharray="3 3" />
                  ) : null}
                  {mapPoint && mapPoint.elevation !== null ? (
                    <ReferenceDot
                      x={mapPoint.distance}
                      y={mapPoint.elevation}
                      r={4}
                      fill="var(--color-elevation)"
                      stroke="var(--background)"
                    />
                  ) : null}
                </LineChart>
              </ChartContainer>
            </div>
            {/* The attribution the elevation data's licence requires. */}
            <p data-unmap-elevation-source="" className="text-xs text-muted-foreground">
              {copy.source}{" "}
              <a href={copy.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
                {copy.sourceLink}
              </a>
            </p>
          </div>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner aria-label={copy.loading} />
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Read out when a profile arrives; failures and "no data" announce through their own Alert. */}
      <p data-unmap-elevation-announce="" aria-live="polite" aria-atomic="true" className="sr-only">
        {state.status === "ready" && stats ? profileAnnouncement(stats, lang) : ""}
      </p>
    </div>
  );
}
