import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry helpers for hand-built bodies (cars/skoda-rally/body.ts, cars/zastava-101/body.ts): one merged geometry
 * per shared material (`CarPartGeometry`), so a whole car stays at a handful of draw calls.
 *   plain  = body-coloured add-ons      trim = black plastic        carbon = glossy carbon aero
 *   mesh   = grille mesh (UVs in m)     glass = window glass        lights / tail / amber = emissive lamps
 *   interior / cage / lining = cockpit seen through the glass
 * Model space: y = 0 ground, z = 0 centre of mass, +Z forward, +X left.
 */
export interface CarPartGeometry {
  plain: BufferGeometry;
  trim: BufferGeometry;
  carbon: BufferGeometry;
  mesh: BufferGeometry;
  glass: BufferGeometry;
  lights: BufferGeometry;
  tail: BufferGeometry;
  /** Amber indicators / reflectors (emissive orange). */
  amber: BufferGeometry;
  /** Cockpit: dark interior, light roll cage + seat shells, back-face-only headliner. */
  interior: BufferGeometry;
  cage: BufferGeometry;
  lining: BufferGeometry;
  /** Polished chrome (lamp reflectors, bezels) - optional, hand-built bodies. */
  chrome?: BufferGeometry;
  /** Clear lamp glass - optional, hand-built bodies. */
  lens?: BufferGeometry;
  /** Tinted lamps (hand-built bodies): faceted coloured reflector seen through a tinted clear lens. */
  redReflector?: BufferGeometry;
  redLens?: BufferGeometry;
  amberReflector?: BufferGeometry;
  amberLens?: BufferGeometry;
}

function nonIndexed(g: BufferGeometry): BufferGeometry {
  if (!g.index) return g;
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

/** Non-indexed box, optionally rotated (X, then Y, then Z) and placed. */
export function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return nonIndexed(g);
}

/** Rounded box (soft-edged scoops, mirrors). */
export function rbox(
  w: number,
  h: number,
  d: number,
  r: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, r);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return nonIndexed(g);
}

export function cyl(
  r: number,
  len: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  axis: 'x' | 'y' | 'z',
  open = false,
): BufferGeometry {
  const g = new CylinderGeometry(r, r, len, segs, 1, open);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return nonIndexed(g);
}

export function mergeAll(g: BufferGeometry[]): BufferGeometry {
  const list = g.filter((x) => x.getAttribute('position').count > 0);
  if (!list.length) return emptyGeometry();
  if (list.length === 1) return list[0];
  const out = mergeGeometries(list, false)!;
  g.forEach((x) => x.dispose());
  return out;
}

export function emptyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(0), 2));
  return g;
}
