// HUD: DOM overlay (position, lap, speed, battery, aero/OT/tyre badges,
// start lights, messages) + canvas minimap with live car dots.

import { TrackData } from './track';
import { Vehicle } from './vehicle';
import { TouchControls } from './touch';

export interface HudData {
  pos: number; total: number;
  lap: number; laps: number;
  sector: number;
  speedKmh: number; gear: number;
  delta: number | null; // s, negative = ahead
  battery: number; aero: 'CM' | 'SM'; ot: boolean; tyre: string;
  lights: number; lightsOut: boolean; lightsVisible: boolean;
  raceTime: number;
  mode: 'quick' | 'timetrial';
  bestLap: number | null; lastLap: number | null;
  gapAhead: number | null; gapBehind: number | null;
}

function fmtTime(t: number | null): string {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
export { fmtTime };

export class Hud {
  private root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private msgT = 0;
  private mapCv: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private lastUpdate = 0;
  /** On-screen touch controls (inactive shell on non-touch devices). */
  readonly touch: TouchControls;

  constructor(root: HTMLElement) {
    this.root = root;
    const div = document.createElement('div');
    div.id = 'hud';
    div.innerHTML = `
      <div class="panel" id="hud-tl">
        <div><span class="pos" id="h-pos">P8</span><span id="h-total">/8</span></div>
        <div id="h-lap">LAP 1/5</div>
        <div id="h-sector">SECTOR 1</div>
        <div id="h-delta">Δ --.---</div>
        <div id="h-gap" style="font-size:12px;color:#9fb3c8"></div>
      </div>
      <div class="panel" id="hud-speed">
        <div class="spd"><span id="h-spd">0</span><span style="font-size:16px"> km/h</span></div>
        <div class="gear" id="h-gear">GEAR 1</div>
        <div id="h-time" style="font-size:13px;color:#9fb3c8">0:00.000</div>
      </div>
      <div class="panel" id="hud-bl">
        <div><span class="badge cm" id="h-aero">CM</span><span class="badge ot hidden" id="h-ot">OT</span><span class="badge tyre-medium" id="h-tyre">MED</span></div>
        <div style="margin-top:4px">BATTERY <span id="h-batpct">100</span>%</div>
        <div id="batbar"><div id="batfill"></div></div>
        <div id="h-best" style="margin-top:4px;font-size:12px;color:#9fb3c8">BEST --:--.---</div>
      </div>
      <canvas id="minimap" width="300" height="300"></canvas>
      <div id="hud-msg"></div>
      <div id="hud-lights" class="hidden"></div>
    `;
    root.appendChild(div);
    for (const id of ['h-pos', 'h-total', 'h-lap', 'h-sector', 'h-delta', 'h-gap', 'h-spd', 'h-gear', 'h-time', 'h-aero', 'h-ot', 'h-tyre', 'h-batpct', 'batfill', 'h-best', 'hud-msg', 'hud-lights']) {
      this.el[id] = div.querySelector('#' + id) as HTMLElement;
    }
    this.mapCv = div.querySelector('#minimap') as HTMLCanvasElement;
    this.mapCtx = this.mapCv.getContext('2d')!;
    this.touch = new TouchControls(div);
    div.style.display = 'none';
    this.el.hud = div;
  }

  show() { this.el.hud.style.display = 'block'; }
  hide() { this.el.hud.style.display = 'none'; }

  setMessage(text: string, dur = 2.5) {
    this.el['hud-msg'].textContent = text;
    this.msgT = dur;
  }

  setLights(n: number, out: boolean, visible: boolean) {
    const box = this.el['hud-lights'];
    if (!visible) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (box.childElementCount !== 5) {
      box.innerHTML = '';
      for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'l'; box.appendChild(d); }
    }
    if (out) { box.classList.add('hidden'); return; }
    const kids = box.children;
    for (let i = 0; i < 5; i++) kids[i].classList.toggle('on', i < n);
  }

  tickMsg(dt: number) {
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.el['hud-msg'].textContent = '';
    }
  }

  update(d: HudData, now: number) {
    // throttle DOM writes to ~12 Hz
    if (now - this.lastUpdate < 0.08) return;
    this.lastUpdate = now;
    this.el['h-pos'].textContent = 'P' + d.pos;
    this.el['h-total'].textContent = '/' + d.total;
    this.el['h-lap'].textContent = d.mode === 'quick' ? `LAP ${Math.min(d.lap, d.laps)}/${d.laps}` : `LAP ${d.lap}`;
    this.el['h-sector'].textContent = 'SECTOR ' + (d.sector + 1);
    this.el['h-spd'].textContent = String(Math.round(d.speedKmh));
    this.el['h-gear'].textContent = 'GEAR ' + d.gear;
    this.el['h-time'].textContent = fmtTime(d.raceTime);
    const dd = this.el['h-delta'];
    if (d.delta == null) { dd.textContent = 'Δ --.---'; dd.className = ''; }
    else {
      dd.textContent = `Δ ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(3)}`;
      dd.className = d.delta < 0 ? 'neg' : 'pos';
      dd.id = 'h-delta';
    }
    this.el['h-gap'].textContent =
      (d.gapAhead != null ? `▲ ${d.gapAhead.toFixed(1)}s  ` : '') +
      (d.gapBehind != null ? `▼ ${d.gapBehind.toFixed(1)}s` : '');
    const aero = this.el['h-aero'];
    aero.textContent = d.aero;
    aero.className = 'badge ' + d.aero.toLowerCase();
    this.el['h-ot'].classList.toggle('hidden', !d.ot);
    const tyre = this.el['h-tyre'];
    tyre.textContent = d.tyre.slice(0, 3).toUpperCase();
    tyre.className = 'badge tyre-' + d.tyre;
    this.el['h-batpct'].textContent = String(Math.round(d.battery));
    (this.el['batfill'] as HTMLElement).style.width = d.battery + '%';
    this.el['h-best'].textContent = 'BEST ' + fmtTime(d.bestLap) + (d.lastLap != null ? `  LAST ${fmtTime(d.lastLap)}` : '');
  }

  drawMinimap(track: TrackData, vehicles: Vehicle[], playerIdx: number) {
    const c = this.mapCtx, S = 300;
    c.clearRect(0, 0, S, S);
    const mm = track.minimap;
    if (mm) {
      const t = (mm as unknown as { _t: number[] })._t;
      const [pad, sc, minX, minZ, w, maxX, hh, maxZ] = t;
      // scale the 200px prerender to 300px canvas
      c.drawImage(mm, 0, 0, S, S);
      const k = S / 200;
      for (const vv of vehicles) {
        const wx = vv.group.position.x, wz = vv.group.position.z;
        const X = (pad + (wx - minX) * sc + (w - (maxX - minX) * sc) / 2) * k;
        const Y = (pad + (wz - minZ) * sc + (hh - (maxZ - minZ) * sc) / 2) * k;
        const isP = vv.index === playerIdx;
        c.beginPath();
        c.arc(X, Y, isP ? 7 : 4.5, 0, 6.29);
        c.fillStyle = isP ? '#00e5ff' : 'rgba(255,255,255,0.75)';
        c.fill();
        if (isP) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
      }
      void maxZ; void hh;
    }
  }
}
