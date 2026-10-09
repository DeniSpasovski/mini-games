import { expect, test } from '@rstest/core';
import { Rng } from '../../src/shared/rng';
import { generateMap } from '../../src/games/kabooom/map/generate';
import { MAP_SIZES, MAP_SIZE_IDS } from '../../src/games/kabooom/map/sizes';
import { BotController } from '../../src/games/kabooom/sim/bot';
import {
  CLOSE_MAX_STEPS,
  PowerUp,
  assignPowerUps,
} from '../../src/games/kabooom/sim/powerups';
import {
  FUSE_S,
  MAX_POWER_LEVEL,
  powerUpTotal,
  START_RANGE,
  START_TNT,
  TICK_HZ,
} from '../../src/games/kabooom/sim/rules';
import { Terrain, type PlayerInput } from '../../src/games/kabooom/sim/types';
import { inputs, put, simOn } from './helpers';

/** Steps from a cell to every other, through anything but hard blocks. */
function steps(map: ReturnType<typeof generateMap>, sx: number, sy: number) {
  const { w, h } = map;
  const dist = new Int16Array(w * h).fill(-1);
  const q = [sy * w + sx];
  dist[q[0]] = 0;
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] >= 0 || map.terrain[j] === Terrain.Hard) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return dist;
}

test('drops: scaled with players, only in crates, one of them near each player', () => {
  for (const id of MAP_SIZE_IDS) {
    const players = MAP_SIZES[id].maxPlayers;
    for (let seed = 1; seed <= 150; seed++) {
      const map = generateMap({ size: id, seed });
      const hidden = assignPowerUps(map, players, new Rng(seed));
      const at = [...hidden.keys()].filter((i) => hidden[i] >= 0);
      expect(at.length).toBe(
        powerUpTotal(
          players,
          [...map.terrain].filter((t) => t === Terrain.Crate).length,
        ),
      );
      for (const i of at) expect(map.terrain[i]).toBe(Terrain.Crate);
      // every spawn has an item in a crate a short walk away, and they are different crates
      const used = new Set<number>();
      for (const s of map.spawns.slice(0, players)) {
        const d = steps(map, s.x, s.y);
        const near = at.filter(
          (i) => d[i] >= 0 && d[i] <= CLOSE_MAX_STEPS && !used.has(i),
        );
        expect(near.length).toBeGreaterThan(0);
        used.add(near.sort((a, b) => d[a] - d[b])[0]);
      }
    }
  }
});

test('drops: both kinds appear, and the same seed gives the same drops', () => {
  const map = generateMap({ size: 'm', seed: 3 });
  const a = assignPowerUps(map, 4, new Rng(9));
  const b = assignPowerUps(map, 4, new Rng(9));
  expect(Array.from(b)).toEqual(Array.from(a));
  const kinds = new Set<number>();
  for (let seed = 1; seed < 20; seed++)
    for (const k of assignPowerUps(map, 4, new Rng(seed)))
      if (k >= 0) kinds.add(k);
  expect(kinds).toEqual(new Set([PowerUp.Dynamites, PowerUp.Sticks]));
});

const ROW = ['###########', '#0.x.....1#', '###########'];
const crateCell = 1 * 11 + 3;
const idle = (n = 2) => inputs(n);

/** A sim with a crate at (3, 1) that hides `kind`. */
function withItem(kind: number) {
  const sim = simOn(ROW);
  sim.hiddenItems.fill(-1);
  sim.hiddenItems[crateCell] = kind;
  return sim;
}

function breakCrate(sim: ReturnType<typeof simOn>): void {
  sim.plantTnt(5, 1, 1, 2, 0.02);
  for (let t = 0; t < 40; t++) sim.tick(idle());
}

test('a power-up shows up where its crate broke, stays through flames, and is taken by walking onto it', () => {
  const sim = withItem(PowerUp.Sticks);
  expect(sim.items[crateCell]).toBe(-1); // still hidden in the crate
  put(sim, 1, 8.5, 1.5);
  const events = [];
  sim.plantTnt(5, 1, 1, 2, 0.02);
  for (let t = 0; t < 40; t++)
    for (const e of sim.tick(idle()))
      events.push(JSON.parse(JSON.stringify(e)));
  expect(events).toContainEqual({
    type: 'itemAppeared',
    x: 3,
    y: 1,
    kind: PowerUp.Sticks,
  });
  expect(sim.items[crateCell]).toBe(PowerUp.Sticks);

  // another blast over it does not destroy it
  sim.plantTnt(4, 1, 1, 2, 0.02);
  for (let t = 0; t < 40; t++) sim.tick(idle());
  expect(sim.items[crateCell]).toBe(PowerUp.Sticks);

  // player 0 walks onto it
  put(sim, 0, 2.5, 1.5);
  const taken = [];
  for (let t = 0; t < 40; t++)
    for (const e of sim.tick(inputs(2, { 0: { dx: 1 } })))
      taken.push(JSON.parse(JSON.stringify(e)));
  expect(taken).toContainEqual({
    type: 'itemTaken',
    x: 3,
    y: 1,
    kind: PowerUp.Sticks,
    id: 0,
  });
  expect(sim.items[crateCell]).toBe(-1);
  expect(sim.players[0].range).toBe(START_RANGE + 1);
  expect(sim.players[0].maxTnt).toBe(START_TNT);
});

test('sticks: a longer blast; dynamites: more TNT at once; each tops out at level 5', () => {
  const W = 19;
  const row = (inner: string) => '#' + inner.padEnd(W - 2, '.') + '#';
  const wall = '#'.repeat(W);
  // a long corridor; the easy fuse (3 s) so nothing goes off while the TNT is laid
  const sim = simOn([wall, row('0'), row('.'.repeat(W - 3) + '1'), wall], {
    difficulty: 'easy',
  });
  const s = sim as unknown as { items: Int8Array };
  const p = sim.players[0];
  // one dynamite more than the levels allow: the last one cannot be taken
  for (let k = 0; k <= MAX_POWER_LEVEL; k++)
    s.items[1 * W + 2 + k] = PowerUp.Dynamites;
  for (let t = 0; t < 4 * TICK_HZ; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  expect(p.maxTnt).toBe(START_TNT + MAX_POWER_LEVEL);
  expect(p.maxTnt).toBe(5);
  expect(p.tntLeft).toBe(p.maxTnt);
  expect(sim.items[1 * W + 2 + MAX_POWER_LEVEL]).toBe(PowerUp.Dynamites); // left lying: already at the top

  // placing: up to maxTnt at once, then no more
  put(sim, 0, 2.5, 1.5);
  const placed = [];
  for (let k = 0; k < p.maxTnt + 1; k++) {
    for (const e of sim.tick(inputs(2, { 0: { place: true, dx: 1 } })))
      if (e.type === 'tntPlaced') placed.push(e.x);
    for (let t = 0; t < 20; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  }
  expect(placed.length).toBe(START_TNT + MAX_POWER_LEVEL);
  expect(p.tntLeft).toBe(0);

  // sticks lengthen the arms of its TNT, up to range 6
  const sim2 = simOn([wall, row('0' + '.'.repeat(W - 4) + '1'), wall]);
  for (let k = 0; k < MAX_POWER_LEVEL; k++)
    sim2.items[1 * W + 2 + k] = PowerUp.Sticks;
  for (let t = 0; t < 3 * TICK_HZ; t++) sim2.tick(inputs(2, { 0: { dx: 1 } }));
  expect(sim2.players[0].range).toBe(START_RANGE + MAX_POWER_LEVEL);
  expect(sim2.players[0].range).toBe(6);
  put(sim2, 0, 2.5, 1.5);
  let arms: readonly number[] = [];
  sim2.tick(inputs(2, { 0: { place: true } }));
  for (let t = 0; t < (FUSE_S + 0.5) * TICK_HZ; t++)
    for (const e of sim2.tick(idle()))
      if (e.type === 'tntExploded') arms = [...e.arms];
  expect(arms[0]).toBe(START_RANGE + MAX_POWER_LEVEL);
});

test('a new round starts with the base stats and a fresh set of drops', () => {
  const sim = simOn(ROW, { rounds: 3 });
  sim.hiddenItems[crateCell] = PowerUp.Dynamites;
  (sim.items as Int8Array)[1 * 11 + 2] = PowerUp.Sticks;
  put(sim, 0, 2.5, 1.5);
  sim.tick(idle());
  expect(sim.players[0].range).toBe(START_RANGE + 1);
  sim.plantTnt(1, 1, 1, 4, 0.02); // kills player 0: the round ends
  for (let t = 0; t < 30; t++) sim.tick(idle());
  expect(sim.over).toBe(true);
  sim.nextRound();
  expect(sim.players[0].range).toBe(START_RANGE);
  expect(sim.players[0].maxTnt).toBe(START_TNT);
  expect(Array.from(sim.items).every((k) => k === -1)).toBe(true);
  expect([...sim.hiddenItems].filter((k) => k >= 0).length).toBe(1); // one crate, 2 players x 5 drops -> capped at the crate count
});

test('a sudden-death wall flattens a power-up lying on its cell', () => {
  const sim = simOn(['#########', '#0.....1#', '#########']);
  (sim.items as Int8Array)[1 * 9 + 3] = PowerUp.Dynamites;
  put(sim, 0, 5.5, 1.5);
  put(sim, 1, 7.5, 1.5);
  for (let t = 0; t < 72 * TICK_HZ; t++) sim.tick(idle());
  expect(sim.items[1 * 9 + 3]).toBe(-1);
});

test('bots go and fetch a power-up they can still use, and leave one they are maxed out on', () => {
  const sim = simOn(['#############', '#0.........1#', '#############'], {
    bots: 1,
  });
  (sim.items as Int8Array)[1 * 13 + 4] = PowerUp.Sticks;
  const ctl = new BotController(sim, 'normal', 1, [0]);
  const out: PlayerInput[] = [];
  for (let t = 0; t < 4 * TICK_HZ; t++) sim.tick(ctl.inputs(out));
  expect(sim.players[0].range).toBe(START_RANGE + 1);

  const sim2 = simOn(['#############', '#0.........1#', '#############'], {
    bots: 1,
  });
  (sim2.players[0] as { range: number }).range = START_RANGE + MAX_POWER_LEVEL;
  (sim2.items as Int8Array)[1 * 13 + 4] = PowerUp.Sticks;
  const ctl2 = new BotController(sim2, 'normal', 1, [0]);
  for (let t = 0; t < 4 * TICK_HZ; t++) sim2.tick(ctl2.inputs(out));
  expect(sim2.items[1 * 13 + 4]).toBe(PowerUp.Sticks);
});
