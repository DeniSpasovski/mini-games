import { expect, test } from '@rstest/core';
import { cornersFor, crossCells } from '../../src/games/kaboom/sim/blast';
import { DangerMap, NEVER } from '../../src/games/kaboom/sim/danger';
import {
  CORNER_REACH,
  START_RANGE,
  STEP,
} from '../../src/games/kaboom/sim/rules';
import { Terrain } from '../../src/games/kaboom/sim/types';
import { inputs, mapFromAscii, run, simOn } from './helpers';

/** A pillar grid like the arenas: open rows 1, 3, 5, pillars on every other cell of rows 2 and 4. */
const GRID = [
  '#############',
  '#..........0#',
  '#.#.#.#.#.#.#',
  '#...........#',
  '#.#.#.#.#.#.#',
  '#..........1#',
  '#############',
];
const W = 13;
const at = (x: number, y: number) => y * W + x;

function cells(range: number, x = 1, y = 3, rows = GRID): Set<number> {
  const map = mapFromAscii(rows);
  return new Set(crossCells(map.terrain, W, map.h, x, y, range));
}

test('corners: none up to blast level 3, the first at level 4, the first two at level 5', () => {
  expect([2, 3, 4, 5, 6].map(cornersFor)).toEqual([0, 0, 0, 1, 2]);
  expect(cornersFor(START_RANGE)).toBe(0);
});

test('corners: a level-3 blast is a plain cross; level 4 turns the first corner; level 5 the first two', () => {
  // TNT at (1, 3); its +x arm runs along row 3, passing side corridors at x = 3, 5, 7 ...
  const l3 = cells(4);
  for (const y of [1, 2, 4, 5]) expect(l3.has(at(3, y))).toBe(false);

  const l4 = cells(5);
  // round the first corner (x = 3): CORNER_REACH cells up and down
  expect(CORNER_REACH).toBe(2);
  for (const y of [1, 2, 4, 5]) expect(l4.has(at(3, y))).toBe(true);
  // not round the second (x = 5)
  for (const y of [1, 2, 4, 5]) expect(l4.has(at(5, y))).toBe(false);
  // a cell between pillars is no corner (both sides hard)
  expect(l4.has(at(2, 2))).toBe(false);

  const l5 = cells(6);
  for (const x of [3, 5])
    for (const y of [1, 2, 4, 5]) expect(l5.has(at(x, y))).toBe(true);
  // the third corner (x = 7) is still out of reach
  for (const y of [1, 2, 4, 5]) expect(l5.has(at(7, y))).toBe(false);
  // the straight arm still ends at its range
  expect(l5.has(at(7, 3))).toBe(true);
  expect(l5.has(at(8, 3))).toBe(false);
});

test('corners: a branch stops at a hard block, breaks the first crate, and sets off a TNT round the corner', () => {
  const rows = [...GRID];
  rows[1] = '#..x.......0#'; // a crate at the end of the up-branch at x = 3
  const sim = simOn(rows);
  sim.plantTnt(3, 5, 1, 2); // a TNT at the end of the down-branch
  sim.plantTnt(1, 3, 0, 5, 0.05); // a level-4 blast
  const booms = run(sim, 30, () => inputs(2))
    .filter((e) => e.event.includes('tntExploded'))
    .map((e) => JSON.parse(e.event));
  // the crate round the corner broke
  expect(sim.terrain[at(3, 1)]).toBe(Terrain.Empty);
  // the TNT round the corner went off next, down the chain
  expect(booms.map((b) => `${b.x},${b.y}:${b.chainDepth}`)).toEqual([
    '1,3:0',
    '3,5:1',
  ]);
  // the event lists the branches it made (for the flames on screen)
  const first = booms[0];
  expect(first.bendCount).toBeGreaterThan(0);
  const bends = [];
  for (let k = 0; k < first.bendCount; k++)
    bends.push(first.bends.slice(k * 4, k * 4 + 4).join(','));
  expect(bends).toContain('3,3,3,2'); // from (3, 3) up (-y), 2 cells: (3, 2) and the crate (3, 1)
  expect(bends).toContain('3,3,2,2'); // and down (+y) to the TNT
});

test('corners: the bots see what really burns - the danger map matches the blast, corners included', () => {
  for (const range of [4, 5, 6]) {
    const sim = simOn(GRID);
    sim.plantTnt(1, 3, 0, range, 1);
    const d = new DangerMap();
    d.compute(sim);
    const danger = new Set<number>();
    for (let i = 0; i < d.start.length; i++)
      if (d.start[i] < NEVER) danger.add(i);
    run(sim, Math.ceil(1.05 / STEP), () => inputs(2));
    const burnt = new Set<number>();
    for (let i = 0; i < sim.flame.length; i++)
      if (sim.flame[i] > 0) burnt.add(i);
    expect([...danger].sort()).toEqual([...burnt].sort());
    expect([...burnt].sort()).toEqual([...cells(range)].sort());
  }
});
