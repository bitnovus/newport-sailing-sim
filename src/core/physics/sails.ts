import type { BoatDefinition, SailDefinition } from "../../boats/types";
import { clamp, DEG, wrapDeg } from "../units";
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
  /** True when a headsail is deliberately held to windward for wing-and-wing. */
  winged: boolean;
  /** True when a leeward headsail is losing/recovering flow in the main's shadow. */
  winking: boolean;
}

/**
 * Angle-of-attack aerodynamics for a Bermudan sail. `alphaDeg` is signed
 * relative to the sail's own side: negative means the apparent wind is
 * forward of the chord (over-eased, or backwinded mid-tack) — cloth flogs
 * there and the steady force collapses to flutter drag, never a filled
 * plate. Positive: luffing below ~6°, attached flow to ~22°, soft stall
 * beyond, drag-dominated by 90° (running). Past broadside, projected area
 * falls again: an over-sheeted sail nearly aligned with the flow cannot keep
 * producing broadside drag.
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
  if (a <= 90) {
    // separated / running: drag plate approaching maximum projected area
    const t = (a - 50) / 40;
    const cl = 0.6 * (1 - t);
    const cd = 1.2 + 0.48 * t;
    return { cl, cd };
  }

  // Wind arriving from aft of the chord sees progressively less projected
  // area. Retain a little cloth/flutter drag as incidence approaches 180°.
  const reverseIncidence = Math.max(0, 180 - Math.min(a, 180));
  const projection = Math.sin(reverseIncidence * DEG);
  return { cl: 0, cd: 0.05 + 1.63 * projection ** 2 };
}

/** Luffing fraction for visuals: 1 = fully luffing (flapping). */
export function luffFraction(alphaDeg: number): number {
  if (alphaDeg < 0) return 1; // backwinded sail flogs hard
  const a = alphaDeg;
  if (a > 90) {
    const reverseIncidence = Math.max(0, 180 - Math.min(a, 180));
    return 1 - Math.sin(reverseIncidence * DEG);
  }
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
  // The attached-flow force curve peaks near 18° incidence, so easing the
  // boom roughly one degree for each degree the apparent wind moves aft keeps
  // the sail near that groove until the 85° running stop is reached.
  return mag * clamp(a - 18, 5, 85);
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

export interface FreeBoomForcing {
  /** Fraction of clear-air pressure reaching the sail, 0..1. */
  pressureScale?: number;
  /** Centering acceleration coefficient, s⁻², for an unloaded club boom. */
  centeringStrength?: number;
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
  forcing: FreeBoomForcing = {},
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
  const pressureScale = clamp(forcing.pressureScale ?? 1, 0, 1);
  const pressureForce = 0.5 * AIR_DENSITY * awa.speed ** 2 * sail.area * pressureScale;
  const aerodynamicTorque = pressureForce * policy.boomLever * Math.sin(incidence);
  const centeringAcceleration =
    -Math.max(0, forcing.centeringStrength ?? 0) * angleDeg * DEG;
  const accelerationRad =
    aerodynamicTorque / policy.boomInertia -
    policy.boomDamping * rateRad +
    centeringAcceleration;

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
 * Move a club-boomed jib to a selected side under crew/winger control. The
 * finite, critically damped sweep represents throwing the boom to weather or
 * hauling a class-legal jib winger; once set, the control holds the boom out.
 */
export function stepWingedBoom(
  sail: SailDefinition,
  sheetLimitDeg: number,
  side: number,
  current: BoomKinematics,
  dt: number,
): BoomKinematics {
  const policy = sail.trim;
  if (dt <= 0) return current;

  const limit = clamp(Math.abs(sheetLimitDeg), policy.min, policy.max);
  const target = (Math.sign(side) || 1) * limit;
  let angleDeg = clamp(current.angleDeg, -limit, limit);
  let rateDeg = clamp(current.rateDeg, -policy.maxBoomRate, policy.maxBoomRate);
  const error = target - angleDeg;
  const response = 2.2;
  const accelerationDeg = response ** 2 * error - 2 * response * rateDeg;

  rateDeg = clamp(
    rateDeg + accelerationDeg * dt,
    -policy.maxBoomRate,
    policy.maxBoomRate,
  );
  angleDeg += rateDeg * dt;

  if (error !== 0 && Math.sign(target - angleDeg) !== Math.sign(error)) {
    angleDeg = target;
    rateDeg = 0;
  }

  return { angleDeg, rateDeg };
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

/** Clear-air fraction remaining behind the mainsail on deep downwind angles. */
export function downwindExposure(
  sail: SailDefinition,
  awaDeg: number,
  blanketed = true,
): number {
  if (!blanketed) return 1;
  const a = Math.abs(awaDeg);
  if (a <= sail.blanketedAboveAwa || sail.blanketedAboveAwa >= 180) return 1;
  const t = clamp(
    (a - sail.blanketedAboveAwa) / (180 - sail.blanketedAboveAwa),
    0,
    1,
  );
  return 1 - 0.75 * t;
}

export interface SailFlowContext {
  /** Sail is held on its reverse face, opposite the mainsail. */
  winged?: boolean;
  /** Sail lies behind the mainsail rather than in clear air. */
  blanketed?: boolean;
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
  context: SailFlowContext = {},
): SailSolution {
  const awaDeg = awa.angle;
  // incidence in the sail's own frame: positive when the wind is on the
  // boom's side of the bow, negative when forward of the chord or on the
  // opposite side (mid-tack backwind)
  const boomSide = Math.sign(boomAngle) || 1;
  const signedAlpha = awaDeg * boomSide - Math.abs(boomAngle);
  // A deliberately winged jib is held on the reverse face. Flexible cloth
  // cannot sustain that state by itself, so it is enabled only by the winger
  // context supplied by the rig solver.
  const alpha = context.winged ? Math.abs(wrapDeg(signedAlpha)) : signedAlpha;

  let { cl, cd } = sailCoefficients(alpha);
  const eff = selfTackingEfficiency(sail, awaDeg);
  cl *= eff;
  cd = cd * eff + 0.03; // parasitic drag always present
  if (context.winged) {
    // The sail is cut to carry draft on its normal face. A club boom can hold
    // the reverse face open, but its inverted shape is less effective than
    // the designed leeward-side foil.
    cl *= 0.55;
    cd *= 0.55;
  }

  // A leeward jib loses both force and visual fill in the main's wake. As the
  // boat bears away, changing flow makes the jib partially collapse and
  // recover—the "wink" used as a deep-broad-reach cue.
  const exposure = downwindExposure(sail, awaDeg, context.blanketed ?? true);
  cl *= exposure;
  cd *= exposure;

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

  const baseFlow = context.winged ? 1 : 1 - luffFraction(alpha);
  const flow = baseFlow * exposure;
  const winking = !context.winged && exposure < 0.82 && baseFlow > 0.5;
  return {
    sailId: sail.id,
    boomAngle,
    drive,
    side,
    yaw: sail.effortArm * side,
    // heeling moment pushes the rig to leeward — same sign as the side force
    heel: side * sail.effortHeight,
    flow,
    luffing: flow < 0.5,
    winged: context.winged ?? false,
    winking,
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
  wingedSails: ReadonlySet<string> = new Set(),
): RigSolution {
  const total: SailForce = { drive: 0, side: 0, yaw: 0, heel: 0, flow: 0 };
  const sails: SailSolution[] = [];
  let flowSum = 0;

  const boomById: Record<string, number> = {};
  for (const sail of boat.sails) {
    let boom: number;
    if (actualBooms && sail.id in actualBooms) {
      boom = actualBooms[sail.id];
    } else if (sail.trim.kind === "sheet") {
      boom = sheetedBoomRestAngle(sail, awa.angle, sheetAngleDeg);
    } else {
      boom = selfTackingTrim(sail, awa.angle, jibAngleDeg);
    }
    boomById[sail.id] = boom;
  }

  const main = boat.sails.find((sail) => sail.trim.kind === "sheet");
  const mainBoom = main ? boomById[main.id] : 0;
  for (const sail of boat.sails) {
    const boom = boomById[sail.id];
    const winged = wingedSails.has(sail.id);
    const boomSide = Math.sign(boom);
    const mainSide = Math.sign(mainBoom);
    const blanketed =
      sail.id !== main?.id &&
      !winged &&
      (boomSide === 0 || mainSide === 0 || boomSide === mainSide);
    const sol = solveSail(sail, awa, boom, heel, { winged, blanketed });
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
