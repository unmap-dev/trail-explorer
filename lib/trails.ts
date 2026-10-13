/**
 * The trail model: the shape of data/trails.geojson and the validator that holds any file to it,
 * the one `scripts/fetch-trails.mjs` writes and one you write yourself. Plain TypeScript, no React,
 * no fetch; unit-tested in test/trails.test.ts.
 *
 * Every number on a trail says how it was worked out (`method`), and every field the source does
 * not carry is null with the reason, never filled in. No trail is ever invented (spec §6).
 */
import { isLngLat, type LngLat } from "./geo";

export interface Measured {
  metres: number;
  method: string;
}

export interface TrailElevation {
  gain: number;
  loss: number;
  min: number;
  max: number;
  method: string;
}

export interface Difficulty {
  /** As published, in English. */
  value: string;
  /** As published, in French; null when the source publishes the rating in one language. */
  valueFr: string | null;
  /** Its place on the source's scale (1 = easiest), when the source numbers it; orders the filter. */
  level: number | null;
  /** Who rated it. */
  source: string;
}

export interface Trail {
  /** Stable across refreshes: the slug of the published name. Used in `?trail=`. */
  id: string;
  /** As published. */
  name: string;
  /** The French name when the source publishes one separately. */
  nameFr: string | null;
  /** National park or trail system, as published, when the source says. */
  area: string | null;
  /** Continuous parts in walking order where it could be worked out; the first is the main one. */
  lines: LngLat[][];
  length: Measured;
  /** Climb along the main part; null when it was not sampled (and `elevationNote` says why). */
  elevation: TrailElevation | null;
  elevationNote: string | null;
  /** Only when the source carries an official rating; null otherwise (`difficultyNote` says why). */
  difficulty: Difficulty | null;
  difficultyNote: string | null;
  trailhead: { coordinates: LngLat; method: string };
  source: string;
  licence: string;
  attribution: string;
  sourceUrl: string;
  retrievedAt: string;
  /**
   * Other attributes as the source publishes them, by the source's field name, in English and
   * French (the same text twice where the source publishes one language).
   */
  published: Record<string, { en: string[]; fr: string[] }>;
  /** The source's own page for the trail, when it links one. */
  moreInfo: { en?: string; fr?: string } | null;
}

export interface DatasetProvenance {
  dataset: string;
  publisher: string;
  datasetUrl: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  retrievedAt: string;
  /** Free text on how the collection was chosen and computed. */
  notes: string[];
}

export interface TrailCollection {
  trails: Trail[];
  provenance: DatasetProvenance;
}

export class TrailDataError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "TrailDataError";
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function linesOf(geometry: unknown): LngLat[][] | null {
  if (!isObj(geometry)) return null;
  const raw = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : null;
  if (!Array.isArray(raw)) return null;
  const lines: LngLat[][] = [];
  for (const line of raw) {
    if (!Array.isArray(line) || line.length < 2 || !line.every(isLngLat)) return null;
    lines.push(line.map((p: LngLat) => [p[0], p[1]] as LngLat));
  }
  return lines.length ? lines : null;
}

/**
 * A FeatureCollection of trails (LineString or MultiLineString features) as trails, or a
 * TrailDataError listing every problem found.
 */
export function parseTrails(input: unknown): TrailCollection {
  const problems: string[] = [];
  if (!isObj(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) throw new TrailDataError(["Not a GeoJSON FeatureCollection."]);
  const p = isObj(input._provenance) ? input._provenance : {};
  const provenance: DatasetProvenance = {
    dataset: str(p.dataset) ?? "",
    publisher: str(p.publisher) ?? "",
    datasetUrl: str(p.datasetUrl) ?? "",
    licence: str(p.licence) ?? "",
    licenceUrl: str(p.licenceUrl) ?? "",
    attribution: str(p.attribution) ?? "",
    retrievedAt: str(p.retrievedAt) ?? "",
    notes: Array.isArray(p.notes) ? p.notes.filter((n): n is string => typeof n === "string") : [],
  };
  if (!provenance.licence || !provenance.attribution) problems.push("_provenance: licence and attribution are required.");

  const trails: Trail[] = [];
  const ids = new Set<string>();
  input.features.forEach((f, i) => {
    const at = `feature ${i}`;
    if (!isObj(f) || f.type !== "Feature" || !isObj(f.properties)) return problems.push(`${at}: not a Feature with properties.`);
    const q = f.properties;
    const id = str(q.id);
    const name = str(q.name);
    const lines = linesOf(f.geometry);
    const length = isObj(q.length) ? q.length : null;
    const head = isObj(q.trailhead) ? q.trailhead : null;
    const before = problems.length;
    if (!id || !/^[a-z0-9-]+$/.test(id)) problems.push(`${at}: id must be lowercase letters, digits and dashes.`);
    else if (ids.has(id)) problems.push(`${at}: id "${id}" is used twice.`);
    if (!name) problems.push(`${at}: name is required.`);
    if (!lines) problems.push(`${at}: geometry must be a LineString or MultiLineString of valid [lng, lat] positions.`);
    if (!length || num(length.metres) === null || !str(length.method)) problems.push(`${at}: length { metres, method } is required.`);
    if (!head || !isLngLat(head.coordinates) || !str(head.method)) problems.push(`${at}: trailhead { coordinates, method } is required.`);
    for (const key of ["source", "licence", "attribution", "sourceUrl", "retrievedAt"]) if (!str(q[key])) problems.push(`${at}: ${key} is required.`);
    const e = q.elevation;
    if (e !== null && e !== undefined && !(isObj(e) && ["gain", "loss", "min", "max"].every((k) => num(e[k]) !== null) && str(e.method))) problems.push(`${at}: elevation must be null or { gain, loss, min, max, method }.`);
    const d = q.difficulty;
    if (d !== null && d !== undefined && !(isObj(d) && str(d.value) && str(d.source))) problems.push(`${at}: difficulty must be null or { value, source }.`);
    if (problems.length > before) return;
    ids.add(id!);
    const published: Record<string, { en: string[]; fr: string[] }> = {};
    const texts = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()) : []);
    if (isObj(q.published))
      for (const [k, v] of Object.entries(q.published)) {
        // Either { en, fr } or a plain list (one language, the same in both).
        const en = isObj(v) ? texts(v.en) : texts(v);
        const fr = isObj(v) ? texts(v.fr) : en;
        if (en.length) published[k] = { en, fr: fr.length ? fr : en };
      }
    const info = isObj(q.moreInfo) ? { en: str(q.moreInfo.en) ?? undefined, fr: str(q.moreInfo.fr) ?? undefined } : null;
    trails.push({
      id: id!,
      name: name!,
      nameFr: str(q.nameFr),
      area: str(q.area),
      lines: lines!,
      length: { metres: num(length!.metres)!, method: str(length!.method)! },
      elevation: isObj(e) ? { gain: num(e.gain)!, loss: num(e.loss)!, min: num(e.min)!, max: num(e.max)!, method: str(e.method)! } : null,
      elevationNote: str(q.elevationNote),
      difficulty: isObj(d) ? { value: str(d.value)!, valueFr: str(d.valueFr), level: num(d.level), source: str(d.source)! } : null,
      difficultyNote: str(q.difficultyNote),
      trailhead: { coordinates: [(head!.coordinates as LngLat)[0], (head!.coordinates as LngLat)[1]], method: str(head!.method)! },
      source: str(q.source)!,
      licence: str(q.licence)!,
      attribution: str(q.attribution)!,
      sourceUrl: str(q.sourceUrl)!,
      retrievedAt: str(q.retrievedAt)!,
      published,
      moreInfo: info && (info.en || info.fr) ? info : null,
    });
  });
  if (problems.length) throw new TrailDataError(problems);
  return { trails, provenance };
}

/** A rating in the reader's language: the French label where the source publishes one. */
export function difficultyText(d: Difficulty, lang: "en" | "fr"): string {
  return lang === "fr" ? d.valueFr ?? d.value : d.value;
}

/** A trail's name in the reader's language: the French name where the source publishes one. */
export function trailName(trail: Pick<Trail, "name" | "nameFr">, lang: "en" | "fr"): string {
  return lang === "fr" && trail.nameFr ? trail.nameFr : trail.name;
}

/** The line the elevation profile follows: the trail's main continuous part, in walking order. */
export function profileLine(trail: Pick<Trail, "lines">): LngLat[] {
  return trail.lines[0] ?? [];
}

/** A trail's lines as GeoJSON, for the map. */
export function trailGeometry(trail: Pick<Trail, "lines">): { type: "LineString"; coordinates: LngLat[] } | { type: "MultiLineString"; coordinates: LngLat[][] } {
  return trail.lines.length === 1 ? { type: "LineString", coordinates: trail.lines[0]! } : { type: "MultiLineString", coordinates: trail.lines };
}
