import { expect, test } from '@rstest/core';
import { Controls } from '../../src/games/hole/game/input';

function setup() {
  const surface = document.createElement('div');
  const overlay = document.createElement('div');
  const controls = new Controls(surface, overlay);
  controls.enabled = true;
  const fire = (type: string, pointerId: number, x: number, y: number) =>
    surface.dispatchEvent(
      new PointerEvent(type, { pointerId, clientX: x, clientY: y }),
    );
  return { controls, fire };
}

// Pointer ids are only identifiers (iPad Safari assigns its own); the stick must steer for any id.
test.each([1, 0, -1, -123456, 2 ** 31 - 1])(
  'touch with pointerId %i steers the hole',
  (id) => {
    const { controls, fire } = setup();
    fire('pointerdown', id, 100, 100);
    fire('pointermove', id, 100, 40);
    const w = controls.world();
    expect(w.z).toBeLessThan(-0.5);
    fire('pointerup', id, 100, 40);
    expect(controls.world()).toEqual({ x: 0, z: 0 });
  },
);

test('a second finger does not steal the stick', () => {
  const { controls, fire } = setup();
  fire('pointerdown', -5, 100, 100);
  fire('pointerdown', -6, 300, 300);
  fire('pointermove', -6, 300, 200);
  expect(controls.world()).toEqual({ x: 0, z: 0 });
  fire('pointermove', -5, 100, 40);
  expect(controls.world().z).toBeLessThan(-0.5);
});

test('release drops the touch', () => {
  const { controls, fire } = setup();
  fire('pointerdown', -1, 100, 100);
  fire('pointermove', -1, 160, 100);
  expect(controls.world().x).toBeGreaterThan(0.5);
  controls.release();
  expect(controls.world()).toEqual({ x: 0, z: 0 });
  fire('pointerdown', -1, 100, 100);
  fire('pointermove', -1, 40, 100);
  expect(controls.world().x).toBeLessThan(-0.5);
});
