import { describe, expect, it } from "vitest";
import { ATTRIBUTION, bilingual, candidates, checkLicence, codeOf, detectFields, ENVELOPE, esriError, featuresQuery, idsQuery, readValue, toSourceFeature, touchesEnvelope, type EsriField } from "@/lib/source";
import { FIELDS } from "./fixtures/synthetic-source";

describe("the licence gate", () => {
  it("accepts the Open Government Licence - Canada and records its title and URL", () => {
    expect(checkLicence({ license_id: "ca-ogl-lgo", license_title: "Open Government Licence - Canada", license_url: "https://open.canada.ca/en/open-government-licence-canada" })).toEqual({
      id: "ca-ogl-lgo",
      title: "Open Government Licence - Canada",
      url: "https://open.canada.ca/en/open-government-licence-canada",
    });
  });

  it("refuses anything else, saying what the licence is and that nothing was fetched", () => {
    expect(() => checkLicence({ license_id: "cc-by", license_title: "Creative Commons Attribution" })).toThrow(/Creative Commons Attribution[\s\S]*not the Open Government Licence - Canada[\s\S]*nothing was fetched/);
    expect(() => checkLicence({})).toThrow(/license_id "none"/);
  });

  it("attributes in the repository's own wording", () => {
    expect(ATTRIBUTION).toBe("Contains information licensed under the Open Government Licence - Canada. Source: Parks Canada, Trails APCA.");
  });
});

describe("choosing the resource", () => {
  it("prefers a FeatureServer, then a MapServer, then GeoJSON, English first, and ignores the rest", () => {
    const pkg = {
      resources: [
        { format: "GeoJSON", url: "https://example.invalid/trails.geojson", language: ["en"] },
        { format: "ESRI REST", url: "https://example.invalid/arcgis/rest/services/Trails/MapServer", language: ["en"] },
        { format: "ESRI REST", url: "https://example.invalid/arcgis/rest/services/Trails/FeatureServer/0", language: ["fr"] },
        { format: "ESRI REST", url: "https://example.invalid/arcgis/rest/services/Trails/FeatureServer/0/", language: ["en"] },
        { format: "FGDB/GDB", url: "https://example.invalid/trails.gdb.zip" },
        { format: "HTML", url: "http://example.invalid/insecure" },
      ],
    };
    expect(candidates(pkg).map((c) => [c.kind, c.url])).toEqual([
      ["esri", "https://example.invalid/arcgis/rest/services/Trails/FeatureServer/0"],
      ["esri", "https://example.invalid/arcgis/rest/services/Trails/MapServer"],
      ["geojson", "https://example.invalid/trails.geojson"],
    ]);
  });

  it("tries a resource the record calls deprecated only after every current one", () => {
    const pkg = {
      resources: [
        { name: "Trails (Deprecated)", format: "ESRI REST", url: "https://example.invalid/arcgis/rest/services/Old/FeatureServer/0" },
        { name: "Trails (Temporary)", format: "GeoJSON", url: "https://example.invalid/current.geojson" },
        { name: "Trails (Temporary)", format: "ESRI REST", url: "https://example.invalid/arcgis/rest/services/Current/FeatureServer/0" },
      ],
    };
    expect(candidates(pkg).map((c) => c.url)).toEqual([
      "https://example.invalid/arcgis/rest/services/Current/FeatureServer/0",
      "https://example.invalid/current.geojson",
      "https://example.invalid/arcgis/rest/services/Old/FeatureServer/0",
    ]);
  });

  it("queries ids by envelope in WGS84, then features by id with every field", () => {
    const ids = new URL(idsQuery("https://example.invalid/FeatureServer/0"));
    expect(ids.pathname).toBe("/FeatureServer/0/query");
    expect(ids.searchParams.get("geometry")).toBe(ENVELOPE.join(","));
    expect(ids.searchParams.get("inSR")).toBe("4326");
    expect(ids.searchParams.get("returnIdsOnly")).toBe("true");
    const features = new URL(featuresQuery("https://example.invalid/FeatureServer/0", [3, 4]));
    expect(features.searchParams.get("objectIds")).toBe("3,4");
    expect(features.searchParams.get("outSR")).toBe("4326");
    expect(features.searchParams.get("outFields")).toBe("*");
    expect(features.searchParams.get("f")).toBe("geojson");
  });

  it("reads ArcGIS error envelopes", () => {
    expect(esriError({ error: { code: 400, message: "Invalid query", details: ["bad where"] } })).toBe("ArcGIS error 400: Invalid query (bad where)");
    expect(esriError({ features: [] })).toBeNull();
  });
});

describe("detectFields", () => {
  it("works out each role from the layer's own fields", () => {
    expect(detectFields(FIELDS)).toEqual({
      name: "Trail_Name_Nom_du_sentier",
      nameFr: null,
      system: "Trail_system_reseau_de_sentiers",
      area: "Park_Parc",
      difficulty: null,
      urlEn: "URL_e",
      urlFr: "URL_f",
      objectId: "OBJECTID",
      activity: null,
      published: ["Accessible", "Width_Largeur_m", "Surface", "Profile_Pente", "Section_Type"],
    });
  });

  it("does not take a slope profile for a difficulty rating, but takes a field named for difficulty", () => {
    expect(detectFields(FIELDS).difficulty).toBeNull();
    expect(detectFields([...FIELDS, { name: "Difficulty_Difficulte", type: "esriFieldTypeString" }]).difficulty).toBe("Difficulty_Difficulte");
  });

  // The shape of the current Trails APCA layer: ratings and activities are coded, bilingual values.
  const coded = (name: string, values: [number, string][]): EsriField => ({ name, type: "esriFieldTypeSmallInteger", domain: { type: "codedValue", codedValues: values.map(([code, n]) => ({ code, name: n })) } });
  const RATINGS: [number, string][] = [[1, "Easy//Facile"], [2, "Moderate//Modéré"], [3, "Difficult//Difficile"], [4, "Most difficult // Très difficile"]];
  const CODED = [
    ...FIELDS.filter((f) => f.name !== "Profile_Pente"),
    coded("Profile_Pente", [[1, "Flat to gently rolling//Plats ou quelques pentes douces"], [4, "Steep//Éscarpé"]]),
    coded("Winter_Classification_Hiver", RATINGS),
    coded("Summer_Classification_Été", RATINGS),
    coded("Summer_Type_Été", [[1, "Type 1"], [2, "Type 2"]]),
    coded("Obstacles", [[1, "No obstacles or stairs//Aucun obstacle"]]),
    coded("General_Activity", [[100, "Hiking//Randonnée"], [1300, "Horseback riding//Équitation"]]),
  ];

  it("takes a coded field whose values are ratings for the difficulty, summer before winter, never the slope", () => {
    const f = detectFields(CODED);
    expect(f.difficulty).toBe("Summer_Classification_Été");
    expect(detectFields(CODED.filter((x) => x.name !== "Summer_Classification_Été")).difficulty).toBeNull();
    expect(f.published).toContain("Profile_Pente");
    expect(f.published).toContain("Obstacles");
  });

  it("leaves winter fields and codes with no published meaning out of the attributes", () => {
    const { published } = detectFields(CODED);
    expect(published).not.toContain("Winter_Classification_Hiver");
    expect(published).not.toContain("Summer_Type_Été");
    expect(published).not.toContain("Summer_Classification_Été");
  });

  it("finds the activity field and the code that means hiking", () => {
    expect(detectFields(CODED).activity).toEqual({ field: "General_Activity", hiking: 100 });
    expect(detectFields(CODED).published).not.toContain("General_Activity");
  });

  it("falls back to alternative names, then the trail system, when there is no name field", () => {
    const noName = FIELDS.filter((f) => f.name !== "Trail_Name_Nom_du_sentier");
    expect(detectFields(noName).name).toBe("Noms_Alt_Names");
    expect(detectFields(noName.filter((f) => f.name !== "Noms_Alt_Names")).name).toBe("Trail_system_reseau_de_sentiers");
  });

  it("separate English and French name fields are both kept", () => {
    const f = detectFields([{ name: "Name_E", type: "esriFieldTypeString" }, { name: "Nom_F", type: "esriFieldTypeString" }]);
    expect([f.name, f.nameFr]).toEqual(["Name_E", "Nom_F"]);
  });

  it("an override wins when it names a real field, and is ignored otherwise", () => {
    expect(detectFields(FIELDS, { name: "Noms_Alt_Names" }).name).toBe("Noms_Alt_Names");
    expect(detectFields(FIELDS, { name: "Nope" }).name).toBe("Trail_Name_Nom_du_sentier");
  });
});

describe("reading features", () => {
  it("reads coded values as their labels and trims text", () => {
    const surface = FIELDS.find((f) => f.name === "Surface");
    expect(readValue(surface, 2)).toBe("Natural / Naturel");
    expect(readValue(undefined, "  Lake  ")).toBe("Lake");
    expect(readValue(undefined, null)).toBeNull();
    expect(readValue(undefined, 2.5)).toBe("2.5");
  });

  it("splits Parks Canada's bilingual labels, and keeps a one-language label for both", () => {
    expect(bilingual("Easy//Facile")).toEqual({ en: "Easy", fr: "Facile" });
    expect(bilingual("Most difficult // Très difficile")).toEqual({ en: "Most difficult", fr: "Très difficile" });
    expect(bilingual("Type 1")).toEqual({ en: "Type 1", fr: "Type 1" });
  });

  it("places a coded value on its field's scale", () => {
    const f: EsriField = { name: "R", domain: { type: "codedValue", codedValues: [{ code: 1, name: "Easy//Facile" }, { code: 3, name: "Difficult//Difficile" }] } };
    expect(codeOf(f, "Difficult//Difficile")).toBe(3);
    expect(codeOf(f, "Unknown")).toBeNull();
    expect(codeOf(undefined, "Easy//Facile")).toBeNull();
  });

  it("takes GeoJSON lines and Esri polylines, and nothing else", () => {
    expect(toSourceFeature({ type: "Feature", properties: { a: 1 }, geometry: { type: "LineString", coordinates: [[-116, 51], [-116.1, 51.1]] } })!.paths).toHaveLength(1);
    expect(toSourceFeature({ attributes: { a: 1 }, geometry: { paths: [[[-116, 51], [-116.1, 51.1]], [[-116, 51]]] } })!.paths).toHaveLength(1);
    expect(toSourceFeature({ properties: {}, geometry: { type: "Point", coordinates: [-116, 51] } })).toBeNull();
    expect(toSourceFeature({ properties: {}, geometry: { type: "LineString", coordinates: [[-316, 51], [-116, 91]] } })).toBeNull();
  });

  it("filters a download to the envelope", () => {
    expect(touchesEnvelope({ properties: {}, paths: [[[-116, 51.2], [-116.1, 51.3]]] })).toBe(true);
    expect(touchesEnvelope({ properties: {}, paths: [[[-120, 49], [-120.1, 49.1]]] })).toBe(false);
  });
});
