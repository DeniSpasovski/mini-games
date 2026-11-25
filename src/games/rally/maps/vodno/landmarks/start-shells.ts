import { hash3 } from '../../../../../shared/rng';
import { rectOutline, type Local, type V2, type Wall } from './common';
import type { Site } from './sites';
import { opening } from './start-blocks';
import { footOf } from './start-towers';

/**
 * The building site on the left of the road at 250-340 m (not in OSM), from the drive videos: five blocks of flats
 * going up as bare concrete frames (slabs on columns, stair cores), red clay brick infill with window openings on the
 * lower floors, open floors over them with props under the newest slab and rebar standing out of the top columns; the
 * site's office containers and stacks of timber and brick pallets behind the green net on the road. Placed by eye from
 * the aerial reference. Local frames: x along the block's road face, z towards the road, y up from the ground at the
 * site.
 */
export interface Shell {
  site: Site;
  w: number;
  d: number;
  /** Storeys with a slab over them. */
  storeys: number;
  /** Storeys walled in brick (from the ground); the one over them half done. */
  brick: number;
  /** The top slab is the roof (a parapet, stair housings) rather than the floor of a storey still to come. */
  roof: boolean;
}

export const SHELLS: Shell[] = [
  {
    site: { x: 1592, z: -995.5, yaw: 0.05 },
    w: 29,
    d: 18.5,
    storeys: 4,
    brick: 2,
    roof: true,
  },
  {
    site: { x: 1620, z: -990, yaw: 0.25 },
    w: 21,
    d: 19,
    storeys: 4,
    brick: 1,
    roof: false,
  },
  {
    site: { x: 1639.5, z: -981, yaw: 0.3 },
    w: 17,
    d: 19,
    storeys: 3,
    brick: 0,
    roof: false,
  },
  {
    site: { x: 1658, z: -986, yaw: 0.3 },
    w: 15,
    d: 21,
    storeys: 3,
    brick: 1,
    roof: false,
  },
  {
    site: { x: 1679, z: -988, yaw: 0.3 },
    w: 21,
    d: 23,
    storeys: 4,
    brick: 0,
    roof: false,
  },
];

/** The site yard by the road (where a stale footprint stood): its office containers, timber and pallets. */
export const YARD: Site = { x: 1649.3, z: -952.2, yaw: 0.32 };
export const YARD_RECT = [-18.5, 18.5, -4.5, 4.5] as const;

const CONCRETE = '#c4bfb5';
const BRICK = '#f2e6e0';
const RUST = '#6b3b26';
const TIMBER = '#a9824f';
const FLOOR = 3;
const SLAB = 0.25;
const COL = 0.4;

/** Columns along a run of `len` m: about every 5 m, the ends set in by half a column. */
const columnLine = (len: number): number[] => {
  const n = Math.max(2, Math.round(len / 5));
  return Array.from(
    { length: n + 1 },
    (_, i) => -len / 2 + COL / 2 + ((len - COL) * i) / n,
  );
};

/** One shell: frame, slabs, core, brick walls, props and rebar. */
export function buildShell(
  l: Local,
  s: Shell,
  index: number,
  ground: (x: number, z: number) => number,
): void {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const lo = footOf(l, { hw, hd }, ground);
  // Floors count from the road-side foot (the land rises behind).
  const f0 = Math.min(
    ground(l.site.x, l.site.z) - l.baseY,
    ...[-hw, 0, hw].map((x) => {
      const c = Math.cos(l.site.yaw);
      const sn = Math.sin(l.site.yaw);
      return (
        ground(l.site.x + x * c - hd * sn, l.site.z + x * sn + hd * c) - l.baseY
      );
    }),
  );
  const lv = (k: number): number => f0 + k * FLOOR;
  const xs = columnLine(s.w);
  const zs = columnLine(s.d);
  // The raft under it, down to the lowest ground.
  l.box(
    'wall',
    [-hw - 0.3, lo - 0.4, -hd - 0.3],
    [hw + 0.3, f0, hd + 0.3],
    CONCRETE,
  );
  for (let k = 1; k <= s.storeys; k++)
    l.box(
      'wall',
      [-hw - 0.3, lv(k) - SLAB, -hd - 0.3],
      [hw + 0.3, lv(k), hd + 0.3],
      CONCRETE,
    );
  // Columns on the outer lines and the middle line across.
  const colAt = (x: number, z: number, y0: number, y1: number): void =>
    l.box(
      'wall',
      [x - COL / 2, y0, z - COL / 2],
      [x + COL / 2, y1, z + COL / 2],
      CONCRETE,
    );
  for (let k = 0; k < s.storeys; k++)
    for (const x of xs)
      for (const z of [zs[0], 0, zs[zs.length - 1]])
        colAt(x, z, lv(k), lv(k + 1) - SLAB);
  for (let k = 0; k < s.storeys; k++)
    for (const z of zs.slice(1, -1))
      for (const x of [xs[0], xs[xs.length - 1]])
        colAt(x, z, lv(k), lv(k + 1) - SLAB);
  // The stair and lift core at the back, through every storey.
  const top = lv(s.storeys) + (s.roof ? 2.6 : 0);
  l.box('wall', [-2.2, f0, -hd + 0.6], [2.2, top, -hd + 5.8], CONCRETE);
  const core: Wall = { o: [0, 0, -hd + 5.8], n: [0, 0, 1] };
  for (let k = 0; k < s.storeys; k++)
    l.panel(
      'paint',
      core,
      rectOutline(-0.6, lv(k), 0.6, lv(k) + 2.2),
      '#2a2a28',
      {
        off: 0.02,
      },
    );

  // Brick infill between the columns of the outer walls: whole storeys up to `brick`, every other bay of the next.
  const faces: { w: Wall; runs: number[]; half: number }[] = [
    { w: { o: [0, 0, hd - COL / 2], n: [0, 0, 1] }, runs: xs, half: hw },
    {
      w: { o: [0, 0, -hd + COL / 2], n: [0, 0, -1] },
      runs: xs.map((x) => -x).reverse(),
      half: hw,
    },
    {
      w: { o: [hw - COL / 2, 0, 0], n: [1, 0, 0] },
      runs: zs.map((z) => -z).reverse(),
      half: hd,
    },
    { w: { o: [-hw + COL / 2, 0, 0], n: [-1, 0, 0] }, runs: zs, half: hd },
  ];
  for (let k = 0; k <= Math.min(s.brick, s.storeys - 1); k++)
    faces.forEach(({ w, runs }, fi) => {
      for (let i = 0; i + 1 < runs.length; i++) {
        if (k === s.brick && hash3(index, k, fi * 31 + i, 4111) % 2) continue;
        const s0 = runs[i] + COL / 2;
        const s1 = runs[i + 1] - COL / 2;
        const y0 = lv(k);
        const y1 = lv(k + 1) - SLAB;
        const mid = (s0 + s1) / 2;
        // a window in most bays, a balcony door in some on the road face
        const door = fi === 0 && i % 2 === 1;
        const hole: V2[] = door
          ? rectOutline(mid - 0.9, y0 + 0.05, mid + 0.9, y0 + 2.25)
          : rectOutline(mid - 0.8, y0 + 0.9, mid + 0.8, y0 + 2.3);
        const holes = s1 - s0 > 2.6 ? [hole] : [];
        l.panel('brick', w, rectOutline(s0, y0, s1, y1), BRICK, {
          holes,
          depth: 0.25,
          off: -0.05,
        });
      }
    });

  // Props under the newest slab (two bays), rebar out of the top columns, or a parapet and stair housing on a roof.
  if (s.roof) {
    const R = lv(s.storeys);
    l.box('brick', [-hw - 0.3, R, -hd - 0.3], [hw + 0.3, R + 0.9, -hd], BRICK);
    l.box('brick', [-hw - 0.3, R, hd], [hw + 0.3, R + 0.9, hd + 0.3], BRICK);
    l.box('brick', [-hw - 0.3, R, -hd], [-hw, R + 0.9, hd], BRICK);
    l.box('brick', [hw, R, -hd], [hw + 0.3, R + 0.9, hd], BRICK);
  } else {
    const y0 = lv(s.storeys - 1);
    const y1 = lv(s.storeys) - SLAB;
    for (let x = xs[1] + 0.8; x < xs[3] - 0.5; x += 1.6)
      for (let z = -hd + 1.2; z < hd - 0.8; z += 1.6)
        l.box(
          'paint',
          [x - 0.05, y0, z - 0.05],
          [x + 0.05, y1, z + 0.05],
          TIMBER,
        );
    const R = lv(s.storeys);
    for (const x of xs)
      for (const z of [zs[0], 0, zs[zs.length - 1]])
        for (const [dx, dz] of [
          [-0.12, -0.12],
          [0.12, 0.12],
          [-0.12, 0.12],
          [0.12, -0.12],
        ])
          l.box(
            'metal',
            [x + dx - 0.015, R, z + dz - 0.015],
            [x + dx + 0.015, R + 1.2, z + dz + 0.015],
            RUST,
          );
  }
}

/** The yard: two stacked office containers at its east end, timber stacks and brick pallets. */
export function buildYard(
  l: Local,
  ground: (x: number, z: number) => number,
): void {
  const y = (x: number, z: number): number => {
    const c = Math.cos(l.site.yaw);
    const s = Math.sin(l.site.yaw);
    return ground(l.site.x + x * c - z * s, l.site.z + x * s + z * c) - l.baseY;
  };
  // The containers: white sheet boxes on blocks, windows and a door to the road.
  const cy = Math.min(y(9, -2.5), y(17, -2.5), y(9, 2.5), y(17, 2.5));
  for (const [x0, x1] of [
    [6.3, 12.3],
    [12.4, 18.4],
  ]) {
    l.box(
      'wall',
      [x0 + 0.2, cy - 0.4, -2.3],
      [x1 - 0.2, cy + 0.2, 2.3],
      '#9b968c',
    );
    l.box('sheet', [x0, cy + 0.2, -1.22], [x1, cy + 2.8, 1.22], '#ecebe6');
    const front: Wall = { o: [0, 0, 1.22], n: [0, 0, 1] };
    opening(l, front, x0 + 0.8, cy + 1.2, x0 + 2.0, cy + 2.2, {
      frame: '#d7d7d2',
      off: 0.02,
    });
    opening(l, front, x1 - 2.0, cy + 1.2, x1 - 0.8, cy + 2.2, {
      frame: '#d7d7d2',
      off: 0.02,
    });
    opening(l, front, x0 + 2.6, cy + 0.25, x0 + 3.5, cy + 2.2, {
      frame: '#d7d7d2',
      off: 0.02,
    });
  }
  // Timber stacks (planks, a few laths across) and pallets of brick under film.
  for (const [x, z, r] of [
    [-14, -1.5, 0],
    [-9.5, 0.5, 1],
    [-4, -1, 2],
  ] as const) {
    const g = y(x, z);
    for (let k = 0; k < 4; k++)
      l.box(
        'paint',
        [x - 2.1, g + k * 0.22, z - 0.6],
        [x + 2.1, g + k * 0.22 + 0.18, z + 0.6],
        k % 2 ? TIMBER : '#b8925c',
      );
    for (const dx of [-1.6, 0, 1.6])
      l.box(
        'paint',
        [x + dx - 0.04, g + 0.88, z - 0.65],
        [x + dx + 0.04, g + 0.94, z + 0.65],
        '#8c6a3c',
      );
    if (r === 1)
      for (let i = 0; i < 3; i++) {
        const px = x + 3.2 + i * 1.15;
        const pg = y(px, z);
        l.box(
          'paint',
          [px - 0.5, pg, z - 0.5],
          [px + 0.5, pg + 0.14, z + 0.5],
          '#9c7a4d',
        );
        l.box(
          'brick',
          [px - 0.48, pg + 0.14, z - 0.48],
          [px + 0.48, pg + 1.0, z + 0.48],
          BRICK,
        );
      }
  }
}
