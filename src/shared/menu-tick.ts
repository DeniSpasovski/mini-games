import { isMutedByUrl } from './mute-param';

/** A short, quiet menu "tick" for pages without their own sound (the portal). Context is created on first use. */
export class MenuTick {
  private ctx: AudioContext | null = null;
  private readonly muted = isMutedByUrl();

  constructor(
    private freq = 900,
    private type: OscillatorType = 'triangle',
    /** Master volume 0..1 (the game's own setting). */
    private volume: () => number = () => 1,
  ) {}

  private last = 0;

  play(): void {
    const now = performance.now();
    if (now - this.last < 40) return; // focus + selection change in one move = one tick
    this.last = now;
    const v = this.volume();
    if (this.muted || v <= 0) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') void ctx.resume();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = this.type;
      o.frequency.value = this.freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07 * v, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.06);
    } catch {
      this.ctx = null;
    }
  }
}
