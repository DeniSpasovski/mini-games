import { expect, test } from '@rstest/core';
import { Rng } from '../../src/shared/rng';
import {
  generateMap,
  matchMapFactory,
} from '../../src/games/kabooom/map/generate';
import {
  checkAllSpawns,
  checkSpawn,
  escapeSeconds,
} from '../../src/games/kabooom/map/safety';
import { MAP_SIZES, MAP_SIZE_IDS } from '../../src/games/kabooom/map/sizes';
import { spawnCells } from '../../src/games/kabooom/map/spawns';
import { QUARRY } from '../../src/games/kabooom/map/styles';
import { crossCells } from '../../src/games/kabooom/sim/blast';
import { Sim } from '../../src/games/kabooom/sim/sim';
import { Terrain } from '../../src/games/kabooom/sim/types';
import { config, inputs, mapFromAscii } from './helpers';

const SEEDS = 1000;

test('spawns: maxPlayers distinct cells, never on a pillar, symmetric, opposite corners first', () => {
  for (const id of MAP_SIZE_IDS) {
    const { w, h, maxPlayers } = MAP_SIZES[id];
    const s = spawnCells(id);
    expect(s.length).toBe(maxPlayers);
    expect(new Set(s.map((p) => p.y * w + p.x)).size).toBe(maxPlayers);
    for (const p of s) {
      expect(p.x % 2 === 0 && p.y % 2 === 0).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(1);
      expect(p.x).toBeLessThanOrEqual(w - 2);
      expect(p.y).toBeGreaterThanOrEqual(1);
      expect(p.y).toBeLessThanOrEqual(h - 2);
      // every spawn has its mirror image in the list when the list is complete for the symmetry class
    }
    expect(s[0]).toEqual({ x: 1, y: 1 });
    expect(s[1]).toEqual({ x: w - 2, y: h - 2 });
  }
});

test(`generator: ${SEEDS} seeds x 3 sizes - every spawn can drop a TNT, escape, and has a crate to blast`, () => {
  for (const id of MAP_SIZE_IDS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const map = generateMap({ size: id, seed });
      const bad = checkAllSpawns(map).findIndex((c) => !c.ok);
      if (bad >= 0)
        throw new Error(`size ${id} seed ${seed}: spawn ${bad} is not safe`);
    }
  }
});

test('generator: structure (border, pillars), spawn cells empty, crate share near the style ratio', () => {
  for (const id of MAP_SIZE_IDS) {
    const { w, h } = MAP_SIZES[id];
    for (const seed of [1, 2, 3, 99]) {
      const m = generateMap({ size: id, seed });
      expect(m.sizeId).toBe(id);
      expect(m.terrain.length).toBe(w * h);
      let crates = 0;
      let eligible = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = m.terrain[y * w + x];
          const wall = x === 0 || y === 0 || x === w - 1 || y === h - 1;
          const pillar = x % 2 === 0 && y % 2 === 0;
          if (wall || pillar) expect(t).toBe(Terrain.Hard);
          else {
            eligible++;
            if (t === Terrain.Crate) crates++;
          }
        }
      }
      const share = crates / eligible;
      expect(share).toBeGreaterThan(QUARRY.crateRatio - 0.3);
      expect(share).toBeLessThan(QUARRY.crateRatio + 0.02);
      for (const s of m.spawns)
        expect(m.terrain[s.y * w + s.x]).toBe(Terrain.Empty);
      for (let i = 0; i < m.variant.length; i++) {
        const limit =
          m.terrain[i] === Terrain.Crate
            ? QUARRY.crateVariants
            : QUARRY.hardVariants;
        if (m.terrain[i] !== Terrain.Empty)
          expect(m.variant[i]).toBeLessThan(limit);
      }
    }
  }
});

test('generator: 4-fold mirror symmetric, so every spawn sees the same arena', () => {
  for (const id of MAP_SIZE_IDS) {
    const { w, h } = MAP_SIZES[id];
    const m = generateMap({ size: id, seed: 7 });
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = m.terrain[y * w + x];
        expect(m.terrain[y * w + (w - 1 - x)]).toBe(t);
        expect(m.terrain[(h - 1 - y) * w + x]).toBe(t);
      }
  }
});

test('generator: same params = same map; another seed or size differs; the match factory advances the seed per round', () => {
  const a = generateMap({ size: 'm', seed: 5 });
  const b = generateMap({ size: 'm', seed: 5 });
  expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
  expect(Array.from(a.variant)).toEqual(Array.from(b.variant));
  expect(Array.from(generateMap({ size: 'm', seed: 6 }).terrain)).not.toEqual(
    Array.from(a.terrain),
  );
  const f = matchMapFactory({ seed: 5, size: 'm' });
  expect(Array.from(f(0).terrain)).toEqual(Array.from(a.terrain));
  expect(Array.from(f(1).terrain)).toEqual(
    Array.from(generateMap({ size: 'm', seed: 6 }).terrain),
  );
});

test('safety: a boxed-in spawn and a dead-end corridor fail, a corridor with room passes', () => {
  const boxed = mapFromAscii([
    '#######',
    '#0xxxx#',
    '#x#x#x#',
    '#xxxxx#',
    '#######',
  ]);
  expect(checkSpawn(boxed, 0).escapes).toBe(false);
  expect(checkSpawn(boxed, 0).ok).toBe(false);

  const dead = mapFromAscii(['#####', '#0..#', '#####']);
  expect(escapeSeconds(dead.terrain, dead.w, dead.h, 1, 1)).toBe(Infinity);

  const room = mapFromAscii(['#######', '#0....#', '#######']);
  expect(escapeSeconds(room.terrain, room.w, room.h, 1, 1)).toBeCloseTo(0.75);
});

test('safety: the hiding pocket matters - an L of range-2 cells alone is a death trap', () => {
  // spawn in a corner with only its L open (no pocket cell): the whole L burns
  const trap = mapFromAscii(['######', '#0..x#', '#.#xx#', '#.xxx#', '######']);
  expect(escapeSeconds(trap.terrain, trap.w, trap.h, 1, 1)).toBe(Infinity);
});

test('crossCells matches what an exploding TNT really burns (generated maps, random cells)', () => {
  const rng = new Rng(11);
  for (let n = 0; n < 40; n++) {
    const map = generateMap({ size: 's', seed: 100 + n });
    const sim = new Sim(config({ bots: 1 }), () => map, { countdown: 0 });
    const { w, h } = map;
    const pick = () => ({ x: rng.int(1, w - 2), y: rng.int(1, h - 2) });
    let { x, y } = pick();
    while (map.terrain[y * w + x] !== Terrain.Empty || (x === 1 && y === 1))
      ({ x, y } = pick());
    const expected = new Set(crossCells(sim.terrain.slice(), w, h, x, y, 2));
    sim.plantTnt(x, y, 0, 2, 0.01);
    sim.tick(inputs(2));
    const burning = new Set<number>();
    for (let i = 0; i < sim.flame.length; i++)
      if (sim.flame[i] > 0) burning.add(i);
    expect(Array.from(burning).sort()).toEqual(Array.from(expected).sort());
  }
});
