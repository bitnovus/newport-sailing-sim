import type { BoatDefinition } from "../../boats/types";
import { clamp, DEG } from "../units";

export const WATER_DENSITY = 1025; // kg/m³, seawater

/** Total hydrodynamic drag opposing forward motion, N. */
export function hullDrag(boat: BoatDefinition, u: number): number {
  if (u <= 0) return 0;
  const visc = boat.dragC1 * u * u;
  const x = u / boat.hullSpeed;
  const wave = u * u * (boat.dragC2 + boat.dragC3 * x ** 6);
  return visc + wave;
}

/**
 * Keel + hull resistance to sideslip as a semi-implicit-friendly model:
 * F(v) = −(k·v + c·v·|v|).
 *   k: keel lift, needs forward flow (no leeway resistance when stopped)
 *   c: hull form drag against beam drift — always present
 * The caller solves this implicitly; see Sim.step.
 */
export function lateralDamping(
  boat: BoatDefinition,
  u: number,
): { k: number; c: number } {
  const flowSpeed = Math.max(0.1, Math.abs(u));
  return { k: boat.lateralResistance * flowSpeed, c: boat.hullLateralDrag };
}

/** Small forward drag penalty from dragging the hull sideways. */
export function leewayDrag(u: number, v: number): number {
  return -150 * Math.abs(v) * u;
}

export interface RudderForces {
  /** Lateral force on the hull, N (+ = toward starboard). */
  side: number;
  /** Yaw moment, N·m (+ = bow turns to starboard). */
  yaw: number;
  /** Induced drag from a hard-over rudder, N (always opposes motion). */
  drag: number;
}

/**
 * Rudder as a lifting surface with stall: lift builds with flow speed over
 * the blade, so there is no steerage way when the boat is stopped.
 * deltaDeg is the hydrodynamic deflection: + deflects flow to starboard,
 * turning the bow to starboard (i.e. the helmsman pushes the tiller to PORT).
 */
export function rudderForces(boat: BoatDefinition, u: number, deltaDeg: number): RudderForces {
  const flow = Math.max(0, u);
  const eff = clamp(Math.abs(deltaDeg), 0, boat.rudder.maxEffectiveAngle);
  // flat-plate-ish lift with stall plateau
  const cl = Math.min(2.2, 0.11 * eff);
  const lift = 0.5 * WATER_DENSITY * boat.rudder.area * cl * flow * flow;
  // A positive deflection pushes the stern to port, turning the bow to
  // starboard. Preserve that lateral force so the rudder can share the keel's
  // leeway load instead of contributing yaw alone.
  const side = -lift * Math.sign(deltaDeg);
  const yaw = -side * boat.rudder.arm;
  const drag = -220 * (eff * DEG) ** 2 * flow * flow;
  return { side, yaw, drag };
}

/**
 * Yaw damping from forward-flow resistance plus the hull's rotational
 * crossflow. The crossflow term depends on yaw rate rather than forward speed,
 * so a boat carrying rotation through a tack does not hit an artificial
 * speed-independent linear brake as its surge speed approaches zero.
 */
export function yawDamping(u: number, r: number): number {
  const forwardFlow = Math.max(0, u);
  const lowSpeedFlow = Math.min(1, forwardFlow);
  const linearFlow = forwardFlow + lowSpeedFlow * lowSpeedFlow;
  const crossflow = 0.5 + forwardFlow;
  // Preserve enough angular momentum to carry a moderate-helm tack through
  // irons while retaining strong forward-flow and hard-turn damping.
  return -(1400 * linearFlow * r + 3000 * crossflow * Math.abs(r) * r);
}

/**
 * Heel: first-order relaxation toward the equilibrium heel from the current
 * heeling moment, with the righting arm hardening as the boat heels.
 */
export function heelStep(
  boat: BoatDefinition,
  heel: number,
  heelRate: number,
  heelingMoment: number,
  dt: number,
): { heel: number; heelRate: number } {
  // righting moment (N·m) opposing heel; stiffens slightly past 20° as the
  // ballast arm grows, then softens if the rail goes in (not modeled hard)
  const phi = Math.abs(heel);
  const stiffen = 1 + 0.5 * clamp((phi / DEG - 20) / 40, 0, 0.5);
  const rm = boat.rightingMomentPerDeg * (phi / DEG) * stiffen * Math.sign(heel || 1);
  const inertia = 3500; // roll inertia, kg·m² (crew trapezing not available)
  const damping = 2600; // roll damping (water + sails)
  const accel = (heelingMoment - rm - damping * heelRate) / inertia;
  const newRate = heelRate + accel * dt;
  const newHeel = heel + newRate * dt;
  return { heel: clamp(newHeel, -75 * DEG, 75 * DEG), heelRate: newRate };
}

/**
 * Electric auxiliary thrust, N. At low speed the propeller is limited by its
 * static thrust; once under way it is limited by effective propulsive power
 * (P = Fv). This avoids both an infinite force at zero speed and the previous
 * arbitrary linear fade that made full throttle top out far below its target.
 */
export function auxiliaryThrust(boat: BoatDefinition, u: number): number {
  if (boat.auxiliaryThrust <= 0 || boat.auxiliaryPower <= 0) return 0;
  const forwardSpeed = Math.max(0, u);
  const powerLimitedThrust = boat.auxiliaryPower / Math.max(forwardSpeed, 0.1);
  return Math.min(boat.auxiliaryThrust, powerLimitedThrust);
}
