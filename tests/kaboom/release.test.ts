import { expect, test } from '@rstest/core';
import { GAME_LIST } from '../../src/portal/release';
import { isReleased, released } from '../../src/shared/release';

test('kaboom: listed on the portal in the release build', () => {
  expect(isReleased(GAME_LIST, 'kaboom')).toBe(true);
  expect(released([{ id: 'kaboom' }], GAME_LIST, true)).toHaveLength(1);
  expect(released([{ id: 'kaboom' }], GAME_LIST, false)).toHaveLength(1);
});
