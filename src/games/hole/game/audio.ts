import { isMutedByUrl } from '../../../shared/mute-param';
import bellHeavy000 from '../assets/sounds/impact_bell_heavy_000.ogg';
import genericLight000 from '../assets/sounds/impact_generic_light_000.ogg';
import genericLight001 from '../assets/sounds/impact_generic_light_001.ogg';
import metalHeavy000 from '../assets/sounds/impact_metal_heavy_000.ogg';
import metalLight000 from '../assets/sounds/impact_metal_light_000.ogg';
import metalMedium000 from '../assets/sounds/impact_metal_medium_000.ogg';
import mining000 from '../assets/sounds/impact_mining_000.ogg';
import plateHeavy000 from '../assets/sounds/impact_plate_heavy_000.ogg';
import plateLight000 from '../assets/sounds/impact_plate_light_000.ogg';
import punchHeavy000 from '../assets/sounds/impact_punch_heavy_000.ogg';
import punchMedium000 from '../assets/sounds/impact_punch_medium_000.ogg';
import softHeavy000 from '../assets/sounds/impact_soft_heavy_000.ogg';
import softHeavy001 from '../assets/sounds/impact_soft_heavy_001.ogg';
import softMedium000 from '../assets/sounds/impact_soft_medium_000.ogg';
import softMedium001 from '../assets/sounds/impact_soft_medium_001.ogg';
import tinMedium000 from '../assets/sounds/impact_tin_medium_000.ogg';
import tinMedium001 from '../assets/sounds/impact_tin_medium_001.ogg';
import woodLight000 from '../assets/sounds/impact_wood_light_000.ogg';
import woodLight001 from '../assets/sounds/impact_wood_light_001.ogg';
import woodMedium000 from '../assets/sounds/impact_wood_medium_000.ogg';

/** Kenney "Impact Sounds" (CC0), see `DETAILS.md` -> Audio. */
const FILES: Record<string, string> = {
  bellHeavy000,
  genericLight000,
  genericLight001,
  metalHeavy000,
  metalLight000,
  metalMedium000,
  mining000,
  plateHeavy000,
  plateLight000,
  punchHeavy000,
  punchMedium000,
  softHeavy000,
  softHeavy001,
  softMedium000,
  softMedium001,
  tinMedium000,
  tinMedium001,
  woodLight000,
  woodLight001,
  woodMedium000,
};

/** Most sample voices at once, and the slowest playback (a big tier must not stretch a hit into seconds). */
const MAX_VOICES = 24;
const MIN_RATE = 0.4;

/** One gulp voice: impact samples (random pick) at `gain`, plus the synth voice scaled by `synth` (0 = none). */
interface Voice {
  samples: string[];
  gain: number;
  /** Playback rate before the tier pitch (1 = as recorded). */
  rate: number;
  synth: number;
}

const SOFT = ['softMedium000', 'softMedium001'];
const VOICES: Record<string, Voice> = {
  squeak: { samples: SOFT, gain: 0.45, rate: 1.3, synth: 0.6 },
  clack: {
    samples: ['woodLight000', 'woodLight001', 'plateLight000'],
    gain: 0.6,
    rate: 1.1,
    synth: 0,
  },
  honk: {
    samples: ['tinMedium000', 'tinMedium001'],
    gain: 0.5,
    rate: 1,
    synth: 0.55,
  },
  grunt: {
    samples: ['softHeavy000', 'softHeavy001', 'punchMedium000'],
    gain: 0.7,
    rate: 0.9,
    synth: 0.5,
  },
  thud: {
    samples: ['mining000', 'softHeavy000', 'punchHeavy000'],
    gain: 0.8,
    rate: 0.8,
    synth: 0,
  },
  clank: {
    samples: ['plateLight000', 'metalLight000', 'metalMedium000'],
    gain: 0.55,
    rate: 1,
    synth: 0,
  },
  tool: {
    samples: ['woodMedium000', 'metalLight000'],
    gain: 0.6,
    rate: 1,
    synth: 0,
  },
  heavy: {
    samples: ['metalHeavy000', 'plateHeavy000', 'metalMedium000'],
    gain: 0.6,
    rate: 0.85,
    synth: 0.3,
  },
  boing: { samples: SOFT, gain: 0.45, rate: 1.1, synth: 0.6 },
  plain: {
    samples: ['genericLight000', 'genericLight001'],
    gain: 0.6,
    rate: 1,
    synth: 0.5,
  },
};

/** Item group -> voice (unlisted groups use `plain`). */
const GROUP_VOICE: Record<string, string> = {
  plush: 'squeak',
  bugs: 'squeak',
  critters: 'squeak',
  bricks: 'clack',
  figures: 'clack',
  toys: 'clack',
  toyveh: 'honk',
  robots: 'honk',
  animals: 'grunt',
  giants: 'grunt',
  hills: 'thud',
  rocks: 'thud',
  heaps: 'thud',
  lab: 'clank',
  zoo: 'clank',
  labveh: 'clank',
  material: 'tool',
  tools: 'tool',
  crew: 'tool',
  site: 'tool',
  plant: 'heavy',
  trucks: 'heavy',
  cranes: 'heavy',
  mining: 'heavy',
  structures: 'heavy',
  outdoor: 'boing',
};

/**
 * WebAudio sfx: CC0 impact samples layered with a tiny oscillator synth. The
 * context is created lazily on the first user gesture (iOS requires it) and the
 * samples load right after it; until they are there (or when a file fails) the
 * synth plays alone. `?mute=1` (bots / tests) never creates the context, so the
 * game is silent and no file is requested.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.7;
  private lastGulp = 0;
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Scale of the synth layer while a sample sound plays (1 = synth alone). */
  private mix = 1;
  private readonly muted = isMutedByUrl();
  private loading = false;
  /** Sample voices still playing (capped so a burst cannot pile up nodes). */
  private active = 0;

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
        // a hidden tab stops sounding (its tails would play on after the game pauses)
        document.addEventListener('visibilitychange', this.onVisibility);
      }
      if (this.buffers.size === 0) void this.loadSamples(this.ctx); // first call, or retry after a failed load
      if (this.ctx.state !== 'running') void this.ctx.resume(); // also iOS 'interrupted'
      this.master!.gain.value = this.volume;
    } catch {
      this.ctx = null;
    }
  }

  private onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  };

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Fetch + decode every sample; one that fails stays missing (its voice falls back to the synth). */
  private async loadSamples(ctx: AudioContext): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    await Promise.all(
      Object.entries(FILES).map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
        } catch {
          /* synth fallback */
        }
      }),
    );
    this.loading = false;
  }

  /** One-shot sample; false when it is not loaded. */
  private sample(name: string, gain: number, rate: number, delay = 0): boolean {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !this.master || !buf || this.volume <= 0) return false;
    if (this.active >= MAX_VOICES) return false;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = Math.min(Math.max(rate, MIN_RATE), 2.5);
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      g.disconnect();
    };
    src.start(ctx.currentTime + delay);
    return true;
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
    g.gain.exponentialRampToValueAtTime(
      Math.max(gain * this.mix, 0.0002),
      t0 + 0.012,
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** Swallow sound: pitch falls with the item's tier (small = high, big = low); a sample per group, the synth voice under it. */
  gulp(tier: number, group?: string): void {
    const now = performance.now();
    if (now - this.lastGulp < 35) return; // many items at once = one sound
    this.lastGulp = now;
    const v = VOICES[GROUP_VOICE[group ?? ''] ?? 'plain'];
    const rate = v.rate * Math.pow(0.94, tier) * (0.94 + Math.random() * 0.12);
    const name = v.samples[Math.floor(Math.random() * v.samples.length)];
    const sampled = this.sample(name, v.gain, rate);
    if (sampled && tier > 12) this.sample('softHeavy001', 0.6, 0.55);
    this.mix = sampled ? v.synth : 1;
    if (this.mix > 0) this.gulpSynth(tier, group);
    this.mix = 1;
  }

  private gulpSynth(tier: number, group?: string): void {
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

  /** A giant was swallowed: slowed-down impacts for the body, the synth growl and thumps on top. */
  roar(): void {
    const sampled =
      this.sample('punchHeavy000', 0.9, 0.5) &&
      this.sample('softHeavy000', 0.9, 0.4, 0.02) &&
      this.sample('mining000', 0.7, 0.55, 0.3);
    this.mix = sampled ? 0.7 : 1;
    this.tone(150, 0.7, 'sawtooth', 0.2, 55);
    this.tone(110, 0.8, 'square', 0.1, 45, 0.04);
    this.tone(70, 0.25, 'sine', 0.4, 35, 0.05); // thump
    this.tone(60, 0.3, 'sine', 0.35, 30, 0.3);
    this.mix = 1;
  }

  /** Bell chime up a major arpeggio, the synth chime quietly underneath. */
  levelUp(): void {
    const rates = [1, 1.26, 1.5, 2];
    const sampled = rates
      .map((r, i) => this.sample('bellHeavy000', 0.5, r * 1.2, i * 0.08))
      .every(Boolean);
    this.mix = sampled ? 0.45 : 1;
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.22, 'triangle', 0.22, undefined, i * 0.07),
    );
    this.mix = 1;
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

  /** Menu highlight moved: a short quiet tick. */
  tick(): void {
    this.tone(880, 0.04, 'triangle', 0.06);
  }
}
