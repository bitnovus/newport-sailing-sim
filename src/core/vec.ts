/** 2D vectors in a local East/North plane (x = east, y = north), meters. */
export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => v(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => v(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, s: number): Vec2 => v(a.x * s, a.y * s);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

/** Unit vector pointing along a compass heading (radians from north, clockwise). */
export const headingVec = (theta: number): Vec2 => v(Math.sin(theta), Math.cos(theta));

/** Unit vector pointing to starboard of a heading (heading rotated 90° clockwise). */
export const starboardVec = (theta: number): Vec2 => v(Math.cos(theta), -Math.sin(theta));

/** Signed angle from heading a to heading b, in (-PI, PI]. */
export const angleBetween = (a: number, b: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};
