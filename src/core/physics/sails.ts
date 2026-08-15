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
 * Self-tacking jib trim: the car slides across the traveler on its own as
 * the wind crosses the bow. It tracks roughly half the apparent wind angle
 * but can't be re-lead, so it gives away efficiency at the extremes.
 */
export function selfTackingTrim(sail: SailDefinition, awaDeg: number): number {
  const policy = sail.trim;
  if (policy.kind !== "selfTacking") return idealBoomAngle(awaDeg);
  const mag = Math.sign(awaDeg) || 1;
  const a = Math.abs(awaDeg);
  const half = clamp(a / 2, policy.min, policy.max);
  return mag * half;
}

/** Efficiency loss of a fixed-traveler jib near the extremes. */
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
 * Sum forces over all sails, honoring each sail's trim policy. When
 * `actualBooms` is provided (per-sail signed angles), those are used instead
 * of policy targets — the sim sweeps booms at a finite rate so tacks and
 * jibes animate as a crossing rather than a teleport.
 */
export function solveRig(
  boat: BoatDefinition,
  awa: ApparentWind,
  sheetAngleDeg: number,
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
      boom = Math.sign(awa.angle) * clamp(Math.abs(sheetAngleDeg), sail.trim.min, sail.trim.max);
    } else {
      boom = selfTackingTrim(sail, awa.angle);
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
