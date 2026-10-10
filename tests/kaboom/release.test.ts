import { expect, test } from '@rstest/core';
import { GAME_LIST } from '../../src/portal/release';
import { isReleased, released } from '../../src/shared/release';

test('kaboom: unlisted on the portal (but still built) while in development', () => {
  const entry = GAME_LIST.find((g) => g.id === 'kaboom');
  expect(entry?.hideInProd).toBe(true);
  expect(isReleased(GAME_LIST, 'kaboom')).toBe(false);
  // the release build drops it, the dev server and `npm run build:test` keep it
  expect(released([{ id: 'kaboom' }], GAME_LIST, true)).toEqual([]);
  expect(released([{ id: 'kaboom' }], GAME_LIST, false)).toHaveLength(1);
});
