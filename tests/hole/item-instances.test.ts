import { expect, test } from '@rstest/core';
import {
  BatchedMesh,
  BoxGeometry,
  MeshLambertMaterial,
  PerspectiveCamera,
  ShaderChunk,
  type BufferGeometry,
  type DataTexture,
  type Material,
} from 'three';
import { minimalMap } from '../../src/games/hole/map/minimal';
import { ItemInstances } from '../../src/games/hole/render/item-instances';
import { FallState } from '../../src/games/hole/sim/fall';
import { World } from '../../src/games/hole/sim/world';

/** What a batch draws this pass (`_multiDrawCount` + the instance ids in the indirect texture). */
type Batch = BatchedMesh & {
  items: Int32Array;
  _multiDrawCount: number;
  _indirectTexture: { image: { data: Uint32Array } };
};

const mat = () => new MeshLambertMaterial({ vertexColors: true });
const mats = { prop: mat(), punched: mat(), ribbon: mat(), glass: mat() };

/** World items drawn by the camera pass (or the shadow pass) of every batch. */
function drawn(
  inst: ItemInstances,
  cam: PerspectiveCamera,
  shadow = false,
): Set<number> {
  const out = new Set<number>();
  for (const o of inst.group.children) {
    const b = o as Batch;
    b.updateMatrixWorld();
    if (shadow)
      b.onBeforeShadow(
        null as never,
        null as never,
        cam,
        cam,
        b.geometry,
        b.material as Material,
        null as never,
      );
    else
      b.onBeforeRender(
        null as never,
        null as never,
        cam,
        b.geometry as BufferGeometry,
        b.material as Material,
        null as never,
      );
    const ids = b._indirectTexture.image.data;
    for (let k = 0; k < b._multiDrawCount; k++) out.add(b.items[ids[k]]);
  }
  return out;
}

function lookDownAt(x: number, z: number, height: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 1, 0.5, 2000);
  cam.position.set(x, height, z + 0.01);
  cam.lookAt(x, 0, z);
  cam.updateMatrixWorld();
  return cam;
}

test('items are batched per material and culled per cell + per item', () => {
  // a 600 m row of benches and pedestrians (two batches: small props + shadow-casting props)
  const placements = [];
  for (let k = 0; k < 120; k++)
    placements.push({
      item: k % 2 ? 'bench' : 'pedestrian',
      x: k * 5,
      z: 0,
      rot: 0,
      variant: 0,
      paint: 0,
    });
  const world = new World(minimalMap(placements));
  const inst = new ItemInstances(world, mats);
  // a handful of BatchedMeshes, not one mesh per type and cell
  expect(inst.group.children.length).toBeLessThanOrEqual(8);
  expect(inst.group.children.every((c) => c instanceof BatchedMesh)).toBe(true);

  // a camera 30 m above x = 300 sees roughly x = 286..314: only those items are drawn
  const cam = lookDownAt(300, 0, 30);
  const seen = drawn(inst, cam);
  expect(seen.size).toBeGreaterThan(3);
  expect(seen.size).toBeLessThan(15);
  for (const i of seen) expect(Math.abs(world.x[i] - 300)).toBeLessThan(25);
  const centre = placements.findIndex((p) => p.x === 300);
  expect(seen.has(centre)).toBe(true);

  // an eaten item is not drawn any more
  world.state[centre] = FallState.Gone;
  world.gone.push(centre);
  inst.update();
  expect(drawn(inst, cam).has(centre)).toBe(false);

  // the level of detail drops tiny items far away (benches / pedestrians are under 2 m)
  inst.setView(2000);
  expect(drawn(inst, lookDownAt(300, 0, 300)).size).toBe(0);
  inst.setView(0);
  expect(drawn(inst, lookDownAt(300, 0, 300)).size).toBeGreaterThan(20);
  inst.dispose();
});

test('three.js internals the item batches rely on are still there', () => {
  // render/materials.ts patches this line so only `paint` parts take the per-instance colour
  expect(ShaderChunk.color_vertex).toContain(
    'vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );',
  );
  expect(ShaderChunk.color_vertex).toContain(
    'vColor.rgb *= instanceColor.rgb;',
  );
  // render/item-instances.ts writes the multi-draw list itself
  const b = new BatchedMesh(4, 100, 0, mat()) as unknown as Record<
    string,
    unknown
  >;
  for (const key of [
    '_multiDrawStarts',
    '_multiDrawCounts',
    '_multiDrawCount',
    '_indirectTexture',
    '_matricesTexture',
    '_geometryInfo',
  ])
    expect(b[key]).toBeDefined();
  const bm = b as unknown as BatchedMesh;
  const g = bm.addGeometry(new BoxGeometry().toNonIndexed());
  const info = (b._geometryInfo as { start: number; count: number }[])[g];
  expect(info.count).toBe(36);
  bm.dispose();
});

test('after the first render only the changed matrix rows are re-uploaded', () => {
  const placements = [];
  for (let k = 0; k < 400; k++)
    placements.push({
      item: 'bench',
      x: k * 2,
      z: 0,
      rot: 0,
      variant: 0,
      paint: 0,
    });
  const world = new World(minimalMap(placements));
  const inst = new ItemInstances(world, mats);
  const batch = inst.group.children[0] as BatchedMesh;
  const tex = (batch as unknown as { _matricesTexture: DataTexture })
    ._matricesTexture;
  const rows = tex.image.height;

  // before the texture is on the GPU the whole thing is sent (no ranges)
  world.moving.add(5);
  inst.update();
  expect(tex.updateRanges.length).toBe(0);

  drawn(inst, lookDownAt(100, 0, 30)); // first render
  world.moving.add(5);
  world.moving.add(6);
  inst.update();
  // two neighbours share one row: one range of one full row
  expect(tex.updateRanges.length).toBe(1);
  expect(tex.updateRanges[0].count).toBe(tex.image.width * 4);
  tex.clearUpdateRanges();

  // more than half of the rows changed: full upload instead
  for (let i = 0; i < world.n; i++) world.moving.add(i);
  inst.update();
  expect(tex.updateRanges.length).toBe(0);
  expect(rows).toBeGreaterThan(2);
  inst.dispose();
});
