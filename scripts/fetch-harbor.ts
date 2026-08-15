/**
 * Fetch a harbor's navigable-water polygons from OpenStreetMap via Overpass
 * and save them as a GeoJSON FeatureCollection for the sim.
 *
 * Usage: npm run fetch-harbor <name> <south> <west> <north> <east>
 * e.g.:  npm run fetch-harbor newport-harbor 33.588 -117.945 33.628 -117.872
 *
 * Adds a new harbor: run this, then create harbors/<name>/harbor.json and
 * register it in harbors/registry.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import osmtogeojson from "osmtogeojson";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

interface OverpassElement {
  type: "way" | "relation" | "node";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; ref: number; geometry?: { lat: number; lon: number }[] }[];
}

async function runQuery(query: string): Promise<OverpassElement[]> {
  let lastErr: unknown;
  for (const ep of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        });
        if (res.status === 429) {
          console.log(`  ${new URL(ep).host} busy (429), waiting 15s...`);
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        if (!res.ok) throw new Error(`${ep} → HTTP ${res.status}`);
        const json = (await res.json()) as { elements: OverpassElement[] };
        return json.elements ?? [];
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

/** Assemble OSM elements into correct GeoJSON (osmtogeojson handles
 * multipolygon ring stitching — hand-rolling it produced misshapen rings). */
function toFeatureCollection(elements: OverpassElement[]) {
  const fc = osmtogeojson({ type: "FeatureCollection", features: [], elements }) as unknown as {
    features: {
      type: "Feature";
      properties: Record<string, string>;
      geometry: { type: string; coordinates: unknown };
    }[];
  };
  return {
    type: "FeatureCollection" as const,
    features: fc.features.filter(
      (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon",
    ),
  };
}

const [name, southS, westS, northS, eastS] = process.argv.slice(2);
if (!name || !southS || !westS || !northS || !eastS) {
  console.error("usage: npm run fetch-harbor <name> <south> <west> <north> <east>");
  process.exit(1);
}
const bbox = `${southS},${westS},${northS},${eastS}`;

// Water surfaces: harbors, bays, rivers, basins, docks. We deliberately do NOT
// pull the open-ocean coastline relation (huge); harbors that need open water
// add an explicit "openWater" rectangle in their harbor.json.
//
// NOTE: a bbox-filtered relation query returns only members intersecting the
// bbox, which corrupts multipolygon assembly. So: discover relations by bbox,
// then re-fetch each by id WITHOUT the bbox for complete member geometry.
const waysQuery = `[out:json][timeout:90];
(
  way["natural"="water"](${bbox});
  way["waterway"="riverbank"](${bbox});
);
out geom;`;
const relIdsQuery = `[out:json][timeout:90];
relation["natural"="water"](${bbox});
out ids;`;

console.log(`Querying Overpass for water in bbox ${bbox} ...`);
const wayElements = await runQuery(waysQuery);
const relIds = (await runQuery(relIdsQuery)).map((e) => e.id);
console.log(`  ${wayElements.length} ways, ${relIds.length} relations (fetching full)`);
const elements = [...wayElements];
for (const id of relIds) {
  const full = await runQuery(`[out:json][timeout:90];relation(${id});out geom;`);
  elements.push(...full.filter((e) => e.type === "relation"));
}
const fc = toFeatureCollection(elements);
const outDir = join(import.meta.dirname, "..", "src", "harbors", name);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "water.json"), JSON.stringify(fc));
console.log(`Wrote ${fc.features.length} water polygons → ${outDir}/water.json`);
for (const f of fc.features) {
  const p = f.properties;
  const g = f.geometry as { type: string; coordinates: number[][][] | number[][][][] };
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
  const pts = polys.reduce((n: number, poly) => n + poly[0].length, 0);
  console.log(`  - ${p.name ?? "water"} (${pts} pts, ${polys.length} poly, holes: ${polys.reduce((n: number, poly) => n + poly.length - 1, 0)})`);
}
