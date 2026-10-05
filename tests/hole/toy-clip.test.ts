import { expect, test } from '@rstest/core';
import { TOY_ITEMS } from '../../src/games/hole/items/catalog';
import { buildItemGeometry } from '../../src/games/hole/items/builders';
import { Mesher } from '../../src/games/hole/items/kit';
import { findBuried, findZFights } from '../../src/games/hole/debug/clip-check';

// Same clipping rules as the City items (see clip.test.ts); the failure names the builder file:line.
Mesher.trace = true;

const fmt = (v: number[]) => v.map((x) => x.toFixed(2)).join(',');

test('toy items: no z-fighting and no buried parts', () => {
  const report: string[] = [];
  for (const it of TOY_ITEMS)
    for (let v = 0; v < it.variants; v++) {
      const g = buildItemGeometry(it.id, v);
      const fights = findZFights(g);
      const sites = g.userData.sites as string[];
      if (fights.length) {
        const f = fights[0];
        report.push(
          `${it.id}#${v}: ${fights.length} pairs, e.g. ${sites[f.a]} vs ${sites[f.b]} n=(${fmt(f.normal)}) at (${fmt(f.at)})`,
        );
      }
      // plush puffs and shelf stock overlap on purpose; flag an item only when a lot of it is hidden
      const buried = findBuried(g);
      const prims = Math.max(...(g.userData.prims as number[])) + 1;
      if (buried.length / prims > 0.45)
        report.push(
          `${it.id}#${v}: ${buried.length}/${prims} parts buried ${[...new Set(buried)].join(' ')}`,
        );
    }
  expect(report).toEqual([]);
});
