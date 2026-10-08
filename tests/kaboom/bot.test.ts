import { expect, test } from '@rstest/core';
import { BOT_PARAMS, BotController } from '../../src/games/kaboom/sim/bot';
import { FUSE_S, TICK_HZ } from '../../src/games/kaboom/sim/rules';
import type { PlayerInput, SimEvent } from '../../src/games/kaboom/sim/types';
import { simOn } from './helpers';

const ARENA = [
  '#############',
  '#0.x.x.x.x.1#',
  '#.#.#.#.#.#.#',
  '#x.x.x.x.x.x#',
  '#.#.#.#.#.#.#',
  '#.x.x.x.x.x.#',
  '#############',
];

function play(
  sim: ReturnType<typeof simOn>,
  bots: BotController,
  seconds: number,
): SimEvent[] {
  const out: SimEvent[] = [];
  const inputs: PlayerInput[] = [];
  for (let t = 0; t < seconds * TICK_HZ && !sim.over; t++)
    for (const e of sim.tick(bots.inputs(inputs)))
      out.push(JSON.parse(JSON.stringify(e)));
  return out;
}

test('difficulty: harder bots think faster, slip less and hunt the human harder', () => {
  const { easy, normal, hard } = BOT_PARAMS;
  expect(easy.thinkS).toBeGreaterThan(normal.thinkS);
  expect(normal.thinkS).toBeGreaterThan(hard.thinkS);
  expect(easy.mistake).toBeGreaterThan(normal.mistake);
  expect(normal.mistake).toBeGreaterThan(hard.mistake);
  expect(hard.humanWeight).toBeGreaterThan(normal.humanWeight);
  expect(normal.humanWeight).toBeGreaterThan(easy.humanWeight);
  expect(hard.chaseRange).toBeGreaterThan(easy.chaseRange);
  expect(hard.trap && hard.lead && normal.trap && !easy.trap).toBe(true);
});

test('a bot with crates around it places TNT and gets away from it', () => {
  const sim = simOn(ARENA, { bots: 1, difficulty: 'hard' });
  const bots = new BotController(sim, 'hard', 3, [0]);
  const events = play(sim, bots, FUSE_S + 3);
  expect(events.some((e) => e.type === 'tntPlaced' && e.owner === 0)).toBe(
    true,
  );
  expect(events.some((e) => e.type === 'tntExploded')).toBe(true);
  expect(sim.players[0].state).toBe('alive');
});

test('a bot standing in a blast runs out of it in time', () => {
  const sim = simOn(['###########', '#0.......1#', '###########'], { bots: 1 });
  const bots = new BotController(sim, 'normal', 1, [0]);
  // a TNT under its own feet, in a corridor: it has to run along it, out of the cross
  sim.plantTnt(1, 1, 1, 2, FUSE_S);
  const events = play(sim, bots, FUSE_S + 1);
  expect(events.some((e) => e.type === 'tntExploded')).toBe(true);
  expect(sim.players[0].state).toBe('alive');
  expect(sim.players[0].x).toBeGreaterThan(4); // out of the cross
});

test('the human slot is passed through, bots fill the rest', () => {
  const sim = simOn(ARENA, { bots: 1 });
  const bots = new BotController(sim, 'normal', 1);
  const out: PlayerInput[] = [];
  bots.inputs(out, { dx: 1, dy: 0, place: true });
  expect(out[0]).toEqual({ dx: 1, dy: 0, place: true });
  expect(out.length).toBe(2);
  // the bot starts thinking within a few ticks
  let moved = false;
  for (let t = 0; t < 30 && !moved; t++) {
    bots.inputs(out);
    moved = out[1].dx !== 0 || out[1].dy !== 0 || out[1].place;
  }
  expect(moved).toBe(true);
});

test('bots are deterministic and idle during the countdown and after the round', () => {
  const run = () => {
    const sim = simOn(ARENA, { bots: 1 }, 2);
    const bots = new BotController(sim, 'normal', 11, [0, 1]);
    const out: PlayerInput[] = [];
    bots.inputs(out);
    expect(out.every((i) => !i.dx && !i.dy && !i.place)).toBe(true); // countdown
    return play(sim, bots, 20)
      .map((e) => JSON.stringify(e))
      .join('|');
  };
  expect(run()).toBe(run());
});
