import type { BoatDefinition } from "./types";

/**
 * W.D. Schock Harbor 20 — the Newport Harbor one-design.
 * Hull dimensions from W.D. Schock's published specifications; class-ready
 * weight and sail areas from the Harbor 20 Class Association rules and design
 * drawings (source links in README.md): LOA 6.10 m,
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
  // 40° pinches the simulator down to ~3.4 kn in 11 kn true; 45° matches the
  // class's useful close-hauled groove with the default 15° sheet limits.
  closeHauledTwa: 45,
  loa: 6.1,
  lwl: 5.23,
  beam: 2.13,
  draft: 1.07,
  mass: 884.5, // 1,950 lb class-ready boat with rigging/equipment; crew omitted
  // Slender-hull estimate is ~2,740 kg·m²; the keel and end structure carry
  // enough mass fore/aft that the boat should retain turn momentum in a tack.
  yawInertia: 2800,
  wettedArea: 13,
  hullSpeed: 2.86, // 5.6 kn
  dragC1: 27,
  dragC2: 13,
  dragC3: 77,
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
      trim: {
        kind: "sheet",
        min: 5,
        max: 85,
        initial: 15,
        // Boom, sailcloth, and air entrained by the sail. These give a brisk
        // but finite tack and a noticeably harder high-wind jibe.
        boomInertia: 80,
        boomLever: 1.35,
        boomDamping: 3.2,
        maxBoomRate: 180,
      },
    },
    {
      id: "jib",
      name: "Self-tacking jib",
      area: 7.15, // 77 ft² class sail plan
      effortHeight: 2.7,
      // Effective aerodynamic arm after jib/main interaction. The sail plan
      // stays nearly neutral at rest; heel and forward flow add light weather
      // helm once the hull has steerage.
      effortArm: 0.9,
      stallFloor: 0.4,
      blanketedAboveAwa: 150,
      trim: {
        kind: "selfTacking",
        min: 8,
        max: 75,
        initial: 15,
        // The club boom is smaller and lighter than the main boom, so it
        // self-tends a little faster while retaining a finite crossing sweep.
        boomInertia: 18,
        boomLever: 0.85,
        boomDamping: 4,
        maxBoomRate: 220,
        // The fixed club-boom sheeting geometry gives up modest efficiency
        // when very close-hauled or running wide.
        efficiency: 0.85,
      },
    },
  ],
  // Effective full-throttle propulsion calibrated to W.D. Schock's published
  // "about five knots" in calm water with the sails unloaded.
  auxiliaryThrust: 550,
  auxiliaryPower: 1400,
};
