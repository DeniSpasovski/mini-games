import { expect, test } from '@rstest/core';
import { blankMap } from '../../src/games/kabooom/map/blank';
import { MAP_SIZES, MAP_SIZE_IDS } from '../../src/games/kabooom/map/sizes';
import { gridToWorldX, gridToWorldZ } from '../../src/games/kabooom/sim/grid';
import {
  MAX_PLAYERS,
  MAX_TNT,
  MAX_TNT_PER_PLAYER,
  STEP,
  TICK_HZ,
} from '../../src/games/kabooom/sim/rules';
import { CRITTERS, Terrain } from '../../src/games/kabooom/sim/types';

test('rules: tick rate and pool sizes agree', () => {
  expect(STEP * TICK_HZ).toBeCloseTo(1);
  expect(MAX_TNT).toBe(MAX_PLAYERS * MAX_TNT_PER_PLAYER);
  expect(CRITTERS.length).toBe(MAX_PLAYERS);
  expect(new Set(CRITTERS).size).toBe(CRITTERS.length);
});

test('map sizes: odd dimensions, growing, up to 8 players', () => {
  let prevArea = 0;
  for (const id of MAP_SIZE_IDS) {
    const s = MAP_SIZES[id];
    expect(s.id).toBe(id);
    expect(s.w % 2).toBe(1);
    expect(s.h % 2).toBe(1);
    expect(s.w * s.h).toBeGreaterThan(prevArea);
    prevArea = s.w * s.h;
    expect(s.maxPlayers).toBeLessThanOrEqual(MAX_PLAYERS);
  }
  expect(MAP_SIZES.l.maxPlayers).toBe(MAX_PLAYERS);
});

test('blankMap: hard border and (even, even) pillars, nothing else', () => {
  for (const id of MAP_SIZE_IDS) {
    const { w, h } = MAP_SIZES[id];
    const m = blankMap(id, 7);
    expect(m.terrain.length).toBe(w * h);
    expect(m.variant.length).toBe(w * h);
    expect(m.seed).toBe(7);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const wall = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const pillar = x % 2 === 0 && y % 2 === 0;
        expect(m.terrain[y * w + x]).toBe(
          wall || pillar ? Terrain.Hard : Terrain.Empty,
        );
      }
    }
  }
});

test('grid: the arena is centred on the world origin', () => {
  const { w, h } = MAP_SIZES.m;
  expect(gridToWorldX(w, 0)).toBe(-w / 2);
  expect(gridToWorldX(w, w)).toBe(w / 2);
  expect(gridToWorldZ(h, h / 2)).toBe(0);
});
