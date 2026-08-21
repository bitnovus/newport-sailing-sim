import { Sim } from "../src/core/sim";
import { Environment } from "../src/core/environment";
import { harbor20 } from "../src/boats/harbor20";
import { kn } from "../src/core/units";
import { idealBoomAngle } from "../src/core/physics/sails";

const DT = 1 / 60;

function headingHold(sim: Sim, targetDeg: number): number {
  const err = ((targetDeg - sim.state.heading * (180 / Math.PI) + 540) % 360) - 180;
  return Math.max(-0.8, Math.min(0.8, -err / 40));
}

const windKn = Number(process.argv[2] ?? 12);
const twa = Number(process.argv[3] ?? 10);
const seconds = Number(process.argv[4] ?? 60);
const fixedSheet = Number(process.argv[5] ?? Number.NaN);
const fixedJib = Number(process.argv[6] ?? Number.NaN);
const useFixedTrim = Number.isFinite(fixedSheet) && Number.isFinite(fixedJib);

const env = new Environment({ speed: kn(windKn), directionFrom: 0, gust: kn(windKn) * 1.1, source: "dbg" });
const sim = new Sim(harbor20, env, null);
sim.state.heading = (twa * Math.PI) / 180;

// live-trim like the polar test SHOULD have done
let sheet = useFixedTrim ? fixedSheet : 25;
let jib = useFixedTrim ? fixedJib : 15;
for (let i = 0; i < seconds / DT; i++) {
  const tel = sim.telemetry();
  if (!useFixedTrim && i % 60 === 0) {
    sheet = Math.abs(idealBoomAngle(tel.awa));
    jib = Math.abs(idealBoomAngle(tel.awa));
  }
  sim.step(DT, {
    tiller: headingHold(sim, twa),
    sheetTargetDeg: sheet,
    jibTargetDeg: jib,
    auxOn: false,
  });
  if (i % (10 / DT) === 0) {
    const t = sim.telemetry();
    const main = t.sails.find((sail) => sail.sailId === "main");
    const jibSail = t.sails.find((sail) => sail.sailId === "jib");
    console.log(
      `t=${(i * DT).toFixed(0).padStart(4)} hdg=${((sim.state.heading * 180) / Math.PI).toFixed(1).padStart(6)} ` +
        `sog=${t.sog.toFixed(2)} awa=${t.awa.toFixed(1).padStart(7)} ` +
        `sheet=${t.sheetDeg.toFixed(1).padStart(5)}/${t.jibDeg.toFixed(1).padStart(4)} ` +
        `boom=${(main?.boomAngle ?? 0).toFixed(1).padStart(6)}/${(jibSail?.boomAngle ?? 0).toFixed(1).padStart(6)} ` +
        `flow=${(main?.flow ?? 0).toFixed(2)}/${(jibSail?.flow ?? 0).toFixed(2)} ` +
        `u=${sim.state.u.toFixed(2)} v=${sim.state.v.toFixed(2)} r=${sim.state.r.toFixed(3)} heel=${t.heelDeg.toFixed(1)}`,
    );
  }
}
