import { expect, test } from '@rstest/core';
import { layoutCell, layoutHash, SHEETS } from '../../scripts/plants/layout';
import { cellRect, CELLS } from '../../src/games/rally/engine/grass';
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
    ...CELLS.reeds,
  ];
  for (const c of used) {
    const [u0, v0, u1, v1] = cellRect('weeds', c);
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
