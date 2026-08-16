/**
 * Boat definitions are pure data so new keelboats drop in without code changes.
 * All lengths in meters, masses in kg, areas in m², angles in degrees
 * (converted to radians where the physics needs it).
 */

/** How a sail's trim angle (boom angle off centerline) is determined. */
export type TrimPolicy =
  /** User-trimmed via sheet control (mainsail on a Harbor 20). */
  | { kind: "sheet"; min: number; max: number }
  /** Self-tacking: boom auto-tracks ~half the apparent wind angle (H20 jib). */
  | { kind: "selfTacking"; min: number; max: number; efficiency: number };

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
  loa: number;
  lwl: number;
  beam: number;
  draft: number;
  /** Simulated sailing mass, kg; each boat definition documents its included load. */
  mass: number;
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
