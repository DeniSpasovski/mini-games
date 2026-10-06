import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';
import { CONTACT_Y, MAST_OFFSET, MESSENGER_Y } from '../../world/railways';

/**
 * Power line supports: the lattice transmission tower (`power_pylon`, 28 m, the line runs along local X,
 * the arms along Z) and the wooden distribution pole (`power_pole`, 10 m). The cables between them are a
 * line mesh (world/power-line-mesh.ts), anchored at the heights exported here.
 */

export const PYLON_H = 28;
export const POLE_H = 10;
/** Conductor attachment (height above the ground, lateral offset along the arm) per support. */
export const PYLON_WIRES: [number, number][] = [
  [PYLON_H * 0.8, -3.6],
  [PYLON_H * 0.8, 3.6],
  [PYLON_H * 0.9, 0],
];
export const POLE_WIRES: [number, number][] = [
  [POLE_H - 0.3, -1.05],
  [POLE_H - 0.3, 0],
  [POLE_H - 0.3, 1.05],
];

const GALV = '#868b91';

const slab = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
): BufferGeometry =>
  planarUV(paint(new BoxGeometry(w, h, d).translate(x, y, z), color), 0.5);

/** A leaning box strut from (x0, y0, z0) to (x1, y1, z1), `t` thick. */
function strut(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
  color: string,
): BufferGeometry {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new BoxGeometry(t, len, t);
  // Box axis is +Y: rotate it onto (dx, dy, dz).
  const ax = Math.atan2(Math.hypot(dx, dz), dy);
  const ay = Math.atan2(dx, dz);
  g.rotateX(ax).rotateY(ay);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return planarUV(paint(g, color), 0.5);
}

export const powerPylon: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  const H = PYLON_H;
  const base = 3.4;
  const top = 0.55;
  const corners = (y: number): [number, number][] => {
    const r = base + (top - base) * (y / (H * 0.78));
    return [
      [r, r],
      [r, -r],
      [-r, -r],
      [-r, r],
    ];
  };
  // Four leaning legs up to the waist (78 % of the height), then a slim column to the top.
  const waist = H * 0.78;
  const lo = corners(0);
  const hi = corners(waist);
  for (let i = 0; i < 4; i++)
    parts.push(
      strut([lo[i][0], 0, lo[i][1]], [hi[i][0], waist, hi[i][1]], 0.3, GALV),
    );
  if (lod === 0) {
    // Horizontal rings and X braces on the faces.
    const levels = [0.16, 0.34, 0.52, 0.7].map((f) => f * waist);
    for (const y of levels) {
      const c = corners(y);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        parts.push(
          strut([c[i][0], y, c[i][1]], [c[j][0], y, c[j][1]], 0.16, GALV),
        );
      }
    }
    for (let k = 0; k < levels.length - 1; k++) {
      const y0 = levels[k];
      const y1 = levels[k + 1];
      const c0 = corners(y0);
      const c1 = corners(y1);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        parts.push(
          strut([c0[i][0], y0, c0[i][1]], [c1[j][0], y1, c1[j][1]], 0.12, GALV),
          strut([c0[j][0], y0, c0[j][1]], [c1[i][0], y1, c1[i][1]], 0.12, GALV),
        );
      }
    }
  }
  // Column above the waist, two cross arms (lower: wide, upper: short) and a top peak.
  parts.push(
    slab(0.9, H - waist + 1.2, 0.9, 0, (H + waist) / 2 + 0.6, 0, GALV),
  );
  parts.push(slab(0.35, 0.35, 8.4, 0, H * 0.8, 0, GALV));
  parts.push(slab(0.35, 0.35, 5, 0, H * 0.9, 0, GALV));
  parts.push(slab(0.3, 2.2, 0.3, 0, H + 1.3, 0, GALV));
  if (lod === 0) {
    // Insulator strings hanging under the arms.
    for (const [y, z] of PYLON_WIRES)
      parts.push(
        planarUV(
          paint(
            new CylinderGeometry(0.12, 0.12, 1.2, 5).translate(0, y + 0.5, z),
            '#9ba39a',
          ),
          0.5,
        ),
      );
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.7 + 0.3 * Math.min(1, y / H));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};

/**
 * Railway catenary mast (`catenary_mast`): a galvanised H-beam on a concrete stub, a cantilever reaching
 * along local +Z to the track centre (`MAST_OFFSET` m, world/railways.ts) with a diagonal stay, the
 * registration arm dropping to the contact wire. Heights are over the mast's ground (~ the track formation),
 * where the wires (rail-mesh.ts) hang: `CONTACT_Y` / `MESSENGER_Y`.
 */
const CATENARY_REACH = MAST_OFFSET;
const CATENARY_WIRES = { contact: CONTACT_Y, messenger: MESSENGER_Y };
const MAST_H = 7.9;

export const catenaryMast: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  const steel = '#7d838a';
  // Concrete stub, the H-beam (two flanges + web).
  parts.push(slab(0.55, 0.5, 0.55, 0, 0.1, 0, '#a19d94'));
  parts.push(slab(0.32, MAST_H, 0.05, 0, MAST_H / 2, 0.11, steel));
  parts.push(slab(0.32, MAST_H, 0.05, 0, MAST_H / 2, -0.11, steel));
  parts.push(slab(0.04, MAST_H, 0.2, 0, MAST_H / 2, 0, steel));
  const top = CATENARY_WIRES.messenger;
  const low = CATENARY_WIRES.contact - 0.55;
  const R = CATENARY_REACH + 0.35;
  // Upper (messenger) tube and the lower stay up to its tip.
  parts.push(strut([0, top, 0.15], [0, top, R], 0.08, steel));
  parts.push(strut([0, low, 0.15], [0, top - 0.05, R - 0.3], 0.07, steel));
  // Registration arm and dropper to the contact wire.
  parts.push(
    strut(
      [0, low + 0.35, CATENARY_REACH - 0.9],
      [0, CATENARY_WIRES.contact, CATENARY_REACH],
      0.04,
      steel,
    ),
  );
  if (lod === 0) {
    // Brown porcelain insulators at the mast end of both tubes.
    for (const y of [top, low])
      parts.push(
        planarUV(
          paint(
            new CylinderGeometry(0.07, 0.07, 0.5, 6)
              .rotateX(Math.PI / 2)
              .translate(0, y, 0.55),
            '#6b3a24',
          ),
          0.5,
        ),
      );
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.75 + 0.25 * Math.min(1, y / MAST_H));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};

export const powerPole: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  const pole = new CylinderGeometry(0.11, 0.17, POLE_H, lod === 0 ? 7 : 5, 1);
  pole.translate(0, POLE_H / 2, 0);
  parts.push(planarUV(paint(pole, '#6a5240'), 0.5));
  parts.push(slab(0.12, 0.12, 2.5, 0, POLE_H - 0.55, 0, '#5a4636'));
  if (lod === 0)
    for (const [y, z] of POLE_WIRES)
      parts.push(
        planarUV(
          paint(
            new CylinderGeometry(0.05, 0.05, 0.3, 5).translate(0, y - 0.1, z),
            '#a9a69a',
          ),
          0.5,
        ),
      );
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};
