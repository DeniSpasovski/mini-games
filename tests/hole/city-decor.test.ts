import { expect, test } from '@rstest/core';
import { InstancedMesh, Mesh, type Object3D } from 'three';
import { generateCity } from '../../src/games/hole/map/generate';
import { buildCityDecor } from '../../src/games/hole/render/city-decor';

function summary(root: Object3D) {
  let tris = 0;
  let meshes = 0;
  let rocks = 0;
  root.traverse((o) => {
    if (o instanceof InstancedMesh) rocks += o.count;
    else if (o instanceof Mesh) {
      meshes++;
      tris += o.geometry.attributes.position.count / 3;
    }
  });
  return { tris, meshes, rocks };
}

test('city decor (curbs, roundabouts, decals, rocks, pier) is deterministic and does not touch the map', () => {
  const map = generateCity({ seed: 3 });
  const before = JSON.stringify([map.rects.length, map.placements.length]);
  const a = summary(buildCityDecor(map));
  const b = summary(buildCityDecor(map));
  expect(a).toEqual(b);
  expect(JSON.stringify([map.rects.length, map.placements.length])).toBe(
    before,
  );
  // curbs + decals are chunked (several meshes), the rocks are one instanced mesh, the pier adds two meshes
  expect(a.meshes).toBeGreaterThan(8);
  expect(a.rocks).toBeGreaterThan(30);
  expect(a.tris).toBeGreaterThan(5000);
});
