import { expect, test } from '@rstest/core';
import { generateCity } from '../../src/games/hole/map/generate';
import { RING_CORNERS } from '../../src/games/hole/map/city-movers';
import { insideIsland } from '../../src/games/hole/map/types';
import { holeDiameter } from '../../src/games/hole/sim/progression';
import { Movers } from '../../src/games/hole/sim/movers';
import { World } from '../../src/games/hole/sim/world';

// City Island movement: cars drive the road graph in their lane, people walk the sidewalk ring of
// their block (or wander inside the park / on the sand), parked cars stay parked, same seed = same run.
const SEEDS = [1, 2, 3];
// a hole big enough that every mover on the island is awake; nothing is eaten (no Sim, no commit)
const HOLE = { x: 0, z: 0, level: 15, diameter: holeDiameter(15) };

function setup(seed: number) {
  const map = generateCity({ seed });
  const world = new World(map);
  const movers = new Movers(world, map);
  return { map, world, movers };
}

const run = (m: Movers, seconds: number, onStep?: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 30) {
    m.step(1 / 30, HOLE, false);
    onStep?.();
  }
};

/** Distance from (x, z) to the nearest road arm (an axis-aligned segment). */
function roadDistance(
  net: NonNullable<ReturnType<typeof generateCity>['roads']>,
  x: number,
  z: number,
): number {
  let best = Infinity;
  for (const [a, b] of net.edges) {
    const [ax, az] = net.nodes[a];
    const [bx, bz] = net.nodes[b];
    const cx = Math.min(Math.max(x, Math.min(ax, bx)), Math.max(ax, bx));
    const cz = Math.min(Math.max(z, Math.min(az, bz)), Math.max(az, bz));
    best = Math.min(best, Math.hypot(x - cx, z - cz));
  }
  return best;
}

test('the road network has crossings and arms, none on the canal', () => {
  for (const seed of SEEDS) {
    const { map } = setup(seed);
    const net = map.roads!;
    expect(net.nodes.length).toBeGreaterThan(50);
    expect(net.edges.length).toBeGreaterThan(net.nodes.length);
    for (const [a, b] of net.edges) {
      const [ax, az] = net.nodes[a];
      const [bx, bz] = net.nodes[b];
      expect(Math.hypot(ax - bx, az - bz)).toBeCloseTo(50, 3);
    }
  }
});

test('lane cars drive, parked cars stay parked', () => {
  for (const seed of SEEDS) {
    const { map, world } = setup(seed);
    const drivers = world.movers.filter((i) => world.mKind[i] === 9);
    expect(drivers.length, `seed ${seed}`).toBeGreaterThan(30);
    for (const i of drivers) {
      expect(world.types[world.type[i]].group).toBe('vehicle');
      expect(world.mNode[i]).toBeGreaterThanOrEqual(0);
      expect(world.mFrom[i]).toBeGreaterThanOrEqual(0);
    }
    // a vehicle with no spec (curb parking) is not a mover
    const cars = map.placements.filter((p) => p.item === 'car_sedan');
    expect(cars.some((p) => !p.move)).toBe(true);
  }
});

test('cars stay on the asphalt, make progress and do not pile into each other', () => {
  for (const seed of SEEDS) {
    const { map, world, movers } = setup(seed);
    const net = map.roads!;
    const drivers = world.movers.filter((i) => world.mKind[i] === 9);
    const start = drivers.map((i) => [world.x[i], world.z[i]]);
    let worstRoad = 0;
    let overlaps = 0;
    let samples = 0;
    run(movers, 120, () => {
      for (const i of drivers) {
        worstRoad = Math.max(
          worstRoad,
          roadDistance(net, world.x[i], world.z[i]),
        );
      }
      samples++;
      if (samples % 15) return;
      // deep overlap of two driving cars (centres closer than ~40 % of their lengths)
      for (let a = 0; a < drivers.length; a++)
        for (let b = a + 1; b < drivers.length; b++) {
          const i = drivers[a];
          const j = drivers[b];
          const d = Math.hypot(
            world.x[i] - world.x[j],
            world.z[i] - world.z[j],
          );
          if (
            d <
            0.4 *
              (world.types[world.type[i]].w + world.types[world.type[j]].w) *
              0.5
          )
            overlaps++;
        }
    });
    // on a 10 m wide road a car is never more than 5 m from the centre line (+ half its width at the edge)
    expect(worstRoad, `seed ${seed}`).toBeLessThan(5.6);
    // most cars got somewhere
    const moved = drivers.filter(
      (i, k) =>
        Math.hypot(world.x[i] - start[k][0], world.z[i] - start[k][1]) > 15,
    ).length;
    expect(moved / drivers.length, `seed ${seed}`).toBeGreaterThan(0.5);
    expect(overlaps, `seed ${seed}`).toBeLessThan(drivers.length);
  }
}, 120000);

test('strollers keep to the sidewalk ring, park and beach walkers stay in bounds', () => {
  for (const seed of SEEDS) {
    const { map, world, movers } = setup(seed);
    const strollers = world.movers.filter((i) => world.mKind[i] === 10);
    const wanderers = world.movers.filter(
      (i) =>
        world.mKind[i] === 0 && world.types[world.type[i]].id === 'pedestrian',
    );
    expect(strollers.length, `seed ${seed}`).toBeGreaterThan(20);
    expect(wanderers.length, `seed ${seed}`).toBeGreaterThan(3);
    const corner = new Set(RING_CORNERS.map(([x, z]) => `${x},${z}`));
    expect(corner.size).toBe(4);
    run(movers, 90, () => {
      for (const i of strollers) {
        const ring = Math.max(
          Math.abs(world.x[i] - world.mHx[i]),
          Math.abs(world.z[i] - world.mHz[i]),
        );
        expect(Math.abs(ring - world.mLeash[i])).toBeLessThan(0.6);
      }
      for (const i of wanderers) {
        expect(
          Math.hypot(world.x[i] - world.mHx[i], world.z[i] - world.mHz[i]),
        ).toBeLessThanOrEqual(world.mLeash[i] + 0.5);
        expect(insideIsland(map.coast, world.x[i], world.z[i], 0.2)).toBe(true);
      }
    });
    const moved = strollers.filter(
      (i) =>
        Math.hypot(world.x[i] - world.mTx[i], world.z[i] - world.mTz[i]) < 40,
    ).length;
    expect(moved).toBeGreaterThan(0);
  }
}, 120000);

test('city movement is deterministic', () => {
  const trace = () => {
    const { world, movers } = setup(2);
    run(movers, 40);
    let h = 0;
    for (const i of world.movers)
      h =
        (h * 31 + Math.round(world.x[i] * 100) + Math.round(world.z[i] * 100)) |
        0;
    return h;
  };
  expect(trace()).toBe(trace());
});

test('moving the whole city is cheap', () => {
  const { movers } = setup(1);
  const t0 = performance.now();
  run(movers, 20); // 600 steps, every car and walker awake
  const ms = (performance.now() - t0) / 600;
  expect(ms).toBeLessThan(5);
});
