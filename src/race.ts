// Race state machine: grid, start lights, laps, sectors, timing, delta,
// DET/overtake arming, positions/gaps, time-trial ghost.

import * as THREE from 'three';
import { Vehicle, VehicleInput } from './vehicle';
import { AIController } from './ai';
import { TrackData } from './track';
import { buildCar, CarRig } from './car';
import {
  LIVERIES, QUICK_RACE_LAPS, GRID_SIZE, OT_GAP_ARM, FALSE_START_PENALTY,
  TYRES, TyreCompound, Difficulty,
} from './config';

export type RaceMode = 'quick' | 'timetrial';
export type RacePhase = 'lights' | 'run' | 'finished';

export interface RaceOpts {
  mode: RaceMode;
  liveryIndex: number;
  tyre: TyreCompound;
  difficulty: Difficulty;
}

interface CarTiming {
  completedLaps: number;
  started: boolean; // crossed the start line once (lap timing begins)
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  sector: number;
  sectorStart: number;
  lastSectors: (number | null)[];
  bestSectors: (number | null)[];
  delta: number | null;
  armOTNext: boolean;
  prevS: number;
  falseStart: boolean;
  penalty: number;
  traceS: number[]; // current-lap trace for delta/ghost (20 Hz)
  traceD: number[];
  bestTraceS: number[] | null;
  bestTraceD: number[] | null;
  bestTraceT: number; // lap time of best trace
}

interface Ghost {
  rig: CarRig;
  s: number[];
  d: number[];
  lapTime: number;
  t: number;
}

export class Race {
  mode: RaceMode;
  vehicles: Vehicle[] = [];
  ais: (AIController | null)[] = [];
  timings: CarTiming[] = [];
  phase: RacePhase = 'lights';
  time = 0;
  laps = QUICK_RACE_LAPS;
  playerIdx = 0;
  events: string[] = [];
  lightCount = 0;
  lightsOut = false;
  ghost: Ghost | null = null;
  playerFinished = false;
  results: { vehicle: Vehicle; best: number | null; gap: number }[] = [];

  private track: TrackData;
  private scene: THREE.Scene;
  private lightTimer = 0;
  private lightNext = 0.6;
  private outTimer = -1;
  private traceTimer = 0;
  private deltaTimer = 0;

  constructor(scene: THREE.Scene, track: TrackData, opts: RaceOpts) {
    this.scene = scene; this.track = track; this.mode = opts.mode;
    const aiCount = opts.mode === 'quick' ? GRID_SIZE - 1 : 0;

    // liveries: player picks, AI get the rest in order
    const order = [opts.liveryIndex, ...LIVERIES.map((_, i) => i).filter((i) => i !== opts.liveryIndex)];

    for (let k = 0; k < aiCount + 1; k++) {
      const isPlayer = k === 0;
      const rig = buildCar(LIVERIES[order[k]]);
      scene.add(rig.group);
      const v = new Vehicle(track, rig, order[k], k, isPlayer, opts.tyre);
      // grid: player starts P8 (last). slot p -> s behind the start line
      const slot = isPlayer ? GRID_SIZE - 1 : k - 1;
      const s = track.startS - 16 - slot * 9;
      v.resetToTrack(s, slot % 2 === 0 ? 2.3 : -2.3, 0);
      this.vehicles.push(v);
      this.timings.push({
        completedLaps: 0, started: false, lapStart: 0, lastLap: null, bestLap: null,
        sector: 0, sectorStart: 0, lastSectors: [null, null, null], bestSectors: [null, null, null],
        delta: null, armOTNext: false, prevS: s, falseStart: false, penalty: 0,
        traceS: [], traceD: [], bestTraceS: null, bestTraceD: null, bestTraceT: 0,
      });
      this.ais.push(isPlayer ? null : new AIController(v, track, opts.difficulty, k, track.length * this.laps));
    }

    if (opts.mode === 'timetrial') {
      const rig = buildCar(LIVERIES[order[0]], { ghost: true });
      rig.group.visible = false;
      scene.add(rig.group);
      this.ghost = { rig, s: [], d: [], lapTime: 0, t: 0 };
    }
  }

  get player(): Vehicle { return this.vehicles[this.playerIdx]; }
  get playerTiming(): CarTiming { return this.timings[this.playerIdx]; }

  dispose() {
    for (const v of this.vehicles) this.scene.remove(v.group);
    if (this.ghost) this.scene.remove(this.ghost.rig.group);
  }

  /** progress used for ordering: completed laps, then s */
  private progress(k: number): number {
    return this.timings[k].completedLaps * this.track.length + this.vehicles[k].s;
  }

  order(): number[] {
    return this.vehicles.map((_, k) => k).sort((a, b) => this.progress(b) - this.progress(a));
  }

  playerPos(): number { return this.order().indexOf(this.playerIdx) + 1; }

  /** gap (s) to car ahead and behind the player */
  playerGaps(): { ahead: number | null; behind: number | null } {
    const o = this.order();
    const at = o.indexOf(this.playerIdx);
    const gap = (a: number, b: number) => {
      const ds = this.progress(a) - this.progress(b);
      return Math.max(0, ds / Math.max(22, this.vehicles[b].v));
    };
    return {
      ahead: at > 0 ? gap(o[at - 1], o[at]) : null,
      behind: at < o.length - 1 ? gap(o[at], o[at + 1]) : null,
    };
  }

  resetPlayer() {
    const p = this.player;
    p.resetToTrack(p.s, 0, 14);
  }

  update(dt: number, playerInput: VehicleInput) {
    const t = this.track;
    if (this.phase === 'lights') {
      // start lights sequence
      if (playerInput.throttle > 0.2 && !this.timings[this.playerIdx].falseStart) {
        this.timings[this.playerIdx].falseStart = true;
        this.timings[this.playerIdx].penalty = FALSE_START_PENALTY;
        this.events.push('FALSE_START');
      }
      this.lightTimer += dt;
      if (!this.lightsOut && this.lightCount < 5 && this.lightTimer >= this.lightNext) {
        this.lightCount++;
        this.lightTimer = 0;
        this.lightNext = 0.45 + Math.random() * 0.4;
        if (this.lightCount === 5) this.outTimer = 0.35 + Math.random() * 0.9;
      }
      if (this.outTimer > 0) {
        this.outTimer -= dt;
        if (this.outTimer <= 0) {
          this.lightsOut = true;
          this.phase = 'run';
          this.time = 0;
          for (const tm of this.timings) { tm.lapStart = 0; tm.sectorStart = 0; }
          this.events.push('LIGHTS_OUT');
        }
      }
      return;
    }
    if (this.phase === 'finished') return;

    this.time += dt;

    // step vehicles
    for (let k = 0; k < this.vehicles.length; k++) {
      const v = this.vehicles[k];
      const tm = this.timings[k];
      tm.prevS = v.s;
      const input = k === this.playerIdx ? playerInput : this.ais[k]!.step(dt, this.vehicles);
      v.step(dt, input);
      v.autoShift();
      this.checkCrossings(k, tm);
    }
    Vehicle.resolveCollisions(this.vehicles, t);

    // player trace (20 Hz) for delta + ghost
    this.traceTimer -= dt;
    if (this.traceTimer <= 0) {
      this.traceTimer = 0.05;
      const p = this.player, tm = this.playerTiming;
      tm.traceS.push(p.s); tm.traceD.push(p.d);
    }
    // delta at 5 Hz
    this.deltaTimer -= dt;
    if (this.deltaTimer <= 0) {
      this.deltaTimer = 0.2;
      this.updateDelta();
    }
    // ghost replay
    if (this.ghost && this.ghost.s.length > 1) {
      const g = this.ghost;
      g.t += dt;
      if (g.t < g.lapTime) {
        const f = (g.t / g.lapTime) * (g.s.length - 1);
        const i0 = Math.floor(f), i1 = Math.min(g.s.length - 1, i0 + 1), fr = f - i0;
        const gs = g.s[i0] + (g.s[i1] - g.s[i0]) * fr;
        const gd = g.d[i0] + (g.d[i1] - g.d[i0]) * fr;
        t.posAt(gs, gd, g.rig.group.position);
        g.rig.group.position.y = t.heightAt(gs) + 0.06;
        g.rig.group.rotation.y = t.yawAt(gs);
        g.rig.group.visible = true;
      } else g.rig.group.visible = false;
    }
  }

  private crossed(tm: CarTiming, v: Vehicle, point: number): boolean {
    return tm.prevS < point && v.s >= point && v.s - tm.prevS < this.track.length / 2;
  }

  private checkCrossings(k: number, tm: CarTiming) {
    const t = this.track, v = this.vehicles[k];
    // DET detection
    if (this.crossed(tm, v, t.detS)) {
      const gap = this.gapToAhead(k);
      if (gap != null && gap < OT_GAP_ARM) {
        tm.armOTNext = true;
        if (k === this.playerIdx) this.events.push('OT_ARMED');
      }
    }
    // sector boundaries
    const sec = t.sector[t.idx(v.s)];
    if (sec !== tm.sector) {
      const dur = this.time - tm.sectorStart;
      tm.lastSectors[tm.sector] = dur;
      if (tm.bestSectors[tm.sector] == null || dur < tm.bestSectors[tm.sector]!) tm.bestSectors[tm.sector] = dur;
      tm.sector = sec; tm.sectorStart = this.time;
      if (k === this.playerIdx) this.events.push('SECTOR');
    }
    // start/finish line -> lap complete (first crossing only starts timing)
    if (this.crossed(tm, v, t.startS)) {
      if (!tm.started) {
        tm.started = true;
        tm.lapStart = this.time;
        tm.sectorStart = this.time;
        tm.sector = 0;
        tm.traceS = []; tm.traceD = [];
        v.otArmed = tm.armOTNext;
        tm.armOTNext = false;
        return;
      }
      const lapTime = this.time - tm.lapStart;
      tm.lapStart = this.time;
      tm.completedLaps++;
      tm.lastLap = lapTime;
      // final sector (sector 2 -> line)
      tm.lastSectors[2] = this.time - tm.sectorStart;
      if (tm.bestSectors[2] == null || tm.lastSectors[2]! < tm.bestSectors[2]!) tm.bestSectors[2] = tm.lastSectors[2];
      tm.sector = 0; tm.sectorStart = this.time;
      if (tm.bestLap == null || lapTime < tm.bestLap) {
        tm.bestLap = lapTime;
        if (k === this.playerIdx) {
          this.events.push('BEST_LAP');
          tm.bestTraceS = tm.traceS.slice(); tm.bestTraceD = tm.traceD.slice();
          tm.bestTraceT = lapTime;
          if (this.ghost) {
            this.ghost.s = tm.traceS.slice(); this.ghost.d = tm.traceD.slice();
            this.ghost.lapTime = lapTime; this.ghost.t = 0;
          }
        }
      }
      tm.traceS = []; tm.traceD = [];
      // tyre wear
      v.wear = Math.min(0.14, v.wear + TYRES[v.tyre].wearPerLap);
      // overtake: armed at DET becomes live for this lap only
      v.otArmed = tm.armOTNext;
      tm.armOTNext = false;
      if (k === this.playerIdx) {
        this.events.push('LAP');
        if (this.mode === 'quick' && tm.completedLaps >= this.laps) this.finishRace();
      }
    }
  }

  private gapToAhead(k: number): number | null {
    const o = this.order();
    const at = o.indexOf(k);
    if (at <= 0) return null;
    const ahead = o[at - 1];
    const ds = this.progress(ahead) - this.progress(k);
    return Math.max(0, ds / Math.max(22, this.vehicles[ahead].v));
  }

  private updateDelta() {
    const tm = this.playerTiming, p = this.player;
    if (!tm.bestTraceS || tm.bestTraceS.length < 4) { tm.delta = null; return; }
    // find best-lap time at the player's current s (trace is monotonic in s)
    const bs = tm.bestTraceS;
    const lapT = this.time - tm.lapStart;
    // binary search for first index with s >= p.s
    let lo = 0, hi = bs.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bs[mid] < p.s) lo = mid + 1; else hi = mid; }
    const frac = lo / Math.max(1, bs.length - 1);
    const tBest = frac * tm.bestTraceT;
    tm.delta = lapT - tBest;
  }

  private finishRace() {
    this.phase = 'finished';
    this.playerFinished = true;
    const o = this.order();
    this.results = o.map((k, i) => {
      const tm = this.timings[k];
      const gap = i === 0 ? 0 : (this.progress(o[0]) - this.progress(k)) / Math.max(22, this.vehicles[k].v);
      return { vehicle: this.vehicles[k], best: tm.bestLap, gap: gap + (k === this.playerIdx ? tm.penalty : 0) };
    });
    this.events.push('FINISH');
  }

  /** time-trial: end session and show best laps */
  endTimeTrial() {
    this.phase = 'finished';
    this.results = [{ vehicle: this.player, best: this.playerTiming.bestLap, gap: 0 }];
    this.events.push('FINISH');
  }
}
