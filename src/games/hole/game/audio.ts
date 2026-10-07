import { isMutedByUrl } from '../../../shared/mute-param';

/**
 * Tiny WebAudio synth (no files). The context is created lazily on the first
 * user gesture (iOS requires it) and every sound is a short envelope.
 * `?mute=1` (bots / tests) never creates the context, so the game is silent.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.7;
  private lastGulp = 0;
  private readonly muted = isMutedByUrl();

  /** Call from a touch / click handler. */
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

  /** Swallow sound: pitch falls with the item's tier (small = high blip, big = low gulp). */
  gulp(tier: number, group?: string): void {
    const now = performance.now();
    if (now - this.lastGulp < 35) return; // many items at once = one sound
    this.lastGulp = now;
    const f = 620 - tier * 16;
    // Toy Emporium: each kind of toy has its own sound, still pitched by tier
    if (group === 'plush') {
      this.tone(f * 1.1, 0.12, 'sine', 0.24, f * 1.9); // squeak
    } else if (group === 'bricks' || group === 'figures' || group === 'toys') {
      this.tone(f * 1.3, 0.05, 'square', 0.1);
      this.tone(f * 0.9, 0.07, 'square', 0.08, undefined, 0.04); // clack
    } else if (group === 'toyveh' || group === 'robots') {
      this.tone(f * 0.8, 0.09, 'square', 0.1);
      this.tone(f * 1.0, 0.12, 'square', 0.1, undefined, 0.09); // honk
    } else if (group === 'bugs' || group === 'critters') {
      this.tone(f * 1.5, 0.07, 'sine', 0.2, f * 2.2); // squeak
    } else if (group === 'animals' || group === 'giants') {
      this.tone(f * 0.7, 0.2, 'sawtooth', 0.12, f * 0.4); // grunt
    } else if (group === 'hills' || group === 'rocks') {
      this.tone(f * 0.5, 0.18, 'triangle', 0.3, f * 0.25); // thud
    } else if (group === 'lab' || group === 'zoo' || group === 'labveh') {
      this.tone(f * 0.9, 0.06, 'square', 0.1);
      this.tone(f * 0.6, 0.1, 'square', 0.08, undefined, 0.05); // clank
    } else if (
      group === 'material' ||
      group === 'tools' ||
      group === 'crew' ||
      group === 'site'
    ) {
      this.tone(f * 1.2, 0.05, 'square', 0.1);
      this.tone(f * 0.8, 0.07, 'triangle', 0.12, undefined, 0.04); // clack
    } else if (
      group === 'plant' ||
      group === 'trucks' ||
      group === 'cranes' ||
      group === 'mining' ||
      group === 'structures'
    ) {
      this.tone(f * 0.7, 0.1, 'square', 0.1);
      this.tone(f * 0.45, 0.16, 'sawtooth', 0.1, f * 0.3, 0.06); // clank
    } else if (group === 'heaps') {
      this.tone(f * 0.5, 0.2, 'triangle', 0.3, f * 0.22); // thud
    } else if (group === 'outdoor') {
      this.tone(f * 0.6, 0.22, 'sine', 0.24, f * 1.5); // boing
    } else {
      this.tone(f, 0.16, 'sine', 0.25, f * 0.45);
    }
    if (tier > 12) this.tone(f * 0.5, 0.35, 'triangle', 0.22, f * 0.2);
  }

  /** A giant was swallowed: low roar with a falling growl and two thumps. */
  roar(): void {
    this.tone(150, 0.7, 'sawtooth', 0.2, 55);
    this.tone(110, 0.8, 'square', 0.1, 45, 0.04);
    this.tone(70, 0.25, 'sine', 0.4, 35, 0.05); // thump
    this.tone(60, 0.3, 'sine', 0.35, 30, 0.3);
  }

  levelUp(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.22, 'triangle', 0.22, undefined, i * 0.07),
    );
  }

  beep(high = false): void {
    this.tone(high ? 880 : 440, high ? 0.45 : 0.18, 'square', 0.12);
  }

  horn(): void {
    this.tone(196, 0.9, 'sawtooth', 0.16, 180);
    this.tone(247, 0.9, 'sawtooth', 0.12, 220);
  }

  click(): void {
    this.tone(700, 0.05, 'square', 0.08);
  }
}
