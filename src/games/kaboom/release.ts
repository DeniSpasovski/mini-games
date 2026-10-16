/**
 * Release list of the Kaboom levels: which ones the published build offers. Same flag as `game.json` and the rally
 * lists (`src/shared/release.ts`): `hideInProd: true` = dev server and `npm run build:test` only. Every level in
 * `game/levels.ts` is listed once (tests/kaboom/levels.test.ts checks).
 */
import { isReleased, released, type ReleaseEntry } from '../../shared/release';
import { LEVEL_IDS, type LevelId } from './game/levels';

export const LEVELS_LIST: readonly ReleaseEntry[] = [
  { id: 'quarry' },
  { id: 'valley', hideInProd: true },
  { id: 'sea', hideInProd: true },
];

/** The levels this build offers (all of them on the dev server and in test builds). */
export const offeredLevels = (release?: boolean): LevelId[] =>
  released(
    LEVEL_IDS.map((id) => ({ id })),
    LEVELS_LIST,
    release,
  ).map((l) => l.id);

export const isTestLevel = (id: LevelId): boolean =>
  !isReleased(LEVELS_LIST, id);
