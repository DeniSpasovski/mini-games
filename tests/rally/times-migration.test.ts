import { afterAll, describe, expect, test } from '@rstest/core';
import {
  bestKey,
  CAR_TIMES_VERSIONS,
  loadBest,
  STAGE_TIMES_VERSIONS,
  isOldRun,
  loadTimes,
  migrateTimes,
  timesVersion,
} from '../../src/games/rally/game/stage';
import { loadSettings } from '../../src/games/rally/game/settings';
import { getStage } from '../../src/games/rally/maps';
import { ALL_CARS } from '../../src/games/rally/cars';

const CAR_IDS = ALL_CARS.map((c) => c.id);

/**
 * The map / stage split must not lose a player's times: every stage that existed before it is the old map's id, and
 * the stored keys (`rally.times.<id>`, `rally.best.<id>.<car>`, `rally.timesVersion.<id>`, `rally.settings` `map`)
 * and version numbers are unchanged. This fills a store the way a player of the release before the split has it
 * and checks that everything still reads as current. It fails when a stage id, a key or a version number changes.
 */

/** The stage ids (= the old map ids) and their times versions in the release before the split. */
const RELEASED_BEFORE_SPLIT: Record<string, number> = {
  test: 1,
  ajvatovci: 1,
  petralica: 1,
  jackie: 1,
};

function memoryStorage(initial: Record<string, string>): Storage {
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

const run = (time: number, car: string, ver?: number) => ({
  time,
  car,
  livery: 2,
  tyre: 'mixed',
  splits: [time / 3, (2 * time) / 3],
  ...(ver === undefined ? {} : { ver, carVer: CAR_TIMES_VERSIONS[car] ?? 1 }),
  date: 1_760_000_000_000 + time,
});

/** What the store of a player of the last release looks like (after that release's own migration). */
function playerBeforeSplit(): Record<string, string> {
  const s: Record<string, string> = {
    'rally.settings': JSON.stringify({
      map: 'jackie',
      car: 'fiesta',
      livery: 2,
    }),
    'rally.times.ajvatovci': JSON.stringify([
      run(312.4, 'skoda_rally', 1),
      run(318.9, 'bimmer_m3', 1),
      // a run from before times versions existed: stays an old run
      run(305.0, 'fiesta', 0),
    ]),
    'rally.times.petralica': JSON.stringify([run(640.2, 'lancer_evo_6', 1)]),
    'rally.times.jackie': JSON.stringify([run(281.7, 'citroen_c4', 1)]),
    'rally.best.petralica.skoda_rally': JSON.stringify({
      total: 655.1,
      splits: [150, 300, 450, 600],
    }),
  };
  for (const [id, v] of Object.entries(RELEASED_BEFORE_SPLIT))
    s[`rally.timesVersion.${id}`] = String(v);
  for (const [car, v] of Object.entries(CAR_TIMES_VERSIONS))
    s[`rally.carVersion.${car}`] = String(v);
  return s;
}

describe('times survive the map / stage split', () => {
  const g = globalThis as { localStorage?: Storage };
  const saved = g.localStorage;
  afterAll(() => {
    g.localStorage = saved;
  });

  test('every stage released before the split keeps its id and times version', () => {
    for (const [id, v] of Object.entries(RELEASED_BEFORE_SPLIT)) {
      expect(STAGE_TIMES_VERSIONS[id]).toBe(v);
      expect(getStage(id).id).toBe(id);
    }
  });

  test('migration leaves a current player store untouched', () => {
    const before = playerBeforeSplit();
    const store = memoryStorage(before);
    // (Stages added since that release get their version keys written: nothing the player had changes.)
    migrateTimes(store);
    for (const [k, v] of Object.entries(before))
      expect(JSON.parse(store.getItem(k)!)).toEqual(JSON.parse(v));
  });

  test('the runs and bests read back as current, the picked stage is kept', () => {
    const store = memoryStorage(playerBeforeSplit());
    migrateTimes(store);
    g.localStorage = store;
    const aj = loadTimes('ajvatovci', CAR_IDS);
    const cur = timesVersion('ajvatovci');
    expect(aj.filter((r) => !isOldRun(r, cur)).map((r) => r.time)).toEqual([
      312.4, 318.9,
    ]);
    expect(aj.filter((r) => isOldRun(r, cur)).map((r) => r.time)).toEqual([
      305.0,
    ]);
    const pe = loadTimes('petralica', CAR_IDS);
    expect(pe.map((r) => r.time)).toEqual([640.2]);
    expect(pe.every((r) => !isOldRun(r, timesVersion('petralica')))).toBe(true);
    // The per-car best (the live split reference) is read by its own key.
    expect(loadBest(bestKey('petralica', 'skoda_rally'))?.total).toBe(655.1);
    expect(loadTimes('jackie', CAR_IDS).map((r) => r.time)).toEqual([281.7]);
    // The menu opens on the last picked stage (settings `map`).
    expect(getStage(loadSettings().map).id).toBe('jackie');
  });
});
