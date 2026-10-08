import { isMutedByUrl } from '../../../shared/mute-param';
import type { SimEvent } from '../sim/types';

/** Blast voices playing at once; more are dropped (the loudest already covers them). */
export const MAX_BLAST_VOICES = 4;
/** Blasts closer together than this merge into one louder voice. */
export const BLAST_MERGE_S = 0.05;

/**
 * Procedural WebAudio (no files). The context is created lazily on the first user gesture (iOS needs that) and every
 * sound is a short envelope. `?mute=1` never creates the context, so tests and the editor stay silent. Blasts are the
 * only sound that can come in dozens at once, so they are capped (`MAX_BLAST_VOICES`) and merged (`BLAST_MERGE_S`):
 * forty TNT in a chain are a few loud booms, not forty voices.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;
  private readonly muted = isMutedByUrl();
  private lastBoom = -1;
  private pendingBoom = 0;
  private activeBooms = 0;
  private lastCrate = -1;

  /** Call from a touch / click / key handler. */
  unlock(): void {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, n, n);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.master!.gain.value = this.volume;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    gain = 0.3,
    slideTo?: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.volume <= 0) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** A burst of filtered noise (the body of a bang, a crate cracking). Returns when it ends. */
  private burst(
    dur: number,
    gain: number,
    from: number,
    to: number,
    delay = 0,
    type: BiquadFilterType = 'lowpass',
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.volume <= 0) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.4);
    src.stop(t0 + dur + 0.05);
  }

  /** A blast. Several in the same few milliseconds merge into one louder voice; at most `MAX_BLAST_VOICES` play. */
  boom(): void {
    const now = performance.now() / 1000;
    if (now - this.lastBoom < BLAST_MERGE_S) {
      this.pendingBoom = Math.min(0.6, this.pendingBoom + 0.12);
      return;
    }
    if (this.activeBooms >= MAX_BLAST_VOICES) return;
    const power = 1 + this.pendingBoom;
    this.pendingBoom = 0;
    this.lastBoom = now;
    this.activeBooms++;
    window.setTimeout(() => this.activeBooms--, 700);
    this.burst(0.55, 0.55 * power, 1400, 90);
    this.tone(120, 0.5, 'sine', 0.5 * power, 38);
    this.tone(60, 0.3, 'triangle', 0.35 * power, 30, 0.02);
  }

  place(): void {
    this.tone(220, 0.09, 'triangle', 0.25, 110);
    this.burst(0.05, 0.12, 2500, 800, 0, 'highpass');
  }

  crate(): void {
    const now = performance.now() / 1000;
    if (now - this.lastCrate < 0.04) return;
    this.lastCrate = now;
    this.burst(0.16, 0.22, 3200, 400, 0, 'bandpass');
    this.tone(180 + Math.random() * 80, 0.08, 'square', 0.06);
  }

  ko(): void {
    this.tone(520, 0.4, 'sawtooth', 0.14, 110);
    this.tone(260, 0.5, 'sine', 0.2, 70, 0.05);
  }

  /** A sudden-death wall lands `delay` seconds from now. */
  thud(delay = 0): void {
    this.tone(90, 0.28, 'sine', 0.4, 40, delay);
    this.burst(0.25, 0.3, 500, 70, delay);
  }

  countdown(n: number): void {
    this.tone(n === 0 ? 880 : 440, n === 0 ? 0.5 : 0.18, 'square', 0.12);
  }

  /** Sudden death starts: two alternating sirens. */
  siren(): void {
    for (let i = 0; i < 4; i++)
      this.tone(i % 2 ? 520 : 780, 0.16, 'square', 0.1, undefined, i * 0.17);
  }

  /** A power-up pops out of a crate. */
  blip(): void {
    this.tone(1175, 0.1, 'triangle', 0.14);
  }

  /** Somebody grabbed a power-up: a quick rising arpeggio. */
  pickup(): void {
    [660, 880, 1320].forEach((f, i) =>
      this.tone(f, 0.12, 'triangle', 0.2, undefined, i * 0.06),
    );
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.24, 'triangle', 0.22, undefined, i * 0.08),
    );
  }

  lose(): void {
    [392, 330, 262].forEach((f, i) =>
      this.tone(f, 0.3, 'triangle', 0.2, undefined, i * 0.14),
    );
  }

  click(): void {
    this.tone(700, 0.05, 'square', 0.08);
  }

  /** Play the sounds of one tick's events. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'tntPlaced':
          this.place();
          break;
        case 'tntExploded':
          this.boom();
          break;
        case 'blockBroken':
          this.crate();
          break;
        case 'playerKo':
          this.ko();
          break;
        case 'blockFell':
          this.thud(0.3);
          break;
        case 'itemAppeared':
          this.blip();
          break;
        case 'itemTaken':
          this.pickup();
          break;
        default:
          break;
      }
    }
  }
}
