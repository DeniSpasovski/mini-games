import type { FlatArea, PathDef } from '../shared/types';

/**
 * The two big car parks on the stage road: the Vidikovec viewpoint lot (beside a hairpin, 1.3 km below the finish) and the
 * Sredno Vodno lot at the finish. OSM draws them as thin aisle lines that stop short of the road; here each is one wide
 * paved ribbon joined to the road, on levelled ground (`flatAreas`).
 */
interface Lot {
  name: string;
  width: number;
  /** Centre line, flat [x0, z0, x1, z1, ...]. */
  pts: number[];
}

const LOTS: Lot[] = [
  {
    name: 'vidikovec_lot',
    width: 16,
    pts: [
      1621, -581, 1608.2, -591.8, 1592.6, -595.9, 1569.3, -596.3, 1549.8,
      -591.7, 1530.6, -585.2, 1507, -573.9,
    ],
  },
  {
    name: 'sredno_lot',
    width: 20,
    pts: [553, -335, 540, -346, 505, -364, 470, -383],
  },
];

/** The baked OSM aisle lines the lots replace (first point, rounded). */
const REPLACED = new Set(['1492,-570', '539,-349', '554,-339']);

export const dropLotAisles = (paths: PathDef[]): PathDef[] =>
  paths.filter(
    (p) => !REPLACED.has(`${Math.round(p.pts[0])},${Math.round(p.pts[1])}`),
  );

export const LOT_PATHS: PathDef[] = LOTS.map((l) => ({
  kind: 'service',
  width: l.width,
  surface: 'tarmac',
  pts: l.pts,
}));

/** Levelled circles along each lot, so the paved ribbon sits on flat ground (blends into the slope outside). */
export const LOT_FLATS: FlatArea[] = LOTS.flatMap((l) => {
  const out: FlatArea[] = [];
  for (let i = 0; i + 3 < l.pts.length; i += 2) {
    const [x0, z0, x1, z1] = l.pts.slice(i, i + 4);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 7));
    for (let k = 0; k <= n; k++) {
      out.push({
        x: x0 + ((x1 - x0) * k) / n,
        z: z0 + ((z1 - z0) * k) / n,
        radius: l.width / 2 + 0.5,
        blend: 7,
        surface: 'tarmac',
        label: false,
      });
    }
  }
  return out;
});
