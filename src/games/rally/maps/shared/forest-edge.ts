import type { ScatterRule } from './types';

/**
 * The edge a road cuts through a wood: a belt of shrubs (the bush and lilac pack models, in clumps) and young trees of
 * the wood's own species in the light along the verge, where the generated stand would otherwise meet the road as a
 * wall of trunks. `open` covers (scrub, pasture) get a thinner scatter of bushes. Scatter rules for `MapDef.scatter`.
 */
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
  const rules: ScatterRule[] = [
    {
      asset: 'pack_bush',
      cover: o.woods,
      density: 12,
      minRoadDist: 1.5,
      maxRoadDist: 14,
      mask: { scale: 35, threshold: -0.15 },
      scale: [0.8, 1.5],
      sink: 0.1,
    },
    {
      asset: 'pack_lilac',
      cover: o.woods,
      density: 3,
      minRoadDist: 3,
      maxRoadDist: 18,
      mask: { scale: 55, threshold: 0 },
      scale: [0.6, 1.2],
      sink: 0.15,
    },
    ...o.young.map((asset): ScatterRule => ({
      asset,
      cover: o.woods,
      density: 2.4 / o.young.length,
      minRoadDist: 3,
      maxRoadDist: 16,
      mask: { scale: 45, threshold: -0.05 },
      scale: o.youngScale ?? [0.35, 0.6],
      tilt: 3,
      sink: 0.2,
    })),
  ];
  if (o.open?.length)
    rules.push({
      asset: 'pack_bush',
      cover: o.open,
      density: 4,
      minRoadDist: 2,
      maxRoadDist: 22,
      mask: { scale: 40, threshold: 0 },
      scale: [0.7, 1.3],
      sink: 0.1,
    });
  return rules;
}
