import { Sim } from "../src/core/sim";
import { Environment } from "../src/core/environment";
import { harbor20 } from "../src/boats/harbor20";
import { kn } from "../src/core/units";

const DT = 1 / 60;
// live conditions when the user saw "the run seems backward"
const env = new Environment({ speed: kn(10.8), directionFrom: 280, gust: kn(10.8), source: "dbg" });
const sim = new Sim(harbor20, env, null);
sim.state.heading = (100 * Math.PI) / 180; // dead run

console.log("tiller CENTERED, sheet 80 — does she stay on the run?");
console.log("   t   hdg     u    awa  heel boomMain   sog");
for (let i = 0; i < 120 / DT; i++) {
  sim.step(DT, { tiller: 0, sheetTargetDeg: 80, jibTargetDeg: 75, auxOn: false });
  if (i % (2 / DT) === 0) {
    const t = sim.telemetry();
    console.log(
      `${(i * DT).toFixed(0).padStart(4)} ${t.headingDeg.toFixed(0).padStart(5)}° ${sim.state.u.toFixed(2).padStart(6)}` +
        `${t.awa.toFixed(0).padStart(6)}° ${t.heelDeg.toFixed(1).padStart(5)} ${sim.state.boomDeg["main"].toFixed(0).padStart(6)}°${t.sog.toFixed(3).padStart(8)}`,
    );
  }
}
