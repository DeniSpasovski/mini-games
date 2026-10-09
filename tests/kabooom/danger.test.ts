import { expect, test } from '@rstest/core';
import { DangerMap, NEVER } from '../../src/games/kabooom/sim/danger';
import {
  CHAIN_DELAY_S,
  FLAME_S,
  FUSE_S,
  ROUND_S,
  SUDDEN_S,
  TICK_HZ,
} from '../../src/games/kabooom/sim/rules';
import { simOn } from './helpers';

const W = 9;
const at = (x: number, y = 1) => y * W + x;

test('danger: one TNT burns its cross at its fuse time, stops at hard blocks and the first crate', () => {
  const sim = simOn(['#########', '#0.x...1#', '#########']);
  sim.plantTnt(5, 1, 0, 2, 2);
  const d = new DangerMap();
  d.compute(sim);
  for (const x of [3, 4, 5, 6, 7]) expect(d.start[at(x)]).toBeCloseTo(2);
  expect(d.start[at(2)]).toBe(NEVER); // behind the crate
  expect(d.start[at(1)]).toBe(NEVER);
  expect(d.end[at(5)]).toBeCloseTo(2 + FLAME_S);
});

test('danger: a chain moves the later TNT forward by its chain delay', () => {
  const sim = simOn(['#############', '#0.........1#', '#############']);
  sim.plantTnt(2, 1, 0, 2, 1);
  sim.plantTnt(4, 1, 0, 2, 3);
  const d = new DangerMap();
  d.compute(sim);
  const w = 13;
  expect(d.start[w + 1]).toBeCloseTo(1);
  expect(d.start[w + 6]).toBeCloseTo(1 + CHAIN_DELAY_S); // the second TNT's far arm, not at 3 s
});

test('danger: burning cells are dangerous now; a hypothetical TNT adds its own cross', () => {
  const sim = simOn(['#########', '#0.....1#', '#########']);
  sim.plantTnt(4, 1, 0, 1, 0.01);
  for (let i = 0; i < 2; i++) sim.tick([]);
  const d = new DangerMap();
  d.compute(sim, { x: 7, y: 1, range: 2 });
  expect(d.start[at(4)]).toBe(0);
  expect(d.start[at(6)]).toBeCloseTo(sim.fuseS);
  expect(d.start[at(1)]).toBe(NEVER);
});

test('danger.unsafe: inside the burn window (plus margin) only', () => {
  const sim = simOn(['#########', '#0.....1#', '#########']);
  sim.plantTnt(4, 1, 0, 1, 1);
  const d = new DangerMap();
  d.compute(sim);
  const i = at(4);
  expect(d.unsafe(i, 0)).toBe(false);
  expect(d.unsafe(i, 0.9)).toBe(true); // margin
  expect(d.unsafe(i, 1.2)).toBe(true);
  expect(d.unsafe(i, 1 + FLAME_S + 0.5)).toBe(false);
  expect(d.unsafe(at(1), 1.2)).toBe(false);
});

test('danger: walls about to fall (sudden death) are dangerous for good', () => {
  const sim = simOn(['#########', '#0.....1#', '#########']);
  for (let t = 0; t < (ROUND_S - SUDDEN_S - 1) * TICK_HZ; t++) sim.tick([]);
  const d = new DangerMap();
  d.compute(sim);
  expect(d.start[at(1)]).toBeLessThan(1.5);
  expect(d.end[at(1)]).toBe(NEVER);
  expect(d.unsafe(at(1), 100)).toBe(true);
  expect(d.start[at(7)]).toBeCloseTo(2.8, 0); // the last ring cell lands 1.8 s after the first
});
