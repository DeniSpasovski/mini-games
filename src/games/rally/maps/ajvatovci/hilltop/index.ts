import { getAssetMeta } from '../../../assets/catalog';
import { hash3 } from '../../../../../shared/rng';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import type { ScatterInstance } from '../../../world/scatter';
import { buildHilltop } from './build';
import { HOOP_POLES } from './build/court';
import { Rng } from '../../../../../shared/rng';
import {
  benches,
  DRIVE_WIDTH,
  driveDistance,
  FENCE,
  fencePillars,
  FLOWER_BEDS,
  FORECOURT,
  gateLeaves,
  GATES,
  inCourtyard,
  inPolygon,
  PARKING,
  TENT_HALF,
  TENTS,
  WALL,
  wallPieces,
  YARD_TREES,
} from './yard';
import {
  CHURCH,
  CHURCH_RECT,
  COURT,
  COURT_RECT,
  PORCH_RECT,
  TOWER,
  TOWER_RECT,
  toLocal,
  toWorld,
  type Site,
} from './site';

/**
 * Ajvatovci Hill's hilltop: the church of St. Peter and St. Paul with its bell tower in the monastery
 * courtyard at the finish (lawn, a paved drive, event marquees, benches, trees; a low concrete wall round
 * it and an iron fence + gate on the car park side; the placeholder boxes in it are removed) and the
 * village playground court by the hill road junction, modelled by hand from photos. Positions in `site.ts`
 * (OSM outlines) and `yard.ts`, geometry in `build/`, notes and sources in the map's DETAILS.md ("Hilltop
 * church and court"). Pure data here - safe in node.
 */

const AREAS: { site: Site; rect: readonly [number, number, number, number] }[] =
  [
    { site: CHURCH, rect: CHURCH_RECT },
    { site: CHURCH, rect: PORCH_RECT },
    { site: TOWER, rect: TOWER_RECT },
    { site: COURT, rect: COURT_RECT },
  ];

/** Box collider round a local rectangle of a site, from `y` up `h` metres. */
function box(
  site: Site,
  [x0, x1, z0, z1]: readonly [number, number, number, number],
  y: number,
  h: number,
): StaticCollider {
  const [x, z] = toWorld(site, (x0 + x1) / 2, (z0 + z1) / 2);
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  // three.js yaw maps local +X to (cos t, -sin t): the site's axis runs along +yaw from +X towards +Z.
  return {
    kind: 'box',
    x,
    z,
    y,
    h,
    hx,
    hz,
    rot: -site.yaw,
    r: Math.hypot(hx, hz),
  };
}

function cylinder(
  site: Site,
  lx: number,
  lz: number,
  y: number,
  r: number,
  h: number,
): StaticCollider {
  const [x, z] = toWorld(site, lx, lz);
  return { kind: 'cylinder', x, z, y, r, h };
}

/** Garden plants round the church (photos ref-52 / 53: junipers, a fir by the porch, shrubs). */
const PLANTS: {
  asset: string;
  site: Site;
  x: number;
  z: number;
  scale: number;
}[] = [
  { asset: 'juniper', site: CHURCH, x: -5.4, z: 6.1, scale: 0.7 },
  { asset: 'juniper', site: CHURCH, x: -1.3, z: 6.1, scale: 0.6 },
  { asset: 'pine_tree', site: CHURCH, x: -0.6, z: 4.6, scale: 0.32 },
  { asset: 'bush', site: CHURCH, x: 1.2, z: 4.3, scale: 0.55 },
  { asset: 'bush', site: CHURCH, x: 3.4, z: 4.0, scale: 0.5 },
  { asset: 'bush', site: CHURCH, x: -6.4, z: -2.6, scale: 0.6 },
  { asset: 'juniper', site: CHURCH, x: 7.3, z: -2.9, scale: 0.55 },
  { asset: 'bush', site: CHURCH, x: 2.5, z: -4.3, scale: 0.5 },
  { asset: 'birch_tree', site: CHURCH, x: -9.5, z: 7.5, scale: 0.75 },
  { asset: 'juniper', site: TOWER, x: 2.6, z: 2.4, scale: 0.6 },
  { asset: 'bush', site: TOWER, x: -2.5, z: 2.3, scale: 0.55 },
];

/** Inside the church / porch / tower / court rectangles grown by `margin`. */
const onSolid = (x: number, z: number, margin: number): boolean =>
  AREAS.some(({ site, rect }) => {
    if (Math.abs(x - site.x) > 40 || Math.abs(z - site.z) > 40) return false;
    const [lx, lz] = toLocal(site, x, z);
    return (
      lx > rect[0] - margin &&
      lx < rect[1] + margin &&
      lz > rect[2] - margin &&
      lz < rect[3] + margin
    );
  });

/** Box collider at a world point, `angle` = its local +x direction (from +X towards +Z). */
const flatBox = (
  x: number,
  z: number,
  angle: number,
  hx: number,
  hz: number,
  y0: number,
  y1: number,
): StaticCollider => ({
  kind: 'box',
  x,
  z,
  y: y0,
  h: y1 - y0,
  hx,
  hz,
  rot: -angle,
  r: Math.hypot(hx, hz),
});

export const hilltopLandmark: Landmark = {
  id: 'ajvatovci-hilltop',

  occupies: (x, z, margin) =>
    inCourtyard(x, z, margin) ||
    onSolid(x, z, margin) ||
    inPolygon(PARKING, x, z) ||
    inPolygon(FORECOURT, x, z),

  // The gate apron and the car park: no junction barrier row / marshals (the parking aisle meets the
  // stage road there) - the map's barrier row across the road's end closes it (map.ts props).
  keepsClear: (x, z) =>
    inPolygon(FORECOURT, x, z) ||
    inPolygon(PARKING, x, z) ||
    Math.hypot(x - GATES[0].x, z - GATES[0].z) < 14,

  // Every placeholder box standing in the courtyard (the church 1031, the bell tower 1029, the hall and
  // the houses round it): the courtyard is open lawn round the church and tower.
  replaces: (b) => inCourtyard(b.x, b.z),

  // Asphalt gate apron, gravel car park, paved drive, lawn in the courtyard, tarmac court.
  surfaceAt: (x, z) => {
    if (inPolygon(FORECOURT, x, z)) return 'tarmac';
    if (inPolygon(PARKING, x, z)) return 'gravel';
    if (inCourtyard(x, z, 2))
      return driveDistance(x, z) <= DRIVE_WIDTH / 2
        ? 'tarmac'
        : inCourtyard(x, z)
          ? 'grass'
          : undefined;
    if (Math.abs(x - COURT.x) > 20 || Math.abs(z - COURT.z) > 20)
      return undefined;
    const [lx, lz] = toLocal(COURT, x, z);
    return lx > COURT_RECT[0] &&
      lx < COURT_RECT[1] &&
      lz > COURT_RECT[2] &&
      lz < COURT_RECT[3]
      ? 'tarmac'
      : undefined;
  },

  colliders: (ground: TerrainSampler): StaticCollider[] => {
    const g = (x: number, z: number) => ground.height(x, z);
    const base = (s: Site) => ground.height(s.x, s.z) - 0.8;
    const yc = base(CHURCH);
    const yt = base(TOWER);
    const yk = base(COURT);
    return [
      // Nave, central block, apse, porch posts.
      box(CHURCH, [-5.3, 4.2, -3.1, 3.1], yc, 6.6),
      box(CHURCH, [-1.6, 1.6, -3.4, 3.4], yc, 7.6),
      cylinder(CHURCH, 4.2, 0, yc, 2.5, 5.2),
      ...[-4.88, -3.375, -1.87].map((x) =>
        cylinder(CHURCH, x, 5.4, yc, 0.12, 3.4),
      ),
      // Bell tower (solid, although the ground floor is an open porch).
      box(TOWER, [-1.75, 1.75, -1.75, 1.75], yt, 9.5),
      // Basketball poles.
      ...HOOP_POLES.map((x) => cylinder(COURT, x, 0, yk, 0.1, 4.3)),
      // The low courtyard wall (a kerb-high barrier), the front fence up to its railing.
      ...wallPieces(g).map((p) =>
        flatBox(
          p.x,
          p.z,
          p.angle,
          p.length / 2,
          p.front ? 0.2 : WALL.thickness / 2,
          p.y0,
          p.y1 + (p.front ? FENCE.rail : 0),
        ),
      ),
      ...fencePillars(g).map((p) =>
        flatBox(p.x, p.z, p.angle, 0.27, 0.27, p.y0, p.y1),
      ),
      ...gateLeaves().map((l) =>
        flatBox(
          l.x,
          l.z,
          l.angle,
          l.length / 2,
          0.04,
          g(l.x, l.z),
          g(l.x, l.z) + 2,
        ),
      ),
      // Benches, the marquees' poles and table sets, the flower beds.
      ...benches().map((b) =>
        flatBox(
          b.x,
          b.z,
          b.yaw,
          0.9,
          0.25,
          g(b.x, b.z) - 0.2,
          g(b.x, b.z) + 0.85,
        ),
      ),
      ...TENTS.flatMap((t) => {
        const y = g(t.x, t.z) - 0.5;
        return [
          ...[
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ].map(([sx, sz]) =>
            cylinder(t, sx * TENT_HALF, sz * TENT_HALF, y, 0.06, 2.9),
          ),
          box(t, [-1.2, 1.2, -2.15, -0.15], y, 1.25),
          box(t, [-1.2, 1.2, 0.15, 2.15], y, 1.25),
        ];
      }),
      ...FLOWER_BEDS.map(([x, z]): StaticCollider => ({
        kind: 'cylinder',
        x,
        z,
        y: g(x, z) - 0.2,
        r: 0.75,
        h: 0.65,
      })),
    ];
  },

  instances: (ground: TerrainSampler): ScatterInstance[] => {
    const plant = (
      asset: string,
      x: number,
      z: number,
      scale: number,
      i: number,
    ): ScatterInstance => {
      const h = hash3(i, 7, 3, 4207);
      return {
        asset,
        variant: h % getAssetMeta(asset).variants,
        x,
        y: ground.height(x, z),
        z,
        rotY: ((h >>> 8) % 628) / 100,
        scale,
        tiltX: 0,
        tiltZ: 0,
      };
    };
    const out = PLANTS.map((p, i) =>
      plant(p.asset, ...toWorld(p.site, p.x, p.z), p.scale, i),
    );
    YARD_TREES.forEach(([asset, x, z, scale], i) =>
      out.push(plant(asset, x, z, scale, 100 + i)),
    );
    // Tufts of grass over the courtyard lawn (it is kept free of the map's scatter): off the drive, the
    // buildings, the marquees and the benches.
    const rng = new Rng(4211);
    const spots = [...TENTS, ...benches()];
    for (let k = 0, n = 0; k < 2400 && n < 520; k++) {
      const x = 1481 + rng.next() * 62;
      const z = -559 + rng.next() * 94;
      if (
        !inCourtyard(x, z, -0.6) ||
        driveDistance(x, z) < DRIVE_WIDTH / 2 + 0.3
      )
        continue;
      if (onSolid(x, z, 0.4)) continue;
      if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < 3.6)) continue;
      out.push(
        plant(
          rng.chance(0.7) ? 'spring_grass' : 'dry_grass',
          x,
          z,
          0.7 + rng.next() * 0.6,
          200 + n++,
        ),
      );
    }
    return out;
  },

  build: buildHilltop,
};

export { HILLTOP_FLATS } from './site';
