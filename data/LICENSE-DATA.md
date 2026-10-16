# Licence of the trail data

This licence covers **`data/trails.geojson` only**. The app's code is MIT (see the README); the
two are separate.

`data/trails.geojson` is derived from **Parks Canada, Trails APCA**, published on the Government of
Canada's Open Government Portal:
<https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4>

It is used under the **Open Government Licence - Canada**:
<https://open.canada.ca/en/open-government-licence-canada>. The full, authoritative text is at
that address; read it there. The licence title and URL recorded in the file's `_provenance` are
the ones the dataset's record carried on the day it was fetched, and `scripts/fetch-trails.mjs`
refuses to fetch at all if the record names any other licence.

In short (not a substitute for the text):

- You may copy, modify, publish, translate, adapt, distribute or otherwise use the information,
  for any lawful purpose, commercial or not.
- You must acknowledge the source with the attribution statement below, wherever you use it.
- The licence grants no right to use official symbols or logos, and does not suggest that the
  Government of Canada or Parks Canada endorses you or your use.
- The information is provided as is, without warranty, and the provider is not liable for errors
  or omissions.

## Attribution

> Contains information licensed under the Open Government Licence - Canada. Source: Parks Canada,
> Trails APCA.

The app shows this line under the trail list and with every trail.

## What was changed

The file is not the dataset as published. `scripts/fetch-trails.mjs`:

- keeps only segments touching the Banff / Lake Louise envelope, and only named trails chosen as
  day hikes (rules in `DATA_SOURCES.md`);
- joins each trail's segments end to end (reordering and reversing whole segments, never moving a
  vertex);
- adds a length, a trailhead, a climb measured with the Unmap Elevation API, and the method behind
  each;
- keeps a few published attributes (surface, width, slope profile, accessibility, section type)
  as published.

Trail conditions and closures are not part of this data.
