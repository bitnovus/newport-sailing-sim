import { describe, expect, it } from "vitest";
import { readAppConfig } from "../src/config";

describe("public configuration", () => {
  it("defaults to manual wind and no imagery provider", () => {
    const config = readAppConfig({});

    expect(config.liveWindEnabled).toBe(false);
    expect(config.mapTiles.satellite).toBeUndefined();
    expect(config.mapTiles.osmUrl).toContain("openstreetmap.org");
    expect(config.mapTiles.seamarkUrl).toContain("openseamap.org");
  });

  it("accepts an opt-in provider only with visible attribution", () => {
    const config = readAppConfig({
      VITE_ENABLE_LIVE_WIND: "true",
      VITE_SATELLITE_TILE_URL: "https://tiles.example/{z}/{x}/{y}.png",
      VITE_SATELLITE_ATTRIBUTION: "Example Maps",
    });

    expect(config.liveWindEnabled).toBe(true);
    expect(config.mapTiles.satellite).toEqual({
      url: "https://tiles.example/{z}/{x}/{y}.png",
      attribution: "Example Maps",
    });
  });

  it("rejects imagery without attribution", () => {
    expect(() =>
      readAppConfig({
        VITE_SATELLITE_TILE_URL: "https://tiles.example/{z}/{x}/{y}.png",
      }),
    ).toThrow(/must be configured together/);
  });
});
