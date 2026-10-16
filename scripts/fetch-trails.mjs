#!/usr/bin/env node
/**
 * Fetch the trail collection this app ships: data/trails.geojson, from Parks Canada's "Trails
 * APCA" dataset on the Open Government Portal. No dependencies; Node 22.18+ (type stripping runs
 * the pure helpers in lib/ directly).
 *
 *   node scripts/fetch-trails.mjs                      # from apps/trail-explorer, or from the repo root
 *   UNMAP_API_KEY=um_live_… node scripts/fetch-trails.mjs   # also measure climb with Unmap Elevation
 *
 * What it does, in order, and stops at the first step that fails:
 *
 *   1. Reads the dataset's CKAN record and REQUIRES its licence to be the Open Government Licence
 *      - Canada (license_id "ca-ogl-lgo"). Anything else stops the run: redistribution has to be
 *      verified by a person first (spec §16).
 *   2. Finds the record's Esri REST service (FeatureServer first, then MapServer, then a GeoJSON
 *      download) and asks it for every segment touching the Banff / Lake Louise envelope, in WGS84,
 *      by object id in pages, so the service's record limit cannot truncate the answer.
 *   3. Works out from the layer's own field list which field is the name, the park, a difficulty
 *      rating, the links (lib/source.ts detectFields; TRAILS_NAME_FIELD, TRAILS_NAME_FR_FIELD,
 *      TRAILS_AREA_FIELD, TRAILS_DIFFICULTY_FIELD and TRAILS_SYSTEM_FIELD override it), groups
 *      segments by name, joins them into continuous lines without editing a vertex, keeps day-hike
 *      lengths and chooses up to 20 (lib/curate.ts).
 *   4. With UNMAP_API_KEY set, samples each trail's main part with the Unmap Elevation API exactly
 *      as the app's elevation profile will, and records gain, loss, lowest and highest. Without a
 *      key those stay null and the file says why.
 *   5. Writes data/trails.geojson and the trail table in DATA_SOURCES.md, unless nothing but the
 *      retrieval time changed.
 *
 * It never invents a trail, a name, a rating or a coordinate. Run it from a developer's machine:
 * some sandboxes cannot reach open.canada.ca at all.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JOIN_TOLERANCE_M, climb, lineLength } from "../lib/geo.ts";
import {
  ATTRIBUTION,
  CKAN_URLS,
  DATASET_URL,
  ENVELOPE,
  candidates as resourceCandidates,
  checkLicence,
  detectFields,
  esriError,
  featuresQuery,
  idsQuery,
  isLayerUrl,
  toSourceFeature,
  touchesEnvelope,
} from "../lib/source.ts";
import {
  LENGTH_METHOD,
  MAX_DAY_HIKE_M,
  MAX_TRAILS,
  MIN_DAY_HIKE_M,
  MIN_TRAILS,
  assignIds,
  candidatesFrom,
  elevationPlan,
  groupSegments,
  hikingFeatures,
  orientMain,
  sameData,
  selectTrails,
  trailFeature,
} from "../lib/curate.ts";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(app, "data", "trails.geojson");
const DOC = join(app, "DATA_SOURCES.md");
const GATEWAY = (process.env.UNMAP_GATEWAY || "https://api.unmap.dev").replace(/\/+$/, "");
const KEY = process.env.UNMAP_API_KEY?.trim() || "";
const PAGE = 250;
const ELEVATION_CHUNK = 500;
// The plain form first; government firewalls in front of open data sometimes refuse anything that
// does not look like a browser, so the CKAN record is retried with the browser-compatible form.
// Neither may contain "unmap": open.canada.ca's firewall rejects any user agent containing "nmap"
// (the port scanner) with an HTML "Request Rejected" page, and "unmap" contains it.
const UA = "trail-explorer/1.0";
const BROWSER_UA = "Mozilla/5.0 (compatible; trail-explorer/1.0)";

const log = (...a) => console.log(...a);

class FetchFailure extends Error {}

async function getJson(url, { what, redactKey = false, ua = UA } = {}) {
  const shown = redactKey ? url.replace(/key=[^&]+/, "key=***") : url;
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, { headers: { accept: "application/json", "user-agent": ua }, signal: AbortSignal.timeout(90_000) });
    } catch (error) {
      const cause = error?.cause?.code || error?.cause?.message || error?.message || String(error);
      throw new FetchFailure(
        `Could not reach ${new URL(url).host} for ${what} (${cause}).\n` +
          `This script needs outbound HTTPS to open.canada.ca, the dataset's ArcGIS service and, with a key, api.unmap.dev. ` +
          `Run it from a machine that can reach them. Nothing was written.`,
      );
    }
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const wait = Math.min(30, Number(res.headers.get("retry-after")) || attempt * 5);
      log(`  ${res.status} from ${new URL(url).host}; waiting ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    break;
  }
  const text = await res.text();
  if (!res.ok) throw new FetchFailure(`${what}: HTTP ${res.status} from ${shown}\n${text.slice(0, 500)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FetchFailure(`${what}: ${shown} did not answer JSON:\n${text.slice(0, 300)}`);
  }
  const esri = esriError(body);
  if (esri) throw new FetchFailure(`${what}: ${esri} (${shown})`);
  return body;
}

/** Every polyline segment touching the envelope from one Esri layer, with the layer's fields. */
async function fromEsriLayer(layerUrl) {
  const info = await getJson(`${layerUrl}?f=json`, { what: "the layer's description" });
  if (info.geometryType && !/polyline/i.test(info.geometryType)) throw new FetchFailure(`${layerUrl} holds ${info.geometryType}, not lines`);
  const fields = Array.isArray(info.fields) ? info.fields : [];
  const idsBody = await getJson(idsQuery(layerUrl), { what: "the ids of segments in the envelope" });
  const ids = (idsBody.objectIds ?? []).slice().sort((a, b) => a - b);
  log(`  ${info.name ?? layerUrl}: ${ids.length} segments touch the envelope; ${fields.length} fields`);
  const features = [];
  const size = Math.max(1, Math.min(PAGE, Number(info.maxRecordCount) || PAGE));
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    let body;
    try {
      body = await getJson(featuresQuery(layerUrl, chunk, "geojson"), { what: "segments as GeoJSON" });
    } catch (error) {
      if (!(error instanceof FetchFailure)) throw error;
      log(`  GeoJSON output refused (${error.message.split("\n")[0]}); asking for Esri JSON`);
      body = await getJson(featuresQuery(layerUrl, chunk, "json"), { what: "segments as Esri JSON" });
    }
    for (const f of body.features ?? []) {
      const s = toSourceFeature(f);
      if (s) features.push(s);
    }
  }
  if (features.length < ids.length) log(`  ${ids.length - features.length} segments had no usable line geometry and were skipped`);
  return { features, fields, layer: { name: info.name ?? null, url: layerUrl, copyrightText: info.copyrightText?.trim() || null } };
}

async function layersOf(serviceUrl) {
  if (isLayerUrl(serviceUrl)) return [serviceUrl];
  const info = await getJson(`${serviceUrl}?f=json`, { what: "the service's layer list" });
  const layers = (info.layers ?? []).filter((l) => !l.geometryType || /polyline/i.test(l.geometryType));
  return layers.map((l) => `${serviceUrl}/${l.id}`);
}

async function fromGeoJsonDownload(url) {
  const body = await getJson(url, { what: "the GeoJSON download" });
  const all = (body.features ?? []).map(toSourceFeature).filter(Boolean);
  const features = all.filter((f) => touchesEnvelope(f));
  const names = new Set();
  for (const f of features) for (const k of Object.keys(f.properties)) names.add(k);
  log(`  ${features.length} of ${all.length} features touch the envelope`);
  return { features, fields: [...names].map((name) => ({ name, type: "esriFieldTypeString" })), layer: { name: null, url, copyrightText: null } };
}

/** Heights for points, ≤500 per request (as the registry profile sends them), with the DEM's description. */
async function elevations(points) {
  const values = [];
  let meta = null;
  for (let i = 0; i < points.length; i += ELEVATION_CHUNK) {
    const chunk = points.slice(i, i + ELEVATION_CHUNK);
    const q = new URLSearchParams({ key: KEY });
    if (chunk.length === 1) q.set("near", `${chunk[0][0]},${chunk[0][1]}`);
    else q.set("points", chunk.map(([lng, lat]) => `${lng},${lat}`).join("|"));
    const body = await getJson(`${GATEWAY}/elevation?${q}`, { what: "elevation", redactKey: true });
    if (!Array.isArray(body.elevations) || body.elevations.length !== chunk.length) throw new FetchFailure("elevation: the answer does not have one height per point");
    values.push(...body.elevations);
    meta ??= { datum: typeof body.datum === "string" ? body.datum : null, source: typeof body.meta?.source === "string" ? body.meta.source : null, attribution: typeof body.meta?.attribution === "string" ? body.meta.attribution : null };
  }
  return { values, meta };
}

function table(features) {
  const rows = features.map((f) => {
    const p = f.properties;
    const e = p.elevation;
    return `| \`${p.id}\` | ${p.name} | ${p.area ?? "—"} | ${(p.length.metres / 1000).toFixed(1)} km | ${e ? `+${e.gain} m / −${e.loss} m` : "not sampled"} | ${p.difficulty ? p.difficulty.value : "not in source"} | ${p.sourceFeatures} |`;
  });
  return ["| id | Name (as published) | Area | Length | Climb (main part) | Difficulty | Source features |", "| --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

function writeDoc(features, provenance) {
  if (!existsSync(DOC)) return;
  const text = readFileSync(DOC, "utf8");
  const start = "<!-- trails-table:start -->";
  const end = "<!-- trails-table:end -->";
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) return log("DATA_SOURCES.md has no trails-table markers; the table was not written there");
  const body = `${start}\n_Written by \`scripts/fetch-trails.mjs\` from ${provenance.resource.url}, retrieved ${provenance.retrievedAt.slice(0, 10)}. ${features.length} trails._\n\n${table(features)}\n${end}`;
  writeFileSync(DOC, text.slice(0, a) + body + text.slice(b + end.length));
}

/** The CKAN record from the first path and user agent the portal answers with JSON. */
async function ckanRecord() {
  const refused = [];
  for (const url of CKAN_URLS) {
    for (const ua of [UA, BROWSER_UA]) {
      try {
        const record = await getJson(url, { what: "the dataset's CKAN record", ua });
        log(`   ${url}`);
        return record;
      } catch (error) {
        if (!(error instanceof FetchFailure)) throw error;
        const first = error.message.split("\n")[0];
        log(`   refused: ${url} as "${ua}": ${first}`);
        refused.push(`${url} as "${ua}"`);
      }
    }
  }
  throw new FetchFailure(`open.canada.ca answered none of: ${refused.join("; ")}. Nothing was written.`);
}

async function main() {
  const retrievedAt = new Date().toISOString();
  log("1. Licence: the dataset's CKAN record");
  const record = await ckanRecord();
  if (!record.success || !record.result) throw new FetchFailure("The CKAN API did not return the dataset record.");
  const pkg = record.result;
  const licence = checkLicence(pkg);
  log(`   ${licence.title} (${licence.id}) ${licence.url}`);

  log(`2. Source: ${(pkg.resources ?? []).length} resources on the record`);
  const options = resourceCandidates(pkg);
  if (!options.length) throw new FetchFailure(`The record lists no Esri REST service or GeoJSON download. Resources: ${(pkg.resources ?? []).map((r) => `${r.format} ${r.url}`).join("; ")}`);
  let got = null;
  const tried = [];
  for (const c of options) {
    log(` - trying ${c.kind} ${c.url}`);
    try {
      if (c.kind === "geojson") got = { ...(await fromGeoJsonDownload(c.url)), candidate: c };
      else {
        for (const layer of await layersOf(c.url)) {
          const r = await fromEsriLayer(layer);
          if (r.features.length) {
            got = { ...r, candidate: c };
            break;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof FetchFailure)) throw error;
      tried.push(`${c.url}: ${error.message.split("\n")[0]}`);
      log(`   failed: ${error.message.split("\n")[0]}`);
    }
    if (got?.features.length) break;
  }
  if (!got?.features.length) throw new FetchFailure(`No resource returned trail segments in the envelope.\n${tried.join("\n")}`);

  log("3. Fields:");
  for (const f of got.fields) log(`   ${f.name}${f.alias && f.alias !== f.name ? ` (${f.alias})` : ""} ${f.type ?? ""}${f.domain?.type === "codedValue" ? " [coded]" : ""}`);
  const env = process.env;
  const fields = detectFields(got.fields, { name: env.TRAILS_NAME_FIELD, nameFr: env.TRAILS_NAME_FR_FIELD, area: env.TRAILS_AREA_FIELD, difficulty: env.TRAILS_DIFFICULTY_FIELD, system: env.TRAILS_SYSTEM_FIELD });
  log(`   roles: ${JSON.stringify(fields)}`);
  if (!fields.name) throw new FetchFailure(`No field names the trails. Set TRAILS_NAME_FIELD to one of: ${got.fields.map((f) => f.name).join(", ")}`);
  for (const f of got.features.slice(0, 3)) log(`   sample: ${JSON.stringify(f.properties).slice(0, 400)}`);

  const hikes = hikingFeatures(got.features, fields);
  if (fields.activity) log(`   ${hikes.length} of ${got.features.length} features are hiking (field "${fields.activity.field}"), each path once`);
  const groups = groupSegments(hikes, fields, got.fields);
  const unnamed = hikes.length - groups.reduce((n, g) => n + g.features, 0);
  const { kept, dropped } = candidatesFrom(groups);
  const chosen = selectTrails(kept);
  log(`   ${hikes.length} segments → ${groups.length} named trails (${unnamed} unnamed segments left out) → ${kept.length} in day-hike range → ${chosen.length} chosen`);
  if (!chosen.length) throw new FetchFailure("No named trail in the envelope is a day hike by the rules in lib/curate.ts; nothing was written.");
  if (chosen.length < MIN_TRAILS) log(`   WARNING: only ${chosen.length} trails (the brief asks for about ${MIN_TRAILS}–${MAX_TRAILS})`);

  const publisher = pkg.organization?.title?.split("|")[0]?.trim() || "Parks Canada";
  const sourceName = `${publisher}, ${pkg.title?.trim() || "Trails APCA"}`;
  const ctx = { source: sourceName, licence: licence.title, attribution: ATTRIBUTION, sourceUrl: DATASET_URL, retrievedAt, fields, fieldInfo: got.fields };
  const ids = assignIds(chosen);
  const features = [];
  let demMeta = null;
  log(`4. Elevation: ${KEY ? `sampling with Unmap Elevation at ${GATEWAY}` : "UNMAP_API_KEY is not set; climb is left null"}`);
  for (const [i, c] of chosen.entries()) {
    let lines = c.lines;
    let oriented = false;
    let elevation = null;
    let elevationNote = KEY ? null : "Not sampled: the data was fetched without an Unmap API key. The live profile in the app measures it.";
    if (KEY) {
      try {
        const main = lines[0];
        const ends = await elevations([main[0], main[main.length - 1]]);
        ({ lines, oriented } = orientMain(lines, [ends.values[0], ends.values[1]]));
        const plan = elevationPlan(lines[0]);
        const { values, meta } = await elevations(plan.points);
        demMeta ??= meta;
        const stats = climb(values);
        if (stats) elevation = { ...stats, samples: plan.points.length, interval: plan.interval, datum: meta?.datum ?? null, demSource: meta?.source ?? null };
        else elevationNote = "The elevation data has no heights along this trail.";
      } catch (error) {
        if (!(error instanceof FetchFailure)) throw error;
        elevationNote = `Elevation sampling failed when the data was fetched (${error.message.split("\n")[0].slice(0, 160)}).`;
        log(`   ${c.group.name}: ${elevationNote}`);
      }
    }
    features.push(trailFeature({ ...c, lines }, ctx, { id: ids[i], oriented, elevation, elevationNote }));
    log(`   ${ids[i]}: ${c.group.name} · ${(c.metres / 1000).toFixed(1)} km in ${lines.length} part(s), main ${(lineLength(lines[0]) / 1000).toFixed(1)} km${elevation ? ` · +${Math.round(elevation.gain)} m` : ""}`);
  }

  const provenance = {
    dataset: pkg.title ?? "Trails APCA",
    publisher,
    datasetUrl: DATASET_URL,
    licence: licence.title,
    licenceId: licence.id,
    licenceUrl: licence.url,
    attribution: ATTRIBUTION,
    retrievedAt,
    resource: { kind: got.candidate.kind, name: got.candidate.name, url: got.layer.url, layer: got.layer.name, copyrightText: got.layer.copyrightText },
    envelope: ENVELOPE,
    fields: got.fields.map((f) => f.name),
    roles: fields,
    counts: { segments: got.features.length, hiking: hikes.length, unnamedSegments: unnamed, namedTrails: groups.length, dayHikes: kept.length, shipped: features.length },
    dropped: dropped.slice(0, 100),
    elevation: KEY ? { sampled: true, gateway: GATEWAY, datum: demMeta?.datum ?? null, source: demMeta?.source ?? null, attribution: demMeta?.attribution ?? null } : { sampled: false, note: "UNMAP_API_KEY was not set" },
    notes: [
      `Segments touching the envelope ${ENVELOPE.join(", ")} (west, south, east, north; WGS84) were fetched from the dataset's own service; geometry is kept as delivered, with no smoothing or simplification.`,
      `Segments are grouped into trails by their published name${fields.area ? " and area" : ""}; unnamed segments are left out. Each group's segments are joined end to end where their ends lie within ${JOIN_TOLERANCE_M} m.`,
      `Day hikes only: ${MIN_DAY_HIKE_M / 1000}–${MAX_DAY_HIKE_M / 1000} km in total, and not named as a road, parkway, parking area or connector. Up to ${MAX_TRAILS}: well-known day hikes in the area first (lib/curate.ts PREFERRED), then the most continuous.`,
      `Length: ${LENGTH_METHOD}`,
      KEY
        ? "Climb: the main part sampled with the Unmap Elevation API at the spacing the app's elevation profile uses, so the profile in the app shows the same numbers while the DEM release is unchanged."
        : "Climb: not sampled (no Unmap API key at fetch time); the app's live elevation profile measures it on demand.",
      fields.difficulty ? `Difficulty: as published in the source's "${fields.difficulty}" field.` : "Difficulty: the source carries no difficulty rating, so none is shown and the filter is hidden.",
      "Trail conditions, closures and seasonal restrictions are not part of this data.",
    ],
  };

  const text = `{"type":"FeatureCollection","_provenance":${JSON.stringify(provenance, null, 2)},"features":[\n${features.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;
  const previous = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  if (previous && sameData(previous, text)) {
    log("5. Unchanged apart from the retrieval time; nothing written.");
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    writeDoc(features, provenance);
    log(`5. Wrote ${OUT} (${(text.length / 1024).toFixed(0)} KB) and the table in DATA_SOURCES.md`);
  }

  const summary = [
    `### Trails data`,
    ``,
    `**${features.length} trails** from [${provenance.dataset}](${DATASET_URL}) (${provenance.publisher}), licence **${licence.title}** (\`${licence.id}\`).`,
    `Resource: ${provenance.resource.url}. Elevation: ${KEY ? "sampled with Unmap Elevation" : "not sampled (no key)"}. Difficulty field: ${fields.difficulty ?? "none in source"}.`,
    ``,
    table(features),
  ].join("\n");
  log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: "a" });
}

main().catch((error) => {
  console.error(`\nfetch-trails: ${error instanceof FetchFailure ? error.message : error?.stack || error}`);
  process.exit(1);
});
