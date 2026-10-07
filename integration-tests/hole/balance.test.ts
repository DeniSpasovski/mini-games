import { writeFileSync } from 'node:fs';
import { expect, test } from '@rstest/core';
import { generateAnimalIsland } from '../../src/games/hole/map/animal/generate';
import { generateCity } from '../../src/games/hole/map/generate';
import { generateToyStore } from '../../src/games/hole/map/toy/generate';
import { Sim } from '../../src/games/hole/sim/sim';
import { BOT_SKILLS, runBot } from '../../src/games/hole/sim/bot';

/**
 * Balance playtests: a good bot plays each map on hard / medium / easy and must land in the
 * intended level / clear bands. Slow (minutes of simulated play), so they live outside tests/.
 */
const SEEDS = [1, 2, 3];
const maps = new Map(SEEDS.map((s) => [s, generateAnimalIsland({ seed: s })]));

test('balance bands: good bot on City Island, hard / medium / easy', () => {
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

test('balance bands: good bot on the toy store, hard / medium / easy', () => {
  const m = generateToyStore({ seed: 1 });
  const hard = runBot(new Sim(m, { seconds: 120 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(hard.level).toBeGreaterThanOrEqual(10);
  const medium = runBot(new Sim(m, { seconds: 240 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(medium.level).toBeGreaterThanOrEqual(15);
  const easy = runBot(new Sim(m, { seconds: 480 }), BOT_SKILLS.good, {
    dt: 1 / 30,
  });
  expect(easy.level).toBeGreaterThanOrEqual(15);
  expect(easy.pct).toBeGreaterThan(0.95);
}, 120000);

test('balance bands: good bot on Animal Island, hard / medium / easy, three seeds', () => {
  const out: string[] = [];
  for (const seed of SEEDS) {
    const m = maps.get(seed)!;
    const run = (seconds: number) =>
      runBot(new Sim(m, { seconds }), BOT_SKILLS.good, { dt: 1 / 30 });
    const hard = run(100);
    const medium = run(250);
    const easy = run(500);
    out.push(
      `seed ${seed}: hard L${hard.level} (${hard.score}) | medium L${medium.level} | easy cleared ${easy.cleared} at ${easy.time.toFixed(0)}s`,
    );
    // Hard: a stretch goal (not every level), Medium and Easy reach the top, Easy clears with time to spare
    expect(hard.level, `hard seed ${seed}`).toBeGreaterThanOrEqual(10);
    expect(hard.level, `hard seed ${seed}`).toBeLessThanOrEqual(20);
    expect(medium.level, `medium seed ${seed}`).toBeGreaterThanOrEqual(15);
    expect(easy.cleared, `easy seed ${seed}`).toBe(true);
    expect(easy.time, `easy seed ${seed}`).toBeGreaterThan(110);
    expect(easy.time, `easy seed ${seed}`).toBeLessThan(400);
  }
  if (process.env.LIST_BALANCE)
    writeFileSync(process.env.LIST_BALANCE, out.join('\n'));
}, 600000);
