// GRIDLINE browser smoke test (dev-only; not bundled).
// Boots the real src/main.ts Game inside jsdom with stubbed WebGLRenderer,
// 2D canvas contexts and AudioContext, then drives the menu, a quick-race
// start, throttle input, camera/pause keys and a time-trial reset —
// asserting no exceptions and that the HUD actually updates.
//
// Run: npm run smoke   (node --import tsx --loader ./css-loader.mjs)

import { JSDOM } from 'jsdom';
// NOTE: no `import * as THREE` here — the ESM loader redirects 'three' to a
// wrapper with a stubbed WebGLRenderer before main.ts is imported below.

// ---------------- jsdom environment ----------------
const dom = new JSDOM(
  '<!DOCTYPE html><html><head></head><body><div id="app"></div><div id="ui"></div></body></html>',
  { pretendToBeVisual: true, url: 'http://localhost/?touch=1' } // force touch controls on
);
const win = dom.window as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;
for (const k of ['document', 'location', 'localStorage', 'sessionStorage',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'KeyboardEvent', 'Event',
  'CustomEvent', 'MouseEvent', 'getComputedStyle']) {
  // NOTE: 'navigator' intentionally skipped — node>=21 already provides a
  // global navigator and input.ts guards getGamepads with optional chaining.
  try { g[k] = win[k]; } catch { /* read-only global: keep the built-in */ }
}
g['window'] = win;
g['addEventListener'] = (win['addEventListener'] as CallableFunction).bind(win);
g['removeEventListener'] = (win['removeEventListener'] as CallableFunction).bind(win);
g['dispatchEvent'] = (win['dispatchEvent'] as CallableFunction).bind(win);
g['innerWidth'] = 1280;
g['innerHeight'] = 720;
g['devicePixelRatio'] = 1;

// deterministic clock: the game loop drives dt from the rAF timestamp
let nowMs = 0;
try {
  Object.defineProperty(g, 'performance', {
    value: { now: () => nowMs }, configurable: true, writable: true,
  });
} catch { /* keep built-in performance */ }

// manual rAF pump
const rafQ: FrameRequestCallback[] = [];
const raf = (cb: FrameRequestCallback): number => { rafQ.push(cb); return rafQ.length; };
g['requestAnimationFrame'] = raf;
(win as Record<string, unknown>)['requestAnimationFrame'] = raf;

// ---------------- boot the real game ----------------
// (WebGLRenderer is stubbed via the ESM loader, so the real three.js scene
// graph construction still fully executes.)

// 2D canvas contexts -> universal no-op proxy (minimap drawing)
function ctx2dStub(canvas: HTMLCanvasElement): unknown {
  const fn: unknown = function () { return proxy; };
  const proxy = new Proxy(fn as object, {
    get(_t, prop) {
      if (prop === 'canvas') return canvas;
      return (..._a: unknown[]) => proxy;
    },
    set() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}
const HTMLCanvasEl = win['HTMLCanvasElement'] as { prototype: HTMLCanvasElement };
const origGetCtx = HTMLCanvasEl.prototype.getContext;
HTMLCanvasEl.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
  if (type === '2d') return ctx2dStub(this) as CanvasRenderingContext2D;
  return origGetCtx.call(this, type as 'webgl', ...(rest as []));
} as typeof HTMLCanvasEl.prototype.getContext;

// AudioContext -> stub nodes
class StubParam { value = 0; setTargetAtTime(): void { /* noop */ } }
function stubNode(): Record<string, unknown> {
  const n: Record<string, unknown> = {};
  n['connect'] = () => stubNode();
  n['gain'] = new StubParam();
  n['frequency'] = new StubParam();
  n['Q'] = new StubParam();
  n['start'] = () => { /* noop */ };
  return n;
}
class StubAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination: unknown = {};
  createGain(): unknown { return stubNode(); }
  createOscillator(): unknown { return stubNode(); }
  createBiquadFilter(): unknown { return stubNode(); }
  createBuffer(_ch: number, len: number, _rate: number): unknown {
    return { getChannelData: () => new Float32Array(len) };
  }
  createBufferSource(): unknown {
    const n = stubNode(); n['buffer'] = null; n['loop'] = false; return n;
  }
  resume(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
}
(win as Record<string, unknown>)['AudioContext'] = StubAudioContext;

// ---------------- boot the real game ----------------
let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) console.log('  ok:', msg);
  else { failures++; console.log('  FAIL:', msg); }
}
const jsdomErrors: string[] = [];
dom.virtualConsole.on('jsdomError', (e: Error) => jsdomErrors.push(String(e && e.stack || e)));

await import('./main.js'); // module scope runs `new Game()`

const doc = g['document'] as Document;
const q = (s: string): HTMLElement => {
  const el = doc.querySelector(s) as HTMLElement | null;
  if (!el) { failures++; console.log('  FAIL: missing element', s); throw new Error('missing ' + s); }
  return el;
};
const visible = (s: string): boolean => !q(s).classList.contains('hidden');
function click(s: string): void { q(s).dispatchEvent(new (win['MouseEvent'] as typeof MouseEvent)('click', { bubbles: true })); }
function key(code: string, down: boolean): void {
  (win as unknown as { dispatchEvent: (e: Event) => void }).dispatchEvent(
    new (win['KeyboardEvent'] as typeof KeyboardEvent)(down ? 'keydown' : 'keyup', { code, bubbles: true })
  );
}
// touch buttons: jsdom has no TouchEvent, but TouchControls also binds mouse
// events (desktop testing path), which is what we drive here.
function tdown(s: string): void {
  q(s).dispatchEvent(new (win['MouseEvent'] as typeof MouseEvent)('mousedown', { bubbles: true }));
}
function tup(s: string): void {
  q(s).dispatchEvent(new (win['MouseEvent'] as typeof MouseEvent)('mouseup', { bubbles: true }));
}
function frames(n: number, stepMs = 16.7): void {
  for (let i = 0; i < n; i++) {
    const cbs = rafQ.splice(0, rafQ.length);
    nowMs += stepMs;
    for (const cb of cbs) cb(nowMs);
  }
}
const spd = (): number => parseInt((q('#h-spd').textContent || '0').trim(), 10);

console.log('== menu ==');
ok(visible('#m-main'), 'main menu visible on boot');
click('#b-quick');
ok(visible('#m-setup'), 'setup screen after QUICK RACE');
click('#b-setup-go');
ok(visible('#m-controls'), 'controls card on first run');
click('#b-ctrl-go');

console.log('== quick race start ==');
frames(30);
ok((q('#hud') as HTMLElement).style.display !== 'none', 'HUD shown after race start');
ok(doc.querySelector('#touch') != null, 'touch controls built with ?touch=1');
ok(visible('#hud-lights'), 'start lights visible');
// run through the lights sequence (~1s per light + random hold)
frames(60 * 9);
const msgAfterLights = (q('#hud-msg').textContent || '');
console.log('  info: msg after lights =', JSON.stringify(msgAfterLights));

console.log('== driving (touch) ==');
tdown('#t-gas'); tdown('#t-boost');
frames(60 * 6);
tup('#t-gas'); tup('#t-boost');
const v = spd();
console.log('  info: speed after 6s touch GAS+BOOST =', v, 'km/h');
ok(v > 100, `car accelerates on touch throttle (speed ${v} km/h)`);
ok((q('#h-lap').textContent || '').startsWith('LAP 1/5'), 'lap counter shows LAP 1/5');
ok((q('#h-gear').textContent || '').startsWith('GEAR'), 'gear readout present');
const bat = parseInt((q('#h-batpct').textContent || '100').trim(), 10);
ok(bat < 100, `battery deploys under throttle+boost drain (${bat}%)`);

// touch command buttons: must not throw
tdown('#t-cam'); frames(3); tup('#t-cam');
tdown('#t-aero'); frames(3); tup('#t-aero');
frames(10);

console.log('== pause / resume (touch) ==');
tdown('#t-pause'); frames(3); tup('#t-pause');
ok(visible('#m-pause'), 'pause menu opens on touch pause button');
click('#b-resume');
ok(!visible('#m-pause'), 'resume hides pause menu');
frames(10);

console.log('== time trial reset (touch) ==');
key('Escape', true); frames(3); key('Escape', false);
click('#b-quit');
ok(visible('#m-main'), 'quit returns to main menu');
click('#b-tt');
click('#b-setup-go'); // controls already seen -> straight into race
frames(60 * 6); // lights + go
tdown('#t-gas'); frames(60 * 3); tup('#t-gas');
const v2 = spd();
ok(v2 > 60, `time trial car drives on touch (speed ${v2} km/h)`);
tdown('#t-rst'); frames(3); tup('#t-rst');
frames(5);
ok(true, 'touch RST reset did not throw');

console.log('== false start ==');
key('Escape', true); frames(3); key('Escape', false);
click('#b-quit');
click('#b-quick');
click('#b-setup-go'); // controls already seen
frames(5);
key('ArrowUp', true); // throttle during lights -> false start
frames(60 * 2);
key('ArrowUp', false);
const fsMsg = (q('#hud-msg').textContent || '');
ok(fsMsg.includes('FALSE START'), `false start message shown (got ${JSON.stringify(fsMsg)})`);
frames(60 * 8); // let the lights finish; race runs with penalty recorded

console.log('== jsdom errors ==');
ok(jsdomErrors.length === 0, `no uncaught jsdom errors (${jsdomErrors.length})`);
for (const e of jsdomErrors.slice(0, 3)) console.log('  jsdomError:', e.split('\n').slice(0, 3).join(' | '));

if (failures > 0) { console.log(`\n${failures} CHECK(S) FAILED`); process.exit(1); }
console.log('\nBROWSER SMOKE PASSED');
