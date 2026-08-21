import type { WindSample } from "../core/environment";
import { kn } from "../core/units";
import type { WindProvider } from "./types";

interface OpenMeteoResponse {
  current?: {
    time: string;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    interval?: number;
  };
}

/**
 * Current forecast wind from an operator-configured Open-Meteo endpoint.
 * Polls every 10 min; between polls the Environment keeps gusting locally.
 * Fails soft: keeps the last sample forever; falls back to the manual
 * provider's last value if we've never fetched.
 */
export class OpenMeteoWind implements WindProvider {
  readonly name = "Open-Meteo";
  readonly pollMs = 10 * 60 * 1000;
  status = "connecting…";

  private sample: WindSample;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly lat: number,
    private readonly lon: number,
    fallback: WindSample,
    private readonly baseUrl = "https://api.open-meteo.com",
  ) {
    this.sample = fallback;
  }

  current(): WindSample {
    return this.sample;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      const url = new URL("v1/forecast", `${this.baseUrl.replace(/\/$/, "")}/`);
      url.searchParams.set("latitude", String(this.lat));
      url.searchParams.set("longitude", String(this.lon));
      url.searchParams.set(
        "current",
        "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      );
      url.searchParams.set("wind_speed_unit", "ms");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OpenMeteoResponse;
      const c = json.current;
      if (!c) throw new Error("no current block");
      this.sample = {
        speed: c.wind_speed_10m,
        directionFrom: c.wind_direction_10m,
        gust: Math.max(c.wind_gusts_10m, c.wind_speed_10m),
        time: c.time,
        source: this.name,
      };
      this.status = `live · updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      this.status = `offline (${String(e)}) — using last sample`;
    }
  }
}

/** Manual wind for testing / calm days / offline. */
export class ManualWind implements WindProvider {
  readonly name = "Manual";
  readonly pollMs = 0;
  status = "manual";

  constructor(private sample: WindSample) {}

  current(): WindSample {
    return this.sample;
  }

  set(speedKn: number, directionFrom: number): void {
    this.sample = {
      speed: kn(speedKn),
      directionFrom,
      gust: kn(speedKn * 1.15),
      source: this.name,
    };
  }
}
