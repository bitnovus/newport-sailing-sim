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

/**
 * Sail one fixed true-wind angle for `seconds`, live-trimming the sheet like a
 * crew would, then report the equilibrium + stability of the last 20%.
 */
function runAngle(twsKn: number, twaDeg: number, seconds = 90) {
  const env = new Environment({
    speed: kn(twsKn),
    directionFrom: 0,
    gust: kn(twsKn) * 1.0, // no gust variance: measure the clean equilibrium
    source: "dbg",
  });
  const sim = new Sim(harbor20, env, null);
  sim.state.heading = (twaDeg * Math.PI) / 180;

  let sheet = 25;
  const tail = Math.floor(seconds * 0.2 / DT);
  const samples: { sog: number; heel: number; hdg: number }[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const tel = sim.telemetry();
    if (i % 60 === 0) sheet = Math.abs(idealBoomAngle(tel.awa));
    sim.step(DT, { tiller: headingHold(sim, twaDeg), sheetTargetDeg: sheet, auxOn: false });
    if (i >= steps - tail) {
      samples.push({ sog: tel.sog, heel: tel.heelDeg, hdg: tel.headingDeg });
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
  const t = sim.telemetry();
  return {
    twaDeg,
    sog: mean(samples.map((s) => s.sog)),
    sogStd: std(samples.map((s) => s.sog)),
    aws: t.aws,
    awa: t.awa,
    heel: mean(samples.map((s) => s.heel)),
    heelStd: std(samples.map((s) => s.heel)),
    hdgStd: std(samples.map((s) => s.hdg)),
    sheet: t.sheetDeg,
    boomMain: sim.state.boomDeg["main"],
    boomJib: sim.state.boomDeg["jib"],
    u: sim.state.u,
    v: sim.state.v,
  };
}

for (const tws of [6, 12]) {
  console.log(`\n=== TWS ${tws} kn — downwind sweep (means over last 20%) ===`);
  console.log(
    "TWA    SOG   ±σ   AWS    AWA  heel±σ   hdgσ  sheet boomMain boomJib   u     v",
  );
  for (const twa of [90, 110, 135, 155, 170, 179, 181, 190]) {
    const r = runAngle(tws, twa);
    console.log(
      `${String(r.twaDeg).padStart(3)} ${r.sog.toFixed(2).padStart(6)} ${r.sogStd.toFixed(2).padStart(5)}` +
        `${r.aws.toFixed(1).padStart(5)} ${r.awa.toFixed(0).padStart(6)}°` +
        `${r.heel.toFixed(1).padStart(5)}±${r.heelStd.toFixed(1)}` +
        `${r.hdgStd.toFixed(2).padStart(6)} ${r.sheet.toFixed(0).padStart(5)}°` +
        `${r.boomMain.toFixed(0).padStart(7)}°${r.boomJib.toFixed(0).padStart(7)}°` +
        `${r.u.toFixed(2).padStart(6)} ${r.v.toFixed(2).padStart(5)}`,
    );
  }
}

/* ---- dynamic check: jibe from broad reach port to broad reach stbd ---- */
{
  const tws = 12;
  const env = new Environment({
    speed: kn(tws), directionFrom: 0, gust: kn(tws), source: "dbg",
  });
  const sim = new Sim(harbor20, env, null);
  sim.state.heading = (-150 * Math.PI) / 180;
  let sheet = 60;
  const hold = (target: number) => headingHold(sim, target);
  const log: string[] = [];
  // equilibrate on the port broad reach
  for (let i = 0; i < 30 / DT; i++) {
    const tel = sim.telemetry();
    if (i % 60 === 0) sheet = Math.abs(idealBoomAngle(tel.awa));
    sim.step(DT, { tiller: hold(-150), sheetTargetDeg: sheet, auxOn: false });
  }
  console.log(`\n=== jibe: broad reach port (-150) -> starboard (+150), TWS ${tws} kn ===`);
  console.log("   t   hdg    u    heel  boomMain boomJib");
  const t0 = sim.time;
  for (let i = 0; i < 45 / DT; i++) {
    const t = sim.time - t0;
    const target = t < 10 ? -150 : 150; // at t=10 command the jibe
    const tel = sim.telemetry();
    if (i % 60 === 0) sheet = Math.abs(idealBoomAngle(tel.awa));
    sim.step(DT, { tiller: hold(target), sheetTargetDeg: sheet, auxOn: false });
    if (i % Math.round(0.5 / DT) === 0) {
      log.push(
        `${t.toFixed(1).padStart(5)} ${tel.headingDeg.toFixed(0).padStart(5)}° ${sim.state.u.toFixed(2).padStart(6)}` +
          `${tel.heelDeg.toFixed(1).padStart(6)} ${sim.state.boomDeg["main"].toFixed(0).padStart(7)}°` +
          `${sim.state.boomDeg["jib"].toFixed(0).padStart(7)}°`,
      );
    }
  }
  console.log(log.join("\n"));
}
