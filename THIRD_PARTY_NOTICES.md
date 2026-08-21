# Third-party data and services

The MIT License in this repository applies to the original application code.
It does not replace the licenses or terms governing the following data and
hosted services.

## OpenStreetMap

The Newport Harbor collision database in
`src/harbors/newport-harbor/water.json` and its declarative alterations in
`harbor.json`, along with OpenStreetMap basemap data, contain information from
OpenStreetMap. The database and alteration data are available under the Open
Data Commons Open Database License (ODbL) 1.0. File-specific provenance and
licensing are in the adjacent `DATA_LICENSE.md`.

- Copyright and license: <https://www.openstreetmap.org/copyright>
- ODbL 1.0: <https://opendatacommons.org/licenses/odbl/1-0/>
- Standard tile usage policy: <https://operations.osmfoundation.org/policies/tiles/>

## OpenSeaMap

The optional nautical seamark overlay is supplied by OpenSeaMap. OpenSeaMap
data is based on OpenStreetMap data under the ODbL; its rendered chart tiles
are published under Creative Commons Attribution-ShareAlike 2.0.

- Project and attribution: <https://www.openseamap.org/>
- License information: <https://map.openseamap.org/legend.php?lang=en&page=license>

OpenSeaMap is not an official chart and must not replace official nautical
charts.

## Optional imagery providers

No satellite or aerial imagery provider is enabled by default. Operators may
configure a tile URL only together with complete visible attribution. They are
responsible for establishing permission and complying with the selected
provider's service, content, privacy, and attribution terms. The project does
not grant rights to any configured imagery.

## Open-Meteo

Live wind is disabled by default. When an operator explicitly enables the
Open-Meteo-compatible provider, current forecast data is requested from the
configured endpoint. Open-Meteo API output is provided under Creative Commons
Attribution 4.0; its public free endpoint is limited to non-commercial use and
published request limits. Linked attribution is displayed beside live wind
data.

- Terms, privacy, limits, and license: <https://open-meteo.com/en/terms>

## Software dependencies

MapLibre GL JS, Three.js, Vite, TypeScript, Vitest, and other npm dependencies
remain under their respective licenses. Exact versions and available package
license metadata are recorded in `package-lock.json`. Complete notices for the
runtime dependencies are shipped in `public/THIRD_PARTY_LICENSES.txt`, which is
copied into every production build.
