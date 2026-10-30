import { describe, expect, it } from '@rstest/core';
import { ALL_CARS, DEFAULT_CAR } from '../../src/games/rally/cars';
import { ALL_STAGES, DEFAULT_STAGE } from '../../src/games/rally/maps';
import {
  CARS_LIST,
  STAGES_LIST,
  WEATHERS_LIST,
  released,
} from '../../src/games/rally/release';
import { WEATHERS } from '../../src/games/rally/weather';
import { isReleased } from '../../src/shared/release';

describe('release flags', () => {
  it('published build drops hideInProd (and unlisted) ids, dev shows all', () => {
    const defs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const entries = [{ id: 'c' }, { id: 'a' }, { id: 'b', hideInProd: true }];
    expect(released(defs, entries, true).map((d) => d.id)).toEqual(['a', 'c']);
    expect(released(defs, entries, false).map((d) => d.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  // A new car / map needs a row (with `hideInProd: true` while it is a test) in release.ts.
  it('every registered car is listed once in CARS_LIST', () => {
    expect(CARS_LIST.map((e) => e.id).sort()).toEqual(
      ALL_CARS.map((c) => c.id).sort(),
    );
  });

  it('every registered stage is listed once in STAGES_LIST', () => {
    expect(STAGES_LIST.map((e) => e.id).sort()).toEqual(
      ALL_STAGES.map((m) => m.id).sort(),
    );
  });

  it('every weather is listed once in WEATHERS_LIST', () => {
    expect(WEATHERS_LIST.map((e) => e.id).sort()).toEqual([...WEATHERS].sort());
  });

  it('defaults are released (they are the fallback for hidden ids)', () => {
    expect(isReleased(CARS_LIST, DEFAULT_CAR)).toBe(true);
    expect(isReleased(STAGES_LIST, DEFAULT_STAGE)).toBe(true);
    expect(isReleased(WEATHERS_LIST, 'dry')).toBe(true);
  });
});
