import { hash3 } from '../../../../../shared/rng';
import type { V2 } from './common';
import { toLocal, type Area, type Site } from './sites';

/**
 * The paved car parks round the start of the run-up that OSM maps as areas (the bake keeps only their aisles): the strip
 * along the apartment block north of the courts (way 1117610885), the club's lot by its clay court (1117610884) and the
 * residents' bays by the supermarket block (1090456365), the lot at the 560 m junction (37997768), and the yard beside the hall south of the start lot. Asphalt as the start lot's (`lotAsphalt`), cars parked nose in
 * along the edges given as rows.
 */
interface Lot {
  name: string;
  outline: V2[];
  /**
   * Bay rows along an edge of the outline (world points a -> b): nose in to it (the cars' centres `inset` m in from it) or
   * parked `parallel` along it; `fill` = the share of bays taken.
   */
  rows: { a: V2; b: V2; inset: number; fill: number; parallel?: boolean }[];
}

const LOTS: Lot[] = [
  {
    name: 'block-strip',
    outline: [
      [1618.9, -1196.7],
      [1622.0, -1200.0],
      [1610.6, -1208.0],
      [1572.0, -1236.2],
      [1537.6, -1190.2],
      [1540.0, -1188.1],
      [1546.1, -1186.7],
      [1569.6, -1220.2],
      [1572.2, -1224.6],
      [1575.0, -1226.0],
      [1578.8, -1224.4],
      [1593.2, -1214.3],
      [1593.3, -1211.7],
      [1593.3, -1208.1],
      [1593.8, -1205.4],
      [1596.0, -1203.9],
      [1600.3, -1210.2],
      [1607.1, -1205.2],
    ],
    rows: [
      // (the west arm: a row along its outer side, the aisle by the block; the south arm: cars along its outer side)
      { a: [1539.5, -1192.7], b: [1570.2, -1233.8], inset: 2.4, fill: 0.7 },
      {
        a: [1576, -1233.3],
        b: [1617.5, -1203.2],
        inset: 1.1,
        fill: 0.5,
        parallel: true,
      },
    ],
  },
  {
    name: 'club-lot',
    outline: [
      [1600.3, -1210.2],
      [1596.0, -1203.9],
      [1585.5, -1188.6],
      [1593.8, -1179.1],
      [1601.1, -1186.2],
      [1595.3, -1193.2],
      [1604.0, -1202.0],
      [1607.1, -1205.2],
    ],
    rows: [{ a: [1586.5, -1190], b: [1596.5, -1204.6], inset: 2.4, fill: 0.6 }],
  },
  {
    name: 'block-bays',
    outline: [
      [1523.3, -1221.4],
      [1546.7, -1206.9],
      [1540.3, -1196.5],
      [1534.7, -1199.9],
      [1538.0, -1205.2],
      [1520.1, -1216.3],
    ],
    rows: [
      { a: [1522.3, -1220.3], b: [1544.5, -1206.6], inset: 2.4, fill: 0.75 },
    ],
  },
  {
    // (OSM 37997768: the lot along the side street at the 560 m junction, bays on both long sides)
    name: 'junction-lot',
    outline: [
      [1815.0, -813.3],
      [1844.1, -763.0],
      [1856.2, -767.9],
      [1825.6, -823.9],
    ],
    rows: [
      { a: [1815.0, -813.3], b: [1844.1, -763.0], inset: 2.4, fill: 0.35 },
      { a: [1856.2, -767.9], b: [1825.6, -823.9], inset: 2.4, fill: 0.45 },
    ],
  },
  {
    // (not in OSM: the paved yard between the hall and the side street, cars nose in to the street's sidewalk)
    name: 'hall-yard',
    outline: [
      [1583.5, -1097],
      [1602.3, -1097],
      [1602.3, -1066],
      [1600, -1056],
      [1583.5, -1053],
    ],
    rows: [{ a: [1602.3, -1095], b: [1602.3, -1060], inset: 2.4, fill: 0.65 }],
  },
];

/** (x, z) inside the outline (even-odd). */
const inside = (poly: V2[], x: number, z: number): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      c = !c;
  }
  return c;
};

export const START_LOTS_SITE: Site = { x: 1580, z: -1210, yaw: 0 };

export const START_LOT_OUTLINES: V2[][] = LOTS.map((l) => l.outline);

/** Scatter stays off the lots. */
export const START_LOTS_AREAS: Area[] = LOTS.map((l) => ({
  site: START_LOTS_SITE,
  poly: l.outline.map(([x, z]) => toLocal(START_LOTS_SITE, x, z)),
}));

/** The parked cars: world (x, z), the car's three.js yaw (the model faces +x), a variant of `street_car`. */
export const START_LOTS_CARS: {
  x: number;
  z: number;
  rotY: number;
  variant: number;
}[] = LOTS.flatMap((lot, li) =>
  lot.rows.flatMap((r, ri) => {
    const dx = r.b[0] - r.a[0];
    const dz = r.b[1] - r.a[1];
    const len = Math.hypot(dx, dz);
    const [tx, tz] = [dx / len, dz / len];
    // The normal into the lot.
    let [nx, nz] = [-tz, tx];
    const mx = (r.a[0] + r.b[0]) / 2;
    const mz = (r.a[1] + r.b[1]) / 2;
    if (!inside(lot.outline, mx + nx, mz + nz)) [nx, nz] = [tz, -tx];
    const pitch = r.parallel ? 6 : 2.6;
    const out: { x: number; z: number; rotY: number; variant: number }[] = [];
    const n = Math.floor(len / pitch);
    const pad = (len - n * pitch) / 2;
    for (let k = 0; k < n; k++) {
      const h = hash3(li, ri, k, 7333);
      if ((h % 100) / 100 >= r.fill) continue;
      const s = pad + (k + 0.5) * pitch;
      const x = r.a[0] + tx * s + nx * r.inset;
      const z = r.a[1] + tz * s + nz * r.inset;
      if (!inside(lot.outline, x, z)) continue;
      // Nose in to the edge (against the normal), or along the edge either way.
      const [fx, fz] = r.parallel
        ? h & 1
          ? [tx, tz]
          : [-tx, -tz]
        : [-nx, -nz];
      out.push({
        x,
        z,
        rotY: -Math.atan2(fz, fx) + (((h >>> 8) % 7) - 3) * 0.02,
        variant: (h >>> 12) % 10,
      });
    }
    return out;
  }),
);
