/**
 * SYNTHETIC TEST FIXTURES for lib/source.ts and lib/curate.ts: invented names, field lists and
 * geometry shaped like an Esri layer's answer. Not Parks Canada data and not real trails. Never
 * imported by app code or by scripts/fetch-trails.mjs.
 */
import type { EsriField, SourceFeature } from "../../lib/source";

/** A field list in the shape the research saw on Trails APCA (OBJECTID, Noms_Alt_Names, URL_f, …) plus a name. */
export const FIELDS: EsriField[] = [
  { name: "OBJECTID", type: "esriFieldTypeOID" },
  { name: "Trail_Name_Nom_du_sentier", alias: "Trail Name / Nom du sentier", type: "esriFieldTypeString" },
  { name: "Noms_Alt_Names", alias: "Noms alternatifs / Alternative names", type: "esriFieldTypeString" },
  { name: "Park_Parc", alias: "Park / Parc", type: "esriFieldTypeString" },
  { name: "Accessible", type: "esriFieldTypeString" },
  { name: "Width_Largeur_m", alias: "Width / Largeur (m)", type: "esriFieldTypeDouble" },
  { name: "Surface", type: "esriFieldTypeString", domain: { type: "codedValue", codedValues: [{ code: 1, name: "Gravel / Gravier" }, { code: 2, name: "Natural / Naturel" }] } },
  { name: "Profile_Pente", alias: "Profile / Pente", type: "esriFieldTypeString" },
  { name: "Section_Type", type: "esriFieldTypeString" },
  { name: "URL_e", type: "esriFieldTypeString" },
  { name: "URL_f", type: "esriFieldTypeString" },
  { name: "Trail_system_reseau_de_sentiers", type: "esriFieldTypeString" },
  { name: "Shape__Length", type: "esriFieldTypeDouble" },
];

/** A straight synthetic segment from `a` to `b` with `n` vertices. */
export function segment(a: [number, number], b: [number, number], n = 5): [number, number][] {
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)] as [number, number]);
}

let oid = 0;
const props = (name: string | null, extra: Record<string, unknown> = {}) => ({
  OBJECTID: ++oid,
  Trail_Name_Nom_du_sentier: name,
  Park_Parc: "Synthetic Park",
  Surface: 1,
  Accessible: "No",
  URL_e: name ? "https://example.invalid/en" : null,
  URL_f: name ? "https://example.invalid/fr" : null,
  ...extra,
});

// "Synthetic Lake Agnes Test Trail": three pieces, the middle one drawn backwards, ends meeting
// within a few metres; about 3.4 km together. Matches the "lake agnes" preference.
const A1 = segment([-116.2, 51.42], [-116.21, 51.425]);
const A2 = segment([-116.2201, 51.43], [-116.21, 51.42501]);
const A3 = segment([-116.2201, 51.43], [-116.23, 51.435]);

export const SEGMENTS: SourceFeature[] = [
  { properties: props("Synthetic Lake Agnes Test Trail"), paths: [A1] },
  { properties: props("Synthetic Lake Agnes Test Trail", { Surface: 2 }), paths: [A2] },
  { properties: props("Synthetic Lake Agnes Test Trail"), paths: [A3] },
  // Unnamed: left out.
  { properties: props(null), paths: [segment([-116.0, 51.3], [-116.01, 51.31])] },
  // Too short (about 0.3 km).
  { properties: props("Synthetic Short Viewpoint"), paths: [segment([-115.9, 51.2], [-115.902, 51.202])] },
  // A road, by name.
  { properties: props("Synthetic Parkway Connector"), paths: [segment([-115.8, 51.2], [-115.85, 51.25])] },
  // Two parts 1 km apart: kept, as a MultiLineString with the longer part first.
  { properties: props("Synthetic Gap Test Trail"), paths: [segment([-115.7, 51.3], [-115.71, 51.31])] },
  { properties: props("Synthetic Gap Test Trail"), paths: [segment([-115.7, 51.32], [-115.73, 51.34])] },
];
