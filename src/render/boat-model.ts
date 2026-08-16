import * as THREE from "three";

/**
 * Procedural low-poly Harbor 20 (no external assets).
 * Local frame: +x = forward (bow), +y = port, +z = up; the boat sits with
 * its waterline at z = 0. Beam is 2.13 m, LOA 6.1 m, mast ~8.2 m.
 */
export interface BoatModel {
  root: THREE.Group; // heading rotation applied here
  hull: THREE.Group; // heel rotation applied here
  mainSail: THREE.Group; // pivots at mast (boom angle)
  jibSail: THREE.Group; // pivots at bow (self-tacking)
  rudder: THREE.Group; // pivots at stern post
  mainSailSurface: SailSurface;
  jibSailSurface: SailSurface;
}

/**
 * A sail as an animatable grid between a luff edge and a leech edge.
 * Each frame the camber (draft) bulges to leeward scaled by wind pressure
 * and flow; a stalled/luffing sail flaps with a traveling ripple.
 */
export interface SailSurface {
  mesh: THREE.Mesh;
  /**
   * @param camberFrac draft as a fraction of local chord (0..0.2)
   * @param side +1 bulge to starboard (+Y), −1 to port — caller passes leeward
   * @param flow 0..1 attached-flow fraction (0 = fully luffing)
   * @param time seconds, drives the flutter phase
   */
  update(camberFrac: number, side: number, flow: number, time: number): void;
}

function buildSailSurface(
  luffP: (s: number) => THREE.Vector3,
  leechP: (s: number) => THREE.Vector3,
  nS: number,
  nU: number,
): SailSurface {
  const count = (nS + 1) * (nU + 1);
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const idx: number[] = [];
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nU; j++) {
      const a = i * (nU + 1) + j;
      const b = a + 1;
      const c = a + nU + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setIndex(idx);

  const luff: THREE.Vector3[] = [];
  const leech: THREE.Vector3[] = [];
  for (let i = 0; i <= nS; i++) {
    luff.push(luffP(i / nS));
    leech.push(leechP(i / nS));
  }

  const update = (camberFrac: number, side: number, flow: number, time: number): void => {
    let k = 0;
    for (let i = 0; i <= nS; i++) {
      const sF = i / nS;
      const A = luff[i];
      const B = leech[i];
      const chord = Math.hypot(B.x - A.x, B.z - A.z);
      for (let j = 0; j <= nU; j++) {
        const uF = j / nU;
        const x = A.x + (B.x - A.x) * uF;
        const z = A.z + (B.z - A.z) * uF;
        let y = 0;
        if (chord > 0.03) {
          // draft: max ~40% back from the luff, easing to zero at both edges,
          // shallower aloft, scaled by how much of the sail is flowing
          const draft =
            camberFrac * flow * chord * (1 - 0.45 * sF) * Math.sin(Math.PI * uF) * (0.45 + 0.55 * (1 - uF));
          // luffing/stalled flutter: traveling wave across the chord
          const flap = (1 - flow) * 0.09 * chord * Math.sin(uF * 5.5 + time * 21 + sF * 4);
          y = side * draft + flap;
        }
        positions[k++] = x;
        positions[k++] = y;
        positions[k++] = z;
      }
    }
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
  };

  update(0, 1, 1, 0);
  const mesh = new THREE.Mesh(geo, sailMaterial);
  mesh.frustumCulled = false; // animated vertices can outgrow the static bbox
  return { mesh, update };
}

const hullMaterial = new THREE.MeshLambertMaterial({ color: 0xf2efe8 });
const deckMaterial = new THREE.MeshLambertMaterial({ color: 0xc9a87a });
const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2f38 });
const sailMaterial = new THREE.MeshLambertMaterial({
  color: 0xf7f4ec,
  side: THREE.DoubleSide,
});

function hullPlanShape(): THREE.Shape {
  const s = new THREE.Shape();
  // x = longitudinal (+bow), y = beam (port +)
  s.moveTo(-3.05, 0.62); // stern port quarter
  s.quadraticCurveTo(-1.4, 1.065, 0.4, 1.065); // widen to max beam
  s.quadraticCurveTo(1.8, 1.0, 3.05, 0.0); // taper to bow point
  s.quadraticCurveTo(1.8, -1.0, 0.4, -1.065);
  s.quadraticCurveTo(-1.4, -1.065, -3.05, -0.62);
  s.closePath();
  return s;
}

export function buildBoat(): BoatModel {
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);

  // ---- hull shell ----
  const hullGeo = new THREE.ExtrudeGeometry(hullPlanShape(), { depth: 0.55, bevelEnabled: false });
  hullGeo.translate(0, 0, -0.55); // deck at z=0, keel line at z=-0.55
  const hullMesh = new THREE.Mesh(hullGeo, hullMaterial);
  hull.add(hullMesh);

  // deck cap (slightly inset look via darker cockpit)
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 0.06), darkMaterial);
  cockpit.position.set(-1.35, 0, 0.03);
  hull.add(cockpit);

  // ---- keel fin + bulb ----
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 0.62), hullMaterial);
  keel.position.set(-0.35, 0, -0.86);
  hull.add(keel);
  const bulb = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 1.15, 4, 8), darkMaterial);
  bulb.rotation.z = Math.PI / 2;
  bulb.position.set(-0.35, 0, -1.14);
  hull.add(bulb);

  // ---- rudder + tiller ----
  const rudder = new THREE.Group();
  rudder.position.set(-2.75, 0, -0.3);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.45), hullMaterial);
  blade.position.set(-0.12, 0, -0.28);
  rudder.add(blade);
  const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 1.15), deckMaterial);
  tiller.rotation.z = Math.PI / 2;
  tiller.position.set(0.55, 0, 0.06);
  rudder.add(tiller);
  hull.add(rudder);

  // ---- mast + standing rigging ----
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 8.2), hullMaterial);
  mast.position.set(0.8, 0, 4.1);
  hull.add(mast);
  const forestay = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 7.2), darkMaterial);
  forestay.position.set(1.9, 0, 3.35);
  forestay.rotation.z = Math.atan2(2.2, 6.7);
  hull.add(forestay);

  // ---- mainsail + boom (pivot at mast base) ----
  const mainSail = new THREE.Group();
  mainSail.position.set(0.8, 0, 1.05); // gooseneck height
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.5), hullMaterial);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-1.75, 0, 0);
  mainSail.add(boom);

  // luff up the mast, roached leech down to the boom end
  const mainSailSurface = buildSailSurface(
    (s) => new THREE.Vector3(0, 0, 6.9 * s),
    (s) => new THREE.Vector3(-(2.85 * (1 - s) + 0.7 * s * (1 - s)), 0, 6.9 * s),
    12,
    8,
  );
  mainSail.add(mainSailSurface.mesh);
  hull.add(mainSail);

  // ---- self-tacking jib (pivot at the bow) ----
  const jibSail = new THREE.Group();
  jibSail.position.set(2.95, 0, 0.95);
  const jibBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5), hullMaterial);
  jibBoom.rotation.z = Math.PI / 2;
  jibBoom.position.set(-0.75, 0, 0);
  jibSail.add(jibBoom);

  const jibHead = new THREE.Vector3(-1.95, 0, 4.35); // top of the forestay span
  const jibClew = new THREE.Vector3(-1.42, 0, 0.1); // outhaul on the traveler car
  const jibSailSurface = buildSailSurface(
    (s) => new THREE.Vector3(0, 0, 0).lerp(jibHead, s),
    (s) => jibClew.clone().lerp(jibHead, s),
    10,
    6,
  );
  jibSail.add(jibSailSurface.mesh);
  hull.add(jibSail);

  return { root, hull, mainSail, jibSail, rudder, mainSailSurface, jibSailSurface };
}
