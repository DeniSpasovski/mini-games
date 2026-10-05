import { writeFileSync } from 'node:fs';
import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Inventory of every structure along the Jackie stage (printed, for the intersection-by-intersection review):
 * stage-road spans, decks of other roads near the parkway and junctions, each with a map viewer camera link.
 * `npx rstest tests/rally/jackie-inventory.test.ts` and read the log.
 */

const world = new World(jackieMap);
const net = world.gen.paths!;
const road = world.road;
const rq = newRoadQuery();

function link(
  cx: number,
  cy: number,
  cz: number,
  lx: number,
  ly: number,
  lz: number,
): string {
  const f = (v: number) => v.toFixed(1);
  return `map-viewer.html?map=jackie&cam=${f(cx)}%2C${f(cy)}%2C${f(cz)}&look=${f(lx)}%2C${f(ly)}%2C${f(lz)}&fov=45`;
}

/** Camera 70 m behind `along` on the road, 22 m up, looking at the road point. */
function roadView(along: number): string {
  const s = road.at(along);
  const b = road.at(Math.max(0, along - 70));
  return link(b.x, b.y + 22, b.z, s.x, s.y, s.z);
}

describe('jackie inventory', () => {
  test('structures along the stage', () => {
    const lines: string[] = [];
    // Stage spans.
    for (const sp of road.def.spans ?? []) {
      const m = road.at((sp.from + sp.to) / 2);
      const under: string[] = [];
      net.paths.forEach((p, pi) => {
        const L = net.lengths[pi];
        const pt = { x: 0, z: 0 };
        let best = Infinity;
        for (let a = 0; a <= L; a += 3) {
          net.pointAt(pi, a, pt);
          road.query(pt.x, pt.z, rq);
          if (rq.found && rq.along >= sp.from - 5 && rq.along <= sp.to + 5)
            best = Math.min(best, rq.distance - rq.halfWidth);
        }
        if (best < 2)
          under.push(
            `${pi}:${p.kind}${p.bridge ? ' DECK' : ''}${p.name ? ' ' + p.name : ''}`,
          );
      });
      lines.push(
        `SPAN ${sp.kind} ${sp.from.toFixed(0)}-${sp.to.toFixed(0)} m at (${m.x.toFixed(0)}, ${m.z.toFixed(0)}) y ${m.y.toFixed(1)} | over/under: ${under.join(', ')} | ${roadView((sp.from + sp.to) / 2)}`,
      );
    }
    // Decks near the stage road.
    const pt = { x: 0, z: 0 };
    for (const pi of world.gen.deckPaths()) {
      const p = net.paths[pi];
      const L = net.lengths[pi];
      let best = Infinity;
      let bestAlong = 0;
      let bestA = 0;
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(pi, a, pt);
        road.query(pt.x, pt.z, rq);
        if (rq.found && rq.distance < best) {
          best = rq.distance;
          bestAlong = rq.along;
          bestA = a;
        }
      }
      if (best > 60) continue;
      net.pointAt(pi, bestA, pt);
      const y0 = world.gen.pathHeight(pi, 0);
      const y1 = world.gen.pathHeight(pi, L);
      const ym = world.gen.pathHeight(pi, bestA);
      const s = road.at(bestAlong);
      lines.push(
        `DECK ${pi} ${p.kind} w${p.width} L${L.toFixed(0)} layer${p.layer ?? 1}${p.name ? ' "' + p.name + '"' : ''} nearest ${best.toFixed(0)} m from the road at ${bestAlong.toFixed(0)} m; deck y ${ym.toFixed(1)} (road ${s.y.toFixed(1)}), ends y ${y0.toFixed(1)} / ${y1.toFixed(1)} | ${link(s.x - s.tx * 60, s.y + 25, s.z - s.tz * 60, pt.x, ym, pt.z)}`,
      );
    }
    // Junctions.
    for (const j of world.gen.junctions)
      lines.push(
        `JUNCTION ${j.kind} w${j.width.toFixed(1)} at ${j.along.toFixed(0)} m side ${j.side} (${j.x.toFixed(0)}, ${j.z.toFixed(0)}) | ${roadView(j.along)}`,
      );
    console.info(lines.join('\n'));
    // The reporter hides console output: `JACKIE_INVENTORY=<file> npx rstest ...` writes it to a file.
    if (process.env.JACKIE_INVENTORY)
      writeFileSync(process.env.JACKIE_INVENTORY, lines.join('\n') + '\n');
    expect(lines.length).toBeGreaterThan(10);
  });
});
