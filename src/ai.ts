// AI drivers: follow the racing line with per-corner speed targets,
// schedule 1-2 mistakes per race, defend on straights, and use the same
// battery/boost/overtake rules as the player. No rubber-banding.

import { Vehicle, VehicleInput } from './vehicle';
import { TrackData } from './track';
import { Difficulty, DIFFICULTY, DEFEND_GAP } from './config';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Mistake { atDist: number; type: 'lockup' | 'wide'; dur: number }

export class AIController {
  vehicle: Vehicle;
  track: TrackData;
  pace: number;
  mistakes: Mistake[] = [];
  private mistIdx = 0;
  private mistT = 0;
  private mistType: 'lockup' | 'wide' | null = null;
  private defendOffset = 0;
  private lineBias: number;
  private rand: () => number;

  constructor(vehicle: Vehicle, track: TrackData, difficulty: Difficulty, seed: number, raceDist: number) {
    this.vehicle = vehicle;
    this.track = track;
    const d = DIFFICULTY[difficulty];
    this.rand = mulberry32(seed * 7919 + 13);
    // per-driver pace spread so the field isn't identical
    this.pace = d.pace * (0.985 + this.rand() * 0.03);
    this.lineBias = (this.rand() - 0.5) * 1.2;
    // schedule mistakes across the race distance (1-2 on normal, more on easy)
    const [lo, hi] = d.mistakePerRace;
    const n = lo + Math.floor(this.rand() * (hi - lo + 1));
    for (let m = 0; m < n; m++) {
      this.mistakes.push({
        atDist: raceDist * (0.15 + 0.7 * this.rand()),
        type: this.rand() < 0.5 ? 'lockup' : 'wide',
        dur: 1.1 + this.rand() * 0.8,
      });
    }
    this.mistakes.sort((a, b) => a.atDist - b.atDist);
  }

  /** gap in seconds to the nearest car ahead / behind (track-distance based) */
  private gaps(vehicles: Vehicle[]): { ahead: number; behind: number } {
    const L = this.track.length;
    let ahead = Infinity, behind = Infinity;
    for (const o of vehicles) {
      if (o === this.vehicle) continue;
      let ds = o.s - this.vehicle.s;
      // wrap into [-L/2, L/2)
      ds = ((ds % L) + L * 1.5) % L - L / 2;
      // account for lap differences crudely via distTotal
      const lapDelta = Math.round((o.distTotal - this.vehicle.distTotal) / L);
      const trueDs = ds + lapDelta * L;
      const gap = trueDs / Math.max(22, o.v);
      if (trueDs > 0 && gap < ahead) ahead = gap;
      if (trueDs < 0 && -gap < behind) behind = -gap;
    }
    return { ahead, behind };
  }

  step(dt: number, vehicles: Vehicle[]): VehicleInput {
    const v = this.vehicle, t = this.track;
    const i = t.idx(v.s);

    // trigger scheduled mistakes
    if (this.mistIdx < this.mistakes.length && v.distTotal >= this.mistakes[this.mistIdx].atDist) {
      this.mistType = this.mistakes[this.mistIdx].type;
      this.mistT = this.mistakes[this.mistIdx].dur;
      this.mistIdx++;
    }
    if (this.mistT > 0) this.mistT -= dt; else this.mistType = null;

    // speed target from the precomputed corner profile
    let targetV = t.cornerSpeed[i] * this.pace;
    if (this.mistType === 'lockup') targetV *= 1.14; // brake too late

    let throttle = 0, brake = 0;
    if (v.v < targetV - 0.8) throttle = 1;
    else if (v.v > targetV + 1.2) brake = Math.min(1, (v.v - targetV) / 9);
    else throttle = 0.35;

    // lateral: racing line + personal bias + defense + mistake offset
    const { behind } = this.gaps(vehicles);
    let wantDefend = 0;
    if (behind < DEFEND_GAP && t.zone[i] === 1) {
      // cover the inside of the upcoming corner
      let ka = 0;
      for (let j = 4; j < 40; j += 4) ka += t.k[(i + j) % t.count];
      wantDefend = -Math.sign(ka || 1) * 2.4;
    }
    this.defendOffset += (wantDefend - this.defendOffset) * Math.min(1, dt * 2.5);

    let desiredD = t.raceLine[i] + this.lineBias + this.defendOffset;
    if (this.mistType === 'wide') desiredD += 3.2; // run wide on exit
    desiredD = Math.max(-(t.halfW - 1.6), Math.min(t.halfW - 1.6, desiredD));

    const steerRate = Math.max(7, 30 - v.v * 0.2);
    const steer = Math.max(-1, Math.min(1, ((desiredD - v.d) * 2.4 - v.latV * 0.3) / steerRate));

    // boost to attack on straights when close behind
    const { ahead } = this.gaps(vehicles);
    const boost = t.zone[i] === 1 && ahead < 0.8 && v.battery > 35;

    return { throttle, brake, steer, boost, aeroToggle: false };
  }
}
