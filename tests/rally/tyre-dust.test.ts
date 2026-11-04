import { expect, test } from '@rstest/core';
import { TyreDust } from '../../src/games/rally/game/tyre-dust';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import type { Vehicle } from '../../src/games/rally/physics/vehicle';

/** Tyre dust (game/tyre-dust.ts): a few steps from distance on loose ground, faster off the road, wiped on tarmac. */
const car = (surface: SurfaceId, speed = 20, slideSpeed = 0) =>
  ({
    speed,
    wheels: Array.from({ length: 4 }, () => ({
      contact: true,
      surface: SURFACES[surface],
      slideSpeed,
    })),
  }) as unknown as Vehicle;

/** Drive `metres` at 20 m/s in 0.1 s steps. */
function drive(d: TyreDust, v: Vehicle, metres: number): void {
  for (let m = 0; m < metres; m += 2) d.update(0.1, v);
}

test('builds up in steps on gravel and stays clean on tarmac', () => {
  const d = new TyreDust();
  drive(d, car('tarmac'), 5000);
  expect(d.step).toBe(0);
  drive(d, car('gravel'), 300);
  expect(d.step).toBe(1);
  drive(d, car('gravel'), 1300);
  expect(d.step).toBe(2);
  expect(d.level).toBeGreaterThan(0);
});

test('off the road it builds up faster, and tarmac wipes some off', () => {
  const road = new TyreDust();
  const off = new TyreDust();
  drive(road, car('gravel'), 1000);
  drive(off, car('grass'), 1000);
  expect(off.step).toBeGreaterThan(road.step);
  const before = off.amount;
  drive(off, car('tarmac'), 1000);
  expect(off.amount).toBeLessThan(before);
  off.reset();
  expect(off.step).toBe(0);
});
