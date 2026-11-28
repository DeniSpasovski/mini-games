import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Drivability of the streets in the Jackie END BOX (Kew Gardens grid + the interchange east of the finish, x 1 500..4 300):
 * the side roads must drive like the stage road - no steps, no bumps, no terrain through the asphalt, flat joints.
 * The loose city limits of `side-roads.test.ts` still apply to the rest of the map.
 */
const world = new World(jackieMap);
const gen = world.gen;
const net = gen.paths!;
const pq = newPathQuery();
const rq = newRoadQuery();
const BOX = { x0: 1500, x1: 4300, z0: -2300, z1: -900 };
const inBox = (x: number, z: number) =>
  x >= BOX.x0 && x <= BOX.x1 && z >= BOX.z0 && z <= BOX.z1;
const isRamp = (pi: number) => net.paths[pi].kind.endsWith('_link');

/** Street ways that are ground roads on their own height line (not decks / rails / lanes of the highway's cut). */
const streets = net.paths
  .map((p, pi) => ({ p, pi }))
  .filter(
    ({ p, pi }) =>
      p.surface === 'tarmac' &&
      p.width >= 3 &&
      !p.bridge &&
      !gen.isParkwayLane(pi),
  );

/** Short ground ways between bridge decks (approach stubs) are tied to the deck ends. */
const stub = (pi: number): boolean => {
  if (net.lengths[pi] > 60) return false;
  const end = { x: 0, z: 0 };
  return [0, net.lengths[pi]].some((a) => {
    net.pointAt(pi, a, end);
    const q = net.query(
      end.x,
      end.z,
      pq,
      undefined,
      (qi) => !!net.paths[qi].bridge,
    );
    return q.found && q.distance <= q.halfWidth + 3;
  });
};

/** In the flat verge of a carriageway (2 m beyond its edge) the carriageway wins. */
const inVerge = (x: number, z: number): boolean => {
  const q = net.query(x, z, pq, 'tarmac', (qi) => gen.isCarriageway(qi));
  return q.found && q.distance - q.halfWidth <= 2.5;
};

/** Calls fn for every `step` m of each street in the box, away from the stage road, plazas and carriageway verges. */
function along(
  step: number,
  fn: (pi: number, a: number, x: number, z: number) => void,
) {
  const c = { x: 0, z: 0 };
  for (const { pi } of streets) {
    if (stub(pi)) continue;
    for (let a = 0; a <= net.lengths[pi]; a += step) {
      net.pointAt(pi, a, c);
      if (!inBox(c.x, c.z)) continue;
      if (net.query(c.x, c.z, pq).path !== pi) continue;
      if (gen.road.query(c.x, c.z, rq).found && rq.distance < rq.halfWidth + 30)
        continue;
      if (!gen.isCarriageway(pi) && inVerge(c.x, c.z)) continue;
      if (gen.plazas.inside(c.x, c.z, 2)) continue;
      fn(pi, a, c.x, c.z);
    }
  }
}

describe('jackie END BOX: street drivability', () => {
  test('smooth along: no bump over 0.5 m in 1 m of street, p99 under 2 cm', () => {
    const d2: number[] = [];
    let worst = '';
    let worstV = 0;
    const c = { x: 0, z: 0 };
    for (const { pi } of streets) {
      if (stub(pi)) continue;
      let h1 = NaN;
      let h2 = NaN;
      for (let a = 0; a <= net.lengths[pi]; a += 1) {
        net.pointAt(pi, a, c);
        const skip =
          !inBox(c.x, c.z) ||
          net.query(c.x, c.z, pq).path !== pi ||
          (gen.road.query(c.x, c.z, rq).found &&
            rq.distance < rq.halfWidth + 30) ||
          (!gen.isCarriageway(pi) && inVerge(c.x, c.z)) ||
          gen.plazas.inside(c.x, c.z, 2);
        if (skip) {
          h1 = h2 = NaN;
          continue;
        }
        const h = gen.height(c.x, c.z);
        if (!isNaN(h2)) {
          const v = Math.abs(h - 2 * h1 + h2);
          d2.push(v);
          if (v > worstV) {
            worstV = v;
            worst = `path ${pi} ${net.paths[pi].kind} @${a} (${c.x.toFixed(0)}, ${c.z.toFixed(0)})`;
          }
        }
        h2 = h1;
        h1 = h;
      }
    }
    d2.sort((a, b) => a - b);
    const p99 = d2[Math.floor(d2.length * 0.99)];
    console.info(
      `[jackie END BOX] bumps: ${d2.length} samples, p99 ${p99.toFixed(3)} m, max ${worstV.toFixed(2)} m at ${worst}`,
    );
    expect(worstV).toBeLessThan(0.5);
    expect(p99).toBeLessThan(0.02);
  });

  test('flat across: no street edge more than 0.6 m off its centre (a 6 % hillside)', () => {
    let worst = 0;
    let at = '';
    const t0 = { x: 0, z: 0 };
    const t1 = { x: 0, z: 0 };
    along(5, (pi, a, x, z) => {
      const hw = net.paths[pi].width / 2 - 0.3;
      net.pointAt(pi, Math.max(0, a - 1.5), t0);
      net.pointAt(pi, Math.min(net.lengths[pi], a + 1.5), t1);
      const tl = Math.hypot(t1.x - t0.x, t1.z - t0.z) || 1;
      const nx = -(t1.z - t0.z) / tl;
      const nz = (t1.x - t0.x) / tl;
      const h = gen.height(x, z);
      for (const side of [-1, 1]) {
        const ex = x + nx * hw * side;
        const ez = z + nz * hw * side;
        if (net.query(ex, ez, pq).path !== pi || pq.distance > hw + 0.1)
          continue;
        if (!gen.isCarriageway(pi) && inVerge(ex, ez)) continue;
        const d = Math.abs(gen.height(ex, ez) - h);
        if (d > worst) {
          worst = d;
          at = `path ${pi} ${net.paths[pi].kind} @${a.toFixed(0)} (${x.toFixed(0)}, ${z.toFixed(0)})`;
        }
      }
    });
    console.info(
      `[jackie END BOX] flat across: worst ${worst.toFixed(2)} m at ${at}`,
    );
    expect(worst).toBeLessThan(0.6);
  });

  test('no terrain through the asphalt: the ground never stands above a street line (ramps hugging a carriageway at another height excepted)', () => {
    let streetsAbove = 0;
    let rampsAbove = 0;
    let worst = 0;
    const t0 = { x: 0, z: 0 };
    const t1 = { x: 0, z: 0 };
    along(3, (pi, a, x, z) => {
      net.pointAt(pi, Math.max(0, a - 1.5), t0);
      net.pointAt(pi, Math.min(net.lengths[pi], a + 1.5), t1);
      const tl = Math.hypot(t1.x - t0.x, t1.z - t0.z) || 1;
      const nx = -(t1.z - t0.z) / tl;
      const nz = (t1.x - t0.x) / tl;
      const prof = gen.pathHeight(pi, a);
      const hw = net.halfWidthAt(pi, a);
      for (const f of [-0.9, -0.5, 0, 0.5, 0.9]) {
        const ex = x + nx * hw * f;
        const ez = z + nz * hw * f;
        if (net.query(ex, ez, pq).path !== pi) continue;
        const above = gen.height(ex, ez) - prof;
        if (above <= 0.1) continue;
        if (isRamp(pi)) rampsAbove++;
        else {
          streetsAbove++;
          worst = Math.max(worst, above);
        }
      }
    });
    console.info(
      `[jackie END BOX] terrain above the street line (> 10 cm): ${streetsAbove} street samples (worst ${worst.toFixed(2)} m), ${rampsAbove} ramp samples`,
    );
    expect(streetsAbove).toBeLessThan(12);
    expect(rampsAbove).toBeLessThan(60);
  });

  test('ways meeting at a node end at one height (away from deck ends, underpass dips and plazas: < 10 cm)', () => {
    const joints: { pi: number; end: number; x: number; z: number }[] = [];
    const a = { x: 0, z: 0 };
    for (const { pi } of streets) {
      if (gen.isCarriageway(pi) || isRamp(pi)) continue;
      for (const end of [0, net.lengths[pi]]) {
        net.pointAt(pi, end, a);
        if (inBox(a.x, a.z)) joints.push({ pi, end, x: a.x, z: a.z });
      }
    }
    // deck ends own their joints (snapDeckEnds)
    const decks: { x: number; z: number }[] = [];
    net.paths.forEach((p, pi) => {
      if (!p.bridge) return;
      for (const end of [0, net.lengths[pi]]) {
        net.pointAt(pi, end, a);
        decks.push({ x: a.x, z: a.z });
      }
    });
    let checked = 0;
    const bad: string[] = [];
    for (const j of joints) {
      if (decks.some((d) => Math.hypot(d.x - j.x, d.z - j.z) <= 4)) continue;
      if (gen.plazas.inside(j.x, j.z, 4)) continue;
      if (gen.road.query(j.x, j.z, rq).found && rq.distance <= rq.halfWidth + 3)
        continue;
      for (const k of joints) {
        if (k.pi <= j.pi || Math.hypot(k.x - j.x, k.z - j.z) > 2.5) continue;
        const d = Math.abs(
          gen.pathHeight(j.pi, j.end) - gen.pathHeight(k.pi, k.end),
        );
        if (d > 6) continue;
        // a street in an underpass dip keeps its dip (the dip rules own that joint)
        const dip = (q: { pi: number; end: number }) =>
          gen.isUnderpass(q.pi) && gen.underpassDipAt(q.pi, q.end) > 0.2;
        if (dip(j) || dip(k)) continue;
        checked++;
        if (d > 0.1)
          bad.push(
            `paths ${j.pi} & ${k.pi} at (${j.x.toFixed(0)}, ${j.z.toFixed(0)}) step ${d.toFixed(2)}`,
          );
      }
    }
    console.info(
      `[jackie END BOX] joints checked ${checked}, steps over 10 cm: ${bad.length} ${bad.slice(0, 4).join('; ')}`,
    );
    expect(checked).toBeGreaterThan(100);
    expect(bad.length).toBeLessThan(4);
  });

  test('no terrain through a street deck: the ground stays under every street bridge in the box (a bank beside the edge of a few)', () => {
    let decks = 0;
    let through = 0;
    let worst = 0;
    const bad: string[] = [];
    const byDeck = new Map<number, [number, number, string]>();
    const c = { x: 0, z: 0 };
    const a1 = { x: 0, z: 0 };
    const a2 = { x: 0, z: 0 };
    net.paths.forEach((p, pi) => {
      if (!p.bridge || gen.isPortalDeck(pi) || p.surface !== 'tarmac') return;
      const L = net.lengths[pi];
      net.pointAt(pi, L / 2, c);
      if (!inBox(c.x, c.z)) return;
      // Interchange carriageway / ramp decks are listed in the log only (open: banks of the ramps beside them).
      const street = !p.kind.startsWith('motorway');
      if (street) decks++;
      for (let a = 2; a <= L - 2; a += 2) {
        net.pointAt(pi, a - 1, a1);
        net.pointAt(pi, a + 1, a2);
        const tl = Math.hypot(a2.x - a1.x, a2.z - a1.z) || 1;
        net.pointAt(pi, a, c);
        const hw = net.halfWidthAt(pi, a) - 0.3;
        for (let l = -hw; l <= hw; l += 1.5) {
          const x = c.x + ((a2.z - a1.z) / tl) * l;
          const z = c.z - ((a2.x - a1.x) / tl) * l;
          // (the ground, not the top surface: another deck may pass over this one)
          const over = gen.height(x, z) - gen.pathHeight(pi, a);
          if (over >= 0.2) {
            if (street) {
              through++;
              worst = Math.max(worst, over);
            }
            const e = byDeck.get(pi) ?? [0, 0, ''];
            e[0]++;
            if (over > e[1])
              [e[1], e[2]] = [over, `@${a} (${x.toFixed(0)}, ${z.toFixed(0)})`];
            byDeck.set(pi, e);
            if (bad.length < 6)
              bad.push(
                `deck ${pi} ${p.kind} @${a} (${x.toFixed(0)}, ${z.toFixed(0)}) +${over.toFixed(2)}`,
              );
          }
        }
      }
    });
    console.info(
      `[jackie END BOX] decks ${decks}, street decks with terrain through them: ${through} (worst ${worst.toFixed(2)} m); all decks by deck: ${[...byDeck].map(([k, e]) => `${k}(${net.paths[k].kind}) ${e[0]}x worst +${e[1].toFixed(2)} ${e[2]}`).join(' | ')}`,
    );
    expect(decks).toBeGreaterThan(20);
    expect(through).toBeLessThan(14);
    expect(worst).toBeLessThan(1.6);
  });

  test('rounded kerb corners: arcs lie on their circle, meet the shortened runs at the tangent points, stay clear of buildings and roads', () => {
    const d = world.streetDetail!;
    expect(d.corners.length).toBeGreaterThan(150);
    const c0 = { x: 0, z: 0 };
    for (const c of d.corners) {
      expect(Math.hypot(c.ax - c.cx, c.az - c.cz)).toBeCloseTo(c.radius, 1);
      expect(Math.hypot(c.bx - c.cx, c.bz - c.cz)).toBeCloseTo(c.radius, 1);
      // a corner is a 55 - 150 degree turn of the kerb line: the arc sweeps 30 - 125 degrees
      expect(Math.abs(c.sweep)).toBeGreaterThan(0.5);
      expect(Math.abs(c.sweep)).toBeLessThan(2.2);
      // the arc stays off every street's lanes
      for (let k = 0; k <= 6; k++) {
        const al = c.a0 + (c.sweep * k) / 6;
        c0.x = c.cx + Math.cos(al) * c.radius;
        c0.z = c.cz + Math.sin(al) * c.radius;
        net.query(c0.x, c0.z, pq, 'tarmac', (qi) => !net.paths[qi].bridge);
        if (pq.found) expect(pq.distance).toBeGreaterThan(pq.halfWidth - 1.2);
      }
    }
    // no run was left shorter than 4 m by the rounding
    for (const r of d.runs) expect(r.to - r.from).toBeGreaterThan(3.9);
  });

  test('dressing follows the street model: cars only in parking lanes, trees off the roads, markers on the ramps', () => {
    const inst = [...world.scatter.fixedInstances()];
    // parked cars: the street under each is a modelled street with a parking lane on that side
    let cars = 0;
    let badCars = 0;
    for (const i of inst) {
      if (i.asset !== 'street_car' && i.asset !== 'taxi') continue;
      if (!inBox(i.x, i.z)) continue;
      const q = net.query(
        i.x,
        i.z,
        pq,
        'tarmac',
        (qi) => !net.paths[qi].bridge,
      );
      if (!q.found || q.distance > q.halfWidth + 0.5) continue;
      const lay = net.paths[q.path].layout;
      if (!lay) continue;
      cars++;
      if (lay.parkL + lay.parkR === 0) badCars++;
    }
    expect(cars).toBeGreaterThan(100);
    expect(badCars).toBe(0);
    // street trees: none standing in a street's lanes
    let trees = 0;
    let onRoad = 0;
    for (const i of inst) {
      if (i.asset !== 'oak_tree' || !inBox(i.x, i.z)) continue;
      trees++;
      const q = net.query(
        i.x,
        i.z,
        pq,
        'tarmac',
        (qi) => !net.paths[qi].bridge,
      );
      if (q.found && q.distance < q.halfWidth - 0.2) onRoad++;
    }
    expect(trees).toBeGreaterThan(1000);
    expect(onRoad).toBeLessThan(trees * 0.01);
    expect(
      inst.filter((i) => i.asset === 'marker_post').length,
    ).toBeGreaterThan(40);
    expect(
      inst.filter((i) => i.asset === 'chevron_sign').length,
    ).toBeGreaterThan(5);
  });
});
