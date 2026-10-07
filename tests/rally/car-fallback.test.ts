import { describe, expect, test } from '@rstest/core';
import { Box3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
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
