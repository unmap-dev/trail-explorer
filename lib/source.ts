/**
 * Reading the source dataset: the Open Government Portal's CKAN record for Parks Canada's
 * "Trails APCA" and the Esri REST service it points to. Pure functions only (the requests are made
 * by `scripts/fetch-trails.mjs`), so the decisions are unit-tested in test/source.test.ts:
 *
 *   - the licence must be the Open Government Licence - Canada, or nothing is fetched;
 *   - which of the record's resources is queried, and in what order the others are tried;
 *   - which of the layer's fields carries the name, the area, a difficulty rating, and so on,
 *     worked out from the fields the service reports rather than assumed.
 *
 * No imports, so Node can run it with type stripping alongside lib/geo.ts.
 */

/** The dataset: Parks Canada, Trails APCA, on the Open Government Portal. */
export const DATASET_ID = "64a90e8d-5bc0-4027-8645-b5881b4068d4";
export const DATASET_URL = `https://open.canada.ca/data/en/dataset/${DATASET_ID}`;
/**
 * The same CKAN record at each path the portal answers on, tried in order. The portal's firewall
 * has rejected one path from GitHub runners ("Request Rejected", HTML), so one path is not enough.
 */
export const CKAN_URLS = [
  `https://open.canada.ca/data/en/api/3/action/package_show?id=${DATASET_ID}`,
  `https://open.canada.ca/data/api/3/action/package_show?id=${DATASET_ID}`,
  `https://open.canada.ca/data/api/action/package_show?id=${DATASET_ID}`,
];

/** CKAN's id for the Open Government Licence - Canada on open.canada.ca. */
export const OGL_LICENCE_ID = "ca-ogl-lgo";

/** The attribution the OGL - Canada asks for, in the repository's own wording (apps/gateway/src/sources.ts). */
export const ATTRIBUTION = "Contains information licensed under the Open Government Licence - Canada. Source: Parks Canada, Trails APCA.";

/** Banff and Lake Louise, with the edges of Yoho and Kootenay: [west, south, east, north]. */
export const ENVELOPE: [number, number, number, number] = [-116.6, 50.9, -115.5, 51.8];

export interface CkanResource {
  name?: string;
  url?: string;
  format?: string;
  language?: string[] | string;
  resource_type?: string;
}

export interface CkanPackage {
  title?: string;
  license_id?: string;
  license_title?: string;
  license_url?: string;
  organization?: { title?: string };
  resources?: CkanResource[];
}

export interface Licence {
  id: string;
  title: string;
  url: string;
}

/**
 * The record's licence when it is the OGL - Canada; otherwise an error that says what it is
 * instead. Redistribution has to be verified before anything is fetched (spec §16), and this is
 * where it is.
 */
export function checkLicence(pkg: CkanPackage): Licence {
  if (pkg.license_id !== OGL_LICENCE_ID) {
    throw new Error(
      `The dataset's licence is "${pkg.license_title ?? "unknown"}" (license_id "${pkg.license_id ?? "none"}"), not the Open Government Licence - Canada ("${OGL_LICENCE_ID}"). ` +
        "Its redistribution terms have to be checked by a person before this app ships it, so nothing was fetched.",
    );
  }
  return { id: pkg.license_id, title: pkg.license_title?.trim() || "Open Government Licence - Canada", url: pkg.license_url?.trim() || "https://open.canada.ca/en/open-government-licence-canada" };
}

export interface Candidate {
  kind: "esri" | "geojson";
  url: string;
  name: string;
}

const ESRI = /\/(FeatureServer|MapServer)(\/\d+)?\/?$/i;

/**
 * The record's resources worth querying, best first: Esri FeatureServer, then MapServer (both
 * queryable by envelope), then any GeoJSON download (filtered to the envelope after download).
 * English-language resources before French ones of the same kind; the data is the same. A
 * resource the record names as deprecated comes after every current one.
 */
export function candidates(pkg: CkanPackage): Candidate[] {
  const out: (Candidate & { rank: number })[] = [];
  for (const r of pkg.resources ?? []) {
    const url = r.url?.trim();
    if (!url || !/^https:\/\//i.test(url)) continue;
    const format = (r.format ?? "").toLowerCase();
    const langs = Array.isArray(r.language) ? r.language : r.language ? [r.language] : [];
    const english = langs.length === 0 || langs.includes("en") ? 0 : 1;
    const name = r.name ?? url;
    const retired = /deprecated|obsol[eè]te/i.test(name) ? 100 : 0;
    if (ESRI.test(url.split("?")[0]!) || format.includes("esri rest")) {
      const feature = /FeatureServer/i.test(url) ? 0 : 1;
      out.push({ kind: "esri", url: url.split("?")[0]!.replace(/\/+$/, ""), name, rank: retired + feature * 2 + english });
    } else if (format.includes("geojson") || /\.geojson(\?|$)/i.test(url)) {
      out.push({ kind: "geojson", url, name, rank: retired + 10 + english });
    }
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.rank - b.rank)
    .filter((c) => !seen.has(c.url) && seen.add(c.url))
    .map(({ kind, url, name }) => ({ kind, url, name }));
}

/** Whether an Esri URL already names one layer (`…/FeatureServer/0`). */
export function isLayerUrl(url: string): boolean {
  return /\/(FeatureServer|MapServer)\/\d+$/i.test(url);
}

export interface EsriField {
  name: string;
  alias?: string;
  type?: string;
  domain?: { type?: string; codedValues?: { code: unknown; name: string }[] } | null;
}

/** What each role is read from. Null when the layer has no such field. */
export interface FieldMap {
  /** The trail's name. Falls back to an alternative-name field, then the trail system. */
  name: string | null;
  nameFr: string | null;
  /** Trail system or network: groups segments when there is no name. */
  system: string | null;
  /** National park or field unit. */
  area: string | null;
  /**
   * An official difficulty rating: a field named for difficulty, or a coded field whose published
   * values are difficulty ratings (Easy … Difficult), summer before winter. Never a slope profile.
   */
  difficulty: string | null;
  urlEn: string | null;
  urlFr: string | null;
  objectId: string | null;
  /**
   * A coded field naming each feature's activity, when the layer has one with a Hiking value. A
   * layer that repeats a path once per activity (hiking, horseback, skiing) is read for hiking only.
   */
  activity: { field: string; hiking: unknown } | null;
  /**
   * Other descriptive fields shown as published (surface, width, slope, obstacles, structures,
   * accessibility). Winter fields and codes the source gives no meaning for ("Type 2") are left out.
   */
  published: string[];
}

const label = (f: EsriField) => `${f.name} ${f.alias ?? ""}`;
const textual = (f: EsriField) => !f.type || /string|integer|smallinteger|double/i.test(f.type) || !!f.domain;

function find(fields: EsriField[], include: RegExp, exclude?: RegExp): string | null {
  const hit = fields.find((f) => textual(f) && include.test(label(f)) && !(exclude && exclude.test(label(f))));
  return hit?.name ?? null;
}

const codedNames = (f: EsriField) => (f.domain?.type === "codedValue" ? (f.domain.codedValues ?? []).map((c) => c.name) : []);
const WINTER = /winter|hiver/i;

/** A coded field whose values are difficulty ratings (Easy and Difficult among them), summer first. */
function ratingField(fields: EsriField[]): string | null {
  const ratings = fields.filter((f) => {
    const names = codedNames(f).join(" | ");
    return /\beasy\b|\bfacile\b/i.test(names) && /\bdifficult\b|\bdifficile\b/i.test(names);
  });
  return (ratings.find((f) => /summer|[ée]t[ée]/i.test(label(f))) ?? ratings.find((f) => !WINTER.test(label(f))))?.name ?? null;
}

/** The coded field whose values include Hiking, and the code that means it. */
function activityField(fields: EsriField[]): { field: string; hiking: unknown } | null {
  for (const f of fields) {
    if (f.domain?.type !== "codedValue" || !/activit/i.test(label(f))) continue;
    const hiking = f.domain.codedValues?.find((c) => /^\s*hiking\b|^\s*randonn[ée]e\b/i.test(c.name));
    if (hiking) return { field: f.name, hiking: hiking.code };
  }
  return null;
}

/** A coded field whose every value is only a number ("Type 1" … "Type 4"): the source says no more. */
const meaningless = (f: EsriField) => {
  const names = codedNames(f);
  return names.length > 0 && names.every((n) => /^type\s*\d+$/i.test(n.trim()));
};

/**
 * Which field plays which role, from the names and aliases the layer reports. `overrides` (the
 * TRAILS_*_FIELD environment variables) win when they name a field that exists.
 */
export function detectFields(fields: EsriField[], overrides: Partial<Record<"name" | "nameFr" | "area" | "difficulty" | "system", string>> = {}): FieldMap {
  const has = (n?: string) => (n && fields.some((f) => f.name === n) ? n : null);
  const objectId = fields.find((f) => /oid/i.test(f.type ?? ""))?.name ?? find(fields, /^objectid$/i);
  const altName = find(fields, /alt[_ ]?names?|noms?[_ ]?alt/i);
  const system = has(overrides.system) ?? find(fields, /trail[_ ]?system|r[ée]seau/i);
  const primary = has(overrides.name) ?? find(fields, /(^|[_ ])(trail[_ ]?)?name(_e|_en|_eng)?(?![a-z])|^name/i, /alt|system|r[ée]seau|park|parc|unit|url|_fr?(?![a-z])/i);
  const nameFr = has(overrides.nameFr) ?? find(fields, /(^|[_ ])nom(_fr?)?(?![a-z])|nom[_ ]?(du[_ ]?)?sentier|name_fr?(?![a-z])/i, /alt|system|r[ée]seau|park|parc|unit|url/i);
  const area = has(overrides.area) ?? find(fields, /park|parc|unit[_ ]?name|field[_ ]?unit|unit[_ ]?de/i, /url|id$/i);
  const difficulty = has(overrides.difficulty) ?? find(fields, /difficult|niveau[_ ]?de[_ ]?difficult/i) ?? ratingField(fields);
  const urlEn = find(fields, /^url(_e|_en)?$/i) ?? find(fields, /url.*_en?(?![a-z])/i);
  const urlFr = find(fields, /^url_f(r)?$/i) ?? find(fields, /url.*_fr?(?![a-z])/i);
  const activity = activityField(fields);
  const used = new Set([objectId, altName, system, primary, nameFr, area, difficulty, urlEn, urlFr, activity?.field].filter(Boolean));
  const published = fields
    .filter(
      (f) =>
        !used.has(f.name) &&
        /surface|width|largeur|profile|pente|slope|obstacle|accessib|section|type|season|saison/i.test(label(f)) &&
        !/shape|geom|length|longueur|oid|globalid/i.test(f.name) &&
        !WINTER.test(label(f)) &&
        !meaningless(f) &&
        !ratingField([f]),
    )
    .map((f) => f.name);
  return { name: primary ?? altName ?? system, nameFr: primary && nameFr !== primary ? nameFr : null, system, area, difficulty, urlEn, urlFr, objectId, activity, published };
}

/**
 * A published label in its two languages. Parks Canada writes bilingual coded values as
 * `English//Français`; a label without that separator is the same in both.
 */
export function bilingual(text: string): { en: string; fr: string } {
  const [en, fr] = text.split(/\s*\/\/\s*/, 2).map((part) => part.trim());
  return { en: en || text.trim(), fr: fr || en || text.trim() };
}

/** Where a coded value sits in its field's published scale (its code when numeric), or null. */
export function codeOf(field: EsriField | undefined, value: string): number | null {
  const coded = field?.domain?.type === "codedValue" ? field.domain.codedValues?.find((c) => c.name.trim() === value) : undefined;
  return coded && typeof coded.code === "number" && Number.isFinite(coded.code) ? coded.code : null;
}

/** A field's value as published: a coded value's label, a trimmed string, a number as text. */
export function readValue(field: EsriField | undefined, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const coded = field?.domain?.type === "codedValue" ? field.domain.codedValues?.find((c) => c.code === raw) : undefined;
  const value = coded ? coded.name : raw;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") return value.trim() || null;
  return null;
}

/** The ArcGIS query URL for the ids of every feature that touches the envelope. */
export function idsQuery(layerUrl: string, envelope = ENVELOPE): string {
  const q = new URLSearchParams({
    where: "1=1",
    geometry: envelope.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnIdsOnly: "true",
    f: "json",
  });
  return `${layerUrl}/query?${q}`;
}

/** The ArcGIS query URL for some features by id, with every field, in WGS84, as GeoJSON or Esri JSON. */
export function featuresQuery(layerUrl: string, ids: readonly number[], format: "geojson" | "json" = "geojson"): string {
  const q = new URLSearchParams({ objectIds: ids.join(","), outFields: "*", outSR: "4326", returnGeometry: "true", f: format });
  return `${layerUrl}/query?${q}`;
}

/** An ArcGIS error envelope (`{ error: { code, message } }`, often with HTTP 200) as text, or null. */
export function esriError(body: unknown): string | null {
  const e = body && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error : undefined;
  if (!e) return null;
  return `ArcGIS error ${String(e.code ?? "")}: ${String(e.message ?? "unknown")}${Array.isArray(e.details) && e.details.length ? ` (${e.details.join("; ")})` : ""}`;
}

export interface SourceFeature {
  properties: Record<string, unknown>;
  /** Each path of the polyline, [lng, lat] in WGS84. */
  paths: [number, number][][];
}

/** A GeoJSON feature or an Esri JSON polyline feature as properties and paths; null for anything else. */
export function toSourceFeature(f: unknown): SourceFeature | null {
  if (!f || typeof f !== "object") return null;
  const o = f as { properties?: unknown; attributes?: unknown; geometry?: { type?: string; coordinates?: unknown; paths?: unknown } | null };
  const properties = (o.properties ?? o.attributes ?? {}) as Record<string, unknown>;
  const g = o.geometry;
  let raw: unknown;
  if (g?.type === "LineString") raw = [g.coordinates];
  else if (g?.type === "MultiLineString") raw = g.coordinates;
  else if (g && Array.isArray(g.paths)) raw = g.paths;
  if (!Array.isArray(raw)) return null;
  const paths = raw
    .filter(Array.isArray)
    .map((path: unknown[]) => path.filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90).map((p) => [p[0], p[1]] as [number, number]))
    .filter((p) => p.length >= 2);
  return paths.length ? { properties, paths } : null;
}

/** Whether any vertex of a feature falls inside the envelope (for a downloaded file). */
export function touchesEnvelope(f: SourceFeature, envelope = ENVELOPE): boolean {
  return f.paths.some((path) => path.some(([lng, lat]) => lng >= envelope[0] && lng <= envelope[2] && lat >= envelope[1] && lat <= envelope[3]));
}
