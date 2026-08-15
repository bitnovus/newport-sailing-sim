export const KNOT = 0.514444; // m/s per knot
export const DEG = Math.PI / 180; // rad per degree

export const kn = (k: number): number => k * KNOT;
export const toKn = (ms: number): number => ms / KNOT;
export const deg = (d: number): number => d * DEG;
export const toDeg = (r: number): number => r / DEG;

/** Normalize angle to (-180, 180] degrees */
export const wrapDeg = (d: number): number => {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
};

/** Normalize angle to (-PI, PI] radians */
export const wrapRad = (r: number): number => {
  let x = r % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
