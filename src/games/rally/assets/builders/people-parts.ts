import {
  BoxGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { paint } from '../../engine/geo';

/**
 * Parts of the figures that are not the base body (hats, vests, props, the low-poly far figures): boxes and tubes
 * mapped onto cells of the people atlas (engine/people-atlas.ts) when a figure is merged (`mapCell`).
 */

/** Cells of the people atlas (4 x 8, the head takes two side by side). Rows 0-3: planar parts and the far figures. */
export const RIB = 0;
export const KNIT = 1;
export const HIVIS = 2;
export const LEATHER = 3;
export const JEANS = 4;
export const TROUSERS = 5;
export const SKIN = 6;
export const SHOE = 7;
export const SOLE = 8;
export const HAIR = 9;
export const HEAD = 10;
export const HAT = 12;
export const GLOVE = 13;
export const REFLECT = 14;
export const BAG = 15;
/** Rows 4-7: fabrics unwrapped round the body (people-tailor.ts); u 0 = front centre, 0.5 = side, 1 = back centre. */
export const F_JERSEY = 16;
export const F_POLO = 17;
export const F_JERSEY_SLEEVE = 18;
export const F_FLEECE = 19;
export const F_FLEECE_SLEEVE = 20;
export const F_JACKET = 21;
export const F_JACKET_SLEEVE = 22;
export const F_COVERALL = 23;
export const F_COVERALL_SLEEVE = 24;
export const F_COVERALL_LEG = 25;
export const F_VEST = 26;
export const F_DENIM = 27;
export const F_TWILL = 28;
export const F_CARGO = 29;
export const F_PLEAT = 30;
export const F_PLAID = 31;
/** Rows in the atlas. */
export const ATLAS_ROWS = 8;

const INSET = 0.02;
const UP = new Vector3(0, 1, 0);

/** Atlas UV of (fu, fv) inside a cell that is `wCells` cells wide; fv = 0 at the top of the cell. */
export function cellUV(
  cell: number,
  fu: number,
  fv: number,
  wCells = 1,
): [number, number] {
  const col = cell % 4;
  const row = Math.floor(cell / 4);
  return [
    (col + INSET * wCells + (wCells - 2 * INSET * wCells) * fu) / 4,
    1 - (row + INSET + (1 - 2 * INSET) * fv) / ATLAS_ROWS,
  ];
}

export const v3 = (x: number, y: number, z: number): Vector3 =>
  new Vector3(x, y, z);

/**
 * Maps a part onto its atlas cell: per triangle the projection along the dominant axis of its normal, scaled by the
 * part's longest side so the weave keeps its proportions (a tube is not stretched).
 */
export function mapCell(g: BufferGeometry, cell: number): BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const size = Math.max(
    b.max.x - b.min.x,
    b.max.y - b.min.y,
    b.max.z - b.min.z,
    1e-3,
  );
  const uv = g.getAttribute('uv');
  for (let t = 0; t < p.count; t += 3) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      nx += Math.abs(n.getX(t + k));
      ny += Math.abs(n.getY(t + k));
      nz += Math.abs(n.getZ(t + k));
    }
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const x = (p.getX(i) - b.min.x) / size;
      const y = (p.getY(i) - b.min.y) / size;
      const z = (p.getZ(i) - b.min.z) / size;
      const [u, w] =
        nz >= nx && nz >= ny ? [x, 1 - y] : nx >= ny ? [z, 1 - y] : [x, z];
      const [cu, cv] = cellUV(cell, u, w);
      uv.setXY(i, cu, cv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Marks the atlas cell a part is mapped to when the figure is merged. */
export const tag = (g: BufferGeometry, cell: number): BufferGeometry => {
  g.userData.cell = cell;
  return g;
};

/** Open tapered tube from `a` (radius `ra`) to `b` (radius `rb`), `flat` squashes it front to back. */
export function tube(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  color: string,
  sides = 5,
  flat = 1,
  cell = KNIT,
): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(ra, rb, Math.max(len, 1e-3), sides, 1, true);
  if (flat !== 1) g.scale(1, 1, flat);
  g.applyQuaternion(
    new Quaternion().setFromUnitVectors(UP, a.clone().sub(b).normalize()),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tag(paint(g, color), cell);
}

/** A box at `at`, optionally turned by a matrix. */
export function block(
  w: number,
  h: number,
  d: number,
  at: Vector3,
  color: string,
  m?: Matrix4,
  cell = HAT,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (m) g.applyMatrix4(m);
  g.translate(at.x, at.y, at.z);
  return tag(paint(g, color), cell);
}

/** Rotation turning the Y axis to `axis`. */
export function along(axis: Vector3): Matrix4 {
  return new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromUnitVectors(UP, axis.clone().normalize()),
  );
}
