import { expect, test } from '@rstest/core';
import { Rng } from '../../src/shared/rng';
import {
  CHAIN_DELAY_S,
  FUSE_S,
  PLAYER_RADIUS,
  ROUND_S,
  STEP,
  SUDDEN_S,
  TICK_HZ,
} from '../../src/games/kaboom/sim/rules';
import { Sim } from '../../src/games/kaboom/sim/sim';
import { Terrain, type SimEvent } from '../../src/games/kaboom/sim/types';
import { inputs, mapFromAscii, put, run, simOn } from './helpers';

const CORRIDOR = ['#########', '#0.....1#', '#########'];

const types = (events: readonly SimEvent[], type: SimEvent['type']) =>
  events.filter((e) => e.type === type);

test('movement: 4 cells per second along a corridor', () => {
  const sim = simOn(CORRIDOR);
  for (let t = 0; t < TICK_HZ; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  expect(sim.players[0].x).toBeCloseTo(1.5 + 4, 1);
  expect(sim.players[0].moving).toBe(true);
  expect(sim.players[0].px).toBeLessThan(sim.players[0].x);
});

test('movement: stops flush against the wall, never inside it', () => {
  const sim = simOn(CORRIDOR);
  for (let t = 0; t < 200; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  const x = sim.players[0].x;
  expect(x).toBeLessThanOrEqual(8 - PLAYER_RADIUS);
  expect(x).toBeGreaterThan(8 - PLAYER_RADIUS - 0.01);
  expect(sim.players[0].moving).toBe(false);
});

test('movement: frozen during the countdown, then free', () => {
  const sim = simOn(CORRIDOR, {}, 1);
  for (let t = 0; t < 30; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  expect(sim.players[0].x).toBe(1.5);
  expect(sim.countdown).toBeGreaterThan(0);
  for (let t = 0; t < 60; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  expect(sim.countdown).toBe(0);
  expect(sim.players[0].x).toBeGreaterThan(2);
});

const GAP = ['#######', '#0....#', '#.#.#.#', '#....1#', '#######'];

test('cornering: slides into a gap when past the lane edge, stays out when barely off', () => {
  const lined = simOn(GAP);
  put(lined, 0, 2.9, 1.5); // 0.4 into the next lane: assisted
  for (let t = 0; t < 40; t++) lined.tick(inputs(2, { 0: { dy: 1 } }));
  expect(lined.players[0].y).toBeGreaterThan(2.9);
  // slid just far enough to clear the wall corner, then went straight down
  expect(lined.players[0].x).toBeGreaterThanOrEqual(3 + PLAYER_RADIUS - 0.01);
  expect(lined.players[0].x).toBeLessThanOrEqual(3.5);

  const barely = simOn(GAP);
  put(barely, 0, 2.6, 1.5); // 0.1 off the wall lane: not enough
  for (let t = 0; t < 40; t++) barely.tick(inputs(2, { 0: { dy: 1 } }));
  expect(barely.players[0].y).toBeLessThanOrEqual(2 - PLAYER_RADIUS);
  expect(barely.players[0].x).toBeCloseTo(2.6, 3);
});

test('cornering: a diagonal press into a wall keeps going along the free axis', () => {
  const sim = simOn(CORRIDOR);
  for (let t = 0; t < 30; t++) sim.tick(inputs(2, { 0: { dx: 1, dy: 1 } }));
  expect(sim.players[0].x).toBeGreaterThan(3);
});

test('TNT: placed on the player cell, goes off after the fuse, owner can walk off but not back', () => {
  const sim = simOn(CORRIDOR);
  const first = sim.tick(inputs(2, { 0: { place: true } }));
  expect(types(first, 'tntPlaced')).toEqual([
    { type: 'tntPlaced', x: 1, y: 1, owner: 0 },
  ]);
  expect(sim.players[0].tntLeft).toBe(0);
  // second place on the same cell / without TNT left does nothing
  expect(
    types(sim.tick(inputs(2, { 0: { place: true } })), 'tntPlaced'),
  ).toEqual([]);

  for (let t = 0; t < 40; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  expect(sim.players[0].x).toBeGreaterThan(3); // walked off the TNT
  for (let t = 0; t < 60; t++) sim.tick(inputs(2, { 0: { dx: -1 } }));
  expect(sim.players[0].x).toBeGreaterThanOrEqual(2 + PLAYER_RADIUS - 0.01); // solid now

  const log = run(sim, 200, () => inputs(2, { 0: { dx: 1 } }));
  const boom = log.find((l) => l.event.includes('tntExploded'))!;
  expect(boom).toBeDefined();
  const total = 2 + 40 + 60 + boom.tick; // ticks since placing (+1 for the first)
  expect(Math.abs(total - FUSE_S * TICK_HZ)).toBeLessThanOrEqual(3);
  expect(sim.players[0].state).toBe('alive');
  expect(sim.players[0].tntLeft).toBe(1); // got the TNT back
});

test('blast: arms stop at hard blocks, break the first crate and stop there', () => {
  const sim = simOn(['##########', '#.x.#..x.#', '#0......1#', '##########']);
  put(sim, 0, 1.5, 2.5);
  expect(sim.plantTnt(3, 1, 0, 2, 0.05)).toBe(true);
  const ev = run(sim, 10, () => inputs(2));
  const boom = JSON.parse(ev.find((e) => e.event.includes('Exploded'))!.event);
  // +x: (4,1) is hard -> 0; -x: (2,1) crate -> 1; +y: (3,2) free then (3,3) hard -> 1; -y: (3,0) hard -> 0
  expect(boom.arms).toEqual([0, 1, 1, 0]);
  expect(ev.filter((e) => e.event.includes('blockBroken')).length).toBe(1);
  expect(sim.terrain[1 * 10 + 2]).toBe(Terrain.Empty);
  expect(sim.flame[1 * 10 + 3]).toBeGreaterThan(0);
  expect(sim.flame[1 * 10 + 1]).toBe(0); // behind the crate nothing burns
});

test('blast: chains spread over frames, one chain link every CHAIN_DELAY_S', () => {
  const sim = simOn([
    '#################',
    '#...........0.1.#',
    '#################',
  ]);
  sim.plantTnt(2, 1, 0, 2, 0.1);
  for (const x of [4, 6, 8]) sim.plantTnt(x, 1, 0, 2);
  const booms = run(sim, 120, () => inputs(2))
    .filter((e) => e.event.includes('tntExploded'))
    .map((e) => ({ tick: e.tick, ev: JSON.parse(e.event) }));
  expect(booms.map((b) => b.ev.x)).toEqual([2, 4, 6, 8]);
  expect(booms.map((b) => b.ev.chainDepth)).toEqual([0, 1, 2, 3]);
  const wantGap = Math.ceil(CHAIN_DELAY_S / STEP);
  for (let i = 1; i < booms.length; i++) {
    const gap = booms[i].tick - booms[i - 1].tick;
    expect(gap).toBeGreaterThanOrEqual(wantGap - 1);
    expect(gap).toBeLessThanOrEqual(wantGap + 1);
  }
  // each arm stops at the next TNT
  expect(booms[0].ev.arms[0]).toBe(2);
});

test('flames: KO the player in them, credit the owner; last player standing wins the round and the match', () => {
  const sim = simOn(CORRIDOR);
  sim.plantTnt(6, 1, 0, 2, 0.05);
  const events: SimEvent[] = [];
  for (let t = 0; t < 10; t++)
    for (const e of sim.tick(inputs(2)))
      events.push(JSON.parse(JSON.stringify(e)));
  expect(types(events, 'playerKo')).toEqual([
    { type: 'playerKo', id: 1, byOwner: 0 },
  ]);
  expect(types(events, 'roundOver')).toEqual([
    { type: 'roundOver', winner: 0 },
  ]);
  expect(types(events, 'matchOver')).toEqual([
    { type: 'matchOver', winner: 0 },
  ]);
  expect(sim.over).toBe(true);
  expect(sim.matchOver).toBe(true);
  expect(sim.players[0].wins).toBe(1);
  expect(sim.players[1].state).toBe('ko');
});

test('flames: everybody KO in the same tick is a draw', () => {
  const sim = simOn(CORRIDOR);
  sim.plantTnt(4, 1, 0, 3, 0.05);
  const events: SimEvent[] = [];
  for (let t = 0; t < 10; t++)
    for (const e of sim.tick(inputs(2)))
      events.push(JSON.parse(JSON.stringify(e)));
  expect(types(events, 'playerKo').length).toBe(2);
  expect(types(events, 'roundOver')).toEqual([
    { type: 'roundOver', winner: null },
  ]);
  expect(sim.players.every((p) => p.wins === 0)).toBe(true);
});

test('match: best of 3 needs two wins, rounds restart cleanly and keep the wins', () => {
  const sim = simOn(CORRIDOR, { rounds: 3 });
  const win = () => {
    sim.plantTnt(6, 1, 0, 2, 0.05);
    for (let t = 0; t < 10; t++) sim.tick(inputs(2));
  };
  win();
  expect(sim.over).toBe(true);
  expect(sim.matchOver).toBe(false);
  sim.nextRound();
  expect(sim.round).toBe(1);
  expect(sim.over).toBe(false);
  expect(sim.players.map((p) => p.state)).toEqual(['alive', 'alive']);
  expect(sim.players[0].wins).toBe(1);
  expect(sim.tnts.every((t) => !t.active)).toBe(true);
  expect(Array.from(sim.flame).every((f) => f === 0)).toBe(true);
  win();
  expect(sim.matchOver).toBe(true);
  expect(sim.matchWinner).toBe(0);
  const round = sim.round;
  sim.nextRound(); // no-op after the match
  expect(sim.round).toBe(round);
});

test('round timer: even idle players in a huge arena are crushed by the spiral before the timer runs out', () => {
  const rows = ['#'.repeat(33)];
  for (let y = 1; y < 32; y++) {
    let row = '#' + '.'.repeat(31) + '#';
    if (y === 16) row = '#' + '.'.repeat(15) + '01' + '.'.repeat(14) + '#';
    rows.push(row);
  }
  rows.push('#'.repeat(33));
  const sim = simOn(rows);
  let over: SimEvent | undefined;
  for (let t = 0; t < (ROUND_S + 1) * TICK_HZ && !over; t++)
    over = types(sim.tick(inputs(2)), 'roundOver')[0];
  expect(over).toBeDefined();
  expect(sim.time).toBeLessThan(ROUND_S);
  expect(sim.time).toBeGreaterThan(ROUND_S - SUDDEN_S);
});

const ARENA = [
  '#############',
  '#0.x.x.x.x.1#',
  '#.#.#.#.#.#.#',
  '#x.x.x.x.x.x#',
  '#.#.#.#.#.#.#',
  '#.x.x.x.x.x.#',
  '#############',
];

function scripted(seed: number): string[] {
  const sim = simOn(ARENA, { rounds: 3 });
  const rng = new Rng(seed);
  const out: string[] = [];
  for (let t = 0; t < 4000; t++) {
    const inp = inputs(2, {
      0: { dx: rng.int(-1, 1), dy: rng.int(-1, 1), place: rng.chance(0.05) },
      1: { dx: rng.int(-1, 1), dy: rng.int(-1, 1), place: rng.chance(0.05) },
    });
    for (const e of sim.tick(inp)) out.push(`${t}:${JSON.stringify(e)}`);
    out.push(
      `${sim.players[0].x.toFixed(4)},${sim.players[0].y.toFixed(4)},${sim.players[1].x.toFixed(4)}`,
    );
    if (sim.over) sim.nextRound();
  }
  return out;
}

test('determinism: same config + inputs = same events and positions', () => {
  const a = scripted(5);
  expect(a.length).toBeGreaterThan(4000);
  expect(a.some((l) => l.includes('tntExploded'))).toBe(true);
  expect(scripted(5)).toEqual(a);
  expect(scripted(6)).not.toEqual(a);
});

test('tick returns the same reused event array (no per-tick allocation of the list)', () => {
  const sim = simOn(CORRIDOR);
  const a = sim.tick(inputs(2));
  const b = sim.tick(inputs(2));
  expect(a).toBe(b);
});

test('players cannot enter crates or leave the map', () => {
  const sim = simOn(['#####', '#0x.#', '#..1#', '#####']);
  for (let t = 0; t < 120; t++) sim.tick(inputs(2, { 0: { dx: 1 } }));
  expect(sim.players[0].x).toBeLessThan(2 - 0 + 0.001);
  const s2 = mapFromAscii(['#####', '#0..#', '#..1#', '#####']);
  const sim2 = new Sim(
    {
      seed: 1,
      size: 's',
      bots: 1,
      difficulty: 'easy',
      rounds: 1,
      critter: 'mole',
    },
    () => s2,
    { countdown: 0 },
  );
  for (let t = 0; t < 300; t++) sim2.tick(inputs(2, { 0: { dx: -1, dy: -1 } }));
  expect(sim2.players[0].x).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 0.01);
  expect(sim2.players[0].y).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 0.01);
});

test('a 40-TNT chain on the large map costs well under a millisecond per tick', () => {
  const rows = ['#'.repeat(23)];
  for (let y = 1; y < 16; y++) rows.push(`#${'.'.repeat(21)}#`);
  rows.push('#'.repeat(23));
  rows[15] = `#${'.'.repeat(19)}01#`;
  const sim = simOn(rows);
  let n = 0;
  for (let y = 1; y <= 7; y += 2)
    for (let x = 2; x <= 20; x += 2) {
      if (n >= 40) break;
      sim.plantTnt(x, y, 0, 2, n === 0 ? 0.05 : 3);
      n++;
    }
  expect(n).toBe(40);
  let worst = 0;
  let total = 0;
  let booms = 0;
  const idle = inputs(2);
  for (let t = 0; t < 120; t++) {
    const t0 = performance.now();
    const ev = sim.tick(idle);
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt);
    total += dt;
    booms += types(ev, 'tntExploded').length;
  }
  expect(booms).toBe(40);
  expect(total / 120).toBeLessThan(0.5);
  expect(worst).toBeLessThan(25); // generous for CI / busy-machine noise (a GC pause); the average bound above is the real guard
});

test('sudden death: walls fall in a spiral from the edge, flatten what is under them and end the round', () => {
  // corridor: the ring is the whole row; the first wall lands on player 0's spawn
  const sim = simOn(CORRIDOR);
  const start = ROUND_S - SUDDEN_S;
  const events: { t: number; e: SimEvent }[] = [];
  for (let t = 0; t < (start + 2) * TICK_HZ; t++)
    for (const e of sim.tick(inputs(2)))
      events.push({ t: sim.time, e: JSON.parse(JSON.stringify(e)) });
  const fell = events.find((x) => x.e.type === 'blockFell')!;
  expect(fell.e).toEqual({ type: 'blockFell', x: 1, y: 1 });
  expect(Math.abs(fell.t - start)).toBeLessThan(0.05);
  expect(events.find((x) => x.e.type === 'playerKo')!.e).toEqual({
    type: 'playerKo',
    id: 0,
    byOwner: -1,
  });
  expect(events.find((x) => x.e.type === 'roundOver')!.e).toEqual({
    type: 'roundOver',
    winner: 1,
  });
  expect(sim.terrain[1 * 9 + 1]).toBe(Terrain.Hard);
  expect(sim.suddenDeath).toBe(true);
});

test('sudden death: a wall removes TNT and a crate on its cell; upcomingFalls announces the walls in order', () => {
  const sim = simOn(['#########', '#0.x...1#', '#########']);
  put(sim, 0, 5.5, 1.5); // out of the first walls' way
  put(sim, 1, 6.5, 1.5);
  sim.plantTnt(2, 1, 0, 2, 100);
  const cells = new Int16Array(8);
  const secs = new Float32Array(8);
  let n = sim.upcomingFalls(1, cells, secs);
  expect(n).toBe(0); // far from sudden death
  for (let t = 0; t < (ROUND_S - SUDDEN_S - 0.5) * TICK_HZ; t++)
    sim.tick(inputs(2, { 0: { dx: 0 } }));
  n = sim.upcomingFalls(1, cells, secs);
  expect(n).toBeGreaterThanOrEqual(2);
  expect(Array.from(cells.slice(0, 2))).toEqual([1 * 9 + 1, 1 * 9 + 2]);
  expect(secs[0]).toBeLessThan(secs[1]);
  for (let t = 0; t < 2 * TICK_HZ; t++) sim.tick(inputs(2));
  expect(sim.tnts.some((x) => x.active)).toBe(false); // the wall on (2, 1) took the TNT
  expect(sim.terrain[1 * 9 + 3]).toBe(Terrain.Hard); // and flattened the crate on (3, 1)
});
