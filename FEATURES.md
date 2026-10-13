# Features

What Trails does, which Unmap API does it, and what it deliberately does not do (spec §6).

## Implemented

| Feature | How | Unmap |
| --- | --- | --- |
| Outdoor map with terrain and contours | registry `map` with the `outdoor` style, which carries a DEM hillshade, contour lines and OpenStreetMap trails; labels in English or French | Maps API (`/styles/outdoor.json`, `/tiles`, `/terrain`, `/contours`) |
| The trail collection | `data/trails.geojson`, Parks Canada open data fetched by `scripts/fetch-trails.mjs`; loaded after the map starts, validated, every trail with its source, licence and the method behind every number | — (open dataset) |
| Trails on the map | every listed trail as a quiet line with its trailhead (registry `geojson-layer`); click one to choose it | — |
| Search | by name, in the browser, accents and case ignored | — |
| Filters | distance (under 5 km, 5–10 km, over 10 km); climb (under 300 m, 300–700 m, over 700 m) and difficulty, each shown **only when the data carries it** for at least one trail | — |
| Trail details | length, climb and difficulty first (difficulty as Parks Canada rates it, on its four-step scale, or "Not in source"); then what the trail is like (surface, slope, obstacles, structures, type, width, as Parks Canada publishes them in English and French) and the trailhead; how each figure was worked out, folded away; source and licence; a link to the Parks Canada page when the source has one | — |
| Chosen trail highlighted | registry `route-line`, one per part, over the others; the trailhead pinned (`marker-popup`) | — |
| Elevation profile | registry `elevation-profile`: up to 500 points sampled along the main part, gain, loss, lowest and highest; hover the chart and a marker follows on the map, hover the line and the chart follows; profiles already fetched are reused | Elevation (`GET /elevation?points=`) |
| Stored climb matches the profile | the fetch script samples the same points the profile samples (`lib/geo.ts` `sampleLine`, held equal to the registry's by a test) | Elevation |
| GPX import | open a `.gpx` file; tracks, routes and waypoints read in the browser; refused with a reason (en/fr) when it is not XML, not GPX, empty, has a point out of range, or is too large; shown as "Your file" | — |
| GPX profile, on request | only when you press the button, and then only the sampled points are sent | Elevation |
| Directions to the trailhead | starting place from the registry `geocoder` or your location; road route by car with turn-by-turn steps in en/fr (`route-steps`), warnings the API attaches, and a plain message when there is no route; labelled road routing, not trail navigation | Geocoding (`/geocode/autocomplete`), Routing (`/route` with `steps`, `lang`) |
| Shareable link | `?trail=<id>` (and `?lang=fr`) | — |
| Not-live notice | always visible: conditions and closures are not shown, data may be incomplete, not a navigation or safety tool | — |
| Empty state | no data file: "Trail data has not been fetched yet", no trails shown; an invalid file lists its problems | — |
| Errors | every API failure shown where its answer would have been, in en/fr, with a retry when waiting could help | — |
| English and French | the header switch; map labels, place search and route steps follow | Maps, Geocoding and Routing `lang` |
| No-key state | lists the trails and explains how to get a key; never calls the API without one | — |
| Built with Unmap | the services, calls, components and data sources behind the page | — |

Requests are made only when you act (choosing a trail, asking for directions or a file's
profile), never on map movement; an obsolete request is cancelled when a newer one replaces it,
the profile is debounced, and the browser smoke tests fail if the same call is made twice.

## Not goals

Offline navigation, turn-by-turn on trails, live conditions and closures, social profiles, trail
reviews or photos, emergency assistance, and authoritative safety guidance (spec §6). Trail
geometry only ever comes from the curated dataset or your own file; the app never draws a trail
it was not given.
