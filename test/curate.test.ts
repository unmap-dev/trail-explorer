import { describe, expect, it } from "vitest";
import { assignIds, candidatesFrom, elevationPlan, groupSegments, hikingFeatures, MIN_PART_M, normalizeName, orientMain, PREFERRED, sameData, selectTrails, slugify, trailFeature, type Candidate } from "@/lib/curate";
import { lineLength } from "@/lib/geo";
import { ATTRIBUTION, detectFields } from "@/lib/source";
import { parseTrails } from "@/lib/trails";
import { FIELDS, SEGMENTS, segment } from "./fixtures/synthetic-source";
import type { EsriField, SourceFeature } from "@/lib/source";

const fields = detectFields(FIELDS);
const ctx = { source: "Parks Canada, Trails APCA", licence: "Open Government Licence - Canada", attribution: ATTRIBUTION, sourceUrl: "https://example.invalid/dataset", retrievedAt: "2026-10-12T00:00:00.000Z", fields, fieldInfo: FIELDS };

describe("from segments to trails", () => {
  const groups = groupSegments(SEGMENTS, fields, FIELDS);
  const { kept, dropped } = candidatesFrom(groups);

  it("groups by published name and leaves unnamed segments out", () => {
    expect(groups.map((g) => g.name).sort()).toEqual(["Synthetic Gap Test Trail", "Synthetic Lake Agnes Test Trail", "Synthetic Parkway Connector", "Synthetic Short Viewpoint"]);
    expect(groups.find((g) => g.name.includes("Agnes"))!.objectIds).toEqual([1, 2, 3]);
  });

  it("keeps day hikes only, and says why the others were dropped", () => {
    expect(kept.map((c) => c.group.name).sort()).toEqual(["Synthetic Gap Test Trail", "Synthetic Lake Agnes Test Trail"]);
    expect(dropped).toEqual([
      { name: "Synthetic Short Viewpoint", reason: "shorter than 1.5 km" },
      { name: "Synthetic Parkway Connector", reason: "named as a road, parkway, parking area or connector" },
    ]);
  });

  it("joins a trail's pieces into one line and keeps parts that do not meet apart", () => {
    const agnes = kept.find((c) => c.group.name.includes("Agnes"))!;
    expect(agnes.lines).toHaveLength(1);
    expect(agnes.mainShare).toBe(1);
    const gap = kept.find((c) => c.group.name.includes("Gap"))!;
    expect(gap.lines).toHaveLength(2);
    expect(lineLength(gap.lines[0]!)).toBeGreaterThan(lineLength(gap.lines[1]!));
  });

  it("chooses preferred names first, then the most continuous", () => {
    expect(selectTrails(kept).map((c) => c.group.name)).toEqual(["Synthetic Lake Agnes Test Trail", "Synthetic Gap Test Trail"]);
    expect(PREFERRED).toContain("lake agnes");
  });

  it("never ships more than 20", () => {
    const many: Candidate[] = Array.from({ length: 30 }, (_, i) => ({ ...kept[0]!, group: { ...kept[0]!.group, name: `T${i}` }, preference: Infinity }));
    expect(selectTrails(many)).toHaveLength(20);
  });

  it("writes features that the app's own validator accepts, with every number's method and no invented rating", () => {
    const chosen = selectTrails(kept);
    const ids = assignIds(chosen);
    const features = chosen.map((c, i) => trailFeature(c, ctx, { id: ids[i]!, oriented: false, elevation: null, elevationNote: "Not sampled: no key." }));
    const { trails } = parseTrails({ type: "FeatureCollection", _provenance: { licence: ctx.licence, attribution: ATTRIBUTION }, features });
    expect(trails.map((t) => t.id)).toEqual(["synthetic-lake-agnes-test-trail", "synthetic-gap-test-trail"]);
    const agnes = trails[0]!;
    expect(agnes.difficulty).toBeNull();
    expect(agnes.difficultyNote).toMatch(/^Not in source/);
    expect(agnes.elevation).toBeNull();
    expect(agnes.elevationNote).toBe("Not sampled: no key.");
    expect(agnes.length.method).toMatch(/haversine/);
    expect(agnes.trailhead.coordinates).toEqual(agnes.lines[0]![0]);
    expect(agnes.trailhead.method).toMatch(/as the source orders it/);
    expect(agnes.published).toEqual({ Accessible: { en: ["No"], fr: ["No"] }, Surface: { en: ["Gravel / Gravier", "Natural / Naturel"], fr: ["Gravel / Gravier", "Natural / Naturel"] } });
    expect(features[0]!.properties.sourceFeatures).toBe(3);
    expect(agnes.moreInfo).toEqual({ en: "https://example.invalid/en", fr: "https://example.invalid/fr" });
    expect(agnes.attribution).toBe(ATTRIBUTION);
    expect(trails[1]!.length.method).toMatch(/published in 2 parts/);
  });

  it("records a rating only when the source has one, as published", () => {
    const rated = SEGMENTS.slice(0, 3).map((s) => ({ ...s, properties: { ...s.properties, Difficulty: "Moderate" } }));
    const withField = [...FIELDS, { name: "Difficulty", type: "esriFieldTypeString" }];
    const f = detectFields(withField);
    const [c] = candidatesFrom(groupSegments(rated, f, withField)).kept;
    const feature = trailFeature(c!, { ...ctx, fields: f, fieldInfo: withField }, { id: "x", oriented: false, elevation: null, elevationNote: null });
    expect(feature.properties.difficulty).toEqual({ value: "Moderate", valueFr: "Moderate", level: null, source: 'Parks Canada, Trails APCA, field "Difficulty"' });
  });

  // A coded, bilingual rating like Trails APCA's Summer_Classification_Été.
  const RATING: EsriField = { name: "Summer_Classification_Été", type: "esriFieldTypeSmallInteger", domain: { type: "codedValue", codedValues: [{ code: 1, name: "Easy//Facile" }, { code: 2, name: "Moderate//Modéré" }, { code: 3, name: "Difficult//Difficile" }] } };
  const rate = (codes: number[]) => {
    const withRating = [...FIELDS, RATING];
    const f = detectFields(withRating);
    const rated = SEGMENTS.slice(0, 3).map((s, i) => ({ ...s, properties: { ...s.properties, Summer_Classification_Été: codes[i] } }));
    const [c] = candidatesFrom(groupSegments(rated, f, withRating)).kept;
    return trailFeature(c!, { ...ctx, fields: f, fieldInfo: withRating }, { id: "x", oriented: false, elevation: null, elevationNote: null }).properties;
  };

  it("records a coded rating in both languages with its place on the scale", () => {
    const p = rate([2, 2, 2]);
    expect(p.difficulty).toEqual({ value: "Moderate", valueFr: "Modéré", level: 2, source: 'Parks Canada, Trails APCA, field "Summer_Classification_Été"' });
    expect(p.difficultyNote).toBeNull();
  });

  it("shows the hardest rating when segments differ on a numbered scale, and says so", () => {
    const p = rate([1, 2, 1]);
    expect(p.difficulty).toMatchObject({ value: "Moderate", level: 2 });
    expect(p.difficultyNote).toBe("The source rates this trail's segments Easy, Moderate; the hardest is shown.");
  });
});

describe("reading the current layer", () => {
  const activity = { field: "General_Activity", hiking: 100 };
  const withActivity = { ...detectFields(FIELDS), activity };
  const path = segment([-116.2, 51.42], [-116.21, 51.425]);
  const feature = (code: number, paths = [path]): SourceFeature => ({ properties: { Trail_Name_Nom_du_sentier: "Synthetic Repeated Trail", General_Activity: code }, paths });

  it("reads hiking features only, each path once, when the layer repeats a path per activity", () => {
    const got = hikingFeatures([feature(100), feature(1300), feature(1600), feature(100)], withActivity);
    expect(got).toHaveLength(1);
    expect(got[0]!.properties.General_Activity).toBe(100);
  });

  it("keeps every feature of a layer with no activity field, still each path once", () => {
    expect(hikingFeatures([feature(1300), feature(1300), feature(1300, [segment([-116, 51], [-116.1, 51.1])])], detectFields(FIELDS))).toHaveLength(2);
  });

  it("leaves out digitising slivers but keeps real parts that do not meet", () => {
    const fields = detectFields(FIELDS);
    const sliver = segment([-115.5, 51.5], [-115.50001, 51.50001], 2);
    const gap = SEGMENTS.filter((s) => s.properties.Trail_Name_Nom_du_sentier === "Synthetic Gap Test Trail");
    const [c] = candidatesFrom(groupSegments([...gap, { properties: gap[0]!.properties, paths: [sliver] }], fields, FIELDS)).kept;
    expect(lineLength(sliver)).toBeLessThan(MIN_PART_M);
    expect(c!.lines).toHaveLength(2);
  });
});

describe("elevation and orientation", () => {
  it("starts the walk at the lower end, and says how", () => {
    const lines = [[[0, 0], [1, 1]] as [number, number][]];
    expect(orientMain(lines, [1800, 1400]).lines[0]![0]).toEqual([1, 1]);
    expect(orientMain(lines, [1400, 1800]).lines[0]![0]).toEqual([0, 0]);
    expect(orientMain(lines, null).oriented).toBe(false);
  });

  it("plans at most one request of samples for a day hike, the profile's spacing", () => {
    const main = SEGMENTS.slice(0, 1)[0]!.paths[0]!;
    const plan = elevationPlan(main);
    expect(plan.points.length).toBeLessThanOrEqual(500);
    expect(plan.interval).toBeGreaterThanOrEqual(30);
  });
});

describe("names and ids", () => {
  it("compares names without accents or punctuation, and makes stable ids", () => {
    expect(normalizeName("Lac-Agnès  (Trail)")).toBe("lac agnes trail");
    expect(slugify("C-Level Cirque")).toBe("c-level-cirque");
  });

  it("only the retrieval time changing is no change", () => {
    expect(sameData('{"retrievedAt":"2026-01-01","a":1}', '{"retrievedAt": "2026-02-02","a":1}')).toBe(true);
    expect(sameData('{"retrievedAt":"2026-01-01","a":1}', '{"retrievedAt":"2026-01-01","a":2}')).toBe(false);
  });
});
