/**
 * Boat definitions are pure data so new keelboats drop in without code changes.
 * All lengths in meters, masses in kg, areas in m², angles in degrees
 * (converted to radians where the physics needs it).
 */

/** Shared sheet limits and hinge dynamics for a wind-driven sail boom. */
export interface WindDrivenBoomTrim {
  min: number;
  max: number;
  initial: number;
  /** Boom + attached-sail rotational inertia about its pivot, kg·m². */
  boomInertia: number;
  /** Effective pivot-to-center-of-pressure distance, m. */
  boomLever: number;
  /** Pivot/aerodynamic angular damping rate, s⁻¹. */
  boomDamping: number;
  /** Numerical/physical cap on relative boom speed, deg/s. */
  maxBoomRate: number;
}

/** How a sail's sheet and boom-angle limit are exposed to the crew. */
export type TrimPolicy =
  /**
   * User-trimmed via sheet control (mainsail on a Harbor 20). The selected
   * angle is the sheet's outward stop; apparent-wind pressure moves the boom
   * freely inside it.
   */
  | (WindDrivenBoomTrim & { kind: "sheet" })
  /** Club-boomed jib: separately sheeted and self-tending under wind pressure. */
  | (WindDrivenBoomTrim & { kind: "selfTacking"; efficiency: number });

export interface SailDefinition {
  id: string;
  /** Display name ("Mainsail", "Self-tacking jib"). */
  name: string;
  area: number;
  /** Height of the center of effort above the center of lateral resistance (m). */
  effortHeight: number;
  /** Center-of-effort longitudinal offset from midship (m, + = forward). */
  effortArm: number;
  /** Fraction of drive retained when deeply stalling (running by the lee). */
  stallFloor: number;
  trim: TrimPolicy;
  /** Mainsail-ish sails blanket others downwind; a sail can be blanketed. */
  blanketedAboveAwa: number;
}

export interface BoatDefinition {
  id: string;
  name: string;
  /** Default close-hauled true-wind angle used when spawning under sail, deg. */
  closeHauledTwa: number;
  loa: number;
  lwl: number;
  beam: number;
  draft: number;
  /** Equipped boat mass, kg; each definition documents its included load. */
  mass: number;
  /** Representative crew load included in translational inertia, kg. */
  crewMass: number;
  /** Rotational inertia in yaw, kg·m². */
  yawInertia: number;
  /** Wetted surface area, m². */
  wettedArea: number;
  /** Hull speed limit the wave-drag knee centers on, m/s. */
  hullSpeed: number;
  /** Viscous drag coefficient term: D_visc = c1 * u². */
  dragC1: number;
  /** Wave-making drag terms: D_wave = u² * (c2 + c3 * (u/hullSpeed)^6). */
  dragC2: number;
  dragC3: number;
  /** Keel + hull lateral resistance coefficient (leeway): F_lat = kLat * u * v. */
  lateralResistance: number;
  /** Max leeway the keel produces lift through before sideslip dominates (deg). */
  maxEffectiveLeeway: number;
  /** Hull form drag against beam drift (quadratic): F = c * v * |v|. */
  hullLateralDrag: number;
  /** Righting moment per degree of heel, N·m. */
  rightingMomentPerDeg: number;
  /** Rudder: area m², effective max lift angle (deg), moment arm (m). */
  rudder: {
    area: number;
    maxEffectiveAngle: number;
    arm: number;
    /** How fast the rudder follows the tiller, deg/s. */
    rateLimit: number;
  };
  sails: SailDefinition[];
  /** Maximum static electric-auxiliary thrust, N (0 = none). */
  auxiliaryThrust: number;
  /** Effective propulsive power delivered to the water, W (0 = none). */
  auxiliaryPower: number;
}
