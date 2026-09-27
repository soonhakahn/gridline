// Skid smoke: a small pooled particle system (THREE.Points).

import * as THREE from 'three';

const MAX = 260;

export class SmokeSystem {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array; // remaining
  private maxLife: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, quality: 'low' | 'high') {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -100;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));

    let tex: THREE.Texture | null = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d')!;
      const g = c.createRadialGradient(32, 32, 4, 32, 32, 30);
      g.addColorStop(0, 'rgba(220,220,220,0.55)');
      g.addColorStop(1, 'rgba(220,220,220,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      tex = new THREE.CanvasTexture(cv);
    }
    const mat = new THREE.PointsMaterial({
      size: quality === 'high' ? 2.6 : 1.8,
      ...(tex ? { map: tex } : {}),
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
      color: 0xdddddd,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }

  spawn(x: number, y: number, z: number, strength: number) {
    const n = Math.min(4, 1 + Math.floor(strength * 3));
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.8;
      this.pos[i * 3 + 1] = y + Math.random() * 0.4;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
      this.vel[i * 3] = (Math.random() - 0.5) * 2;
      this.vel[i * 3 + 1] = 1.2 + Math.random() * 1.6;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 2;
      this.life[i] = this.maxLife[i] = 0.7 + Math.random() * 0.6;
    }
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -100; continue; }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] *= 1 - dt * 0.6;
    }
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}
