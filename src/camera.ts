// Chase / cockpit / far-TV cameras with look-back.

import * as THREE from 'three';
import { Vehicle } from './vehicle';
import { TrackData } from './track';

export type CamMode = 'chase' | 'cockpit' | 'tv';

export class Cameras {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'chase';
  private tvSpots: { s: number; pos: THREE.Vector3 }[] = [];
  private tvIdx = 0;
  private tvTimer = 0;
  private cur = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.3, 4000);
  }

  buildTvSpots(track: TrackData) {
    this.tvSpots = [];
    const v = new THREE.Vector3();
    for (let s = 0; s < track.length; s += 420) {
      const i = track.idx(s);
      const side = (Math.floor(s / 420) % 2 === 0) ? 1 : -1;
      track.posAt(s, side * 26, v);
      this.tvSpots.push({ s, pos: new THREE.Vector3(v.x, track.heightAt(s) + 9, v.z) });
    }
  }

  cycle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : this.mode === 'cockpit' ? 'tv' : 'chase';
  }

  update(dt: number, car: Vehicle, track: TrackData, lookback: boolean) {
    const cam = this.camera;
    const p = car.group.position;
    const yaw = track.yawAt(car.s);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);

    if (this.mode === 'cockpit') {
      this.cur.set(p.x + fx * 0.5, p.y + 1.12, p.z + fz * 0.5);
      this.look.set(p.x + fx * 40, p.y + 0.8, p.z + fz * 40);
      if (lookback) this.look.set(p.x - fx * 40, p.y + 1, p.z - fz * 40);
      cam.position.lerp(this.cur, Math.min(1, dt * 30));
      cam.lookAt(this.look);
      this.initialized = true;
      return;
    }

    if (this.mode === 'tv' && this.tvSpots.length) {
      this.tvTimer -= dt;
      // advance to the next spot ahead of the car
      let best = this.tvIdx, bestD = Infinity;
      for (let k = 0; k < this.tvSpots.length; k++) {
        const ds = (this.tvSpots[k].s - car.s + track.length) % track.length;
        if (ds < bestD) { bestD = ds; best = k; }
      }
      if (best !== this.tvIdx || this.tvTimer <= 0) {
        this.tvIdx = best; this.tvTimer = 7;
      }
      const spot = this.tvSpots[this.tvIdx];
      cam.position.lerp(spot.pos, Math.min(1, dt * 3));
      cam.lookAt(p.x, p.y + 1, p.z);
      this.initialized = true;
      return;
    }

    // chase
    const back = lookback ? -1 : 1;
    this.cur.set(p.x - fx * 9.2 * back, p.y + 3.4, p.z - fz * 9.2 * back);
    this.look.set(p.x + fx * 7 * back, p.y + 1.0, p.z + fz * 7 * back);
    if (!this.initialized) { cam.position.copy(this.cur); this.initialized = true; }
    else cam.position.lerp(this.cur, Math.min(1, dt * 7));
    cam.lookAt(this.look);
  }

  onResize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
