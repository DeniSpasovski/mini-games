import { describe, expect, test } from '@rstest/core';
import type { Matrix4 } from 'three';
import { PeopleAnimator } from '../../src/games/rally/world/people-anim';
import type { ScatterInstance } from '../../src/games/rally/world/scatter';

const person = (
  asset: string,
  x: number,
  z: number,
  rotY = 0,
): ScatterInstance =>
  ({
    asset,
    variant: 0,
    x,
    y: 0,
    z,
    rotY,
    scale: 1,
    tiltX: 0,
    tiltZ: 0,
  }) as ScatterInstance;

const calls: [ScatterInstance, Matrix4 | null][] = [];
const set = (i: ScatterInstance, m: Matrix4 | null) => {
  calls.push([i, m]);
};

/** People turn to watch the car, photographers keep it centred, far people and other assets stay put. */
describe('people animator', () => {
  test('a fan turns towards the car; a far one does not', () => {
    const near = person('spectator', 10, 0, 0);
    const far = person('spectator', 300, 0, 0);
    const post = person('tape_post', 5, 0, 0);
    const a = new PeopleAnimator([near, far, post]);
    expect(a.count).toBe(2);
    // Car straight along +x of the fan: the fan (facing +z at yaw 0) must end up facing +x = yaw pi / 2.
    for (let k = 0; k < 120; k++) a.update(1 / 60, 40, 0, 0, 0, set);
    expect(a.yawOf(near)).toBeCloseTo(Math.PI / 2, 3);
    expect(a.yawOf(far)).toBe(0);
  });

  test('photographers turn faster and aim ahead of a moving car', () => {
    const f = person('spectator', 0, 0, 0);
    const p = person('photographer', 0, 0, 0);
    const a = new PeopleAnimator([f, p]);
    a.update(1 / 60, 30, 0, 0, 0, set);
    expect(a.yawOf(p)!).toBeGreaterThan(a.yawOf(f)!);
    for (let k = 0; k < 120; k++) a.update(1 / 60, 30, 0, 0, 40, set);
    // The car moves along +z at 40 m/s: aimed 6 m ahead of it.
    expect(a.yawOf(p)).toBeCloseTo(Math.atan2(30, 6), 2);
  });

  test('they go back and reset', () => {
    const f = person('marshal', 0, 0, 1);
    const a = new PeopleAnimator([f]);
    for (let k = 0; k < 120; k++) a.update(1 / 60, 20, 0, 0, 0, set);
    expect(a.yawOf(f)).not.toBe(1);
    for (let k = 0; k < 240; k++) a.update(1 / 60, 400, 0, 0, 0, set);
    expect(a.yawOf(f)).toBe(1);
    a.reset(set);
    expect(a.turned).toBe(0);
  });
});
