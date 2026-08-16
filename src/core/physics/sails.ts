import type { BoatDefinition, SailDefinition } from "../../boats/types";
import { clamp, DEG } from "../units";
import type { ApparentWind } from "./wind";

export const AIR_DENSITY = 1.225;

/** Sail force resolved in the boat frame. All SI. */
export interface SailForce {
  /** Forward drive, N (+ = toward the bow). */
  drive: number;
  /** Lateral side force, N (+ = toward starboard). */
  side: number;
  /** Yaw moment about the boat's center, N·m (+ = bow turns to starboard). */
  yaw: number;
  /** Heeling moment, N·m (+ = heels to starboard). */
  heel: number;
  /** 0..1 how much of the sail is working: 1 = fully flowing, 0 = luffing. */
  flow: number;
}

export interface SailSolution extends SailForce {
  sailId: string;
  /** Boom angle used, degrees off centerline, + = to starboard. */
  boomAngle: number;
  /** True if this sail is currently luffing (used for visuals + "sail set" cues). */
  luffing: boolean;
}

/**
 * Angle-of-attack aerodynamics for a Bermudan sail. `alphaDeg` is signed
 * relative to the sail's own side: negative means the apparent wind is
 * forward of the chord (over-eased, or backwinded mid-tack) — cloth flogs
 * there and the steady force collapses to flutter drag, never a filled
 * plate. Positive: luffing below ~6°, attached flow to ~22°, soft stall
 * beyond, drag-dominated by 90° (running).
 */
export function sailCoefficients(alphaDeg: number): { cl: number; cd: number } {
  if (alphaDeg < 0) {
    // backwinded / flogging: no lift, modest flutter drag only
    const a = Math.min(-alphaDeg, 90);
    return { cl: 0, cd: 0.05 + 0.27 * (a / 90) };
  }
  const a = alphaDeg;
  if (a < 6) {
    // luffing: no meaningful lift, flutter drag
    return { cl: 0, cd: 0.05 + 0.1 * (a / 6) };
  }
  if (a <= 18) {
    // attached flow: steep lift ramp to max at ~18°
    const cl = 1.55 * ((a - 6) / 12);
    const cd = 0.06 + 0.02 * (a - 6);
    return { cl, cd };
  }
  if (a <= 50) {
    // soft stall: lift falls off, drag climbs
    const t = (a - 18) / 32;
    const cl = 1.55 - 0.95 * t;
    const cd = 0.3 + 0.9 * t;
    return { cl, cd };
  }
  // separated / running: drag plate
  const t = Math.min(1, (a - 50) / 40);
  const cl = 0.6 * (1 - t);
  const cd = 1.2 + 0.48 * t;
  return { cl, cd };
}

/** Luffing fraction for visuals: 1 = fully luffing (flapping). */
export function luffFraction(alphaDeg: number): number {
  if (alphaDeg < 0) return 1; // backwinded sail flogs hard
  const a = alphaDeg;
  if (a >= 8) return 0;
  if (a <= 4) return 1;
  return (8 - a) / 4;
}

/**
 * Ideal boom angle for a given apparent wind angle (deg, signed, + stbd):
 * sheeted in tight upwind, progressively eased on reaches, squared away running.
 */
export function idealBoomAngle(awaDeg: number): number {
  const a = Math.abs(awaDeg);
  const mag = Math.sign(awaDeg) || 1;
  if (a <= 32) return mag * clamp(a * 0.35, 5, 11);
  if (a <= 90) return mag * clamp(10 + (a - 32) * 0.6, 10, 58);
  if (a <= 150) return mag * clamp(45 + (a - 90) * 0.45, 45, 72);
  return mag * clamp(72 + (a - 150) * 0.26, 72, 85);
}

/**
 * Resting angle of a freely hinged, sheeted boom. The unrestrained sail
 * aligns with the apparent wind and luffs; a tighter sheet catches it at the
 * selected maximum angle so wind pressure can load it and make useful force.
 */
export function sheetedBoomRestAngle(
  sail: SailDefinition,
  awaDeg: number,
  sheetLimitDeg: number,
): number {
  const policy = sail.trim;
  const limit = clamp(Math.abs(sheetLimitDeg), policy.min, policy.max);
  return clamp(awaDeg, -limit, limit);
}

export interface BoomKinematics {
  angleDeg: number;
  rateDeg: number;
}

/**
 * Advance a freely swinging sail boom. Apparent-wind pressure supplies torque
 * about its pivot; inertia and damping make a tack/jibe a sweep rather than a
 * commanded animation. Its sheet is a unilateral stop: it
 * arrests outward motion but never forces the boom out to the selected angle.
 */
export function stepSheetedBoom(
  sail: SailDefinition,
  awa: ApparentWind,
  sheetLimitDeg: number,
  current: BoomKinematics,
  dt: number,
): BoomKinematics {
  const policy = sail.trim;
  if (dt <= 0) return current;

  const limit = clamp(Math.abs(sheetLimitDeg), policy.min, policy.max);
  let angleDeg = clamp(current.angleDeg, -limit, limit);
  let rateRad = clamp(
    current.rateDeg,
    -policy.maxBoomRate,
    policy.maxBoomRate,
  ) * DEG;

  // A sail can only present roughly a broadside normal force. Clamping the
  // error also gives the right unambiguous crash direction when AWA wraps at
  // the stern from +180° to −180° during a jibe.
  const incidence = clamp(awa.angle - angleDeg, -90, 90) * DEG;
  const pressureForce = 0.5 * AIR_DENSITY * awa.speed ** 2 * sail.area;
  const aerodynamicTorque = pressureForce * policy.boomLever * Math.sin(incidence);
  const accelerationRad =
    aerodynamicTorque / policy.boomInertia - policy.boomDamping * rateRad;

  rateRad = clamp(
    rateRad + accelerationRad * dt,
    -policy.maxBoomRate * DEG,
    policy.maxBoomRate * DEG,
  );
  angleDeg += (rateRad / DEG) * dt;

  // A taut sheet absorbs only outward velocity. Inward wind torque remains
  // free to unload the line and swing the boom back through centerline.
  if (angleDeg >= limit) {
    angleDeg = limit;
    if (rateRad > 0) rateRad = 0;
  } else if (angleDeg <= -limit) {
    angleDeg = -limit;
    if (rateRad < 0) rateRad = 0;
  }

  return { angleDeg, rateDeg: rateRad / DEG };
}

/**
 * Static equilibrium for the self-tacking jib when no kinematic boom state is
 * supplied. Its sheet is a limit; the club boom may rest anywhere inside it.
 */
export function selfTackingTrim(
  sail: SailDefinition,
  awaDeg: number,
  trimAngleDeg: number,
): number {
  const policy = sail.trim;
  if (policy.kind !== "selfTacking") return idealBoomAngle(awaDeg);
  return sheetedBoomRestAngle(sail, awaDeg, trimAngleDeg);
}

/** Efficiency loss from the jib's fixed sheeting geometry near the extremes. */
export function selfTackingEfficiency(sail: SailDefinition, awaDeg: number): number {
  const policy = sail.trim;
  if (policy.kind !== "selfTacking") return 1;
  const a = Math.abs(awaDeg);
  // U-shaped penalty: fully efficient from 40°..110°, fades outside
  let penalty = 0;
  if (a < 40) penalty = (40 - a) / 40;
  if (a > 110) penalty = (a - 110) / 70;
  return 1 - (1 - policy.efficiency) * clamp(penalty, 0, 1);
}

/**
 * Sail force for one sail. awa from apparentWind(), boomAngle in degrees
 * (+ = boom to starboard), heel in radians (de-powers the rig).
 */
export function solveSail(
  sail: SailDefinition,
  awa: ApparentWind,
  boomAngle: number,
  heel: number,
): SailSolution {
  const awaDeg = awa.angle;
  // incidence in the sail's own frame: positive when the wind is on the
  // boom's side of the bow, negative when forward of the chord or on the
  // opposite side (mid-tack backwind)
  const boomSide = Math.sign(boomAngle) || 1;
  const alpha = awaDeg * boomSide - Math.abs(boomAngle);
  const a = Math.abs(awaDeg);

  let { cl, cd } = sailCoefficients(alpha);
  const eff = selfTackingEfficiency(sail, awaDeg);
  cl *= eff;
  cd = cd * eff + 0.03; // parasitic drag always present

  // blanketing: a sail behind another (jib behind main downwind) loses flow
  if (a > sail.blanketedAboveAwa) {
    const t = clamp((a - sail.blanketedAboveAwa) / (180 - sail.blanketedAboveAwa + 1), 0, 1);
    const factor = 1 - 0.75 * t;
    cl *= factor;
    cd *= factor;
  }

  // heel spills power
  const heelFactor = Math.cos(heel) ** 1.5;
  cl *= heelFactor;

  const q = 0.5 * AIR_DENSITY * awa.speed ** 2 * sail.area;
  const lift = q * cl;
  const drag = q * cd;

  // Apparent wind direction the boat feels, as a unit vector in the boat frame
  // (x = starboard, y = forward). Wind FROM awaDeg → moving toward awaDeg+180.
  const awRad = awaDeg * DEG;
  const fromStbd = Math.sin(awRad);
  // flow moves opposite to where it comes from
  const flowStbd = -fromStbd;
  const flowFwd = -Math.cos(awRad);

  // drag acts along the flow; lift is perpendicular to the flow, pointing
  // forward-and-to-leeward (the sail deflects flow aft, reaction drives ahead)
  const dragStbd = drag * flowStbd;
  const dragFwd = drag * flowFwd;
  const s = Math.sign(fromStbd || 1);
  const liftStbd = lift * flowFwd * s;
  const liftFwd = -lift * flowStbd * s;

  const side = dragStbd + liftStbd;
  const drive = dragFwd + liftFwd;

  const flow = 1 - luffFraction(alpha);
  return {
    sailId: sail.id,
    boomAngle,
    drive,
    side,
    yaw: sail.effortArm * side,
    // heeling moment pushes the rig to leeward — same sign as the side force
    heel: side * sail.effortHeight,
    flow,
    luffing: luffFraction(alpha) > 0.5,
  };
}

export interface RigSolution {
  total: SailForce;
  sails: SailSolution[];
}

/**
 * Sum forces over all sails, honoring the independent main and jib trim. When
 * `actualBooms` is provided (per-sail signed angles), those are used instead
 * of policy targets — the sim's sheeted boom is wind-driven and carries
 * angular momentum through tacks and jibes.
 */
export function solveRig(
  boat: BoatDefinition,
  awa: ApparentWind,
  sheetAngleDeg: number,
  jibAngleDeg: number,
  heel: number,
  actualBooms?: Record<string, number>,
): RigSolution {
  const total: SailForce = { drive: 0, side: 0, yaw: 0, heel: 0, flow: 0 };
  const sails: SailSolution[] = [];
  let flowSum = 0;
  for (const sail of boat.sails) {
    let boom: number;
    if (actualBooms && sail.id in actualBooms) {
      boom = actualBooms[sail.id];
    } else if (sail.trim.kind === "sheet") {
      boom = sheetedBoomRestAngle(sail, awa.angle, sheetAngleDeg);
    } else {
      boom = selfTackingTrim(sail, awa.angle, jibAngleDeg);
    }
    const sol = solveSail(sail, awa, boom, heel);
    sails.push(sol);
    total.drive += sol.drive;
    total.side += sol.side;
    total.yaw += sol.yaw;
    total.heel += sol.heel;
    total.flow += sol.flow * sail.area;
    flowSum += sail.area;
  }
  total.flow = flowSum > 0 ? total.flow / flowSum : 0;
  return { total, sails };
}
