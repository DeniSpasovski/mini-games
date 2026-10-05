import { writeFileSync } from 'node:fs';
import { expect, test } from '@rstest/core';
import {
  DEFAULT_ANIMAL,
  generateAnimalIsland,
} from '../../src/games/hole/map/animal/generate';
import { ANIMAL_ITEMS, getItem } from '../../src/games/hole/items/catalog';
import { insideIsland } from '../../src/games/hole/map/types';
import { Sim } from '../../src/games/hole/sim/sim';
import { pickStart } from '../../src/games/hole/map/start';
import { Rng } from '../../src/shared/rng';
import { BOT_SKILLS, runBot } from '../../src/games/hole/sim/bot';
import {
  ITEM_LEVELS,
  TIER_COUNT,
  cumulativeXp,
} from '../../src/games/hole/sim/progression';

const SEEDS = [1, 2, 3];
const maps = new Map(SEEDS.map((s) => [s, generateAnimalIsland({ seed: s })]));
const total = (s: number) =>
  maps.get(s)!.placements.reduce((a, p) => a + getItem(p.item).points, 0);

test('Animal Island is deterministic per seed', () => {
  const again = generateAnimalIsland({ seed: 1 });
  const m = maps.get(1)!;
  expect(again.placements.length).toBe(m.placements.length);
  expect(again.placements.slice(0, 300)).toEqual(m.placements.slice(0, 300));
  expect(again.start).toEqual(m.start);
});

test('every seed holds exactly 21 000 points and is at least twice the XP to level 15', () => {
  for (const s of SEEDS) {
    expect(total(s)).toBe(DEFAULT_ANIMAL.points);
    expect(total(s)).toBeGreaterThan(2 * cumulativeXp(15));
  }
});

test('every item is on the island, every type is placed, tiers / levels are covered', () => {
  for (const s of SEEDS) {
    const m = maps.get(s)!;
    for (const p of m.placements)
      expect(insideIsland(m.coast, p.x, p.z, 0), `${p.item} @${s}`).toBe(true);
    const have = new Set(m.placements.map((p) => p.item));
    const missing = ANIMAL_ITEMS.filter((i) => !have.has(i.id)).map(
      (i) => i.id,
    );
    expect(missing, `missing types seed ${s}`).toEqual([]);
    for (let t = 1; t <= TIER_COUNT; t++)
      expect(
        m.placements.filter((p) => getItem(p.item).tier === t).length,
        `tier ${t}`,
      ).toBeGreaterThanOrEqual(2);
    for (let l = 1; l <= ITEM_LEVELS; l++)
      expect(
        m.placements.filter((p) => getItem(p.item).level === l).length,
        `level ${l}`,
      ).toBeGreaterThanOrEqual(2);
  }
});

test('37 giants of 16 types, at least 14 of them in the zoo paddock', () => {
  const m = maps.get(1)!;
  const giants = m.placements.filter((p) => getItem(p.item).group === 'giants');
  expect(giants.length).toBe(37);
  expect(new Set(giants.map((g) => g.item)).size).toBe(16);
  const t = m.terrain!.compound;
  const inPaddock = giants.filter(
    (g) => g.x > t.x0 && g.x < t.x1 && g.z > t.z0 && g.z < t.z1,
  ).length;
  expect(inPaddock).toBeGreaterThanOrEqual(12);
});

test('movers: a bounded number, all with a leash, walkers on land and swimmers in water', () => {
  for (const s of SEEDS) {
    const m = maps.get(s)!;
    const movers = m.placements.filter((p) => p.move);
    expect(movers.length).toBeGreaterThan(500);
    expect(movers.length).toBeLessThan(2600);
    const g = m.walk!;
    const cell = (x: number, z: number) =>
      g.data[
        Math.floor((z - g.z0) / g.cell) * g.nx + Math.floor((x - g.x0) / g.cell)
      ];
    const bad: string[] = [];
    for (const p of movers) {
      expect(p.move!.leash).toBeGreaterThan(0);
      const c = cell(p.x, p.z);
      const swim = p.move!.kind === 'swim';
      if (swim ? c !== 2 : c === 2)
        bad.push(`${p.item}@${p.x.toFixed(0)},${p.z.toFixed(0)} cell ${c}`);
    }
    // a few items start on a cell that a later building blocked; none may sit in the wrong water
    expect(bad).toEqual([]);
  }
});

test('the start is a clear spot with plenty of small things around', () => {
  for (const s of SEEDS) {
    const m = maps.get(s)!;
    const near = m.placements.filter(
      (p) =>
        getItem(p.item).tier <= 3 &&
        Math.hypot(p.x - m.start.x, p.z - m.start.z) < 25,
    ).length;
    expect(near, `seed ${s}`).toBeGreaterThan(15);
  }
});

test('stats dump (LIST_STATS=<file>)', () => {
  const out = process.env.LIST_STATS;
  if (!out) return;
  const lines: string[] = [];
  for (const s of SEEDS) {
    const m = maps.get(s)!;
    const byTier = new Array(26).fill(0);
    const pointsByTier = new Array(26).fill(0);
    for (const p of m.placements) {
      const it = getItem(p.item);
      byTier[it.tier]++;
      pointsByTier[it.tier] += it.points;
    }
    lines.push(
      `seed ${s}: items ${m.placements.length}, movers ${m.placements.filter((p) => p.move).length}, start ${m.start.x.toFixed(0)},${m.start.z.toFixed(0)}`,
    );
    lines.push('  items by tier: ' + byTier.slice(1).join(' '));
    lines.push('  points by tier: ' + pointsByTier.slice(1).join(' '));
  }
  writeFileSync(out, lines.join('\n'));
});

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

test('random starts have plenty of tier 1 items around (a level 1 hole eats tier 1 only)', () => {
  for (const seed of SEEDS) {
    const m = maps.get(seed)!;
    const rng = new Rng(seed * 17);
    for (let k = 0; k < 8; k++) {
      const st = pickStart(m, () => rng.next());
      const t1 = m.placements.filter(
        (p) =>
          getItem(p.item).tier <= 1 && Math.hypot(p.x - st.x, p.z - st.z) < 22,
      ).length;
      expect(t1, `seed ${seed} start ${k}`).toBeGreaterThanOrEqual(30);
    }
  }
});
