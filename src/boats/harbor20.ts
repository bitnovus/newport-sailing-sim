import type { BoatDefinition } from "./types";

/**
 * W.D. Schock Harbor 20 — the Newport Harbor one-design.
 * Hull dimensions from W.D. Schock; class-ready weight and sail areas from
 * the Harbor 20 Class Association rules and design drawings: LOA 6.10 m,
 * LWL 5.23 m, beam 2.13 m, draft 1.07 m, minimum boat weight 884.5 kg
 * (900 lb ballast), main 14.21 m², jib 7.15 m², hull speed ≈ 5.6 kn.
 * Fractional rig with a small high-clew self-tacking jib; electric auxiliary.
 *
 * Hydro/aero coefficients are tuned so steady-state targets hold:
 * ~4.5 kn close-hauled in 12 kn true, ~5 kn reaching, wall at hull speed,
 * ~4° leeway upwind, ~10 m turning radius at 4 kn with full rudder.
 */
export const harbor20: BoatDefinition = {
  id: "harbor20",
  name: "Harbor 20",
  loa: 6.1,
  lwl: 5.23,
  beam: 2.13,
  draft: 1.07,
  mass: 884.5, // 1,950 lb class-ready boat with rigging/equipment; crew omitted
  yawInertia: 1900,
  wettedArea: 13,
  hullSpeed: 2.86, // 5.6 kn
  dragC1: 27,
  dragC2: 13,
  dragC3: 33,
  lateralResistance: 1600,
  maxEffectiveLeeway: 10,
  hullLateralDrag: 3600,
  rightingMomentPerDeg: 170,
  rudder: {
    area: 0.28,
    maxEffectiveAngle: 35, // real hard-over; past ~40° the blade is a brake
    arm: 2.1,
    rateLimit: 90,
  },
  sails: [
    {
      id: "main",
      name: "Mainsail",
      area: 14.21, // 153 ft² class sail plan
      effortHeight: 3.2,
      effortArm: -0.4, // behind midship → weather helm
      stallFloor: 0.55,
      blanketedAboveAwa: 181, // main is never blanketed
      trim: { kind: "sheet", min: 5, max: 85 },
    },
    {
      id: "jib",
      name: "Self-tacking jib",
      area: 7.15, // 77 ft² class sail plan
      effortHeight: 2.7,
      effortArm: 1.7, // well forward
      stallFloor: 0.4,
      blanketedAboveAwa: 150,
      trim: {
        kind: "selfTacking",
        min: 8,
        max: 75,
        // traveler cars can't re-lead the sheet: modest loss when very
        // close-hauled or running wide
        efficiency: 0.85,
      },
    },
  ],
  // Effective full-throttle propulsion calibrated to W.D. Schock's published
  // "about five knots" in calm water with the sails unloaded.
  auxiliaryThrust: 400,
  auxiliaryPower: 980,
};
