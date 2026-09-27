// DOM menus: title, setup (car/compound/difficulty/graphics), controls card,
// pause, and race results. Fires MenuAction callbacks to main.ts.

import { LIVERIES, TyreCompound, Difficulty, GraphicsQuality } from './config';
import { fmtTime } from './hud';
import { TouchControls } from './touch';

export interface SetupSelection {
  liveryIndex: number;
  tyre: TyreCompound;
  difficulty: Difficulty;
  graphics: GraphicsQuality;
  mode: 'quick' | 'timetrial';
}

export type MenuAction =
  | { type: 'start'; sel: SetupSelection }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'quit' }
  | { type: 'retry' };

export interface ResultRow {
  pos: number; num: number; team: string;
  best: number | null; gap: string; me: boolean;
}

const TYRES: TyreCompound[] = ['soft', 'medium', 'hard'];
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export class Menu {
  onAction: (a: MenuAction) => void = () => undefined;
  sel: SetupSelection = { liveryIndex: 2, tyre: 'medium', difficulty: 'normal', graphics: 'high', mode: 'quick' };
  private screens: Record<string, HTMLElement> = {};

  constructor(private root: HTMLElement) {
    this.buildMain();
    this.buildSetup();
    this.buildControls();
    this.buildPause();
    this.buildResults();
    this.hideAll();
  }

  private mk(id: string, cls: string, html: string): HTMLElement {
    const d = document.createElement('div');
    d.id = id; d.className = 'screen dim ' + cls;
    d.innerHTML = html;
    this.root.appendChild(d);
    this.screens[id] = d;
    return d;
  }

  hideAll() { for (const k in this.screens) this.screens[k].classList.add('hidden'); }
  private show(id: string) { this.hideAll(); this.screens[id].classList.remove('hidden'); }
  get visible(): boolean { return Object.values(this.screens).some((s) => !s.classList.contains('hidden')); }

  // ---------------- main ----------------
  private buildMain() {
    const d = this.mk('m-main', '', `
      <p class="title">GRIDLINE</p>
      <p class="subtitle">ORIGINAL 3D OPEN-WHEEL RACING &nbsp;•&nbsp; COSTA VERDE</p>
      <button class="btn primary" id="b-quick">QUICK RACE — 5 LAPS</button>
      <button class="btn" id="b-tt">TIME TRIAL</button>
      <p class="note">8 fictional teams • active aero • battery boost • overtake mode<br>Keyboard + gamepad + touch supported</p>
    `);
    d.querySelector('#b-quick')!.addEventListener('click', () => { this.sel.mode = 'quick'; this.showSetup(); });
    d.querySelector('#b-tt')!.addEventListener('click', () => { this.sel.mode = 'timetrial'; this.showSetup(); });
  }
  showMain() { this.show('m-main'); }

  // ---------------- setup ----------------
  private buildSetup() {
    const d = this.mk('m-setup', '', `<div class="card">
      <h2 id="setup-title">QUICK RACE</h2>
      <h3>Car</h3><div id="cargrid"></div>
      <h3>Tyre compound <span style="font-weight:400;text-transform:none;letter-spacing:0">(race start only)</span></h3>
      <div class="btnrow" id="tyre-row"></div>
      <h3>Difficulty</h3><div class="btnrow" id="diff-row"></div>
      <h3>Graphics</h3><div class="btnrow" id="gfx-row"></div>
      <div style="text-align:center;margin-top:18px">
        <button class="btn small" id="b-setup-back">BACK</button>
        <button class="btn primary small" id="b-setup-go">START</button>
      </div></div>`);
    const grid = d.querySelector('#cargrid')!;
    LIVERIES.forEach((lv, i) => {
      const c = document.createElement('div');
      c.className = 'carc' + (i === this.sel.liveryIndex ? ' sel' : '');
      const base = '#' + lv.base.toString(16).padStart(6, '0');
      const acc = '#' + lv.accent.toString(16).padStart(6, '0');
      c.innerHTML = `<div class="sw" style="background:linear-gradient(135deg,${base} 55%,${acc} 55%)"><span class="num">${lv.number}</span></div><div class="nm">${lv.name}</div>`;
      c.addEventListener('click', () => {
        this.sel.liveryIndex = i;
        grid.querySelectorAll('.carc').forEach((x, j) => x.classList.toggle('sel', j === i));
      });
      grid.appendChild(c);
    });
    const mkRow = <T extends string>(el: Element, vals: T[], cur: T, fmt: (v: T) => string, set: (v: T) => void) => {
      vals.forEach((v) => {
        const b = document.createElement('button');
        b.className = 'opt' + (v === cur ? ' sel' : '');
        b.textContent = fmt(v);
        b.addEventListener('click', () => { set(v); el.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', x === b)); });
        el.appendChild(b);
      });
    };
    mkRow(d.querySelector('#tyre-row')!, TYRES, this.sel.tyre, (v) => v.toUpperCase(), (v) => (this.sel.tyre = v));
    mkRow(d.querySelector('#diff-row')!, DIFFS, this.sel.difficulty, (v) => v.toUpperCase(), (v) => (this.sel.difficulty = v));
    mkRow(d.querySelector('#gfx-row')!, ['low', 'high'] as GraphicsQuality[], this.sel.graphics, (v) => v.toUpperCase(), (v) => (this.sel.graphics = v));
    d.querySelector('#b-setup-back')!.addEventListener('click', () => this.showMain());
    d.querySelector('#b-setup-go')!.addEventListener('click', () => this.onAction({ type: 'start', sel: { ...this.sel } }));
  }
  private showSetup() {
    (this.screens['m-setup'].querySelector('#setup-title') as HTMLElement).textContent =
      this.sel.mode === 'quick' ? 'QUICK RACE — 5 LAPS VS 7 AI' : 'TIME TRIAL';
    this.show('m-setup');
  }

  // ---------------- controls ----------------
  private controlsDone: () => void = () => undefined;
  private buildControls() {
    const d = this.mk('m-controls', '', `<div class="card" style="max-width:560px">
      <h2>CONTROLS</h2>
      <table class="ctrl">
        <tr><td class="k">W / ↑</td><td>Throttle</td><td class="k">S / ↓</td><td>Brake</td></tr>
        <tr><td class="k">A D / ← →</td><td>Steer</td><td class="k">SHIFT</td><td>Active aero (in SM zones)</td></tr>
        <tr><td class="k">SPACE</td><td>Boost — hold to deploy extra battery</td><td class="k">C</td><td>Camera: chase / cockpit / TV</td></tr>
        <tr><td class="k">V</td><td>Look back</td><td class="k">Q / E</td><td>Manual up / down shift</td></tr>
        <tr><td class="k">R</td><td>Reset to track (time trial)</td><td class="k">ESC</td><td>Pause</td></tr>
        <tr><td class="k">M</td><td>Mute</td><td class="k">Gamepad</td><td>RT/LT pedals, stick steer, A boost, X aero, Y cam</td></tr>
      </table>
      <p class="note">SM = straight-mode aero zones (cyan marks). DET board before the main straight:<br>
      stay within 1.0 s of the car ahead there to arm OVERTAKE for the next lap.</p>
      ${TouchControls.isTouchDevice() ? `<p class="note" style="color:#00e5ff">Touch controls: ◀ ▶ steer • GAS / BRAKE pedals • hold BOOST<br>
      AERO toggles active aero • CAM camera • RST reset (time trial) • ❚❚ pause</p>` : ''}
      <div style="text-align:center"><button class="btn primary" id="b-ctrl-go">GOT IT — RACE</button></div>
    </div>`);
    d.querySelector('#b-ctrl-go')!.addEventListener('click', () => this.controlsDone());
  }
  showControls(done: () => void) { this.controlsDone = done; this.show('m-controls'); }
  static controlsSeen(): boolean {
    try { return localStorage.getItem('gridline_controls_seen') === '1'; } catch { return false; }
  }
  static markControlsSeen() {
    try { localStorage.setItem('gridline_controls_seen', '1'); } catch { /* noop */ }
  }

  // ---------------- pause ----------------
  private buildPause() {
    const d = this.mk('m-pause', '', `
      <p class="title" style="font-size:44px">PAUSED</p>
      <button class="btn primary" id="b-resume">RESUME</button>
      <button class="btn" id="b-restart">RESTART</button>
      <button class="btn" id="b-quit">QUIT TO MENU</button>`);
    d.querySelector('#b-resume')!.addEventListener('click', () => this.onAction({ type: 'resume' }));
    d.querySelector('#b-restart')!.addEventListener('click', () => this.onAction({ type: 'restart' }));
    d.querySelector('#b-quit')!.addEventListener('click', () => this.onAction({ type: 'quit' }));
  }
  showPause() { this.show('m-pause'); }

  // ---------------- results ----------------
  private buildResults() {
    this.mk('m-results', '', `<div class="card" style="max-width:560px;text-align:center">
      <h2 id="res-title">RACE COMPLETE</h2>
      <p id="res-sub" class="subtitle" style="margin:4px 0 6px"></p>
      <table class="res"><thead><tr><th>P</th><th>#</th><th>Team</th><th>Best</th><th>Gap</th></tr></thead>
      <tbody id="res-body"></tbody></table>
      <div><button class="btn primary small" id="b-retry">RETRY</button>
      <button class="btn small" id="b-menu">MENU</button></div></div>`);
    this.screens['m-results'].querySelector('#b-retry')!.addEventListener('click', () => this.onAction({ type: 'retry' }));
    this.screens['m-results'].querySelector('#b-menu')!.addEventListener('click', () => this.onAction({ type: 'quit' }));
  }
  showResults(title: string, sub: string, rows: ResultRow[]) {
    (this.screens['m-results'].querySelector('#res-title') as HTMLElement).textContent = title;
    (this.screens['m-results'].querySelector('#res-sub') as HTMLElement).textContent = sub;
    const body = this.screens['m-results'].querySelector('#res-body') as HTMLElement;
    body.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      tr.innerHTML = `<td>${r.pos}</td><td>${r.num}</td><td>${r.team}</td><td>${fmtTime(r.best)}</td><td>${r.gap}</td>`;
      body.appendChild(tr);
    }
    this.show('m-results');
  }
}
