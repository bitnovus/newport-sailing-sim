import * as THREE from "three";
import type { Map as MLMap, CustomLayerInterface } from "maplibre-gl";
import { MercatorCoordinate } from "maplibre-gl";
import { buildBoat, type BoatModel } from "./boat-model";
import type { Sim, Telemetry } from "../core/sim";

interface WakeParticle {
  x: number;
  y: number;
  born: number;
}

/**
 * Three.js scene rendered inside MapLibre's WebGL context as a custom 3D
 * layer. Objects live in a local East/South/Up meter frame anchored at the
 * harbor origin; the sim's North-based coordinates are flipped on input.
 */
export class SceneLayer implements CustomLayerInterface {
  id = "three-scene";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map: MLMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private modelTransform = new THREE.Matrix4();
  private boat!: BoatModel;
  private wake!: THREE.Points;
  private wakeGeo!: THREE.BufferGeometry;
  private wakeParticles: WakeParticle[] = [];
  private lastWakeSpawn = 0;
  private mobMarker!: THREE.Group;
  private clock = new THREE.Clock();

  constructor(
    private readonly anchor: { lat: number; lng: number },
    private readonly sim: Sim,
  ) {}

  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
    });
    this.renderer.autoClear = false;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(-0.4, 0.6, 1);
    this.scene.add(sun);

    this.boat = buildBoat();
    this.scene.add(this.boat.root);

    // wake particles
    const N = 260;
    this.wakeGeo = new THREE.BufferGeometry();
    this.wakeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.wakeParticles = Array.from({ length: N }, () => ({ x: 0, y: 0, born: -99 }));
    this.wake = new THREE.Points(
      this.wakeGeo,
      new THREE.PointsMaterial({ color: 0xeef6f8, size: 1.6, transparent: true, opacity: 0.4, sizeAttenuation: true }),
    );
    this.scene.add(this.wake);

    // MOB marker: dan-buoy style orange buoy + flag
    this.mobMarker = new THREE.Group();
    const buoyBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 1.0, 10),
      new THREE.MeshLambertMaterial({ color: 0xff5a00 }),
    );
    buoyBody.position.z = 0.3;
    this.mobMarker.add(buoyBody);
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x333333 }),
    );
    flagPole.position.z = 1.4;
    this.mobMarker.add(flagPole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xff5a00, side: THREE.DoubleSide }),
    );
    flag.position.set(0.28, 0, 1.75);
    this.mobMarker.add(flag);
    this.mobMarker.visible = false;
    this.scene.add(this.mobMarker);
  }

  onRemove(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }

  /** Sync visuals from the sim (called every animation frame). */
  update(telemetry: Telemetry): void {
    const s = this.sim.state;
    const t = this.clock.getElapsedTime();

    // never let a bad state poison the render pipeline
    if (!Number.isFinite(s.pos.x + s.pos.y + s.heading + s.heel + s.u)) return;

    // sea state: gentle heave/pitch/roll growing with wind
    const seaAmp = Math.min(1, telemetry.tws / 14);
    this.boat.root.position.set(
      s.pos.x,
      -s.pos.y,
      Math.sin(t * 1.2) * 0.035 * seaAmp + Math.sin(t * 2.7 + 1) * 0.015 * seaAmp,
    );
    this.boat.root.rotation.z = s.heading - Math.PI / 2;
    this.boat.hull.rotation.x = s.heel + Math.sin(t * 1.1 + 0.5) * 0.02 * seaAmp;
    this.boat.hull.rotation.y = Math.sin(t * 0.9) * 0.012 * seaAmp;

    // exaggerate the hull when zoomed out so the boat reads at harbor scale:
    // true size at z16+, up to ~2.8× at z13
    const zoom = this.map?.getZoom() ?? 17;
    const scale = Math.min(2.8, Math.max(1, 1 + (16 - zoom) * 0.3));
    this.boat.root.scale.setScalar(scale);

    const main = telemetry.sails.find((sl) => sl.sailId === "main");
    const jib = telemetry.sails.find((sl) => sl.sailId === "jib");
    // sails fill to LEEWARD (opposite the apparent wind); boom sign in the
    // physics is windward-convention, so flip for rendering
    const side = telemetry.awa >= 0 ? 1 : -1; // +1 = port bulge when wind from stbd
    const pressure = Math.min(1, (telemetry.aws / 14) ** 2);
    const camber = 0.09 + 0.06 * pressure;
    if (main) {
      this.boat.mainSail.rotation.z = (-main.boomAngle * Math.PI) / 180;
      this.boat.mainSailSurface.update(camber, side, main.flow, t);
    }
    if (jib) {
      this.boat.jibSail.rotation.z = (-jib.boomAngle * Math.PI) / 180;
      this.boat.jibSailSurface.update(camber, side, jib.flow, t);
    }
    this.boat.rudder.rotation.z = (-s.rudderDeg * Math.PI) / 180;

    // MOB marker
    const mob = this.sim.floats.find((f) => f.id === "mob");
    this.mobMarker.visible = !!mob;
    if (mob) {
      this.mobMarker.position.set(mob.pos.x, -mob.pos.y, Math.sin(t * 1.5) * 0.1);
      this.mobMarker.rotation.z = Math.sin(t * 1.4) * 0.12;
    }

    // wake: emit behind the stern while making way
    if (t - this.lastWakeSpawn > 0.09 && s.u > 0.6) {
      this.lastWakeSpawn = t;
      const stale = this.wakeParticles.reduce((a, b) => (a.born < b.born ? a : b));
      const back = s.heading + Math.PI;
      const off = (Math.random() - 0.5) * 1.2 * (1 + s.u * 0.3);
      stale.x = s.pos.x + Math.sin(back) * 3.4 + Math.cos(s.heading) * off;
      stale.y = s.pos.y + Math.cos(back) * 3.4 - Math.sin(s.heading) * off;
      stale.born = t;
    }
    const posAttr = this.wakeGeo.getAttribute("position") as THREE.BufferAttribute;
    const life = 5;
    for (let i = 0; i < this.wakeParticles.length; i++) {
      const p = this.wakeParticles[i];
      const age = t - p.born;
      const alive = age >= 0 && age < life;
      const spread = alive ? 0.8 + age * 1.5 : 0;
      const jitter = alive ? Math.sin(i * 7.3 + Math.floor(p.born) * 3) * spread : 0;
      posAttr.setXYZ(i, p.x + jitter * 0.3, -p.y + jitter * 0.2, alive ? 0.08 - age * 0.01 : -50);
    }
    posAttr.needsUpdate = true;
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: { defaultProjectionData: { mainMatrix: unknown } },
  ): void {
    if (!this.renderer || !this.map) return;
    const merc = MercatorCoordinate.fromLngLat([this.anchor.lng, this.anchor.lat], 0);
    const scale = merc.meterInMercatorCoordinateUnits();
    this.modelTransform = new THREE.Matrix4()
      .makeTranslation(merc.x, merc.y, merc.z)
      .scale(new THREE.Vector3(scale, scale, scale));
    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(args.defaultProjectionData.mainMatrix as number[])
      .multiply(this.modelTransform);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}
