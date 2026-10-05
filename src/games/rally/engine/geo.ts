import { BufferAttribute, Color, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../../shared/rng';

/**
 * Geometry helpers for procedural assets. Convention: builders produce
 * NON-indexed geometries with position / normal / uv / color attributes so
 * any parts can be merged into a single draw call.
 */

/** Convert to non-indexed and paint a vertex colour (optionally jittered per vertex). */
export function paint(
  geo: BufferGeometry,
  color: Color | number | string,
  rng?: Rng,
  jitter = 0,
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.getAttribute('uv')) {
    g.setAttribute(
      'uv',
      new BufferAttribute(
        new Float32Array(g.getAttribute('position').count * 2),
        2,
      ),
    );
  }
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = rng && jitter ? 1 + (rng.next() - 0.5) * 2 * jitter : 1;
    arr[i * 3] = c.r * j;
    arr[i * 3 + 1] = c.g * j;
    arr[i * 3 + 2] = c.b * j;
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

/** Multiply vertex colours by f(position) - e.g. darken towards the ground for fake AO. */
export function shade(
  geo: BufferGeometry,
  f: (x: number, y: number, z: number) => number,
): BufferGeometry {
  const p = geo.getAttribute('position');
  const c = geo.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const k = f(p.getX(i), p.getY(i), p.getZ(i));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed (attribute mismatch?)');
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Displace every vertex by f(x,y,z) -> offset along its direction from the origin (same pos => same offset, no cracks). */
export function displaceRadial(
  geo: BufferGeometry,
  f: (x: number, y: number, z: number) => number,
): BufferGeometry {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const k = 1 + f(x, y, z) / len;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  p.needsUpdate = true;
  return geo;
}

/**
 * Point normals away from a vertical axis (+ an up bias). Gives foliage the
 * soft, volumetric shading of late-2000s games instead of faceted cones.
 */
export function foliageNormals(
  geo: BufferGeometry,
  cx: number,
  cz: number,
  upBias = 0.6,
): BufferGeometry {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - cx;
    const dz = p.getZ(i) - cz;
    const l = Math.hypot(dx, upBias, dz) || 1;
    n.setXYZ(i, dx / l, upBias / l, dz / l);
  }
  n.needsUpdate = true;
  return geo;
}

/** Simple cylindrical UVs (u around Y, v = y * vScale). */
export function cylindricalUV(
  geo: BufferGeometry,
  vScale = 1,
  uScale = 1,
): BufferGeometry {
  const p = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getX(i), p.getZ(i));
    uv.setXY(i, ((a / (Math.PI * 2) + 0.5) * uScale) % 1e6, p.getY(i) * vScale);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Planar UVs from world-ish XZ (or XY) for detail textures. */
export function planarUV(
  geo: BufferGeometry,
  scale = 1,
  plane: 'xz' | 'xy' = 'xy',
): BufferGeometry {
  const p = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    uv.setXY(
      i,
      (p.getX(i) + p.getZ(i) * (plane === 'xy' ? 0.7 : 0)) * scale,
      (plane === 'xy' ? p.getY(i) : p.getZ(i)) * scale,
    );
  }
  uv.needsUpdate = true;
  return geo;
}
