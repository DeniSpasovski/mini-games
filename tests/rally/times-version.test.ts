import { describe, expect, test } from '@rstest/core';
import {
  CAR_TIMES_VERSIONS,
  MAP_TIMES_VERSIONS,
  carTimesVersion,
  isOldRun,
  migrateTimes,
  recordTime,
  timesVersion,
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

const MAP = Object.keys(MAP_TIMES_VERSIONS)[0];
const OTHER = Object.keys(MAP_TIMES_VERSIONS)[1];
const CUR = timesVersion(MAP);

describe('saved times version (per map)', () => {
  test('unversioned times and bests are kept as v0 runs', () => {
    const s = memoryStorage({
      [`rally.times.${MAP}`]: '[{"time":100}]',
      [`rally.best.${MAP}.bimmer_m3`]: '{"total":100,"splits":[]}',
      'rally.quality': 'high',
    });
    expect(migrateTimes(s)).toBe(true);
    const runs = JSON.parse(s.getItem(`rally.times.${MAP}`)!);
    expect(runs.map((r: { ver: number }) => r.ver)).toEqual([0, 0]);
    // the per-car best moved into the leaderboard (no separate reference key left)
    expect(runs.some((r: { car: string }) => r.car === 'bimmer_m3')).toBe(true);
    expect(s.getItem(`rally.best.${MAP}.bimmer_m3`)).toBeNull();
    expect(s.getItem(`rally.timesVersion.${MAP}`)).toBe(String(CUR));
    expect(s.getItem('rally.quality')).toBe('high'); // other settings stay
  });

  test('the old single version key is ignored: those times are v0 too', () => {
    const s = memoryStorage({
      'rally.timesVersion': '1',
      [`rally.times.${MAP}`]: '[{"time":90,"car":"skoda_rally","date":1}]',
    });
    expect(migrateTimes(s)).toBe(true);
    const [run] = JSON.parse(s.getItem(`rally.times.${MAP}`)!);
    expect(run.ver).toBe(0);
    expect(run.carVer).toBe(0);
    expect(isOldRun(run, CUR)).toBe(true);
  });

  test('a bump touches only its map', () => {
    const s = memoryStorage({
      [`rally.timesVersion.${MAP}`]: String(CUR - 1),
      [`rally.timesVersion.${OTHER}`]: String(timesVersion(OTHER)),
      [`rally.times.${MAP}`]: '[{"time":10,"car":"c","date":1}]',
      [`rally.times.${OTHER}`]: '[{"time":10,"car":"c","date":1}]',
      [`rally.best.${OTHER}.c`]: '{"total":10,"splits":[]}',
    });
    expect(migrateTimes(s)).toBe(true);
    expect(JSON.parse(s.getItem(`rally.times.${MAP}`)!)[0].ver).toBe(CUR - 1);
    expect(JSON.parse(s.getItem(`rally.times.${OTHER}`)!)[0].ver).toBe(
      undefined,
    );
    expect(s.getItem(`rally.best.${OTHER}.c`)).not.toBeNull();
  });

  test('old runs list below the current ones, even when faster', () => {
    const s = memoryStorage({
      [`rally.timesVersion.${MAP}`]: String(CUR - 1),
      [`rally.times.${MAP}`]: JSON.stringify([
        { time: 10, car: 'c', date: 1 },
        { time: 20, car: 'c', date: 2, ver: CUR - 2 },
      ]),
    });
    migrateTimes(s);
    const mem = globalThis as { localStorage?: Storage };
    const prev = mem.localStorage;
    mem.localStorage = s;
    try {
      const board = recordTime(MAP, [], {
        time: 99,
        car: 'c',
        livery: 0,
        ver: CUR,
        date: 3,
      });
      expect(board.map((r) => r.time)).toEqual([99, 10, 20]);
      expect(board.map((r) => isOldRun(r, CUR))).toEqual([false, true, true]);
      expect(board[1].ver).toBe(CUR - 1);
    } finally {
      mem.localStorage = prev;
    }
  });

  test('a car bump dims only that car, in every map', () => {
    const s = memoryStorage({
      [`rally.timesVersion.${MAP}`]: String(CUR),
      'rally.carVersion.bimmer_m3': String(carTimesVersion('bimmer_m3') - 1),
      'rally.carVersion.skoda_rally': String(carTimesVersion('skoda_rally')),
      [`rally.times.${MAP}`]: JSON.stringify([
        { time: 10, car: 'bimmer_m3', date: 1 },
        { time: 12, car: 'skoda_rally', date: 2 },
      ]),
      [`rally.best.${MAP}.bimmer_m3`]: '{"total":10,"splits":[]}',
      [`rally.best.${MAP}.skoda_rally`]: '{"total":12,"splits":[]}',
    });
    expect(migrateTimes(s)).toBe(true);
    const runs = JSON.parse(s.getItem(`rally.times.${MAP}`)!);
    expect(runs[0].carVer).toBe(carTimesVersion('bimmer_m3') - 1);
    expect(runs[1].carVer).toBeUndefined();
    expect(isOldRun(runs[0], CUR)).toBe(true);
    expect(isOldRun(runs[1], CUR)).toBe(false);
    // the Bimmer's best moved into the leaderboard as an old run; the Skoda's stays the live reference
    expect(s.getItem(`rally.best.${MAP}.bimmer_m3`)).toBeNull();
    expect(s.getItem(`rally.best.${MAP}.skoda_rally`)).not.toBeNull();
    expect(runs).toHaveLength(2); // the best was already in the list (same car + time): not duplicated
  });

  test('every released car and map has a version', async () => {
    const { ALL_CARS } = await import('../../src/games/rally/cars');
    for (const c of ALL_CARS) expect(CAR_TIMES_VERSIONS[c.id]).toBeDefined();
    const { ALL_MAPS } = await import('../../src/games/rally/maps');
    for (const m of ALL_MAPS) expect(MAP_TIMES_VERSIONS[m.id]).toBeDefined();
  });

  test('test cars and maps stay at version 1 until released', async () => {
    const { TEST_CARS, TEST_MAPS } =
      await import('../../src/games/rally/release');
    for (const id of TEST_CARS) expect(CAR_TIMES_VERSIONS[id]).toBe(1);
    for (const id of TEST_MAPS) expect(MAP_TIMES_VERSIONS[id]).toBe(1);
  });

  test('a fresh player gets every map stamped', () => {
    const s = memoryStorage();
    expect(migrateTimes(s)).toBe(false);
    expect(s.getItem(`rally.timesVersion.${MAP}`)).toBe(String(CUR));
  });
});
