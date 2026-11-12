import { describe, expect, test } from '@rstest/core';
import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import { FIRE_TRUCK_DATA } from '../../src/games/rally/assets/builders/fire-trucks.data';
import { vehicleModel } from '../../src/games/rally/assets/builders/street-car-models';
import { STREET_CAR_DATA } from '../../src/games/rally/assets/builders/street-cars.data';
import {
  roundWheels,
  type TriangleSoup,
} from '../../src/games/rally/assets/builders/wheel-rounding';

/**
 * Near-LOD wheels of the baked vehicles get more sides (wheel-rounding.ts): only the wheels change, the new points
 * are on the wheel's own circles, and the other LODs stay as baked.
 */
const soupOf = (parts: BufferGeometry[]): TriangleSoup => {
  const pos: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  for (const part of parts) {
    const g = part.toNonIndexed();
    pos.push(...g.getAttribute('position').array);
    normal.push(...g.getAttribute('normal').array);
    uv.push(...g.getAttribute('uv').array);
  }
  return {
    pos: new Float32Array(pos),
    normal: new Float32Array(normal),
    uv: new Float32Array(uv),
  };
};

describe('wheel rounding', () => {
  test('a 12-sided wheel becomes 24-sided, the body stays', () => {
    const R = 0.32;
    const wheel = new CylinderGeometry(R, R, 0.2, 12, 1)
      .rotateX(Math.PI / 2)
      .translate(1.2, R, 0.8);
    const body = new BoxGeometry(4, 1, 1.4).translate(0, 0.9, 0);
    const before = soupOf([body, wheel]);
    const after = roundWheels(before);
    const bodyCount = body.toNonIndexed().getAttribute('position').count;
    // The body comes first and is untouched.
    expect(Array.from(after.pos.slice(0, bodyCount * 3))).toEqual(
      Array.from(before.pos.slice(0, bodyCount * 3)),
    );
    expect(after.pos.length).toBeGreaterThan(before.pos.length);
    const angles = new Set<number>();
    for (let v = bodyCount; v < after.pos.length / 3; v++) {
      const x = after.pos[v * 3] - 1.2;
      const y = after.pos[v * 3 + 1] - R;
      const r = Math.hypot(x, y);
      // Cap centres aside, every point is on the tyre's circle.
      if (r < 0.01) continue;
      expect(r).toBeCloseTo(R, 4);
      angles.add(Math.round((Math.atan2(y, x) * 180) / Math.PI));
      const n = Math.hypot(
        after.normal[v * 3],
        after.normal[v * 3 + 1],
        after.normal[v * 3 + 2],
      );
      expect(n).toBeCloseTo(1, 4);
    }
    expect(angles.size).toBe(24);
  });

  test('a model without wheels is returned as it is', () => {
    const soup = soupOf([new BoxGeometry(2, 1, 1).translate(0, 0.5, 0)]);
    expect(roundWheels(soup)).toBe(soup);
  });

  test.each([
    ...STREET_CAR_DATA.map((d, i) => ['car', d.id, i] as const),
    ['fire', 'fire_truck', 0] as const,
  ])('%s %s: rounder at LOD 0 only, same size', (kind, _id, index) => {
    const list = kind === 'car' ? STREET_CAR_DATA : FIRE_TRUCK_DATA;
    // A copy of the list is cached apart: the model as baked.
    const baked = [...list];
    for (const lod of [0, 1]) {
      const a = vehicleModel(baked, index, lod).geometry('#ffffff');
      const b = vehicleModel(list, index, lod, true).geometry('#ffffff');
      const na = a.getAttribute('position').count;
      const nb = b.getAttribute('position').count;
      if (lod === 0) {
        expect(nb).toBeGreaterThan(na);
        expect(nb).toBeLessThan(na * 1.8);
      } else expect(nb).toBe(na);
      a.computeBoundingBox();
      b.computeBoundingBox();
      for (const k of ['x', 'y', 'z'] as const) {
        expect(b.boundingBox!.min[k]).toBeCloseTo(a.boundingBox!.min[k], 2);
        expect(b.boundingBox!.max[k]).toBeCloseTo(a.boundingBox!.max[k], 2);
      }
    }
  });
});
