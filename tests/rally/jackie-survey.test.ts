import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newWallQuery } from '../../src/games/rally/world/retaining-walls';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { CUT_RISE, CUT_SETBACK } from '../../src/games/rally/world/terrain-gen';
import { World } from '../../src/games/rally/world/world';

/**
 * Jackie on the NYC survey (NYC Planimetric Database): the stage road and the streets on the spot elevations
 * (`spot-heights.json`), the terrain stepped at the retaining walls (`retaining-walls.json`), the measured bridge spans.
 */
const world = new World(jackieMap);
const net = world.gen.paths!;
const pct = (v: number[], p: number) =>
  [...v].sort((a, b) => a - b)[Math.floor(v.length * p)];

describe('jackie: survey heights', () => {
  test('the stage road lies on the spot elevations of its carriageway (bridge decks and fills included)', () => {
    const q = newRoadQuery();
    const err: number[] = [];
    for (const [x, z, y] of jackieMap.road.heights!) {
      world.road.query(x, z, q);
      if (q.found && q.distance <= q.halfWidth + 1)
        err.push(Math.abs(q.height - y));
    }
    console.info(
      `[jackie] road vs ${err.length} spots: median ${pct(err, 0.5).toFixed(2)}, p95 ${pct(err, 0.95).toFixed(2)} m`,
    );
    expect(err.length).toBeGreaterThan(120);
    expect(pct(err, 0.5)).toBeLessThan(0.2);
    expect(pct(err, 0.95)).toBeLessThan(0.8);
  });

  test('the ground streets lie on their spot elevations', () => {
    const pq = newPathQuery();
    const err: number[] = [];
    for (const [x, z, y] of jackieMap.streetHeights!) {
      const above = y - world.gen.landHeight(x, z);
      if (above > 2.5 || above < -3) continue;
      net.query(x, z, pq, undefined, (qi) => {
        const p = net.paths[qi];
        return (
          !p.bridge &&
          p.surface === 'tarmac' &&
          !p.parkwayLane &&
          !/^(motorway|trunk)/.test(p.kind)
        );
      });
      if (!pq.found || pq.distance > pq.halfWidth + 0.5) continue;
      err.push(Math.abs(world.gen.pathHeight(pq.path, pq.along) - y));
    }
    console.info(
      `[jackie] streets vs ${err.length} spots: median ${pct(err, 0.5).toFixed(2)}, p90 ${pct(err, 0.9).toFixed(2)} m`,
    );
    expect(err.length).toBeGreaterThan(1500);
    expect(pct(err, 0.5)).toBeLessThan(0.15);
    expect(pct(err, 0.9)).toBeLessThan(0.6);
  });

  test('under the measured open spans (B9, Metropolitan Ave) the ground is at street level, the deck 5.7+ m above it', () => {
    let checked = 0;
    for (const sp of world.road.bridges.filter((s) => s.open)) {
      for (let d = sp.from + 6; d <= sp.to - 6; d += 4) {
        const s = world.road.at(d);
        const ground = world.gen.height(s.x, s.z);
        expect(s.y - ground).toBeGreaterThan(5.4);
        expect(s.y - ground).toBeLessThan(7.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(25);
  });
});

describe('jackie: streets under the stage-road spans', () => {
  test('the land never comes up over a street passing under a span (low decks: the street dips only a little)', () => {
    const pt = { x: 0, z: 0 };
    const rq = newRoadQuery();
    let checked = 0;
    let worst = 0;
    net.paths.forEach((p, pi) => {
      if (p.bridge || p.surface !== 'tarmac' || !world.gen.isUnderpass(pi))
        return;
      for (let a = 0; a <= net.lengths[pi]; a += 1) {
        net.pointAt(pi, a, pt);
        world.road.query(pt.x, pt.z, rq);
        if (
          !rq.found ||
          rq.distance > rq.halfWidth + 6 ||
          !world.road.bridgeAt(rq.along)
        )
          continue;
        worst = Math.max(
          worst,
          world.gen.height(pt.x, pt.z) - world.gen.pathHeight(pi, a),
        );
        checked++;
      }
    });
    console.info(
      `[jackie] streets under spans: ${checked} samples, land at most ${worst.toFixed(2)} m above`,
    );
    expect(checked).toBeGreaterThan(50);
    expect(worst).toBeLessThan(0.08);
  });
});

describe('jackie: retaining walls', () => {
  test('the land steps at every surveyed wall: its foot in front of the face, its top behind the coping', () => {
    const W = world.gen.walls!;
    const p = { x: 0, z: 0, tx: 0, tz: 0 };
    const rq = newRoadQuery();
    const pq = newPathQuery();
    const wq = newWallQuery();
    const onRoad = (x: number, z: number) => {
      world.road.query(x, z, rq);
      if (rq.found && rq.distance <= rq.halfWidth + 2) return true;
      net.query(x, z, pq, 'tarmac');
      return pq.found && pq.distance <= pq.halfWidth + 1;
    };
    let checked = 0;
    for (let w = 0; w < W.length; w++) {
      const acc = W.acc[w];
      for (let a = 2; a < acc[acc.length - 1] - 2; a += 4) {
        let i = 0;
        while (i < acc.length - 2 && acc[i + 1] < a) i++;
        const side = W.sides[w][i] || W.sides[w][i + 1];
        const hi = W.valueAt(W.highs[w], w, a);
        const lo = W.valueAt(W.lows[w], w, a);
        if (!side || hi - lo < 1.5) continue;
        W.pointAt(w, a, p);
        const at = (l: number) => ({
          x: p.x + p.tz * side * l,
          z: p.z - p.tx * side * l,
        });
        const front = at(-1);
        const back = at(CUT_SETBACK + CUT_RISE + 1.5);
        if (onRoad(front.x, front.z) || onRoad(back.x, back.z)) continue;
        // (not at a sharp corner, where the point behind lies nearer another stretch of the wall)
        const q = W.query(back.x, back.z, 12, wq);
        if (!q.found || q.wall !== w || Math.abs(q.along - a) > 3) continue;
        expect(world.gen.height(front.x, front.z)).toBeLessThan(lo + 0.3);
        expect(world.gen.height(back.x, back.z)).toBeGreaterThan(hi - 0.3);
        checked++;
      }
    }
    console.info(`[jackie] retaining wall samples: ${checked}`);
    expect(checked).toBeGreaterThan(80);
  });
});

describe('jackie: start bridge (measured structure)', () => {
  test('every street / ramp inside its outline is deck, on one plane through the spot elevations', () => {
    const st = jackieMap.deckStructures![0];
    const n = st.outline.length / 2;
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, zi, xj, zj] = [
          st.outline[i * 2],
          st.outline[i * 2 + 1],
          st.outline[j * 2],
          st.outline[j * 2 + 1],
        ];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
          c = !c;
      }
      return c;
    };
    const pt = { x: 0, z: 0 };
    const deck: [number, number, number][] = [];
    net.paths.forEach((p, pi) => {
      if (p.surface !== 'tarmac' || /^(motorway|trunk)$/.test(p.kind)) return;
      for (let a = 0; a <= net.lengths[pi]; a += 2) {
        net.pointAt(pi, a, pt);
        // (1 m inside the edge: a way's cut point lies on it)
        if (
          !inside(pt.x, pt.z) ||
          !inside(pt.x + 1, pt.z) ||
          !inside(pt.x - 1, pt.z)
        )
          continue;
        expect(p.bridge).toBe(true);
        deck.push([pt.x, pt.z, world.gen.pathHeight(pi, a)]);
      }
    });
    expect(deck.length).toBeGreaterThan(40);
    // One surface: the samples lie on the plane through the survey spots (a 0.4 m spread at most), at their height.
    const spots = st.heights.map((h) => h[2]);
    const ys = deck.map((d) => d[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.6);
    expect(Math.abs(pct(ys, 0.5) - pct(spots, 0.5))).toBeLessThan(0.3);
  });
});
