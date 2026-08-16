/**
 * Tack comparison at different rudder travel limits. Sails close-hauled on
 * port, then pushes the tiller over and traces heading, speed, and the
 * hydrodynamic forces through the maneuver.
 */
import { Sim } from "../src/core/sim";
import { Environment } from "../src/core/environment";
import { harbor20 } from "../src/boats/harbor20";
import { kn } from "../src/core/units";
import { idealBoomAngle } from "../src/core/physics/sails";
import { rudderForces, hullDrag } from "../src/core/physics/hydro";

const DT = 1 / 60;

function headingHold(sim: Sim, targetDeg: number): number {
  const err = ((targetDeg - sim.state.heading * (180 / Math.PI) + 540) % 360) - 180;
  return Math.max(-0.8, Math.min(0.8, -err / 40));
}

function runTack(maxDeg: number): void {
  const boat = { ...harbor20, rudder: { ...harbor20.rudder, maxEffectiveAngle: maxDeg } };
  const env = new Environment({ speed: kn(12), directionFrom: 0, gust: kn(12) * 1.1, source: "dbg" });
  const sim = new Sim(boat, env, null);
  sim.state.heading = (315 * Math.PI) / 180; // close-hauled, port tack

  // settle on the wind first
  let sheet = 25;
  let jib = 15;
  for (let i = 0; i < 60 / DT; i++) {
    const tel = sim.telemetry();
    if (i % 60 === 0) {
      sheet = Math.abs(idealBoomAngle(tel.awa));
      jib = Math.abs(tel.awa) / 2;
    }
    sim.step(DT, {
      tiller: headingHold(sim, 315),
      sheetTargetDeg: sheet,
      jibTargetDeg: jib,
      auxOn: false,
    });
  }

  const t0 = sim.telemetry();
  console.log(`\n=== rudder max ${maxDeg}° — entering tack at ${t0.sog.toFixed(2)} kn ===`);
  console.log("  t     hdg    sog   rudderDrag  hullDrag   drive");
  for (let i = 0; i < 10 / DT; i++) {
    sim.step(DT, { tiller: -0.7, sheetTargetDeg: 10, jibTargetDeg: 15, auxOn: false });
    if (i % (0.5 / DT) === 0) {
      const t = sim.telemetry();
      const rf = rudderForces(boat, sim.state.u, sim.state.rudderDeg);
      const drive = t.sails.reduce((sum, s) => sum + s.drive, 0);
      console.log(
        `${(i * DT).toFixed(1).padStart(4)} ${(t.headingDeg.toFixed(0)).padStart(6)}° ${(t.sog.toFixed(2)).padStart(6)} ` +
          `${(-rf.drag).toFixed(0).padStart(9)} N ${hullDrag(boat, sim.state.u).toFixed(0).padStart(8)} N ${drive.toFixed(0).padStart(7)} N`,
      );
    }
  }
  const tEnd = sim.telemetry();
  const cleared = tEnd.headingDeg > 20 && tEnd.headingDeg < 80;
  console.log(`→ final hdg ${tEnd.headingDeg.toFixed(0)}° sog ${tEnd.sog.toFixed(2)} kn — ${cleared ? "COMPLETED tack" : "STALLED in irons"}`);
}

for (const max of [25, 35, 60]) runTack(max);
