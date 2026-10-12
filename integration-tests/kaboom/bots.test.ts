import { expect, test } from '@rstest/core';
import { playRound, type RoundStats } from './harness';

/**
 * Bot-only rounds, headless: 200 per difficulty over all three map sizes. The sim is fast, so this takes seconds - it is
 * an integration test because it plays whole rounds. Thresholds are loose guards against regressions (a bot that suicides,
 * stands still, or never ends the round), not tuning targets.
 */
const PLANS = [
  { size: 's', players: 2, rounds: 40 },
  { size: 'm', players: 4, rounds: 120 },
  { size: 'l', players: 8, rounds: 40 },
] as const;

/** Largest share of knock-outs that may be a bot's own doing (own TNT, or chains it started). */
const MAX_SELF_KO_SHARE = { easy: 0.7, normal: 0.5, hard: 0.45 } as const;

for (const difficulty of ['easy', 'normal', 'hard'] as const) {
  test(`bots (${difficulty}): 200 rounds end in time, nobody stands still, few suicides`, () => {
    const rounds: RoundStats[] = [];
    for (const plan of PLANS)
      for (let seed = 1; seed <= plan.rounds; seed++)
        rounds.push(playRound(plan.size, plan.players, difficulty, seed));
    expect(rounds.length).toBe(200);

    expect(rounds.filter((r) => r.timedOut).length).toBe(0);

    const kos = rounds.reduce((a, r) => a + r.kos, 0);
    const selfKos = rounds.reduce((a, r) => a + r.selfKos, 0);
    expect(kos).toBeGreaterThan(200); // rounds are decided by knock-outs
    expect(selfKos / kos).toBeLessThan(MAX_SELF_KO_SHARE[difficulty]);

    // everybody moved: no bot sat in its spawn until a wall fell on it
    for (const r of rounds)
      for (const walked of r.walked) expect(walked).toBeGreaterThan(1.5);

    // and they do play: TNT placed, crates broken, a winner in most rounds
    const avg = (f: (r: RoundStats) => number) =>
      rounds.reduce((a, r) => a + f(r), 0) / rounds.length;
    expect(avg((r) => r.placed)).toBeGreaterThan(8);
    expect(avg((r) => r.cratesBroken)).toBeGreaterThan(8);
    expect(rounds.filter((r) => r.winner !== null).length).toBeGreaterThan(
      rounds.length * 0.6,
    );
  });
}

test('bots are deterministic for a seed', () => {
  const a = playRound('m', 4, 'normal', 7);
  const b = playRound('m', 4, 'normal', 7);
  expect(b).toEqual(a);
});

/**
 * The bots hunt the human. A human who just stands there (or wanders without ever dropping TNT) is a fair stand-in for
 * "does it come for me": harder bots get to them more often and sooner (before sudden death makes it a lottery).
 */
test('bots hunt the human, harder bots do it more often and sooner', () => {
  const results = (['easy', 'normal', 'hard'] as const).map((difficulty) => {
    const rounds: RoundStats[] = [];
    for (const human of ['idle', 'wander'] as const)
      for (let seed = 1; seed <= 30; seed++)
        rounds.push(playRound('m', 4, difficulty, seed, human));
    const times = rounds
      .filter((r) => r.humanKoBySec !== null)
      .map((r) => r.humanKoBySec as number)
      .sort((a, b) => a - b);
    return {
      share: times.length / rounds.length,
      median: times[Math.floor(times.length / 2)] ?? Infinity,
    };
  });
  const [easy, normal, hard] = results;
  expect(easy.share).toBeGreaterThan(0.45); // even easy bots come for you...
  expect(easy.share).toBeLessThan(0.95); // ...but not every time
  expect(normal.share).toBeGreaterThan(0.8);
  expect(hard.share).toBeGreaterThan(0.9);
  expect(hard.median).toBeLessThan(normal.median);
  expect(normal.median).toBeLessThan(easy.median);
});
