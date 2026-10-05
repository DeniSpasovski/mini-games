import { isMutedByUrl } from '../../../shared/mute-param';

/**
 * Synthesised car audio (no sample files yet):
 *  - engine: two detuned oscillators at the firing frequency through a
 *    waveshaper + throttle-driven low-pass
 *  - gravel crunch: band-passed noise scaled by speed on loose surfaces
 *  - tyre slide: high-passed noise scaled by slide speed
 *  - impacts: short noise burst
 * The graph is built straight away; browsers may keep the context suspended
 * until a user gesture (autoplay rules), so every gesture retries resume() until
 * it runs. Silent until the game loop calls setPaused(false) (a failed load
 * never beeps); pause / hidden tab suspend the context. M toggles mute;
 * `?mute=1` starts muted (see `src/shared/mute-param.ts`).
 */
export class CarAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private oscA?: OscillatorNode;
  private oscB?: OscillatorNode;
  private engineFilter?: BiquadFilterNode;
  private engineGain?: GainNode;
  private gravelGain?: GainNode;
  private gravelFilter?: BiquadFilterNode;
  private slideGain?: GainNode;
  private noise?: AudioBuffer;
  /** `?mute=1` starts muted (bots / tests); M still toggles. */
  muted = isMutedByUrl();
  volume = 0.5;

  /** Not playing (loading / pause menu): keep the context suspended. */
  private paused = true;

  constructor(private cylinders = 4) {
    const gestures = ['keydown', 'pointerdown', 'touchend', 'click'] as const;
    const unlock = () => {
      this.start();
      this.sync();
      if (this.ctx?.state === 'running')
        for (const g of gestures) window.removeEventListener(g, unlock, true);
    };
    for (const g of gestures) window.addEventListener(g, unlock, true);
    document.addEventListener('visibilitychange', () => this.sync());
    // A gesture earlier on the page (the menu's "Start stage") usually allows it now.
    this.start();
  }

  /** Pause / resume all sound (game pause menu). */
  setPaused(p: boolean): void {
    this.paused = p;
    this.sync();
  }

  /** Run the context only while playing and visible. */
  private sync(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    const want = !this.paused && document.visibilityState === 'visible';
    if (want && ctx.state !== 'running') void ctx.resume().catch(() => {});
    if (!want && ctx.state === 'running') void ctx.suspend();
  }

  private start(): void {
    if (this.ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // Engine.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(18);
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = 30;
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    this.oscB.frequency.value = 15;
    const gB = ctx.createGain();
    gB.gain.value = 0.5;
    this.oscA.connect(shaper);
    this.oscB.connect(gB).connect(shaper);
    shaper
      .connect(this.engineFilter)
      .connect(this.engineGain)
      .connect(this.master);
    this.oscA.start();
    this.oscB.start();

    // Noise sources.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise!;
      s.loop = true;
      s.start();
      return s;
    };
    this.gravelFilter = ctx.createBiquadFilter();
    this.gravelFilter.type = 'bandpass';
    this.gravelFilter.frequency.value = 900;
    this.gravelFilter.Q.value = 0.7;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    loop()
      .connect(this.gravelFilter)
      .connect(this.gravelGain)
      .connect(this.master);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    loop().connect(hp).connect(this.slideGain).connect(this.master);
    this.sync();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  update(
    rpm: number,
    throttle: number,
    speed: number,
    slide: number,
    loose: number,
    impact: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.oscA) return;
    const t = ctx.currentTime;
    const fire = (rpm / 60) * (this.cylinders / 2);
    this.oscA.frequency.setTargetAtTime(fire, t, 0.02);
    this.oscB!.frequency.setTargetAtTime(fire * 0.5 * 1.005, t, 0.02);
    this.engineFilter!.frequency.setTargetAtTime(
      380 + throttle * 1700 + rpm * 0.18,
      t,
      0.04,
    );
    this.engineGain!.gain.setTargetAtTime(0.18 + throttle * 0.12, t, 0.05);
    this.gravelGain!.gain.setTargetAtTime(
      Math.min(0.35, speed * 0.012) * loose,
      t,
      0.08,
    );
    this.gravelFilter!.frequency.setTargetAtTime(500 + speed * 25, t, 0.1);
    this.slideGain!.gain.setTargetAtTime(
      Math.min(0.25, Math.max(0, slide - 1.5) * 0.03) * (1 - loose * 0.6),
      t,
      0.05,
    );
    if (impact > 3000 && this.noise) this.thump(Math.min(1, impact / 20000));
  }

  private lastThump = 0;
  private thump(strength: number): void {
    const ctx = this.ctx!;
    if (ctx.currentTime - this.lastThump < 0.15) return;
    this.lastThump = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(strength * 0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    s.connect(f).connect(g).connect(this.master!);
    s.start();
    s.stop(ctx.currentTime + 0.4);
  }

  dispose(): void {
    void this.ctx?.close();
  }
}

function distortionCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}
