// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GpxError, longestLine, parseGpx, type GpxErrorCode } from "@/lib/gpx";
import { TEXT } from "@/lib/text";

// SYNTHETIC test fixtures (test/fixtures/synthetic-*.gpx): invented points.
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

const code = (source: string): GpxErrorCode | null => {
  try {
    parseGpx(source);
    return null;
  } catch (error) {
    return error instanceof GpxError ? error.code : null;
  }
};

const gpx = (body: string) => `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

describe("parseGpx", () => {
  it("reads a track, its name and waypoints, and measures it", () => {
    const track = parseGpx(fixture("synthetic-track.gpx"));
    expect(track.name).toBe("Synthetic test walk");
    expect(track.lines).toHaveLength(1);
    expect(track.lines[0]![0]).toEqual([-115.57, 51.18]);
    expect(track.waypoints).toEqual([{ name: "Synthetic start", coordinates: [-115.57, 51.18] }]);
    expect(track.points).toBe(7);
    expect(track.metres).toBeCloseTo(1011, 0);
    expect(longestLine(track)).toBe(track.lines[0]);
  });

  it("reads routes and GPX 1.0 without a namespace", () => {
    const track = parseGpx('<gpx version="1.0"><rte><name>R</name><rtept lat="51" lon="-115"/><rtept lat="51.01" lon="-115.01"/></rte></gpx>');
    expect(track.name).toBe("R");
    expect(track.lines).toHaveLength(1);
  });

  it("accepts a file of waypoints only, with no line to profile", () => {
    const track = parseGpx(gpx('<wpt lat="51" lon="-115"><name>Hut</name></wpt>'));
    expect(track.lines).toEqual([]);
    expect(longestLine(track)).toEqual([]);
  });

  it("refuses a point out of range, whole, saying where", () => {
    try {
      parseGpx(fixture("synthetic-bad-coordinates.gpx"));
      throw new Error("expected a GpxError");
    } catch (error) {
      expect((error as GpxError).code).toBe("bad-coordinates");
      expect((error as GpxError).where).toBe("trkpt 3");
    }
    expect(code(gpx('<trk><trkseg><trkpt lat="51" lon=""/><trkpt lat="51" lon="-115"/></trkseg></trk>'))).toBe("bad-coordinates");
    expect(code(gpx('<wpt lat="abc" lon="-115"/>'))).toBe("bad-coordinates");
  });

  it("refuses what is not a usable GPX file, with a reason for each", () => {
    expect(code("")).toBe("empty");
    expect(code("<gpx><trk>")).toBe("not-xml");
    expect(code("this is not xml")).toBe("not-xml");
    expect(code('<?xml version="1.0"?><kml><Placemark/></kml>')).toBe("not-gpx");
    expect(code(gpx("<metadata><name>Nothing</name></metadata>"))).toBe("empty");
    expect(code(gpx('<trk><trkseg><trkpt lat="51" lon="-115"/></trkseg></trk>'))).toBe("too-few-points");
    expect(code(gpx('<trk><trkseg><trkpt lat="51" lon="-115"/><trkpt lat="51" lon="-115"/></trkseg></trk>'))).toBe("too-few-points");
  });

  it("has a message for every refusal in both languages", () => {
    for (const lang of ["en", "fr"] as const) for (const c of ["too-large", "not-xml", "not-gpx", "empty", "bad-coordinates", "too-few-points", "too-many-points", "read"] as const) expect(TEXT[lang].gpxErrors[c]).toBeTruthy();
  });
});
