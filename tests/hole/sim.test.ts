import { expect, test } from '@rstest/core';
import { minimalMap } from '../../src/games/hole/map/minimal';
import type { Placement } from '../../src/games/hole/map/types';
import { generateCity } from '../../src/games/hole/map/generate';
import { FallState, fallParams, fallPose } from '../../src/games/hole/sim/fall';
import { Sim } from '../../src/games/hole/sim/sim';
import { BOT_SKILLS, runBot } from '../../src/games/hole/sim/bot';
import { holeDiameter, xpToNext } from '../../src/games/hole/sim/progression';

const at = (item: string, x: number, z = 0): Placement => ({
  item,
  x,
  z,
  rot: 0,
  variant: 0,
  paint: -1,
});

function run(sim: Sim, seconds: number, dx = 0, dz = 0, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt, dx, dz);
}

test('small item under the hole is eaten once; points and xp awarded', () => {
  const sim = new Sim(minimalMap([at('soda_can', 0.1)]), { seconds: 100 });
  run(sim, 0.1);
  expect(sim.world.state[0]).toBe(FallState.Tipping);
  expect(sim.pointsEaten).toBe(1);
  expect(sim.hole.xp).toBe(1);
  run(sim, 2);
  expect(sim.world.state[0]).toBe(FallState.Gone);
  expect(sim.pointsEaten).toBe(1);
  expect(sim.cleared).toBe(true);
});

test('too-big items teeter but are never eaten', () => {
  const sim = new Sim(minimalMap([at('car_sedan', 0)]), { seconds: 100 });
  run(sim, 1);
  expect(sim.world.state[0]).toBe(FallState.Idle);
  expect(sim.world.teeter[0]).toBeGreaterThan(0.2);
  expect(sim.score).toBe(0);
  // hole moves away: teeter relaxes
  run(sim, 2, 1, 0);
  expect(sim.world.teeter[0]).toBeLessThan(0.05);
});

test('level up carries xp and grows the hole', () => {
  const items = Array.from({ length: 12 }, () => at('soda_can', 0));
  const sim = new Sim(minimalMap(items), { seconds: 100 });
  run(sim, 0.2);
  // L1 needs 8 points; 12 cans -> level 2 with 4 xp
  expect(sim.hole.level).toBe(2);
  expect(sim.hole.xp).toBe(4);
  run(sim, 2);
  expect(sim.hole.diameter).toBeCloseTo(holeDiameter(2), 1);
  expect(xpToNext(1)).toBe(8);
});

test('hole speeds up with the stick and stays on the island', () => {
  const sim = new Sim(minimalMap([at('car_sedan', 900)], { x: 0, z: 0 }), {
    seconds: 100,
  });
  sim.map.coast.fill(30);
  run(sim, 0.5, 1, 0);
  expect(sim.hole.vx).toBeGreaterThan(3);
  run(sim, 20, 1, 0);
  expect(Math.hypot(sim.hole.x, sim.hole.z)).toBeLessThanOrEqual(
    30 - 0.5 * sim.targetDiameter + 1e-3,
  );
  run(sim, 0.5, 0, 0);
  expect(Math.abs(sim.hole.vx)).toBeLessThan(0.01);
});

test('clearing the island early gives a time bonus', () => {
  const sim = new Sim(minimalMap([at('soda_can', 0)]), { seconds: 100 });
  run(sim, 1);
  expect(sim.over).toBe(true);
  expect(sim.cleared).toBe(true);
  // 10 points per second left of 100 s
  expect(sim.clearBonus).toBeGreaterThan(975);
  expect(sim.clearBonus).toBeLessThanOrEqual(1000);
  expect(sim.score).toBe(1 + sim.clearBonus);
});

test('time up ends the run; falling items still finish', () => {
  const sim = new Sim(minimalMap([at('soda_can', 0), at('soda_can', 50)]), {
    seconds: 0.05,
  });
  run(sim, 3);
  expect(sim.over).toBe(true);
  expect(sim.cleared).toBe(false);
  expect(sim.settled).toBe(true);
});

test('fall pose is deterministic, monotone and ends', () => {
  const p = fallParams(2, 1.2, 4, 12345);
  const q = fallParams(2, 1.2, 4, 12345);
  expect(p).toEqual(q);
  let lastY = 0;
  let done = false;
  for (let t = 0; t < 5; t += 0.02) {
    const pose = fallPose(p, t);
    expect(pose.y).toBeLessThanOrEqual(lastY + 1e-9);
    lastY = pose.y;
    if (pose.done) {
      done = true;
      break;
    }
  }
  expect(done).toBe(true);
});

test('same seed + same inputs give identical runs', () => {
  const map = generateCity({ seed: 2 });
  const a = runBot(new Sim(map, { seconds: 60 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  const b = runBot(new Sim(map, { seconds: 60 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(a.score).toBe(b.score);
  expect(a.level).toBe(b.level);
});

test('balance bands: good bot, hard / medium / easy', () => {
  const map = generateCity({ seed: 1 });
  const hard = runBot(new Sim(map, { seconds: 120 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(hard.level).toBeGreaterThanOrEqual(10);
  expect(hard.level).toBeLessThanOrEqual(25);
  const medium = runBot(new Sim(map, { seconds: 240 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(medium.level).toBeGreaterThanOrEqual(15);
  const easy = runBot(new Sim(map, { seconds: 480 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(easy.level).toBeGreaterThanOrEqual(15);
  expect(easy.pct).toBeGreaterThan(0.95);
});
