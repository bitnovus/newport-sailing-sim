import type { Map as MLMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type BaseStyle = "satellite" | "chart";
export type ViewMode = "chase" | "chartplotter";

const ESRI_ATTR = "Imagery © Esri, Maxar, Earthstar Geographics";
const OSM_ATTR = "© OpenStreetMap contributors";

/**
 * Map canvas: Esri World Imagery satellite by default, OSM standard +
 * OpenSeaMap nautical overlay as the chart style. The camera is driven by
 * the sim (chase / chartplotter modes).
 */
export function createMap(container: HTMLElement, center: { lng: number; lat: number }): MLMap {
  const map = new maplibregl.Map({
    container,
    style: { version: 8, sources: {}, layers: [] },
    center: [center.lng, center.lat],
    zoom: 16.5,
    pitch: 60,
    bearing: 0,
    attributionControl: { compact: true },
    maxPitch: 80,
  });

  // NOTE: style layers can only be added after load; the caller wires that up
  // (see main.ts) so base + overlay ordering stays correct.
  return map;
}

export function setBaseStyle(map: MLMap, style: BaseStyle): void {
  for (const id of ["esri-satellite", "osm-standard", "openseamap"]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  if (style === "satellite") {
    map.addSource("esri-satellite", {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTR,
    });
    map.addLayer({ id: "esri-satellite", type: "raster", source: "esri-satellite" });
  } else {
    map.addSource("osm-standard", {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: OSM_ATTR,
    });
    map.addLayer({ id: "osm-standard", type: "raster", source: "osm-standard" });
    map.addSource("openseamap", {
      type: "raster",
      tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenSeaMap contributors",
    });
    map.addLayer({ id: "openseamap", type: "raster", source: "openseamap" });
  }
}

const shortestAngle = (from: number, to: number): number => {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

/** Camera controller: eased chase / chartplotter views following the boat. */
export class CameraRig {
  mode: ViewMode = "chase";
  /** User zoom offset added to the mode's base zoom (wheel / keys / buttons). */
  zoomOffset = 0;
  private bearing = 0;
  private pitch = 60;
  private zoom = 17.4;

  constructor(private readonly map: MLMap) {}

  /** Adjust the user zoom offset; clamped so the boat stays sensibly in frame. */
  nudgeZoom(delta: number): number {
    this.zoomOffset = Math.min(3.6, Math.max(-4.2, this.zoomOffset + delta));
    return this.targetZoom();
  }

  resetZoom(): void {
    this.zoomOffset = 0;
  }

  private targetZoom(): number {
    // beyond ~19 the satellite tiles over-zoom (softer background) but the
    // 3D geometry stays crisp — worth it for inspecting sail trim
    const base = this.mode === "chase" ? 17.4 : 15.8;
    return Math.min(21, Math.max(13, base + this.zoomOffset));
  }

  update(lng: number, lat: number, headingDeg: number, dt: number): void {
    let targetBearing: number;
    let targetPitch: number;
    if (this.mode === "chase") {
      targetBearing = headingDeg;
      targetPitch = 62;
    } else {
      targetBearing = 0; // north-up
      targetPitch = 0;
    }
    const k = 1 - Math.exp(-dt * 5);
    this.bearing += shortestAngle(this.bearing, targetBearing) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.zoom += (this.targetZoom() - this.zoom) * k;
    this.map.jumpTo({
      center: [lng, lat],
      bearing: this.bearing,
      pitch: this.pitch,
      zoom: this.zoom,
    });
  }
}
