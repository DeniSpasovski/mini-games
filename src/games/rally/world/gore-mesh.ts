import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { getTexture } from '../engine/textures';
import { GORE_TILE, goreWedges } from './gore';
import type { World } from './world';

/** Gore areas (gore.ts) as one textured strip per wedge, draped over the terrain. */
export function* goreMeshJob(world: World): Generator<void, Group | undefined> {
  const net = world.gen.paths;
  if (!net || !world.map.goreAreas) return undefined;
  const wedges = goreWedges(world.road, net, world.map.gorePathsFromX);
  if (!wedges.length) return undefined;
  const hf = world.analytic;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const w of wedges) {
    const v0 = pos.length / 3;
    for (const r of w.rows) {
      for (const [x, z, u] of [
        [r.ax, r.az, 0],
        [r.bx, r.bz, 1],
      ]) {
        pos.push(x, hf.height(x, z) + 0.04, z);
        uv.push(u, r.t / GORE_TILE);
      }
    }
    for (let i = 0; i < w.rows.length - 1; i++) {
      const q = v0 + i * 2;
      idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
    }
  }
  yield;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new Mesh(
    g,
    new MeshStandardMaterial({
      map: getTexture('gore'),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      side: 2,
    }),
  );
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  const group = new Group();
  group.name = 'gore';
  group.add(m);
  return group;
}
