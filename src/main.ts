// GRIDLINE entry point: renderer/scene setup, menu flow, fixed-timestep
// game loop, and wiring between race, HUD, audio, cameras, and effects.

import * as THREE from 'three';
import './ui.css';
import { buildTrack } from './track';
import { Race } from './race';
import { Hud } from './hud';
import { Menu, SetupSelection, ResultRow } from './menu';
import { Input, InputState } from './input';
import { GameAudio } from './audio';
import { SmokeSystem } from './effects';
import { Cameras } from './camera';
import { VehicleInput } from './vehicle';
import {
  SIM_DT, MAX_SIM_STEPS, LIVERIES, RPM_IDLE, RPM_MAX,
  GraphicsQuality, QUICK_RACE_LAPS,
} from './config';

class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private track = buildTrack();
  private cameras: Cameras;
  private hud: Hud;
  private menu: Menu;
  private input = new Input();
  private audio = new GameAudio();
  private smoke: SmokeSystem;
  private sun: THREE.DirectionalLight;
  private race: Race | null = null;
  private sel: SetupSelection | null = null;
  private inRace = false;
  private paused = false;
  private acc = 0;
  private last = 0;
  private frameInput: InputState | null = null;

  constructor() {
    const app = document.getElementById('app')!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    app.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x87b5e0);
    this.scene.fog = new THREE.Fog(0x87b5e0, 250, 1700);
    this.scene.add(this.track.group);

    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a7a3c, 0.85);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -140; this.sun.shadow.camera.right = 140;
    this.sun.shadow.camera.top = 140; this.sun.shadow.camera.bottom = -140;
    this.sun.shadow.camera.far = 1200;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.cameras = new Cameras(innerWidth / innerHeight);
    this.cameras.buildTvSpots(this.track);

    const ui = document.getElementById('ui')!;
    this.hud = new Hud(ui);
    this.menu = new Menu(ui);
    this.menu.onAction = (a) => this.onMenu(a);
    this.smoke = new SmokeSystem(this.scene, 'high');

    this.input.attach();
    this.input.setTouch(this.hud.touch.active ? this.hud.touch.state : null);
    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.cameras.onResize(innerWidth / innerHeight);
    });

    this.menu.showMain();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------- menu flow ----------------
  private onMenu(a: { type: string; sel?: SetupSelection }) {
    this.audio.ensure();
    if (a.type === 'start' && a.sel) {
      this.sel = a.sel;
      if (!Menu.controlsSeen()) {
        this.menu.showControls(() => {
          Menu.markControlsSeen();
          this.startRace();
        });
      } else this.startRace();
    } else if (a.type === 'resume') {
      this.paused = false;
      this.menu.hideAll();
    } else if (a.type === 'restart' || a.type === 'retry') {
      this.startRace();
    } else if (a.type === 'quit') {
      if (this.race && this.sel?.mode === 'timetrial' && this.race.phase !== 'finished') {
        this.race.endTimeTrial();
        this.showResults('TIME TRIAL — SESSION OVER', '');
      } else {
        this.endRace();
        this.menu.showMain();
      }
    }
  }

  private applyGraphics(q: GraphicsQuality) {
    const high = q === 'high';
    this.renderer.shadowMap.enabled = high;
    this.sun.castShadow = high;
    this.renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 2) : 1);
    this.smoke.dispose(this.scene);
    this.smoke = new SmokeSystem(this.scene, q);
  }

  private startRace() {
    this.endRace();
    const sel = this.sel!;
    this.applyGraphics(sel.graphics);
    this.race = new Race(this.scene, this.track, {
      mode: sel.mode, liveryIndex: sel.liveryIndex, tyre: sel.tyre, difficulty: sel.difficulty,
    });
    this.inRace = true;
    this.paused = false;
    this.acc = 0;
    this.menu.hideAll();
    this.hud.show();
    this.hud.setMessage(sel.mode === 'quick' ? 'LIGHTS OUT SOON — HOLD POSITION' : 'TIME TRIAL — PUSH!', 3);
  }

  private endRace() {
    this.race?.dispose();
    this.race = null;
    this.inRace = false;
    this.paused = false;
    this.hud.hide();
  }

  private showResults(title: string, sub: string) {
    const r = this.race!;
    const rows: ResultRow[] = r.results.map((res, i) => ({
      pos: i + 1,
      num: LIVERIES[res.vehicle.liveryIndex].number,
      team: LIVERIES[res.vehicle.liveryIndex].name,
      best: res.best,
      gap: i === 0 ? '—' : '+' + res.gap.toFixed(3),
      me: res.vehicle.isPlayer,
    }));
    const pt = r.playerTiming;
    const ps = pt.falseStart ? ' (+5s false-start penalty)' : '';
    const myBest = pt.bestLap != null ? `Your best: ${pt.bestLap.toFixed(3)}s${ps}` : '';
    this.hud.hide();
    this.menu.showResults(title, sub || myBest, rows);
  }

  // ---------------- per-frame ----------------
  private buildPlayerInput(): VehicleInput {
    const s = this.frameInput!;
    return {
      throttle: this.race!.phase === 'run' || this.race!.phase === 'lights' ? s.throttle : 0,
      brake: s.brake, steer: s.steer, boost: s.boost, aeroToggle: s.aeroPressed,
    };
  }

  private loop(t: number) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const inp = this.input.poll();
    this.frameInput = inp;

    if (inp.mutePressed) this.audio.setMuted(!this.audio.isMuted);

    if (this.inRace && this.race) {
      const r = this.race;
      // global keys
      if (inp.pausePressed && r.phase !== 'finished') {
        if (this.paused) { this.paused = false; this.menu.hideAll(); }
        else { this.paused = true; this.menu.showPause(); }
      }
      if (inp.cameraPressed) this.cameras.cycle();
      if (inp.resetPressed && this.sel?.mode === 'timetrial' && !this.paused) r.resetPlayer();
      if (inp.upshift) r.player.setGear(r.player.gear + 1);
      if (inp.downshift) r.player.setGear(r.player.gear - 1);

      if (!this.paused) {
        // fixed-step sim; input edges only on the first sub-step
        this.acc += dt;
        let n = 0;
        let first = true;
        while (this.acc >= SIM_DT && n < MAX_SIM_STEPS) {
          const pi = this.buildPlayerInput();
          if (!first) { pi.aeroToggle = false; }
          first = false;
          r.update(SIM_DT, pi);
          this.acc -= SIM_DT;
          n++;
        }
        if (n === MAX_SIM_STEPS) this.acc = 0;

        // events -> HUD messages / results
        for (const e of r.events) {
          if (e === 'OT_ARMED') this.hud.setMessage('OVERTAKE ARMED — next lap', 3);
          else if (e === 'FALSE_START') this.hud.setMessage('FALSE START! +5s penalty', 3);
          else if (e === 'LIGHTS_OUT') this.hud.setMessage('GO!', 1.2);
          else if (e === 'BEST_LAP') this.hud.setMessage('BEST LAP!', 2);
          else if (e === 'FINISH') {
            this.showResults(
              this.sel!.mode === 'quick' ? 'RACE COMPLETE' : 'TIME TRIAL — SESSION OVER',
              ''
            );
          }
        }
        r.events.length = 0;

        // visuals
        for (const v of r.vehicles) {
          v.updateVisual(dt);
          if (v.slip > 0.22 && v.v > 12) {
            const p = v.group.position;
            const yaw = this.track.yawAt(v.s);
            this.smoke.spawn(p.x - Math.sin(yaw) * 2.1, p.y + 0.25, p.z - Math.cos(yaw) * 2.1, v.slip);
          }
        }
        this.smoke.update(dt);

        // sun shadow follows the player
        const pp = r.player.group.position;
        this.sun.position.set(pp.x + 260, 380, pp.z + 140);
        this.sun.target.position.set(pp.x, 0, pp.z);

        this.cameras.update(dt, r.player, this.track, inp.lookback);
        this.hud.tickMsg(dt);
        this.hud.setLights(r.lightCount, r.lightsOut, r.phase === 'lights');
        this.updateHud(r);
        this.hud.drawMinimap(this.track, r.vehicles, r.playerIdx);

        const rpm01 = Math.max(0, Math.min(1, (r.player.rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE)));
        this.audio.update(dt, {
          rpm01, deploy01: r.player.deploy01, slip01: r.player.slip, running: true,
        });
      } else {
        this.audio.update(dt, { rpm01: 0, deploy01: 0, slip01: 0, running: false });
      }
    } else {
      this.audio.update(dt, { rpm01: 0, deploy01: 0, slip01: 0, running: false });
      // idle camera: slow orbit around start line
      const s = this.track.startS;
      const p = this.track.posAt(s, 0, new THREE.Vector3());
      const tt = t / 1000;
      this.cameras.camera.position.set(p.x + Math.sin(tt * 0.1) * 60, p.y + 22, p.z + Math.cos(tt * 0.1) * 60);
      this.cameras.camera.lookAt(p.x, p.y + 2, p.z);
    }

    this.renderer.render(this.scene, this.cameras.camera);
  }

  private updateHud(r: Race) {
    const p = r.player, tm = r.playerTiming;
    const gaps = r.playerGaps();
    this.hud.update({
      pos: r.playerPos(), total: r.vehicles.length,
      lap: tm.completedLaps + 1, laps: this.sel!.mode === 'quick' ? QUICK_RACE_LAPS : 0,
      sector: tm.sector,
      speedKmh: p.v * 3.6, gear: p.gear,
      delta: tm.delta,
      battery: p.battery, aero: p.aero, ot: p.otArmed || tm.armOTNext, tyre: p.tyre,
      lights: r.lightCount, lightsOut: r.lightsOut, lightsVisible: r.phase === 'lights',
      raceTime: r.time,
      mode: this.sel!.mode,
      bestLap: tm.bestLap, lastLap: tm.lastLap,
      gapAhead: gaps.ahead, gapBehind: gaps.behind,
    }, performance.now() / 1000);
  }
}

new Game();
