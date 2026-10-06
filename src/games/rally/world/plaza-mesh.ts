import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import { getTexture } from '../engine/textures';
import type { World } from './world';

/** Longest triangle edge of the plaza surface (m): it follows the slab top's slope. */
const MAX_EDGE = 3;
/** Metres per texture repeat. */
const TILE = 8;

/** Junction plazas (plazas.ts): one plain asphalt surface per outline at the slab top, under the street ribbons at its edge. */
export function* plazaMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const plazas = world.gen.plazas;
  if (plazas.empty) return undefined;
  const pos: number[] = [];
  const uv: number[] = [];
  const add = (x: number, z: number) => {
    const y = plazas.height(x, z) ?? world.gen.height(x, z);
    pos.push(x, y + 0.03, z);
    uv.push(x / TILE, z / TILE);
  };
  const tri = (a: number[], b: number[], c: number[]): void => {
    const e = Math.max(
      Math.hypot(a[0] - b[0], a[1] - b[1]),
      Math.hypot(b[0] - c[0], b[1] - c[1]),
      Math.hypot(c[0] - a[0], c[1] - a[1]),
    );
    if (e > MAX_EDGE) {
      const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
      const ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      tri(a, ab, ca);
      tri(ab, b, bc);
      tri(ca, bc, c);
      tri(ab, bc, ca);
      return;
    }
    // Never over the open trench beyond the slab.
    if (!plazas.inside((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 0.5))
      return;
    // Wound to face up (+Y): y of (b - a) x (c - a) > 0.
    const up =
      (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    add(a[0], a[1]);
    if (up) {
      add(b[0], b[1]);
      add(c[0], c[1]);
    } else {
      add(c[0], c[1]);
      add(b[0], b[1]);
    }
  };
  for (const p of plazas.polys) {
    const ring: Vector2[] = [];
    for (let i = 0; i < p.pts.length; i += 2)
      ring.push(new Vector2(p.pts[i], p.pts[i + 1]));
    for (const [i, j, k] of ShapeUtils.triangulateShape(ring, []))
      tri(
        [ring[i].x, ring[i].y],
        [ring[j].x, ring[j].y],
        [ring[k].x, ring[k].y],
      );
    yield;
  }
  if (!pos.length) return undefined;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new Mesh(
    g,
    new MeshStandardMaterial({
      map: getTexture('junction_asphalt'),
      bumpMap: getTexture('junction_asphalt'),
      bumpScale: 1.2,
      roughness: 0.86,
      // Under the street ribbons (road materials use -1 and lower) that reach in at its edge, over the terrain.
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -1,
    }),
  );
  m.material.defines = { RALLY_GROUND: 1 };
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  const group = new Group();
  group.name = 'plazas';
  group.add(m);
  return group;
}
