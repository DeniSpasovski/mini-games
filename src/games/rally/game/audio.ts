import { isMutedByUrl } from '../../../shared/mute-param';
import type { SurfaceId } from '../physics/surfaces';

/**
 * How a slide sounds per surface: grain scrub (gain, band-pass centre Hz + Hz per m/s, Q), low rumble
 * and tarmac squeal (all 0..1.5 multipliers). update() blends these by the surfaces under the wheels.
 */
const SLIDE_SOUND: Record<
  SurfaceId,
  {
    scrub: number;
    freq: number;
    freqSpeed: number;
    q: number;
    rumble: number;
    squeal: number;
  }
> = {
  gravel: { scrub: 1, freq: 700, freqSpeed: 22, q: 0.9, rumble: 1, squeal: 0 },
  gravel_loose: {
    scrub: 1.2,
    freq: 600,
    freqSpeed: 20,
    q: 0.8,
    rumble: 1.2,
    squeal: 0,
  },
  // Soft swish, little low end.
  grass: {
    scrub: 0.45,
    freq: 2200,
    freqSpeed: 15,
    q: 0.6,
    rumble: 0.2,
    squeal: 0,
  },
  dirt: {
    scrub: 0.9,
    freq: 500,
    freqSpeed: 18,
    q: 0.9,
    rumble: 1.1,
    squeal: 0,
  },
  // Hard and tight: scrape plus a little squeal.
  rock: {
    scrub: 0.7,
    freq: 1500,
    freqSpeed: 25,
    q: 1.4,
    rumble: 0.4,
    squeal: 0.5,
  },
  tarmac: {
    scrub: 0.15,
    freq: 1200,
    freqSpeed: 20,
    q: 1,
    rumble: 0.1,
    squeal: 1,
  },
  tarmac_gravel: {
    scrub: 0.5,
    freq: 900,
    freqSpeed: 20,
    q: 1,
    rumble: 0.4,
    squeal: 0.5,
  },
  // Dull wet squelch.
  mud: { scrub: 0.8, freq: 350, freqSpeed: 8, q: 0.7, rumble: 1.6, squeal: 0 },
  // Muffled squeaky crunch.
  snow: {
    scrub: 0.5,
    freq: 1800,
    freqSpeed: 10,
    q: 0.7,
    rumble: 0.3,
    squeal: 0,
  },
};

/**
 * Synthesised car audio (no sample files yet):
 *  - engine: two detuned oscillators at the firing frequency through a
 *    waveshaper + throttle-driven low-pass
 *  - gravel crunch: band-passed noise scaled by speed on loose surfaces
 *  - tyre slide: loose ground = crackling grain scrub + low rumble, tarmac = wobbling resonant squeal
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
  private scrubGain?: GainNode;
  private scrubFilter?: BiquadFilterNode;
  private rumbleGain?: GainNode;
  private squealGain?: GainNode;
  private squealFilter?: BiquadFilterNode;
  private lockSquealGain?: GainNode;
  private lockSquealFilter?: BiquadFilterNode;
  private ploughGain?: GainNode;
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

    // Slide on loose ground: grainy scrub (noise broken into random pops, so it crackles
    // like stones being ploughed instead of hissing) plus a low rumble of the tyre pushing a wedge.
    const grains = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const g = grains.getChannelData(0);
    let env = 0;
    for (let i = 0; i < g.length; i++) {
      if (Math.random() < 1 / 260) env = 0.5 + Math.random() * 0.5;
      env *= 0.9965;
      g[i] = (Math.random() * 2 - 1) * (0.12 + env);
    }
    const grainSrc = ctx.createBufferSource();
    grainSrc.buffer = grains;
    grainSrc.loop = true;
    grainSrc.start();
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubFilter.frequency.value = 1100;
    this.scrubFilter.Q.value = 0.9;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    grainSrc
      .connect(this.scrubFilter)
      .connect(this.scrubGain)
      .connect(this.master);
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 260;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    loop().connect(rumble).connect(this.rumbleGain).connect(this.master);

    // Slide on tarmac: resonant squeal (narrow band-passed noise whose centre wobbles).
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1500;
    this.squealFilter.Q.value = 14;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 7;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 90;
    wobble.connect(wobbleDepth).connect(this.squealFilter.frequency);
    wobble.start();
    loop()
      .connect(this.squealFilter)
      .connect(this.squealGain)
      .connect(this.master);
    // Locked-wheel braking. Hard ground: a lower, steadier squeal whose pitch falls as the car slows.
    // Loose ground: a juddering plough (low noise with a ~12 Hz amplitude wobble, like wheels
    // stuttering over the stones they push).
    this.lockSquealFilter = ctx.createBiquadFilter();
    this.lockSquealFilter.type = 'bandpass';
    this.lockSquealFilter.frequency.value = 900;
    this.lockSquealFilter.Q.value = 9;
    this.lockSquealGain = ctx.createGain();
    this.lockSquealGain.gain.value = 0;
    loop()
      .connect(this.lockSquealFilter)
      .connect(this.lockSquealGain)
      .connect(this.master);
    const plough = ctx.createBiquadFilter();
    plough.type = 'lowpass';
    plough.frequency.value = 520;
    const ploughAm = ctx.createGain();
    ploughAm.gain.value = 0.55;
    const judder = ctx.createOscillator();
    judder.type = 'triangle';
    judder.frequency.value = 12;
    const judderDepth = ctx.createGain();
    judderDepth.gain.value = 0.45;
    judder.connect(judderDepth).connect(ploughAm.gain);
    judder.start();
    this.ploughGain = ctx.createGain();
    this.ploughGain.gain.value = 0;
    loop()
      .connect(plough)
      .connect(ploughAm)
      .connect(this.ploughGain)
      .connect(this.master);
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
    surfaces: Partial<Record<SurfaceId, number>> = {},
    lock = 0,
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
    // Blend the slide sound profile of the surfaces under the wheels (weights sum to ~1).
    const p = { scrub: 0, freq: 0, freqSpeed: 0, q: 0, rumble: 0, squeal: 0 };
    let total = 0;
    for (const id in surfaces) {
      const w = surfaces[id as SurfaceId] ?? 0;
      const s = SLIDE_SOUND[id as SurfaceId];
      if (!s || w <= 0) continue;
      total += w;
      p.scrub += s.scrub * w;
      p.freq += s.freq * w;
      p.freqSpeed += s.freqSpeed * w;
      p.q += s.q * w;
      p.rumble += s.rumble * w;
      p.squeal += s.squeal * w;
    }
    if (total > 0) for (const k in p) p[k as keyof typeof p] /= total;
    else p.scrub = p.rumble = p.squeal = 0;
    const over = Math.max(0, slide - 1.5);
    const grip = Math.min(1, over / 6);
    this.scrubGain!.gain.setTargetAtTime(
      Math.min(0.32, over * 0.05) * p.scrub * Math.min(1, speed / 4),
      t,
      0.06,
    );
    this.scrubFilter!.frequency.setTargetAtTime(
      p.freq + speed * p.freqSpeed + over * 40,
      t,
      0.1,
    );
    this.scrubFilter!.Q.setTargetAtTime(p.q, t, 0.1);
    this.rumbleGain!.gain.setTargetAtTime(grip * 0.35 * p.rumble, t, 0.1);
    this.squealGain!.gain.setTargetAtTime(
      Math.min(0.1, Math.max(0, slide - 3) * 0.015) *
        p.squeal *
        Math.min(1, speed / 6),
      t,
      0.05,
    );
    this.squealFilter!.Q.setTargetAtTime(10 + grip * 8, t, 0.1);
    // `lock` = fraction of ground speed a braked wheel is behind (0 when not braking hard).
    const locked =
      Math.min(1, Math.max(0, lock - 0.06) / 0.2) * Math.min(1, speed / 2);
    this.lockSquealGain!.gain.setTargetAtTime(
      locked * 0.14 * Math.min(1, p.squeal),
      t,
      0.04,
    );
    this.lockSquealFilter!.frequency.setTargetAtTime(500 + speed * 14, t, 0.1);
    this.ploughGain!.gain.setTargetAtTime(
      locked * 0.45 * Math.min(1, p.rumble),
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
