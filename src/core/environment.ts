import { clamp } from "./units";
import type { TrueWind } from "./physics/wind";
import type { Vec2 } from "./vec";

/**
 * Sailing environment: true wind + gust process + tidal current.
 * The wind provider hands us a smoothed sample; here we add live variation
 * so the helm has something real to react to.
 */
export interface WindSample {
  speed: number;
  directionFrom: number;
  /** Reported gust speed (m/s), ≥ speed. */
  gust: number;
  /** ISO time of the sample if known. */
  time?: string;
  source: string;
}

export class Environment {
  private base: WindSample;
  private gustN = 0;
  private dirN = 0;
  /** Deterministic RNG so headless runs replay identically. */
  private seed: number;

  /** Uniform tidal current in the harbor (m/s, world frame). */
  current: Vec2 = { x: 0, y: 0 };

  constructor(base: WindSample, seed = 42) {
    this.base = base;
    this.seed = seed > 0 ? seed : 1;
  }

  updateWind(sample: WindSample): void {
    this.base = sample;
  }

  get sample(): WindSample {
    return this.base;
  }

  private rand(): number {
    // xorshift32 → uniform (0,1)
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296 + 0.5e-9;
  }

  private gauss(): number {
    // Box-Muller
    const u1 = this.rand();
    const u2 = this.rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Instantaneous true wind: smooth base + Ornstein-Uhlenbeck gusts whose
   * variance scales with the reported gust excess, plus a few degrees of
   * direction wander.
   */
  windAt(timeSec: number, dt: number): TrueWind {
    const gustExcess = Math.max(0, this.base.gust - this.base.speed);
    const sigma = 0.08 * this.base.speed + 0.35 * gustExcess;
    const tau = 8; // s
    this.gustN += (-this.gustN / tau) * dt + (sigma * Math.sqrt(dt) * this.gauss()) / Math.sqrt(2 * tau);
    this.gustN = clamp(this.gustN, -2.5 * sigma, 2.5 * sigma);

    const dirSigma = 2.5; // deg
    this.dirN += (-this.dirN / 15) * dt + (dirSigma * Math.sqrt(dt) * this.gauss()) / Math.sqrt(2 * 15);
    this.dirN = clamp(this.dirN, -10, 10);
    void timeSec;

    const speed = Math.max(0, this.base.speed + this.gustN);
    return { speed, directionFrom: this.base.directionFrom + this.dirN };
  }
}
