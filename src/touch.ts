// Touch controls for phones/tablets: on-screen steering buttons, pedals,
// boost, and command buttons. Touch state merges into Input.poll() exactly
// like keyboard/gamepad, so all three input methods work simultaneously.
//
// The layer is only built on touch devices (pointer: coarse), or when the
// URL carries ?touch=1 (handy for desktop testing). ?touch=0 forces it off.

export interface TouchState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  boost: boolean;
  aero: boolean;
  camera: boolean;
  reset: boolean;
  pause: boolean;
}

const NEUTRAL: TouchState = {
  left: false, right: false, throttle: false, brake: false, boost: false,
  aero: false, camera: false, reset: false, pause: false,
};

export class TouchControls {
  readonly state: TouchState = { ...NEUTRAL };
  readonly active: boolean;

  constructor(parent: HTMLElement) {
    this.active = TouchControls.isTouchDevice();
    if (!this.active) return;
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="touch-steer">
        <div class="tbtn" id="t-left">◀</div>
        <div class="tbtn" id="t-right">▶</div>
      </div>
      <div id="touch-pedals">
        <div class="tbtn" id="t-brake">BRAKE</div>
        <div class="tbtn pedal" id="t-gas">GAS</div>
      </div>
      <div class="tbtn" id="t-boost">BOOST</div>
      <div id="touch-util">
        <div class="tbtn mini" id="t-aero">AERO</div>
        <div class="tbtn mini" id="t-cam">CAM</div>
        <div class="tbtn mini" id="t-rst">RST</div>
        <div class="tbtn mini" id="t-pause">❚❚</div>
      </div>`;
    parent.appendChild(root);
    const bind = (id: string, key: keyof TouchState) => {
      const el = root.querySelector('#' + id) as HTMLElement;
      const on = (e: Event) => { e.preventDefault(); this.state[key] = true; el.classList.add('on'); };
      const off = (e: Event) => { e.preventDefault(); this.state[key] = false; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
      // mouse fallback (desktop testing with ?touch=1)
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    };
    bind('t-left', 'left'); bind('t-right', 'right');
    bind('t-brake', 'brake'); bind('t-gas', 'throttle');
    bind('t-boost', 'boost');
    bind('t-aero', 'aero'); bind('t-cam', 'camera');
    bind('t-rst', 'reset'); bind('t-pause', 'pause');
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // stop iOS scroll/zoom gestures that begin on the control layer
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  static isTouchDevice(): boolean {
    try {
      const q = new URLSearchParams(window.location.search).get('touch');
      if (q === '1') return true;
      if (q === '0') return false;
    } catch { /* ignore */ }
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      if (window.matchMedia('(pointer: fine)').matches) return false;
    }
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }
}
