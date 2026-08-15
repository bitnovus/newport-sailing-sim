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

const env = new Environment({ speed: kn(windKn), directionFrom: 0, gust: kn(windKn) * 1.1, source: "dbg" });
const sim = new Sim(harbor20, env, null);
sim.state.heading = (twa * Math.PI) / 180;

// live-trim like the polar test SHOULD have done
let sheet = 25;
for (let i = 0; i < seconds / DT; i++) {
  const tel = sim.telemetry();
  if (i % 60 === 0) {
    sheet = Math.abs(idealBoomAngle(tel.awa));
  }
  sim.step(DT, { tiller: headingHold(sim, twa), sheetTargetDeg: sheet, auxOn: false });
  if (i % (10 / DT) === 0) {
    const t = sim.telemetry();
    console.log(
      `t=${(i * DT).toFixed(0).padStart(4)} hdg=${((sim.state.heading * 180) / Math.PI).toFixed(1).padStart(6)} ` +
        `sog=${t.sog.toFixed(2)} awa=${t.awa.toFixed(1).padStart(7)} sheet=${t.sheetDeg.toFixed(1).padStart(5)} ` +
        `u=${sim.state.u.toFixed(2)} v=${sim.state.v.toFixed(2)} r=${sim.state.r.toFixed(3)} heel=${t.heelDeg.toFixed(1)}`,
    );
  }
}
