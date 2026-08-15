import waterJSON from "./newport-harbor/water.json";
import harborJson from "./newport-harbor/harbor.json";
import type { HarborDefinition, WaterGeoJSON } from "./types";
import { TangentPlane } from "../core/geo";
import type { Vec2 } from "../core/vec";
import type { WaterDomain } from "../core/sim";

interface HarborBundle {
  def: HarborDefinition;
  water: WaterGeoJSON;
}

const bundles: Record<string, HarborBundle> = {
  "newport-harbor": {
    def: harborJson as unknown as HarborDefinition,
    water: waterJSON as unknown as WaterGeoJSON,
  },
};

export function getHarbor(id: string): HarborBundle {
  const b = bundles[id];
  if (!b) throw new Error(`Unknown harbor "${id}". Available: ${Object.keys(bundles).join(", ")}`);
  return b;
}

export function listHarbors(): string[] {
  return Object.keys(bundles);
}

/* ---------------- collision domain ---------------- */

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Navigable-water oracle over the harbor's water polygons, with a uniform
 * spatial grid so the 60 Hz physics step never scans every ring vertex.
 */
export class HarborWater implements WaterDomain {
  readonly plane: TangentPlane;
  private readonly cells = new Map<number, boolean>();
  private readonly cellSize: number; // degrees-ish; grid is in lng/lat

  constructor(
    private readonly def: HarborDefinition,
    private readonly water: WaterGeoJSON,
  ) {
    this.plane = new TangentPlane(def.lat0, def.lon0);
    this.cellSize = 0.0005; // ~50 m
    this.buildGrid();
  }

  private inAnyPolygon(lng: number, lat: number): boolean {
    const polys: number[][][][] = [];
    for (const f of this.water.features) {
      if (f.geometry.type === "Polygon") polys.push(f.geometry.coordinates);
      else polys.push(...f.geometry.coordinates);
    }
    for (const poly of polys) {
      if (!pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(lng, lat, poly[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    for (const ring of this.def.openWater ?? []) {
      if (pointInRing(lng, lat, ring)) return true;
    }
    return false;
  }

  private excluded(lng: number, lat: number): boolean {
    for (const b of this.def.excludeBboxes ?? []) {
      if (lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north) return true;
    }
    return false;
  }

  private isWaterLngLat(lng: number, lat: number): boolean {
    if (this.excluded(lng, lat)) return false;
    return this.inAnyPolygon(lng, lat);
  }

  private buildGrid(): void {
    const { bbox } = this.def;
    // cover the bbox with cells, evaluating the center point
    const nx = Math.ceil((bbox.east - bbox.west) / this.cellSize);
    const ny = Math.ceil((bbox.north - bbox.south) / this.cellSize);
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const lng = bbox.west + i * this.cellSize;
        const lat = bbox.south + j * this.cellSize;
        this.cells.set(this.key(Math.floor(lng / this.cellSize), Math.floor(lat / this.cellSize)), this.isWaterLngLat(lng, lat));
      }
    }
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 16384 + (cy + 4096);
  }

  /** Local-plane query used by the physics loop. */
  contains(p: Vec2): boolean {
    const [lng, lat] = this.plane.unproject(p);
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    const hit = this.cells.get(this.key(cx, cy));
    if (hit !== undefined) return hit;
    return this.isWaterLngLat(lng, lat);
  }

  /** lng/lat query used by UI (MOB markers etc.). */
  containsLngLat(lng: number, lat: number): boolean {
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    const hit = this.cells.get(this.key(cx, cy));
    if (hit !== undefined) return hit;
    return this.isWaterLngLat(lng, lat);
  }

  /** All water polygons in lng/lat (for map rendering). */
  waterSource(): { type: "FeatureCollection"; features: unknown[] } {
    const feats: unknown[] = this.water.features.map((f) => ({
      type: "Feature",
      properties: f.properties,
      geometry: f.geometry,
    }));
    for (const ring of this.def.openWater ?? []) {
      feats.push({
        type: "Feature",
        properties: { name: "Open water" },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
    return { type: "FeatureCollection", features: feats };
  }
}

export function loadWater(harborId: string): { def: HarborDefinition; water: HarborWater } {
  const { def, water } = getHarbor(harborId);
  return { def, water: new HarborWater(def, water) };
}
