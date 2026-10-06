import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import type { CarSoundDef } from '../../src/games/rally/cars/shared/types';
import {
  cylinderCount,
  engineWave,
  harmonic,
} from '../../src/games/rally/game/engine-sound';

const base: CarSoundDef = {
  layout: 'i4',
  displacement: 2,
  exhaust: 0.5,
  intake: 0.5,
  pops: 0,
  gearWhine: 0,
  gearbox: 'manual',
  cam: 0,
  roughness: 0,
};

/** Energy of the harmonics that are not multiples of the firing order (the "uneven" part of the sound). */
function offOrder(def: CarSoundDef): number {
  const w = engineWave(def);
  const n = cylinderCount(def.layout);
  let off = 0;
  let all = 0;
  for (let k = 1; k <= 40; k++) {
    const a = harmonic(w, k) ** 2;
    all += a;
    if (k % n) off += a;
  }
  return off / all;
}

describe('engine sound', () => {
  test('an even-firing four puts its energy on the firing order', () => {
    const w = engineWave(base);
    const h = (k: number) => harmonic(w, k);
    expect(h(4)).toBeGreaterThan(10 * Math.max(h(1), h(2), h(3), h(5)));
    expect(offOrder(base)).toBeLessThan(1e-3);
  });

  test('a cross-plane V8 burbles: energy between its firing orders', () => {
    expect(
      offOrder({ ...base, layout: 'v8', displacement: 4 }),
    ).toBeGreaterThan(0.05);
    expect(offOrder({ ...base, layout: 'flat4' })).toBeGreaterThan(0.05);
  });

  test('roughness is seeded (same car, same sound)', () => {
    const def = { ...base, roughness: 0.12 };
    expect(engineWave(def).real).toEqual(engineWave(def).real);
    expect(offOrder(def)).toBeGreaterThan(offOrder(base));
  });

  test('every car has a sound profile in range', () => {
    for (const car of ALL_CARS) {
      const s = car.sound;
      for (const v of [s.exhaust, s.intake, s.pops, s.gearWhine, s.cam])
        expect(v >= 0 && v <= 1).toBe(true);
      expect(s.displacement).toBeGreaterThan(0.5);
      const w = engineWave(s);
      expect(w.real.every(Number.isFinite)).toBe(true);
    }
  });
});
