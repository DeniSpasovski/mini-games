import { describe, expect, test } from '@rstest/core';
import { Box3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { buildCockpit } from '../../src/games/rally/cars/shared/cockpit';
import { buildProfileBody } from '../../src/games/rally/cars/shared/profile-body';

/**
 * Every car has a body to show without its GLB: hand-built (`custom`) or the boxy side-outline extrusion
 * (`profile`, baked by scripts/car-model/side-profile.mjs). The extrusion must be the car's size and leave the
 * wheels free.
 */
function inside(o: number[], z: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
    const [zi, yi, zj, yj] = [o[i], o[i + 1], o[j], o[j + 1]];
    if (yi > y !== yj > y && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi)
      hit = !hit;
  }
  return hit;
}

describe.each(ALL_CARS.map((c) => c.id))('%s', (id) => {
  const car = ALL_CARS.find((c) => c.id === id)!;
  const { model: m, physics: p } = car;

  test('has a fallback body', () => {
    expect(!!m.custom || !!m.profile).toBe(true);
  });

  test.runIf(!!m.profile)('side-outline extrusion fits the car', () => {
    const profile = m.profile!;
    expect(profile.outline.length % 2).toBe(0);
    const g = buildProfileBody(profile);
    const box = new Box3().setFromBufferAttribute(
      g.getAttribute('position') as never,
    );
    expect(box.max.x).toBeCloseTo(profile.width / 2, 5);
    expect(box.min.x).toBeCloseTo(-profile.width / 2, 5);
    expect(box.min.y).toBeGreaterThanOrEqual(0);
    expect(box.max.z - box.min.z).toBeGreaterThan(p.length * 0.9);
    expect(box.max.z - box.min.z).toBeLessThan(p.length * 1.1);
    expect(profile.width).toBeLessThan(p.width + 0.1);
    // The wheels show through the arches: top of the tyre and both sides at hub height are outside the outline.
    const r = p.wheelRadius;
    for (const z of [p.front.z, p.rear.z]) {
      expect(inside(profile.outline, z, 2 * r - 0.02)).toBe(false);
      expect(inside(profile.outline, z - 0.95 * r, r)).toBe(false);
      expect(inside(profile.outline, z + 0.95 * r, r)).toBe(false);
    }
    // ...and the cabin is solid.
    expect(inside(profile.outline, 0, 0.8)).toBe(true);
  });

  test.runIf(!!m.profile)(
    'profile matches the car and tags glass + lamps',
    () => {
      const profile = m.profile!;
      expect(profile.axles[0]).toBeCloseTo(p.front.z, 2);
      expect(profile.axles[1]).toBeCloseTo(p.rear.z, 2);
      expect(profile.wheel).toBeCloseTo(p.wheelRadius, 2);
      // The greenhouse sits over the beltline, across the cabin.
      expect(inside(profile.glass, 0, 1.1)).toBe(true);
      expect(inside(profile.glass, 0, 0.6)).toBe(false);
      for (const [x0, x1, y0, y1] of [
        profile.lamps.front,
        profile.lamps.rear,
      ]) {
        expect(x0).toBeLessThan(x1);
        expect(y0).toBeLessThan(y1);
        expect(x1).toBeLessThanOrEqual(profile.width / 2);
      }
    },
  );

  test.runIf(!!m.profile)(
    'procedural cockpit stays inside the greenhouse',
    () => {
      const profile = m.profile!;
      const ys = profile.outline.filter((_, i) => i % 2);
      const zs = profile.outline.filter((_, i) => i % 2 === 0);
      const c = buildCockpit(profile, 'rally');
      for (const g of [c.interior, c.cage, c.lining]) {
        const box = new Box3().setFromBufferAttribute(
          g.getAttribute('position') as never,
        );
        expect(box.isEmpty()).toBe(false);
        expect(box.max.x).toBeLessThanOrEqual(profile.glassWidth[0] / 2);
        expect(box.min.y).toBeGreaterThanOrEqual(0.25);
        expect(box.max.y).toBeLessThan(Math.max(...ys));
        expect(box.min.z).toBeGreaterThan(Math.min(...zs));
        expect(box.max.z).toBeLessThan(Math.max(...zs));
      }
    },
  );

  test.runIf(!!m.profile)('extrusion wears the livery atlas', () => {
    const layout = m.gltf?.atlas?.layout;
    expect(layout).toBeDefined();
    const uv = buildProfileBody(m.profile!, layout).getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });
});
