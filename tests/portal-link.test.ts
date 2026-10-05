import { expect, test } from '@rstest/core';
import { portalUrl } from '../src/shared/portal-link';

test('portal link: game inside the portal points two folders up', () => {
  expect(portalUrl('https://deni.io/games/hole/')).toBe('https://deni.io/');
  expect(portalUrl('https://deni.io/games/rally/index.html?map=x')).toBe(
    'https://deni.io/',
  );
  expect(portalUrl('https://deni.io/sub/games/rally/map-viewer.html')).toBe(
    'https://deni.io/sub/',
  );
  expect(portalUrl('http://localhost:3000/games/hole/#a')).toBe(
    'http://localhost:3000/',
  );
});

test('portal link: standalone game has none', () => {
  expect(portalUrl('https://deni.io/')).toBeNull();
  expect(portalUrl('https://hole.deni.io/index.html')).toBeNull();
  expect(portalUrl('https://deni.io/games/')).toBeNull();
  expect(portalUrl('https://deni.io/games/hole/extra/page.html')).toBeNull();
});
