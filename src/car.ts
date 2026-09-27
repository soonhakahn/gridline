// Open-wheel single-seater mesh builder.
// All geometry is procedural (boxes/cylinders). Front and rear wings are
// separate pivots so vehicle.ts can animate their angle for active aero.

import * as THREE from 'three';
import { Livery, CAR_LENGTH, CAR_WIDTH } from './config';

export interface CarRig {
  group: THREE.Group;
  wheels: THREE.Mesh[]; // FL, FR, RL, RR (spin around local X)
  frontWingL: THREE.Object3D; // steer visual (yaw)
  frontWing: THREE.Object3D; // pitch pivot (aero)
  rearWing: THREE.Object3D; // pitch pivot (aero)
  bodyMat: THREE.MeshStandardMaterial;
  setWingAngle(open01: number): void; // 0 = closed (CM), 1 = open (SM)
}

function numberTexture(num: number, fg: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(0,0,0,0)';
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = fg;
  c.font = 'bold 84px sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(num), 64, 70);
  return new THREE.CanvasTexture(cv);
}

export function buildCar(livery: Livery, opts: { ghost?: boolean } = {}): CarRig {
  const group = new THREE.Group();
  const ghost = !!opts.ghost;
  const base = new THREE.Color(livery.base);
  const accent = new THREE.Color(livery.accent);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: base, roughness: 0.35, metalness: 0.55,
    transparent: ghost, opacity: ghost ? 0.35 : 1,
    depthWrite: !ghost,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.4, metalness: 0.4,
    transparent: ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x14161a, roughness: 0.8,
    transparent: ghost, opacity: ghost ? 0.3 : 1, depthWrite: !ghost,
  });
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x0c0c0c, roughness: 0.95,
    transparent: ghost, opacity: ghost ? 0.3 : 1, depthWrite: !ghost,
  });

  const add = (mesh: THREE.Mesh, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = !ghost;
    group.add(mesh);
    return mesh;
  };

  // Car faces +Z. Length ~5.6 m, width 2.0 m.
  const L = CAR_LENGTH, W = CAR_WIDTH;

  // --- monocoque / nose ---
  const nose = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 2.6), bodyMat), 0, 0.52, L * 0.28);
  nose.geometry.translate(0, 0, 0);
  const cockpit = add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.55, 1.9), bodyMat), 0, 0.62, -L * 0.08);
  const engineCover = add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.6, 1.7), bodyMat), 0, 0.72, -L * 0.32);
  // shark-fin accent
  const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 1.5), accentMat), 0, 1.05, -L * 0.3);
  // sidepods
  for (const s of [1, -1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.7), bodyMat), s * 0.78, 0.5, -L * 0.1);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 1.2), accentMat), s * 0.78, 0.78, -L * 0.08);
  }
  // floor
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 3.6), darkMat), 0, 0.18, -L * 0.05);

  // --- halo ---
  const haloMat = darkMat;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.07, 8, 20, Math.PI * 1.55), haloMat);
  halo.position.set(0, 1.12, -L * 0.06);
  halo.rotation.set(0.15, 0, Math.PI * 0.72);
  halo.castShadow = !ghost;
  group.add(halo);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.09), haloMat), 0, 1.05, L * 0.02); // front strut

  // --- driver helmet (no faces) ---
  const helmet = add(
    new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), accentMat),
    0, 1.02, -L * 0.1
  );
  helmet.scale.set(1, 1.15, 1.1);

  // --- number decal on nose ---
  const numTex = numberTexture(livery.number, '#ffffff');
  if (numTex && !ghost) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true })
    );
    decal.position.set(0, 0.74, L * 0.28 + 0.001);
    decal.rotation.x = -0.12;
    group.add(decal);
  }

  // --- front wing (steer yaw group + pitch pivot) ---
  const frontWingL = new THREE.Group(); // yaws with steering (visual)
  frontWingL.position.set(0, 0.32, L * 0.47);
  const frontWing = new THREE.Group(); // pitches for active aero
  const fwMain = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.5), bodyMat);
  fwMain.castShadow = !ghost;
  frontWing.add(fwMain);
  const fwFlap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.28), accentMat);
  fwFlap.position.set(0, 0.09, -0.3);
  frontWing.add(fwFlap);
  for (const s of [1, -1]) {
    const ep = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.62), accentMat);
    ep.position.set(s * 1.0, 0.12, -0.05);
    frontWing.add(ep);
  }
  frontWingL.add(frontWing);
  group.add(frontWingL);

  // --- rear wing (pitch pivot) ---
  const rearWing = new THREE.Group();
  rearWing.position.set(0, 1.05, -L * 0.47);
  const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.42), bodyMat);
  rwMain.castShadow = !ghost;
  rearWing.add(rwMain);
  const rwFlap = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.3), accentMat);
  rwFlap.position.set(0, 0.1, 0.3);
  rearWing.add(rwFlap);
  for (const s of [1, -1]) {
    const ep = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.72), bodyMat);
    ep.position.set(s * 0.6, -0.1, 0.1);
    rearWing.add(ep);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.3), darkMat);
    beam.position.set(s * 0.35, -0.45, 0.05);
    rearWing.add(beam);
  }
  const drsPod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), accentMat);
  drsPod.position.set(0, 0.02, 0.32);
  rearWing.add(drsPod);
  group.add(rearWing);

  // --- wheels ---
  const wheels: THREE.Mesh[] = [];
  const wheelGeoF = new THREE.CylinderGeometry(0.33, 0.33, 0.42, 18);
  wheelGeoF.rotateZ(Math.PI / 2);
  const wheelGeoR = new THREE.CylinderGeometry(0.36, 0.36, 0.46, 18);
  wheelGeoR.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.44, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });
  const wpos: [number, number, number, boolean][] = [
    [W / 2 - 0.05, 0.33, L * 0.32, true],
    [-W / 2 + 0.05, 0.33, L * 0.32, true],
    [W / 2 - 0.05, 0.36, -L * 0.32, false],
    [-W / 2 + 0.05, 0.36, -L * 0.32, false],
  ];
  for (const [wx, wy, wz, front] of wpos) {
    const wg = new THREE.Group();
    const tyre = new THREE.Mesh(front ? wheelGeoF : wheelGeoR, tyreMat);
    tyre.castShadow = !ghost;
    const rim = new THREE.Mesh(rimGeo, ghost ? tyreMat : rimMat);
    wg.add(tyre, rim);
    // suspension arms (visual)
    for (const dz of [-0.18, 0.18]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.07), darkMat);
      arm.position.set(wx > 0 ? -0.35 : 0.35, 0, dz);
      wg.add(arm);
    }
    wg.position.set(wx, wy, wz);
    group.add(wg);
    wheels.push(tyre);
    // store steer pivot on front wheels via parent group
    (tyre as unknown as { _steer: THREE.Group })._steer = wg;
  }

  // Active aero: rotate wing flaps. Closed (CM) = high angle, open (SM) = flat.
  // Animates in <150 ms via lerp in vehicle update; this sets the target pose.
  let wingT = 0;
  const rig: CarRig = {
    group, wheels, frontWingL, frontWing, rearWing, bodyMat,
    setWingAngle(open01: number) {
      wingT = open01;
      const fwAngle = THREE.MathUtils.lerp(0.42, 0.06, open01); // rad
      const rwAngle = THREE.MathUtils.lerp(0.5, 0.08, open01);
      frontWing.rotation.x = -fwAngle;
      rearWing.rotation.x = rwAngle;
    },
  };
  rig.setWingAngle(0);
  void wingT;
  return rig;
}
