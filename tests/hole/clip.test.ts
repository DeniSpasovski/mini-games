import { expect, test } from '@rstest/core';
import { ITEMS } from '../../src/games/hole/items/catalog';
import { buildItemGeometry } from '../../src/games/hole/items/builders';
import { Mesher } from '../../src/games/hole/items/kit';
import { findBuried, findZFights } from '../../src/games/hole/debug/clip-check';

// Clipping artifacts in the blocky models: faces sharing a plane flicker (z-fighting), and parts placed
// inside the body they belong to (a door behind its wall, a window inside a cab) never show.
// On failure the message names the builder file:line (Mesher.trace) of the offending boxes.
Mesher.trace = true;

const fmt = (v: number[]) => v.map((x) => x.toFixed(2)).join(',');

test('no item model has coplanar overlapping faces (z-fighting)', () => {
  const report: string[] = [];
  for (const it of ITEMS)
    for (let v = 0; v < it.variants; v++) {
      const g = buildItemGeometry(it.id, v);
      const sites = g.userData.sites as string[];
      const fights = findZFights(g);
      if (fights.length) {
        const f = fights[0];
        report.push(
          `${it.id}#${v}: ${fights.length} pairs, e.g. ${sites[f.a]} vs ${sites[f.b]} n=(${fmt(f.normal)}) at (${fmt(f.at)})`,
        );
      }
    }
  expect(report).toEqual([]);
});

test('no item part is completely buried inside the model', () => {
  const report: string[] = [];
  for (const it of ITEMS)
    for (let v = 0; v < it.variants; v++) {
      const buried = findBuried(buildItemGeometry(it.id, v));
      if (buried.length) report.push(`${it.id}#${v}: ${buried.join(' ')}`);
    }
  expect(report).toEqual([]);
});
