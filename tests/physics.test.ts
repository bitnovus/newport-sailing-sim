import { describe, expect, it } from "vitest";
import { JIB_WING_MIN_AWA_DEG, Sim } from "../src/core/sim";
import { Environment } from "../src/core/environment";
import { harbor20 } from "../src/boats/harbor20";
import { kn, toKn, wrapDeg, DEG } from "../src/core/units";
import {
  auxiliaryThrust,
  hullCrossflowYaw,
  hullDrag,
  keelForces,
  rudderForces,
  yawDamping,
} from "../src/core/physics/hydro";
import {
  downwindExposure,
  idealBoomAngle,
  luffFraction,
  sailCoefficients,
  selfTackingTrim,
  sheetedBoomRestAngle,
  solveSail,
  stepSheetedBoom,
  stepWingedBoom,
} from "../src/core/physics/sails";
import {
  MobDrill,
  MOB_ARM_DISTANCE_M,
  MOB_RECOVERY_DISTANCE_M,
} from "../src/ui/hud";
import { apparentWind, closeHauledHeading } from "../src/core/physics/wind";

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
  return Math.abs(idealBoomAngle(sim.telemetry().awa));
}

/** Sail with auto-trim for `seconds`, returning the final telemetry. */
function sailFor(sim: Sim, seconds: number, headingDeg: number, jibWinged = false) {
  for (let i = 0; i < seconds / DT; i++) {
    const tel = sim.telemetry();
    const sheet = i === 0 ? 15 : Math.abs(idealBoomAngle(tel.awa));
    sim.step(DT, {
      tiller: headingHold(sim, headingDeg),
      sheetTargetDeg: sheet,
      jibTargetDeg: i === 0 ? 15 : idealJibTrim(sim),
      jibWinged,
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

function steadyPoint(windKn: number, twaDeg: number, seconds = 120, jibWinged = false) {
  const sim = makeConstantSim(windKn, 0);
  sim.state.heading = twaDeg * DEG;
  const telemetry = sailFor(sim, seconds, twaDeg, jibWinged);
  return { sim, telemetry };
}

describe("Harbor 20 class specification", () => {
  it("uses the published class-ready weight and sail plan", () => {
    const poundsToKg = 0.45359237;
    const squareFeetToSquareMeters = 0.09290304;
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const jib = harbor20.sails.find((sail) => sail.id === "jib")!;

    expect(harbor20.mass).toBeCloseTo(1950 * poundsToKg, 1);
    expect(harbor20.crewMass).toBe(3 * 75);
    expect(harbor20.mass + harbor20.crewMass).toBeCloseTo(1109.5, 1);
    expect(main.area).toBeCloseTo(153 * squareFeetToSquareMeters, 2);
    expect(jib.area).toBeCloseTo(77 * squareFeetToSquareMeters, 2);
    expect(harbor20.closeHauledTwa).toBe(45);
  });
});

describe("wind environment", () => {
  it("orients a close-hauled start on the requested tack", () => {
    expect(closeHauledHeading(0, 45, "starboard")).toBe(315);
    expect(closeHauledHeading(0, 45, "port")).toBe(45);
    expect(closeHauledHeading(250, 45, "starboard")).toBe(205);
  });

  it("derives apparent wind from true wind minus ground velocity", () => {
    const heading = 315 * DEG;
    const trueWind = { speed: kn(12), directionFrom: 0 };
    const stationary = apparentWind(trueWind, heading, { x: 0, y: 0 });
    const moving = apparentWind(trueWind, heading, {
      x: Math.sin(heading) * kn(4),
      y: Math.cos(heading) * kn(4),
    });

    expect(stationary.angle).toBeCloseTo(45, 8);
    expect(toKn(stationary.speed)).toBeCloseTo(12, 8);
    expect(moving.angle).toBeGreaterThan(0);
    expect(moving.angle).toBeLessThan(stationary.angle);
    expect(moving.speed).toBeGreaterThan(stationary.speed);
  });

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
  it("scales pressure with apparent-wind speed squared and mirrors force by tack", () => {
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const low = solveSail(
      main,
      { speed: kn(6), angle: 35, vector: { x: 0, y: 0 } },
      15,
      0,
    );
    const starboard = solveSail(
      main,
      { speed: kn(12), angle: 35, vector: { x: 0, y: 0 } },
      15,
      0,
    );
    const port = solveSail(
      main,
      { speed: kn(12), angle: -35, vector: { x: 0, y: 0 } },
      -15,
      0,
    );

    expect(starboard.drive / low.drive).toBeCloseTo(4, 8);
    expect(starboard.side / low.side).toBeCloseTo(4, 8);
    expect(starboard.drive).toBeCloseTo(port.drive, 8);
    expect(starboard.side).toBeCloseTo(-port.side, 8);
    expect(starboard.heel).toBeLessThan(0);
    expect(port.heel).toBeGreaterThan(0);
  });

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

  it("models a shadowed jib wink and a supported reverse-face wing", () => {
    const jib = harbor20.sails.find((sail) => sail.id === "jib")!;
    const awa = { speed: kn(8), angle: 175, vector: { x: 0, y: 0 } };
    const shadowed = solveSail(jib, awa, 75, 0, { blanketed: true });
    const unsupported = solveSail(jib, awa, -75, 0, { blanketed: false });
    const winged = solveSail(jib, awa, -75, 0, {
      winged: true,
      blanketed: false,
    });

    expect(downwindExposure(jib, 140)).toBe(1);
    expect(downwindExposure(jib, 175)).toBeCloseTo(0.375, 6);
    expect(shadowed.winking).toBe(true);
    expect(shadowed.flow).toBeGreaterThan(0.35);
    expect(shadowed.flow).toBeLessThan(downwindExposure(jib, 175));
    expect(shadowed.luffing).toBe(true);
    expect(unsupported.flow).toBe(0);
    expect(unsupported.luffing).toBe(true);
    expect(winged.winged).toBe(true);
    expect(winged.winking).toBe(false);
    expect(winged.luffing).toBe(false);
    expect(winged.flow).toBe(1);
    expect(winged.drive).toBeGreaterThan(shadowed.drive * 1.3);
  });

  it("loses projected area when a downwind sail is over-sheeted", () => {
    const main = harbor20.sails.find((sail) => sail.id === "main")!;
    const awa = { speed: kn(8), angle: 175, vector: { x: 0, y: 0 } };
    const eased = solveSail(main, awa, 85, 0, { blanketed: false });
    const overSheeted = solveSail(main, awa, 8, 0, { blanketed: false });

    expect(sailCoefficients(90).cd).toBeGreaterThan(1.6);
    expect(sailCoefficients(170).cd).toBeLessThan(0.2);
    expect(luffFraction(170)).toBeGreaterThan(0.8);
    expect(eased.drive).toBeGreaterThan(overSheeted.drive * 8);
    expect(eased.flow).toBeGreaterThan(overSheeted.flow);
  });

  it("moves the club boom to weather at a finite rate when winged", () => {
    const jib = harbor20.sails.find((sail) => sail.id === "jib")!;
    if (jib.trim.kind !== "selfTacking") throw new Error("jib must self-tend");
    let boom = { angleDeg: 75, rateDeg: 0 };
    let crossedAt: number | null = null;
    let maxStep = 0;

    for (let i = 0; i < 5 / DT; i++) {
      const previous = boom.angleDeg;
      boom = stepWingedBoom(jib, jib.trim.max, -1, boom, DT);
      maxStep = Math.max(maxStep, Math.abs(boom.angleDeg - previous));
      if (crossedAt === null && previous > 0 && boom.angleDeg <= 0) {
        crossedAt = i * DT;
      }
    }

    expect(crossedAt).not.toBeNull();
    expect(crossedAt!).toBeGreaterThan(0.5);
    expect(maxStep).toBeLessThanOrEqual(jib.trim.maxBoomRate * DT + 1e-9);
    expect(boom.angleDeg).toBeCloseTo(-jib.trim.max, 1);
    expect(Math.abs(boom.rateDeg)).toBeLessThan(0.2);
  });

  it("engages wing-and-wing only on a deep run and overrides trim non-destructively", () => {
    const shallow = makeConstantSim(8, 0);
    shallow.state.heading = 90 * DEG;
    shallow.step(DT, {
      tiller: 0,
      sheetTargetDeg: 50,
      jibTargetDeg: 15,
      jibWinged: true,
      auxOn: false,
    });
    expect(Math.abs(shallow.telemetry().awa)).toBeLessThan(JIB_WING_MIN_AWA_DEG);
    expect(shallow.state.jibWinged).toBe(false);

    const deep = makeConstantSim(8, 0);
    deep.state.heading = 175 * DEG;
    for (let i = 0; i < 6 / DT; i++) {
      deep.step(DT, {
        tiller: 0,
        sheetTargetDeg: 85,
        jibTargetDeg: 15,
        jibWinged: true,
        auxOn: false,
      });
    }

    const tel = deep.telemetry();
    const jib = tel.sails.find((sail) => sail.sailId === "jib")!;
    expect(deep.state.jibWinged).toBe(true);
    expect(Math.sign(deep.state.boomDeg.jib)).toBe(-Math.sign(deep.state.boomDeg.main));
    expect(Math.abs(deep.state.boomDeg.jib)).toBeGreaterThan(70);
    expect(jib.winged).toBe(true);
    expect(jib.flow).toBe(1);
    expect(tel.jibDeg).toBe(15);
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

  it("turns helm beyond 12.5 degrees increasingly into a brake", () => {
    const normalHelm = rudderForces(harbor20, 2, 12.5);
    const hardOver = rudderForces(harbor20, 2, 35);

    expect(hardOver.surge).toBeLessThan(normalHelm.surge);
    expect(Math.abs(hardOver.side)).toBeLessThan(Math.abs(normalHelm.side));
    expect(Math.abs(hardOver.yaw)).toBeLessThan(Math.abs(normalHelm.yaw));
  });

  it("applies mirrored keel force and moment at the CLR", () => {
    const starboard = keelForces(harbor20, 2, -0.2, 0.1);
    const port = keelForces(harbor20, 2, 0.2, -0.1);

    expect(starboard.side).toBeGreaterThan(0);
    expect(starboard.yaw).toBeCloseTo(
      starboard.side * harbor20.keelArm,
      8,
    );
    expect(port.surge).toBeCloseTo(starboard.surge, 8);
    expect(port.side).toBeCloseTo(-starboard.side, 8);
    expect(port.yaw).toBeCloseTo(-starboard.yaw, 8);
  });

  it("keeps passive keel and rudder forces energy dissipative", () => {
    const u = 2;
    const v = -0.25;
    const r = 0.12;
    const keel = keelForces(harbor20, u, v, r);
    const rudder = rudderForces(harbor20, u, 25, v, r);
    const keelPower = keel.surge * u + keel.side * v + keel.yaw * r;
    const rudderPower =
      rudder.surge * u + rudder.side * v + rudder.yaw * r;

    expect(keelPower).toBeLessThan(0);
    expect(rudderPower).toBeLessThan(0);
  });

  it("keeps hydrodynamic edge states finite, mirrored, and passive", () => {
    for (const u of [-0.5, 0, 1e-7, 0.25, 2, 8]) {
      for (const v of [-3, -0.4, 0, 0.4, 3]) {
        for (const r of [-0.8, -0.2, 0, 0.2, 0.8]) {
          const keel = keelForces(harbor20, u, v, r);
          const mirroredKeel = keelForces(harbor20, u, -v, -r);
          const keelPower =
            keel.surge * u + keel.side * v + keel.yaw * r;
          const crossflow = hullCrossflowYaw(harbor20, u, v, r);
          const dampingPower = yawDamping(harbor20, u, r) * r;

          expect(Object.values(keel).every(Number.isFinite)).toBe(true);
          expect(keelPower).toBeLessThanOrEqual(1e-7);
          expect(Number.isFinite(crossflow)).toBe(true);
          expect(crossflow * r).toBeLessThanOrEqual(1e-7);
          expect(dampingPower).toBeLessThanOrEqual(0);
          expect(mirroredKeel.surge).toBeCloseTo(keel.surge, 8);
          expect(mirroredKeel.side).toBeCloseTo(-keel.side, 8);
          expect(mirroredKeel.yaw).toBeCloseTo(-keel.yaw, 8);
          expect(hullCrossflowYaw(harbor20, u, -v, -r)).toBeCloseTo(
            -crossflow,
            8,
          );

          for (const delta of [-35, -15, 0, 15, 35]) {
            const rudder = rudderForces(harbor20, u, delta, v, r);
            const mirroredRudder = rudderForces(
              harbor20,
              u,
              -delta,
              -v,
              -r,
            );
            const rudderPower =
              rudder.surge * u + rudder.side * v + rudder.yaw * r;

            expect(Object.values(rudder).every(Number.isFinite)).toBe(true);
            expect(rudderPower).toBeLessThanOrEqual(1e-7);
            expect(mirroredRudder.surge).toBeCloseTo(rudder.surge, 8);
            expect(mirroredRudder.side).toBeCloseTo(-rudder.side, 8);
            expect(mirroredRudder.yaw).toBeCloseTo(-rudder.yaw, 8);
            expect(mirroredRudder.angleOfAttackDeg).toBeCloseTo(
              -rudder.angleOfAttackDeg,
              8,
            );
          }
        }
      }
    }
  });

  it("uses stern yaw inflow to unload and damp the rudder", () => {
    const straight = rudderForces(harbor20, 2, 20, 0, 0);
    const turning = rudderForces(harbor20, 2, 20, 0, 0.2);
    const centered = rudderForces(harbor20, 2, 0, 0, 0.2);

    expect(turning.angleOfAttackDeg).toBeLessThan(straight.angleOfAttackDeg);
    expect(centered.angleOfAttackDeg).toBeLessThan(0);
    expect(centered.yaw).toBeLessThan(0);
  });

  it("opposes both forward motion and sternway with hull resistance", () => {
    const forward = hullDrag(harbor20, 0.5);
    const astern = hullDrag(harbor20, -0.5);
    expect(forward).toBeGreaterThan(0);
    expect(astern).toBeLessThan(0);
    expect(Math.abs(astern)).toBeGreaterThan(forward * 10);
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

  it("keeps the piecewise sail-force curve continuous", () => {
    const epsilon = 1e-6;
    for (const boundary of [0, 6, 18, 50, 90, 180]) {
      const below = sailCoefficients(boundary - epsilon);
      const above = sailCoefficients(boundary + epsilon);
      expect(Math.abs(above.cl - below.cl)).toBeLessThan(1e-4);
      expect(Math.abs(above.cd - below.cd)).toBeLessThan(1e-4);
    }
  });

  it("eases the ideal boom monotonically from close-hauled to running", () => {
    const close = Math.abs(idealBoomAngle(30));
    const beam = Math.abs(idealBoomAngle(90));
    const run = Math.abs(idealBoomAngle(175));
    expect(close).toBeLessThan(beam);
    expect(beam).toBeLessThan(run);
    expect(close).toBeLessThan(15);
    expect(idealBoomAngle(70)).toBe(52);
    expect(run).toBe(85);
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

  it("follows the expected speed order across every principal point of sail", () => {
    const closeHauled = polarPoint(12, 45);
    const closeReach = polarPoint(12, 60);
    const beamReach = polarPoint(12, 90);
    const broadReach = polarPoint(12, 120);
    const run = polarPoint(12, 180);

    expect(closeReach).toBeGreaterThan(closeHauled);
    expect(beamReach).toBeGreaterThan(closeReach);
    expect(beamReach).toBeGreaterThan(broadReach);
    expect(broadReach).toBeGreaterThan(run);
    expect(run).toBeLessThan(closeHauled);
  }, 30000);

  it("progressively eases and unloads the boat while bearing away", () => {
    const closeHauled = steadyPoint(12, 45);
    const beamReach = steadyPoint(12, 90);
    const broadReach = steadyPoint(12, 120);
    const run = steadyPoint(12, 175);

    const mainAngle = (point: ReturnType<typeof steadyPoint>) =>
      Math.abs(point.sim.state.boomDeg.main);
    expect(mainAngle(closeHauled)).toBeLessThan(mainAngle(beamReach));
    expect(mainAngle(beamReach)).toBeLessThan(mainAngle(broadReach));
    expect(mainAngle(broadReach)).toBeLessThan(mainAngle(run));

    expect(Math.abs(closeHauled.telemetry.heelDeg)).toBeGreaterThan(
      Math.abs(beamReach.telemetry.heelDeg),
    );
    expect(Math.abs(beamReach.telemetry.heelDeg)).toBeGreaterThan(
      Math.abs(broadReach.telemetry.heelDeg),
    );
    expect(Math.abs(broadReach.telemetry.heelDeg)).toBeGreaterThan(
      Math.abs(run.telemetry.heelDeg),
    );
    expect(Math.abs(closeHauled.telemetry.leeway)).toBeGreaterThan(
      Math.abs(beamReach.telemetry.leeway),
    );
    expect(Math.abs(beamReach.telemetry.leeway)).toBeGreaterThan(
      Math.abs(broadReach.telemetry.leeway),
    );

    const runJib = run.telemetry.sails.find((sail) => sail.sailId === "jib")!;
    expect(runJib.winking).toBe(true);
    expect(runJib.flow).toBeLessThan(0.5);
  }, 30000);

  it("makes wing-and-wing useful without making the dead run the fastest course", () => {
    const closeHauled = steadyPoint(12, 45);
    const normalRun = steadyPoint(12, 180);
    const wingedRun = steadyPoint(12, 180, 120, true);
    const jib = wingedRun.telemetry.sails.find((sail) => sail.sailId === "jib")!;

    expect(wingedRun.telemetry.sog).toBeGreaterThan(normalRun.telemetry.sog + 0.08);
    expect(wingedRun.telemetry.sog).toBeLessThan(closeHauled.telemetry.sog);
    expect(jib.winged).toBe(true);
    expect(Math.sign(wingedRun.sim.state.boomDeg.jib)).toBe(
      -Math.sign(wingedRun.sim.state.boomDeg.main),
    );
  }, 30000);

  it("mirrors speed, heel, leeway, and boom position on both tacks", () => {
    for (const twa of [45, 60, 90, 120, 150, 175]) {
      const port = steadyPoint(12, -twa, 90);
      const starboard = steadyPoint(12, twa, 90);
      expect(port.telemetry.sog).toBeCloseTo(starboard.telemetry.sog, 2);
      expect(port.telemetry.heelDeg).toBeCloseTo(-starboard.telemetry.heelDeg, 2);
      expect(port.telemetry.leeway).toBeCloseTo(-starboard.telemetry.leeway, 2);
      expect(port.sim.state.boomDeg.main).toBeCloseTo(
        -starboard.sim.state.boomDeg.main,
        2,
      );
      expect(port.sim.state.boomDeg.jib).toBeCloseTo(
        -starboard.sim.state.boomDeg.jib,
        2,
      );
    }
  }, 30000);

  it("does not exceed hull speed by much in 20 kn", () => {
    const sog = polarPoint(20, 90);
    expect(sog).toBeLessThan(6.2); // hull speed 5.6 kn
  }, 30000);

  it("cannot make progress in the no-go zone", () => {
    const sog = polarPoint(12, 10);
    expect(sog).toBeLessThan(1.0);
  }, 30000);

  it("develops bounded sternway rather than hitting the reverse-speed clamp in irons", () => {
    const speeds: number[] = [];
    for (const windKn of [6, 12, 20]) {
      const sim = makeConstantSim(windKn, 0);
      for (let i = 0; i < 120 / DT; i++) {
        sim.step(DT, {
          tiller: 0,
          sheetTargetDeg: 5,
          jibTargetDeg: 8,
          auxOn: false,
        });
      }
      expect(sim.state.u).toBeLessThan(0);
      expect(sim.state.u).toBeGreaterThan(-0.5);
      speeds.push(Math.abs(sim.state.u));
    }
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(speeds[2]).toBeGreaterThan(speeds[1]);
  }, 30000);

  it("cannot hold an illegal upwind track even when the bow is pinched", () => {
    for (const attemptedTwa of [20, 30, 35]) {
      const sim = makeConstantSim(12, 0);
      sim.state.heading = attemptedTwa * DEG;
      for (let i = 0; i < 120 / DT; i++) {
        const tel = sim.telemetry();
        const trim = i === 0 ? 15 : Math.abs(idealBoomAngle(tel.awa));
        const err =
          ((attemptedTwa - sim.state.heading / DEG + 540) % 360) - 180;
        sim.step(DT, {
          // A firm test pilot removes the proportional controller's static
          // weather-helm offset, so this checks the requested bow heading
          // rather than an autopilot calibration artifact.
          tiller: Math.max(-0.8, Math.min(0.8, -err / 5)),
          sheetTargetDeg: trim,
          jibTargetDeg: trim,
          auxOn: false,
        });
      }
      const telemetry = sim.telemetry();
      const courseOffWind = Math.abs(wrapDeg(telemetry.cog));
      expect(courseOffWind).toBeGreaterThanOrEqual(35);
    }
  }, 30000);
});

describe("dynamic behavior", () => {
  it("uses boat plus crew mass for translational inertia", () => {
    const loaded = makeConstantSim(12, 0);
    const lightEnv = new Environment({
      speed: kn(12),
      directionFrom: 0,
      gust: kn(12),
      source: "test",
    });
    lightEnv.windAt = () => ({ speed: kn(12), directionFrom: 0 });
    const light = new Sim({ ...harbor20, crewMass: 0 }, lightEnv, null);
    loaded.state.heading = light.state.heading = 315 * DEG;
    const inputs = {
      tiller: 0,
      sheetTargetDeg: 15,
      jibTargetDeg: 15,
      auxOn: false,
    };

    loaded.step(DT, inputs);
    light.step(DT, inputs);

    const expectedAccelerationRatio =
      (harbor20.mass + harbor20.crewMass) / harbor20.mass;
    expect(light.state.u / loaded.state.u).toBeCloseTo(expectedAccelerationRatio, 8);
  });

  it("scales angular acceleration inversely with yaw inertia", () => {
    const makeTurningSim = (yawInertia: number) => {
      const env = new Environment({
        speed: 0,
        directionFrom: 0,
        gust: 0,
        source: "test",
      });
      env.windAt = () => ({ speed: 0, directionFrom: 0 });
      const sim = new Sim({ ...harbor20, yawInertia }, env, null);
      sim.state.u = kn(4);
      return sim;
    };
    const regular = makeTurningSim(harbor20.yawInertia);
    const doubled = makeTurningSim(harbor20.yawInertia * 2);
    const inputs = {
      tiller: -1,
      sheetTargetDeg: 85,
      jibTargetDeg: 75,
      auxOn: false,
    };

    regular.step(DT, inputs);
    doubled.step(DT, inputs);

    expect(regular.state.r / doubled.state.r).toBeCloseTo(2, 8);
    expect(regular.state.u).toBeCloseTo(doubled.state.u, 8);
    expect(regular.state.v).toBeCloseTo(doubled.state.v, 8);
  });

  it("does not turn a 1 kn hard-over entry into an instant stop", () => {
    const sim = makeConstantSim(0, 0);
    sim.state.u = kn(1);
    let maxSpeedStep = 0;
    let previousSpeed = sim.telemetry().speedThroughWater;

    for (let i = 0; i < 1 / DT; i++) {
      sim.step(DT, {
        tiller: -1,
        sheetTargetDeg: 85,
        jibTargetDeg: 75,
        auxOn: false,
      });
      const speed = sim.telemetry().speedThroughWater;
      maxSpeedStep = Math.max(maxSpeedStep, Math.abs(speed - previousSpeed));
      previousSpeed = speed;
    }

    expect(sim.telemetry().speedThroughWater).toBeGreaterThan(0.8);
    expect(maxSpeedStep).toBeLessThan(0.01);
    expect(sim.state.r).toBeGreaterThan(0);
  });

  it("damps residual yaw near a stall without erasing all tack carry", () => {
    const sim = makeConstantSim(10, 0);
    sim.state.heading = -7 * DEG;
    sim.state.u = kn(0.3);
    sim.state.r = -2.5 * DEG;
    const initialTwa = -sim.state.heading / DEG;
    const initialYawRate = Math.abs(sim.state.r);

    for (let i = 0; i < 10 / DT; i++) {
      sim.step(DT, {
        tiller: 0,
        sheetTargetDeg: 15,
        jibTargetDeg: 15,
        auxOn: false,
      });
    }

    const headingCarry = -sim.state.heading / DEG - initialTwa;
    expect(sim.telemetry().speedThroughWater).toBeLessThan(0.5);
    expect(Math.abs(sim.state.r)).toBeLessThan(initialYawRate * 0.4);
    expect(headingCarry).toBeGreaterThan(8);
    expect(headingCarry).toBeLessThan(15);
  });

  it("keeps passive planar kinetic energy monotonic in calm water", () => {
    const env = new Environment({
      speed: 0,
      directionFrom: 0,
      gust: 0,
      source: "test",
    });
    env.windAt = () => ({ speed: 0, directionFrom: 0 });
    const sim = new Sim({ ...harbor20, sails: [] }, env, null);
    const mass = harbor20.mass + harbor20.crewMass;
    sim.state.u = kn(4);
    sim.state.v = 0.6;
    sim.state.r = 0.25;
    const energy = () =>
      0.5 * mass * (sim.state.u ** 2 + sim.state.v ** 2) +
      0.5 * harbor20.yawInertia * sim.state.r ** 2;
    const initialEnergy = energy();
    let previousEnergy = initialEnergy;

    for (let i = 0; i < 10 / DT; i++) {
      sim.step(DT, {
        tiller: 0,
        sheetTargetDeg: 85,
        jibTargetDeg: 75,
        auxOn: false,
      });
      const currentEnergy = energy();
      expect(currentEnergy).toBeLessThanOrEqual(previousEnergy + 1e-6);
      previousEnergy = currentEnergy;
    }

    expect(previousEnergy).toBeLessThan(initialEnergy * 0.6);
  });

  it("mirrors hard-over turns and converges from 30 to 120 Hz", () => {
    const run = (dt: number, tiller: number) => {
      const sim = makeConstantSim(0, 0);
      sim.state.u = kn(4);
      let pivotAtHalfSecond = 0;
      let maxSpeedStep = 0;
      let previousSpeed = sim.telemetry().speedThroughWater;

      for (let i = 1; i <= 4 / dt; i++) {
        sim.step(dt, {
          tiller,
          sheetTargetDeg: 85,
          jibTargetDeg: 75,
          auxOn: false,
        });
        const speed = sim.telemetry().speedThroughWater;
        maxSpeedStep = Math.max(maxSpeedStep, Math.abs(speed - previousSpeed));
        previousSpeed = speed;
        if (i === Math.round(0.5 / dt)) {
          pivotAtHalfSecond = -sim.state.v / sim.state.r;
        }
      }

      return {
        headingDeg: sim.state.heading / DEG,
        speed: sim.telemetry().speedThroughWater,
        u: sim.state.u,
        v: sim.state.v,
        r: sim.state.r,
        pivotAtHalfSecond,
        maxSpeedStep,
      };
    };

    const starboard = run(DT, -1);
    const port = run(DT, 1);
    const coarse = run(1 / 30, -1);
    const fine = run(1 / 120, -1);

    expect(port.headingDeg).toBeCloseTo(-starboard.headingDeg, 8);
    expect(port.speed).toBeCloseTo(starboard.speed, 8);
    expect(port.u).toBeCloseTo(starboard.u, 8);
    expect(port.v).toBeCloseTo(-starboard.v, 8);
    expect(port.r).toBeCloseTo(-starboard.r, 8);
    expect(port.pivotAtHalfSecond).toBeCloseTo(
      starboard.pivotAtHalfSecond,
      8,
    );

    expect(Math.abs(coarse.headingDeg - fine.headingDeg)).toBeLessThan(1);
    expect(coarse.speed).toBeCloseTo(fine.speed, 1);
    expect(coarse.pivotAtHalfSecond).toBeCloseTo(
      fine.pivotAtHalfSecond,
      0,
    );
    expect(coarse.maxSpeedStep).toBeLessThan(0.1);
  });

  it("moves the turn pivot forward without inventing keel braking", () => {
    const run = (keelArm: number) => {
      const env = new Environment({
        speed: 0,
        directionFrom: 0,
        gust: 0,
        source: "test",
      });
      env.windAt = () => ({ speed: 0, directionFrom: 0 });
      const sim = new Sim({ ...harbor20, keelArm, sails: [] }, env, null);
      sim.state.u = kn(4);

      for (let i = 0; i < 0.5 / DT; i++) {
        sim.step(DT, {
          tiller: -1,
          sheetTargetDeg: 85,
          jibTargetDeg: 75,
          auxOn: false,
        });
      }

      return {
        pivot: -sim.state.v / sim.state.r,
        radius: Math.hypot(sim.state.u, sim.state.v) / Math.abs(sim.state.r),
        speed: sim.telemetry().speedThroughWater,
      };
    };

    const centered = run(0);
    const forward = run(harbor20.keelArm);

    expect(forward.pivot).toBeGreaterThan(centered.pivot + 0.05);
    expect(forward.radius).toBeLessThan(centered.radius);
    expect(forward.speed).toBeCloseTo(centered.speed, 2);
  });

  it("carries then dissipates yaw in a rudder pull-out", () => {
    const env = new Environment({
      speed: 0,
      directionFrom: 0,
      gust: 0,
      source: "test",
    });
    env.windAt = () => ({ speed: 0, directionFrom: 0 });
    const sim = new Sim({ ...harbor20, sails: [] }, env, null);
    sim.state.u = kn(4);
    const inputs = {
      sheetTargetDeg: 85,
      jibTargetDeg: 75,
      auxOn: false,
    };

    let peakLeeway = 0;
    for (let i = 0; i < 2 / DT; i++) {
      sim.step(DT, { ...inputs, tiller: -1 });
      peakLeeway = Math.max(
        peakLeeway,
        Math.abs(sim.telemetry().leeway),
      );
    }
    expect(sim.state.r).toBeGreaterThan(0.3);
    expect(peakLeeway).toBeLessThan(15.5);

    let centeredAt: number | null = null;
    let yawAtCenter = 0;
    let headingAtCenter = 0;
    let previousYaw = Infinity;
    for (let i = 1; i <= 6 / DT; i++) {
      sim.step(DT, { ...inputs, tiller: 0 });
      if (centeredAt === null && Math.abs(sim.state.rudderDeg) < 1e-9) {
        centeredAt = i * DT;
        yawAtCenter = sim.state.r;
        headingAtCenter = sim.state.heading;
        previousYaw = Math.abs(sim.state.r);
      } else if (centeredAt !== null) {
        expect(Math.abs(sim.state.r)).toBeLessThanOrEqual(previousYaw + 1e-9);
        previousYaw = Math.abs(sim.state.r);
      }
    }

    expect(centeredAt).not.toBeNull();
    expect(centeredAt!).toBeLessThan(0.5);
    expect(yawAtCenter).toBeGreaterThan(0.25);
    expect(sim.state.r).toBeGreaterThan(0);
    expect(sim.state.r).toBeLessThan(yawAtCenter * 0.05);
    const headingCarryDeg = (sim.state.heading - headingAtCenter) / DEG;
    expect(headingCarryDeg).toBeGreaterThan(15);
    expect(headingCarryDeg).toBeLessThan(30);
  });

  it("retains way and pivots forward in a 4 kn hard-over tack", () => {
    const sim = makeConstantSim(10, 0);
    sim.state.heading = 315 * DEG;
    for (let i = 0; i < 60 / DT; i++) {
      sim.step(DT, {
        tiller: headingHold(sim, 315),
        sheetTargetDeg: 15,
        jibTargetDeg: 15,
        auxOn: false,
      });
    }

    const entryScale = kn(4) / Math.hypot(sim.state.u, sim.state.v);
    sim.state.u *= entryScale;
    sim.state.v *= entryScale;
    sim.state.r = 0;

    let minSog = Infinity;
    let sogAtOneSecond = 0;
    let initialTurnRadius = 0;
    let initialPivot = 0;
    let clearedNoGoAt: number | null = null;
    for (let i = 1; i <= 8 / DT; i++) {
      sim.step(DT, {
        tiller: -1,
        sheetTargetDeg: 15,
        jibTargetDeg: 15,
        auxOn: false,
      });
      const tel = sim.telemetry();
      minSog = Math.min(minSog, tel.sog);
      if (i === 0.5 / DT) {
        initialTurnRadius =
          Math.hypot(sim.state.u, sim.state.v) / Math.abs(sim.state.r);
        initialPivot = -sim.state.v / sim.state.r;
      }
      if (i === 1 / DT) sogAtOneSecond = tel.sog;
      if (clearedNoGoAt === null && sim.state.heading / DEG >= 395) {
        clearedNoGoAt = i * DT;
      }
    }

    expect(sogAtOneSecond).toBeGreaterThan(3);
    expect(minSog).toBeGreaterThan(1.2);
    expect(initialTurnRadius).toBeGreaterThan(8);
    expect(initialTurnRadius).toBeLessThan(18);
    expect(initialPivot).toBeGreaterThan(0.5);
    expect(initialPivot).toBeLessThan(harbor20.lwl / 2);
    expect(clearedNoGoAt).not.toBeNull();
    expect(clearedNoGoAt!).toBeLessThan(6);
  }, 30000);

  it("coasts a useful final-approach distance with both sheets released", () => {
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

    const before = sim.telemetry().speedThroughWater;
    const coastStart = { ...sim.state.pos };
    let afterFiveSeconds = 0;
    for (let i = 1; i <= 10 / DT; i++) {
      sim.step(DT, {
        tiller: headingHold(sim, 45),
        sheetTargetDeg: 85,
        jibTargetDeg: 75,
        auxOn: false,
      });
      if (i === 5 / DT) afterFiveSeconds = sim.telemetry().speedThroughWater;
    }

    const afterTenSeconds = sim.telemetry().speedThroughWater;
    const coastDistance = Math.hypot(
      sim.state.pos.x - coastStart.x,
      sim.state.pos.y - coastStart.y,
    );
    const sails = sim.telemetry().sails;
    const main = sails.find((sail) => sail.sailId === "main")!;
    const jib = sails.find((sail) => sail.sailId === "jib")!;

    expect(before).toBeGreaterThan(4.1);
    expect(afterFiveSeconds).toBeGreaterThan(2.5);
    expect(afterFiveSeconds).toBeLessThan(2.7);
    expect(afterTenSeconds).toBeGreaterThan(1.7);
    expect(afterTenSeconds).toBeLessThan(1.9);
    expect(coastDistance).toBeGreaterThan(12);
    expect(main.luffing).toBe(true);
    expect(jib.luffing).toBe(true);
  }, 30000);

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
    sim.state.heading = (315 * Math.PI) / 180; // start close-hauled, starboard tack
    sailFor(sim, 60, 315);
    expect(sim.telemetry().sog).toBeGreaterThan(3);
    // push the tiller to PORT (negative) to turn starboard through the wind to 045
    let reachedNewCourse = false;
    for (let i = 0; i < 10 / DT; i++) {
      if (sim.state.heading / DEG >= 400) reachedNewCourse = true;
      sim.step(DT, {
        tiller: reachedNewCourse ? headingHold(sim, 45) : -0.7,
        sheetTargetDeg: 10,
        jibTargetDeg: 15,
        auxOn: false,
      });
    }
    const hdg = ((sim.state.heading * 180) / Math.PI + 720) % 360;
    expect(reachedNewCourse).toBe(true);
    expect(hdg).toBeGreaterThan(35);
    expect(hdg).toBeLessThan(60);
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

describe("MOB drill and marker drift", () => {
  it("cannot recover until the boat first sails three lengths away", () => {
    const drill = new MobDrill();
    drill.drop();

    expect(MOB_ARM_DISTANCE_M).toBeCloseTo(3 * harbor20.loa, 1);

    drill.update(DT, 0, 0, 0, 0);
    expect(drill.status.recovered).toBe(false);
    expect(drill.status.armed).toBe(false);

    // Even re-entering the recovery circle cannot score before departure.
    drill.update(5, 180, 0.5, 0, 0);
    expect(drill.status.recovered).toBe(false);

    drill.update(5, 180, MOB_ARM_DISTANCE_M, 15, 2);
    expect(drill.status.armed).toBe(true);
    expect(drill.status.recovered).toBe(false);

    drill.update(5, 0, 2.5, MOB_RECOVERY_DISTANCE_M + 0.01, 0.5);
    expect(drill.status.recovered).toBe(false);

    drill.update(5, 0, 2.5, MOB_RECOVERY_DISTANCE_M, 0.5);
    expect(drill.status.recovered).toBe(true);
    expect(drill.status.result?.timeSec).toBeCloseTo(20 + DT);
    expect(drill.status.result?.closestM).toBe(MOB_RECOVERY_DISTANCE_M);
  });

  it("judges recovery speed relative to the marker instead of the shore", () => {
    const carried = makeConstantSim(0, 0);
    carried.env.current = { x: kn(2), y: 0 };
    const carriedMob = carried.dropFloat("mob");
    carried.step(DT, {
      tiller: 0,
      sheetTargetDeg: 85,
      jibTargetDeg: 75,
      auxOn: false,
    });
    const carriedRelativeSpeed = toKn(
      carried.pickupMetricsTo(carriedMob).relativeSpeed,
    );

    // Boat and marker can move over the chart at 2 kn yet be stopped relative
    // to each other because the same current carries both.
    expect(carried.telemetry().sog).toBeCloseTo(2, 2);
    expect(carriedRelativeSpeed).toBeLessThan(0.001);
    const valid = new MobDrill();
    valid.drop();
    valid.update(1, 0, MOB_ARM_DISTANCE_M, 15, carriedRelativeSpeed);
    valid.update(1, 0, 2, 0.5, carriedRelativeSpeed);
    expect(valid.status.recovered).toBe(true);

    const opposing = makeConstantSim(0, 0);
    opposing.env.current = { x: 0, y: -kn(2) };
    opposing.state.u = kn(2);
    const opposingMob = opposing.dropFloat("mob");
    opposing.step(DT, {
      tiller: 0,
      sheetTargetDeg: 85,
      jibTargetDeg: 75,
      auxOn: false,
    });
    const opposingRelativeSpeed = toKn(
      opposing.pickupMetricsTo(opposingMob).relativeSpeed,
    );

    // An opposing current can nearly cancel SOG even though the hull is still
    // passing the marker too fast for a controlled pickup.
    expect(opposing.telemetry().sog).toBeLessThan(0.05);
    expect(opposingRelativeSpeed).toBeGreaterThan(1.9);
    const invalid = new MobDrill();
    invalid.drop();
    invalid.update(1, 0, MOB_ARM_DISTANCE_M, 15, opposingRelativeSpeed);
    invalid.update(1, 0, 2, 0.5, opposingRelativeSpeed);
    expect(invalid.status.recovered).toBe(false);
  });

  it("measures pickup clearance from the physical hull instead of its center", () => {
    const sim = makeConstantSim(0, 0);
    sim.state.heading = 0;
    const mob = sim.dropFloat("mob", 0);

    mob.pos = {
      x: harbor20.beam / 2 + MOB_RECOVERY_DISTANCE_M,
      y: 0,
    };
    let centerRange = sim.bearingAndRange(mob.pos).distance;
    let pickup = sim.pickupMetricsTo(mob);
    expect(centerRange).toBeCloseTo(
      harbor20.beam / 2 + MOB_RECOVERY_DISTANCE_M,
      8,
    );
    expect(pickup.distance).toBeCloseTo(MOB_RECOVERY_DISTANCE_M, 8);

    mob.pos = {
      x: 0,
      y: harbor20.loa / 2 + MOB_RECOVERY_DISTANCE_M,
    };
    centerRange = sim.bearingAndRange(mob.pos).distance;
    pickup = sim.pickupMetricsTo(mob);
    expect(centerRange).toBeCloseTo(
      harbor20.loa / 2 + MOB_RECOVERY_DISTANCE_M,
      8,
    );
    expect(pickup.distance).toBeCloseTo(MOB_RECOVERY_DISTANCE_M, 8);
  });

  it("includes yaw velocity at the rail in the pickup speed", () => {
    const sim = makeConstantSim(0, 0);
    sim.state.heading = 0;
    sim.state.r = 0.2;
    const mob = sim.dropFloat("mob", 0);
    expect(sim.pickupMetricsTo(mob).relativeSpeed).toBeCloseTo(0, 8);

    mob.pos = { x: harbor20.beam / 2 + 0.5, y: 0 };

    expect(sim.relativeSpeedTo(mob)).toBeCloseTo(0, 8);
    expect(sim.pickupMetricsTo(mob).relativeSpeed).toBeCloseTo(
      sim.state.r * (harbor20.beam / 2),
      8,
    );
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
    const windageSpeed = toKn(
      Math.hypot(f.velocity.x - env.current.x, f.velocity.y - env.current.y),
    );
    expect(windageSpeed).toBeGreaterThan(0.2);
    expect(windageSpeed).toBeLessThan(0.4);
  }, 30000);

  for (const windKn of [6, 12, 16]) {
    it(`completes a starboard-tack Figure-8 return in ${windKn} kn`, () => {
      const sim = makeConstantSim(windKn, 0);
      const closeHauled = closeHauledHeading(
        0,
        harbor20.closeHauledTwa,
        "starboard",
      );
      const starboardBeamReach = 270;
      const portBroadReach = 165;
      sim.state.heading = closeHauled * DEG;
      const start = sailFor(sim, 120, closeHauled);
      const startDrive = start.sails.reduce((sum, sail) => sum + sail.drive, 0);
      const startSide = start.sails.reduce((sum, sail) => sum + sail.side, 0);

      const mob = sim.dropFloat("mob");
      const drill = new MobDrill();
      drill.drop();
      const dropTime = sim.time;
      let previousSpeed = start.speedThroughWater;
      let maxSpeedStep = 0;

      const advance = (tiller: number, main: number, jib: number) => {
        sim.step(DT, {
          tiller,
          sheetTargetDeg: main,
          jibTargetDeg: jib,
          auxOn: false,
        });
        const speed = sim.telemetry().speedThroughWater;
        maxSpeedStep = Math.max(maxSpeedStep, Math.abs(speed - previousSpeed));
        previousSpeed = speed;
        const br = sim.bearingAndRange(mob.pos);
        const pickup = sim.pickupMetricsTo(mob);
        drill.update(
          DT,
          br.bearing,
          br.distance,
          pickup.distance,
          toKn(pickup.relativeSpeed),
        );
      };

      // From close-hauled, immediately bear away onto a starboard-tack beam
      // reach. Trim the main for the new point of sail and leave the jib set.
      let reachedBeamReach = false;
      while (
        sim.bearingAndRange(mob.pos).distance < 3.5 * harbor20.loa &&
        sim.time - dropTime < 25
      ) {
        const trim = Math.abs(idealBoomAngle(sim.telemetry().awa));
        advance(headingHold(sim, starboardBeamReach), trim, sim.state.jibDeg);
        reachedBeamReach ||=
          Math.abs(wrapDeg(sim.telemetry().headingDeg - starboardBeamReach)) < 8;
      }
      const departureRange = sim.bearingAndRange(mob.pos).distance;
      const departureHeading = sim.telemetry().headingDeg;

      const heldMain = sim.state.sheetDeg;
      const heldJib = sim.state.jibDeg;
      let closestToHeadToWind = 180;
      let deepestTackAwa = 0;
      let minimumTackSpeed = Infinity;
      while (sim.state.heading / DEG < 510 && sim.time - dropTime < 60) {
        advance(
          -15 / harbor20.rudder.maxEffectiveAngle,
          heldMain,
          heldJib,
        );
        const tel = sim.telemetry();
        const absAwa = Math.abs(tel.awa);
        closestToHeadToWind = Math.min(closestToHeadToWind, absAwa);
        deepestTackAwa = Math.max(deepestTackAwa, absAwa);
        minimumTackSpeed = Math.min(minimumTackSpeed, tel.speedThroughWater);
      }
      const postTackHeading = sim.telemetry().headingDeg;
      const postTackSide = sim
        .telemetry()
        .sails.reduce((sum, sail) => sum + sail.side, 0);

      // Release both sheets on the broad reach until the marker bears on a
      // close-reach return line, then stay depowered to slow for pickup.
      while (sim.time - dropTime < 90) {
        const br = sim.bearingAndRange(mob.pos);
        if (br.bearing >= 30 && br.bearing <= 60 && br.distance > 10) break;
        advance(headingHold(sim, portBroadReach), 85, 75);
      }
      const layline = sim.bearingAndRange(mob.pos);
      const laylineAwa = sim.telemetry().awa;

      while (!drill.status.recovered && sim.time - dropTime < 150) {
        const br = sim.bearingAndRange(mob.pos);
        // Lead the drifting marker slightly in stronger wind. The low-speed
        // rudder otherwise falls behind its downwind motion near the pickup.
        const windageLead =
          br.distance < 8 ? Math.max(0, (sim.telemetry().tws - 8) * 2) : 0;
        const pickup = sim.pickupMetricsTo(mob);
        const relativeSpeed = toKn(pickup.relativeSpeed);
        // In light air, briefly retrim only if the boat has nearly stopped
        // outside the pickup circle; ease again before relative speed builds.
        const main =
          pickup.distance > MOB_RECOVERY_DISTANCE_M && relativeSpeed < 0.35
            ? Math.abs(idealBoomAngle(sim.telemetry().awa))
            : 85;
        advance(headingHold(sim, br.bearing + windageLead), main, 75);
      }

      const finalRange = sim.bearingAndRange(mob.pos).distance;
      const finalPickup = sim.pickupMetricsTo(mob);
      const finalRelativeSpeed = toKn(finalPickup.relativeSpeed);
      const main = sim
        .telemetry()
        .sails.find((sail) => sail.sailId === "main")!;

      expect(start.awa).toBeGreaterThan(0);
      expect(start.awa).toBeLessThan(harbor20.closeHauledTwa);
      expect(start.aws).toBeGreaterThan(start.tws);
      expect(startDrive).toBeGreaterThan(0);
      expect(startSide).toBeLessThan(0);
      expect(start.heelDeg).toBeLessThan(0);
      expect(reachedBeamReach).toBe(true);
      expect(departureRange).toBeGreaterThanOrEqual(3.5 * harbor20.loa);
      expect(Math.abs(wrapDeg(departureHeading - starboardBeamReach))).toBeLessThan(12);
      expect(drill.status.armed).toBe(true);
      expect(postTackHeading).toBeGreaterThan(140);
      expect(postTackHeading).toBeLessThan(155);
      expect(closestToHeadToWind).toBeLessThan(10);
      expect(deepestTackAwa).toBeLessThan(175);
      expect(minimumTackSpeed).toBeGreaterThan(0.3);
      expect(maxSpeedStep).toBeLessThan(0.1);
      expect(laylineAwa).toBeLessThan(0);
      expect(postTackSide).toBeGreaterThan(0);
      expect(layline.bearing).toBeGreaterThanOrEqual(30);
      expect(layline.bearing).toBeLessThanOrEqual(60);
      expect(drill.status.recovered).toBe(true);
      expect(finalPickup.distance).toBeLessThanOrEqual(MOB_RECOVERY_DISTANCE_M);
      expect(finalRange).toBeLessThanOrEqual(
        harbor20.loa / 2 + MOB_RECOVERY_DISTANCE_M,
      );
      expect(finalRelativeSpeed).toBeLessThan(1);
      expect(main.luffing).toBe(true);
      expect(sim.time - dropTime).toBeLessThan(150);
    }, 30000);
  }
});
