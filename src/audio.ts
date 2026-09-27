// Procedural audio: engine tone from RPM, electric whine from battery
// deployment, skid noise from lateral slip. All WebAudio, no assets.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private engOsc: OscillatorNode | null = null;
  private engGain: GainNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private whineOsc: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private master: GainNode | null = null;
  private muted = false;

  /** must be called from a user gesture at least once */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // engine: sawtooth + lowpass
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 70;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 1100;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.engOsc.start();

    // electric whine: high sine following deployment
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'sine';
    this.whineOsc.frequency.value = 1500;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.master);
    this.whineOsc.start();

    // skid: looped noise through bandpass
    const len = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    noise.connect(bp).connect(this.skidGain).connect(this.master);
    noise.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }
  get isMuted() { return this.muted; }

  update(dt: number, o: { rpm01: number; deploy01: number; slip01: number; running: boolean }) {
    if (!this.ctx || !this.engOsc || !this.engGain || !this.whineOsc || !this.whineGain || !this.skidGain) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, dt * 10);
    const run = o.running ? 1 : 0;
    this.engOsc.frequency.setTargetAtTime(55 + o.rpm01 * 210, t, 0.03);
    this.engGain.gain.setTargetAtTime(0.10 * run * (0.35 + o.rpm01 * 0.65), t, 0.05);
    this.whineOsc.frequency.setTargetAtTime(1300 + o.deploy01 * 900, t, 0.05);
    this.whineGain.gain.setTargetAtTime(0.06 * run * o.deploy01, t, 0.08);
    const skid = Math.min(1, o.slip01) * run;
    const cur = this.skidGain.gain.value;
    this.skidGain.gain.setTargetAtTime(cur + (skid * 0.22 - cur) * k, t, 0.05);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
