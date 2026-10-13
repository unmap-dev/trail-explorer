// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// No key in the test build: the app must explain how to get one instead of calling the API. The
// trail list does not need one: it is the demo's own data file.
vi.mock("@/lib/kit/config", async (orig) => ({ ...(await orig<typeof import("@/lib/kit/config")>()), API_KEY: "" }));

import { TrailsApp } from "../components/trails/trails-app";

// A SYNTHETIC test fixture, served to the app through a mocked fetch. Never imported by app code.
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "synthetic-trails.geojson"), "utf8"));

let serve: () => Response;
beforeEach(() => {
  serve = () => new Response(JSON.stringify(fixture), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("/data/trails.geojson") ? serve() : new Response("", { status: 500 }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const rows = () => within(screen.getByRole("list", { name: "Trails" })).getAllByRole("button");

describe("Trails without a key", () => {
  it("lists the trails from the data file, shows the notice, and asks for a key instead of a map", async () => {
    render(<TrailsApp />);
    await screen.findByRole("list", { name: "Trails" });
    expect(rows()).toHaveLength(4);
    expect(screen.getByText("Not live, not for navigation")).toBeTruthy();
    expect(screen.getByText("This demo needs an Unmap API key")).toBeTruthy();
    expect(screen.getByText(/Trails: Synthetic test fixture, not real data\./)).toBeTruthy();
  });

  it("filters by distance, climb and difficulty, and selects a trail into the URL", async () => {
    render(<TrailsApp />);
    await screen.findByRole("list", { name: "Trails" });
    fireEvent.click(screen.getByRole("button", { name: "5–10 km" }));
    expect(rows().map((r) => r.getAttribute("data-trail-row"))).toEqual(["synthetic-bravo", "synthetic-charlie"]);
    fireEvent.click(screen.getByRole("button", { name: "Over 700 m" }));
    expect(rows().map((r) => r.getAttribute("data-trail-row"))).toEqual(["synthetic-bravo"]);
    expect(screen.getByText(/Trails without a measured climb are left out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Easy" }));
    expect(screen.getByText("No trail matches these filters.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    expect(rows()).toHaveLength(4);

    fireEvent.click(rows()[2]!);
    expect(window.location.search).toBe("?trail=synthetic-charlie");
    const details = document.querySelector('[data-trail-details="synthetic-charlie"]') as HTMLElement;
    expect(within(details).getByText("Not measured")).toBeTruthy();
    expect(within(details).getByText("Not in source")).toBeTruthy();
    expect(within(details).getByText(/Main part only/)).toBeTruthy();
    // How each figure was worked out stays folded away until asked for.
    const how = within(details).getByRole("button", { name: "How these figures were worked out" });
    expect(how.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(how);
    expect(how.getAttribute("aria-expanded")).toBe("true");
    expect(within(details).getByText("Trailhead:")).toBeTruthy();
  });

  it("opens on the trail a link names", async () => {
    window.history.replaceState(null, "", "/?trail=synthetic-bravo");
    render(<TrailsApp />);
    expect(await screen.findByText("Synthetic Test Trail Bravo", { selector: "[data-slot=card-title]" })).toBeTruthy();
  });

  it("hides a filter the data cannot answer instead of faking it", async () => {
    const bare = structuredClone(fixture);
    for (const f of bare.features) Object.assign(f.properties, { elevation: null, difficulty: null });
    serve = () => new Response(JSON.stringify(bare), { status: 200 });
    render(<TrailsApp />);
    await screen.findByRole("list", { name: "Trails" });
    expect(screen.getByRole("button", { name: "Under 5 km" })).toBeTruthy();
    expect(document.querySelector('[data-filter="gain"]')).toBeNull();
    expect(document.querySelector('[data-filter="difficulty"]')).toBeNull();
  });

  it("says the data has not been fetched yet when the file is missing, and shows no trails", async () => {
    serve = () => new Response("", { status: 404 });
    render(<TrailsApp />);
    expect(await screen.findByText("Trail data has not been fetched yet")).toBeTruthy();
    expect(screen.getByText(/node scripts\/fetch-trails\.mjs/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Trails" })).toBeNull();
  });

  it("lists what is wrong with an invalid file", async () => {
    serve = () => new Response(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: null }] }), { status: 200 });
    render(<TrailsApp />);
    expect(await screen.findByText("The trail data file is not valid")).toBeTruthy();
    expect(screen.getByText(/feature 0: id must be/)).toBeTruthy();
  });

  it("switches to French", async () => {
    render(<TrailsApp />);
    await screen.findByRole("list", { name: "Trails" });
    fireEvent.click(screen.getByRole("button", { name: "Français" }));
    expect(screen.getByRole("list", { name: "Sentiers" })).toBeTruthy();
    expect(screen.getByText("Pas en temps réel, pas pour la navigation")).toBeTruthy();
    expect(screen.getByText("Sentier d'essai synthétique Alpha")).toBeTruthy();
    expect(window.location.search).toBe("?lang=fr");
    expect(document.title).toBe("Trails · explorateur de randonnées · démo Unmap");
  });
});

describe("fixtures stay in the tests", () => {
  it("no app code refers to test fixtures", () => {
    const root = join(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
      });
    for (const dir of ["app", "components", "hooks", "lib", "scripts"])
      for (const file of walk(join(root, dir))) expect(readFileSync(file, "utf8"), file).not.toMatch(/fixtures\/|synthetic-/i);
  });
});
