import { Rng } from '../../../shared/rng';
import type { CarSoundDef, EngineLayout } from '../cars/shared/types';

/**
 * Engine tone from the firing order (DOM-free, game/audio.ts plays it). An engine's exhaust repeats once per 4-stroke
 * cycle (720° of crank), so one cycle of exhaust pressure - a pulse per firing - is turned into the harmonics of a
 * Web Audio PeriodicWave played at rpm / 120 Hz. Even firing (inline 4 / 6) gives a clean buzz at the firing order;
 * a cross-plane V8 (pulses alternating unevenly between two banks) and a boxer with unequal headers put energy
 * between those orders: the burble / rumble.
 */

interface Firing {
  /** Crank angle (deg in the 720° cycle) of each firing. */
  angles: number[];
  /** Exhaust each pulse leaves through (bank / header group). */
  banks: number[];
  /** Per exhaust: level and extra pipe delay (deg) on the way to the listener. */
  pipes: [gain: number, delay: number][];
  /** Extra delay per firing (deg): unequal header lengths. */
  headers?: number[];
}

const even = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => (i * 720) / n);

const FIRING: Record<EngineLayout, Firing> = {
  i4: { angles: even(4), banks: [0, 0, 0, 0], pipes: [[1, 0]] },
  i5: { angles: even(5), banks: [0, 0, 0, 0, 0], pipes: [[1, 0]] },
  i6: { angles: even(6), banks: [0, 0, 0, 0, 0, 0], pipes: [[1, 0]] },
  // Firing order 1-8-4-3-6-5-7-2, cylinders 1/3/5/7 on bank 0: L R R L R L L R. The two banks reach the listener at
  // different levels and times (pipe lengths, the car between them), which leaves the uneven pattern audible.
  v8: {
    angles: even(8),
    banks: [0, 1, 1, 0, 1, 0, 0, 1],
    pipes: [
      [1, 0],
      [0.72, 14],
    ],
  },
  // Firing order 1-3-2-4, 1/3 on one side; unequal-length headers smear the pulses = the boxer rumble.
  flat4: {
    angles: even(4),
    banks: [0, 0, 1, 1],
    pipes: [
      [1, 0],
      [0.85, 6],
    ],
    headers: [0, 34, 12, 46],
  },
};

/** Cylinders per layout (firing frequency = rpm / 120 x cylinders). */
export function cylinderCount(layout: EngineLayout): number {
  return FIRING[layout].angles.length;
}

/** Harmonics in the wave (at 9000 rpm the 140th of 75 Hz is 10.5 kHz, above that the low-pass removes it anyway). */
const HARMONICS = 140;
const SAMPLES = 2880;

/** Alpha pulse: 0 at x = 0, peak 1 at x = 1, long decay. */
const alpha = (x: number): number => (x <= 0 ? 0 : x * Math.exp(1 - x));

/**
 * One 4-stroke cycle of exhaust pressure as PeriodicWave coefficients (index 0 = DC = 0). Bigger cylinders give
 * longer, softer pulses; `roughness` adds cylinder-to-cylinder variation (seeded, so a car always sounds the same).
 */
export function engineWave(def: CarSoundDef): {
  real: Float32Array<ArrayBuffer>;
  imag: Float32Array<ArrayBuffer>;
} {
  const f = FIRING[def.layout];
  const cylL = def.displacement / f.angles.length;
  // Pulse rise (crank deg): ~24° for a 0.3 l cylinder, ~31° for 0.5 l.
  const tau = 14 + 34 * cylL;
  const rng = new Rng(Math.round(def.displacement * 1000) + f.angles.length);
  const rough = def.roughness ?? 0.05;
  const x = new Float32Array(SAMPLES);
  for (let e = 0; e < f.angles.length; e++) {
    const [gain, delay] = f.pipes[f.banks[e]];
    const amp = gain * (1 + (rng.next() * 2 - 1) * rough);
    const at =
      f.angles[e] +
      delay +
      (f.headers?.[e] ?? 0) +
      (rng.next() - 0.5) * rough * 20;
    for (let i = 0; i < SAMPLES; i++) {
      // Distance after the firing, wrapped into the cycle.
      const d = ((((i / SAMPLES) * 720 - at) % 720) + 720) % 720;
      // Blow-down pulse, then a weaker rarefaction (the reflection back from the open pipe end).
      x[i] +=
        amp * (alpha(d / tau) - 0.45 * alpha((d - 2.2 * tau) / (1.6 * tau)));
    }
  }
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let k = 1; k <= HARMONICS; k++) {
    let a = 0;
    let b = 0;
    const w = (2 * Math.PI * k) / SAMPLES;
    for (let i = 0; i < SAMPLES; i++) {
      a += x[i] * Math.cos(w * i);
      b += x[i] * Math.sin(w * i);
    }
    real[k] = (2 * a) / SAMPLES;
    imag[k] = (2 * b) / SAMPLES;
  }
  return { real, imag };
}

/** Amplitude of harmonic k of the cycle frequency (tests, tuning). */
export function harmonic(
  wave: { real: Float32Array; imag: Float32Array },
  k: number,
): number {
  return Math.hypot(wave.real[k], wave.imag[k]);
}
