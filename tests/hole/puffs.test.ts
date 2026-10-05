import { expect, test } from '@rstest/core';
import { Matrix4, type InstancedMesh } from 'three';
import { Puffs } from '../../src/games/hole/render/puffs';

test('puffs pop up, rise and are recycled', () => {
  const puffs = new Puffs();
  puffs.spawn(5, 5, 1);
  puffs.update(0.1);
  const mesh = puffs.group.children[0] as InstancedMesh;
  const m = new Matrix4();
  let alive = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    if (m.elements[0] > 0) alive++;
  }
  expect(alive).toBeGreaterThanOrEqual(6);
  puffs.update(2);
  alive = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    if (m.elements[0] > 0) alive++;
  }
  expect(alive).toBe(0);
  // far more bursts than the pool holds must not throw
  for (let k = 0; k < 100; k++) puffs.spawn(0, 0, 30);
  puffs.update(0.05);
  puffs.dispose();
});
