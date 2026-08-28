import type { BoatDefinition } from "../../boats/types";
import { clamp, DEG } from "../units";

export const WATER_DENSITY = 1025; // kg/m³, seawater

/**
 * Signed hydrodynamic resistance opposing surge, N. Positive values resist
 * forward motion and negative values resist sternway. Modeling both
 * directions prevents a luffing boat in irons from accelerating astern until
 * it reaches the simulator's numerical velocity bound.
 */
export function hullDrag(boat: BoatDefinition, u: number): number {
  if (u === 0) return 0;
  const speed = Math.abs(u);
  const visc = boat.dragC1 * speed * speed;
  const x = speed / boat.hullSpeed;
  const wave = speed * speed * (boat.dragC2 + boat.dragC3 * x ** 6);
  // A transom-stern displacement hull presents far more bluff underwater
  // area when moving astern than when its bow is parting the water ahead.
  const reverseResistance = u < 0 ? 12.5 : 1;
  return Math.sign(u) * (visc + wave) * reverseResistance;
}

export interface PlanarHydroForces {
  /** Longitudinal force, N (+ = forward). */
  surge: number;
  /** Lateral force, N (+ = toward starboard). */
  side: number;
  /** Yaw moment about the loaded center of mass, N·m (+ = starboard turn). */
  yaw: number;
}

/**
 * Keel + canoe-body lateral force at the configured center of lateral
 * resistance. The local transverse velocity is v + x·r: a point forward of
 * the center of mass moves farther to starboard in a starboard turn.
 *
 * The lift component is perpendicular to that local water-relative velocity,
 * so it redirects motion without destroying kinetic energy. Profile/induced
 * drag remains dissipative and the separate hull crossflow term in Sim.step
 * handles broadside form drag. Keel lift needs forward flow and plateaus once
 * the configured effective leeway is exceeded.
 */
export function keelForces(
  boat: BoatDefinition,
  u: number,
  v: number,
  r: number,
): PlanarHydroForces {
  const x = boat.keelArm;
  const localSide = v + x * r;
  const forward = Math.max(0, u);

  let liftSurge = 0;
  let liftSide = 0;
  if (forward > 1e-6) {
    const maxSide = forward * Math.tan(boat.maxEffectiveLeeway * DEG);
    const effectiveSide = clamp(localSide, -maxSide, maxSide);
    // Retains the previous small-angle F_y = -kLat·u·v calibration while
    // applying the lift at the CLR and keeping F_lift · V_local = 0.
    liftSide = -boat.lateralResistance * forward * effectiveSide;
    liftSurge = -(liftSide * localSide) / forward;
  }

  // Preserve the former leeway-drag scale, now directed opposite the actual
  // local flow rather than applied as an unrelated surge-only penalty.
  const dragScale = 150 * Math.abs(localSide);
  const dragSurge = -dragScale * u;
  const dragSide = -dragScale * localSide;
  const surge = liftSurge + dragSurge;
  const side = liftSide + dragSide;

  return { surge, side, yaw: x * side };
}

export interface RudderForces {
  /** Longitudinal component of the complete rudder force, N (+ = forward). */
  surge: number;
  /** Lateral force on the hull, N (+ = toward starboard). */
  side: number;
  /** Yaw moment, N·m (+ = bow turns to starboard). */
  yaw: number;
  /** Effective rudder angle of attack after local sway/yaw inflow, deg. */
  angleOfAttackDeg: number;
}

/**
 * Rudder as a lifting surface with stall. The blade samples the local flow at
 * its stern lever, so sway and yaw alter its effective angle of attack. Lift
 * is perpendicular to local flow and drag opposes it; a passive rudder can
 * therefore exchange surge, sway, and yaw energy but cannot create energy.
 *
 * deltaDeg is the hydrodynamic deflection: + deflects flow to starboard,
 * turning the bow to starboard (i.e. the helmsman pushes the tiller to PORT).
 */
export function rudderForces(
  boat: BoatDefinition,
  u: number,
  deltaDeg: number,
  v = 0,
  r = 0,
): RudderForces {
  const x = -boat.rudder.arm;
  const localSide = v + x * r;
  const speed = Math.hypot(u, localSide);
  if (speed < 1e-6) {
    return { surge: 0, side: 0, yaw: 0, angleOfAttackDeg: 0 };
  }

  // Keel wake straightens steady leeway more than the transverse velocity
  // created locally when the stern sweeps through a turn, so retain separate
  // interaction factors instead of scaling both effects as one velocity.
  const straightenedSide =
    boat.rudder.leewayInflow * v + boat.rudder.yawInflow * x * r;
  const inflowDeg = Math.atan2(straightenedSide, Math.max(0.05, u)) / DEG;
  const angleOfAttackDeg = clamp(
    deltaDeg + inflowDeg,
    -boat.rudder.maxEffectiveAngle,
    boat.rudder.maxEffectiveAngle,
  );
  // Low-aspect-ratio rudder: near-linear lift through the Harbor 20's normal
  // ~12.5° helm range, peaking near 15°, then a broad stall that sheds lift as
  // the blade approaches hard-over. This preserves useful moderate-helm
  // authority without letting 35° become an unrealistically powerful pivot.
  const absAlpha = Math.abs(angleOfAttackDeg);
  const clAbs =
    absAlpha <= 15
      ? 0.1 * absAlpha
      : 1.5 - 0.025 * Math.min(20, absAlpha - 15);
  const cl = clAbs * Math.sign(angleOfAttackDeg);
  const qArea = 0.5 * WATER_DENSITY * boat.rudder.area * speed * speed;
  const lift = -qArea * cl;
  // Matches the previous calibrated drag curve in straight inflow while using
  // effective angle of attack once the stern is translating or rotating.
  const cd = 0.015 + 1.53 * (angleOfAttackDeg * DEG) ** 2;
  const drag = qArea * cd;
  const invSpeed = 1 / speed;
  const normalSurge = -localSide * invSpeed;
  const normalSide = u * invSpeed;
  const surge = lift * normalSurge - drag * u * invSpeed;
  const side = lift * normalSide - drag * localSide * invSpeed;

  return {
    surge,
    side,
    yaw: x * side,
    angleOfAttackDeg,
  };
}

/**
 * Yaw damping from forward-flow resistance plus the hull's rotational
 * crossflow. The crossflow term depends on yaw rate rather than forward speed,
 * so a boat carrying rotation through a tack does not hit an artificial
 * speed-independent linear brake as its surge speed approaches zero.
 */
export function yawDamping(boat: BoatDefinition, u: number, r: number): number {
  const forwardFlow = Math.max(0, u);
  const lowSpeedFlow = Math.min(1, forwardFlow);
  const linearFlow = forwardFlow + lowSpeedFlow * lowSpeedFlow;
  const crossflow = 0.5 + forwardFlow;
  // Preserve enough angular momentum to carry a moderate-helm tack through
  // irons while retaining strong forward-flow and hard-turn damping.
  // The local-inflow rudder model now supplies part of the vessel's yaw
  // damping. These boat-specific coefficients represent only the remaining
  // distributed canoe-body crossflow, avoiding the former double count.
  return -(
    boat.yawDampingLinear * linearFlow * r +
    boat.yawDampingQuadratic * crossflow * Math.abs(r) * r
  );
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
