import { DEG, wrapDeg } from "../units";
import { headingVec, starboardVec, sub, dot, len, type Vec2 } from "../vec";

/** True wind as reported meteorologically: speed (m/s) and direction FROM, deg. */
export interface TrueWind {
  speed: number;
  /** Direction the wind blows FROM, degrees clockwise from true north. */
  directionFrom: number;
}

export interface ApparentWind {
  /** Apparent wind speed, m/s. */
  speed: number;
  /** Apparent wind angle off the bow, signed degrees: + = from starboard. */
  angle: number;
  /** Apparent wind vector in the world plane (direction it blows TOWARD). */
  vector: Vec2;
}

/** True wind vector (the way the air moves) in the world plane. */
export function trueWindVector(tw: TrueWind): Vec2 {
  const toward = deg(tw.directionFrom + 180);
  return {
    x: tw.speed * Math.sin(toward),
    y: tw.speed * Math.cos(toward),
  };
}

const deg = (d: number) => d * DEG;

/**
 * Apparent wind = true wind vector − boat velocity through the air.
 * Leeway and current both affect the boat's ground-frame velocity; because
 * meteorological true wind is earth-relative, the caller supplies that full
 * ground velocity here.
 */
export function apparentWind(
  tw: TrueWind,
  boatHeading: number,
  boatVelocity: Vec2,
): ApparentWind {
  const awVec = sub(trueWindVector(tw), boatVelocity);
  const along = headingVec(boatHeading);
  const stbd = starboardVec(boatHeading);
  const fwd = dot(awVec, along);
  const lat = dot(awVec, stbd);
  // atan2(lat, fwd) is where the air is moving TOWARD; the wind angle is
  // where it comes FROM — 180° the other way.
  const angle = wrapDeg(Math.atan2(lat, fwd) / DEG - 180);
  return { speed: len(awVec), angle, vector: awVec };
}

export const twaOf = (tw: TrueWind, heading: number): number =>
  wrapDeg(tw.directionFrom - heading / DEG);
