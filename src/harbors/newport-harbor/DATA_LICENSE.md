# Newport Harbor data provenance and license

The harbor data in this directory is a database made available under the
[Open Data Commons Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Any rights in individual database contents are licensed under the
[Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).

It contains information from OpenStreetMap, which is available under the ODbL:
© OpenStreetMap contributors, <https://www.openstreetmap.org/copyright>.

## Files

- `water.json` is an OpenStreetMap extract obtained through public Overpass API
  instances. It covers the bounding box south `33.588`, west `-117.945`, north
  `33.628`, east `-117.872`. The exact extraction timestamp was not recorded;
  the snapshot was first committed on 2026-08-15.
- `harbor.json` contains the simulator anchor, start pose, navigation marks, and
  the `openWater`/`excludeBboxes` alterations applied to that extract. Those
  alterations are offered under the ODbL as the alteration data for the public
  derivative harbor database.

The current extraction query and regeneration method are in
`scripts/fetch-harbor.ts`. Newly generated `water.json` files include source,
license, generation timestamp, and bounding-box metadata.

The data is for simulation only. It is incomplete and must not be used for
navigation.
