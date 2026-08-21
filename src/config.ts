export interface MapTileConfig {
  osmUrl: string;
  seamarkUrl: string;
  satellite?: {
    url: string;
    attribution: string;
  };
}

export interface AppConfig {
  liveWindEnabled: boolean;
  openMeteoBaseUrl: string;
  mapTiles: MapTileConfig;
}

export interface AppConfigEnv {
  VITE_ENABLE_LIVE_WIND?: string;
  VITE_OPEN_METEO_BASE_URL?: string;
  VITE_OSM_TILE_URL?: string;
  VITE_OPENSEAMAP_TILE_URL?: string;
  VITE_SATELLITE_TILE_URL?: string;
  VITE_SATELLITE_ATTRIBUTION?: string;
}

const enabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

/**
 * Public builds use manual wind and community map tiles by default. Operators
 * must deliberately enable hosted services whose terms depend on their use.
 * VITE_* values are public browser configuration, never secret storage.
 */
export function readAppConfig(env: AppConfigEnv): AppConfig {
  const satelliteUrl = env.VITE_SATELLITE_TILE_URL?.trim();
  const satelliteAttribution = env.VITE_SATELLITE_ATTRIBUTION?.trim();

  if ((satelliteUrl && !satelliteAttribution) || (!satelliteUrl && satelliteAttribution)) {
    throw new Error(
      "VITE_SATELLITE_TILE_URL and VITE_SATELLITE_ATTRIBUTION must be configured together",
    );
  }

  return {
    liveWindEnabled: enabled(env.VITE_ENABLE_LIVE_WIND),
    openMeteoBaseUrl: env.VITE_OPEN_METEO_BASE_URL?.trim() || "https://api.open-meteo.com",
    mapTiles: {
      osmUrl:
        env.VITE_OSM_TILE_URL?.trim() || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      seamarkUrl:
        env.VITE_OPENSEAMAP_TILE_URL?.trim() ||
        "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
      satellite:
        satelliteUrl && satelliteAttribution
          ? { url: satelliteUrl, attribution: satelliteAttribution }
          : undefined,
    },
  };
}

export const appConfig = readAppConfig(import.meta.env);
