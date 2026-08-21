import { describe, expect, it } from "vitest";
import { loadWater } from "../src/harbors/registry";

const { def, water } = loadWater("newport-harbor");

describe("Newport Harbor collision domain", () => {
  it("starts in open water near the OCC School of Sailing", () => {
    const school = water.plane.project(-117.91811, 33.61689);
    const start = water.plane.project(def.start.lng, def.start.lat);

    expect(Math.hypot(start.x - school.x, start.y - school.y)).toBeLessThan(150);
    expect(water.containsLngLat(def.start.lng, def.start.lat)).toBe(true);

    // Leave enough room for the boat to spawn clear of the modeled shoreline.
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const [lng, lat] = water.plane.unproject({
        x: start.x + Math.cos(angle) * 50,
        y: start.y + Math.sin(angle) * 50,
      });
      expect(water.containsLngLat(lng, lat)).toBe(true);
    }
  });

  it("the entrance channel connects the ocean to the harbor", () => {
    // ocean → jetty mouth → channel → basin → north–south channel → harbor
    expect(water.containsLngLat(-117.9385, 33.5988)).toBe(true);
    expect(water.containsLngLat(-117.9365, 33.5990)).toBe(true);
    expect(water.containsLngLat(-117.9345, 33.5984)).toBe(true);
    expect(water.containsLngLat(-117.9310, 33.5978)).toBe(true);
    expect(water.containsLngLat(-117.9245, 33.6025)).toBe(true);
    expect(water.containsLngLat(-117.9240, 33.6070)).toBe(true);
    expect(water.containsLngLat(-117.9237, 33.6105)).toBe(true); // joins polygon
  });

  it("islands and landmasses ground the boat", () => {
    expect(water.containsLngLat(-117.9070, 33.6060)).toBe(false); // Lido Isle
    expect(water.containsLngLat(-117.9368, 33.6214)).toBe(false); // OSM bulge
    expect(water.containsLngLat(-117.8750, 33.5920)).toBe(false); // Corona del Mar
  });

  it("Balboa Peninsula is land, not open water", () => {
    // regression: the openWater rectangle used to blanket the peninsula
    expect(water.containsLngLat(-117.9400, 33.5920)).toBe(false); // mid-peninsula
    expect(water.containsLngLat(-117.9440, 33.5915)).toBe(false); // west end
    expect(water.containsLngLat(-117.9420, 33.5950)).toBe(false); // north edge
  });

  it("real ocean stays sailable around the peninsula", () => {
    expect(water.containsLngLat(-117.9580, 33.5900)).toBe(true); // west of tip
    expect(water.containsLngLat(-117.9460, 33.5845)).toBe(true); // south shore swell
    expect(water.containsLngLat(-117.9375, 33.5995)).toBe(true); // outside jetty
  });
});
