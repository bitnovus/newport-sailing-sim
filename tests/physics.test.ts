import { describe, expect, it } from "vitest";
import { Sim } from "../src/core/sim";
import { Environment } from "../src/core/environment";
import { harbor20 } from "../src/boats/harbor20";
import { kn, toKn, wrapDeg, DEG } from "../src/core/units";
import { idealBoomAngle, luffFraction, sailCoefficients, solveSail } from "../src/core/physics/sails";

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

/** Sail with auto-trim for `seconds`, returning the final telemetry. */
function sailFor(sim: Sim, seconds: number, headingDeg: number) {
  for (let i = 0; i < seconds / DT; i++) {
    const tel = sim.telemetry();
    const sheet = i === 0 ? 25 : Math.abs(idealBoomAngle(tel.awa));
    sim.step(DT, {
      tiller: headingHold(sim, headingDeg),
      sheetTargetDeg: sheet,
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

describe("sail aerodynamics", () => {
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
    let crossStep = -1;
    const steps = Math.round(12 / DT);
    for (let i = 0; i < steps; i++) {
      sim.step(DT, { tiller: 0.7, sheetTargetDeg: 25, auxOn: false });
      const tel = sim.telemetry();
      closestToWind = Math.min(closestToWind, Math.abs(wrapDeg(tel.headingDeg - 30)));
      closestToLee = Math.min(closestToLee, Math.abs(wrapDeg(tel.headingDeg - 210)));
      if (!crossed && Math.abs(tel.awa) < 20) {
        crossed = true;
        boomAtCross = sim.state.boomDeg.main;
        crossStep = i;
      }
    }
    // the bow passed head-to-wind (the wind direction itself)…
    expect(closestToWind).toBeLessThan(25);
    // …and never approached the dead-run direction — this was a tack, not a jibe
    expect(closestToLee).toBeGreaterThan(90);
    // still the old boom side entering the no-go cone; flipped after the bow crossed
    // (physics boom sign follows the WIND side; the renderer mirrors to leeward)
    expect(boomAtCross).toBeLessThan(0);
    const after = Math.round(1.5 / DT);
    for (let i = crossStep; i < Math.min(crossStep + after, steps); i++) {
      sim.step(DT, { tiller: 0, sheetTargetDeg: 25, auxOn: false });
    }
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
    for (let i = 0; i < 12 / DT; i++) {
      sim.step(DT, { tiller: -0.7, sheetTargetDeg: 25, auxOn: false }); // tiller to port, toward the sail
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
      sim.step(DT, { tiller: 0.7, sheetTargetDeg: 25, auxOn: false });
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
      sim.step(DT, { tiller: -0.7, sheetTargetDeg: 10, auxOn: false });
    }
    const hdg = ((sim.state.heading * 180) / Math.PI + 720) % 360;
    expect(hdg).toBeGreaterThan(20);
    expect(hdg).toBeLessThan(80);
    expect(sim.telemetry().sog).toBeGreaterThan(1.5);
  }, 30000);

  it("sweeps the boom across at a finite rate during a tack (no teleport)", () => {
    const sim = makeSim(12, 0); // wind from N
    sim.state.heading = (315 * Math.PI) / 180; // close-hauled, starboard tack (AWA +45)
    sailFor(sim, 30, 315);
    const main = sim.state.boomDeg.main;
    expect(main).toBeGreaterThan(0); // wind from stbd → + side

    // tack through the wind to port tack, tracking the boom
    let maxStep = 0;
    let prev = main;
    let sawCrossing = false;
    for (let i = 0; i < 8 / DT; i++) {
      sim.step(DT, { tiller: -0.7, sheetTargetDeg: 12, auxOn: false });
      const cur = sim.state.boomDeg.main;
      maxStep = Math.max(maxStep, Math.abs(cur - prev));
      if (prev > 0 && cur < 0) sawCrossing = true;
      prev = cur;
    }
    // finite sweep: never moves faster than the 130°/s rate (+ε for fp)
    expect(maxStep).toBeLessThanOrEqual(130 * DT + 1e-9);
    // boom crossed the centerline and settled on the new side
    expect(sawCrossing).toBe(true);
    expect(sim.state.boomDeg.main).toBeLessThan(0);
  }, 30000);

  it("has no steerage way when stopped", () => {
    const sim = makeSim(0.5, 0); // near-calm: sails slack, boat stays stopped
    const h0 = sim.state.heading;
    for (let i = 0; i < 5 / DT; i++) {
      sim.step(DT, { tiller: 1, sheetTargetDeg: 60, auxOn: false });
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
      simWater.step(DT, { tiller: 0, sheetTargetDeg: 45, auxOn: false });
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
  it("moves the boat with sails slack in no wind", () => {
    const sim = makeSim(0.5, 0);
    sailFor(sim, 40, 0);
    expect(sim.telemetry().sog).toBeLessThan(0.8);
    for (let i = 0; i < 60 / DT; i++) {
      sim.step(DT, { tiller: 0, sheetTargetDeg: 85, auxOn: true });
    }
    expect(toKn(sim.state.u)).toBeGreaterThan(2.5);
  }, 30000);
});

describe("MOB marker drift", () => {
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
      sim.step(DT, { tiller: 0, sheetTargetDeg: 60, auxOn: false });
    }
    // 60 s: current pushes 18 m east; windage pushes ~2.5% of 6 m/s south ≈ 9 m
    expect(f.pos.x).toBeGreaterThan(17);
    expect(f.pos.x).toBeLessThan(20);
    expect(f.pos.y).toBeLessThan(-5);
  }, 30000);
});
