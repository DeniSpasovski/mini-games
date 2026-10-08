import {
  BufferAttribute,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { atlasUv, type AtlasChart, type AtlasLayout } from './atlas-painter';
import type { CarProfile } from './types';

/**
 * Boxy car from an imported car's profile (`cars/<car>/profile.ts`, baked from the GLB by
 * scripts/car-model/side-profile.mjs), in car model space (y = 0 ground, +z nose, +x left). Shown as the car's body when
 * its GLB can't load (car viewer `fallback=1`) and as the street cars of the city maps (assets/builders/vehicles.ts).
 * DOM-free.
 */

/** Side outline (z, y) extruded across `width`, centred on x = 0. */
export function slab(o: number[], width: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(o[0], o[1]);
  for (let i = 2; i < o.length; i += 2) shape.lineTo(o[i], o[i + 1]);
  shape.closePath();
  // Shape (x, y) = model (z, y); the extrusion runs along the shape's +z, turned to model -x and centred.
  const g = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

/**
 * The body: the side outline extruded straight across to the body width. With the car's atlas `layout` every face
 * gets the GLB's box-projection UVs (chart by facing, as stl-to-glb.mjs), so the livery paints it.
 */
export function buildProfileBody(
  profile: CarProfile,
  layout?: AtlasLayout,
): BufferGeometry {
  const g = slab(profile.outline, profile.width);
  if (layout) g.setAttribute('uv', atlasUvs(g, layout));
  return g;
}

/** Glass sides stand this far out of the body sides (m). */
const GLASS_PROUD = 0.01;
/** Lamp faces stand this far out of the nose / tail (m). */
const LAMP_PROUD = 0.008;

export interface ProfileParts {
  body: BufferGeometry;
  /** Greenhouse: side windows, windscreen and rear window in one slab. */
  glass: BufferGeometry;
  /** Head / tail lamp faces (both sides). */
  head: BufferGeometry;
  tail: BufferGeometry;
}

/** Body + the tagged glass and lamps. `tol` (m) simplifies both outlines further (a far LOD). */
export function buildProfileParts(
  profile: CarProfile,
  layout?: AtlasLayout,
  tol = 0,
): ProfileParts {
  const p = tol
    ? {
        ...profile,
        outline: simplifyLoop(profile.outline, tol),
        glass: simplifyLoop(profile.glass, tol),
      }
    : profile;
  return {
    body: buildProfileBody(p, layout),
    glass: slab(p.glass, p.width + 2 * GLASS_PROUD),
    head: lampFaces(p, true),
    tail: lampFaces(p, false),
  };
}

/** Douglas-Peucker on a flat (z, y) list, ends kept. */
function simplify(o: number[], tol: number): number[] {
  const n = o.length / 2;
  if (n < 3) return o;
  const [az, ay, bz, by] = [o[0], o[1], o[o.length - 2], o[o.length - 1]];
  const len = Math.hypot(bz - az, by - ay) || 1e-9;
  let far = 0;
  let best = 0;
  for (let i = 1; i < n - 1; i++) {
    const d =
      Math.abs((bz - az) * (ay - o[2 * i + 1]) - (az - o[2 * i]) * (by - ay)) /
      len;
    if (d > far) [far, best] = [d, i];
  }
  if (far <= tol) return [az, ay, bz, by];
  return [
    ...simplify(o.slice(0, 2 * best + 2), tol).slice(0, -2),
    ...simplify(o.slice(2 * best), tol),
  ];
}

/** Closed outline simplified as two halves, split at the point farthest from the first. */
function simplifyLoop(o: number[], tol: number): number[] {
  let k = 0;
  let far = 0;
  for (let i = 2; i < o.length; i += 2) {
    const d = Math.hypot(o[i] - o[0], o[i + 1] - o[1]);
    if (d > far) [far, k] = [d, i];
  }
  return [
    ...simplify(o.slice(0, k + 2), tol).slice(0, -2),
    ...simplify([...o.slice(k), o[0], o[1]], tol).slice(0, -2),
  ];
}

/** Nose (front) or tail end of the outline at height y: the outermost crossing (m). */
function endAt(o: number[], y: number, front: boolean): number {
  let best = front ? -Infinity : Infinity;
  for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
    const [z0, y0, z1, y1] = [o[j], o[j + 1], o[i], o[i + 1]];
    if (y0 > y === y1 > y) continue;
    const z = z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
    best = front ? Math.max(best, z) : Math.min(best, z);
  }
  return best;
}

/** Both lamps of one end: a flat face on the outline's end at the lamp's mid height. */
function lampFaces(profile: CarProfile, front: boolean): BufferGeometry {
  const [x0, x1, y0, y1] = front ? profile.lamps.front : profile.lamps.rear;
  const z =
    endAt(profile.outline, (y0 + y1) / 2, front) +
    (front ? LAMP_PROUD : -LAMP_PROUD);
  const faces = [1, -1].map((side) => {
    const g = new PlaneGeometry(x1 - x0, y1 - y0);
    if (!front) g.rotateY(Math.PI);
    return g.translate((side * (x0 + x1)) / 2, (y0 + y1) / 2, z);
  });
  return mergeGeometries(faces);
}

/**
 * One simple wheel at the origin, axle along x, outer face at +x: a tyre (open-ended cylinder + sidewall disc) and a
 * flat rim disc on the outer face. `segments` sets how round it is.
 */
export function buildProfileWheel(
  radius: number,
  width: number,
  segments: number,
): { tyre: BufferGeometry; rim: BufferGeometry } {
  const tread = new CylinderGeometry(radius, radius, width, segments, 1, true);
  const wall = new CircleGeometry(radius, segments).translate(0, 0, width / 2);
  wall.rotateY(Math.PI / 2);
  tread.rotateZ(Math.PI / 2);
  const rim = new CircleGeometry(radius * 0.66, segments)
    .translate(0, 0, width / 2 + 0.004)
    .rotateY(Math.PI / 2);
  return {
    tyre: mergeGeometries([tread.toNonIndexed(), wall.toNonIndexed()]),
    rim,
  };
}

/** Per triangle (ExtrudeGeometry is non-indexed): the chart its face normal points at, then that chart's UV. */
function atlasUvs(g: BufferGeometry, layout: AtlasLayout): BufferAttribute {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let t = 0; t < p.count; t += 3) {
    const a = [0, 1, 2].map((k) => [
      p.getX(t + k),
      p.getY(t + k),
      p.getZ(t + k),
    ]);
    const e1 = [0, 1, 2].map((k) => a[1][k] - a[0][k]);
    const e2 = [0, 1, 2].map((k) => a[2][k] - a[0][k]);
    const [nx, ny, nz] = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    const chart: AtlasChart =
      ax >= ay && ax >= az
        ? nx > 0
          ? 'left'
          : 'right'
        : ay >= az
          ? ny > 0
            ? 'top'
            : 'bottom'
          : nz > 0
            ? 'front'
            : 'rear';
    for (let k = 0; k < 3; k++)
      uv.set(atlasUv(layout, chart, a[k][0], a[k][1], a[k][2]), (t + k) * 2);
  }
  return new BufferAttribute(uv, 2);
}
