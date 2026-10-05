import { describe, expect, test } from '@rstest/core';
import { TIMES_VERSION, purgeStaleTimes } from '../../src/games/rally/game/stage';

/** Minimal in-memory Storage (node has no localStorage). */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('saved times version', () => {
  test('unversioned times (before the physics rework) are erased', () => {
    const s = memoryStorage({
      'rally.times.petralica': '[{"time":100}]',
      'rally.best.petralica.bimmer_m3': '{"total":100,"splits":[]}',
      'rally.quality': 'high',
    });
    expect(purgeStaleTimes(s)).toBe(true);
    expect(s.getItem('rally.times.petralica')).toBeNull();
    expect(s.getItem('rally.best.petralica.bimmer_m3')).toBeNull();
    expect(s.getItem('rally.timesVersion')).toBe(String(TIMES_VERSION));
    expect(s.getItem('rally.quality')).toBe('high'); // other settings stay
  });

  test('times saved under the current version are kept', () => {
    const s = memoryStorage({
      'rally.timesVersion': String(TIMES_VERSION),
      'rally.times.jackie': '[{"time":90}]',
    });
    expect(purgeStaleTimes(s)).toBe(false);
    expect(s.getItem('rally.times.jackie')).toBe('[{"time":90}]');
  });

  test('a fresh player has nothing to erase but gets the version stamped', () => {
    const s = memoryStorage();
    expect(purgeStaleTimes(s)).toBe(false);
    expect(s.getItem('rally.timesVersion')).toBe(String(TIMES_VERSION));
  });
});
