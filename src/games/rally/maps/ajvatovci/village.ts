import type { BuildingDef } from '../shared/types';

/**
 * Ajvatovci village corrections to the baked footprints (checked by eye against aerial photos along the stage road).
 * The footprint data set misses the newer farm halls and houses by the road and took a few swimming pools and an
 * empty yard for houses.
 */

/** Baked footprints that are no building: pools (766 + 773, 925), a bare yard (931), a tree clump (972). */
const DROP = new Set([766, 773, 925, 931, 972]);

type Box = [
  x: number,
  z: number,
  w: number,
  d: number,
  angle: number,
  h: number,
  floors: number,
  type: BuildingDef['type'],
];

/** Footprints that sit beside the real building: placed again on it. */
const MOVE: Record<number, Box> = {
  850: [1254.5, -187, 13, 12, 1.571, 6.2, 2, 'house'],
  933: [1367, -190.5, 19.5, 12, 1.571, 6.2, 2, 'house'],
};

/**
 * Buildings by the stage road the footprint data lacks: id (from 900 000, clear of the baked ids; its parity picks the
 * box style: odd = rendered block / gable house, even = hall or hip house), centre, long side, short side, angle,
 * wall height, floors, type.
 */
const ADD: [id: number, ...box: Box][] = [
  // ~2 850 m: concrete farm complex, two flat-roofed blocks + a white hall, north of the road.
  [900001, 814, -157, 18, 10, 2.02, 6.5, 2, 'flat'],
  [900002, 827.5, -148, 21, 21, 0.52, 9, 3, 'flat'],
  [900003, 854, -144, 21, 12, 0.47, 5, 1, 'flat'],
  // ~3 240 m: the teal sheet-roofed shed behind the junction.
  [900004, 1231, -198, 26, 13, 0.08, 4.5, 1, 'flat'],
  // ~3 290 m: the green-roofed house, the long tiled barn behind it and the L-shaped barn by the road.
  [900006, 1276.7, -180.4, 14, 13, 0, 6.2, 2, 'house'],
  [900011, 1278, -204, 22, 7, 1.6, 3.3, 1, 'house'],
  [900013, 1296, -188.5, 23, 7, 0, 3.3, 1, 'house'],
  [900015, 1305, -179.5, 25, 8.5, 1.55, 3.3, 1, 'house'],
  // ~3 400 m: the dark-roofed modern house south of the road.
  [900017, 1400, -158.5, 17, 13, 1.62, 6.5, 2, 'flat'],
  // ~3 480 m: the big farm halls north of the road (white sheet roofs) and the white-roofed block south of it.
  [900018, 1524, -230, 50, 27, -0.11, 6, 1, 'flat'],
  [900020, 1544, -210, 21, 20, -0.11, 6, 1, 'flat'],
  [900021, 1493, -234, 14.5, 12.5, -0.05, 4, 1, 'flat'],
  [900023, 1504.8, -159.9, 17.3, 11, 1.63, 6.5, 2, 'flat'],
  // ~3 600 m: farm building in a fenced yard south of the road.
  [900025, 1611.1, -181, 16, 10, 0.855, 5, 1, 'flat'],
];

const box = (b: Box, id: number, along: number): BuildingDef => ({
  id,
  x: b[0],
  z: b[1],
  w: b[2],
  d: b[3],
  angle: b[4],
  h: b[5],
  floors: b[6],
  type: b[7],
  source: 'manual',
  along,
});

/** The baked buildings with the village corrections applied. */
export function villageBuildings(baked: BuildingDef[]): BuildingDef[] {
  const out: BuildingDef[] = [];
  for (const b of baked) {
    if (DROP.has(b.id)) continue;
    const m = MOVE[b.id];
    out.push(m ? box(m, b.id, b.along) : b);
  }
  // `along` only orders / filters by stage distance: the nearest road point is close enough for that.
  const nearest = (x: number, z: number) => {
    let best = baked[0];
    let bd = Infinity;
    for (const b of baked) {
      const d = (b.x - x) ** 2 + (b.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best.along;
  };
  for (const [id, ...b] of ADD) out.push(box(b, id, nearest(b[0], b[1])));
  return out;
}

/** Ids for tests. */
export const VILLAGE_FIX = {
  drop: [...DROP],
  move: Object.keys(MOVE).map(Number),
  added: ADD.map((a) => a[0]),
};
