// Costa Verde circuit: procedural closed-loop spline track.
// Builds centerline samples, racing data (zones, sectors, racing line,
// corner speed targets) and all static meshes (road, kerbs, walls,
// grandstands, palms, sea, city, gantry, DET board, minimap).
// Works headless (node) too: canvas textures are skipped when `document`
// is unavailable so the sim test can import this module.

import * as THREE from 'three';
import { TRACK_HALF_WIDTH, SAMPLE_DS, LAT_BASE, LAT_REF, LAT_DF } from './config';

type Seg =
  | { kind: 'S'; len: number; sm?: boolean }
  | { kind: 'A'; r: number; ang: number; dir: 'L' | 'R' };

// 18 corners, ~5.4 km. Main straight first (start/finish on it).
const SEGMENTS: Seg[] = [
  { kind: 'S', len: 550, sm: true }, // main straight (SM)
  { kind: 'A', r: 140, ang: 70, dir: 'R' }, // T1
  { kind: 'S', len: 120 },
  { kind: 'A', r: 90, ang: 110, dir: 'L' }, // T2
  { kind: 'A', r: 70, ang: 60, dir: 'R' }, // T3
  { kind: 'S', len: 320, sm: true }, // back straight (SM)
  { kind: 'A', r: 110, ang: 85, dir: 'R' }, // T4
  { kind: 'S', len: 150 },
  { kind: 'A', r: 60, ang: 110, dir: 'L' }, // T5
  { kind: 'S', len: 220 },
  { kind: 'A', r: 150, ang: 55, dir: 'R' }, // T6
  { kind: 'A', r: 95, ang: 75, dir: 'L' }, // T7
  { kind: 'S', len: 420, sm: true }, // seaside straight (SM)
  { kind: 'A', r: 130, ang: 65, dir: 'L' }, // T8
  { kind: 'S', len: 120 },
  { kind: 'A', r: 75, ang: 100, dir: 'R' }, // T9
  { kind: 'S', len: 260 },
  { kind: 'A', r: 160, ang: 45, dir: 'L' }, // T10
  { kind: 'A', r: 85, ang: 80, dir: 'R' }, // T11
  { kind: 'S', len: 180 },
  { kind: 'A', r: 55, ang: 130, dir: 'R' }, // T12 hairpin
  { kind: 'S', len: 280, sm: true }, // city straight (SM)
  { kind: 'A', r: 120, ang: 70, dir: 'L' }, // T13
  { kind: 'S', len: 110 },
  { kind: 'A', r: 90, ang: 90, dir: 'R' }, // T14
  { kind: 'A', r: 100, ang: 60, dir: 'L' }, // T15
  { kind: 'S', len: 200 },
  { kind: 'A', r: 140, ang: 50, dir: 'R' }, // T16
  { kind: 'S', len: 140 },
  { kind: 'A', r: 80, ang: 95, dir: 'L' }, // T17
  { kind: 'A', r: 110, ang: 55, dir: 'R' }, // T18 onto main straight
];

export interface TrackData {
  length: number;
  ds: number;
  count: number;
  halfW: number;
  detS: number; // DET detection point (before longest straight)
  startS: number; // start/finish line
  px: Float32Array; py: Float32Array; pz: Float32Array;
  tx: Float32Array; tz: Float32Array; // tangent (xz, normalized)
  nx: Float32Array; nz: Float32Array; // left normal (xz)
  k: Float32Array; // signed curvature (dh/ds); k>0 = right turn
  zone: Uint8Array; // 1 = SM (straight mode) zone
  sector: Uint8Array; // 0/1/2
  raceLine: Float32Array; // target lateral offset (m)
  cornerSpeed: Float32Array; // achievable target speed (m/s)
  group: THREE.Group;
  minimap: HTMLCanvasElement | null;
  idx(s: number): number;
  posAt(s: number, d: number, out: THREE.Vector3): THREE.Vector3;
  yawAt(s: number): number;
  heightAt(s: number): number;
}

function makeCanvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function buildTrack(): TrackData {
  // ---- integrate centerline ----
  const xs: number[] = [], zs: number[] = [], ks: number[] = [], zones: number[] = [];
  let x = 0, z = 0, h = 0;
  for (const seg of SEGMENTS) {
    if (seg.kind === 'S') {
      const n = Math.max(1, Math.round(seg.len / SAMPLE_DS));
      for (let i = 0; i < n; i++) {
        xs.push(x); zs.push(z); ks.push(0); zones.push(seg.sm ? 1 : 0);
        x += Math.cos(h) * SAMPLE_DS; z += Math.sin(h) * SAMPLE_DS;
      }
    } else {
      const total = (seg.ang * Math.PI / 180) * (seg.dir === 'R' ? 1 : -1);
      const arcLen = seg.r * Math.abs(total);
      const n = Math.max(2, Math.round(arcLen / SAMPLE_DS));
      const dAng = total / n;
      const kk = total / arcLen;
      for (let i = 0; i < n; i++) {
        xs.push(x); zs.push(z); ks.push(kk); zones.push(0);
        h += dAng;
        x += Math.cos(h) * SAMPLE_DS; z += Math.sin(h) * SAMPLE_DS;
      }
    }
  }
  const count = xs.length;
  const ds = SAMPLE_DS;
  const length = count * ds;

  const px = new Float32Array(xs), pz = new Float32Array(zs);
  const kk = new Float32Array(ks);
  const zone = new Uint8Array(zones);
  const py = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    py[i] = 3.5 * Math.sin((2 * Math.PI * s) / 1500) + 2.0 * Math.sin((2 * Math.PI * s) / 520 + 1.3);
  }
  // tangents (central differences, wrapped)
  const tx = new Float32Array(count), tz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i - 1 + count) % count, b = (i + 1) % count;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1; tx[i] = dx / l; tz[i] = dz / l;
  }
  // left normals: n = (tz, -tx)
  const nx = new Float32Array(count), nz = new Float32Array(count);
  for (let i = 0; i < count; i++) { nx[i] = tz[i]; nz[i] = -tx[i]; }

  // smooth curvature a touch
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(kk);
    for (let i = 0; i < count; i++) {
      kk[i] = (src[(i - 1 + count) % count] + src[i] * 2 + src[(i + 1) % count]) / 4;
    }
  }

  const sector = new Uint8Array(count);
  for (let i = 0; i < count; i++) sector[i] = Math.min(2, Math.floor((3 * i) / count));

  // ---- corner speed targets: solve v = sqrt(aAvail(v) / |k|) by fixed-point
  // iteration (CM aero, medium tyre), then forward/backward pass for
  // achievable braking. Matches the Vehicle grip model so AI at pace<=1
  // never exceeds the limit, while pushing harder slides.
  const ACC = 11, BRK = 24, VMAX = 96;
  const cornerSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const ka = Math.abs(kk[i]);
    if (ka < 1e-6) { cornerSpeed[i] = VMAX; continue; }
    let v = 55;
    for (let it = 0; it < 6; it++) {
      const a = LAT_BASE + (v / LAT_REF) ** 2 * LAT_DF;
      v = Math.min(VMAX, Math.max(16, Math.sqrt(a / ka)));
    }
    cornerSpeed[i] = v;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < count; i++) cornerSpeed[i] = Math.min(cornerSpeed[i], Math.sqrt(cornerSpeed[i - 1] ** 2 + 2 * ACC * ds));
    for (let i = count - 2; i >= 0; i--) cornerSpeed[i] = Math.min(cornerSpeed[i], Math.sqrt(cornerSpeed[i + 1] ** 2 + 2 * BRK * ds));
    // wrap the passes across the start line
    cornerSpeed[0] = Math.min(cornerSpeed[0], Math.sqrt(cornerSpeed[count - 1] ** 2 + 2 * ACC * ds));
  }

  // ---- racing line: bias toward outside of upcoming corners, then smooth ----
  const raceLine = new Float32Array(count);
  const LOOK = 40; // samples ahead (~80 m)
  for (let i = 0; i < count; i++) {
    let ka = 0;
    for (let j = 1; j <= LOOK; j++) ka += kk[(i + j) % count];
    ka /= LOOK;
    raceLine[i] = Math.max(-3.4, Math.min(3.4, ka * 260));
  }
  for (let pass = 0; pass < 24; pass++) {
    const src = Float32Array.from(raceLine);
    for (let i = 0; i < count; i++) {
      raceLine[i] = (src[(i - 2 + count) % count] + src[(i - 1 + count) % count] * 2 + src[i] * 3 + src[(i + 1) % count] * 2 + src[(i + 2) % count]) / 9;
    }
  }

  const detS = length - 260;
  const startS = 150;
  const halfW = TRACK_HALF_WIDTH;

  const group = new THREE.Group();
  const minimap = buildMeshes(group, { px, py, pz, tx, tz, nx, nz, kk, zone, count, ds, length, halfW, detS, startS });

  const idx = (s: number) => ((Math.floor(s / ds) % count) + count) % count;
  const tmp = new THREE.Vector3();
  const data: TrackData = {
    length, ds, count, halfW, detS, startS,
    px, py, pz, tx, tz, nx, nz, k: kk, zone, sector, raceLine, cornerSpeed,
    group, minimap, idx,
    posAt(s, d, out) {
      const i = idx(s), j = (i + 1) % count;
      const f = (s - i * ds) / ds;
      const cx = px[i] + (px[j] - px[i]) * f, cz = pz[i] + (pz[j] - pz[i]) * f;
      const cy = py[i] + (py[j] - py[i]) * f;
      const ox = nx[i] + (nx[j] - nx[i]) * f, oz = nz[i] + (nz[j] - nz[i]) * f;
      return out.set(cx + ox * d, cy, cz + oz * d);
    },
    yawAt(s) {
      const i = idx(s);
      return Math.atan2(tx[i], tz[i]);
    },
    heightAt(s) {
      const i = idx(s), j = (i + 1) % count, f = (s - i * ds) / ds;
      return py[i] + (py[j] - py[i]) * f;
    },
  };
  // expose posAt helper use
  void tmp;
  return data;
}

interface Built {
  px: Float32Array; py: Float32Array; pz: Float32Array;
  tx: Float32Array; tz: Float32Array; nx: Float32Array; nz: Float32Array;
  kk: Float32Array; zone: Uint8Array; count: number; ds: number;
  length: number; halfW: number; detS: number; startS: number;
}

function buildMeshes(group: THREE.Group, t: Built): HTMLCanvasElement | null {
  const { px, py, pz, tx, tz, nx, nz, kk, zone, count, ds, length, halfW } = t;

  // ---------- road ----------
  const roadTex = makeCanvas(256, 256, (c) => {
    c.fillStyle = '#3b3e44'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${20 + Math.random() * 40},${20 + Math.random() * 40},${24 + Math.random() * 40},0.25)`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    c.fillStyle = '#e8e8e8'; c.fillRect(6, 0, 8, 256); c.fillRect(242, 0, 8, 256);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 250, 256, 6);
  });
  if (roadTex) { roadTex.repeat.set(1, 1); }
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, ...(roadTex ? { map: roadTex } : {}), roughness: 0.95 });
  if (!roadTex) roadMat.color.set(0x3b3e44);

  const rp: number[] = [], rn: number[] = [], ruv: number[] = [], ridx: number[] = [];
  for (let i = 0; i <= count; i++) {
    const j = i % count;
    // slight banking into corners (camber hint)
    const roll = Math.max(-0.045, Math.min(0.045, -kk[j] * 22));
    const lx = px[j] + nx[j] * halfW, lz = pz[j] + nz[j] * halfW;
    const rx = px[j] - nx[j] * halfW, rz = pz[j] - nz[j] * halfW;
    rp.push(lx, py[j] + roll * halfW, lz, rx, py[j] - roll * halfW, rz);
    rn.push(0, 1, 0, 0, 1, 0);
    const vv = (i * ds) / 14;
    ruv.push(0, vv, 1, vv);
    if (i < count) { const a = i * 2; ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(rn, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  roadGeo.setIndex(ridx);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  group.add(road);

  // ---------- kerbs on corners ----------
  const kerbTex = makeCanvas(128, 32, (c) => {
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#d8232a' : '#f2f2f2'; c.fillRect(i * 16, 0, 16, 32); }
  });
  const kerbMat = new THREE.MeshStandardMaterial({ ...(kerbTex ? { map: kerbTex } : {}), roughness: 0.9 });
  if (!kerbTex) kerbMat.color.set(0xcc3333);
  // build kerb strips per contiguous corner run, both sides
  const buildKerbSide = (side: 1 | -1) => {
    const P: number[] = [], UV: number[] = [], IX: number[] = [];
    let vi = 0, inRun = false, runStart = 0;
    for (let i = 0; i <= count; i++) {
      const j = i % count;
      const corner = Math.abs(kk[j]) > 0.004;
      if (corner && !inRun) { inRun = true; runStart = vi; }
      if (inRun) {
        const e0 = halfW, e1 = halfW + 1.5;
        P.push(px[j] + nx[j] * e0 * side, py[j] + 0.04, pz[j] + nz[j] * e0 * side);
        P.push(px[j] + nx[j] * e1 * side, py[j] + 0.04, pz[j] + nz[j] * e1 * side);
        const vv = (i * ds) / 6;
        UV.push(0, vv, 1, vv);
        if (vi > runStart) { const a = vi - 2; IX.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        vi += 2;
      }
      if (!corner && inRun) inRun = false;
    }
    if (P.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.computeVertexNormals();
    g.setIndex(IX);
    const m = new THREE.Mesh(g, kerbMat);
    m.receiveShadow = true;
    group.add(m);
  };
  buildKerbSide(1); buildKerbSide(-1);

  // ---------- walls (both sides, continuous) ----------
  const wp: number[] = [], widx: number[] = [];
  const wallH = 1.0, wallOff = halfW + 1.6;
  for (const side of [1, -1]) {
    const base = wp.length / 3;
    for (let i = 0; i <= count; i++) {
      const j = i % count;
      const wx = px[j] + nx[j] * wallOff * side, wz = pz[j] + nz[j] * wallOff * side;
      wp.push(wx, py[j], wz, wx, py[j] + wallH, wz);
      if (i < count) { const a = base + i * 2; widx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  wallGeo.computeVertexNormals();
  wallGeo.setIndex(widx);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc4, roughness: 0.9, side: THREE.DoubleSide });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  group.add(walls);

  // ---------- start/finish checker strip ----------
  const chkTex = makeCanvas(64, 64, (c) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 8, y * 8, 8, 8);
    }
  });
  {
    const si = Math.floor(t.startS / ds) % count;
    const g = new THREE.PlaneGeometry(halfW * 2, 3);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ ...(chkTex ? { map: chkTex } : {}), roughness: 0.9 }));
    if (!chkTex) (m.material as THREE.MeshStandardMaterial).color.set(0xffffff);
    const cx = px[si], cz = pz[si];
    m.position.set(cx, py[si] + 0.05, cz);
    m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(tx[si], tz[si]);
    group.add(m);
  }

  // ---------- SM zone paint (cyan decals on SM straights) ----------
  const smTex = makeCanvas(128, 64, (c) => {
    c.fillStyle = 'rgba(0,229,255,0.9)'; c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#062b33'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('SM', 64, 34);
  });
  const smDecalMat = new THREE.MeshBasicMaterial({ ...(smTex ? { map: smTex } : {}), transparent: true, depthWrite: false });
  if (!smTex) smDecalMat.color.set(0x00e5ff);
  for (let i = 0; i < count; i += 90) {
    if (zone[i] !== 1) continue;
    const g = new THREE.PlaneGeometry(6, 3);
    const m = new THREE.Mesh(g, smDecalMat);
    m.position.set(px[i], py[i] + 0.06, pz[i]);
    m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(tx[i], tz[i]);
    group.add(m);
  }

  // ---------- ground, sea, city ----------
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
  }
  const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 3.2, span * 3.2),
    new THREE.MeshStandardMaterial({ color: 0x5d9a46, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cxm, -0.8, czm);
  ground.receiveShadow = true;
  group.add(ground);

  // sea on +X side
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 2.2, span * 3.2),
    new THREE.MeshStandardMaterial({ color: 0x1f6f9e, roughness: 0.35, metalness: 0.25 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(maxX + span * 1.15, -1.6, czm);
  group.add(sea);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(40, span * 3.2),
    new THREE.MeshStandardMaterial({ color: 0xd9c48f, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(maxX + 42, -1.0, czm);
  group.add(sand);

  // city blocks on -X side (instanced)
  {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const N = 130;
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < N && guard++ < 4000) {
      const bx = minX - 60 - Math.random() * (span * 1.1);
      const bz = minZ - 40 + Math.random() * (maxZ - minZ + 80);
      // keep clear of the track corridor
      let clear = true;
      for (let i = 0; i < count; i += 12) {
        const dx = px[i] - bx, dz = pz[i] - bz;
        if (dx * dx + dz * dz < 55 * 55) { clear = false; break; }
      }
      if (!clear) continue;
      const w = 18 + Math.random() * 26, dep = 18 + Math.random() * 26, hh = 14 + Math.random() * 70;
      d.position.set(bx, hh / 2 - 0.8, bz);
      d.scale.set(w, hh, dep);
      d.rotation.y = (Math.random() - 0.5) * 0.4;
      d.updateMatrix();
      inst.setMatrixAt(placed, d.matrix);
      col.setHSL(0.58 + Math.random() * 0.06, 0.12 + Math.random() * 0.15, 0.45 + Math.random() * 0.25);
      inst.setColorAt(placed, col);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // palm trees along the sea side (instanced trunk + crown)
  {
    const trunkG = new THREE.CylinderGeometry(0.28, 0.42, 7, 6);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 1 });
    const crownG = new THREE.IcosahedronGeometry(3.1, 0);
    const crownM = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 1, flatShading: true });
    const spots: { x: number; z: number; s: number }[] = [];
    let guard = 0;
    while (spots.length < 90 && guard++ < 6000) {
      const i = Math.floor(Math.random() * count);
      const side = Math.random() < 0.75 ? 1 : -1;
      const off = halfW + 9 + Math.random() * 26;
      const sx = px[i] + nx[i] * off * side, sz = pz[i] + nz[i] * off * side;
      if (sx < maxX + 20) continue; // keep palms near the sea side
      spots.push({ x: sx, z: sz, s: 0.8 + Math.random() * 0.7 });
    }
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, spots.length);
    const crowns = new THREE.InstancedMesh(crownG, crownM, spots.length);
    const d = new THREE.Object3D();
    spots.forEach((p, k) => {
      d.position.set(p.x, 3.5 * p.s - 0.8, p.z); d.scale.setScalar(p.s); d.rotation.y = Math.random() * 6.28;
      d.updateMatrix(); trunks.setMatrixAt(k, d.matrix);
      d.position.set(p.x, (7 + 2.2) * p.s - 0.8, p.z); d.updateMatrix(); crowns.setMatrixAt(k, d.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    group.add(trunks, crowns);
  }

  // grandstands near main straight
  {
    const standMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.9 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2456a8, roughness: 0.9 });
    const roofTex = makeCanvas(128, 32, (c) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#c8102e' : '#ffffff'; c.fillRect(i * 16, 0, 16, 32); }
    });
    const roofMat = new THREE.MeshStandardMaterial({ ...(roofTex ? { map: roofTex } : {}), roughness: 0.8, side: THREE.DoubleSide });
    if (!roofTex) roofMat.color.set(0xc8102e);
    for (let gI = 0; gI < 4; gI++) {
      const s = 60 + gI * 110;
      const i = Math.floor(s / ds) % count;
      const gx = px[i] + nx[i] * (halfW + 26), gz = pz[i] + nz[i] * (halfW + 26);
      const stand = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(34, 6, 14), standMat);
      base.position.y = 3; stand.add(base);
      for (let rI = 0; rI < 3; rI++) {
        const row = new THREE.Mesh(new THREE.BoxGeometry(34, 1.2, 3.4), seatMat);
        row.position.set(0, 7.2 + rI * 1.6, -4 + rI * 3.2);
        stand.add(row);
      }
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(36, 16), roofMat);
      roof.position.set(0, 14, 1); roof.rotation.x = 0.28;
      stand.add(roof);
      for (const px2 of [-15, 15]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 14, 6), standMat);
        pole.position.set(px2, 7, 1); stand.add(pole);
      }
      stand.position.set(gx, py[i], gz);
      stand.rotation.y = Math.atan2(tx[i], tz[i]) + Math.PI / 2;
      stand.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      group.add(stand);
    }
  }

  // start gantry
  {
    const banTex = makeCanvas(512, 64, (c) => {
      c.fillStyle = '#101418'; c.fillRect(0, 0, 512, 64);
      c.fillStyle = '#00e5ff'; c.font = 'bold 34px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('GRIDLINE  •  COSTA VERDE', 256, 34);
    });
    const g = new THREE.Group();
    const postM = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.7, metalness: 0.4 });
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 8), postM);
      post.position.set(side * (halfW + 2.5), 4.5, 0);
      post.castShadow = true;
      g.add(post);
    }
    const ban = new THREE.Mesh(
      new THREE.BoxGeometry((halfW + 2.5) * 2, 2.2, 0.5),
      new THREE.MeshStandardMaterial({ ...(banTex ? { map: banTex } : {}), roughness: 0.8 })
    );
    ban.position.y = 8.2;
    g.add(ban);
    const si = Math.floor(t.startS / ds) % count;
    g.position.set(px[si], py[si], pz[si]);
    g.rotation.y = Math.atan2(tx[si], tz[si]);
    group.add(g);
  }

  // DET board (detection point before the longest straight)
  {
    const detTex = makeCanvas(128, 128, (c) => {
      c.fillStyle = '#f7b500'; c.fillRect(0, 0, 128, 128);
      c.fillStyle = '#111'; c.font = 'bold 56px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('DET', 64, 68);
    });
    const di = Math.floor(t.detS / ds) % count;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshStandardMaterial({ ...(detTex ? { map: detTex } : {}), side: THREE.DoubleSide, roughness: 0.8 })
    );
    if (!detTex) (board.material as THREE.MeshStandardMaterial).color.set(0xf7b500);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 6), new THREE.MeshStandardMaterial({ color: 0x30343a }));
    pole.position.y = -5;
    const grp = new THREE.Group();
    grp.add(board, pole);
    grp.position.set(px[di] + nx[di] * (halfW + 4), py[di] + 7, pz[di] + nz[di] * (halfW + 4));
    grp.rotation.y = Math.atan2(tx[di], tz[di]) - Math.PI / 2;
    group.add(grp);
  }

  // pit lane visual (parallel strip on main straight, right side)
  {
    const P: number[] = [], IX: number[] = [];
    const s0 = 40, s1 = 340;
    let vi = 0;
    for (let s = s0; s <= s1; s += ds) {
      const i = Math.floor(s / ds) % count;
      const d0 = -(halfW + 2), d1 = -(halfW + 9);
      P.push(px[i] + nx[i] * d0, py[i] + 0.02, pz[i] + nz[i] * d0);
      P.push(px[i] + nx[i] * d1, py[i] + 0.02, pz[i] + nz[i] * d1);
      if (vi > 0) { const a = vi - 2; IX.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      vi += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.computeVertexNormals();
    g.setIndex(IX);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 1 }));
    m.receiveShadow = true;
    group.add(m);
    // pit boxes
    const boxM = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 });
    for (let bI = 0; bI < 8; bI++) {
      const s = 70 + bI * 32;
      const i = Math.floor(s / ds) % count;
      const box = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6), boxM);
      const d = -(halfW + 13);
      box.position.set(px[i] + nx[i] * d, py[i] + 2, pz[i] + nz[i] * d);
      box.rotation.y = Math.atan2(tx[i], tz[i]);
      group.add(box);
    }
  }

  // ---------- minimap ----------
  let minimap: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    minimap = document.createElement('canvas');
    minimap.width = 200; minimap.height = 200;
    const c = minimap.getContext('2d')!;
    const pad = 14;
    const w = 200 - pad * 2, hh = 200 - pad * 2;
    const sx = w / (maxX - minX), sz = hh / (maxZ - minZ);
    const sc = Math.min(sx, sz);
    c.strokeStyle = '#ffffff'; c.lineWidth = 5; c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i <= count; i += 4) {
      const j = i % count;
      const X = pad + (px[j] - minX) * sc + (w - (maxX - minX) * sc) / 2;
      const Y = pad + (pz[j] - minZ) * sc + (hh - (maxZ - minZ) * sc) / 2;
      if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
    }
    c.closePath(); c.stroke();
    // store transform for HUD dots
    (minimap as unknown as { _t: number[] })._t = [pad, sc, minX, minZ, w, maxX, hh, maxZ];
  }
  return minimap;
}
