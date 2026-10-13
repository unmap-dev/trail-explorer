# Data sources

Everything on screen, where it comes from, and how far to trust it.

| What | Source | Licence | Live? |
| --- | --- | --- | --- |
| Trail names, lines and published attributes | **Parks Canada, Trails APCA**, an open dataset on the [Open Government Portal](https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4), fetched into `data/trails.geojson` by `scripts/fetch-trails.mjs` | Open Government Licence - Canada (checked on every fetch; see below) | No: a snapshot, dated in the file |
| Trail length | worked out from the published lines (method below) | — | No: computed when fetched |
| Trail climb (gain, loss, lowest, highest) | Unmap Elevation API, sampled when the data was fetched | see unmap.dev/attribution | No: measured when fetched |
| Elevation profile | Unmap Elevation API, sampled live along the chosen line | see unmap.dev/attribution | Live |
| Basemap, hillshade and contours (`outdoor` style) | Unmap Maps API: OpenStreetMap, Mapterhorn relief, Canadian MRDEM contours | ODbL, © OpenStreetMap contributors; elevation suppliers per unmap.dev/attribution | Live |
| Starting-place search | Unmap Geocoding API | per source, see unmap.dev/attribution | Live |
| Road route to a trailhead, turn-by-turn | Unmap Routing API, on the OpenStreetMap road network | ODbL, © OpenStreetMap contributors | Live |
| Your GPX file | your own file, read in your browser | yours | Not sent anywhere; only sampled points go to Unmap Elevation, and only when you ask for its profile |

No trail on screen is invented. If `data/trails.geojson` has not been fetched, the app says so and
shows no trails; it never falls back to made-up ones. The automated tests use clearly named
synthetic fixtures under `test/fixtures/`, which the app never loads.

## The trail dataset

**Parks Canada, Trails APCA** (dataset id `64a90e8d-5bc0-4027-8645-b5881b4068d4`): the trails
Parks Canada manages, as lines, published on the Government of Canada's Open Government Portal.

Attribution, as the licence asks and as it is shown in the app:

> Contains information licensed under the Open Government Licence - Canada. Source: Parks Canada,
> Trails APCA.

The licence is the [Open Government Licence - Canada](https://open.canada.ca/en/open-government-licence-canada),
which allows copying, modifying and redistributing the information, commercially or not, with that
attribution. **The fetch script does not assume this**: it reads the dataset's own record
(`package_show`) and stops before downloading anything unless its `license_id` is `ca-ogl-lgo`,
the portal's id for this licence, then records the licence title and URL in the file. The full
terms and the data's own licence notice are in [`data/LICENSE-DATA.md`](data/LICENSE-DATA.md),
separate from the MIT licence of the code.

### How the collection is made

`scripts/fetch-trails.mjs`, run from a developer's machine:

1. **Licence.** As above: OGL - Canada or nothing.
2. **Source.** The record's Esri REST service (a FeatureServer first, then a MapServer, then a
   GeoJSON download), chosen from the record at run time rather than a hard-coded URL, because the
   service has been renamed before. A resource the record names as deprecated is tried only after
   every current one. Every segment touching the envelope west −116.6, south 50.9,
   east −115.5, north 51.8 (Banff, Lake Louise and the edges of Yoho and Kootenay) is fetched in
   WGS84, by object id in pages, so the service's record limit cannot truncate the answer.
3. **Fields.** The script reads the layer's field list and works out which field is the trail's
   name, the park, an official difficulty rating and the links to Parks Canada's pages
   (`detectFields` in `lib/source.ts`). It prints every field and its choice in the run log and
   records both in the file's `_provenance`. If a guess is wrong, the `TRAILS_NAME_FIELD`,
   `TRAILS_NAME_FR_FIELD`, `TRAILS_AREA_FIELD`, `TRAILS_DIFFICULTY_FIELD` and
   `TRAILS_SYSTEM_FIELD` environment variables override it.
4. **Trails.** The current service draws a path once for every activity on it (hiking, horseback
   riding, skiing), so when the layer has an activity field with a Hiking value only the hiking
   features are read, and each path once. Segments are grouped by published name (and park).
   Unnamed segments are left out: a trail is named by its publisher, never by us. Each group's
   segments are joined end to end where their ends lie within 30 m (the digitising gaps between
   one trail's segments run to about 30 m), reordering and reversing whole segments; no vertex is
   moved, smoothed or simplified. A trail whose pieces do not meet stays a MultiLineString, main
   (longest) part first; parts shorter than 10 m (0–1 m digitising slivers) are left out.
5. **Choice.** Day hikes only: 1.5 to 25 km in total, and not named as a road, parkway, parking
   area or connector. Up to 20: well-known day hikes in the area first (the `PREFERRED` list in
   `lib/curate.ts`, which only orders the source's own trails and adds nothing), then the most
   continuous.
6. **Numbers** (each trail carries its own `method` text):
   - **Length**: the sum of great-circle (haversine, R = 6,371,008.8 m) distances between
     consecutive vertices over every part, including the at most 30 m steps where segments are
     joined; gaps between parts are not counted.
   - **Trailhead**: the start of the main part. With an Unmap key, the main part is first turned
     so it starts at its lower end (most day hikes start low). It is the end of the published
     line, **not a surveyed trailhead or parking area**.
   - **Climb**: with an Unmap key, the main part is sampled with the Unmap Elevation API every
     max(30 m, length / 499) metres, at most 500 points in one request: the same points the app's
     elevation profile samples, so the profile shows the same numbers while the DEM release is
     unchanged. Gain and loss are summed between consecutive samples with no smoothing. Without a
     key, the climb is `null` and says so, and the app hides the climb filter.
   - **Difficulty**: only when the source carries an official rating: a field named for
     difficulty, or a coded field whose published values are ratings (Trails APCA's
     `Summer_Classification_Été`: Easy, Moderate, Difficult, Most difficult, with Parks Canada's
     own French labels). Summer is preferred to winter; a slope or profile field is never taken
     for a rating. When a trail's segments are rated differently, the hardest rating is shown and
     the trail says so. Otherwise `null`, "Not in source", and the app hides the difficulty filter.
   - **On the trail**: surface, slope, obstacles, structures, path type, width and accessibility,
     as the source's coded values publish them in English and French, every value the trail's
     segments carry. Winter fields, seasonal restrictions (which are not current closures) and
     codes the source gives no meaning for ("Type 2") are left out.
7. **Output.** `data/trails.geojson`, and the table below, rewritten only when something other
   than the retrieval time changed.

### The trails

<!-- trails-table:start -->
_Written by `scripts/fetch-trails.mjs` from https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/Trails_Sentiers_APCA_Temporary_Temporaire_APCA_OpenOuvert/FeatureServer/0, retrieved 2026-10-13. 20 trails._

| id | Name (as published) | Area | Length | Climb (main part) | Difficulty | Source features |
| --- | --- | --- | --- | --- | --- | --- |
| `johnston-canyon` | Johnston Canyon | — | 2.9 km | +211 m / −44 m | Easy | 4 |
| `lake-agnes` | Lake Agnes | — | 4.0 km | +412 m / −101 m | Moderate | 9 |
| `plain-of-six-glaciers` | Plain of Six Glaciers | — | 4.7 km | +509 m / −82 m | Moderate | 5 |
| `larch-valley` | Larch Valley | — | 4.2 km | +548 m / −1 m | Moderate | 2 |
| `sentinel-pass` | Sentinel Pass | — | 3.5 km | +480 m / −191 m | Difficult | 1 |
| `eiffel-lake` | Eiffel Lake | — | 3.3 km | +139 m / −54 m | Moderate | 1 |
| `consolation-lakes` | Consolation Lakes | — | 3.7 km | +151 m / −64 m | Moderate | 2 |
| `tunnel-mountain-summit` | Tunnel Mountain Summit | — | 2.3 km | +281 m / −16 m | Moderate | 2 |
| `sulphur-mountain-westside` | Sulphur Mountain Westside | — | 5.4 km | +849 m / −1 m | Moderate | 2 |
| `c-level-cirque` | C-Level Cirque | — | 3.8 km | +466 m / −29 m | Moderate | 1 |
| `cory-pass` | Cory Pass | — | 7.8 km | +998 m / −591 m | Difficult | 1 |
| `stanley-glacier` | Stanley Glacier | — | 4.4 km | +359 m / −12 m | Moderate | 1 |
| `boom-lake` | Boom Lake | — | 5.1 km | +253 m / −92 m | Easy | 3 |
| `rockbound-lake` | Rockbound Lake | — | 6.3 km | +292 m / −36 m | Moderate | 6 |
| `taylor-lake` | Taylor Lake | — | 7.3 km | +616 m / −4 m | Moderate | 3 |
| `big-beehive` | Big Beehive | — | 2.7 km | +255 m / −159 m | Moderate | 2 |
| `saddleback-sheol-valley` | Saddleback - Sheol Valley | — | 7.2 km | +602 m / −512 m | Difficult | 5 |
| `bourgeau-lake` | Bourgeau Lake | — | 6.7 km | +742 m / −36 m | Moderate | 1 |
| `healy-pass` | Healy Pass | — | 11.8 km | +738 m / −400 m | Moderate | 7 |
| `cascade-amphitheatre` | Cascade Amphitheatre | — | 5.8 km | +596 m / −132 m | Moderate | 6 |
<!-- trails-table:end -->

## Accuracy and limitations

- **Not live.** Trail conditions, closures, seasonal restrictions, wildlife warnings and
  avalanche hazard are not in this data and are not shown. Check
  [Parks Canada](https://parks.canada.ca/pn-np/ab/banff) before you go.
- **Not for navigation or safety.** Lines are as Parks Canada published them on the retrieval date
  and may be incomplete, simplified or out of date. This demo is not an offline map, a navigation
  aid or safety guidance.
- **Road routing only.** Directions go by road to the start of the published line, which is not
  necessarily a parking area. Unmap routing does not navigate trails.
- **Climb.** The DEM mixes sources and resolutions (see the Elevation API docs); sampling every
  30 m or more smooths short steep steps, and summing raw differences counts small DEM noise as
  climb. Treat gain and loss as approximate. For a trail in several parts, climb covers the main
  part only, and the app says so.
- **Selection.** The collection is a sample of day hikes, chosen mechanically; it is not every
  trail in the parks.

## Replacing the data

See the README: write your own `data/trails.geojson` in the same shape (`lib/trails.ts` validates
it and lists every problem), or adapt `scripts/fetch-trails.mjs` to another source whose licence
you have checked. Then update this file and the `dataset` entry in `lib/manifest.ts`.
