import type { ScatterRule } from './types';

/**
 * Dry meadow grass that is green in spring: the rule as it is in summer and autumn, and in spring the fresh green grass
 * of an April hillside with a few of last year's dry stalks (the spring ground tint is green too).
 */
export const greenInSpring = (r: ScatterRule): ScatterRule[] => [
  { ...r, season: ['summer', 'autumn'] },
  {
    ...r,
    asset: 'spring_grass',
    density: r.density * 0.8,
    season: ['spring'],
  },
  { ...r, density: r.density * 0.2, season: ['spring'] },
];
