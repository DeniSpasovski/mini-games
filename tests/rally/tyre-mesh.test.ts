import { describe, expect, test } from '@rstest/core';
import type { BufferGeometry } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  buildTyre,
  rimRadius,
  treadDepth,
} from '../../src/games/rally/cars/shared/tyre-mesh';
import { tyreSizeFor } from '../../src/games/rally/physics/car-tyres';
import { TYRE_IDS, type TyreId } from '../../src/games/rally/physics/tyres';

/** Tyre geometry (cars/shared/tyre-mesh.ts): budget, size, tread relief, sane normals. */
const fabia = ALL_CARS.find((c) => c.id === 'skoda_rally')!.physics;
const bimmer = ALL_CARS.find((c) => c.id === 'bimmer_m3')!.physics;

function stats(g: BufferGeometry, halfWidth: number) {
  const pos = g.getAttribute('position');
  let maxR = 0;
  let maxX = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, Math.hypot(pos.getY(i), pos.getZ(i)));
    maxX = Math.max(maxX, Math.abs(pos.getX(i)));
  }
  // Lowest point of the tread columns (|x| inside the tread, not the shoulder).
  let minTreadR = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) <= halfWidth * 0.67)
      minTreadR = Math.min(minTreadR, Math.hypot(pos.getY(i), pos.getZ(i)));
  }
  return { tris: pos.count / 3, maxR, maxX, minTreadR };
}

describe.each(TYRE_IDS)('%s tyre', (tyre) => {
  test('is within the triangle budget and the size', () => {
    const size = tyreSizeFor(fabia, tyre);
    const g = buildTyre({ radius: fabia.wheelRadius, size, compound: tyre });
    const s = stats(g, size.width / 2);
    expect(s.tris).toBeLessThan(5500);
    // Overall radius = the physics wheel radius; width = the section width.
    expect(s.maxR).toBeCloseTo(fabia.wheelRadius, 3);
    expect(s.maxX).toBeLessThanOrEqual(size.width / 2 + 1e-4);
    expect(s.maxX).toBeGreaterThan(size.width / 2 - 0.01);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true);
    }
    expect(g.getAttribute('color').count).toBe(n.count);
    g.dispose();
  });
});

test('tread relief is deeper from tarmac to mixed to gravel (and the plain carcass has none)', () => {
  const size = tyreSizeFor(fabia, 'mixed');
  const relief = (c: TyreId | null) => {
    const g = buildTyre({ radius: fabia.wheelRadius, size, compound: c });
    const s = stats(g, size.width / 2);
    g.dispose();
    return s.maxR - s.minTreadR;
  };
  const [slick, tarmac, mixed, gravel] = [null, ...TYRE_IDS].map(relief);
  expect(slick).toBeLessThan(0.001);
  expect(treadDepth('tarmac')).toBeLessThan(treadDepth('mixed'));
  expect(treadDepth('mixed')).toBeLessThan(treadDepth('gravel'));
  // The measured relief follows the pattern depths (tarmac / mixed / gravel in TYRE_IDS order).
  expect(tarmac).toBeGreaterThan(0.002);
  expect(mixed).toBeGreaterThan(tarmac);
  expect(gravel).toBeGreaterThan(mixed);
  expect(gravel).toBeGreaterThan(0.009);
});

test('rim switch: a gravel tyre sits on a smaller rim than a tarmac tyre (Fabia 15 / 18", Bimmer 16 / 18")', () => {
  const rim = (def: typeof fabia, t: TyreId) => rimRadius(tyreSizeFor(def, t));
  expect(rim(fabia, 'gravel')).toBeLessThan(rim(fabia, 'tarmac'));
  expect(rim(fabia, 'mixed')).toBe(rim(fabia, 'gravel'));
  expect(rim(bimmer, 'gravel')).toBeLessThan(rim(bimmer, 'tarmac'));
  expect(rim(bimmer, 'mixed')).toBe(rim(bimmer, 'tarmac'));
  // Taller sidewall on the gravel tyre (same overall radius).
  const side = (def: typeof fabia, t: TyreId) => def.wheelRadius - rim(def, t);
  expect(side(fabia, 'gravel')).toBeGreaterThan(side(fabia, 'tarmac') * 1.3);
});
