import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindSample } from "../src/core/environment";
import { OpenMeteoWind } from "../src/providers/open-meteo";

const fallback: WindSample = {
  speed: 2,
  directionFrom: 250,
  gust: 3,
  source: "manual",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenMeteoWind", () => {
  it("uses the configured endpoint and maps the current wind sample", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          current: {
            time: "2026-08-20T12:00",
            wind_speed_10m: 4,
            wind_direction_10m: 270,
            wind_gusts_10m: 3,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenMeteoWind(33.6, -117.9, fallback, "https://weather.example/api");
    provider.start();

    await vi.waitFor(() => expect(provider.current().source).toBe("Open-Meteo"));
    provider.stop();

    const requested = fetchMock.mock.calls[0]?.[0];
    expect(requested).toBeInstanceOf(URL);
    const url = requested as URL;
    expect(url.origin + url.pathname).toBe("https://weather.example/api/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("33.6");
    expect(url.searchParams.get("longitude")).toBe("-117.9");
    expect(url.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(provider.current()).toMatchObject({
      speed: 4,
      directionFrom: 270,
      gust: 4,
      time: "2026-08-20T12:00",
    });
  });

  it("fails soft and keeps the fallback sample", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const provider = new OpenMeteoWind(33.6, -117.9, fallback);

    provider.start();
    await vi.waitFor(() => expect(provider.status).toContain("offline"));
    provider.stop();

    expect(provider.current()).toBe(fallback);
  });

  it("fails soft for an invalid configured endpoint", async () => {
    const provider = new OpenMeteoWind(33.6, -117.9, fallback, "not a URL");

    provider.start();
    await vi.waitFor(() => expect(provider.status).toContain("offline"));
    provider.stop();

    expect(provider.current()).toBe(fallback);
  });
});
