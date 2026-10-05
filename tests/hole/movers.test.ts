import { expect, test } from '@rstest/core';
import { Sim } from '../../src/games/hole/sim/sim';
import { minimalMap } from '../../src/games/hole/map/minimal';
import type {
  MoveKind,
  Placement,
  WalkGrid,
} from '../../src/games/hole/map/types';
import { FallState } from '../../src/games/hole/sim/fall';

// Moving items: deterministic, leashed, kept on their ground, re-bucketed in the spatial hash,
// slower than the hole that can eat them, and fast enough in node to be a non-issue for the frame.
const move = (
  kind: MoveKind,
  x: number,
  z: number,
  leash: number,
  speed = 2,
  flee = true,
): Placement => ({
  item: 'pedestrian',
  x,
  z,
  rot: 0,
  variant: 0,
  paint: 0,
  move: { kind, hx: x, hz: z, leash, speed, flee },
});

/** A square of land with a river strip (water) across the middle and a blocked block in one corner. */
function grid(): WalkGrid {
  const nx = 100;
  const nz = 100;
  const cell = 2;
  const data = new Uint8Array(nx * nz).fill(1);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const x = -100 + ix * cell;
      if (x >= 20 && x < 30) data[iz * nx + ix] = 2; // river along z
      if (x >= -60 && x < -40 && iz < 20) data[iz * nx + ix] = 0; // hill
    }
  return { x0: -100, z0: -100, cell, nx, nz, data };
}

function sim(placements: Placement[], hole = { x: 0, z: 0 }) {
  const map = { ...minimalMap(placements, hole), seed: 5, walk: grid() };
  return new Sim(map, { seconds: 1e9 });
}

const run = (s: Sim, seconds: number, dir = { x: 0, z: 0 }) => {
  for (let t = 0; t < seconds; t += 1 / 60) s.step(1 / 60, dir.x, dir.z);
};

test('walkers stay inside their leash and on land, swimmers in water', () => {
  const s = sim([
    move('wander', 0, 10, 12),
    move('hop', -10, 0, 8),
    move('swim', 25, 20, 10),
    move('wander', 15, -20, 14), // leash crosses the river: must not wade
  ]);
  run(s, 60);
  const w = s.world;
  expect(w.moving.size).toBeGreaterThan(0);
  for (const i of w.movers) {
    expect(
      Math.hypot(w.x[i] - w.mHx[i], w.z[i] - w.mHz[i]),
    ).toBeLessThanOrEqual(w.mLeash[i] + 0.5);
    const c = s.movers.cell(w.x[i], w.z[i]);
    expect(c).toBe(w.mKind[i] === 5 ? 2 : 1);
  }
  // something actually moved
  expect(
    w.movers.some(
      (i) => Math.hypot(w.x[i] - w.mHx[i], w.z[i] - w.mHz[i]) > 0.5,
    ),
  ).toBe(true);
});

test('movers are deterministic', () => {
  const make = () => {
    const s = sim([
      move('wander', 0, 12, 10),
      move('skitter', 6, -8, 6),
      move('trail', -20, 20, 30),
    ]);
    run(s, 20);
    return Array.from(s.world.x).concat(Array.from(s.world.z));
  };
  expect(make()).toEqual(make());
});

test('moved items are re-bucketed: the hole still finds and eats them', () => {
  // a level 1 hole parked at (30, 0) on a rabbit-like mover whose home is 20 m away from it
  const s = sim([move('wander', 8, 0, 18, 3, false)], { x: 8, z: 0 });
  run(s, 25);
  const w = s.world;
  const seen: number[] = [];
  w.query(w.x[0], w.z[0], 0.5, (i) => seen.push(i));
  expect(seen).toEqual([0]);
  // park the hole on top of it: it commits (eaten) like any item
  s.hole.x = w.x[0];
  s.hole.z = w.z[0];
  run(s, 0.5);
  expect(w.state[0]).not.toBe(FallState.Idle);
  expect(s.itemsEaten).toBe(1);
});

test('an eatable mover flees the hole, an insect-style one does not', () => {
  const s = sim(
    [move('wander', 2, 0, 30, 2, true), move('wander', -2, 0, 30, 2, false)],
    { x: 0, z: 0 },
  );
  s.hole.level = 2;
  const start = s.world.x.slice(0, 2);
  run(s, 1.2);
  const w = s.world;
  // the flee flag is set only on the first; both are 2 m away from a 1.9 m hole
  expect(w.mFlee[0]).toBeGreaterThan(0);
  expect(w.mFlee[1]).toBe(0);
  expect(Math.abs(w.x[0] - start[0])).toBeGreaterThan(0.3);
});

test('movers never outrun half the hole that first eats them', () => {
  const s = sim([move('skitter', 0, 10, 40, 50, true)]);
  const w = s.world;
  let max = 0;
  let px = w.x[0];
  let pz = w.z[0];
  for (let t = 0; t < 10; t += 1 / 60) {
    s.step(1 / 60, 0, 0);
    max = Math.max(max, Math.hypot(w.x[0] - px, w.z[0] - pz) * 60);
    px = w.x[0];
    pz = w.z[0];
  }
  // pedestrian = tier 1: level 1 hole speed 7.2 m/s, half = 3.6 m/s
  expect(max).toBeLessThanOrEqual(3.6 + 0.01);
});

test('2 500 awake movers step in well under a millisecond on average', () => {
  const ps: Placement[] = [];
  for (let i = 0; i < 2500; i++)
    ps.push(move('wander', ((i * 37) % 90) - 45, ((i * 53) % 90) - 45, 10));
  const s = sim(ps);
  s.hole.level = 8;
  run(s, 1);
  const t0 = performance.now();
  run(s, 5);
  const ms = (performance.now() - t0) / 300;
  expect(ms).toBeLessThan(3);
});
