import { paramOneOf } from '../../shared/url-params';

/**
 * Season of a stage: the tree leaf colours (trees/seasons.ts), the ground (maps/shared/season-map.ts) and which of the
 * stage's `temps` apply (maps/shared/day-temperature.ts). A stage opens in `StageDef.season`, else its map's
 * `EnvironmentDef.season`; `?season=spring|summer|autumn` tries the others.
 */
export const SEASONS = ['spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

/** Names in the stage screen's Season dropdown. */
export const SEASON_LABELS: Readonly<Record<Season, string>> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
};

/** The season of a stage and map that name none. */
export const DEFAULT_SEASON: Season = 'summer';

/** The season a `?season=` value names; `fallback` (the stage's) when it is missing or unknown. */
export function seasonParam(
  raw: string | null | undefined,
  fallback: Season,
): Season {
  return paramOneOf(raw, SEASONS, fallback);
}
