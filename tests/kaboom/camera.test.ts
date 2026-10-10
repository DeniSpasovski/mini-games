import { expect, test } from '@rstest/core';
import { PerspectiveCamera, Vector3 } from 'three';
import { MAP_SIZES, MAP_SIZE_IDS } from '../../src/games/kaboom/map/sizes';
import {
  CameraRig,
  SLAB_DEPTH,
  SLAB_PAD,
  TOP_HEIGHT,
} from '../../src/games/kaboom/render/camera-rig';

const ASPECTS = [16 / 9, 4 / 3, 21 / 9];

function maxNdc(camera: PerspectiveCamera, cols: number, rows: number): number {
  let m = 0;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (const y of [-SLAB_DEPTH, TOP_HEIGHT]) {
        const p = new Vector3(
          sx * (cols / 2 + SLAB_PAD),
          y,
          sz * (rows / 2 + SLAB_PAD),
        ).project(camera);
        m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      }
  return m;
}

test('fitArena: the whole slab is on screen, with little waste, at common aspects', () => {
  for (const id of MAP_SIZE_IDS) {
    const { w, h } = MAP_SIZES[id];
    for (const aspect of ASPECTS) {
      const rig = new CameraRig();
      rig.camera.aspect = aspect;
      rig.camera.updateProjectionMatrix();
      rig.fitArena(w, h);
      const m = maxNdc(rig.camera, w, h);
      expect(m).toBeLessThanOrEqual(1);
      expect(m).toBeGreaterThan(0.85); // tight fit: no wasted screen
    }
  }
});

test('fitArena: a bigger arena needs a farther camera', () => {
  const d = MAP_SIZE_IDS.map((id) => {
    const rig = new CameraRig();
    rig.camera.aspect = 16 / 9;
    rig.camera.updateProjectionMatrix();
    rig.fitArena(MAP_SIZES[id].w, MAP_SIZES[id].h);
    return rig.distance;
  });
  expect(d[0]).toBeLessThan(d[1]);
  expect(d[1]).toBeLessThan(d[2]);
});

test('camera view: follow (default) frames a closer window than the whole arena, on every size', () => {
  for (const id of MAP_SIZE_IDS) {
    const { w, h } = MAP_SIZES[id];
    const dist = (view: 'follow' | 'full'): number => {
      const rig = new CameraRig();
      rig.view = view;
      rig.camera.aspect = 16 / 9;
      rig.camera.updateProjectionMatrix();
      rig.fitView(w, h);
      return rig.distance;
    };
    expect(new CameraRig().view).toBe('follow');
    expect(dist('follow')).toBeLessThan(dist('full'));
  }
});

test('camera view: the follow window snaps onto the player when asked, and stays inside the arena', () => {
  const rig = new CameraRig();
  rig.camera.aspect = 16 / 9;
  rig.camera.updateProjectionMatrix();
  rig.fitView(17, 13);
  expect(rig.following).toBe(true);
  rig.followTo(2, 1, 0.016, true);
  expect(rig.target.x).toBeCloseTo(2);
  expect(rig.target.z).toBeCloseTo(1);
  rig.followTo(99, 99, 0.016, true);
  expect(Math.abs(rig.target.x)).toBeLessThan(17 / 2);
  expect(Math.abs(rig.target.z)).toBeLessThan(13 / 2);
});
