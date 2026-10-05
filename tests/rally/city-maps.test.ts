import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { goreCushions, goreWedges } from '../../src/games/rally/world/gore';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { STREET_KINDS } from '../../src/games/rally/world/street-detail';
import { World } from '../../src/games/rally/world/world';

/**
 * City map features of the Jackie Robinson Parkway: barriers along the opposite carriageway, bridge decks
 * over the tunnel stretches, lane-drop tapers, sheer cuts, kerbs / sidewalks, street dressing.
 */
const world = new World(jackieMap);
const road = world.road;

describe('jackie: opposite carriageway', () => {
  test('has its own Jersey wall (median side) and guard rail (outside), never on the stage road', () => {
    const runs = world.barrierRuns.filter((r) => r.path !== undefined);
    const jersey = runs.filter((r) => r.rule.kind === 'jersey');
    const rail = runs.filter((r) => r.rule.kind === 'guardrail');
    console.info(
      `[jackie] path barrier runs: ${jersey.length} Jersey, ${rail.length} guard rail, ${Math.round(runs.reduce((s, r) => s + r.to - r.from, 0))} m`,
    );
    expect(jersey.length).toBeGreaterThan(10);
    expect(rail.length).toBeGreaterThan(10);
    const net = world.gen.paths!;
    const q = newRoadQuery();
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    for (const r of runs) {
      for (let a = r.from; a <= r.to; a += 6) {
        net.pointAt(r.path!, Math.max(0, a - 1.5), pt);
        net.pointAt(r.path!, a + 1.5, nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(r.path!, a, pt);
        const lat = r.side * (net.halfWidthAt(r.path!, a) + r.rule.offset);
        const x = pt.x + tz * lat;
        const z = pt.z - tx * lat;
        world.road.query(x, z, q);
        if (q.found) expect(q.distance).toBeGreaterThan(q.halfWidth);
      }
    }
  });

  test('lane drops taper: collinear ways meet at (nearly) the same width', () => {
    const net = world.gen.paths!;
    let checked = 0;
    let tapered = 0;
    net.paths.forEach((p, i) => {
      if (p.kind !== 'motorway' || p.surface !== 'tarmac') return;
      const n = p.pts.length;
      net.paths.forEach((q, j) => {
        if (j <= i || q.kind !== p.kind) return;
        const m = q.pts.length;
        // [x, z, outward direction of p, x, z, outward direction of q] for both ways of joining them.
        const ends = [
          [n - 2, 0, 1, 0],
          [0, m - 2, 0, 1],
        ];
        ends.forEach(([pe, qe, atEndP, atEndQ]) => {
          if (
            Math.hypot(p.pts[pe] - q.pts[qe], p.pts[pe + 1] - q.pts[qe + 1]) >
            1.5
          )
            return;
          const dp = atEndP
            ? [p.pts[n - 2] - p.pts[n - 4], p.pts[n - 1] - p.pts[n - 3]]
            : [p.pts[0] - p.pts[2], p.pts[1] - p.pts[3]];
          const dq = atEndQ
            ? [q.pts[m - 2] - q.pts[m - 4], q.pts[m - 1] - q.pts[m - 3]]
            : [q.pts[0] - q.pts[2], q.pts[1] - q.pts[3]];
          const l = Math.hypot(dp[0], dp[1]) * Math.hypot(dq[0], dq[1]) || 1;
          if (-(dp[0] * dq[0] + dp[1] * dq[1]) / l < 0.85) return; // a fork / merge, not one carriageway
          const hwP = net.halfWidthAt(i, atEndP ? net.lengths[i] : 0);
          const hwQ = net.halfWidthAt(j, atEndQ ? net.lengths[j] : 0);
          checked++;
          if (Math.abs(p.width - q.width) >= 0.6) tapered++;
          // Widths closer than 0.6 m are left alone (half of that per side).
          expect(Math.abs(hwP - hwQ)).toBeLessThan(0.31);
        });
      });
    });
    console.info(
      `[jackie] collinear carriageway joins: ${checked}, with a lane drop / gain: ${tapered}`,
    );
    expect(checked).toBeGreaterThan(0);
  });
});

describe('jackie: junction barriers', () => {
  test('no closing barrier stands on a carriageway of the divided highway', () => {
    const net = world.gen.paths!;
    const pq = newPathQuery();
    let checked = 0;
    for (const inst of world.scatter.fixedInstances()) {
      if (inst.asset !== 'road_barrier') continue;
      checked++;
      net.query(inst.x, inst.z, pq, undefined, (qi) => {
        const k = net.paths[qi].kind;
        return (k === 'motorway' || k === 'trunk') && !net.paths[qi].bridge;
      });
      if (pq.found) expect(pq.distance).toBeGreaterThan(pq.halfWidth);
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('jackie: decks', () => {
  test('no two decks lie on top of each other at (nearly) the same height', () => {
    const net = world.gen.paths!;
    const decks = world.gen.deckPaths();
    const pa = { x: 0, z: 0 };
    const pb = { x: 0, z: 0 };
    let overlaps = 0;
    for (const a of decks)
      for (const b of decks) {
        if (a >= b) continue;
        let inside = 0;
        let samples = 0;
        let close = 0;
        for (let d = 0; d <= net.lengths[b]; d += 3) {
          net.pointAt(b, d, pb);
          samples++;
          let best = Infinity;
          let bestAlong = 0;
          for (let e = 0; e <= net.lengths[a]; e += 2) {
            net.pointAt(a, e, pa);
            const dd = Math.hypot(pa.x - pb.x, pa.z - pb.z);
            if (dd < best) [best, bestAlong] = [dd, e];
          }
          if (best <= net.paths[a].width / 2) {
            inside++;
            if (
              Math.abs(
                world.gen.pathHeight(a, bestAlong) - world.gen.pathHeight(b, d),
              ) < 2
            )
              close++;
          }
        }
        // More than a quarter of one deck sits on the other within 2 m of its height: they fight for the same pixels.
        if (samples > 3 && close / samples > 0.25) overlaps++;
        void inside;
      }
    expect(overlaps).toBe(0);
  });
});

describe('jackie: underpasses', () => {
  test('a street that dips under a bridge has no step where its ways join (the dip continues across the joints)', () => {
    const net = world.gen.paths!;
    const ends: { pi: number; x: number; z: number; y: number }[] = [];
    const pt = { x: 0, z: 0 };
    net.paths.forEach((p, pi) => {
      if (
        p.bridge ||
        p.surface !== 'tarmac' ||
        /link|motorway|trunk/.test(p.kind)
      )
        return;
      for (const at of [0, net.lengths[pi]]) {
        net.pointAt(pi, at, pt);
        ends.push({ pi, x: pt.x, z: pt.z, y: world.gen.pathHeight(pi, at) });
      }
    });
    let joints = 0;
    const steps: string[] = [];
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const a = ends[i];
        const b = ends[j];
        if (a.pi === b.pi || Math.hypot(a.x - b.x, a.z - b.z) > 1.5) continue;
        joints++;
        if (Math.abs(a.y - b.y) > 2)
          steps.push(`${a.pi}/${b.pi} at ${a.x.toFixed(0)},${a.z.toFixed(0)}`);
      }
    expect(joints).toBeGreaterThan(100);
    expect(steps).toEqual([]);
  });
});

describe('jackie: portals (under spans)', () => {
  const net = world.gen.paths!;
  const portals = world.gen.portals;
  const pt = { x: 0, z: 0 };

  test('every under span is a portal slab at least the clearance above the road, with a name on the finish one', () => {
    const spans = (road.def.spans ?? []).filter((s) => s.kind === 'under');
    expect(portals.list.length).toBe(spans.length);
    for (const p of portals.list) {
      for (const r of p.rows) expect(r.top - r.y).toBeGreaterThanOrEqual(5.5);
      expect(p.rows[0].latL).toBeGreaterThan(5);
      expect(p.rows[0].latR).toBeLessThan(-5);
    }
    const finish = portals.list.find((p) => p.from > 7000)!;
    expect(finish.name).toMatch(/Queens Boulevard/);
  });

  test('street decks over a slab lie on its top; nothing is dipped under them', () => {
    let decks = 0;
    net.paths.forEach((p, pi) => {
      if (!p.bridge || !world.gen.isPortalDeck(pi)) return;
      decks++;
      const L = net.lengths[pi];
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(pi, a, pt);
        const hit = portals.at(pt.x, pt.z);
        if (!hit?.inside) continue;
        const dy = world.gen.pathHeight(pi, a) - hit.top;
        expect(dy).toBeGreaterThanOrEqual(-0.1);
        expect(dy).toBeLessThan(0.6);
      }
    });
    expect(decks).toBeGreaterThanOrEqual(5);
    // Ground streets on the structure (within 40 m beside the slab, along the span) stay near the slab top.
    let checked = 0;
    net.paths.forEach((p, pi) => {
      if (p.bridge || p.surface !== 'tarmac' || /motorway|trunk/.test(p.kind))
        return;
      const L = net.lengths[pi];
      for (let a = 0; a <= L; a += 4) {
        net.pointAt(pi, a, pt);
        const hit = portals.at(pt.x, pt.z);
        if (!hit || hit.outside > 0 || hit.inside) continue;
        if (Math.abs(hit.lateral) > Math.max(hit.latL, -hit.latR) + 40)
          continue;
        checked++;
        expect(Math.abs(world.gen.pathHeight(pi, a) - hit.top)).toBeLessThan(4);
      }
    });
    expect(checked).toBeGreaterThan(10);
  });

  test('no junction with the stage road inside a span (bridge or portal)', () => {
    for (const j of world.gen.junctions)
      for (const sp of road.def.spans ?? [])
        expect(j.along < sp.from - 8 || j.along > sp.to + 8).toBe(true);
  });
});

describe('jackie: structures', () => {
  test('streets over the tunnel stretches are decks that clear the parkway', () => {
    const net = world.gen.paths!;
    const decks = world.gen
      .deckPaths()
      .filter(
        (pi) =>
          net.paths[pi].junction === false &&
          STREET_KINDS.has(net.paths[pi].kind),
      );
    console.info(
      `[jackie] deck paths (not joined to the stage road): ${decks.length}`,
    );
    expect(decks.length).toBeGreaterThan(5);
    const rq = newRoadQuery();
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    let over = 0;
    for (const pi of decks) {
      for (let a = 0; a <= net.lengths[pi]; a += 2) {
        net.pointAt(pi, a, pt);
        world.road.query(pt.x, pt.z, rq);
        if (!rq.found || rq.distance >= rq.halfWidth) continue;
        // Only where the deck crosses the parkway (not a parallel carriageway) and the parkway is not itself a bridge.
        net.pointAt(pi, a + 3, nx);
        const s = world.road.samples[rq.index];
        const l = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        if (Math.abs(((nx.x - pt.x) * s.tx + (nx.z - pt.z) * s.tz) / l) > 0.7)
          continue;
        if (world.road.bridgeAt(rq.along)) continue;
        over++;
        expect(world.gen.pathHeight(pi, a) - rq.height).toBeGreaterThan(4.5);
      }
    }
    expect(over).toBeGreaterThan(0);
  });

  test('piers are solid and clear of the stage road', () => {
    expect(world.piers.length).toBeGreaterThan(0);
    const q = newRoadQuery();
    for (const p of world.piers) {
      world.road.query(p.x, p.z, q);
      if (q.found) expect(q.distance).toBeGreaterThan(q.halfWidth + 2);
      expect(p.y1).toBeGreaterThan(p.y0 + 1);
    }
  });

  test('sheer cuts: level road verge, a retaining wall line, gentle at side roads', () => {
    const cw = jackieMap.road.cutWalls!;
    let sheer = 0;
    for (let d = 0; d < world.road.length; d += 25) {
      const s = world.road.at(d);
      for (const side of [1, -1]) {
        const lat = side * (s.halfWidth + jackieMap.road.shoulder + cw.offset);
        const x = s.x + s.tz * lat;
        const z = s.z - s.tx * lat;
        const rise = world.gen.naturalHeight(x, z, false) - s.y;
        const w = world.gen.cutWeightAt(x, z, rise);
        if (w > 0.99) {
          sheer++;
          // On the wall line the ground is still road level.
          expect(world.gen.height(x, z)).toBeLessThan(s.y + 0.6);
        }
      }
    }
    console.info(`[jackie] sheer cut samples: ${sheer}`);
    expect(sheer).toBeGreaterThan(5);
  });
});

describe('jackie: street detail and dressing', () => {
  test('kerbs / sidewalks stay out of buildings, crosswalks exist', () => {
    const d = world.streetDetail!;
    const net = world.gen.paths!;
    console.info(
      `[jackie] sidewalk runs ${d.runs.length} (${Math.round(d.runs.reduce((s, r) => s + r.to - r.from, 0))} m), crosswalks ${d.crossings.length}`,
    );
    expect(d.runs.length).toBeGreaterThan(50);
    expect(d.crossings.length).toBeGreaterThan(0);
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    for (const r of d.runs) {
      const hw = net.paths[r.path].width / 2;
      for (let a = r.from; a <= r.to; a += 8) {
        net.pointAt(r.path, a - 1, pt);
        net.pointAt(r.path, a + 1, nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(r.path, a, pt);
        const lat = r.side * (hw + 1.6);
        expect(
          world.buildings.contains(pt.x + tz * lat, pt.z - tx * lat, 0.1),
        ).toBe(false);
      }
    }
  });

  test('parked cars, crowds and emergency vehicles are placed off the buildings and the stage road', () => {
    const counts: Record<string, number> = {};
    const q = newRoadQuery();
    for (const inst of world.scatter.fixedInstances()) {
      if (
        ![
          'street_car',
          'taxi',
          'police_car',
          'fire_truck',
          'spectator',
          'street_lamp',
        ].includes(inst.asset)
      )
        continue;
      counts[inst.asset] = (counts[inst.asset] ?? 0) + 1;
      if (inst.asset !== 'spectator')
        expect(world.buildings.contains(inst.x, inst.z, 0.5)).toBe(false);
      world.road.query(inst.x, inst.z, q);
      if (q.found && inst.asset !== 'spectator')
        expect(q.distance).toBeGreaterThan(q.halfWidth + 1);
    }
    console.info(`[jackie] dressing: ${JSON.stringify(counts)}`);
    expect(counts.street_car).toBeGreaterThan(300);
    expect(counts.police_car).toBeGreaterThan(3);
    expect(counts.spectator).toBeGreaterThan(100);
    expect(counts.street_lamp).toBeGreaterThan(50);
  });
});

describe('jackie: gore areas', () => {
  test('ramps get a hatched wedge with a crash cushion at its wide nose, off the stage road', () => {
    const net = world.gen.paths!;
    const wedges = goreWedges(road, net);
    console.info(`[jackie] gore wedges: ${wedges.length}`);
    expect(wedges.length).toBeGreaterThanOrEqual(8);
    const q = newRoadQuery();
    for (const w of wedges) {
      // Starts as a point, never narrower than the gap limits, strictly on the ramp side of the road edge.
      const first = w.rows[0];
      expect(Math.hypot(first.ax - first.bx, first.az - first.bz)).toBeLessThan(
        0.01,
      );
      for (const r of w.rows.slice(1)) {
        const width = Math.hypot(r.ax - r.bx, r.az - r.bz);
        expect(width).toBeLessThan(8);
        road.query(r.bx, r.bz, q);
        expect(q.distance).toBeGreaterThanOrEqual(q.halfWidth - 0.2);
      }
    }
    const cushions = goreCushions(wedges, () => 0);
    expect(cushions.length).toBe(wedges.filter((w) => w.wide).length);
    expect(cushions.length).toBeGreaterThan(3);
    for (const c of cushions) {
      road.query(c.x, c.z, q);
      expect(q.distance).toBeGreaterThan(q.halfWidth + 1.5);
    }
  });
});
