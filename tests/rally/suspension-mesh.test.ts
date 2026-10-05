import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  buildCoilover,
  springShape,
  suspensionLength,
} from '../../src/games/rally/cars/shared/suspension-mesh';
import { SETUP_IDS } from '../../src/games/rally/physics/car-setup';

/** Coil-over geometry per car style + preset (cars/shared/suspension-mesh.ts). */
describe.each(ALL_CARS)('$id coil-overs', (car) => {
  const style = car.model.suspensionStyle;
  const unit = (id: (typeof SETUP_IDS)[number]) =>
    buildCoilover(style, car.physics.setups[id]);

  test('length follows the travel (soft is the longest) and stays within the triangle budget', () => {
    const [soft, medium, stiff] = SETUP_IDS.map(unit);
    expect(soft.length).toBeGreaterThan(medium.length);
    expect(medium.length).toBeGreaterThan(stiff.length);
    for (const u of [soft, medium, stiff]) {
      const tris = [u.body, u.chrome, u.spring].reduce(
        (n, g) => n + g.getAttribute('position').count / 3,
        0,
      );
      expect(tris).toBeLessThan(6000);
      for (const g of [u.body, u.chrome, u.spring]) {
        const pos = g.getAttribute('position');
        let top = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(
            true,
          );
          top = Math.max(top, pos.getY(i));
        }
        expect(top).toBeLessThanOrEqual(u.length + 0.01);
      }
    }
  });
});

test('stiffer springs get fewer, thicker coils', () => {
  const soft = springShape(34000);
  const stiff = springShape(98000);
  expect(stiff.coils).toBeLessThan(soft.coils);
  expect(stiff.wire).toBeGreaterThan(soft.wire);
  expect(suspensionLength(0.26)).toBeGreaterThan(suspensionLength(0.15));
});

test('every car has its own hardware look', () => {
  const styles = ALL_CARS.map((c) => c.model.suspensionStyle);
  expect(new Set(styles).size).toBe(ALL_CARS.length);
});
