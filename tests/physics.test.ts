import { describe, expect, it } from "vitest";
import { Sim } from "../src/core/sim";
import { Environment } from "../src/core/environment";
import { harbor20 } from "../src/boats/harbor20";
import { kn, toKn, wrapDeg, DEG } from "../src/core/units";
import { auxiliaryThrust, rudderForces } from "../src/core/physics/hydro";
import {
  idealBoomAngle,
  luffFraction,
  sailCoefficients,
  selfTackingTrim,
  sheetedBoomRestAngle,
  solveSail,
  stepSheetedBoom,
} from "../src/core/physics/sails";
import { MobDrill, MOB_ARM_DISTANCE_M } from "../src/ui/hud";

const DT = 1 / 60;

function makeSim(windKn: number, dirFrom = 0): Sim {
  const env = new Environment({
    speed: kn(windKn),
    directionFrom: dirFrom,
    gust: kn(windKn) * 1.1,
    source: "test",
  });
  return new Sim(harbor20, env, null);
}

function makeConstantSim(windKn: number, dirFrom = 0): Sim {
  const env = new Environment({
    speed: kn(windKn),
    directionFrom: dirFrom,
    gust: kn(windKn),
    source: "test",
  });
  env.windAt = () => ({ speed: kn(windKn), directionFrom: dirFrom });
  return new Sim(harbor20, env, null);
}

/** Previous auto-trim heuristic, used when a physics test needs an ideal crew. */
function idealJibTrim(sim: Sim): number {
  return Math.abs(sim.telemetry().awa) / 2;
}

/** Sail with auto-trim for `seconds`, returning the final telemetry. */
function sailFor(sim: Sim, seconds: number, headingDeg: number) {
  for (let i = 0; i < seconds / DT; i++) {
    const tel = sim.telemetry();
    const sheet = i === 0 ? 15 : Math.abs(idealBoomAngle(tel.awa));
    sim.step(DT, {
      tiller: headingHold(sim, headingDeg),
      sheetTargetDeg: sheet,
      jibTargetDeg: i === 0 ? 15 : idealJibTrim(sim),
      auxOn: false,
    });
  }
  return sim.telemetry();
}

/** Simple heading autopilot for tests (proportional on heading error). */
function headingHold(sim: Sim, targetDeg: number): number {
  const err = ((targetDeg - sim.state.heading * (180 / Math.PI) + 540) % 360) - 180;
  return Math.max(-0.8, Math.min(0.8, -err / 40));
}

/** Steady-state SOG (kn) at a true wind angle, with ideal trim. */
function polarPoint(windKn: number, twaDeg: number): number {
  const sim = makeSim(windKn, 0); // wind from north
  sim.state.heading = ((twaDeg + 360) % 360) * (Math.PI / 180);
  const t = sailFor(sim, 120, twaDeg);
  return t.sog;
}

describe("Harbor 20 class specification", () => {
  it("uses the published class-ready weight and sail plan", () => {
    const poundsToKg = 0.45359237;
    const squareFeetToSquareMeters = 0.09290304;
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const jib = harbor20.sails.find((sail) => sail.id === "jib")!;

    expect(harbor20.mass).toBeCloseTo(1950 * poundsToKg, 1);
    expect(main.area).toBeCloseTo(153 * squareFeetToSquareMeters, 2);
    expect(jib.area).toBeCloseTo(77 * squareFeetToSquareMeters, 2);
    expect(harbor20.closeHauledTwa).toBe(45);
  });
});

describe("wind environment", () => {
  it("keeps Gaussian gusts finite at the PRNG's upper endpoint", () => {
    // This seed's first xorshift output is 0xffffffff, the exact case that
    // previously rounded above 1 before the Box-Muller transform.
    const env = new Environment(
      { speed: kn(12), directionFrom: 250, gust: kn(16), source: "test" },
      1584200935,
    );

    for (let i = 0; i < 120; i++) {
      const wind = env.windAt(i * DT, DT);
      expect(Number.isFinite(wind.speed)).toBe(true);
      expect(Number.isFinite(wind.directionFrom)).toBe(true);
    }
  });
});

describe("sail aerodynamics", () => {
  it("uses jib trim as the self-tending club boom's outward limit", () => {
    const jib = harbor20.sails.find((sail) => sail.id === "jib")!;

    expect(selfTackingTrim(jib, 45, 20)).toBe(20);
    expect(selfTackingTrim(jib, -45, 20)).toBe(-20);
    expect(selfTackingTrim(jib, 45, 2)).toBe(8);
    expect(selfTackingTrim(jib, -45, 90)).toBe(-45); // rests inside a loose sheet
    expect(selfTackingTrim(jib, -90, 90)).toBe(-75); // sheet catches at its max
  });

  it("applies independent main and jib trim commands", () => {
    const sim = makeSim(12, 0);
    sim.state.heading = 90 * DEG;

    sim.step(DT, {
      tiller: 0,
      sheetTargetDeg: 25,
      jibTargetDeg: 60,
      auxOn: false,
    });

    // First-frame initialization uses the actual wind side instead of
    // sweeping from an arbitrary, potentially backwinded boom position.
    expect(Math.abs(sim.state.boomDeg.main)).toBeCloseTo(25, 6);
    expect(Math.abs(sim.state.boomDeg.jib)).toBeCloseTo(60, 6);
    expect(sim.state.boomDeg.main).toBeLessThan(0);
    expect(sim.state.boomDeg.jib).toBeLessThan(0);
    expect(sim.telemetry().sheetDeg).toBe(25);
    expect(sim.telemetry().jibDeg).toBe(60);
  });

  it("uses the mainsheet as an outward stop, not a commanded boom angle", () => {
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const awa = { speed: kn(12), angle: 45, vector: { x: 0, y: 0 } };

    expect(sheetedBoomRestAngle(main, awa.angle, 70)).toBe(45);

    let free = { angleDeg: 10, rateDeg: 0 };
    for (let i = 0; i < 6 / DT; i++) {
      free = stepSheetedBoom(main, awa, 70, free, DT);
    }
    // With slack left in a 70° sheet, wind aligns the boom near 45° rather
    // than an invisible actuator forcing it all the way out to 70°.
    expect(free.angleDeg).toBeCloseTo(45, 1);
    expect(Math.abs(free.angleDeg)).toBeLessThan(70);

    let caught = { angleDeg: 10, rateDeg: 0 };
    for (let i = 0; i < 6 / DT; i++) {
      caught = stepSheetedBoom(main, awa, 20, caught, DT);
    }
    expect(caught.angleDeg).toBe(20);
    expect(caught.rateDeg).toBe(0);
  });

  it("wind-drives the jib club boom instead of actuating it across", () => {
    const jib = harbor20.sails.find((sail) => sail.id === "jib")!;
    const newTack = { speed: kn(12), angle: -45, vector: { x: 0, y: 0 } };
    let boom = { angleDeg: 15, rateDeg: 0 };

    const first = stepSheetedBoom(jib, newTack, 60, boom, DT);
    expect(first.angleDeg).toBeGreaterThan(0); // no side-switch teleport
    expect(first.rateDeg).toBeLessThan(0); // apparent wind starts the sweep
    boom = first;

    let rateAtCross: number | null = null;
    for (let i = 0; i < 4 / DT; i++) {
      const previousAngle = boom.angleDeg;
      boom = stepSheetedBoom(jib, newTack, 60, boom, DT);
      if (previousAngle > 0 && boom.angleDeg <= 0) {
        rateAtCross = boom.rateDeg;
        break;
      }
    }

    expect(rateAtCross).not.toBeNull();
    expect(rateAtCross!).toBeLessThan(-10);
    expect(Math.abs(boom.angleDeg)).toBeLessThanOrEqual(60);
  });

  it("does not invent boom motion without wind or existing momentum", () => {
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const calm = { speed: 0, angle: -60, vector: { x: 0, y: 0 } };
    let boom = { angleDeg: 28, rateDeg: 0 };

    for (let i = 0; i < 10 / DT; i++) {
      boom = stepSheetedBoom(main, calm, 70, boom, DT);
    }

    expect(boom.angleDeg).toBe(28);
    expect(boom.rateDeg).toBe(0);
  });

  it("carries finite angular momentum through a wind-side change", () => {
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const newTack = { speed: kn(12), angle: -45, vector: { x: 0, y: 0 } };
    let boom = { angleDeg: 15, rateDeg: 0 };

    const first = stepSheetedBoom(main, newTack, 70, boom, DT);
    expect(first.angleDeg).toBeGreaterThan(0); // no teleport across the boat
    expect(first.rateDeg).toBeLessThan(0); // wind has started the sweep
    boom = first;

    let rateAtCross: number | null = null;
    for (let i = 0; i < 4 / DT; i++) {
      const previousAngle = boom.angleDeg;
      boom = stepSheetedBoom(main, newTack, 70, boom, DT);
      if (previousAngle > 0 && boom.angleDeg <= 0) {
        rateAtCross = boom.rateDeg;
        break;
      }
    }

    expect(rateAtCross).not.toBeNull();
    expect(rateAtCross!).toBeLessThan(-10);
  });

  it("turns rudder lift into both lateral force and yaw", () => {
    const rudder = rudderForces(harbor20, 2, 10);

    expect(rudder.side).toBeLessThan(0);
    expect(rudder.yaw).toBeGreaterThan(0);
    expect(rudder.yaw).toBeCloseTo(-rudder.side * harbor20.rudder.arm, 8);
  });

  it("luffs below the luffing threshold", () => {
    const c = sailCoefficients(0);
    expect(c.cl).toBe(0);
    expect(sailCoefficients(-3).cl).toBe(0);
  });

  it("flogs instead of stalling when eased past the wind (backwind)", () => {
    // irons with the main eased: alpha is deeply negative — cloth must flog,
    // never act as a filled drag plate (the "pushed backward" bug)
    const c = sailCoefficients(-79);
    expect(c.cl).toBe(0);
    expect(c.cd).toBeLessThan(0.45);
    expect(luffFraction(-79)).toBe(1);
    expect(luffFraction(-10)).toBe(1);
    // mid-tack: wind and boom on opposite sides is backwind too
    expect(luffFraction(25)).toBe(0);
  });

  it("head-to-wind eased sail produces no plate thrust", () => {
    const main = harbor20.sails.find((s) => s.id === "main")!;
    const sol = solveSail(
      main,
      { speed: kn(10), angle: 1, vector: { x: 0, y: 0 } },
      80,
      0,
    );
    expect(sol.luffing).toBe(true);
    expect(sol.flow).toBe(0);
    expect(Math.abs(sol.drive)).toBeLessThan(90); // flutter drag (~70 N), not plate thrust (~380 N)
  });

  it("has attached-flow lift ramp and soft stall", () => {
    expect(sailCoefficients(15).cl).toBeGreaterThan(1.0);
    expect(sailCoefficients(18).cl).toBeCloseTo(1.55, 6);
    expect(sailCoefficients(45).cl).toBeLessThan(1.0);
    expect(sailCoefficients(90).cd).toBeGreaterThan(1.0);
  });

  it("eases the ideal boom monotonically from close-hauled to running", () => {
    const close = Math.abs(idealBoomAngle(30));
    const beam = Math.abs(idealBoomAngle(90));
    const run = Math.abs(idealBoomAngle(175));
    expect(close).toBeLessThan(beam);
    expect(beam).toBeLessThan(run);
    expect(close).toBeLessThan(15);
    expect(run).toBeGreaterThan(60);
  });
});

describe("steady-state sailing (mini polar)", () => {
  it("makes about four knots at the default close-hauled setup in 11 kn", () => {
    const sim = makeConstantSim(11, 0);
    sim.state.heading = harbor20.closeHauledTwa * DEG;
    const main = harbor20.sails.find((sail) => sail.trim.kind === "sheet")!;
    const jib = harbor20.sails.find((sail) => sail.trim.kind === "selfTacking")!;

    for (let i = 0; i < 120 / DT; i++) {
      sim.step(DT, {
        tiller: headingHold(sim, harbor20.closeHauledTwa),
        sheetTargetDeg: main.trim.initial,
        jibTargetDeg: jib.trim.initial,
        auxOn: false,
      });
    }

    expect(sim.telemetry().sog).toBeGreaterThan(4);
    expect(sim.telemetry().sog).toBeLessThan(4.8);
  }, 30000);

  it("reaches ~4-5 kn close-hauled in 12 kn of wind", () => {
    const sog = polarPoint(12, 45);
    expect(sog).toBeGreaterThan(3.8);
    expect(sog).toBeLessThan(5.2);
  }, 30000);

  it("goes roughly as fast or faster reaching than close-hauled", () => {
    const close = polarPoint(12, 45);
    const reach = polarPoint(12, 90);
    expect(reach).toBeGreaterThan(close - 0.4);
  }, 30000);

  it("does not exceed hull speed by much in 20 kn", () => {
    const sog = polarPoint(20, 90);
    expect(sog).toBeLessThan(6.2); // hull speed 5.6 kn
  }, 30000);

  it("cannot make progress in the no-go zone", () => {
    const sog = polarPoint(12, 10);
    expect(sog).toBeLessThan(1.0);
  }, 30000);
});

describe("dynamic behavior", () => {
  it("carries light weather helm with useful windward rudder lift", () => {
    const sim = makeConstantSim(12, 0);
    sim.state.heading = 45 * DEG;

    for (let i = 0; i < 120 / DT; i++) {
      sim.step(DT, {
        tiller: headingHold(sim, 45),
        sheetTargetDeg: 15,
        jibTargetDeg: 15,
        auxOn: false,
      });
    }

    const tillerDeg = headingHold(sim, 45) * harbor20.rudder.maxEffectiveAngle;
    const rudder = rudderForces(harbor20, sim.state.u, sim.state.rudderDeg);
    expect(tillerDeg).toBeLessThan(-0.5);
    expect(tillerDeg).toBeGreaterThan(-3);
    expect(rudder.side).toBeLessThan(0); // windward on this tack
    expect(sim.telemetry().leeway).toBeLessThan(6);
  }, 30000);

  it("port→starboard tack goes through the wind, never the lee", () => {
    const sim = makeSim(12, 30); // wind from 030
    sim.state.heading = 70 * DEG; // close-hauled PORT: TWA = -40, boom to stbd
    sailFor(sim, 60, 70);
    expect(Math.sign(sim.telemetry().awa)).toBe(-1);

    // tiller + = push to starboard = toward the sail on a port tack → come about
    let closestToWind = 180;
    let closestToLee = 180;
    let boomAtCross = 0;
    let crossed = false;
    let reachedNewCourse = false;
    const steps = Math.round(12 / DT);
    for (let i = 0; i < steps; i++) {
      if (sim.state.heading / DEG <= -10) reachedNewCourse = true;
      sim.step(DT, {
        tiller: reachedNewCourse ? headingHold(sim, 350) : 0.7,
        sheetTargetDeg: 15,
        jibTargetDeg: 15,
        auxOn: false,
      });
      const tel = sim.telemetry();
      closestToWind = Math.min(closestToWind, Math.abs(wrapDeg(tel.headingDeg - 30)));
      closestToLee = Math.min(closestToLee, Math.abs(wrapDeg(tel.headingDeg - 210)));
      if (!crossed && Math.abs(tel.awa) < 20) {
        crossed = true;
        boomAtCross = sim.state.boomDeg.main;
      }
    }
    // the bow passed head-to-wind (the wind direction itself)…
    expect(closestToWind).toBeLessThan(25);
    // …and never approached the dead-run direction — this was a tack, not a jibe
    expect(closestToLee).toBeGreaterThan(90);
    // still the old boom side entering the no-go cone; flipped after the bow crossed
    // (physics boom sign follows the WIND side; the renderer mirrors to leeward)
    expect(boomAtCross).toBeLessThan(0);
    expect(sim.state.boomDeg.main).toBeGreaterThan(0);
    expect(Math.sign(sim.telemetry().awa)).toBe(1); // now the starboard tack
  }, 30000);

  it("starboard→port tack mirrors correctly", () => {
    const sim = makeSim(12, 30);
    sim.state.heading = 350 * DEG; // close-hauled STBD: TWA = +40, boom to port
    sailFor(sim, 60, 350);
    expect(Math.sign(sim.telemetry().awa)).toBe(1);

    let closestToWind = 180;
    let closestToLee = 180;
    let reachedNewCourse = false;
    for (let i = 0; i < 12 / DT; i++) {
      if (sim.state.heading / DEG >= 430) reachedNewCourse = true;
      sim.step(DT, {
        // Tiller to port turns through the wind; center on the new course.
        tiller: reachedNewCourse ? headingHold(sim, 70) : -0.7,
        sheetTargetDeg: 15,
        jibTargetDeg: 15,
        auxOn: false,
      });
      const tel = sim.telemetry();
      closestToWind = Math.min(closestToWind, Math.abs(wrapDeg(tel.headingDeg - 30)));
      closestToLee = Math.min(closestToLee, Math.abs(wrapDeg(tel.headingDeg - 210)));
    }
    expect(closestToWind).toBeLessThan(25);
    expect(closestToLee).toBeGreaterThan(90);
    expect(sim.state.boomDeg.main).toBeLessThan(0); // wind now from port: boom follows
    expect(Math.sign(sim.telemetry().awa)).toBe(-1); // now the port tack
  }, 30000);

  it("heels to the new leeward after tacking", () => {
    const sim = makeSim(12, 30); // wind from 030
    sim.state.heading = 70 * DEG; // port close-hauled: leeward = starboard (+)
    sailFor(sim, 60, 70);
    const heelBefore = sim.telemetry().heelDeg;
    expect(heelBefore).toBeGreaterThan(5); // carried starboard heel on port tack

    let minAbsHeel = 180; // must pass near-flat through the wind
    for (let i = 0; i < 6 / DT; i++) {
      sim.step(DT, { tiller: 0.7, sheetTargetDeg: 15, jibTargetDeg: 15, auxOn: false });
      minAbsHeel = Math.min(minAbsHeel, Math.abs(sim.telemetry().heelDeg));
    }
    sailFor(sim, 45, 350); // settle on the starboard tack
    const heelAfter = sim.telemetry().heelDeg;
    expect(minAbsHeel).toBeLessThan(6); // rolled through ~flat in the cone
    expect(heelAfter).toBeLessThan(-5); // now port-down (leeward) on stbd tack
  }, 30000);

  it("tacks through the wind when carrying way", () => {
    const sim = makeSim(12, 0); // wind from N
    sim.state.heading = (315 * Math.PI) / 180; // start close-hauled, port tack
    sailFor(sim, 60, 315);
    expect(sim.telemetry().sog).toBeGreaterThan(3);
    // push the tiller to PORT (negative) to turn starboard through the wind to 045
    for (let i = 0; i < 10 / DT; i++) {
      sim.step(DT, { tiller: -0.7, sheetTargetDeg: 10, jibTargetDeg: 15, auxOn: false });
    }
    const hdg = ((sim.state.heading * 180) / Math.PI + 720) % 360;
    expect(hdg).toBeGreaterThan(20);
    expect(hdg).toBeLessThan(80);
    expect(sim.telemetry().sog).toBeGreaterThan(1.5);
  }, 30000);

  it("carries a 15° helm tack through the no-go zone in modest wind", () => {
    for (const scenario of [
      { windKn: 6, maxSeconds: 14, minSog: 0.65 },
      { windKn: 8, maxSeconds: 12, minSog: 0.8 },
    ]) {
      const sim = makeConstantSim(scenario.windKn, 0);
      sim.state.heading = 315 * DEG;

      // Reproduce the interactive close-hauled defaults.
      for (let i = 0; i < 60 / DT; i++) {
        sim.step(DT, {
          tiller: headingHold(sim, 315),
          sheetTargetDeg: 15,
          jibTargetDeg: 15,
          auxOn: false,
        });
      }
      expect(sim.telemetry().sog).toBeGreaterThan(2);

      const tillerFor15Deg = -15 / harbor20.rudder.maxEffectiveAngle;
      let minSog = Infinity;
      let crossedAt: number | null = null;
      for (let i = 0; i < scenario.maxSeconds / DT; i++) {
        sim.step(DT, {
          tiller: tillerFor15Deg,
          sheetTargetDeg: 15,
          jibTargetDeg: 15,
          auxOn: false,
        });
        minSog = Math.min(minSog, sim.telemetry().sog);
        // Wind is 000°, so 035° is the far edge of the ±35° no-go cone.
        if (sim.state.heading / DEG >= 395) {
          crossedAt = i * DT;
          break;
        }
      }

      expect(crossedAt).not.toBeNull();
      expect(crossedAt!).toBeLessThan(scenario.maxSeconds);
      expect(minSog).toBeGreaterThan(scenario.minSog);
    }
  }, 30000);

  it("wind-drives both booms across at finite rates during a tack", () => {
    const sim = makeSim(12, 0); // wind from N
    sim.state.heading = (315 * Math.PI) / 180; // close-hauled, starboard tack (AWA +45)
    sailFor(sim, 30, 315);
    const main = sim.state.boomDeg.main;
    const jib = sim.state.boomDeg.jib;
    expect(main).toBeGreaterThan(0); // wind from stbd → + side
    expect(jib).toBeGreaterThan(0);

    // Tack through the wind to port tack, tracking both physical booms.
    let maxMainStep = 0;
    let maxJibStep = 0;
    let previousMain = main;
    let previousJib = jib;
    let mainRateAtCross: number | null = null;
    let jibRateAtCross: number | null = null;
    for (let i = 0; i < 8 / DT; i++) {
      sim.step(DT, { tiller: -0.7, sheetTargetDeg: 12, jibTargetDeg: 15, auxOn: false });
      const currentMain = sim.state.boomDeg.main;
      const currentJib = sim.state.boomDeg.jib;
      maxMainStep = Math.max(maxMainStep, Math.abs(currentMain - previousMain));
      maxJibStep = Math.max(maxJibStep, Math.abs(currentJib - previousJib));
      if (mainRateAtCross === null && previousMain > 0 && currentMain < 0) {
        mainRateAtCross = sim.state.boomRateDeg.main;
      }
      if (jibRateAtCross === null && previousJib > 0 && currentJib < 0) {
        jibRateAtCross = sim.state.boomRateDeg.jib;
      }
      previousMain = currentMain;
      previousJib = currentJib;
    }
    const mainPolicy = harbor20.sails.find((sail) => sail.id === "main")!.trim;
    const jibPolicy = harbor20.sails.find((sail) => sail.id === "jib")!.trim;
    if (mainPolicy.kind !== "sheet") throw new Error("main must be sheeted");
    if (jibPolicy.kind !== "selfTacking") throw new Error("jib must self-tend");
    // Finite sweep bounded by the configured physical/numerical safety cap.
    expect(maxMainStep).toBeLessThanOrEqual(mainPolicy.maxBoomRate * DT + 1e-9);
    expect(maxJibStep).toBeLessThanOrEqual(jibPolicy.maxBoomRate * DT + 1e-9);
    // Both booms cross with angular velocity, then their new-tack sheets catch them.
    expect(mainRateAtCross).not.toBeNull();
    expect(jibRateAtCross).not.toBeNull();
    expect(mainRateAtCross!).toBeLessThan(0);
    expect(jibRateAtCross!).toBeLessThan(0);
    expect(sim.state.boomDeg.main).toBeLessThan(0);
    expect(sim.state.boomDeg.jib).toBeLessThan(0);
  }, 30000);

  it("has no steerage way when stopped", () => {
    const sim = makeSim(0.5, 0); // near-calm: sails slack, boat stays stopped
    const h0 = sim.state.heading;
    for (let i = 0; i < 5 / DT; i++) {
      sim.step(DT, { tiller: 1, sheetTargetDeg: 60, jibTargetDeg: 60, auxOn: false });
    }
    expect(Math.abs(sim.state.heading - h0)).toBeLessThan(0.05);
  }, 30000);

  it("heels to leeward and depowers", () => {
    const sim = makeSim(18, 0); // wind from N; sailing heading 90 (east)
    sim.state.heading = Math.PI / 2;
    sailFor(sim, 60, 90);
    const tel = sim.telemetry();
    // wind from port → PORT tack → boat heels to STARBOARD (leeward), positive
    expect(tel.heelDeg).toBeGreaterThan(5);
    expect(tel.heelDeg).toBeLessThan(45);
  }, 30000);

  it("makes leeway to leeward upwind", () => {
    const sim = makeSim(12, 0);
    sim.state.heading = (45 * Math.PI) / 180;
    const tel = sailFor(sim, 90, 45);
    // wind from N, heading 045 → wind from port → drift to starboard... wait:
    // heading 045, wind from 000: wind hits the port bow → leeway to starboard
    expect(Math.abs(tel.leeway)).toBeGreaterThan(0.5);
  }, 30000);
});

describe("grounding", () => {
  it("slides back off the shoreline and never produces NaN state", () => {
    // a tiny fake harbor: water is a 200x200 m box around the origin
    const water = {
      contains: (p: { x: number; y: number }) =>
        Math.abs(p.x) < 100 && Math.abs(p.y) < 100,
    };
    const sim = makeSim(10, 0); // wind from north
    const simWater = new Sim(harbor20, new Environment({ speed: kn(10), directionFrom: 0, gust: kn(10), source: "t" }), water);
    void sim;
    // sail due north straight at the wall
    simWater.spawn({ x: 0, y: 0 }, 0);
    for (let i = 0; i < 90 / DT; i++) {
      simWater.step(DT, { tiller: 0, sheetTargetDeg: 45, jibTargetDeg: 45, auxOn: false });
    }
    const s = simWater.state;
    expect(Number.isFinite(s.pos.x + s.pos.y + s.heading + s.u + s.heel)).toBe(true);
    // either came off or is working off the shore (aground tolerates slow progress)
    if (s.aground) {
      expect(Math.abs(s.pos.y)).toBeLessThan(100);
    }
  }, 30000);
});

describe("electric auxiliary", () => {
  const motorSpeedAfter = (dt: number, seconds = 180): number => {
    const sim = makeSim(0, 0);
    for (let i = 0; i < seconds / dt; i++) {
      sim.step(dt, { tiller: 0, sheetTargetDeg: 85, jibTargetDeg: 75, auxOn: true });
    }
    return toKn(sim.state.u);
  };

  it("reaches the published approximately 5 kn in calm water", () => {
    const speed = motorSpeedAfter(DT);
    expect(speed).toBeGreaterThan(4.85);
    expect(speed).toBeLessThan(5.15);
  }, 30000);

  it("uses a capped, power-limited thrust curve", () => {
    expect(auxiliaryThrust(harbor20, -1)).toBeCloseTo(harbor20.auxiliaryThrust);
    expect(auxiliaryThrust(harbor20, 0)).toBeCloseTo(harbor20.auxiliaryThrust);
    expect(auxiliaryThrust(harbor20, kn(5))).toBeLessThan(harbor20.auxiliaryThrust);
    expect(auxiliaryThrust(harbor20, kn(5))).toBeGreaterThan(0);
  });

  it("has stable steady speed at 60 and 120 Hz", () => {
    const at60Hz = motorSpeedAfter(1 / 60);
    const at120Hz = motorSpeedAfter(1 / 120);
    expect(Math.abs(at60Hz - at120Hz)).toBeLessThan(0.02);
  }, 30000);

  it("provides rudder steerage while maintaining powered way", () => {
    const sim = makeSim(0, 0);
    for (let i = 0; i < 30 / DT; i++) {
      sim.step(DT, { tiller: 0, sheetTargetDeg: 85, jibTargetDeg: 75, auxOn: true });
    }
    const initialHeading = sim.telemetry().headingDeg;
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT, {
        tiller: -10 / harbor20.rudder.maxEffectiveAngle,
        sheetTargetDeg: 85,
        jibTargetDeg: 75,
        auxOn: true,
      });
    }

    expect(sim.telemetry().headingDeg - initialHeading).toBeGreaterThan(20);
    expect(toKn(sim.state.u)).toBeGreaterThan(4);
  }, 30000);
});

describe("MOB marker drift", () => {
  it("cannot recover until the boat first sails 15 m away", () => {
    const drill = new MobDrill();
    const stopped = makeSim(0, 0).telemetry();
    drill.drop();

    drill.update(DT, stopped, 0, 0);
    expect(drill.status.recovered).toBe(false);
    expect(drill.status.armed).toBe(false);

    // Even re-entering the recovery circle cannot score before departure.
    drill.update(5, stopped, 180, 4);
    expect(drill.status.recovered).toBe(false);

    drill.update(5, stopped, 180, MOB_ARM_DISTANCE_M);
    expect(drill.status.armed).toBe(true);
    expect(drill.status.recovered).toBe(false);

    drill.update(5, { ...stopped, sog: 0.5 }, 0, 4);
    expect(drill.status.recovered).toBe(true);
    expect(drill.status.result?.timeSec).toBeCloseTo(15 + DT);
    expect(drill.status.result?.closestM).toBe(4);
  });

  it("keeps marker IDs unique and supports a complete drill clear", () => {
    const sim = makeSim(8, 0);
    const first = sim.dropFloat("mob");
    sim.state.pos = { x: 12, y: -4 };
    const replacement = sim.dropFloat("mob");

    expect(replacement).not.toBe(first);
    expect(sim.floats).toEqual([replacement]);
    expect(replacement.pos).toEqual({ x: 12, y: -4 });
    expect(sim.removeFloat("mob")).toBe(true);
    expect(sim.floats).toEqual([]);
    expect(sim.removeFloat("mob")).toBe(false);
  });

  it("drifts downwind faster than nothing and with the current", () => {
    const env = new Environment({
      speed: kn(12),
      directionFrom: 0,
      gust: kn(12),
      source: "test",
    });
    env.current = { x: 0.3, y: 0 };
    const sim = new Sim(harbor20, env, null);
    const f = sim.dropFloat("mob");
    for (let i = 0; i < 60 / DT; i++) {
      sim.step(DT, { tiller: 0, sheetTargetDeg: 60, jibTargetDeg: 60, auxOn: false });
    }
    // 60 s: current pushes 18 m east; windage pushes ~2.5% of 6 m/s south ≈ 9 m
    expect(f.pos.x).toBeGreaterThan(17);
    expect(f.pos.x).toBeLessThan(20);
    expect(f.pos.y).toBeLessThan(-5);
  }, 30000);
});
