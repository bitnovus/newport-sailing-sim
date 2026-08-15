import type { BoatDefinition } from "../boats/types";
import { clamp, DEG, toDeg, toKn } from "./units";
import { add, headingVec, len, starboardVec, v, type Vec2 } from "./vec";
import { Environment } from "./environment";
import { apparentWind, type ApparentWind, type TrueWind } from "./physics/wind";
import { solveRig, selfTackingTrim, type SailSolution } from "./physics/sails";
import {
  auxiliaryThrust,
  hullDrag,
  heelStep,
  lateralDamping,
  leewayDrag,
  rudderForces,
  yawDamping,
} from "./physics/hydro";

/** Navigable-water oracle provided by the harbor module. */
export interface WaterDomain {
  contains(p: Vec2): boolean;
}

export interface BoatState {
  /** Position in the harbor's local East/North plane, meters. */
  pos: Vec2;
  /** Heading from true north, radians clockwise. */
  heading: number;
  /** Surge through the water along the hull (m/s, + = forward). */
  u: number;
  /** Sway through the water to starboard (m/s; + = starboard). */
  v: number;
  /** Yaw rate (rad/s, + = turning to starboard). */
  r: number;
  /** Heel (rad, + = to starboard). */
  heel: number;
  heelRate: number;
  /** Rudder deflection (deg, hydrodynamic: + = bow turns to starboard). */
  rudderDeg: number;
  /** Mainsheet commanded boom angle (deg). */
  sheetDeg: number;
  /** Actual (swept) boom angles per sail, deg, signed (+ = starboard-side physics convention). */
  boomDeg: Record<string, number>;
  /** Electric auxiliary on/off. */
  auxOn: boolean;
  /** True while the hull is in contact with non-navigable shoreline. */
  aground: boolean;
}

export interface SimInputs {
  /**
   * Tiller position −1..1 as the HELMSMAN pushes it: + = tiller to starboard,
   * which turns the boat to PORT (real tiller behavior). Controls may flip
   * the sign for casual steering mode.
   */
  tiller: number;
  /** Commanded mainsheet boom angle, deg from centerline. */
  sheetTargetDeg: number;
  auxOn: boolean;
}

export interface Telemetry {
  sog: number; // knots
  cog: number; // deg true
  /** Boat heading, deg true (centerline — the reference for wind angles). */
  headingDeg: number;
  speedThroughWater: number; // knots
  leeway: number; // deg + = drifting to starboard
  aws: number; // knots
  awa: number; // deg, + = from starboard
  twd: number; // deg true (instantaneous, with wander)
  tws: number; // knots
  heelDeg: number;
  rudderDeg: number;
  sheetDeg: number;
  sails: SailSolution[];
}

/** A drifting object (MOB marker) — current plus windage leeway. */
export interface FloatingObject {
  id: string;
  pos: Vec2;
  /** Fraction of true-wind speed it drifts downwind (0.025 ≈ dan buoy). */
  windage: number;
  droppedAt: number;
}

export class Sim {
  readonly boat: BoatDefinition;
  readonly env: Environment;
  state: BoatState;
  time = 0;
  floats: FloatingObject[] = [];

  private readonly water: WaterDomain | null;
  /** Last confirmed in-water position, for grounding recovery. */
  private lastWaterPos: Vec2 = v(0, 0);

  constructor(boat: BoatDefinition, env: Environment, water: WaterDomain | null = null) {
    this.boat = boat;
    this.env = env;
    this.water = water;
    this.state = {
      pos: v(0, 0),
      heading: 0,
      u: 0,
      v: 0,
      r: 0,
      heel: 0,
      heelRate: 0,
      rudderDeg: 0,
      sheetDeg: 25,
      boomDeg: Object.fromEntries(boat.sails.map((sail) => [sail.id, 25])),
      auxOn: false,
      aground: false,
    };
  }

  spawn(pos: Vec2, headingRad: number): void {
    this.state.pos = pos;
    this.state.heading = headingRad;
    this.state.u = this.state.v = this.state.r = 0;
    this.state.heel = this.state.heelRate = 0;
    this.state.aground = false;
    this.lastWaterPos = pos;
    this.floats = [];
    this.time = 0;
  }

  dropFloat(id: string, windage = 0.025): FloatingObject {
    const f: FloatingObject = {
      id,
      pos: { ...this.state.pos },
      windage,
      droppedAt: this.time,
    };
    this.floats.push(f);
    return f;
  }

  private trueWind: TrueWind = { speed: 0, directionFrom: 0 };
  private lastAw: ApparentWind = { speed: 0, angle: 0, vector: v(0, 0) };
  private lastSails: SailSolution[] = [];

  /** Advance one fixed physics step. dt should stay ≤ 1/30 s. */
  step(dt: number, inputs: SimInputs): void {
    const s = this.state;
    const b = this.boat;
    this.time += dt;

    // ---- actuator dynamics: rudder + sheet move toward commands ----
    const rudderTarget = -clamp(inputs.tiller, -1, 1) * b.rudder.maxEffectiveAngle;
    const rudderRate = b.rudder.rateLimit * dt;
    s.rudderDeg += clamp(rudderTarget - s.rudderDeg, -rudderRate, rudderRate);
    s.sheetDeg = clamp(inputs.sheetTargetDeg, 5, 85);
    s.auxOn = inputs.auxOn;

    // ---- wind + apparent wind (boat moves through the AIR = ground frame) ----
    this.trueWind = this.env.windAt(this.time, dt);
    const along = headingVec(s.heading);
    const stbd = starboardVec(s.heading);
    const groundVel = add(
      v(s.u * along.x + s.v * stbd.x, s.u * along.y + s.v * stbd.y),
      this.env.current,
    );
    const aw = apparentWind(this.trueWind, s.heading, groundVel);
    this.lastAw = aw;

    // ---- boom sweep: booms travel at a finite rate, so tacks and jibes show
    // the sail sweeping across (and the force side transitions with it) ----
    for (const sail of b.sails) {
      const target =
        sail.trim.kind === "sheet"
          ? Math.sign(aw.angle) * clamp(Math.abs(s.sheetDeg), sail.trim.min, sail.trim.max)
          : selfTackingTrim(sail, aw.angle);
      // self-tackers snap across; the big main sweeps (jibe crash included)
      const rate = (sail.trim.kind === "selfTacking" ? 220 : 130) * dt;
      const cur = s.boomDeg[sail.id] ?? target;
      s.boomDeg[sail.id] = cur + clamp(target - cur, -rate, rate);
    }

    // ---- rig forces ----
    const rig = solveRig(b, aw, s.sheetDeg, s.heel, s.boomDeg);
    this.lastSails = rig.sails;

    // ---- hydro forces ----
    const drag = hullDrag(b, s.u);
    const lwDrag = leewayDrag(s.u, s.v);
    const rudder = rudderForces(b, s.u, s.rudderDeg);
    const aux = s.auxOn ? auxiliaryThrust(b, s.u) : 0;

    // weather helm grows with heel (heeled hull yaws to windward)
    const heelYaw = -900 * Math.sin(s.heel) * (0.35 + s.u / 5);

    // ---- surge: explicit (drag wall keeps u tame) ----
    const fx = rig.total.drive + aux + rudder.drag - drag + lwDrag;
    s.u = Math.max(-0.5, Math.min(8, s.u + (fx / b.mass + s.v * s.r) * dt));

    // ---- sway: semi-implicit quadratic solve (explicit diverges at 60 Hz) ----
    // m·(v − v0)/dt = side − k·v − c·v·|v|, Newton from v0
    const { k, c } = lateralDamping(b, s.u);
    let nv = s.v + ((rig.total.side / b.mass) * dt - s.u * s.r * dt) * 0.5;
    for (let i = 0; i < 4; i++) {
      const R = k * nv + c * nv * Math.abs(nv);
      const F = (b.mass * (nv - s.v)) / dt - rig.total.side + R + b.mass * s.u * s.r;
      const dR = k + 2 * c * Math.abs(nv);
      nv -= F / (b.mass / dt + dR);
    }
    s.v = Math.max(-3, Math.min(3, nv));

    // ---- yaw ----
    const yawMoment = rig.total.yaw + rudder.yaw + yawDamping(s.u, s.r) + heelYaw;
    s.r += (yawMoment / b.yawInertia) * dt;
    s.r = clamp(s.r, -0.8, 0.8);
    s.heading += s.r * dt;

    // ---- heel ----
    const h = heelStep(b, s.heel, s.heelRate, rig.total.heel, dt);
    s.heel = h.heel;
    s.heelRate = h.heelRate;

    // ---- integrate position through the water + current ----
    const along2 = headingVec(s.heading);
    const stbd2 = starboardVec(s.heading);
    const waterVel = v(s.u * along2.x + s.v * stbd2.x, s.u * along2.y + s.v * stbd2.y);
    const nextPos = add(waterVel, this.env.current);
    const newPos = { x: s.pos.x + nextPos.x * dt, y: s.pos.y + nextPos.y * dt };

    if (this.water && !this.water.contains(newPos)) {
      // grounded: kill most way and slide back toward the last known
      // navigable position so the boat works itself off the shoreline
      // instead of parking forever
      s.u *= -0.15;
      s.v *= 0.3;
      s.r *= 0.4;
      s.pos = {
        x: s.pos.x + (this.lastWaterPos.x - s.pos.x) * 0.12,
        y: s.pos.y + (this.lastWaterPos.y - s.pos.y) * 0.12,
      };
      s.aground = true;
    } else {
      s.pos = newPos;
      s.aground = false;
      this.lastWaterPos = { x: s.pos.x, y: s.pos.y };
    }

    // ---- floating objects drift: current + windage ----
    const twVec = this.trueWind;
    const toward = ((twVec.directionFrom + 180) * DEG);
    const drift = v(Math.sin(toward), Math.cos(toward));
    for (const f of this.floats) {
      f.pos.x += (this.env.current.x + drift.x * twVec.speed * f.windage) * dt;
      f.pos.y += (this.env.current.y + drift.y * twVec.speed * f.windage) * dt;
    }
  }

  telemetry(): Telemetry {
    const s = this.state;
    const along = headingVec(s.heading);
    const stbd = starboardVec(s.heading);
    const waterVel = v(s.u * along.x + s.v * stbd.x, s.u * along.y + s.v * stbd.y);
    const groundVel = add(waterVel, this.env.current);
    const cog = (Math.atan2(groundVel.x, groundVel.y) / DEG + 360) % 360;
    return {
      sog: toKn(len(groundVel)),
      cog: len(groundVel) > 0.05 ? cog : s.heading / DEG,
      headingDeg: ((s.heading / DEG) % 360 + 360) % 360,
      speedThroughWater: toKn(Math.hypot(s.u, s.v)),
      leeway: s.u > 0.3 ? toDeg(Math.atan2(s.v, s.u)) : 0,
      aws: toKn(this.lastAw.speed),
      awa: this.lastAw.angle,
      twd: this.trueWind.directionFrom,
      tws: toKn(this.trueWind.speed),
      heelDeg: toDeg(s.heel),
      rudderDeg: s.rudderDeg,
      sheetDeg: s.sheetDeg,
      sails: this.lastSails,
    };
  }

  /** Bearing (deg true) and distance (m) from the boat to a point. */
  bearingAndRange(p: Vec2): { bearing: number; distance: number } {
    const s = this.state;
    const dx = p.x - s.pos.x;
    const dy = p.y - s.pos.y;
    return {
      bearing: (Math.atan2(dx, dy) / DEG + 360) % 360,
      distance: Math.hypot(dx, dy),
    };
  }
}
