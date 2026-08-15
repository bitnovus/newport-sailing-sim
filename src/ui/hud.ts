import type { Telemetry } from "../core/sim";

export interface MobStatus {
  active: boolean;
  timeSec: number;
  bearing: number;
  distance: number;
  recovered: boolean;
  result?: { timeSec: number; closestM: number };
}

const fmt = (n: number, d = 1) => n.toFixed(d);
const bearingLabel = (b: number) => {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((b % 360) / 22.5)) % 16];
};

/** DOM HUD: instruments, windex, MOB panel. */
export class Hud {
  readonly root: HTMLElement;
  private rows: Record<string, HTMLElement> = {};
  private windMeter!: HTMLElement;
  private tillerArm!: SVGGElement | null;
  private mobPanel!: HTMLElement;
  private alert!: HTMLElement;

  constructor() {
    this.root = document.getElementById("hud")!;
    this.build();
  }

  private el(tag: string, cls: string, text = ""): HTMLElement {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  }

  private build(): void {
    const panel = this.el("div", "hud-panel");

    const windex = this.el("div", "windex");
    this.windMeter = this.el("div", "wind-meter");
    this.windMeter.innerHTML = `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="47" class="dial"/>
        <g class="ticks">
          <line x1="50" y1="3" x2="50" y2="10"/><line x1="97" y1="50" x2="90" y2="50"/>
          <line x1="50" y1="97" x2="50" y2="90"/><line x1="3" y1="50" x2="10" y2="50"/>
        </g>
        <text x="50" y="18" class="tick">BOW</text>
        <text x="84" y="54" class="tick">S</text>
        <text x="50" y="90" class="tick">A</text>
        <text x="16" y="54" class="tick">P</text>
        <text x="50" y="47" class="aws-value" text-anchor="middle" id="hud-aws">—</text>
        <text x="50" y="60" class="aws-unit" text-anchor="middle">kn App</text>
        <g id="hud-awa-arrow"><polygon points="50,6 45,18 55,18" class="awa-head"/><line x1="50" y1="18" x2="50" y2="32" class="awa-line"/></g>
        <g id="hud-twa-arrow"><polygon points="50,16 46,26 54,26" class="twa-head"/><line x1="50" y1="26" x2="50" y2="38" class="twa-line"/></g>
      </svg>
      <div class="gauge-caption">WIND</div>`;
    windex.append(this.windMeter);
    panel.append(windex);

    // tiller position gauge: boat from above, bow up; the arm swings the way
    // the helmsman pushes the tiller
    const tiller = this.el("div", "tiller-gauge");
    tiller.innerHTML = `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="47" class="dial"/>
        <path d="M50 10 C 66 26, 68 50, 60 72 L 40 72 C 32 50, 34 26, 50 10 Z" class="boat-top"/>
        <g id="hud-tiller-arm">
          <line x1="50" y1="66" x2="50" y2="93" class="tiller-arm"/>
          <circle cx="50" cy="93" r="4.5" class="tiller-tip"/>
        </g>
        <circle cx="50" cy="66" r="3.5" class="tiller-pivot"/>
      </svg>
      <div class="gauge-caption">TILLER</div>`;
    panel.append(tiller);
    this.tillerArm = tiller.querySelector("#hud-tiller-arm");

    const table = this.el("div", "hud-table");
    for (const [key, label] of [
      ["sog", "SOG"],
      ["cog", "COG"],
      ["aws", "AWS"],
      ["awa", "AWA"],
      ["tws", "TWS"],
      ["twd", "TWD"],
      ["heel", "HEEL"],
      ["sheet", "MAIN"],
      ["tiller", "TILLER"],
      ["windsrc", "WIND"],
    ] as const) {
      const row = this.el("div", "hud-row");
      row.append(this.el("span", "hud-label", label), this.el("span", "hud-value", "—"));
      table.append(row);
      this.rows[key] = row.querySelector(".hud-value")!;
    }
    panel.append(table);
    this.root.append(panel);

    this.mobPanel = this.el("div", "hud-panel mob-panel hidden");
    this.mobPanel.innerHTML = `
      <div class="hud-title">MOB DRILL</div>
      <div class="hud-row"><span class="hud-label">TIME</span><span class="hud-value" data-k="time">0:00</span></div>
      <div class="hud-row"><span class="hud-label">RANGE</span><span class="hud-value" data-k="range">—</span></div>
      <div class="hud-row"><span class="hud-label">BEARING</span><span class="hud-value" data-k="bearing">—</span></div>
      <div class="hud-row"><span class="hud-label">STATUS</span><span class="hud-value" data-k="status">drifting</span></div>`;
    this.root.append(this.mobPanel);
    for (const e of this.mobPanel.querySelectorAll("[data-k]")) {
      this.rows[`mob-${(e as HTMLElement).dataset.k}`] = e as HTMLElement;
    }

    this.alert = this.el("div", "alert hidden");
    this.root.append(this.alert);
  }

  /**
   * @param tiller −1..1 as the helmsman holds it: + = pushed to starboard
   * (which turns the boat to port in realistic tiller mode).
   */
  update(tel: Telemetry, windStatus: string, tiller = 0): void {
    this.rows.sog.textContent = `${fmt(tel.sog)} kn`;
    this.rows.cog.textContent = `${fmt(tel.cog, 0)}° ${bearingLabel(tel.cog)}`;
    this.rows.aws.textContent = `${fmt(tel.aws)} kn`;
    this.rows.awa.textContent = `${fmt(Math.abs(tel.awa), 0)}° ${tel.awa >= 0 ? "STBD" : "PORT"}`;
    this.rows.tws.textContent = `${fmt(tel.tws)} kn`;
    this.rows.twd.textContent = `${fmt((twd => ((twd % 360) + 360) % 360)(tel.twd), 0)}°`;
    this.rows.heel.textContent = `${fmt(Math.abs(tel.heelDeg), 0)}° ${tel.heelDeg >= 0 ? "S" : "P"}`;
    this.rows.sheet.textContent = `${fmt(tel.sheetDeg, 0)}°`;
    const tillerDeg = Math.round(Math.abs(tiller) * 100 * 0.25); // tiller arc ±25°
    this.rows.tiller.textContent =
      Math.abs(tiller) < 0.03
        ? "centered"
        : `${Math.round(Math.abs(tiller) * 100)}% ${tiller > 0 ? "→" : "←"} (${tillerDeg}°)`;
    this.rows.windsrc.textContent = windStatus;

    const awaArrow = this.windMeter.querySelector("#hud-awa-arrow");
    const twaArrow = this.windMeter.querySelector("#hud-twa-arrow");
    const awsText = this.windMeter.querySelector("#hud-aws");
    if (awaArrow) awaArrow.setAttribute("transform", `rotate(${tel.awa} 50 50)`);
    if (twaArrow) {
      // true wind angle references the CENTERLINE (heading), not COG —
      // leeway/current must not swing the wind reference off the bow
      const twa = tel.twd - tel.headingDeg;
      twaArrow.setAttribute("transform", `rotate(${twa} 50 50)`);
    }
    if (awsText) awsText.textContent = fmt(tel.aws, 0);
    if (this.tillerArm) {
      // + tiller = pushed to starboard = arm tip swings right (bow up view)
      this.tillerArm.setAttribute("transform", `rotate(${tiller * 30} 50 66)`);
    }
  }

  updateMob(m: MobStatus): void {
    this.mobPanel.classList.toggle("hidden", !m.active);
    if (!m.active) return;
    const mm = Math.floor(m.timeSec / 60);
    const ss = Math.floor(m.timeSec % 60);
    this.rows["mob-time"].textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    this.rows["mob-range"].textContent = `${fmt(m.distance, 0)} m`;
    this.rows["mob-bearing"].textContent = `${fmt(m.bearing, 0)}° ${bearingLabel(m.bearing)}`;
    if (m.recovered && m.result) {
      this.rows["mob-status"].textContent = `RECOVERED in ${m.result.timeSec.toFixed(0)}s · closest ${m.result.closestM.toFixed(0)} m`;
      this.mobPanel.classList.add("good");
    } else {
      this.rows["mob-status"].textContent = m.distance < 30 ? "CLOSE — slow down" : "keep a lookout";
      this.mobPanel.classList.remove("good");
    }
  }

  flash(msg: string, ms = 1600): void {
    this.alert.textContent = msg;
    this.alert.classList.remove("hidden");
    setTimeout(() => this.alert.classList.add("hidden"), ms);
  }
}

/** MOB drill state machine (drop → track → recover → score). */
export class MobDrill {
  status: MobStatus = { active: false, timeSec: 0, bearing: 0, distance: 0, recovered: false };
  private closest = Infinity;

  drop(): void {
    this.status = { active: true, timeSec: 0, bearing: 0, distance: 0, recovered: false };
    this.closest = Infinity;
  }

  reset(): void {
    this.status = { active: false, timeSec: 0, bearing: 0, distance: 0, recovered: false };
  }

  update(dt: number, tel: Telemetry, bearing: number, distance: number): void {
    const s = this.status;
    if (!s.active || s.recovered) return;
    s.timeSec += dt;
    s.bearing = bearing;
    s.distance = distance;
    this.closest = Math.min(this.closest, distance);
    if (distance < 5 && tel.sog < 1) {
      s.recovered = true;
      s.result = { timeSec: s.timeSec, closestM: this.closest };
    }
  }
}
