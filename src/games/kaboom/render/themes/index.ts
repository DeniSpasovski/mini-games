import type { LevelId } from '../../game/levels';
import { QUARRY_THEME } from './quarry';
import { SEA_THEME } from './sea';
import { VALLEY_THEME } from './valley';
import type { LevelTheme } from './theme';

export type { LevelTheme } from './theme';

const THEMES: Record<LevelId, LevelTheme> = {
  quarry: QUARRY_THEME,
  valley: VALLEY_THEME,
  sea: SEA_THEME,
};

/** The look of a level. */
export const levelTheme = (id: LevelId): LevelTheme => THEMES[id];
