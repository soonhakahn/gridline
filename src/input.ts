// Keyboard + gamepad input. Poll once per frame; edges are computed
// against the previous poll.

export interface InputState {
  throttle: number;
  brake: number;
  steer: number; // -1..1
  boost: boolean;
  aeroPressed: boolean;
  cameraPressed: boolean;
  lookback: boolean;
  resetPressed: boolean;
  pausePressed: boolean;
  mutePressed: boolean;
  upshift: boolean; // edge
  downshift: boolean; // edge
  anyPressed: boolean; // edge, any key/button
}

const NEUTRAL: InputState = {
  throttle: 0, brake: 0, steer: 0, boost: false,
  aeroPressed: false, cameraPressed: false, lookback: false,
  resetPressed: false, pausePressed: false, mutePressed: false,
  upshift: false, downshift: false, anyPressed: false,
};

export class Input {
  private keys = new Set<string>();
  private prev: InputState = { ...NEUTRAL };
  private padPrev = { aero: false, camera: false };
  private padIndex: number | null = null;

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('gamepadconnected', this.onPad as EventListener);
    window.addEventListener('blur', () => this.keys.clear());
  }
  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('gamepadconnected', this.onPad as EventListener);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // prevent page scroll on game keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onPad = (e: GamepadEvent) => { this.padIndex = e.gamepad.index; };

  private edge(cur: boolean, was: boolean) { return cur && !was; }

  poll(): InputState {
    const k = this.keys;
    const s: InputState = { ...NEUTRAL };

    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    s.throttle = up ? 1 : 0;
    s.brake = down ? 1 : 0;
    s.steer = (right ? 1 : 0) - (left ? 1 : 0);
    s.boost = k.has('Space');
    s.lookback = k.has('KeyV');
    const aero = k.has('ShiftLeft') || k.has('ShiftRight');
    const cam = k.has('KeyC');
    const reset = k.has('KeyR');
    const pause = k.has('Escape');
    const mute = k.has('KeyM');
    const qUp = k.has('KeyQ');
    const eDown = k.has('KeyE');
    // NOTE: spec says Q/A for shifting, but A is steering — E is used for
    // downshift instead (documented in README/controls).
    s.aeroPressed = this.edge(aero, this.prevAero);
    s.cameraPressed = this.edge(cam, this.prevCam);
    s.resetPressed = this.edge(reset, this.prevReset);
    s.pausePressed = this.edge(pause, this.prevPause);
    s.mutePressed = this.edge(mute, this.prevMute);
    s.upshift = this.edge(qUp, this.prevQ);
    s.downshift = this.edge(eDown, this.prevE);
    s.anyPressed = k.size > 0 && this.prevKeyCount === 0;

    // gamepad
    const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() ?? [] : [];
    const pad = this.padIndex != null ? pads[this.padIndex] : pads[0];
    if (pad && pad.connected) {
      const b = (n: number) => pad.buttons[n]?.pressed ?? false;
      const bv = (n: number) => pad.buttons[n]?.value ?? 0;
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.08) s.steer = ax;
      s.throttle = Math.max(s.throttle, bv(7));
      s.brake = Math.max(s.brake, bv(6));
      s.boost = s.boost || b(0);
      s.lookback = s.lookback || b(5);
      const pAero = b(2), pCam = b(3);
      s.aeroPressed = s.aeroPressed || this.edge(pAero, this.padPrev.aero);
      s.cameraPressed = s.cameraPressed || this.edge(pCam, this.padPrev.camera);
      s.resetPressed = s.resetPressed || this.edge(b(9), this.prevPadStart);
      s.pausePressed = s.pausePressed || this.edge(b(9), this.prevPadStart);
      s.anyPressed = s.anyPressed || pad.buttons.some((x) => x.pressed);
      this.padPrev.aero = pAero; this.padPrev.camera = pCam;
      this.prevPadStart = b(9);
    }

    this.prevAero = aero; this.prevCam = cam; this.prevReset = reset;
    this.prevPause = pause; this.prevMute = mute; this.prevQ = qUp; this.prevE = eDown;
    this.prevKeyCount = k.size;
    this.prev = s;
    return s;
  }

  private prevAero = false; private prevCam = false; private prevReset = false;
  private prevPause = false; private prevMute = false;
  private prevQ = false; private prevE = false; private prevKeyCount = 0;
  private prevPadStart = false;
}
