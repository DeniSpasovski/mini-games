import { isMutedByUrl } from '../../../shared/mute-param';
import type { CarDef, CarSoundDef } from '../cars/shared/types';
import type { SurfaceId } from '../physics/surfaces';
import type { TunnelAcoustics } from '../world/world';
import type { CameraMode } from './camera-rig';
import { engineWave } from './engine-sound';

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

/** Where the listener is: behind the car (exhaust), far behind (quieter, duller) or on board (intake, gearbox). */
const LISTENER: Record<
  CameraMode,
  {
    all: number;
    exhaust: number;
    tone: number;
    intake: number;
    whine: number;
    wind: number;
  }
> = {
  chase: { all: 1, exhaust: 1, tone: 1, intake: 1, whine: 1, wind: 1 },
  chase_far: {
    all: 0.75,
    exhaust: 1,
    tone: 0.8,
    intake: 0.6,
    whine: 0.5,
    wind: 0.7,
  },
  hood: { all: 1, exhaust: 0.7, tone: 0.7, intake: 1.7, whine: 1.8, wind: 1.3 },
  bumper: {
    all: 1,
    exhaust: 0.6,
    tone: 0.65,
    intake: 1.5,
    whine: 1.3,
    wind: 1.5,
  },
};

/** Everything the synth reads each frame (rally-game.ts fills it). */
export interface CarSoundFrame {
  rpm: number;
  /** Throttle the engine sees (0 during a rev-limiter cut). */
  throttle: number;
  /** Throttle pedal (lift-off: pops, anti-lag, wastegate). */
  pedal: number;
  gear: number;
  /** Ground speed (m/s). */
  speed: number;
  /** Wheel revolutions per second (gear whine). */
  wheelHz: number;
  /** Fastest sliding contact patch (m/s). */
  slide: number;
  /** 0..1 loose ground under the wheels. */
  loose: number;
  impact: number;
  /** Weight of each surface under the wheels (sums to ~1). */
  surfaces: Partial<Record<SurfaceId, number>>;
  /** Fraction of ground speed a braked wheel is behind (0 when not braking hard). */
  lock: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Synthesised car audio (no sample files), tuned per car by `CarDef.sound` (cars/shared/types.ts):
 *  - engine: the firing-order wave (engine-sound.ts) at rpm / 120 Hz through a waveshaper + throttle-driven
 *    low-pass, plus exhaust rasp and intake roar (noise pulsed by the same wave), idle lope of a race cam
 *  - turbo: whistle + spool hiss; anti-lag bangs or a wastegate flutter on a lift; overrun pops; shift clunks
 *    and ignition cuts (sequential box), straight-cut gear whine; rev limiter stutter
 *  - wind, tarmac roll, gravel crunch, tyre slide (loose ground = crackling scrub + rumble, tarmac = squeal),
 *    locked-wheel squeal / plough, impact thumps
 *  - tunnels (setEnclosure): bass build-up, stereo slap echo off each wall, a diffuse tail that grows with the
 *    tunnel length, a whoosh at each headwall
 * The graph is built straight away; browsers may keep the context suspended until a user gesture (autoplay
 * rules), so every gesture retries resume() until it runs. Silent until the game loop calls setPaused(false)
 * (a failed load never beeps); pause / hidden tab suspend the context. M toggles mute; `?mute=1` starts muted
 * (see `src/shared/mute-param.ts`).
 */
export class CarAudio {
  private readonly sound: CarSoundDef;
  private readonly idleRpm: number;
  private readonly redline: number;
  private ctx?: AudioContext;
  private master?: GainNode;
  /** Every source mixes here (before the tunnel EQ / echo). */
  private mix?: GainNode;
  private oscA?: OscillatorNode;
  private oscB?: OscillatorNode;
  private engineFilter?: BiquadFilterNode;
  private engineGain?: GainNode;
  private raspGain?: GainNode;
  private raspFilter?: BiquadFilterNode;
  private intakeGain?: GainNode;
  private intakeFilter?: BiquadFilterNode;
  private whistle?: OscillatorNode;
  private whistleGain?: GainNode;
  private spoolGain?: GainNode;
  private spoolFilter?: BiquadFilterNode;
  private whine?: OscillatorNode;
  private whineGain?: GainNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private rollGain?: GainNode;
  private rollFilter?: BiquadFilterNode;
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
  /** Tunnel: low-mid build-up on the dry mix, the send to the echo, its tail level and the two wall slaps. */
  private tunnelEq?: BiquadFilterNode;
  private tunnelSend?: GainNode;
  private tunnelTail?: GainNode;
  private slapL?: DelayNode;
  private slapR?: DelayNode;
  private slapBackL?: GainNode;
  private slapBackR?: GainNode;
  private noise?: AudioBuffer;
  /** `?mute=1` starts muted (bots / tests); M still toggles. */
  muted = isMutedByUrl();
  volume = 0.5;

  /** Not playing (loading / pause menu): keep the context suspended. */
  private paused = true;
  private listener = LISTENER.chase;

  // Per-frame state.
  private lastT = 0;
  private boost = 0;
  private lope = 0;
  private gear = 0;
  /** Seconds left of the ignition cut of a shift. */
  private shiftCut = 0;
  /** Seconds since the pedal was lifted (Infinity while on it). */
  private offTime = Infinity;
  private pedalUp = false;
  private enclosed = false;

  constructor(car: CarDef) {
    this.sound = car.sound;
    this.idleRpm = car.physics.engine.idleRpm;
    this.redline = car.physics.engine.redlineRpm;
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

  /** Camera mode = where the listener is (on board hears more intake and gearbox, less exhaust). */
  setListener(mode: CameraMode): void {
    this.listener = LISTENER[mode];
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
    const snd = this.sound;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // Bangs and tunnels stack up: a gentle compressor keeps the peaks from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(this.master);
    this.mix = ctx.createGain();
    const mix = this.mix;

    // Tunnel: concrete walls build up the low mids, each wall sends a slap back (its own delay per ear, a
    // flutter between the walls), and a long tunnel adds a diffuse tail; all faded in by setEnclosure().
    this.tunnelEq = ctx.createBiquadFilter();
    this.tunnelEq.type = 'peaking';
    this.tunnelEq.frequency.value = 150;
    this.tunnelEq.Q.value = 0.8;
    this.tunnelEq.gain.value = 0;
    mix.connect(this.tunnelEq).connect(comp);
    this.tunnelSend = ctx.createGain();
    this.tunnelSend.gain.value = 0;
    this.tunnelEq.connect(this.tunnelSend);
    this.tunnelTail = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = tunnelImpulse(ctx);
    this.tunnelSend.connect(this.tunnelTail).connect(verb).connect(comp);
    const ears = ctx.createChannelMerger(2);
    ears.connect(comp);
    const slap = (ear: number): [DelayNode, GainNode] => {
      const d = ctx.createDelay(0.2);
      d.delayTime.value = 0.03;
      const back = ctx.createGain();
      back.gain.value = 0.3;
      d.connect(back).connect(d);
      this.tunnelSend!.connect(d);
      d.connect(ears, 0, ear);
      return [d, back];
    };
    [this.slapL, this.slapBackL] = slap(0);
    [this.slapR, this.slapBackR] = slap(1);

    // Engine: the firing-order wave, a second copy a few cents off (the other tailpipe / bank, slow beating).
    const wave = engineWave(snd);
    const periodic = ctx.createPeriodicWave(wave.real, wave.imag);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.5;
    const body = ctx.createBiquadFilter();
    body.type = 'lowshelf';
    body.frequency.value = 170;
    // Big displacement = weight down low; a small engine is thin (-2 dB at 1.3 l, +7 dB at 4 l).
    body.gain.value = (snd.displacement - 1.9) * 3.4;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(5 + 14 * snd.exhaust);
    this.oscA = ctx.createOscillator();
    this.oscA.setPeriodicWave(periodic);
    this.oscA.frequency.value = 8;
    this.oscB = ctx.createOscillator();
    this.oscB.setPeriodicWave(periodic);
    this.oscB.frequency.value = 8;
    this.oscB.detune.value = 9;
    const gB = ctx.createGain();
    gB.gain.value = 0.35;
    this.oscA.connect(shaper);
    this.oscB.connect(gB).connect(shaper);
    shaper
      .connect(body)
      .connect(this.engineFilter)
      .connect(this.engineGain)
      .connect(mix);
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
      s.start(0, Math.random() * 2);
      return s;
    };
    const filter = (type: BiquadFilterType, f: number, q = 1) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };
    const silent = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(mix);
      return g;
    };

    // Exhaust rasp + intake roar: noise pulsed by the engine wave (the gain follows the pressure), so the hiss
    // fires with the cylinders instead of sitting under the engine.
    const pulsed = ctx.createGain();
    pulsed.gain.value = 0;
    this.oscA.connect(pulsed.gain);
    loop().connect(pulsed);
    this.raspFilter = filter('bandpass', 1800, 0.9);
    this.raspGain = silent();
    pulsed.connect(this.raspFilter).connect(this.raspGain);
    this.intakeFilter = filter('bandpass', 400, 1.4);
    this.intakeGain = silent();
    pulsed.connect(this.intakeFilter).connect(this.intakeGain);

    if (snd.turbo) {
      this.whistle = ctx.createOscillator();
      this.whistle.frequency.value = 2000;
      this.whistleGain = silent();
      this.whistle.connect(this.whistleGain);
      this.whistle.start();
      this.spoolFilter = filter('bandpass', 3000, 3);
      this.spoolGain = silent();
      loop().connect(this.spoolFilter).connect(this.spoolGain);
    }
    if (snd.gearWhine > 0) {
      this.whine = ctx.createOscillator();
      this.whine.type = 'triangle';
      this.whine.frequency.value = 100;
      this.whineGain = silent();
      this.whine.connect(this.whineGain);
      this.whine.start();
    }

    // Wind over the body, tyre roll on hard ground, gravel crunch on loose.
    this.windFilter = filter('bandpass', 700, 0.6);
    this.windGain = silent();
    loop().connect(this.windFilter).connect(this.windGain);
    this.rollFilter = filter('lowpass', 400, 0.7);
    this.rollGain = silent();
    loop().connect(this.rollFilter).connect(this.rollGain);
    this.gravelFilter = filter('bandpass', 900, 0.7);
    this.gravelGain = silent();
    loop().connect(this.gravelFilter).connect(this.gravelGain);

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
    this.scrubFilter = filter('bandpass', 1100, 0.9);
    this.scrubGain = silent();
    grainSrc.connect(this.scrubFilter).connect(this.scrubGain);
    this.rumbleGain = silent();
    loop().connect(filter('lowpass', 260)).connect(this.rumbleGain);

    // Slide on tarmac: resonant squeal (narrow band-passed noise whose centre wobbles).
    this.squealFilter = filter('bandpass', 1500, 14);
    this.squealGain = silent();
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 7;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 90;
    wobble.connect(wobbleDepth).connect(this.squealFilter.frequency);
    wobble.start();
    loop().connect(this.squealFilter).connect(this.squealGain);
    // Locked-wheel braking. Hard ground: a lower, steadier squeal whose pitch falls as the car slows.
    // Loose ground: a juddering plough (low noise with a ~12 Hz amplitude wobble, like wheels
    // stuttering over the stones they push).
    this.lockSquealFilter = filter('bandpass', 900, 9);
    this.lockSquealGain = silent();
    loop().connect(this.lockSquealFilter).connect(this.lockSquealGain);
    const ploughAm = ctx.createGain();
    ploughAm.gain.value = 0.55;
    const judder = ctx.createOscillator();
    judder.type = 'triangle';
    judder.frequency.value = 12;
    const judderDepth = ctx.createGain();
    judderDepth.gain.value = 0.45;
    judder.connect(judderDepth).connect(ploughAm.gain);
    judder.start();
    this.ploughGain = silent();
    loop()
      .connect(filter('lowpass', 520))
      .connect(ploughAm)
      .connect(this.ploughGain);
    this.lastT = ctx.currentTime;
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

  /**
   * The portal around the car (World.tunnelAt), undefined in the open: echo level, a slap off each wall at its
   * distance (narrow = tighter, stronger flutter), a tail that grows with the tunnel length, bass build-up.
   */
  setEnclosure(tunnel: TunnelAcoustics | undefined, speed = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.tunnelSend) return;
    const t = ctx.currentTime;
    const f = tunnel?.enclosure ?? 0;
    this.tunnelSend.gain.setTargetAtTime(f * 0.5, t, 0.12);
    this.tunnelEq!.gain.setTargetAtTime(f * 6, t, 0.15);
    // Crossing a headwall: the pressure whump of the opening going past.
    const inside = f > 0;
    if (inside !== this.enclosed && speed > 6)
      this.whoosh(Math.min(1, speed / 35));
    this.enclosed = inside;
    if (!tunnel) return;
    this.tunnelTail!.gain.setTargetAtTime(
      0.25 + 0.75 * Math.min(1, tunnel.length / 90),
      t,
      0.2,
    );
    const width = tunnel.wallL + tunnel.wallR;
    const back = Math.min(0.45, Math.max(0.15, 0.55 - width * 0.02));
    this.slapL!.delayTime.setTargetAtTime(slapDelay(tunnel.wallL), t, 0.1);
    this.slapR!.delayTime.setTargetAtTime(slapDelay(tunnel.wallR), t, 0.1);
    this.slapBackL!.gain.setTargetAtTime(back, t, 0.1);
    this.slapBackR!.gain.setTargetAtTime(back, t, 0.1);
  }

  update(s: CarSoundFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.oscA) return;
    const t = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const snd = this.sound;
    const lis = this.listener;
    const { rpm, throttle, pedal, speed } = s;
    const rpmN = clamp01(rpm / this.redline);

    // Pedal lift (pops, anti-lag, wastegate) and gear changes (ignition cut + clunk).
    if (pedal > 0.5) {
      this.pedalUp = true;
      this.offTime = Infinity;
    } else if (pedal < 0.15 && this.pedalUp) {
      this.pedalUp = false;
      this.offTime = 0;
      if (snd.turbo && !snd.turbo.antiLag && this.boost > 0.45)
        this.flutter(this.boost);
    }
    if (this.offTime !== Infinity) this.offTime += dt;
    if (s.gear !== this.gear) {
      const up = s.gear > this.gear && this.gear >= 1;
      const seq = snd.gearbox === 'sequential';
      if (this.gear !== 0 && s.gear !== 0) {
        this.shiftCut = seq ? 0.07 : 0.16;
        this.clunk(seq ? 1 : 0.25);
        // Flat upshift: the cut fires unburnt fuel into the hot exhaust.
        if (up && pedal > 0.6 && (snd.turbo?.antiLag || snd.pops > 0.4))
          this.bang(0.4 + 0.4 * Math.random(), 0.6);
      }
      this.gear = s.gear;
    }
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    const limiter = rpm > this.redline * 0.985 && pedal > 0.7 && throttle < 0.2;

    // Overrun crackle off a high-rpm lift; anti-lag keeps banging (and the turbo spinning) while off the pedal.
    const off = pedal < 0.12 && rpmN > 0.4 && speed > 2;
    const als = !!snd.turbo?.antiLag && off && rpm > 3000 && this.offTime < 3;
    let popRate = off ? snd.pops * 14 * Math.exp(-this.offTime / 0.8) : 0;
    if (limiter) popRate += snd.pops * 6;
    if (Math.random() < popRate * dt)
      this.bang(
        (0.15 + 0.45 * Math.random()) * snd.pops,
        0.2 + 0.3 * Math.random(),
      );
    if (als && Math.random() < 8 * dt)
      this.bang(0.55 + 0.45 * Math.random(), 0.75);

    // Idle lope of a race cam + a little combustion jitter everywhere.
    this.lope += (Math.random() * 2 - 1 - this.lope) * Math.min(1, dt * 7);
    const idle =
      clamp01(1 - (rpm - this.idleRpm) / (this.idleRpm * 0.8)) * (1 - throttle);
    const wob = this.lope * (0.004 + snd.cam * 0.05 * idle);
    const cycle = (rpm / 120) * (1 + wob);
    this.oscA.frequency.setTargetAtTime(cycle, t, 0.02);
    this.oscB!.frequency.setTargetAtTime(cycle, t, 0.02);

    // Engine level and tone: bigger engines and open exhausts are louder and darker at rest, brighter on load.
    // Loudness follows displacement: a 1.3 l is ~60% of a 4 l V8.
    const size = 0.5 + 0.22 * snd.displacement;
    const cut = (this.shiftCut > 0 ? 0.3 : 1) * (limiter ? 0.45 : 1);
    const lope = 1 + snd.cam * 0.35 * this.lope * idle;
    this.engineGain!.gain.setTargetAtTime(
      (0.12 + 0.13 * throttle + 0.05 * rpmN) *
        size *
        (0.7 + 0.4 * snd.exhaust) *
        cut *
        lope *
        lis.exhaust *
        lis.all,
      t,
      cut < 1 ? 0.012 : 0.04,
    );
    const dark = Math.min(1.2, Math.max(0.8, 1.3 - 0.1 * snd.displacement));
    this.engineFilter!.frequency.setTargetAtTime(
      ((250 + 900 * snd.exhaust) * dark +
        throttle * (1100 + 1500 * snd.exhaust) +
        rpm * 0.15) *
        lis.tone,
      t,
      0.04,
    );
    this.raspGain!.gain.setTargetAtTime(
      snd.exhaust *
        0.08 *
        (0.25 + 0.75 * throttle) *
        Math.min(1, rpmN * 1.5) *
        cut *
        lis.exhaust *
        lis.all,
      t,
      0.04,
    );
    this.raspFilter!.frequency.setTargetAtTime(1300 + rpm * 0.22, t, 0.05);
    this.intakeGain!.gain.setTargetAtTime(
      snd.intake *
        0.11 *
        throttle *
        (0.3 + 0.7 * rpmN) *
        cut *
        lis.intake *
        lis.all,
      t,
      0.04,
    );
    this.intakeFilter!.frequency.setTargetAtTime(200 + rpm * 0.07, t, 0.05);

    // Turbo spools with load above ~40% rpm, anti-lag holds it up off the throttle.
    if (snd.turbo) {
      const target = als ? 0.7 : throttle * clamp01((rpmN - 0.3) / 0.3);
      const tc = target > this.boost ? 0.45 : 0.3;
      this.boost += (target - this.boost) * Math.min(1, dt / tc);
      const b = this.boost;
      this.whistle!.frequency.setTargetAtTime(
        2200 + b * 3800 + rpm * 0.12,
        t,
        0.05,
      );
      this.whistleGain!.gain.setTargetAtTime(
        b * b * 0.02 * lis.intake * lis.all,
        t,
        0.05,
      );
      this.spoolGain!.gain.setTargetAtTime(
        b * 0.035 * lis.intake * lis.all,
        t,
        0.05,
      );
      this.spoolFilter!.frequency.setTargetAtTime(2500 + b * 2500, t, 0.05);
    }
    // Straight-cut gears: crown wheel mesh (~41 teeth) at the wheel speed, loud on drive and on overrun.
    if (this.whine) {
      this.whine.frequency.setTargetAtTime(
        Math.max(20, s.wheelHz * 41),
        t,
        0.03,
      );
      this.whineGain!.gain.setTargetAtTime(
        snd.gearWhine *
          0.03 *
          Math.min(1, speed / 12) *
          (0.5 + 0.5 * Math.max(throttle, off ? 0.7 : 0)) *
          lis.whine *
          lis.all,
        t,
        0.05,
      );
    }

    this.windGain!.gain.setTargetAtTime(
      Math.min(0.16, (speed / 45) ** 2 * 0.08) * lis.wind * lis.all,
      t,
      0.1,
    );
    this.windFilter!.frequency.setTargetAtTime(400 + speed * 14, t, 0.1);
    this.rollGain!.gain.setTargetAtTime(
      Math.min(0.09, speed * 0.0025) * (1 - s.loose) * lis.all,
      t,
      0.1,
    );
    this.rollFilter!.frequency.setTargetAtTime(250 + speed * 7, t, 0.1);
    this.gravelGain!.gain.setTargetAtTime(
      Math.min(0.35, speed * 0.012) * s.loose * lis.all,
      t,
      0.08,
    );
    this.gravelFilter!.frequency.setTargetAtTime(500 + speed * 25, t, 0.1);

    // Blend the slide sound profile of the surfaces under the wheels (weights sum to ~1).
    const p = { scrub: 0, freq: 0, freqSpeed: 0, q: 0, rumble: 0, squeal: 0 };
    let total = 0;
    for (const id in s.surfaces) {
      const w = s.surfaces[id as SurfaceId] ?? 0;
      const sl = SLIDE_SOUND[id as SurfaceId];
      if (!sl || w <= 0) continue;
      total += w;
      p.scrub += sl.scrub * w;
      p.freq += sl.freq * w;
      p.freqSpeed += sl.freqSpeed * w;
      p.q += sl.q * w;
      p.rumble += sl.rumble * w;
      p.squeal += sl.squeal * w;
    }
    if (total > 0) for (const k in p) p[k as keyof typeof p] /= total;
    else p.scrub = p.rumble = p.squeal = 0;
    const slide = s.slide;
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
    const locked =
      Math.min(1, Math.max(0, s.lock - 0.06) / 0.2) * Math.min(1, speed / 2);
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
    if (s.impact > 3000) this.thump(Math.min(1, s.impact / 20000));
  }

  /** A looped-noise burst (one-shot sounds), started at a random point of the buffer. */
  private burst(at: number, length: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise!;
    s.start(at, Math.random() * 1.5);
    s.stop(at + length);
    return s;
  }

  private lastThump = 0;
  private thump(strength: number): void {
    const ctx = this.ctx!;
    if (ctx.currentTime - this.lastThump < 0.15) return;
    this.lastThump = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(strength * 0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    this.burst(ctx.currentTime, 0.4).connect(f).connect(g).connect(this.mix!);
  }

  /**
   * Exhaust bang / pop: a sharp noise crack, darker and with a low thud for anti-lag (`dark` 1), bright crackle
   * for overrun pops (`dark` ~0.2).
   */
  private bang(strength: number, dark: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3800 - dark * 2900;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    const len = 0.03 + dark * 0.09;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(strength * 0.7, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    this.burst(t, len + 0.02)
      .connect(f)
      .connect(g)
      .connect(this.mix!);
    if (dark < 0.5) return;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(strength * 0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    o.connect(og).connect(this.mix!);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Gearbox shift: a dull knock (sequential dog box) or a soft clutch shift. */
  private clunk(strength: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 320;
    f.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(strength * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    this.burst(t, 0.08).connect(f).connect(g).connect(this.mix!);
  }

  /** Wastegate / compressor flutter on a lift without anti-lag: a fast chatter that dies away. */
  private flutter(boost: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 2;
    const chatter = ctx.createGain();
    chatter.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(26, t);
    lfo.frequency.linearRampToValueAtTime(14, t + 0.5);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(chatter.gain);
    lfo.start(t);
    lfo.stop(t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(boost * 0.18 * this.listener.all, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    this.burst(t, 0.55)
      .connect(f)
      .connect(chatter)
      .connect(g)
      .connect(this.mix!);
  }

  /** Passing a tunnel headwall: a low air whump. */
  private whoosh(strength: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(strength * 0.22, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    this.burst(t, 0.55).connect(f).connect(g).connect(this.mix!);
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

/** Impulse response of the tunnel tail: stereo noise with an exponential decay (~1.2 s to -60 dB), dark-ish. */
function tunnelImpulse(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.3);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // One-pole low-pass on the noise: concrete swallows the highs.
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      d[i] = lp * Math.exp(-t * 5.3) * 0.6;
    }
  }
  return buf;
}

/** Round trip to a wall at the speed of sound (s), within the delay line's 0.2 s. */
const slapDelay = (wall: number): number => Math.min(0.19, (2 * wall) / 343);
