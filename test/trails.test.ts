import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableFilters, filterTrails, NO_FILTERS } from "@/lib/filters";
import { parseTrails, profileLine, trailGeometry, TrailDataError } from "@/lib/trails";
import { parseTrail, writeTrail } from "@/lib/url";

// A SYNTHETIC test fixture: invented trails, never imported by app code.
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "synthetic-trails.geojson"), "utf8"));

describe("parseTrails", () => {
  it("reads a valid collection, provenance included", () => {
    const { trails, provenance } = parseTrails(fixture);
    expect(trails.map((t) => t.id)).toEqual(["synthetic-alpha", "synthetic-bravo", "synthetic-charlie", "synthetic-delta"]);
    expect(provenance.attribution).toMatch(/Synthetic/);
    const charlie = trails[2]!;
    expect(charlie.lines).toHaveLength(2);
    expect(trailGeometry(charlie).type).toBe("MultiLineString");
    expect(profileLine(charlie)).toBe(charlie.lines[0]);
    expect(charlie.elevation).toBeNull();
    expect(charlie.difficulty).toBeNull();
  });

  it("lists every problem in a bad file instead of guessing", () => {
    const bad = structuredClone(fixture);
    bad.features[0].properties.id = "Not An Id";
    bad.features[1].properties.length = { metres: 10 };
    bad.features[2].geometry = { type: "Point", coordinates: [0, 0] };
    bad.features[3].properties.id = "synthetic-bravo";
    bad.features[3].properties.difficulty = { value: "Easy" };
    delete bad._provenance.attribution;
    try {
      parseTrails(bad);
      throw new Error("expected a TrailDataError");
    } catch (error) {
      expect(error).toBeInstanceOf(TrailDataError);
      const problems = (error as TrailDataError).problems.join("\n");
      expect(problems).toMatch(/_provenance: licence and attribution/);
      expect(problems).toMatch(/feature 0: id must be/);
      expect(problems).toMatch(/feature 1: length/);
      expect(problems).toMatch(/feature 2: geometry/);
      expect(problems).toMatch(/feature 3: difficulty must be null/);
    }
    expect(() => parseTrails({ type: "Feature" })).toThrow(TrailDataError);
  });
});

describe("filters", () => {
  const { trails } = parseTrails(fixture);

  it("offers only what the data can answer", () => {
    expect(availableFilters(trails).gain).toBe(true);
    expect(availableFilters(trails).difficulties.map((d) => d.value)).toEqual(["Difficult", "Easy"]);
    const bare = trails.map((t) => ({ ...t, elevation: null, difficulty: null }));
    expect(availableFilters(bare)).toEqual({ gain: false, difficulties: [] });
  });

  it("searches names without accents and case", () => {
    expect(filterTrails(trails, { ...NO_FILTERS, query: "ALPHA" }).map((t) => t.id)).toEqual(["synthetic-alpha"]);
    expect(filterTrails(trails, { ...NO_FILTERS, query: "synthetique" }).map((t) => t.id)).toEqual(["synthetic-alpha"]);
    expect(filterTrails(trails, { ...NO_FILTERS, query: "other synthetic" }).map((t) => t.id)).toEqual(["synthetic-delta"]);
  });

  it("filters by distance, climb and difficulty, OR within a group and AND across", () => {
    const ids = (f: Partial<typeof NO_FILTERS>) => filterTrails(trails, { ...NO_FILTERS, ...f }).map((t) => t.id);
    expect(ids({ distance: ["short"] })).toEqual(["synthetic-alpha"]);
    expect(ids({ distance: ["medium"] })).toEqual(["synthetic-bravo", "synthetic-charlie"]);
    expect(ids({ distance: ["short", "long"] })).toEqual(["synthetic-alpha", "synthetic-delta"]);
    expect(ids({ gain: ["high"] })).toEqual(["synthetic-bravo"]);
    // Charlie has no measured climb: it never matches a climb bucket, not even the lowest.
    expect(ids({ gain: ["low", "mid", "high"] })).not.toContain("synthetic-charlie");
    expect(ids({ difficulty: ["Easy"], distance: ["long"] })).toEqual(["synthetic-delta"]);
    expect(ids({ difficulty: ["Easy"], distance: ["medium"] })).toEqual([]);
  });
});

describe("the shareable link", () => {
  it("reads and writes ?trail= and keeps other keys", () => {
    expect(parseTrail("?trail=lake-agnes&lang=fr")).toBe("lake-agnes");
    expect(parseTrail("?trail=<script>")).toBeNull();
    expect(writeTrail("?lang=fr", "lake-agnes")).toBe("?lang=fr&trail=lake-agnes");
    expect(writeTrail("?lang=fr&trail=lake-agnes", null)).toBe("?lang=fr");
    expect(writeTrail("", null)).toBe("");
  });
});
