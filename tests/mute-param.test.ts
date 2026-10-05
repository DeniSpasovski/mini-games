import { expect, test } from '@rstest/core';
import { isMutedByUrl } from '../src/shared/mute-param';

test('mute param: only mute=1 / mute=true silence the game', () => {
  expect(isMutedByUrl('?mute=1')).toBe(true);
  expect(isMutedByUrl('?map=x&mute=true')).toBe(true);
  expect(isMutedByUrl('?mute=0')).toBe(false);
  expect(isMutedByUrl('?mute=')).toBe(false);
  expect(isMutedByUrl('')).toBe(false);
});
