import { describe, expect, it } from "vitest";
import { sampleLine as registrySampleLine, profileStats, toPoints } from "@/components/ui/elevation-profile";
import { boundsOf, climb, defaultInterval, haversine, joinSegments, lineLength, sampleLine, type LngLat } from "@/lib/geo";
import { segment } from "./fixtures/synthetic-source";

describe("lengths", () => {
  it("measures a degree of latitude as about 111.2 km (haversine, mean radius)", () => {
    expect(haversine([-115, 51], [-115, 52])).toBeCloseTo(111_195, -1);
    expect(lineLength([[-115, 51], [-115, 51.5], [-115, 52]])).toBeCloseTo(111_195, -1);
    expect(lineLength([[-115, 51]])).toBe(0);
  });

  it("bounds every coordinate", () => {
    expect(boundsOf([[[-116, 51], [-115, 52]], [[-117, 50.5], [-116.5, 50.6]]])).toEqual([-117, 50.5, -115, 52]);
    expect(boundsOf([])).toBeNull();
  });
});

describe("joinSegments", () => {
  it("joins segments end to end in walking order, reversing one drawn backwards, without moving a vertex", () => {
    const a = segment([0, 0], [0.01, 0]);
    const b = segment([0.02, 0], [0.01, 0]); // backwards, shares a's last vertex
    const c = segment([0.02, 0.00005], [0.03, 0]); // starts about 5.5 m from b's far end
    const lines = joinSegments([c, a, b]);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    // Every vertex is one of the input vertices.
    const input = new Set([...a, ...b, ...c].map((p) => p.join(",")));
    expect(line.every((p) => input.has(p.join(",")))).toBe(true);
    // Walks monotonically east (or west) with the shared vertex once.
    const xs = line.map((p) => p[0]);
    const sorted = [...xs].sort((m, n) => m - n);
    expect(xs.join() === sorted.join() || xs.join() === [...sorted].reverse().join()).toBe(true);
    expect(line.length).toBe(a.length + b.length - 1 + c.length);
  });

  it("keeps parts that do not meet apart, longest first", () => {
    const short = segment([0, 0], [0.005, 0]);
    const long = segment([0, 0.01], [0.02, 0.01]);
    const lines = joinSegments([short, long]);
    expect(lines).toHaveLength(2);
    expect(lineLength(lines[0]!)).toBeGreaterThan(lineLength(lines[1]!));
  });
});

describe("sampling for elevation", () => {
  const lines: LngLat[][] = [
    segment([-116.2, 51.42], [-116.23, 51.435], 40),
    [[-115.57, 51.18], [-115.569, 51.181], [-115.55, 51.2], [-115.4, 51.3]],
    segment([-115.6, 51.1], [-115.6001, 51.1001], 3),
  ];

  it("samples exactly the points the registry's elevation profile samples, so stored climb matches the live profile", () => {
    for (const line of lines) expect(sampleLine(line)).toEqual(registrySampleLine(line));
    expect(sampleLine(lines[1]!, 100)).toEqual(registrySampleLine(lines[1]!, 100));
  });

  it("never sends more than one request's worth (500) by default and never samples under 30 m", () => {
    const long = segment([-116, 51], [-115, 51.5], 200);
    expect(sampleLine(long).length).toBeLessThanOrEqual(500);
    expect(defaultInterval(1000)).toBe(30);
  });

  it("sums climb like the registry profile: unsmoothed, nulls skipped, null when there is no height", () => {
    const heights = [1000, 1010, null, 1005, 1020, 1015];
    const stats = climb(heights);
    expect(stats).toEqual({ gain: 25, loss: 10, min: 1000, max: 1020 });
    const samples = heights.map((_, i) => ({ distance: i * 30, lng: 0, lat: 0 }));
    const theirs = profileStats(toPoints(samples, heights))!;
    expect([theirs.gain, theirs.loss, theirs.min, theirs.max]).toEqual([stats!.gain, stats!.loss, stats!.min, stats!.max]);
    expect(climb([null, null])).toBeNull();
  });
});
