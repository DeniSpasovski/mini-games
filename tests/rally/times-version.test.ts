import { describe, expect, test } from '@rstest/core';
import {
  TIMES_VERSION,
  isOldRun,
  recordTime,
  migrateTimes,
} from '../../src/games/rally/game/stage';

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
  test('unversioned times are kept, tagged v0; per-car bests are erased', () => {
    const s = memoryStorage({
      'rally.times.petralica': '[{"time":100}]',
      'rally.best.petralica.bimmer_m3': '{"total":100,"splits":[]}',
      'rally.quality': 'high',
    });
    expect(migrateTimes(s)).toBe(true);
    expect(JSON.parse(s.getItem('rally.times.petralica')!)[0].ver).toBe(0);
    expect(s.getItem('rally.best.petralica.bimmer_m3')).toBeNull();
    expect(s.getItem('rally.timesVersion')).toBe(String(TIMES_VERSION));
    expect(s.getItem('rally.quality')).toBe('high'); // other settings stay
  });

  test('times saved under the current version are kept', () => {
    const s = memoryStorage({
      'rally.timesVersion': String(TIMES_VERSION),
      'rally.times.jackie': '[{"time":90}]',
    });
    expect(migrateTimes(s)).toBe(false);
    expect(s.getItem('rally.times.jackie')).toBe('[{"time":90}]');
  });

  test('a bump keeps old runs below the current ones', () => {
    const s = memoryStorage({
      'rally.timesVersion': String(TIMES_VERSION - 1),
      'rally.times.m': JSON.stringify([
        { time: 10, car: 'c', date: 1 },
        { time: 20, car: 'c', date: 2, ver: TIMES_VERSION - 2 },
      ]),
    });
    expect(migrateTimes(s)).toBe(true);
    const mem = globalThis as { localStorage?: Storage };
    const prev = mem.localStorage;
    mem.localStorage = s;
    try {
      const board = recordTime('m', [], {
        time: 99,
        car: 'c',
        livery: 0,
        date: 3,
      });
      expect(board.map((r) => r.time)).toEqual([99, 10, 20]);
      expect(board.map((r) => isOldRun(r))).toEqual([false, true, true]);
      expect(board[1].ver).toBe(TIMES_VERSION - 1);
    } finally {
      mem.localStorage = prev;
    }
  });

  test('a fresh player has nothing to erase but gets the version stamped', () => {
    const s = memoryStorage();
    expect(migrateTimes(s)).toBe(false);
    expect(s.getItem('rally.timesVersion')).toBe(String(TIMES_VERSION));
  });
});
