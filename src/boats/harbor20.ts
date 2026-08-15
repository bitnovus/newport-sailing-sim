import type { BoatDefinition } from "./types";

/**
 * W.D. Schock Harbor 20 — the Newport Harbor one-design.
 * Specs from WD Schock: LOA 6.10 m, LWL 5.23 m, beam 2.13 m, draft 1.07 m,
 * displacement 816 kg (900 lb ballast), main 14.0 m², hull speed ≈ 5.6 kn.
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
  mass: 816,
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
    maxEffectiveAngle: 25,
    arm: 2.1,
    rateLimit: 90,
  },
  sails: [
    {
      id: "main",
      name: "Mainsail",
      area: 14,
      effortHeight: 3.2,
      effortArm: -0.4, // behind midship → weather helm
      stallFloor: 0.55,
      blanketedAboveAwa: 181, // main is never blanketed
      trim: { kind: "sheet", min: 5, max: 85 },
    },
    {
      id: "jib",
      name: "Self-tacking jib",
      area: 5.5,
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
  auxiliaryThrust: 320,
};
