/**
 * From the source's segments to the app's 10–20 trails: group segments by name, join them into
 * continuous lines, keep day-hike lengths, choose which trails to ship, and write each one with
 * its provenance and the method behind every number. Pure functions, used by
 * `scripts/fetch-trails.mjs` and unit-tested in test/curate.test.ts against synthetic fixtures.
 *
 * Nothing is invented. A trail is only ever a group of the source's own segments under the
 * source's own name; a field the source does not carry is null with the reason.
 */
import { JOIN_TOLERANCE_M, defaultInterval, gapBetween, joinSegments, lineLength, linesLength, sampleLine, type LngLat } from "./geo.ts";
import { bilingual, codeOf, readValue, type EsriField, type FieldMap, type SourceFeature } from "./source.ts";

/** Day-hike range: shorter is a viewpoint path, longer is a backpacking route. */
export const MIN_DAY_HIKE_M = 1500;
export const MAX_DAY_HIKE_M = 25000;
/** At most this many trails ship. */
export const MAX_TRAILS = 20;
/** Fewer than this is reported as a shortfall (the script still writes what it has). */
export const MIN_TRAILS = 10;

/** A joined part shorter than this is a digitising sliver (a 0–1 m stub), not a piece of trail. */
export const MIN_PART_M = 10;

/** Names that are not hiking trails, whatever the length. */
const NOT_A_HIKE = /\b(highway|parkway|parking|connector|road access|service road)\b/i;

/**
 * Well-known day hikes in the envelope, matched against the source's names (accents, case and
 * punctuation ignored). They decide only which of the source's own trails come first; a name on
 * this list that the source does not carry is simply not shipped.
 */
export const PREFERRED = [
  "johnston canyon",
  "lake agnes",
  "plain of six glaciers",
  "larch valley",
  "sentinel pass",
  "eiffel lake",
  "consolation lake",
  "tunnel mountain",
  "sulphur mountain",
  "c level cirque",
  "cory pass",
  "stanley glacier",
  "boom lake",
  "rockbound lake",
  "taylor lake",
  "big beehive",
  "fairview",
  "saddleback",
  "bourgeau lake",
  "healy pass",
  "cascade amphitheatre",
  "aylmer",
  "stewart canyon",
  "sundance canyon",
  "silverton falls",
  "paradise valley",
  "fenland",
  "marsh loop",
  "hoodoos",
  "lake louise lakeshore",
];

/** Lowercase, no accents, punctuation as spaces: how names are compared. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A stable id from a name: `Lake Agnes Trail` → `lake-agnes-trail`. */
export function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, "-").slice(0, 60).replace(/-+$/, "") || "trail";
}

/**
 * The features a hiker walks: those the activity field marks as hiking, when the layer has one,
 * and each path once (a layer can draw the same path for every activity on it).
 */
export function hikingFeatures(features: readonly SourceFeature[], fields: FieldMap): SourceFeature[] {
  const a = fields.activity;
  const hiking = a ? features.filter((f) => f.properties[a.field] === a.hiking) : [...features];
  const seen = new Set<string>();
  return hiking.filter((f) => {
    const name = fields.name ? String(f.properties[fields.name] ?? "") : "";
    const key = `${name}|${JSON.stringify(f.paths)}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

export interface Group {
  key: string;
  name: string;
  nameFr: string | null;
  area: string | null;
  objectIds: number[];
  /** How many of the source's features carry this name. */
  features: number;
  /** Every path of those features' geometry. */
  segments: LngLat[][];
  /** Every value seen on the group's segments, per field. */
  values: Record<string, Set<string>>;
}

/**
 * Segments grouped into trails by their name (and area, so two parks' "Lakeshore" stay apart).
 * Segments with no name are left out: a trail is named by its publisher, never by us.
 */
export function groupSegments(features: readonly SourceFeature[], fields: FieldMap, fieldInfo: readonly EsriField[]): Group[] {
  const byName = new Map(fieldInfo.map((f) => [f.name, f]));
  const read = (f: SourceFeature, name: string | null) => (name ? readValue(byName.get(name), f.properties[name]) : null);
  const groups = new Map<string, Group>();
  for (const f of features) {
    const name = read(f, fields.name);
    if (!name) continue;
    const area = read(f, fields.area);
    const key = `${normalizeName(name)}|${area ? normalizeName(area) : ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name, nameFr: read(f, fields.nameFr), area, objectIds: [], features: 0, segments: [], values: {} };
      groups.set(key, g);
    }
    const id = fields.objectId ? Number(f.properties[fields.objectId]) : NaN;
    if (Number.isFinite(id)) g.objectIds.push(id);
    g.features += 1;
    g.segments.push(...f.paths);
    for (const field of [fields.difficulty, fields.urlEn, fields.urlFr, ...fields.published]) {
      const v = read(f, field);
      if (field && v) (g.values[field] ??= new Set()).add(v);
    }
  }
  return [...groups.values()];
}

export interface Candidate {
  group: Group;
  lines: LngLat[][];
  metres: number;
  /** Share of the length in the main continuous part. */
  mainShare: number;
  /** Index in PREFERRED, or Infinity. */
  preference: number;
}

/** Each group's segments joined, measured, and checked against the day-hike rules. */
export function candidatesFrom(groups: readonly Group[]): { kept: Candidate[]; dropped: { name: string; reason: string }[] } {
  const kept: Candidate[] = [];
  const dropped: { name: string; reason: string }[] = [];
  for (const group of groups) {
    const joined = joinSegments(group.segments);
    const lines = joined.length > 1 ? joined.filter((l, i) => i === 0 || lineLength(l) >= MIN_PART_M) : joined;
    const metres = linesLength(lines);
    if (NOT_A_HIKE.test(group.name)) dropped.push({ name: group.name, reason: "named as a road, parkway, parking area or connector" });
    else if (metres < MIN_DAY_HIKE_M) dropped.push({ name: group.name, reason: `shorter than ${MIN_DAY_HIKE_M / 1000} km` });
    else if (metres > MAX_DAY_HIKE_M) dropped.push({ name: group.name, reason: `longer than ${MAX_DAY_HIKE_M / 1000} km` });
    else {
      const n = normalizeName(group.name);
      const preference = PREFERRED.findIndex((p) => n.includes(p));
      kept.push({ group, lines, metres, mainShare: lineLength(lines[0]!) / metres, preference: preference < 0 ? Infinity : preference });
    }
  }
  return { kept, dropped };
}

/**
 * Which trails ship, at most MAX_TRAILS: the preferred names first, in list order, one trail per
 * preferred name; then the rest, the most continuous first (a profile covers the main part
 * only), then by name.
 */
export function selectTrails(kept: readonly Candidate[]): Candidate[] {
  const chosen: Candidate[] = [];
  const used = new Set<number>();
  for (const c of [...kept].filter((c) => c.preference !== Infinity).sort((a, b) => a.preference - b.preference || b.mainShare - a.mainShare)) {
    if (used.has(c.preference)) continue;
    used.add(c.preference);
    chosen.push(c);
  }
  const rest = kept.filter((c) => !chosen.includes(c)).sort((a, b) => b.mainShare - a.mainShare || a.group.name.localeCompare(b.group.name));
  return [...chosen, ...rest].slice(0, MAX_TRAILS);
}

/** Reverse the main part when its far end is the lower one, so the walk starts at the bottom. */
export function orientMain(lines: LngLat[][], ends: [number | null, number | null] | null): { lines: LngLat[][]; oriented: boolean } {
  const [start, end] = ends ?? [null, null];
  if (start === null || end === null || !(end < start)) return { lines, oriented: start !== null && end !== null };
  return { lines: [[...lines[0]!].reverse(), ...lines.slice(1)], oriented: true };
}

export interface Context {
  source: string;
  licence: string;
  attribution: string;
  sourceUrl: string;
  retrievedAt: string;
  fields: FieldMap;
  fieldInfo: readonly EsriField[];
}

export interface ElevationResult {
  gain: number;
  loss: number;
  min: number;
  max: number;
  samples: number;
  interval: number;
  datum: string | null;
  demSource: string | null;
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

export const LENGTH_METHOD =
  `Sum of great-circle (haversine, R = 6,371,008.8 m) distances between consecutive vertices of the published geometry, over every part. ` +
  `Segment ends within ${JOIN_TOLERANCE_M} m are joined, which adds at most that straight step per join; gaps between parts are not counted, ` +
  `and parts shorter than ${MIN_PART_M} m (digitising slivers) are left out.`;

/** One trail as a GeoJSON Feature in the shape lib/trails.ts reads. */
export function trailFeature(c: Candidate, ctx: Context, opts: { id: string; oriented: boolean; elevation: ElevationResult | null; elevationNote: string | null }) {
  const { group, lines } = c;
  const main = lines[0]!;
  const mainMetres = lineLength(main);
  const info = (name: string) => ctx.fieldInfo.find((f) => f.name === name);
  const label = (name: string) => info(name)?.alias?.trim() || name;
  // In the source's own scale order where it has one (Easy before Difficult), otherwise as text.
  const ordered = (field: string, values: Iterable<string>) =>
    [...values].sort((a, b) => (codeOf(info(field), a) ?? Infinity) - (codeOf(info(field), b) ?? Infinity) || a.localeCompare(b));
  const published: Record<string, { en: string[]; fr: string[] }> = {};
  for (const field of ctx.fields.published) {
    const v = group.values[field];
    if (!v?.size) continue;
    const labels = ordered(field, v).map(bilingual);
    published[field] = { en: labels.map((l) => l.en), fr: labels.map((l) => l.fr) };
  }
  const difficultyValues = ctx.fields.difficulty ? ordered(ctx.fields.difficulty, group.values[ctx.fields.difficulty] ?? []) : [];
  // Segments rated differently: the hardest rating, when the source's scale says which that is.
  const ranked = difficultyValues.length > 1 && difficultyValues.every((v) => codeOf(info(ctx.fields.difficulty!), v) !== null);
  const rated = difficultyValues.length === 1 || ranked ? difficultyValues[difficultyValues.length - 1]! : null;
  const rating = rated ? bilingual(rated) : null;
  const partsNote = lines.length > 1 ? ` The trail is published in ${lines.length} parts that do not meet (nearest ends ${Math.round(gapBetween(lines[0]!, lines[1]!))} m apart); the main part is ${km(mainMetres)} of ${km(c.metres)}.` : "";
  const urlEn = ctx.fields.urlEn ? [...(group.values[ctx.fields.urlEn] ?? [])][0] : undefined;
  const urlFr = ctx.fields.urlFr ? [...(group.values[ctx.fields.urlFr] ?? [])][0] : undefined;
  const e = opts.elevation;
  return {
    type: "Feature" as const,
    geometry: lines.length === 1 ? { type: "LineString" as const, coordinates: main } : { type: "MultiLineString" as const, coordinates: lines },
    properties: {
      id: opts.id,
      name: group.name,
      nameFr: group.nameFr,
      area: group.area,
      source: ctx.source,
      licence: ctx.licence,
      attribution: ctx.attribution,
      sourceUrl: ctx.sourceUrl,
      retrievedAt: ctx.retrievedAt,
      sourceFeatures: group.features,
      sourceObjectIds: [...group.objectIds].sort((a, b) => a - b),
      length: { metres: Math.round(c.metres), method: LENGTH_METHOD + partsNote },
      elevation: e
        ? {
            gain: Math.round(e.gain),
            loss: Math.round(e.loss),
            min: Math.round(e.min),
            max: Math.round(e.max),
            method:
              `Unmap Elevation API (GET /elevation) at ${e.samples} points every ${Math.round(e.interval)} m along the main part (${km(mainMetres)}), ` +
              `the spacing the registry's elevation profile uses (max(30 m, length / 499)). Gain and loss are summed between consecutive samples with no smoothing.` +
              (e.demSource ? ` DEM: ${e.demSource}${e.datum ? `, datum ${e.datum}` : ""}.` : ""),
          }
        : null,
      elevationNote: e ? null : opts.elevationNote,
      difficulty: rating
        ? { value: rating.en, valueFr: rating.fr, level: codeOf(info(ctx.fields.difficulty!), rated!), source: `${ctx.source}, field "${label(ctx.fields.difficulty!)}"` }
        : null,
      difficultyNote:
        difficultyValues.length === 1
          ? null
          : ranked
            ? `The source rates this trail's segments ${difficultyValues.map((v) => bilingual(v).en).join(", ")}; the hardest is shown.`
          : ctx.fields.difficulty
            ? difficultyValues.length
              ? `The source rates this trail's segments differently (${difficultyValues.map((v) => bilingual(v).en).join(", ")}), so no single rating is shown.`
              : "The source has a difficulty field but leaves it empty for this trail."
            : "Not in source: the dataset carries no difficulty rating.",
      trailhead: {
        coordinates: main[0]!,
        method: opts.oriented
          ? "The start of the main part, oriented so the walk begins at its lower end (heights from Unmap Elevation). Not a surveyed trailhead or parking area."
          : "The start of the main part as the source orders it. Not a surveyed trailhead or parking area.",
      },
      published,
      moreInfo: urlEn || urlFr ? { en: urlEn, fr: urlFr } : null,
    },
  };
}

/** The sample positions the elevation step asks for, and the spacing, for the main part. */
export function elevationPlan(main: readonly LngLat[]): { points: LngLat[]; interval: number } {
  const samples = sampleLine(main);
  return { points: samples.map((s) => [s.lng, s.lat] as LngLat), interval: defaultInterval(lineLength(main)) };
}

/** Unique ids from names: a second "Lakeshore" gets its area, then a number. */
export function assignIds(chosen: readonly Candidate[]): string[] {
  const seen = new Set<string>();
  return chosen.map((c) => {
    let id = slugify(c.group.name);
    if (seen.has(id) && c.group.area) id = slugify(`${c.group.name} ${c.group.area}`);
    let n = 2;
    const base = id;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id);
    return id;
  });
}

/** Two data files are the same when only `retrievedAt` differs: nothing to commit. */
export function sameData(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/"retrievedAt":\s*"[^"]*"/g, '"retrievedAt":""');
  return strip(a) === strip(b);
}
