import { expect, test } from '@rstest/core';
import { AVAILABLE_MAPS, TEST_MAPS } from '../../src/games/hole/release';
import { ALL_MAPS } from '../../src/games/hole/map/registry';

test('every registered map is in exactly one release list', () => {
  for (const m of ALL_MAPS) {
    const n =
      Number(AVAILABLE_MAPS.includes(m.id)) + Number(TEST_MAPS.includes(m.id));
    expect(n, m.id).toBe(1);
  }
  for (const id of [...AVAILABLE_MAPS, ...TEST_MAPS])
    expect(
      ALL_MAPS.some((m) => m.id === id),
      id,
    ).toBe(true);
});
