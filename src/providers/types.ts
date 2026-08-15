import type { WindSample } from "../core/environment";

/**
 * Wind data source. Implementations must be safe to poll and should resolve
 * with the most recent sample they can get; they never throw to the caller.
 */
export interface WindProvider {
  readonly name: string;
  /** Human-readable state for the HUD ("live · Open-Meteo", "manual"). */
  readonly status: string;
  /** Latest sample (starts as a sane default until the first fetch lands). */
  current(): WindSample;
  /** Preferred polling interval, ms. */
  readonly pollMs: number;
}

/* ------------------------------------------------------------------ */
/* AIS — future integration seam.                                      */
/*                                                                     */
/* The sim renders anything implementing AisProvider. The intended      */
/* first implementation is aisstream.io (free WebSocket API, key via    */
/* signup at https://aisstream.io): subscribe to PositionReports for    */
/* the harbor bbox, decode MetaData + PositionReport fields into the   */
/* Vessel shape below, and dead-reckon between updates with            */
/* extrapolateVessel(). No UI work is needed beyond a vessel layer.     */
/* ------------------------------------------------------------------ */

export interface Vessel {
  mmsi: number;
  name?: string;
  /** Position and motion at `timestamp`. */
  lng: number;
  lat: number;
  /** Course over ground, deg true. */
  cog: number;
  /** Speed over ground, m/s. */
  sog: number;
  /** True heading if reported, else cog. */
  heading: number;
  lengthM?: number;
  beamM?: number;
  /** AIS ship type code (e.g. 36 sailing, 37 pleasure craft, 30 fishing). */
  type?: number;
  timestamp: number;
}

export interface AisProvider {
  readonly name: string;
  /** Snapshot of tracked vessels (already deduped per MMSI). */
  vessels(): Vessel[];
}

/** Dead-reckon a vessel forward to `nowMs` (between position reports). */
export function extrapolateVessel(v: Vessel, nowMs: number): Vessel {
  const dt = Math.min(120, (nowMs - v.timestamp) / 1000); // cap 2 min
  const cogRad = (v.cog * Math.PI) / 180;
  const d = v.sog * dt;
  return {
    ...v,
    lng: v.lng + (d * Math.sin(cogRad)) / (111320 * Math.cos((v.lat * Math.PI) / 180)),
    lat: v.lat + (d * Math.cos(cogRad)) / 110540,
  };
}
