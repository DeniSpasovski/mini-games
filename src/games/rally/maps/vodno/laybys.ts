import { Road } from '../../world/road';
import type { PadDef, RoadDef, SidewalkLink } from '../shared/types';

/**
 * The lay-bys along the stage road (m along; side +1 = left going up): a gravel pull-off levelled to the road beside
 * it, the land graded back round it; no parked cars (a closed rally road). (The gravel pull-off at ~2 300 m with the gazebo is a
 * landmark of its own.)
 */
interface Layby {
  from: number;
  to: number;
  side: 1 | -1;
  /** Width past the road edge (m). */
  depth: number;
}

export const LAYBYS: Layby[] = [
  {
    from: 738,
    to: 766,
    side: 1,
    depth: 3.4,
  },
  {
    from: 1098,
    to: 1152,
    side: -1,
    depth: 3.8,
  },
  // (the crescent of crushed stone inside the 3 040 m bend, level with the road)
  {
    from: 3018,
    to: 3076,
    side: 1,
    depth: 7,
  },
  {
    from: 3336,
    to: 3364,
    side: -1,
    depth: 3.4,
  },
];

/** The ends taper over this length (m): the pull-off leaves and joins the verge at a slant. */
const TAPER = 6;

/** The road's plan (no heights: x, z and width only), built once. */
let plan: Road | undefined;
const planOf = (def: RoadDef): Road => (plan ??= new Road(def, () => 0));

/** The lay-bys' pads (a gravel outline beside the road, level with it along its frontage). */
export function laybyPads(def: RoadDef): PadDef[] {
  const road = planOf(def);
  return LAYBYS.map((l, i) => {
    const edge: number[] = [];
    const out: number[] = [];
    const frontage: number[] = [];
    for (let a = l.from; a <= l.to + 1e-6; a += 2) {
      const p = road.at(a);
      const t = Math.min(1, (a - l.from) / TAPER, (l.to - a) / TAPER);
      const lat = (w: number) => l.side * (p.halfWidth + w);
      edge.push(p.x + p.tz * lat(0), p.z - p.tx * lat(0));
      const w = 0.3 + (l.depth - 0.3) * Math.max(0, t);
      out.push(p.x + p.tz * lat(w), p.z - p.tx * lat(w));
      frontage.push(p.x, p.z);
    }
    // the outline: along the road edge, back along the outer line
    const polygon = [...edge];
    for (let k = out.length - 2; k >= 0; k -= 2)
      polygon.push(out[k], out[k + 1]);
    return {
      name: `layby_${i + 1}`,
      polygon,
      blend: 4,
      frontage,
      lift: 0.02,
      surface: 'gravel_loose',
    };
  });
}

/**
 * A kerbed sidewalk along the stage road's own edge (`cityStreets` only dresses the other streets): the kerb line from
 * `from` to `to` m along on `side` (+1 = left), dropped flush at both ends.
 */
export function roadSidewalk(
  def: RoadDef,
  from: number,
  to: number,
  side: 1 | -1,
): SidewalkLink {
  const road = planOf(def);
  const pts: number[] = [];
  for (let a = from; ; a = Math.min(to, a + 2)) {
    const p = road.at(a);
    const lat = side * p.halfWidth;
    pts.push(p.x + p.tz * lat, p.z - p.tx * lat);
    if (a >= to) break;
  }
  return { side, pts, dropStart: true, dropEnd: true };
}
