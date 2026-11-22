import { describe, expect, test } from '@rstest/core';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  CameraRig,
  type CameraMode,
} from '../../src/games/rally/game/camera-rig';

/** Car at the origin facing +z (its right is -x); camera stepped at 60 fps. */
function rig(mode: CameraMode = 'chase') {
  const r = new CameraRig(new PerspectiveCamera(), () => 0);
  r.mode = mode;
  const v = {
    velocity: new Vector3(),
    impact: 0,
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  } as never;
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
    return r.camera;
  };
  return { step };
}

describe('right-stick look around', () => {
  test('chase: the stick position is the camera position, release returns', () => {
    const { step } = rig();
    const home = step({ x: 0, y: 0 }).position.clone();
    expect(home.z).toBeLessThan(-4); // behind the car
    // Stick right: the camera on the car's right side (-x).
    const right = step({ x: 1, y: 0 }).position;
    expect(right.x).toBeLessThan(-4);
    expect(Math.abs(right.z)).toBeLessThan(1);
    // Stick down-right: behind the car, on its right.
    const dr = step({ x: 0.7, y: 0.7 }).position;
    expect(dr.x).toBeLessThan(-2);
    expect(dr.z).toBeLessThan(-2);
    // Stick up: in front of the car, looking back.
    expect(step({ x: 0, y: -1 }).position.z).toBeGreaterThan(4);
    // Stick left: the car's left side (+x).
    expect(step({ x: -1, y: 0 }).position.x).toBeGreaterThan(4);
    expect(step({ x: 0, y: 0 }).position.distanceTo(home)).toBeLessThan(0.05);
  });

  test('chase: the camera aims at the car the same way at every stick angle', () => {
    const { step } = rig();
    const dir = new Vector3();
    const pitch = (look: { x: number; y: number }) => {
      const cam = step(look);
      cam.getWorldDirection(dir);
      // Points at the car (the origin), whatever the angle round it.
      const toCar = cam.position.clone().negate().setY(0).normalize();
      expect(dir.clone().setY(0).normalize().dot(toCar)).toBeGreaterThan(0.999);
      return dir.y;
    };
    const down = pitch({ x: 0, y: 1 });
    for (const look of [
      { x: 1, y: 0 },
      { x: 0.7, y: 0.7 },
      { x: 0, y: -1 },
      { x: -0.7, y: 0.7 },
    ])
      expect(pitch(look)).toBeCloseTo(down, 3);
  });

  test('in car: stick right looks right, down looks back', () => {
    const { step } = rig('hood');
    const dir = new Vector3();
    expect(step({ x: 1, y: 0 }).getWorldDirection(dir).x).toBeLessThan(-0.9);
    expect(step({ x: 0, y: 1 }).getWorldDirection(dir).z).toBeLessThan(-0.9);
  });
});
