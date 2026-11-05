import { expect, test } from '@rstest/core';
import { layoutCell, layoutHash, SHEETS } from '../../scripts/plants/layout';
import { cardColor, cellRect, CELLS } from '../../src/games/rally/engine/grass';
import {
  LAYOUT_HASH,
  PLANT_SHEETS,
} from '../../src/games/rally/engine/plants/plant-atlas.data';

/** The plant card atlases (scripts/plants/bake-plants.mjs): a seeded, deterministic layout that matches the bake. */

test('the layout is deterministic', () => {
  for (const s of SHEETS)
    for (const c of s.cells)
      expect(layoutCell(c, s.window)).toEqual(layoutCell(c, s.window));
  expect(layoutHash()).toBe(layoutHash());
});

test('the committed atlases were baked from this layout (rerun the bake after changing it)', () => {
  expect(LAYOUT_HASH).toBe(layoutHash());
});

test('every clump stands inside its cell', () => {
  for (const s of SHEETS)
    for (const c of s.cells)
      for (const p of layoutCell(c, s.window))
        expect(Math.abs(p.x)).toBeLessThan(s.window[0] / 2);
});

test('cells of the sheets fit their atlases and the builders only use existing cells', () => {
  for (const s of SHEETS) {
    const info = PLANT_SHEETS[s.id as keyof typeof PLANT_SHEETS];
    expect([info.w, info.h, info.cols, info.rows]).toEqual([
      s.w,
      s.h,
      s.cols,
      s.rows,
    ]);
    expect(s.cells.length).toBe(s.cols * s.rows);
  }
  const used = [
    ...CELLS.tufts,
    ...CELLS.dryTufts,
    CELLS.margin,
    ...CELLS.nettles,
    ...CELLS.dryNettles,
  ];
  const reeds = [...CELLS.reeds, ...CELLS.cattails];
  for (const [sheet, c] of [
    ...used.map((c) => ['weeds', c] as const),
    ...reeds.map((c) => ['reeds', c] as const),
  ]) {
    const [u0, v0, u1, v1] = cellRect(sheet, c);
    expect(u0).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThanOrEqual(1);
    expect(u1).toBeGreaterThan(u0);
    expect(v1).toBeGreaterThan(v0);
  }
});

test('the blade colours come from measured means in the leaf bands', () => {
  // Linear albedo of grass: dark (luminance well under 0.3), green over blue (trees/Foliage.md bands).
  for (const id of ['grass-green', 'grass-spring'] as const) {
    const [r, g, b] = PLANT_SHEETS[id].leaf;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(lum).toBeGreaterThan(0.05);
    expect(lum).toBeLessThan(0.2);
    expect(g).toBeGreaterThan(r);
    expect(b / g).toBeLessThan(0.5);
  }
});

test('the card colours (sheet mean x card colour) sit in the measured bands', () => {
  const at = (id: keyof typeof PLANT_SHEETS) => {
    const m = PLANT_SHEETS[id].mean;
    const g = cardColor(id);
    const [r, gr, b] = [m[0] * g[0], m[1] * g[1], m[2] * g[2]];
    return {
      lum: 0.2126 * r + 0.7152 * gr + 0.0722 * b,
      rg: r / gr,
      bg: b / gr,
    };
  };
  // Summer / spring grass: olive, a little above the grass ground tiles (~0.08), under the flush band's top.
  for (const id of ['grass-green', 'grass-spring'] as const) {
    const c = at(id);
    expect(c.lum).toBeGreaterThan(0.1);
    expect(c.lum).toBeLessThan(0.16);
    expect(c.rg).toBeLessThan(0.95);
    expect(c.bg).toBeGreaterThan(0.25);
    expect(c.bg).toBeLessThan(0.4);
  }
  // Dry grass: pale straw, not orange.
  const d = at('grass-dry');
  expect(d.lum).toBeGreaterThan(0.24);
  expect(d.rg).toBeLessThan(1.35);
  expect(d.bg).toBeGreaterThan(0.35);
  // Reeds: green with pale plumes and dead leaves, about the grass.
  const re = at('reeds');
  expect(re.lum).toBeGreaterThan(0.1);
  expect(re.lum).toBeLessThan(0.16);
  expect(re.rg).toBeLessThan(0.95);
  expect(re.bg).toBeLessThan(0.4);
});
