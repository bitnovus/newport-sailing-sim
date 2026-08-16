import "./style.css";
import maplibregl from "maplibre-gl";
import { Sim } from "./core/sim";
import { Environment } from "./core/environment";
import { getBoat } from "./boats/registry";
import { loadWater } from "./harbors/registry";
import { createMap, setBaseStyle, CameraRig, type BaseStyle } from "./render/map";
import { SceneLayer } from "./render/scene";
import { Controls } from "./ui/controls";
import { Hud, MobDrill } from "./ui/hud";
import { ManualWind, OpenMeteoWind } from "./providers/open-meteo";
import { toDeg, wrapDeg, DEG } from "./core/units";

const HARBOR_ID = "newport-harbor";
const BOAT_ID = "harbor20";
const DT = 1 / 60;

const { def, water } = loadWater(HARBOR_ID);
const boat = getBoat(BOAT_ID);

// ---- wind: live Open-Meteo with a manual fallback/override ----
const manual = new ManualWind({ speed: 5.14, directionFrom: 250, gust: 5.9, source: "manual" });
const live = new OpenMeteoWind(def.lat0, def.lon0, manual.current());
let usingLive = true;
live.start();

const env = new Environment(manual.current());
env.current = { x: def.current.x, y: def.current.y };

/** Close-hauled heading on port tack for the wind the provider is reporting. */
const sailableHeading = (twdDeg: number): number => (twdDeg + 40 + 360) % 360;

const sim = new Sim(boat, env, water);
const startPos = water.plane.project(def.start.lng, def.start.lat);
// spawn already sailing: point close-hauled rather than a fixed compass course
// that can land head-to-wind in whatever the live wind is doing today
sim.spawn(startPos, (sailableHeading(manual.current().directionFrom) * Math.PI) / 180);

let userActed = false; // any tiller/sheet input stops the spawn auto-orient
let autoOriented = false;
const reorientOnce = () => {
  if (autoOriented || userActed || sim.state.u > 0.3 || sim.time < 4) return;
  const tel = sim.telemetry();
  const twa = wrapDeg(tel.twd - toDeg(sim.state.heading));
  if (Math.abs(twa) < 35 && tel.tws > 2) {
    // parked in the no-go zone (spawn wind changed under us) — swing to a
    // sailable course so the boat is actually under way
    sim.state.heading = sailableHeading(tel.twd) * DEG;
    autoOriented = true;
  }
};

setInterval(() => {
  env.updateWind((usingLive ? live : manual).current());
  reorientOnce();
}, 1000);

// ---- map + 3D ----
const map = createMap(document.getElementById("map")!, { lng: def.start.lng, lat: def.start.lat });
const rig = new CameraRig(map);
const scene = new SceneLayer({ lat: def.lat0, lng: def.lon0 }, sim);
map.on("load", () => {
  setBaseStyle(map, baseStyle);
  // debug water outline (subtle) — shows the collision geometry
  map.addSource("water-outline", { type: "geojson", data: water.waterSource() as never });
  map.addLayer({
    id: "water-outline",
    type: "line",
    source: "water-outline",
    paint: { "line-color": "#7fdbff", "line-width": 1.5, "line-opacity": 0.5 },
  });
  map.addSource("boat-track", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [...track] },
    } as never,
  });
  map.addLayer({
    id: "boat-track-line",
    type: "line",
    source: "boat-track",
    paint: { "line-color": "#ffd166", "line-width": 2.5, "line-opacity": 0.85 },
  });
  map.addLayer(scene);
  requestAnimationFrame(frame);
});

// ---- boat track line ----
// History is kept in localStorage so a page refresh (or an HMR reload) doesn't
// silently wipe the track — otherwise every reload looks like "a straight line".
const TRACK_KEY = "glmbuild.track";
let track: [number, number][] = [];
try {
  const saved: unknown = JSON.parse(localStorage.getItem(TRACK_KEY) ?? "[]");
  if (Array.isArray(saved)) {
    track = saved.filter(
      (p): p is [number, number] =>
        Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number",
    );
  }
} catch {
  track = [];
}
let trackSaveTick = 0;
setInterval(() => {
  // history points every 2 s; the line always ends at the boat's live
  // position so it visually connects to the hull
  const [lng, lat] = water.plane.unproject(sim.state.pos);
  const last = track[track.length - 1];
  if (!last || Math.hypot(lng - last[0], lat - last[1]) > 0.00002) {
    track.push([lng, lat]);
    if (track.length > 900) track.shift();
  }
  (map.getSource("boat-track") as maplibregl.GeoJSONSource | undefined)?.setData({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [...track, [lng, lat]] },
  });
  if (++trackSaveTick % 8 === 0) {
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify(track));
    } catch {
      // storage quota/full — in-session track still works
    }
  }
}, 250);

// ---- UI ----
const controls = new Controls(boat.rudder.maxEffectiveAngle);
controls.bindHoldButtons(document.getElementById("touch-controls")!);
const hud = new Hud();
const drill = new MobDrill();

let baseStyle: BaseStyle = "satellite";
const buttons: Record<string, HTMLButtonElement> = {};
for (const id of ["mob", "aux", "view", "map", "wind", "help", "zoomin", "zoomout", "clear"]) {
  const b = document.getElementById(`btn-${id}`) as HTMLButtonElement;
  if (b) buttons[id] = b;
}
buttons.zoomin?.addEventListener("click", () => {
  hud.flash(`Zoom ${rig.nudgeZoom(0.6).toFixed(1)}`, 700);
});
buttons.zoomout?.addEventListener("click", () => {
  hud.flash(`Zoom ${rig.nudgeZoom(-0.6).toFixed(1)}`, 700);
});
buttons.clear?.addEventListener("click", () => {
  const mobCleared = sim.removeFloat("mob");
  drill.reset();
  hud.updateMob(drill.status);
  track.length = 0;
  try {
    localStorage.removeItem(TRACK_KEY);
  } catch {
    // storage unavailable — in-session clear still applies
  }
  (map.getSource("boat-track") as maplibregl.GeoJSONSource | undefined)?.setData({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [] },
  });
  hud.flash(mobCleared ? "Track and MOB cleared" : "Track cleared");
});

buttons.mob?.addEventListener("click", () => {
  if (drill.status.recovered || !drill.status.active) {
    sim.dropFloat("mob");
    drill.drop();
    hud.flash("MOB marker dropped — practice your return!");
  } else {
    sim.removeFloat("mob");
    drill.reset();
    hud.updateMob(drill.status);
    hud.flash("MOB drill reset");
  }
});
buttons.aux?.addEventListener("click", () => {
  controls.state.auxOn = !controls.state.auxOn;
  hud.flash(controls.state.auxOn ? "Electric drive ON" : "Electric drive off");
});
buttons.view?.addEventListener("click", () => {
  rig.mode = rig.mode === "chase" ? "chartplotter" : "chase";
  hud.flash(rig.mode === "chase" ? "Chase view" : "Chartplotter view");
});
buttons.map?.addEventListener("click", () => {
  baseStyle = baseStyle === "satellite" ? "chart" : "satellite";
  setBaseStyle(map, baseStyle);
  // overlays must sit above the freshly added base layers
  for (const id of ["water-outline", "boat-track-line"]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
  if (map.getLayer(scene.id)) map.moveLayer(scene.id);
  hud.flash(baseStyle === "satellite" ? "Satellite imagery" : "Chart style");
});
buttons.wind?.addEventListener("click", () => {
  usingLive = !usingLive;
  env.updateWind((usingLive ? live : manual).current());
  hud.flash(usingLive ? "Live wind (Open-Meteo)" : "Manual wind");
});

const windPanel = document.getElementById("wind-panel")!;
const windSpeed = document.getElementById("wind-speed") as HTMLInputElement;
const windDir = document.getElementById("wind-dir") as HTMLInputElement;
const speedLabel = windSpeed.parentElement?.querySelector("span");
const dirLabel = windDir.parentElement?.querySelector("span");
const applyWind = () => {
  if (speedLabel) speedLabel.textContent = `${windSpeed.value} kn`;
  if (dirLabel) dirLabel.textContent = `${windDir.value}°`;
  if (!usingLive) {
    manual.set(Number(windSpeed.value), Number(windDir.value));
  }
};
windSpeed?.addEventListener("input", applyWind);
windDir?.addEventListener("input", applyWind);
buttons.wind?.addEventListener("click", () => {
  windPanel.classList.toggle("hidden");
});
buttons.help?.addEventListener("click", () => {
  document.getElementById("help-panel")!.classList.toggle("hidden");
});

// ---- zoom: wheel + keys + buttons drive the camera rig's user offset ----
map.scrollZoom.disable();
map.getCanvasContainer().addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const z = rig.nudgeZoom(-e.deltaY * 0.0028);
    hud.flash(`Zoom ${z.toFixed(1)}`, 700);
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " ") buttons.mob?.click();
  if (k === "e") buttons.aux?.click();
  if (k === "v") buttons.view?.click();
  if (k === "m") buttons.map?.click();
  if (k === "+" || k === "=") hud.flash(`Zoom ${rig.nudgeZoom(0.6).toFixed(1)}`, 700);
  if (k === "-" || k === "_") hud.flash(`Zoom ${rig.nudgeZoom(-0.6).toFixed(1)}`, 700);
});

// ---- chartplotter symbols: constant-size markers so the boat and MOB stay
// visible when zoomed out (the 3D models shrink with zoom) ----
const boatIcon = document.createElement("div");
boatIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28" style="pointer-events:none">
  <path d="M14 2 L22 23 L14 19 L6 23 Z" fill="#7fdbff" stroke="#08121c" stroke-width="1.2"/>
</svg>`;
const boatMarker = new maplibregl.Marker({ element: boatIcon, rotationAlignment: "map" })
  .setLngLat([def.start.lng, def.start.lat])
  .addTo(map);

const mobIcon = document.createElement("div");
mobIcon.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22" style="pointer-events:none">
  <circle cx="11" cy="11" r="8.5" fill="rgba(255,90,0,0.25)" stroke="#ff5a00" stroke-width="2"/>
  <circle cx="11" cy="11" r="3" fill="#ff5a00"/>
</svg>`;
const mobMarker = new maplibregl.Marker({ element: mobIcon })
  .setLngLat([def.start.lng, def.start.lat])
  .addTo(map);
mobMarker.getElement().style.display = "none";

// ---- main loop ----
let last = performance.now();
let acc = 0;
let lastAgroundFlash = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;

  const input = controls.update(dt);
  if (Math.abs(input.tiller) > 0.08) userActed = true;
  while (acc >= DT) {
    sim.step(DT, { tiller: input.tiller, sheetTargetDeg: input.sheetTargetDeg, auxOn: input.auxOn });
    acc -= DT;
  }

  const tel = sim.telemetry();
  const [lng, lat] = water.plane.unproject(sim.state.pos);

  // MOB drill
  const mob = sim.floats.find((f) => f.id === "mob");
  if (mob) {
    const br = sim.bearingAndRange(mob.pos);
    drill.update(dt, tel, br.bearing, br.distance);
    hud.updateMob(drill.status);
  }

  // chartplotter symbols track the sim; the boat symbol also rotates with heading
  const hdgDeg = ((sim.state.heading * 180) / Math.PI) % 360;
  boatMarker.setLngLat([lng, lat]);
  boatMarker.setRotation(hdgDeg);
  boatMarker.getElement().style.display = rig.mode === "chartplotter" ? "" : "none";
  const mobVisible = !!mob && rig.mode === "chartplotter";
  mobMarker.getElement().style.display = mobVisible ? "" : "none";
  if (mob) {
    const [mlng, mlat] = water.plane.unproject(mob.pos);
    mobMarker.setLngLat([mlng, mlat]);
  }

  // aground warning (rate-limited)
  if (sim.state.aground && now - lastAgroundFlash > 5000) {
    lastAgroundFlash = now;
    hud.flash("AGROUND — bear away or E-drive off", 3000);
  }

  scene.update(tel);
  rig.update(lng, lat, ((sim.state.heading * 180) / Math.PI) % 360, dt);
  hud.update(tel, usingLive ? live.status : manual.status, controls.state.tiller);
  map.triggerRepaint();
  requestAnimationFrame(frame);
}
