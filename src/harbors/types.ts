import type { BBox } from "../core/geo";

/** A fixed navigation mark (buoy, daymark) in the harbor. */
export interface Mark {
  id: string;
  name: string;
  lng: number;
  lat: number;
  kind: "red" | "green" | "yellow" | "white";
}

/**
 * A harbor is data: an anchor coordinate, start pose, current, marks, and the
 * water geometry (checked-in GeoJSON + declarative patches for OSM quirks).
 */
export interface HarborDefinition {
  id: string;
  name: string;
  /** Tangent-plane anchor. */
  lat0: number;
  lon0: number;
  bbox: BBox;
  /** Start pose. */
  start: { lng: number; lat: number; headingDeg: number };
  /** Uniform tidal current (m/s East/North). */
  current: { x: number; y: number };
  marks: Mark[];
  /** Extra water polygons (e.g. open ocean a data pull skipped). */
  openWater?: number[][][];
  /** Water polygons to REMOVE (OSM data quirks covering land). */
  excludeBboxes?: BBox[];
}

export interface WaterGeoJSON {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, string | number>;
    geometry:
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] };
  }[];
}
