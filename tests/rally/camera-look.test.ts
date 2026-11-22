import { describe, expect, test } from '@rstest/core';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../../src/games/rally/game/camera-rig';

/** Car at the origin facing +z (its right is -x); camera stepped at 60 fps. */
function rig() {
  const r = new CameraRig(new PerspectiveCamera(), () => 0);
  const v = { velocity: new Vector3(), impact: 0 } as never;
  const step = (look: { x: number; y: number }, n = 60) => {
    for (let i = 0; i < n; i++)
      r.update(
        1 / 60,
        v,
        new Vector3(),
        new Vector3(0, 0, 1),
        new Vector3(0, 1, 0),
        look,
      );
    return r.camera.position;
  };
  return { step };
}

describe('right-stick look around (stick direction = view direction)', () => {
  test('right looks at the right side, down looks back, release returns', () => {
    const { step } = rig();
    const home = step({ x: 0, y: 0 }).clone();
    expect(home.z).toBeLessThan(-4); // behind the car
    // Looking right: the camera sits on the car's left (+x), looking across it.
    const right = step({ x: 1, y: 0 });
    expect(right.x).toBeGreaterThan(4);
    expect(Math.abs(right.z)).toBeLessThan(1);
    // Looking back: the camera sits ahead of the car.
    expect(step({ x: 0, y: 1 }).z).toBeGreaterThan(4);
    expect(step({ x: 0, y: 0 }).distanceTo(home)).toBeLessThan(0.05);
  });

  test('left mirrors right', () => {
    const { step } = rig();
    expect(step({ x: -1, y: 0 }).x).toBeLessThan(-4);
  });
});
