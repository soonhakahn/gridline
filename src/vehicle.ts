// Arcade-sim vehicle model on the track ribbon.
// State lives in track space (s = distance along lap, d = lateral offset)
// so the car can never leave the track or fall through the floor.
// Fixed 60 Hz step. All 2026-style systems (active aero, battery, boost,
// overtake taper) are real forces here, not HUD text.

import * as THREE from 'three';
import {
  SIM_DT, CAR_MASS, ENGINE_FORCE, GEAR_RATIOS, RPM_IDLE, RPM_MAX, RPM_SHIFT,
  AERO, FRONTAL_AREA, AIR_DENSITY, ROLL_RESIST,
  BATTERY_MAX, DEPLOY_RATE, DEPLOY_GAIN, DEPLOY_MIN_SPEED,
  DEPLOY_TAPER_START, HARVEST_RATE, BOOST_DRAIN, BOOST_DRAIN_OT, BOOST_GAIN,
  TYRES, TyreCompound, LAT_BASE, LAT_REF, LAT_DF, SLIDE_SCRUB,
  CAR_RADIUS, WALL_SCRUB, CAR_HALF_W,
} from './config';
import { TrackData } from './track';
import { CarRig } from './car';

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
  boost: boolean;
  aeroToggle: boolean; // edge: pressed this step
}

const GEAR_TOP_KMH = [95, 125, 160, 200, 240, 280, 315, 350];
const GEAR_TOP = GEAR_TOP_KMH.map((k) => (k / 3.6));

export class Vehicle {
  index: number;
  liveryIndex: number;
  isPlayer: boolean;
  track: TrackData;
  rig: CarRig;
  group: THREE.Group;

  // dynamic state
  s = 0; d = 0; v = 0;
  latV = 0; // lateral velocity (m/s) for steering feel
  gear = 1; rpm = RPM_IDLE; manualTimer = 0;
  battery = BATTERY_MAX;
  aero: 'CM' | 'SM' = 'CM';
  aeroPinned = false; // when true: skip auto open/close + manual toggle (tests)
  wingOpen = 0; // visual 0..1
  smTimer = 0;
  tyre: TyreCompound = 'medium';
  wear = 0; // 0..1 fraction of grip lost
  otArmed = false;
  slip = 0; // visual 0..1
  deploy01 = 0; // for audio: current deployment level
  throttle01 = 0;
  lap = 0; // completed laps
  distTotal = 0; // total distance for position sorting
  finished = false;
  wallHit = 0; // visual timer

  private bob = 0;

  constructor(track: TrackData, rig: CarRig, liveryIndex: number, index: number, isPlayer: boolean, tyre: TyreCompound) {
    this.track = track; this.rig = rig; this.group = rig.group;
    this.liveryIndex = liveryIndex; this.index = index; this.isPlayer = isPlayer;
    this.tyre = tyre;
  }

  resetToTrack(s: number, d: number, v = 0) {
    this.s = s; this.d = d; this.v = v; this.latV = 0;
    this.updateVisual(0);
  }

  get tyreGrip(): number {
    return TYRES[this.tyre].grip * (1 - this.wear);
  }

  /** deployment taper factor: 1 = full deployment.
   *  Tapers from 290 km/h down to a 0.30 floor at ~320 km/h, so the battery
   *  still matters on the straight but can't push the car past the drag limit.
   *  Overtake delays full deployment to ~335 km/h. */
  private taperFactor(): number {
    const v = this.v;
    if (this.otArmed) {
      if (v <= 93.1) return 1;
      return Math.max(0.3, 1 - ((v - 93.1) / 6.9) * 0.7);
    }
    if (v <= DEPLOY_TAPER_START) return 1;
    return Math.max(0.3, 1 - ((v - DEPLOY_TAPER_START) / 8.3) * 0.7);
  }

  step(dt: number, input: VehicleInput) {
    const t = this.track;
    const i = t.idx(this.s);
    const inSM = t.zone[i] === 1;

    // ---- active aero ----
    if (!this.aeroPinned) {
      if (input.aeroToggle && inSM) this.aero = this.aero === 'SM' ? 'CM' : 'SM';
      if (inSM) {
        this.smTimer += dt;
        if (this.smTimer > 0.3 && this.aero === 'CM') this.aero = 'SM'; // auto-open
      } else {
        this.smTimer = 0;
        if (this.aero === 'SM') this.aero = 'CM'; // auto-close on exit
      }
    }
    const aeroCfg = AERO[this.aero];
    const wingTarget = this.aero === 'SM' ? 1 : 0;
    // wing animates in well under 150 ms
    this.wingOpen += Math.max(-1, Math.min(1, (wingTarget - this.wingOpen))) * Math.min(1, dt / 0.12);

    // ---- gears ----
    this.manualTimer = Math.max(0, this.manualTimer - dt);
    const vTop = GEAR_TOP[this.gear - 1];
    const rpmFrac = Math.max(0, Math.min(1.05, this.v / vTop));
    this.rpm = RPM_IDLE + rpmFrac * (RPM_MAX - RPM_IDLE);
    // (manual override handled by caller via setGear)

    // ---- longitudinal forces ----
    const ratio = GEAR_RATIOS[this.gear - 1] / GEAR_RATIOS[0];
    const torqueCurve = 1 - 0.25 * Math.max(0, (rpmFrac - 0.85) / 0.15);
    let F = input.throttle * ENGINE_FORCE * ratio * Math.max(0.35, torqueCurve);
    // traction cap at low speed (arcade)
    const maxLaunchA = 17;
    F = Math.min(F, CAR_MASS * maxLaunchA + this.dragForce() + this.rollForce());

    // battery deployment: about half the >160 km/h acceleration
    const taper = this.taperFactor();
    let deploy = 0;
    if (this.v > DEPLOY_MIN_SPEED && this.battery > 0 && input.throttle > 0.05) {
      const want = DEPLOY_RATE * taper * input.throttle;
      const actual = Math.min(want, this.battery / dt);
      this.battery -= actual * dt;
      deploy = actual;
      F += actual * DEPLOY_GAIN;
    }
    // boost: extra deployment anywhere, drains fast
    let boosting = false;
    if (input.boost && this.battery > 0) {
      const drain = (this.otArmed ? BOOST_DRAIN_OT : BOOST_DRAIN) * taper;
      const actual = Math.min(drain, this.battery / dt);
      this.battery -= actual * dt;
      F += BOOST_GAIN * taper * Math.min(1, actual / Math.max(1, drain));
      boosting = actual > 0.5;
    }
    // harvest under braking
    if (input.brake > 0.05) {
      this.battery = Math.min(BATTERY_MAX, this.battery + HARVEST_RATE * input.brake * Math.min(1, this.v / 40) * dt);
    }
    this.deploy01 = Math.max(deploy / DEPLOY_RATE, boosting ? 0.7 : 0);
    this.throttle01 = input.throttle;

    // drag + rolling
    F -= this.dragForce() * aeroCfg.drag / AERO.CM.drag;
    F -= this.rollForce();
    // brakes
    F -= input.brake * 24000 * Math.min(1, this.v / 8 + 0.25);

    let a = F / CAR_MASS;
    this.v = Math.max(0, this.v + a * dt);

    // ---- steering (lateral) ----
    const steerRate = Math.max(7, 30 - this.v * 0.2);
    const latTarget = input.steer * steerRate * this.tyreGrip;
    this.latV += (latTarget - this.latV) * Math.min(1, dt * 7);
    this.d += this.latV * dt;

    // ---- grip limit vs corner curvature ----
    const k = t.k[i];
    const aReq = this.v * this.v * Math.abs(k);
    const downforce = LAT_BASE + (this.v / LAT_REF) ** 2 * LAT_DF * aeroCfg.downforce;
    const aAvail = downforce * this.tyreGrip * aeroCfg.grip;
    this.slip = 0;
    if (aReq > aAvail && this.v > 8) {
      const sev = (aReq - aAvail) / aAvail;
      this.v = Math.max(0, this.v - Math.min(this.v * 0.6, SLIDE_SCRUB * (1 + sev)) * dt);
      // understeer: drift toward the outside of the corner (outside = +sign(k) along the normal)
      this.d += Math.sign(k) * sev * 7 * dt;
      this.slip = Math.min(1, sev * 1.4);
    }
    // high-speed steering scrub
    if (Math.abs(this.latV) > 14 && this.v > 60) {
      this.v = Math.max(0, this.v - 2.2 * dt);
      this.slip = Math.max(this.slip, 0.35);
    }

    // ---- walls: invisible colliders, clamp + scrub ----
    const maxD = t.halfW - CAR_HALF_W - 0.15;
    if (Math.abs(this.d) > maxD) {
      this.d = Math.sign(this.d) * maxD;
      this.v *= Math.max(0, 1 - WALL_SCRUB * dt);
      this.latV *= 0.3;
      this.wallHit = 0.4;
    }
    this.wallHit = Math.max(0, this.wallHit - dt);

    // ---- advance ----
    const prevS = this.s;
    this.s += this.v * dt;
    if (this.s >= t.length) this.s -= t.length;
    if (this.s < 0) this.s += t.length;
    this.distTotal += this.v * dt;
    this.bob += dt * (2 + this.v * 0.12);

    // lap counting across start line
    void prevS;
  }

  /** call after step for all vehicles: push cars apart (analytic circles) */
  static resolveCollisions(vehicles: Vehicle[], track: TrackData) {
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    for (let a = 0; a < vehicles.length; a++) {
      for (let b = a + 1; b < vehicles.length; b++) {
        const A = vehicles[a], B = vehicles[b];
        track.posAt(A.s, A.d, pa); track.posAt(B.s, B.d, pb);
        const dx = pa.x - pb.x, dz = pa.z - pb.z;
        const dist = Math.hypot(dx, dz);
        const minD = CAR_RADIUS * 2;
        if (dist < minD && dist > 1e-4) {
          const push = (minD - dist) / 2;
          const nx = dx / dist, nz = dz / dist;
          // project onto each car's frame and nudge s/d
          for (const [car, sgn] of [[A, 1], [B, -1]] as const) {
            const ti = track.idx(car.s);
            const tx = track.tx[ti], tz = track.tz[ti];
            const ox = track.nx[ti], oz = track.nz[ti];
            const along = (nx * sgn) * tx + (nz * sgn) * tz;
            const side = (nx * sgn) * ox + (nz * sgn) * oz;
            car.s = (car.s + along * push + track.length) % track.length;
            car.d = Math.max(-(track.halfW - 1), Math.min(track.halfW - 1, car.d + side * push));
          }
          // scrub a little speed from both (no explosions, no flips)
          const avg = (A.v + B.v) / 2;
          A.v = avg + (A.v - avg) * 0.82;
          B.v = avg + (B.v - avg) * 0.82;
        }
      }
    }
  }

  setGear(g: number) {
    this.gear = Math.max(1, Math.min(8, g));
    this.manualTimer = 5; // auto resumes after 5 s
  }

  autoShift() {
    if (this.manualTimer > 0) return;
    if (this.rpm > RPM_SHIFT && this.gear < 8) this.gear++;
    else if (this.rpm < RPM_IDLE * 1.15 && this.gear > 1) this.gear--;
  }

  private dragForce(): number {
    return 0.5 * AIR_DENSITY * FRONTAL_AREA * this.v * this.v;
  }
  private rollForce(): number {
    return ROLL_RESIST * CAR_MASS * 9.81 * Math.sign(this.v);
  }

  updateVisual(dt: number) {
    const t = this.track;
    t.posAt(this.s, this.d, this.group.position);
    this.group.position.y = t.heightAt(this.s) + 0.06 + Math.sin(this.bob * 3) * 0.008 * Math.min(1, this.v / 30);
    const yaw = t.yawAt(this.s);
    const slipAng = Math.atan2(this.latV, Math.max(8, this.v)) * 0.7;
    this.group.rotation.y = yaw + slipAng;
    this.group.rotation.z = -this.latV * 0.004; // lean
    // wheels
    const spin = (this.v * dt) / 0.34;
    for (const w of this.rig.wheels) w.rotation.x += spin;
    // front wheel steer visual
    for (let wi = 0; wi < 2; wi++) {
      const holder = (this.rig.wheels[wi] as unknown as { _steer: THREE.Group })._steer;
      if (holder) holder.rotation.y = this.latV * 0.012;
    }
    this.rig.setWingAngle(this.wingOpen);
    // wall hit shake
    if (this.wallHit > 0) {
      this.group.position.x += (Math.random() - 0.5) * 0.06 * this.wallHit;
    }
  }
}

// cross-check helper used by simtest: trap speed on a straight
export function straightLineTest(track: TrackData, rig: CarRig, opts: { aero: 'CM' | 'SM'; boost: boolean; battery: number; seconds: number; keepFull?: boolean }): number {
  const v = new Vehicle(track, rig, 0, 0, false, 'medium');
  v.resetToTrack(50, 0, 0);
  v.aero = opts.aero;
  v.aeroPinned = true; // hold the aero mode for the whole run
  const dt = SIM_DT;
  const steps = Math.floor(opts.seconds / dt);
  let top = 0;
  for (let i = 0; i < steps; i++) {
    if (opts.keepFull) v.battery = 100; else if (i === 0) v.battery = opts.battery;
    v.step(dt, { throttle: 1, brake: 0, steer: 0, boost: opts.boost, aeroToggle: false });
    v.autoShift();
    top = Math.max(top, v.v);
  }
  return top;
}
