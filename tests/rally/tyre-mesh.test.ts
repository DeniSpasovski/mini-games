import { describe, expect, test } from '@rstest/core';
import { type BufferGeometry, Color, type MeshStandardMaterial } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  BAKED_DUST_GAIN,
  buildTyre,
  rimRadius,
  treadDepth,
} from '../../src/games/rally/cars/shared/tyre-mesh';
import { dustyTyre } from '../../src/games/rally/cars/shared/tyre-tread';
import {
  TYRE_LOD,
  tyreLodShares,
} from '../../src/games/rally/cars/shared/tyre-lod';
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
  const tris = (g.index ? g.index.count : pos.count) / 3;
  return { tris, maxR, maxX, minTreadR };
}

describe.each(TYRE_IDS)('%s tyre', (tyre) => {
  test('is within the triangle budget and the size', () => {
    const size = tyreSizeFor(fabia, tyre);
    const g = buildTyre({ radius: fabia.wheelRadius, size, compound: tyre });
    const s = stats(g, size.width / 2);
    expect(s.tris).toBeLessThan(13000);
    // Overall radius = the physics wheel radius; width = the section width.
    expect(s.maxR).toBeCloseTo(fabia.wheelRadius, 3);
    expect(s.maxX).toBeLessThanOrEqual(size.width / 2 + 1e-4);
    expect(s.maxX).toBeGreaterThan(size.width / 2 - 0.01);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true);
    }
    expect(g.getAttribute('color').count).toBe(n.count);
    expect(g.getAttribute('uv').count).toBe(n.count);
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
  const r = Object.fromEntries(
    TYRE_IDS.map((id) => [id, relief(id)]),
  ) as Record<TyreId, number>;
  expect(relief(null)).toBeLessThan(0.001);
  // Pattern depths by compound: slicks -> wet -> mixed -> gravel (12 mm, a typical gravel rally tyre's published tread depth).
  const order: TyreId[] = [
    'tarmac',
    'tarmac_hard',
    'tarmac_wet',
    'mixed',
    'gravel_hard',
  ];
  for (let i = 1; i < order.length; i++)
    expect(treadDepth(order[i])).toBeGreaterThan(treadDepth(order[i - 1]));
  expect(treadDepth('gravel')).toBe(treadDepth('gravel_hard'));
  expect(treadDepth('gravel')).toBeCloseTo(0.012, 4);
  // The silhouette shows part of it (the rest is the normal map): slick < mixed < gravel.
  expect(r.tarmac).toBeGreaterThan(0.001);
  expect(r.mixed).toBeGreaterThan(r.tarmac);
  expect(r.gravel).toBeGreaterThan(r.mixed);
  expect(r.gravel).toBeGreaterThan(0.005);
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

test('road dust does not stack on baked tyre dust (old road cars): their carcass lands on the dust colour like a clean one', () => {
  const dust = new Color(0.47, 0.37, 0.25);
  const rubberOf = (t: ReturnType<typeof dustyTyre>) =>
    (Array.isArray(t.materials)
      ? t.materials[0]
      : t.materials) as MeshStandardMaterial;
  const plain = dustyTyre('gravel');
  const baked = dustyTyre('gravel', BAKED_DUST_GAIN);
  // Clean: the same rubber (the baked dust is the vertex colours' alone).
  plain.set(0, dust);
  baked.set(0, dust);
  expect(rubberOf(baked).color.equals(rubberOf(plain).color)).toBe(true);
  // Full dust: material x baked gain = the dust colour (a clean tyre's material = the dust colour).
  plain.set(1, dust);
  baked.set(1, dust);
  const c = rubberOf(baked).color;
  expect(c.r * BAKED_DUST_GAIN[0]).toBeCloseTo(dust.r, 5);
  expect(c.g * BAKED_DUST_GAIN[1]).toBeCloseTo(dust.g, 5);
  expect(c.b * BAKED_DUST_GAIN[2]).toBeCloseTo(dust.b, 5);
  expect(rubberOf(plain).color.equals(dust)).toBe(true);
  expect(Math.min(...BAKED_DUST_GAIN)).toBeGreaterThan(1);
  plain.dispose();
  baked.dispose();
});

describe.each(TYRE_IDS)('%s low-poly tyre (tyre-lod.ts)', (tyre) => {
  test('is a fraction of the full tyre, same size and groups, no displaced tread', () => {
    const size = tyreSizeFor(fabia, tyre);
    const o = { radius: fabia.wheelRadius, size, compound: tyre };
    const full = buildTyre(o);
    const low = buildTyre({ ...o, lod: 'low' });
    const f = stats(full, size.width / 2);
    const l = stats(low, size.width / 2);
    expect(l.tris).toBeLessThan(3200);
    expect(l.tris).toBeLessThan(f.tris / 3);
    expect(l.maxR).toBeCloseTo(f.maxR, 3);
    expect(l.maxX).toBeCloseTo(f.maxX, 3);
    // Smooth crown: the normal map carries the pattern.
    expect(l.maxR - l.minTreadR).toBeLessThan(0.0005);
    // Rubber + lettering, like the full tyre (the same materials draw it).
    expect(low.groups.length).toBe(full.groups.length);
    expect(low.groups.length).toBe(2);
    for (const name of ['normal', 'color', 'uv'])
      expect(low.getAttribute(name).count).toBe(
        low.getAttribute('position').count,
      );
    full.dispose();
    low.dispose();
  });
});

describe('tyre levels by speed and camera distance', () => {
  const near = 6; // chase camera
  test('full detail at rest, at low speed and from the chase cameras', () => {
    for (const kmh of [0, 5, TYRE_LOD.blurFromKmh])
      for (const dist of [0.8, near, Math.hypot(7.8, 2.6)])
        expect(tyreLodShares(kmh, dist)).toMatchObject({
          full: 1,
          sharp: 0,
          blur: 0,
          letters: 'full',
          letterBias: 0,
        });
  });
  test('smeared tread above the crossfade, either direction', () => {
    for (const kmh of [TYRE_LOD.blurToKmh, 100, -60])
      expect(tyreLodShares(kmh, near)).toMatchObject({
        full: 0,
        sharp: 0,
        blur: 1,
        letters: 'blur',
      });
  });
  test('cheap levels far away: sharp low-poly, no lettering past farM', () => {
    expect(tyreLodShares(0, TYRE_LOD.lowToM)).toMatchObject({
      full: 0,
      sharp: 1,
      letters: 'sharp',
    });
    expect(tyreLodShares(0, TYRE_LOD.farM + 1).letters).toBeNull();
    expect(tyreLodShares(100, TYRE_LOD.farM + 1).letters).toBeNull();
  });
  test('crossfades: shares sum to 1 and move smoothly (no pop)', () => {
    let prev = tyreLodShares(0, near);
    for (let kmh = 0; kmh <= 60; kmh += 0.5) {
      const s = tyreLodShares(kmh, near);
      expect(s.full + s.sharp + s.blur).toBeCloseTo(1, 6);
      expect(Math.abs(s.blur - prev.blur)).toBeLessThan(0.05);
      prev = s;
    }
    const mid = tyreLodShares(
      (TYRE_LOD.blurFromKmh + TYRE_LOD.blurToKmh) / 2,
      near,
    );
    expect(mid.full).toBeCloseTo(0.5, 6);
    expect(mid.blur).toBeCloseTo(0.5, 6);
    prev = tyreLodShares(0, 0);
    for (let d = 0; d <= 30; d += 0.1) {
      const s = tyreLodShares(0, d);
      expect(s.full + s.sharp + s.blur).toBeCloseTo(1, 6);
      expect(Math.abs(s.sharp - prev.sharp)).toBeLessThan(0.1);
      prev = s;
    }
  });
});
