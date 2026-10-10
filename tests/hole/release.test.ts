import { expect, test } from '@rstest/core';
import { MAPS_LIST } from '../../src/games/hole/release';
import { ALL_MAPS } from '../../src/games/hole/map/registry';

test('every registered map is listed once in MAPS_LIST', () => {
  expect(MAPS_LIST.map((e) => e.id).sort()).toEqual(
    ALL_MAPS.map((m) => m.id).sort(),
  );
});

test('the first released map exists (getMapDef falls back to it)', () => {
  expect(MAPS_LIST.some((e) => !e.hideInProd)).toBe(true);
});
