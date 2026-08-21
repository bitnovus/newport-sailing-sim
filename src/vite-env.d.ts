/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_LIVE_WIND?: string;
  readonly VITE_OPEN_METEO_BASE_URL?: string;
  readonly VITE_OSM_TILE_URL?: string;
  readonly VITE_OPENSEAMAP_TILE_URL?: string;
  readonly VITE_SATELLITE_TILE_URL?: string;
  readonly VITE_SATELLITE_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
