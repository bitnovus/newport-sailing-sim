import type { Vec2 } from "./vec";

const R_EARTH = 6378137; // WGS84 equatorial radius, m

/**
 * Local tangent-plane projection about an anchor point. Accurate to a few cm
 * over harbor scales (~10 km) — plenty for a sailing sim, and keeps the whole
 * physics core in flat 2D meters.
 */
export class TangentPlane {
  readonly lat0: number;
  readonly lon0: number;
  private readonly mPerDegLat: number;
  private readonly mPerDegLon: number;

  constructor(lat0: number, lon0: number) {
    this.lat0 = lat0;
    this.lon0 = lon0;
    const latRad = (lat0 * Math.PI) / 180;
    this.mPerDegLat = (Math.PI / 180) * R_EARTH;
    this.mPerDegLon = (Math.PI / 180) * R_EARTH * Math.cos(latRad);
  }

  /** lng/lat → local East/North meters. */
  project(lng: number, lat: number): Vec2 {
    return {
      x: (lng - this.lon0) * this.mPerDegLon,
      y: (lat - this.lat0) * this.mPerDegLat,
    };
  }

  /** local East/North meters → [lng, lat]. */
  unproject(p: Vec2): [number, number] {
    return [
      this.lon0 + p.x / this.mPerDegLon,
      this.lat0 + p.y / this.mPerDegLat,
    ];
  }
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}
