import type { Season } from '../../season';
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

/**
 * Knee-high seeding grass (`tall_grass`, straw and green) of summer and autumn: the uncut verge along the road on
 * `cover` (`verge` per 1000 m², to 3.5 m from the edge) and, with `fallow`, stands of it in patches on `fallowCover`
 * further out. None in spring (the stalks have not grown yet).
 */
export const seedingGrass = (o: {
  cover: string[];
  verge: number;
  fallow?: number;
  fallowCover?: string[];
}): ScatterRule[] => [
  {
    asset: 'tall_grass',
    cover: o.cover,
    density: o.verge,
    detail: true,
    minRoadDist: 1,
    maxRoadDist: 3.5,
    maxSlope: 0.6,
    scale: [0.8, 1.2],
    season: ['summer', 'autumn'],
  },
  ...(o.fallow
    ? [
        {
          asset: 'tall_grass',
          cover: o.fallowCover ?? o.cover,
          density: o.fallow,
          detail: true,
          minRoadDist: 3.5,
          maxSlope: 0.5,
          mask: { scale: 45, threshold: 0.1 },
          scale: [0.8, 1.25] as [number, number],
          season: ['summer', 'autumn'] as Season[],
        },
      ]
    : []),
];
