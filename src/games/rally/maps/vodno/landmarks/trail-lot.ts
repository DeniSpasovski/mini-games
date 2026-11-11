import { BufferAttribute, BufferGeometry, Color } from 'three';
import { Noise2D, smoothstep } from '../../../../../shared/noise';
import { hash3 } from '../../../../../shared/rng';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import { Raster } from '../../../world/real-data';
import { Piles } from '../../shared/piles';
import type { PathDef, RasterDef } from '../../shared/types';
import canopy from '../canopy.json';
import { cylinderCollider, type Local, type V2, type V3 } from './common';
import {
  bin,
  gazebo,
  logRail,
  parkingSign,
  picnicTable,
  solarLamp,
} from './park';
import { toLocal, toWorld, type Area, type Site } from './sites';
import { smoothHeights, unitV, wallRibbon, type WallRun } from './stone-wall';

/**
 * Around the big hairpin (~2 000 m along the road; the car park and trail start ~1 830 m), all from OSM: the side road "Сончев Град" closed to motor traffic
 * (`barrier=block`, node 3070145534) by sand and gravel piles across it; the hikers' car park below the hairpin
 * (`amenity=parking`, way 37998024) with low dry-stone walls along its long sides, solar lamps, a P sign and a bin, the
 * picnic shelter at its far end (way 1534237148); and across the road from its entrance, where the footpath west (way
 * 500249730) leaves the road, the trail start: three stone posts across the path, one with the red-white trail mark, and
 * picnic tables under the tall black pines of the plantation there.
 * World metres; sizes from the owner's photos (`sources/maps/vodno/NOTES.md`).
 */

/** The block node on the side road, turned along the road (local +x = up the road). */
export const SIDE_ROAD_BLOCK: Site = { x: 2162.3, z: -38.1, yaw: -1.528 };
/** The piles (ref-03, `maps/shared/piles.ts`): local x along the road, z across it, radius, height, kind. */
const PILES = new Piles(SIDE_ROAD_BLOCK, [
  [0, -3.7, 2.9, 1.5, 'sand'],
  [0.8, -0.2, 3, 0.55, 'spread'],
  [-0.3, 3, 2.5, 1.3, 'sand'],
  [2.4, 5.6, 2.3, 0.45, 'spread'],
  [3.7, -1.5, 1.9, 0.9, 'stone'],
  [-2.2, 0.9, 1.5, 0.6, 'stone'],
]);
const pileNoise = new Noise2D(5711);

/** Weeds on the piles and round their feet (ref-03: grass sprouting from the sand). */
export const PILE_PLANTS = PILES.plants();

/** The trail start (5 m up the footpath from the road's west edge): local +x = along the path into the wood. */
export const TRAIL_START: Site = { x: 2076, z: -210.25, yaw: 3.095 };
/**
 * The footpath west from the road opposite the car park (OSM way 500249730, which the bake drops): a worn earth path from
 * the road's verge up the bank, through the posts and into the pines.
 */
export const TRAIL_PATH: PathDef = {
  kind: 'path',
  width: 1.4,
  surface: 'dirt',
  junction: false,
  // prettier-ignore
  pts: [2080.2, -210.45, 2076.6, -210.3, 2066.6, -209.8, 2060.5, -211, 2054, -213.4, 2040.6, -217.7, 2003.9, -213.7, 1977.3, -216, 1965, -219.9, 1959.9, -223.5, 1950.1, -221.8],
};
/**
 * Clumps of low herbs beside the path's mouth (ref-13): on the road's bank and either side of the posts, the most on the
 * right (north) where the bank catches the light; grass tufts on the litter, no painted lawn (TRAIL_START local centre
 * x, z, radii along / across).
 */
const TRAIL_HERBS: [number, number, number, number][] = [
  [-2.4, 1.6, 0.9, 0.45],
  [0.6, 1.5, 0.55, 0.3],
  [2.8, 1.45, 0.5, 0.3],
  [-2.2, -1.55, 0.6, 0.35],
  [1.7, -1.5, 0.45, 0.25],
  [5.6, 1.6, 0.5, 0.3],
];
/** The herbs' plants: asset, scale and its spread (bramble ~1.1 m, bush ~1.5 m, scrub ~1.2 m, grass tuft ~0.5 m at 1). */
const HERB_KINDS: [string, number, number][] = [
  ['bramble_shrub', 0.22, 0.12],
  ['bramble_shrub', 0.22, 0.12],
  ['bush', 0.15, 0.08],
  ['scrub_bush', 0.17, 0.08],
  ['grass_tuft', 0.45, 0.2],
];
/** The stone posts across the path (local z), the middle one marked. */
const POSTS = [-1.1, 0, 1.15];
/**
 * Grass and shrubs either side of the earth path past the posts (ref-13: a worn path between grassy verges, scrub on the
 * right): TRAIL_START local x along the path, z across it, asset, scale.
 */
export const TRAIL_VERGE: [number, number, string, number][] = [
  // Patches of low forest herbs (ref-13: mixed, dull greens, many broad-leaved, knee-low at most): the broadleaf shrubs
  // grown 0.2-0.35 m (bramble = trailing broad leaves, bush = fresher rounded ones, scrub = dark olive), a few grass
  // tufts among them; three to four plants a patch.
  ...TRAIL_HERBS.flatMap(([cx, cz, rx, rz], i) =>
    Array.from(
      { length: 3 + (i % 2) },
      (_, k): [number, number, string, number] => {
        const u = (j: number) => (hash3(i, k, j, 131) % 1000) / 1000;
        const kind = HERB_KINDS[Math.floor(u(4) * HERB_KINDS.length)];
        return [
          cx + (u(1) - 0.5) * rx * 1.4,
          cz + (u(2) - 0.5) * rz * 1.4,
          kind[0],
          kind[1] + kind[2] * u(3),
        ];
      },
    ),
  ),
  [4, -2.1, 'bramble_shrub', 0.28],
  [7.5, 1.9, 'grass_tuft', 0.55],
  [8.2, -1.7, 'bush', 0.2],
  [2.5, 3.4, 'thicket_shrub', 0.8],
  [6, 3.2, 'bush', 0.8],
  [4.5, -3.6, 'bush', 0.7],
  // The full bush on the bank right of the mouth (ref-13): hazel and thicket 2.5-4 m out from the path's line, their
  // crowns 1.7 m and more off the road's edge (local x -4.2), the posts and the mouth left in view from the road.
  [0.4, 3.4, 'hazelnut_tree', 0.78],
  [-0.9, 4.9, 'thicket_shrub', 1.15],
  [1.9, 4.6, 'hazelnut_tree', 0.68],
];

/** The car park outline (OSM way 37998024, world x, z), the two long sides from the road end. */
const LOT_SIDES: [V2, V2][] = [
  [
    [2088.3, -218.5],
    [2118.5, -236.9],
  ],
  [
    [2088.7, -205.9],
    [2124.2, -227.5],
  ],
];
/** The walls start this far into the lot from its road end (m): the entrance stays open. */
const WALL_FROM = 4;

/**
 * The picnic shelter at the car park's far end (OSM way 1534237148, baked as a house box: replaced) - an open timber gazebo
 * with tables - and two tables under the pines past the trail start's posts (world x, z, heading).
 */
export const TRAIL_SHELTER: Site = { x: 2134, z: -239.5, yaw: 0.2 };
export const TRAIL_SHELTER_APOTHEM = 3.4;
export const TRAIL_TABLES: [number, number, number][] = [
  [2067.15, -207.2, 0.25],
  [2063.4, -212.4, 1.7],
];
/** Baked boxes this replaces: the shelter (2693) and a Microsoft ML "garage" in the middle of the car park (2694). */
export const TRAIL_LOT_REPLACES = new Set([2693, 2694]);
/** The owner-placed tall black pines over the trail start and its tables (world x, z; the plantation's edge). */
const TRAIL_PINES_SET: [number, number][] = [
  [2071.4, -215.4],
  [2069.9, -203.9],
  [2066.4, -213.9],
  [2063.9, -204.4],
  [2060.4, -215.9],
  [2058.9, -206.4],
  [2055.4, -212.9],
  [2053.4, -202.9],
  [2068.4, -220.9],
  [2061.4, -221.9],
  [2072.4, -198.9],
  [2056.4, -219.4],
];
/**
 * The plantation round the trail start (ref-14: many slim straight trunks 3-4 m apart): the set pines, then one per free
 * 3.4 m cell of the stand (a pine keeps 3 m from the next, 1.3 m off the path, clear of the posts, tables and the road's
 * bank), where the canopy height model (Meta / WRI, `canopy.json`) reads a stand of 9 m or more (it reads ~12 m here, the
 * photos ~20-22 m: it underestimates tall conifers, so the heights follow it relative to that). World x, z and scale of
 * the `tall_black_pine` (scaled to the stand's 18-25 m).
 */
export const TRAIL_PINES: [number, number, number][] = [];
/** `tall_black_pine`'s mean height at scale 1 (m; ~17.4 m x its species scale). */
const TALL_PINE_H = 18;
/** Oaks and hornbeams standing among the pines (world x, z, asset, scale). */
export const TRAIL_STAND_OAKS: [number, number, string, number][] = [];
{
  const chm = new Raster(canopy.height as RasterDef);
  // A tall black pine: the stand's height (the canopy model's, 1.75 x, 18-25 m) over the species' own (TALL_PINE_H).
  const pineAt = (x: number, z: number, k: number): number => {
    const u = (j: number) =>
      (hash3(Math.round(x), Math.round(z), k + 10 * j, 7) % 100) / 100;
    const h =
      Math.max(18, Math.min(25, 1.75 * chm.at(x, z))) * (0.92 + 0.16 * u(2));
    return h / TALL_PINE_H;
  };
  const clear = (x: number, z: number) =>
    trailDistance(x, z) > 1.3 &&
    Math.hypot(x - TRAIL_START.x, z - TRAIL_START.z) > 2.6 &&
    !TRAIL_TABLES.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2.3);
  for (const [x, z] of TRAIL_PINES_SET) {
    TRAIL_PINES.push([x, z, pineAt(x, z, 1)]);
  }
  const CELL = 3.4;
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const h = (k: number) => (hash3(i, j, k, 211) % 1000) / 1000;
      const x = 2042 + (i + 0.2 + 0.6 * h(1)) * CELL;
      const z = -228 + (j + 0.2 + 0.6 * h(2)) * CELL;
      if (x > 2074.5 || chm.at(x, z) < 9 || !clear(x, z)) continue;
      if (TRAIL_PINES.some(([px, pz]) => Math.hypot(x - px, z - pz) < 3))
        continue;
      // Every sixth free cell: an oak or a hornbeam among the pines instead.
      if (h(3) < 0.16)
        TRAIL_STAND_OAKS.push([
          x,
          z,
          h(4) < 0.6 ? 'oak_tree' : 'hornbeam_tree',
          0.75 + 0.2 * h(5),
        ]);
      else {
        TRAIL_PINES.push([x, z, pineAt(x, z, 2)]);
      }
    }
}
export const TRAIL_UNDERSTOREY: [number, number][] = [
  [2073.4, -214],
  [2073, -205.5],
  [2064.4, -200.4],
  [2059.4, -213.4],
];

/** Distance (m) from a world point to the trail's line. */
function trailDistance(x: number, z: number): number {
  const p = TRAIL_PATH.pts;
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i];
    const dz = p[i + 3] - p[i + 1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - p[i]) * dx + (z - p[i + 1]) * dz) / (dx * dx + dz * dz),
      ),
    );
    best = Math.min(best, Math.hypot(x - p[i] - dx * t, z - p[i + 1] - dz * t));
  }
  return best;
}

/**
 * The thick deciduous undergrowth the path runs through (the owner's street view: a wall of 1-4 m shrubs and saplings either
 * side, thickest on the north side down the slope): one plant per 1.7 m cell beside the first 25 m of the path, low shrubs at
 * its edge, hazel and saplings behind them, young hornbeams and oaks further out; clear of the road, the tables and the pine
 * trunks. World x, z, asset, scale.
 */
export const TRAIL_SCRUB: [number, number, string, number][] = [];
{
  const CELL = 1.7;
  const low = ['bush', 'bramble_shrub', 'scrub_bush', 'bush'];
  const mid = ['thicket_shrub', 'hazelnut_tree', 'young_tree', 'scrub_bush'];
  const tall = ['hornbeam_tree', 'young_tree', 'oak_tree', 'hazelnut_tree'];
  for (let i = 0; i < 18; i++)
    for (let j = 0; j < 12; j++) {
      const h = (k: number) => (hash3(i, j, k, 83) % 1000) / 1000;
      const x = 2049 + (i + 0.15 + 0.7 * h(1)) * CELL;
      const z = -225 + (j + 0.15 + 0.7 * h(2)) * CELL;
      const d = trailDistance(x, z);
      // (north = the path's right side going in, below its line: the thick side)
      const north = z < (x > 2066.6 ? -210.3 : -209.8 - (2066.6 - x) * 0.3);
      // (the road's bank: low and sparse, the posts stay in sight; south of the path: an open floor under the big trees)
      const bank = x > 2072.5;
      const keep = north ? (bank ? 0.5 : 0.8) : bank ? 0.2 : 0.4;
      if (x > 2079.2 || d < 1.6 || d > 8 || h(3) > keep) continue;
      if (TRAIL_TABLES.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2.8))
        continue;
      if (TRAIL_PINES.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.1))
        continue;
      const k = Math.floor(h(4) * 4);
      const s = h(5);
      if (d < 2.8 || bank) TRAIL_SCRUB.push([x, z, low[k], 0.45 + 0.3 * s]);
      else if (d < 4.8 || !north)
        TRAIL_SCRUB.push([x, z, mid[k], 0.4 + 0.2 * s]);
      else
        TRAIL_SCRUB.push([
          x,
          z,
          tall[k],
          k === 1 || k === 3 ? 0.5 + 0.2 * s : 0.26 + 0.14 * s,
        ]);
    }
}

/**
 * The grass island inside the hairpin (the owner's photos): a log rail fence 1.6 m off the road edge round the loop
 * (world x, z along the inner edge, 1 960-2 045 m; open at the gazebo's side), a green-roofed gazebo in the widest part
 * and two picnic tables beside it.
 */
// prettier-ignore
const ISLAND_RAIL: V2[][] = [
  [
    [2125.4, -97.4], [2129.4, -94.7], [2133, -91.9], [2136.2, -88.8], [2139.3, -85.4], [2142, -81.8], [2144, -78.2],
    [2144.9, -75], [2144.6, -71.9], [2143.3, -68.8], [2141, -66.3], [2138.3, -64.6], [2135.1, -64], [2132.1, -64.5],
  ],
  [
    [2126.1, -69], [2123.1, -72.4], [2120.6, -76],
  ],
];
export const ISLAND_GAZEBO: Site = { x: 2132.5, z: -78, yaw: 0.7 };
const ISLAND_GAZEBO_APOTHEM = 3;
const ISLAND_TABLES: [number, number, number][] = [
  [2126.5, -82.5, 0.7],
  [2137.5, -72.5, 2.2],
];
export const ISLAND_PLANTS: [number, number, string][] = [
  [2140.5, -80.5, 'bush'],
  [2122.5, -86, 'young_tree'],
  [2131, -68.5, 'bush'],
];

/** The car park's gravel (the `trail_lot` pad, local +x = from the road into the lot). */
const LOT: Site = { x: 2105.4, z: -223.1, yaw: -0.561 };

export const TRAIL_LOT_AREAS: Area[] = [
  { site: LOT, rect: [-24, 21, -7.6, 7.6] },
  // the path mouth past the posts
  { site: TRAIL_START, rect: [-2, 9, -2, 2] },
  { site: ISLAND_GAZEBO, r: ISLAND_GAZEBO_APOTHEM + 1 },
  ...ISLAND_TABLES.map(([x, z]) => ({ site: { x, z, yaw: 0 }, r: 2.2 })),
  { site: SIDE_ROAD_BLOCK, rect: [-4.5, 8, -7.5, 8.5] },
  { site: TRAIL_START, r: 2.5 },
  { site: TRAIL_SHELTER, r: TRAIL_SHELTER_APOTHEM + 0.8 },
  ...TRAIL_TABLES.map(([x, z]) => ({ site: { x, z, yaw: 0 }, r: 2.2 })),
];

export function trailLotColliders(g: TerrainSampler): StaticCollider[] {
  const out: StaticCollider[] = [];
  out.push(
    ...PILES.colliders(
      cylinderCollider,
      g.height(SIDE_ROAD_BLOCK.x, SIDE_ROAD_BLOCK.z) - 0.4,
    ),
  );
  const y1 = g.height(TRAIL_START.x, TRAIL_START.z) - 0.4;
  for (const z of POSTS)
    out.push(cylinderCollider(TRAIL_START, 0, z, y1, 0.16, 1.15));
  out.push(
    cylinderCollider(
      TRAIL_SHELTER,
      0,
      0,
      g.height(TRAIL_SHELTER.x, TRAIL_SHELTER.z) - 0.6,
      TRAIL_SHELTER_APOTHEM * 1.05,
      3,
    ),
  );
  for (const [x, z, yaw] of [...TRAIL_TABLES, ...ISLAND_TABLES])
    out.push(
      cylinderCollider({ x, z, yaw }, 0, 0, g.height(x, z) - 0.3, 1.05, 1.1),
    );
  out.push(
    cylinderCollider(
      ISLAND_GAZEBO,
      0,
      0,
      g.height(ISLAND_GAZEBO.x, ISLAND_GAZEBO.z) - 0.6,
      ISLAND_GAZEBO_APOTHEM * 1.05,
      3,
    ),
  );
  return out;
}

/** Weathered stone of the posts (ref-13: warm beige sandstone, each a little different; the kit's calm `wall` stone). */
const POST_TINTS = ['#ecc488', '#e0b67c', '#f0cc92'];
/** Warm grey-beige limestone of the flat stones round the posts and in the tread (over the same scan). */
const SLAB_TINTS = ['#b5a185', '#a8957a', '#bba88c'];
/** Weathering on the posts (linear colour multipliers): dirt and lichen splashed up from the ground, darker arrises. */
const POST_FOOT: V3 = [0.42, 0.42, 0.3];
const POST_EDGE = 0.72;

/**
 * A post's face a (bottom left), b, c, d (top left) in `rows` (0..1 up it) x 4 columns, each vertex coloured by
 * `weather(point, across 0..1)` over `color`.
 */
function postFace(
  l: Local,
  [a, b, c, d]: V3[],
  rows: number[],
  out: V3,
  color: string,
  weather: (p: V3, across: number) => V3,
  uvOf: (p: V3) => [number, number],
): void {
  const cols = [0, 0.12, 0.88, 1];
  const lerp = (p: V3, q: V3, t: number): V3 => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    p[2] + (q[2] - p[2]) * t,
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const n = Math.hypot(...out) || 1;
  for (const t of rows) {
    const lo = lerp(a, d, t);
    const hi = lerp(b, c, t);
    for (const s of cols) {
      const p = lerp(lo, hi, s);
      pos.push(...p);
      nor.push(out[0] / n, out[1] / n, out[2] / n);
      uv.push(...uvOf(p));
      col.push(...weather(p, s));
    }
  }
  const idx: number[] = [];
  const C = cols.length;
  for (let r = 0; r + 1 < rows.length; r++)
    for (let k = 0; k + 1 < C; k++) {
      const i = r * C + k;
      idx.push(i, i + 1, i + C + 1, i, i + C + 1, i + C);
    }
  // (winding: the kit's `add` keeps it; make it face `out`)
  const e1 = [pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]];
  const e2 = [
    pos[C * 3] - pos[0],
    pos[C * 3 + 1] - pos[1],
    pos[C * 3 + 2] - pos[2],
  ];
  const fn = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  if (fn[0] * out[0] + fn[1] * out[1] + fn[2] * out[2] < 0)
    for (let i = 0; i < idx.length; i += 3)
      [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  l.add('wall', g, color);
}

/**
 * A rough-cut stone post (ref-13): ~0.24 m across the path, 0.2 m thick, knee-low (the marked one the tallest), tapering
 * a little, its corners and bevelled top uneven, leaning a few degrees; `mark` = the trail blaze on the face towards the
 * car park (-x): a red ring round a white centre. Its foot: flat stones (`TRAIL_SLABS`).
 */
function stonePost(
  l: Local,
  z: number,
  mark: boolean,
  seed: number,
  gy: number,
): void {
  const u = (k: number) => (hash3(seed, k, 1, 9) % 1000) / 1000;
  const leanX = (u(3) - 0.5) * 0.1;
  const leanZ = (u(4) - 0.5) * 0.12;
  const hgt = mark ? 0.6 : 0.47 + u(5) * 0.08;
  const W = 0.12;
  const D = 0.1;
  const color = POST_TINTS[seed % POST_TINTS.length];
  // Half sizes at a height: a 6 % taper to the shoulder, then the bevel; each corner off square by up to 1.2 cm.
  const shoulder = hgt - 0.05;
  const ring = (y: number, k: number, r: number): V3[] =>
    [
      [-D, -W],
      [D, -W],
      [D, W],
      [-D, W],
    ].map(([dx, dz], c): V3 => {
      // (corners 0 and 3 share their x: the blazed face towards the road stays flat)
      const jx = (u(20 + (c === 3 ? 0 : c) + 4 * r) - 0.5) * 0.024;
      const jz = (u(40 + c + 4 * r) - 0.5) * 0.024;
      // The top's corners at uneven heights (a hand-dressed head).
      const jy = r === 2 ? (u(60 + c) - 0.5) * 0.05 : 0;
      return [dx * k + jx + leanX * y, y + jy, z + dz * k + jz + leanZ * y];
    });
  const taper = (y: number) => 1 - (0.06 * (y + 0.3)) / (shoulder + 0.3);
  const rings = [
    ring(-0.3, 1, 0),
    ring(shoulder, taper(shoulder), 1),
    ring(hgt, 0.72, 2),
  ];
  // Each post a little lighter / darker and warmer / greyer; its foot's dirt line wanders.
  const value = 0.9 + 0.16 * u(7);
  const grey = 0.06 * u(8);
  // (from the ground at the post, `gy`: its foot is set a little into it)
  const footTop = 0.2 + 0.12 * u(9);
  const weather = (p: V3, across: number): V3 => {
    const foot =
      1 -
      smoothstep(
        0,
        footTop,
        p[1] - gy + 0.06 * pileNoise.noise2(p[0] * 9 + seed * 3, p[2] * 9),
      );
    // (blotches of lichen and grime up the face, fewer higher up)
    const blot =
      0.3 *
      smoothstep(
        0.15,
        0.6,
        pileNoise.noise2(p[0] * 11 + seed, p[1] * 8 + p[2] * 11),
      ) *
      (1 - 0.6 * smoothstep(gy, hgt, p[1]));
    const edge =
      1 -
      (1 - POST_EDGE) * (1 - smoothstep(0, 0.2, Math.min(across, 1 - across)));
    const k = Math.min(1, foot + blot);
    return [0, 1, 2].map(
      (i) =>
        value *
        edge *
        (1 - k + k * POST_FOOT[i]) *
        (1 - grey * (i === 0 ? 1 : i === 1 ? 0.5 : 0)),
    ) as V3;
  };
  for (let r = 0; r < 2; r++)
    for (let s = 0; s < 4; s++) {
      const a = rings[r][s];
      const b = rings[r][(s + 1) % 4];
      const c = rings[r + 1][(s + 1) % 4];
      const d = rings[r + 1][s];
      const nx = b[2] - a[2];
      const nz = a[0] - b[0];
      // Outward: away from the post's axis.
      const mx = (a[0] + b[0]) / 2 - leanX * a[1];
      const mz = (a[2] + b[2]) / 2 - z - leanZ * a[1];
      const out: V3 = nx * mx + nz * mz > 0 ? [nx, 0, nz] : [-nx, 0, -nz];
      const along = s % 2 ? [0, 1] : [1, 0];
      // The shaft in rows (ground line, dirt line, clean stone) and columns (dark arrises), the bevel one row.
      const rows =
        r === 0
          ? [-0.3, -0.02, 0.08, 0.18, 0.3, shoulder].map(
              (y) => (y + 0.3) / (shoulder + 0.3),
            )
          : [0, 1];
      postFace(l, [a, b, c, d], rows, out, color, weather, (p) => [
        p[0] * along[0] + (p[2] - z) * along[1] + seed * 0.7,
        p[1],
      ]);
    }
  const tc = weather([0, hgt, z], 0.5);
  const top =
    '#' +
    new Color(color)
      .multiply(new Color(tc[0], tc[1], tc[2]))
      .multiplyScalar(0.92)
      .getHexString();
  l.fan('wall', rings[2], top, [0, 1, 0], (p) => [p[0], p[2]]);
  if (mark) {
    const y0 = hgt - 0.22;
    const t = (y0 + 0.3) / (shoulder + 0.3);
    const x = rings[0][0][0] + (rings[1][0][0] - rings[0][0][0]) * t - 0.004;
    const disc = (r: number, dx: number, c: string) =>
      l.fan(
        'paint',
        Array.from({ length: 16 }, (_, k): V3 => {
          const a = (k / 16) * Math.PI * 2;
          return [
            x - dx,
            y0 + Math.sin(a) * r,
            z + leanZ * y0 + Math.cos(a) * r,
          ];
        }),
        c,
        [-1, 0, 0],
        (p) => [p[2], p[1]],
      );
    disc(0.07, 0, '#b3262a');
    disc(0.038, 0.003, '#efede6');
  }
}

/**
 * Flat stones round the posts' feet, in the tread and on the road's bank (ref-13): TRAIL_START local centre x, z, half
 * sizes along / across, turn (rad), how far the top stands out of the ground (m).
 */
// prettier-ignore
const TRAIL_SLABS: [number, number, number, number, number, number][] = [
  [-0.26, 0.12, 0.24, 0.15, 0.4, 0.04], [0.2, -0.17, 0.18, 0.12, -0.3, 0.035], [0.06, 0.27, 0.12, 0.09, 1.1, 0.03],
  [-0.2, 0.98, 0.22, 0.15, 0.2, 0.045], [0.22, 1.33, 0.15, 0.1, 0.9, 0.035],
  [-0.22, -1.26, 0.19, 0.13, -0.5, 0.04], [0.18, -0.9, 0.14, 0.1, 0.3, 0.03],
  [1.6, 0.22, 0.26, 0.17, 0.6, 0.03], [3.1, -0.28, 0.2, 0.14, -0.2, 0.025], [4.4, 0.32, 0.16, 0.11, 1, 0.02],
  [-3.2, -2.05, 0.32, 0.09, 0.25, 0.06], [-3.05, 2.3, 0.28, 0.08, -0.15, 0.05],
];

/**
 * Pine roots across the tread near the posts (ref-13): TRAIL_START local control points (x, z) from the trunk side out,
 * radius (m) at the first; each tapers to 40 % and lies half sunk, just over the path's tread.
 */
// prettier-ignore
const TRAIL_ROOTS: [V2[], number][] = [
  [[[1.6, 2.6], [1.0, 1.25], [0.55, 0.25], [0.15, -0.65], [-0.15, -1.4]], 0.085],
  [[[2.7, -2.5], [2.25, -1.05], [2.4, 0.1], [2.05, 0.95]], 0.075],
  [[[0.5, 1.75], [0.25, 0.95], [-0.05, 0.5]], 0.06],
  [[[3.9, 2.3], [3.45, 0.85], [3.65, -0.3], [3.25, -1.25]], 0.075],
  [[[5.7, -2.1], [5.25, -0.65], [5.5, 0.6]], 0.07],
  [[[-0.5, 0.95], [-0.85, 0.25], [-0.65, -0.45]], 0.05],
];

/** Flat stones sunk into the ground: an irregular slab, top `above` m out of the ground, its sides down into it. */
function trailSlabs(l: Local, ground: (x: number, z: number) => number): void {
  const N = 11;
  TRAIL_SLABS.forEach(([cx, cz, rx, rz, turn, above], i) => {
    const u = (k: number) => (hash3(i, k, 3, 151) % 1000) / 1000;
    const tilt = (u(9) - 0.5) * 0.04;
    const color = SLAB_TINTS[i % SLAB_TINTS.length];
    // (the sides earthy and in the slab's own shade: they show only where the ground dips)
    const side = '#' + new Color(color).multiplyScalar(0.62).getHexString();
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const top: V3[] = [];
    const bot: V3[] = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const r = 0.78 + 0.27 * u(k);
      const ax = Math.cos(a) * rx * r;
      const az = Math.sin(a) * rz * r;
      const x = cx + ax * c - az * s;
      const z = cz + ax * s + az * c;
      const [wx, wz] = toWorld(l.site, x, z);
      const g = ground(wx, wz) - l.baseY;
      top.push([x, g + above * 0.6 + (tilt * ax) / Math.max(rx, 1e-3), z]);
      bot.push([x, g - 0.08, z]);
    }
    // The top: a low dome round a centre a little higher than the rim (a weathered, rounded slab).
    const [wcx, wcz] = toWorld(l.site, cx, cz);
    // (set into the earth: 60 % of `above` out of it)
    const mid: V3 = [cx, ground(wcx, wcz) - l.baseY + above * 0.6 + 0.012, cz];
    for (let k = 0; k < N; k++)
      l.tri(
        'limestone',
        mid,
        top[k],
        top[(k + 1) % N],
        color,
        [
          [mid[0] + i, mid[2]],
          [top[k][0] + i, top[k][2]],
          [top[(k + 1) % N][0] + i, top[(k + 1) % N][2]],
        ],
        [0, 1, 0],
      );
    for (let k = 0; k < N; k++) {
      const a = top[k];
      const b = top[(k + 1) % N];
      const out: V3 = [(a[0] + b[0]) / 2 - cx, 0, (a[2] + b[2]) / 2 - cz];
      const along = Math.hypot(b[0] - a[0], b[2] - a[2]);
      l.fan('limestone', [a, b, bot[(k + 1) % N], bot[k]], side, out, (p) =>
        p === a || p === bot[k] ? [k * 0.2, p[1]] : [k * 0.2 + along, p[1]],
      );
    }
  });
}

/** The tree feet the roots run from: the stand's pines and oaks (world x, z). */
const ROOT_TREES = (): V2[] => [
  ...TRAIL_PINES.map(([x, z]): V2 => [x, z]),
  ...TRAIL_STAND_OAKS.map(([x, z]): V2 => [x, z]),
];

/**
 * The roots (ref-13: dark, bark-skinned, flattened, half sunk, branching): each runs from the foot of the nearest tree
 * (when one stands within 3.5 m of its first point) along its control points, with a fork or two off it towards the
 * path's far side. Bark scan, browned black by the vertex colour.
 */
function trailRoots(l: Local, ground: (x: number, z: number) => number): void {
  const trees = ROOT_TREES();
  TRAIL_ROOTS.forEach(([ctrl0, r0], ri) => {
    let ctrl = ctrl0;
    const [fx, fz] = toWorld(l.site, ctrl0[0][0], ctrl0[0][1]);
    let best: V2 | undefined;
    let bestD = 3.5;
    for (const t of trees) {
      const d = Math.hypot(t[0] - fx, t[1] - fz);
      if (d < bestD) [best, bestD] = [t, d];
    }
    if (best) {
      // From just outside the trunk (its radius ~0.15-0.3 m), out along the root's own line.
      const [tx, tz] = toLocal(l.site, best[0], best[1]);
      const dx = ctrl0[0][0] - tx;
      const dz = ctrl0[0][1] - tz;
      const d = Math.hypot(dx, dz) || 1;
      ctrl = [[tx + (dx / d) * 0.2, tz + (dz / d) * 0.2], ...ctrl0];
    }
    const pts = rootTube(l, ground, ctrl, best ? r0 * 1.35 : r0, ri);
    // Forks: off the root's middle, at an angle, a third as thick, 0.4-0.9 m.
    const u = (k: number) => (hash3(ri, k, 5, 163) % 1000) / 1000;
    const forks = 1 + (u(1) < 0.5 ? 1 : 0);
    for (let f = 0; f < forks; f++) {
      const at = Math.floor(pts.length * (0.3 + 0.35 * u(2 + f)));
      if (at < 1 || at + 1 >= pts.length) continue;
      const [x, z] = pts[at];
      const hx = pts[at + 1][0] - pts[at - 1][0];
      const hz = pts[at + 1][1] - pts[at - 1][1];
      const turn = (f % 2 ? -1 : 1) * (0.5 + 0.4 * u(4 + f));
      const len = 0.4 + 0.5 * u(6 + f);
      const h = Math.hypot(hx, hz) || 1;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const ux = (hx * c - hz * sn) / h;
      const uz = (hx * sn + hz * c) / h;
      rootTube(
        l,
        ground,
        [
          [x, z],
          [x + ux * len * 0.5 + uz * 0.05, z + uz * len * 0.5 - ux * 0.05],
          [x + ux * len, z + uz * len],
        ],
        r0 * 0.45,
        ri * 7 + f + 50,
      );
    }
  });
}

/**
 * One root: a tube along a Catmull-Rom curve through `ctrl` (local x, z), radius `r0` tapering to 40 %, flattened and
 * mostly sunk (its back just over the ground / the path's tread), wavering; uvs in metres round / along it. Returns
 * its centre line.
 */
function rootTube(
  l: Local,
  ground: (x: number, z: number) => number,
  ctrl: V2[],
  r0: number,
  ri: number,
): V2[] {
  const SIDES = 6;
  // Catmull-Rom samples every ~6 cm.
  const pts: V2[] = [];
  for (let i = 0; i + 1 < ctrl.length; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.06);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t2 +
          (-a + 3 * b - 3 * c + d) * t3);
      pts.push([
        cr(p0[0], p1[0], p2[0], p3[0]),
        cr(p0[1], p1[1], p2[1], p3[1]),
      ]);
    }
  }
  pts.push(ctrl[ctrl.length - 1]);
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  let len = 0;
  pts.forEach(([x, z], k) => {
    const f = k / (pts.length - 1);
    const r =
      r0 * (1 - 0.6 * f) * (1 + 0.2 * pileNoise.noise2(x * 4 + ri, z * 4));
    const [wx, wz] = toWorld(l.site, x, z);
    // (over the tread: on top of the path's ribbon, 3 cm over the ground)
    const tread = 0.03 * (1 - smoothstep(0.55, 0.85, trailDistance(wx, wz)));
    // Half sunk: the back 0.1-0.6 r out of the ground, rising and dipping along it.
    const y =
      ground(wx, wz) -
      l.baseY +
      tread -
      0.12 * r +
      0.3 * r * pileNoise.noise2(x * 2.5 - ri * 3, z * 2.5);
    const [nx, nz] =
      k + 1 < pts.length
        ? [pts[k + 1][0] - x, pts[k + 1][1] - z]
        : [x - pts[k - 1][0], z - pts[k - 1][1]];
    const nl = Math.hypot(nx, nz) || 1;
    // Across the root (flat) and up.
    const sx = -nz / nl;
    const sz = nx / nl;
    if (k) len += Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]);
    // (one more vertex round: the bark's seam closes)
    for (let j = 0; j <= SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      // Flattened and spread (roots grow along the ground), wavering sideways.
      const w = 0.06 * pileNoise.noise2(len * 1.7 + ri * 9, 0.5);
      pos.push(
        x + sx * (Math.cos(a) * r * 1.3 + w),
        y + Math.sin(a) * r * 0.45,
        z + sz * (Math.cos(a) * r * 1.3 + w),
      );
      // Darker low on its flanks (earth on it) and in patches; a little lighter on its worn back.
      const k2 =
        (0.8 + 0.3 * ((hash3(ri, k >> 2, j % SIDES, 17) % 100) / 100)) *
        (0.75 + 0.35 * Math.max(0, Math.sin(a)));
      col.push(k2, k2 * 0.97, k2 * 0.92);
      uv.push((j / SIDES) * 2 * Math.PI * r, len);
    }
  });
  const idx: number[] = [];
  const R = SIDES + 1;
  for (let k = 0; k + 1 < pts.length; k++)
    for (let j = 0; j < SIDES; j++) {
      const a = k * R + j;
      const b = a + 1;
      idx.push(a, a + R, b, b, a + R, b + R);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Dark brown-black bark (ref-13), over the scan's grey (~0.42 linear).
  l.add('bark', g, '#6e5038');
  return pts;
}

/** The car park's dry-stone walls: knee high, following the ground along the two long sides. */
function lotWalls(l: Local, ground: (x: number, z: number) => number): void {
  for (const [a, b] of LOT_SIDES) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [tx, tz] = unitV(b[0] - a[0], b[1] - a[1]);
    const p: V2[] = [];
    const n: V2[] = [];
    const lo: number[] = [];
    const hi: number[] = [];
    for (let d = WALL_FROM; d <= len + 1e-6; d += 2) {
      const x = a[0] + tx * d;
      const z = a[1] + tz * d;
      const [px, pz] = toLocal(l.site, x, z);
      p.push([px, pz]);
      n.push([-tz, tx]);
      const g = ground(x, z) - l.baseY;
      lo.push(g - 0.4);
      hi.push(g + 0.55);
    }
    const run: WallRun = {
      p,
      n,
      lo,
      hi: smoothHeights(hi, 3),
      inner: -0.25,
      outer: 0.25,
    };
    wallRibbon(l, run);
  }
}

export function buildTrailLot(
  at: (site: Site, tile: string) => Local,
  ground: (x: number, z: number) => number,
): void {
  const piles = at(SIDE_ROAD_BLOCK, 'side-road-piles');
  PILES.build(piles, ground);
  const trail = at(TRAIL_START, 'trail-start');
  POSTS.forEach((z, i) => {
    const [wx, wz] = toWorld(TRAIL_START, 0, z);
    stonePost(trail, z, i === 1, i, ground(wx, wz) - trail.baseY);
  });
  trailSlabs(trail, ground);
  trailRoots(trail, ground);
  gazebo(at(TRAIL_SHELTER, 'trail-shelter'), 0, 0, 0, 0, {
    apothem: TRAIL_SHELTER_APOTHEM,
    roof: '#5a4030',
    roofKey: 'sheet',
    open: [0, 4],
    tables: 2,
  });
  for (const [x, z, yaw] of TRAIL_TABLES) {
    const [lx, lz] = toLocal(TRAIL_START, x, z);
    picnicTable(trail, lx, ground(x, z) - trail.baseY, lz, yaw);
  }
  // The hairpin island: rail, gazebo, tables (local = world - the gazebo's position).
  const island = at({ ...ISLAND_GAZEBO, yaw: 0 }, 'hairpin-island');
  const ix = ISLAND_GAZEBO.x;
  const iz = ISLAND_GAZEBO.z;
  const iy = (x: number, z: number) => ground(x + ix, z + iz) - island.baseY;
  for (const run of ISLAND_RAIL)
    logRail(
      island,
      run.map(([x, z]) => [x - ix, z - iz]),
      iy,
      1.0,
    );
  gazebo(island, 0, iy(0, 0), 0, ISLAND_GAZEBO.yaw, {
    apothem: ISLAND_GAZEBO_APOTHEM,
    roof: '#3f6a3c',
    roofKey: 'sheet',
    open: [0, 4],
    tables: 2,
  });
  for (const [x, z, yaw] of ISLAND_TABLES)
    picnicTable(island, x - ix, iy(x - ix, z - iz), z - iz, yaw);
  const lotSite: Site = {
    x: LOT_SIDES[0][0][0],
    z: LOT_SIDES[0][0][1],
    yaw: 0,
  };
  const lot = at(lotSite, 'trail-lot');
  lotWalls(lot, ground);
  // Solar lamps and the bin on the north wall, the P sign at the entrance.
  const [a, b] = LOT_SIDES[1];
  for (const t of [0.35, 0.75]) {
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    const [lx, lz] = toLocal(lotSite, x, z);
    solarLamp(lot, lx, ground(x, z) - lot.baseY, lz + 0.9, 1.0);
  }
  {
    const x = a[0] + (b[0] - a[0]) * 0.55;
    const z = a[1] + (b[1] - a[1]) * 0.55;
    const [lx, lz] = toLocal(lotSite, x, z);
    bin(lot, lx, ground(x, z) - lot.baseY, lz + 0.8, 0);
  }
  {
    const x = a[0] + 1.5;
    const z = a[1] - 1.2;
    const [lx, lz] = toLocal(lotSite, x, z);
    parkingSign(lot, lx, ground(x, z) - lot.baseY, lz, -Math.PI / 2);
  }
}
