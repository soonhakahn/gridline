// Headless acceptance tests: run with `npm run simtest` (tsx).
// No DOM, no renderer — pure sim at fixed 60 Hz.

import * as THREE from 'three';
import { buildTrack } from './track';
import { Vehicle, straightLineTest } from './vehicle';
import { AIController } from './ai';
import { Race } from './race';
import { buildCar } from './car';
import { LIVERIES, SIM_DT, QUICK_RACE_LAPS } from './config';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
  else console.log('  ok:', msg);
}
const kmh = (v: number) => v * 3.6;

console.log('== track ==');
const track = buildTrack();
console.log('  length:', track.length.toFixed(0), 'm, samples:', track.count);
assert(track.length > 5000 && track.length < 5600, `track ~5.2 km (got ${(track.length / 1000).toFixed(2)} km)`);
assert(track.count > 2000, 'dense centerline sampling');

console.log('== straight-line trap speeds ==');
const rigA = buildCar(LIVERIES[0]);
const trapBoost = straightLineTest(track, rigA, { aero: 'SM', boost: true, battery: 100, seconds: 30, keepFull: true });
const trapFull = straightLineTest(track, rigA, { aero: 'SM', boost: false, battery: 100, seconds: 30, keepFull: true });
const trapEmpty = straightLineTest(track, rigA, { aero: 'SM', boost: false, battery: 0, seconds: 30 });
const trapCM = straightLineTest(track, rigA, { aero: 'CM', boost: false, battery: 100, seconds: 30, keepFull: true });
console.log(`  SM+boost ${kmh(trapBoost).toFixed(0)} | SM ${kmh(trapFull).toFixed(0)} | SM empty ${kmh(trapEmpty).toFixed(0)} | CM ${kmh(trapCM).toFixed(0)} km/h`);
assert(trapBoost >= 84, `SM+boost trap near 320 km/h (got ${kmh(trapBoost).toFixed(0)})`);
assert(trapFull - trapEmpty >= 3, `full battery clearly faster than empty (Δ ${(trapFull - trapEmpty).toFixed(1)} m/s)`);
assert(trapFull > trapCM + 1.5, 'Straight Mode faster than Corner Mode on the straight');

console.log('== corner aero behaviour (same entry speed, wings open vs closed) ==');
function cornerMinSpeed(aero: 'CM' | 'SM'): number {
  const vv = new Vehicle(track, buildCar(LIVERIES[1]), 1, 1, false, 'medium');
  vv.aero = aero;
  vv.aeroPinned = true;
  let ci = 0;
  for (let i = 0; i < track.count; i++) if (track.k[i] < -0.008) { ci = i; break; } // T2 (left, r~90)
  const s0 = (ci * track.ds - 300 + track.length) % track.length;
  vv.resetToTrack(s0, track.raceLine[track.idx(s0)], 59); // between SM and CM grip limits
  let minV = 999;
  for (let i = 0; i < 16 * 60; i++) {
    // scripted: full throttle, steer to hold the racing line (no braking)
    const t = track, vi = t.idx(vv.s);
    const desiredD = t.raceLine[vi];
    const steerRate = Math.max(7, 30 - vv.v * 0.2);
    const steer = Math.max(-1, Math.min(1, ((desiredD - vv.d) * 2.4 - vv.latV * 0.3) / steerRate));
    vv.step(SIM_DT, { throttle: 1, brake: 0, steer, boost: false, aeroToggle: false });
    vv.autoShift();
    if (Math.abs(t.k[t.idx(vv.s)]) > 0.007) minV = Math.min(minV, vv.v);
  }
  return minV;
}
const minCM = cornerMinSpeed('CM');
const minSM = cornerMinSpeed('SM');
console.log(`  min corner speed: CM ${kmh(minCM).toFixed(0)} vs SM ${kmh(minSM).toFixed(0)} km/h`);
assert(minSM < minCM - 0.5, 'open wings (SM) are worse in a fast corner');

console.log('== full 5-lap race (8 AI, quick race) ==');
{
  const scene = new THREE.Scene();
  const race = new Race(scene, track, { mode: 'quick', liveryIndex: 0, tyre: 'medium', difficulty: 'normal' });
  const brains = race.vehicles.map((v, k) => new AIController(v, track, 'normal', 100 + k, track.length * QUICK_RACE_LAPS));
  const maxSteps = 60 * 60 * 14; // 14 sim-minutes cap
  let steps = 0;
  const zero = { throttle: 0, brake: 0, steer: 0, boost: false, aeroToggle: false };
  while (race.phase !== 'finished' && steps < maxSteps) {
    const inp = race.phase === 'run' ? brains[0].step(SIM_DT, race.vehicles) : zero;
    race.update(SIM_DT, inp);
    steps++;
  }
  const simMin = (steps / 60 / 60).toFixed(1);
  console.log(`  finished phase: ${race.phase} after ${simMin} sim-min`);
  assert(race.phase === 'finished', 'race reaches finished phase');
  let allLaps = true, noNaN = true, allMoving = true;
  for (let k = 0; k < race.vehicles.length; k++) {
    const v = race.vehicles[k], tm = race.timings[k];
    if (!(tm.completedLaps >= QUICK_RACE_LAPS)) allLaps = false;
    if (!isFinite(v.s) || !isFinite(v.d) || !isFinite(v.v)) noNaN = false;
    if (!(v.distTotal > track.length * 4.5)) allMoving = false;
    if (Math.abs(v.d) > track.halfW) { noNaN = false; console.error('  car left track!', k, v.d); }
  }
  assert(allLaps, 'all 8 cars completed 5 laps');
  assert(noNaN, 'no NaN / no car left the track (invisible walls hold)');
  assert(allMoving, 'every car kept moving (nobody stuck)');
  const order = race.order();
  console.log('  winner: team', LIVERIES[race.vehicles[order[0]].liveryIndex].name,
    '| player P' + race.playerPos(),
    '| player best', race.playerTiming.bestLap?.toFixed(2) + 's');
  race.dispose();
}

console.log('== overtake arming (DET -> next lap only) ==');
{
  const scene = new THREE.Scene();
  const race = new Race(scene, track, { mode: 'quick', liveryIndex: 0, tyre: 'medium', difficulty: 'normal' });
  (race as unknown as { phase: string }).phase = 'run'; // skip lights for this unit check
  const p = race.player, tm = race.playerTiming;
  tm.started = true;
  const rival = race.vehicles[1];
  // place rival just ahead of the player at the DET board (~0.5 s gap)
  p.resetToTrack(track.detS - 8, 0, 55);
  tm.prevS = p.s;
  rival.resetToTrack(track.detS + 20, 0, 55);
  race.timings[1].prevS = rival.s;
  race.timings[1].started = true;
  const zero = { throttle: 0, brake: 0, steer: 0, boost: false, aeroToggle: false };
  for (let i = 0; i < 60; i++) race.update(SIM_DT, zero);
  assert(tm.armOTNext, 'within 1 s at DET arms overtake for the next lap');
  // cross the start line -> becomes live
  p.resetToTrack(track.startS - 8, 0, 55);
  tm.prevS = p.s;
  for (let i = 0; i < 60; i++) race.update(SIM_DT, zero);
  assert(p.otArmed && !tm.armOTNext, 'overtake live after crossing the line');
  // next lap: expires
  p.resetToTrack(track.startS - 8, 0, 55);
  tm.prevS = p.s;
  for (let i = 0; i < 60; i++) race.update(SIM_DT, zero);
  assert(!p.otArmed, 'overtake expires after one lap');
  race.dispose();
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
