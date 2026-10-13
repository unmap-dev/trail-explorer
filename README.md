# Trails: a hiking explorer built with Unmap

Day hikes around Banff and Lake Louise on a live outdoor map with hillshade and contours: search
and filter the trails, choose one for its length, climb and an interactive elevation profile
synced with the map, open your own GPX file, get road directions to the trailhead, and share a
link to the trail. Part of the [Unmap demo suite](https://unmap.dev/demos); live at
[apps.unmap.dev/trails](https://apps.unmap.dev/trails).

The trails are **real open data**: Parks Canada's *Trails APCA* dataset, used under the Open
Government Licence - Canada and fetched by a script that checks that licence first (see
[`DATA_SOURCES.md`](DATA_SOURCES.md)). The map, elevation profiles, place search and routes are
live Unmap. Nothing is invented: until the data has been fetched the app says so and shows no
trails.

> Trail conditions and closures are not shown, and the data may be incomplete. This is a demo,
> not a navigation or safety tool.

## Run it

You need Node 24 (22.18+ works), pnpm and a free Unmap browser key from
[unmap.dev/dashboard](https://unmap.dev/dashboard).

```bash
cp .env.example .env.local      # then set NEXT_PUBLIC_UNMAP_KEY
pnpm install
pnpm dev                        # http://localhost:3203
```

Without a key the app still lists the trails and says how to get one; it never calls the API with
a missing key.

| Command | |
| --- | --- |
| `pnpm dev` | development server on port 3203 |
| `pnpm build` | static export in `out/` |
| `pnpm test` | unit and component tests (Vitest) |
| `pnpm lint` / `pnpm typecheck` | |
| `pnpm fetch-trails` | refresh `data/trails.geojson` from Parks Canada (below) |
| `pnpm run deploy` | build, then `wrangler deploy` to your Cloudflare account (edit `wrangler.jsonc` first) |

The key ships in the browser bundle. Restrict it to your origins (`http://localhost:3203` and your
domain) in the dashboard. Any static host works: `out/` is plain files, and the trail data is one
of them (`out/data/trails.geojson`).

## Refresh the trail data

```bash
node scripts/fetch-trails.mjs                              # trails, lengths, trailheads
UNMAP_API_KEY=um_live_... node scripts/fetch-trails.mjs    # and each trail's climb
```

It needs outbound HTTPS to `open.canada.ca`, the dataset's ArcGIS service and, with a key,
`api.unmap.dev`; where it cannot reach them it says which host failed and writes nothing. It
checks that the dataset's licence is still the OGL - Canada and stops if not, finds the current
service from the dataset's record, prints every field the layer has and which one it used for
what, and writes `data/trails.geojson` plus the trail table in `DATA_SOURCES.md`. Read the log:
if a field was guessed wrong, set `TRAILS_NAME_FIELD` (or `_NAME_FR_`, `_AREA_`, `_DIFFICULTY_`,
`_SYSTEM_FIELD`) and run it again. Then look at the trails in the app before you commit.

Run it from your own machine. The script identifies itself as `demo-trails/1.0`, never with
"unmap" in it: open.canada.ca's firewall answers any user agent containing "nmap" (the port
scanner) with an HTML "Request Rejected" page, and "unmap" contains it.

## Use your own trails

Two ways:

- **Another area or dataset.** Change `ENVELOPE`, the dataset id and `ATTRIBUTION` in
  `lib/source.ts`, and the `PREFERRED` list and day-hike rules in `lib/curate.ts`. Check the new
  source's licence yourself first, and change `checkLicence` to the one you verified.
- **Your own file.** Write `data/trails.geojson` yourself: a GeoJSON FeatureCollection of
  LineString or MultiLineString features (WGS84, `[longitude, latitude]`, main part first) with a
  top-level `_provenance` (`licence`, `attribution`, and optionally `dataset`, `publisher`,
  `datasetUrl`, `licenceUrl`, `retrievedAt`, `notes`). Each feature's `properties`:

  | Field | | |
  | --- | --- | --- |
  | `id` | required | lowercase letters, digits and dashes; unique; used in `?trail=` |
  | `name` | required | `nameFr` and `area` optional |
  | `length` | required | `{ "metres": 4210, "method": "how it was measured" }` |
  | `trailhead` | required | `{ "coordinates": [lng, lat], "method": "…" }` |
  | `source`, `licence`, `attribution`, `sourceUrl`, `retrievedAt` | required | where the trail comes from |
  | `elevation` | optional | `{ "gain", "loss", "min", "max", "method" }` or `null` (the climb filter hides when every trail is `null`) |
  | `difficulty` | optional | `{ "value": "Moderate", "valueFr": "Modéré", "level": 2, "source": "who rated it" }` or `null`; `valueFr` and `level` (1 = easiest, orders the filter) may be `null` (the difficulty filter hides when every trail is `null`) |
  | `published` | optional | conditions shown under "On the trail", by field name: `{ "Surface": { "en": ["Natural"], "fr": ["Naturel"] } }`, or a plain list when the text is the same in both languages |
  | `elevationNote`, `difficultyNote`, `moreInfo` | optional | why a field is null, or how it was chosen; links |

  `parseTrails()` in `lib/trails.ts` validates the file and the app lists every problem it finds.
  Then update the `dataset` entry in `lib/manifest.ts`, `DATA_SOURCES.md` and
  `data/LICENSE-DATA.md` for your data.

## How it is built

```
app/page.tsx                 the one page; renders the app in the browser
components/trails/           the app: notice, filters, list, details, directions, GPX import, map pane
components/ui/  lib/map-*    Unmap registry components and shadcn primitives, copied in unmodified
lib/kit/                     the Unmap demo kit (header, Built with Unmap panel, errors, en/fr), copied in
hooks/                       loading the trail file; road directions (one hook per call)
lib/trails.ts                the trail model and its validator (no React, no fetch)
lib/filters.ts               search and filters, offered only when the data can answer them
lib/gpx.ts                   GPX parsing and validation, in the browser
lib/geo.ts                   lengths, joining segments, sampling for elevation, climb (shared with the script)
lib/source.ts  lib/curate.ts the fetch script's decisions: licence, resource, fields, which trails
lib/url.ts                   the shareable link: ?trail=&lang=
lib/manifest.ts              what the Built with Unmap panel lists
lib/text.ts                  this app's words in English and French
scripts/fetch-trails.mjs     fetches data/trails.geojson (no dependencies)
data/trails.geojson          the trail collection (once fetched); data/LICENSE-DATA.md its licence
```

Layers run one way: components → hooks → `lib/` (plain TypeScript, unit-tested) → `@unmap/sdk`,
the only thing that talks to the API (the registry's elevation profile uses `@unmap/elevation`,
the same client the SDK wraps). The map is the Unmap registry's `map` component; install the same
components in your own project with
`npx @unmap/cli add map geojson-layer route-line elevation-profile geocoder route-steps marker-popup map-controls`.

In the Unmap monorepo the copied files are kept in step by `pnpm sync` and `test/sync.test.ts`; in
your own copy they are ordinary source you can edit.

## Licence

Code: MIT. Trail data: Open Government Licence - Canada, see
[`data/LICENSE-DATA.md`](data/LICENSE-DATA.md). Map data © OpenStreetMap contributors (ODbL),
served by Unmap; elevation suppliers at [unmap.dev/attribution](https://unmap.dev/attribution).
