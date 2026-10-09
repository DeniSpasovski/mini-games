/**
 * Portal game list: card order and release state - the ONLY place to change which games the release build lists.
 *
 * Every `src/games/<id>/game.json` is listed once, in card order. `hideInProd: true` = under construction: no portal
 * card in the release build (`npm run build`), but the game is still built and `games/<id>/` plays for anyone with the
 * link; the dev server and `npm run build:test` list it. Remove the flag to release it (add its `thumbnail.jpg`).
 * Same flag as the car / map lists in each game's `release.ts` (`src/shared/release.ts`).
 *
 * tests/portal-manifest.test.ts checks every game folder is listed once. DOM-free.
 */
import type { ReleaseEntry } from '../shared/release';

export const GAME_LIST: readonly ReleaseEntry[] = [
  { id: 'rally' },
  { id: 'hole' },
  { id: 'kaboom', hideInProd: true },
];
