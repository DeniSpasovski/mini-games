import { describe, expect, it } from '@rstest/core';
import { ALL_CARS, DEFAULT_CAR } from '../../src/games/rally/cars';
import { ALL_MAPS, DEFAULT_MAP } from '../../src/games/rally/maps';
import {
  AVAILABLE_CARS,
  AVAILABLE_MAPS,
  released,
  TEST_CARS,
  TEST_MAPS,
} from '../../src/games/rally/release';

describe('release flags', () => {
  it('published build keeps only the available ids, dev shows all', () => {
    const defs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(released(defs, ['c', 'a'], false).map((d) => d.id)).toEqual([
      'a',
      'c',
    ]);
    expect(released(defs, ['a'], true).map((d) => d.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  // A new car / map must be added to TEST_CARS / TEST_MAPS (or AVAILABLE_*) in release.ts.
  it('every registered car is in exactly one of AVAILABLE_CARS / TEST_CARS', () => {
    const listed = [...AVAILABLE_CARS, ...TEST_CARS];
    expect([...listed].sort()).toEqual(ALL_CARS.map((c) => c.id).sort());
  });

  it('every registered map is in exactly one of AVAILABLE_MAPS / TEST_MAPS', () => {
    const listed = [...AVAILABLE_MAPS, ...TEST_MAPS];
    expect([...listed].sort()).toEqual(ALL_MAPS.map((m) => m.id).sort());
  });

  it('defaults are available (they are the fallback for hidden ids)', () => {
    expect(AVAILABLE_CARS).toContain(DEFAULT_CAR);
    expect(AVAILABLE_MAPS).toContain(DEFAULT_MAP);
  });

  it('test-only cars are never in the published list', () => {
    for (const id of TEST_CARS) expect(AVAILABLE_CARS).not.toContain(id);
  });
});
