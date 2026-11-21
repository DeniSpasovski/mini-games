import { describe, expect, test } from '@rstest/core';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../../src/games/rally/game/camera-rig';

function rig() {
  const r = new CameraRig(new PerspectiveCamera(), () => 0);
  const car = new Vector3();
  const v = { velocity: new Vector3(), impact: 0 } as never;
  const step = (look: { x: number; y: number }, n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++)
      r.update(dt, v, car, new Vector3(0, 0, 1), new Vector3(0, 1, 0), look);
  };
  return { r, step };
}

describe('right-stick look around', () => {
  test('orbits all the way round while held, then eases back', () => {
    const { r, step } = rig();
    step({ x: 0, y: 0 }, 5);
    const home = r.camera.position.clone();
    expect(home.z).toBeLessThan(-4);
    step({ x: 1, y: 0 }, 100); // ~1.7 s at 2.6 rad/s: past the side, towards the front
    expect(r.camera.position.z).toBeGreaterThan(-1);
    step({ x: 0, y: 0 }, 300);
    expect(r.camera.position.distanceTo(home)).toBeLessThan(0.05);
  });

  test('stick down lifts the camera, up lowers it, release returns', () => {
    const { r, step } = rig();
    step({ x: 0, y: 0 }, 60);
    const h = r.camera.position.y;
    step({ x: 0, y: 1 }, 60);
    expect(r.camera.position.y).toBeGreaterThan(h + 1.5);
    step({ x: 0, y: 0 }, 300);
    expect(Math.abs(r.camera.position.y - h)).toBeLessThan(0.05);
  });
});
