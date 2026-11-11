import type { ScatterRule } from './types';

/**
 * The edge a road cuts through a wood: a belt of shrubs in merged clumps (thicket, hazel and small bushes on one shared
 * clump field, so a clump mixes them) and young trees of the wood's own species in the light along the verge, leafy to
 * the ground and leaning out over the road, where the generated stand would otherwise meet the road as a wall of
 * trunks. `open` covers (scrub, pasture) get thinner bush clumps. Scatter rules for `MapDef.scatter`.
 */
/** Off the road's fill banks (steeper than ~37 deg): nothing roots there or it clips through the bank. */
const SLOPE = 0.2;
/** Clump fields (`mask.group`): the verge belt, the open ground. */
const BELT = 11;
const OPEN = 12;

export function forestEdge(o: {
  /** Land cover classes of the woods. */
  woods: string[];
  /** Generated tree assets the young trees are drawn from (the wood's own species). */
  young: string[];
  /** Scrub / pasture classes that get loose bushes too. */
  open?: string[];
  /** Size of the young trees (x their species' range). */
  youngScale?: [number, number];
}): ScatterRule[] {
  const belt = { scale: 26, threshold: -0.12, group: BELT };
  const rules: ScatterRule[] = [
    {
      asset: 'thicket_shrub',
      cover: o.woods,
      density: 7,
      minRoadDist: 1.6,
      maxRoadDist: 14,
      mask: belt,
      scale: [0.7, 1.2],
      maxSlope: SLOPE,
      sink: 0.15,
    },
    {
      asset: 'hazelnut_tree',
      cover: o.woods,
      density: 3,
      minRoadDist: 2.5,
      maxRoadDist: 18,
      mask: belt,
      scale: [0.75, 1.15],
      maxSlope: SLOPE,
      lean: { deg: [2, 5], within: 10 },
      sink: 0.15,
    },
    {
      asset: 'bush',
      cover: o.woods,
      density: 5,
      minRoadDist: 1.4,
      maxRoadDist: 12,
      mask: belt,
      scale: [0.6, 1.1],
      maxSlope: SLOPE,
      sink: 0.1,
    },
    ...o.young.map((asset): ScatterRule => ({
      asset,
      cover: o.woods,
      density: 2.4 / o.young.length,
      minRoadDist: 2.5,
      maxRoadDist: 16,
      mask: { scale: 45, threshold: -0.05 },
      scale: o.youngScale ?? [0.35, 0.6],
      tilt: 2,
      lean: { deg: [2, 6], within: 14 },
      maxSlope: SLOPE,
      sink: 0.2,
    })),
  ];
  if (o.open?.length)
    rules.push(
      {
        asset: 'bush',
        cover: o.open,
        density: 4,
        minRoadDist: 2,
        maxRoadDist: 22,
        mask: { scale: 30, threshold: 0.05, group: OPEN },
        scale: [0.7, 1.2],
        maxSlope: SLOPE,
        sink: 0.1,
      },
      {
        asset: 'scrub_bush',
        cover: o.open,
        density: 3,
        minRoadDist: 2,
        maxRoadDist: 22,
        mask: { scale: 30, threshold: 0.05, group: OPEN },
        scale: [0.8, 1.3],
        maxSlope: SLOPE,
        sink: 0.1,
      },
    );
  return rules;
}
