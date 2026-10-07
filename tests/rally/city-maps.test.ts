import { Vector3 } from 'three';
import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import type { GroundSample } from '../../src/games/rally/physics/types';
import { barrierPoint } from '../../src/games/rally/world/barriers';
import {
  goreCushions,
  goreWedges,
  inGore,
} from '../../src/games/rally/world/gore';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newWallQuery } from '../../src/games/rally/world/retaining-walls';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { STREET_KINDS } from '../../src/games/rally/world/street-detail';
import {
  APPROACH_WALL,
  UNDERPASS_WALL,
} from '../../src/games/rally/world/terrain-gen';
import { twinAt } from '../../src/games/rally/world/twin-decks';
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
        // Most of one deck sits on the other within 2 m of its height: a duplicate that fights for the same pixels. A ramp
        // merging into a carriageway lies over it for its last 20-30 m (bridge-mesh staggers the narrower one by a hair).
        if (samples > 3 && close / samples > 0.6) overlaps++;
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
      // The cut's wall lines (a skewed end trims the slab itself at its corners): beyond the narrow road + shoulder.
      expect(p.rows[0].latL0).toBeGreaterThan(4.5);
      expect(p.rows[0].latR0).toBeLessThan(-4.5);
    }
    const finish = portals.list.find((p) => p.from > 7000)!;
    expect(finish.name).toMatch(/Queens Boulevard/);
  });

  test('the opposite carriageway runs through every portal span and the run-out (OSM tunnel ways are kept)', () => {
    const pq = newPathQuery();
    const motorway = (pi: number) => net.paths[pi].kind === 'motorway';
    const spans = (road.def.spans ?? []).filter((s) => s.kind === 'under');
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // 7 150 -> 7 320 m: the finish portal and the baked run-out (the road goes on along the turnpike after 7 345 m).
    const ends = [...spans.map((s) => [s.from - 10, s.to + 10]), [7150, 7320]];
    for (const [from, to] of ends)
      for (let a = from; a <= to; a += 4) {
        const c = road.at(a);
        net.query(c.x, c.z, pq, 'tarmac', motorway);
        expect(pq.found).toBe(true);
        // Beside the stage road (the median gap), not a far-away parkway piece.
        expect(pq.distance).toBeLessThan(25);
      }
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
        // A junction plaza replaces the decks on it (not drawn there, its own surface is the street).
        if (world.gen.plazas.inside(pt.x, pt.z)) continue;
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
        // Down in the cut (a skewed end leaves part of it open): not on the structure.
        if (hit.lateral <= hit.latL0 && hit.lateral >= hit.latR0) continue;
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

describe('jackie: four roadways in the finish cut (Union Tpke inner lanes beside the parkway)', () => {
  const gen = world.gen;
  const net = gen.paths!;
  const pq = newPathQuery();

  test('lane | stage road | carriageway | lane at parkway level, with a gap (barrier room) between each', () => {
    const lanes = net.paths.filter((_, pi) => gen.isParkwayLane(pi));
    expect(lanes.length).toBeGreaterThanOrEqual(4); // both sides, open cut + under the Queens Blvd slab
    for (let a = 7000; a <= 7260; a += 10) {
      const s = road.at(a);
      // Roadways met going across from the far right to the far left (-25 .. +25 m).
      const seq: { id: number; from: number; to: number }[] = [];
      for (let l = -25; l <= 25; l += 0.25) {
        const x = s.x + s.tz * l;
        const z = s.z - s.tx * l;
        const rq = road.query(x, z, newRoadQuery());
        let id = -2;
        if (rq.found && rq.distance <= rq.halfWidth) id = -1;
        else {
          net.query(x, z, pq, 'tarmac', (pi) => gen.isCarriageway(pi));
          if (pq.found && pq.distance <= pq.halfWidth) id = pq.path;
        }
        const last = seq[seq.length - 1];
        if (last && last.id === id) last.to = l;
        else seq.push({ id, from: l, to: l });
      }
      const ways = seq.filter((w) => w.id !== -2);
      const kinds = ways.map((w) =>
        w.id === -1 ? 'stage' : gen.isParkwayLane(w.id) ? 'lane' : 'cw',
      );
      expect(kinds.join(' ')).toBe('lane stage cw lane');
      // Gaps between neighbours (the barrier stands in them).
      for (let i = 0; i + 1 < ways.length; i++)
        expect(ways[i + 1].from - ways[i].to).toBeGreaterThanOrEqual(0.9);
      // The lanes lie at the parkway's level.
      for (const w of ways)
        if (w.id >= 0 && gen.isParkwayLane(w.id)) {
          const l = (w.from + w.to) / 2;
          net.query(
            s.x + s.tz * l,
            s.z - s.tx * l,
            pq,
            undefined,
            (qi) => qi === w.id,
          );
          expect(Math.abs(gen.pathHeight(w.id, pq.along) - s.y)).toBeLessThan(
            0.3,
          );
        }
    }
  });

  test('under the Queens Blvd slab each lane has its own bore: a wall between it and the parkway, off every roadway', () => {
    const fin = gen.portals.list.find((p) => p.from > 7000)!;
    const runs = world.laneWalls.filter(
      (r) => r[0].along >= fin.from - 1 && r[r.length - 1].along <= fin.to + 1,
    );
    expect(runs.length).toBe(2);
    for (const run of runs) {
      // (the skewed ends leave the lanes open at one corner each)
      expect(run[run.length - 1].along - run[0].along).toBeGreaterThan(
        (fin.to - fin.from) * 0.75,
      );
      for (const r of run) {
        const rq = road.query(r.x, r.z, newRoadQuery());
        expect(rq.distance - rq.halfWidth).toBeGreaterThan(0.25);
        net.query(r.x, r.z, pq, 'tarmac', (pi) => gen.isCarriageway(pi));
        expect(pq.distance - pq.halfWidth).toBeGreaterThan(0.25);
      }
    }
    // The lanes' ground is open under the slab (their road is not buried by the street on top).
    for (let a = fin.from + 4; a < fin.to - 4; a += 6) {
      const s = road.at(a);
      for (const l of [-9, 15]) {
        const x = s.x + s.tz * l;
        const z = s.z - s.tx * l;
        expect(Math.abs(gen.height(x, z) - s.y)).toBeLessThan(0.3);
      }
    }
  });

  test('barriers between them: median Jersey, Jersey beside the north lane, rail beside the south lane', () => {
    const at = (a: number) =>
      world.barrierRuns.filter((r) =>
        r.path === undefined ? r.from <= a && r.to >= a : false,
      );
    for (const a of [7020, 7100, 7170]) {
      const stage = at(a).map((r) => `${r.rule.kind}-${r.rule.side}`);
      expect(stage).toContain('jersey-left');
      expect(stage).toContain('guardrail-right');
    }
    // The carriageway has a Jersey on its lane side; the lanes add none on their inner side.
    const cwJersey = world.barrierRuns.filter(
      (r) =>
        r.path !== undefined &&
        !gen.isParkwayLane(r.path) &&
        gen.isCarriageway(r.path) &&
        r.rule.kind === 'jersey',
    );
    expect(cwJersey.length).toBeGreaterThan(0);
  });
});

describe('jackie: junction plaza on the finish portal', () => {
  const plazas = world.gen.plazas;
  const portals = world.gen.portals;
  const pt = { x: 0, z: 0 };

  test('covers the whole finish slab, never the open trench beyond it, and the land under it stays below it', () => {
    expect(plazas.empty).toBe(false);
    const finish = portals.list.find((p) => p.from > 7000)!;
    // Every slab row (wall to wall, 1 m inside the walls; not the rows on the headwall lines) is paved.
    for (const r of finish.rows.slice(1, -1))
      for (let l = r.latR + 1; l <= r.latL - 1; l += 1)
        expect(plazas.inside(r.x + r.tz * l, r.z - r.tx * l)).toBe(true);
    // Beyond the headwalls the trench stays open.
    for (const a of [finish.from - 4, finish.to + 4]) {
      const c = road.at(a);
      expect(plazas.inside(c.x, c.z)).toBe(false);
    }
    // No land / street ribbon comes up through the plaza (its surface is drawn 3 cm over its height).
    const p = plazas.polys.find((q) => q.area)!;
    let n = 0;
    for (let x = p.minX; x <= p.maxX; x += 1.5)
      for (let z = p.minZ; z <= p.maxZ; z += 1.5) {
        if (!plazas.inside(x, z)) continue;
        n++;
        expect(world.gen.height(x, z)).toBeLessThanOrEqual(
          plazas.height(x, z)! + 0.03,
        );
      }
    expect(n).toBeGreaterThan(1000);
  });

  test('is solid in free roam over the trench; a car down in the trench keeps the road', () => {
    const finish = portals.list.find((p) => p.from > 7000)!;
    const s = {
      height: 0,
      normal: new Vector3(),
      surface: undefined,
    } as unknown as GroundSample;
    let over = 0;
    for (const r of finish.rows.slice(1, -1))
      for (let l = r.latR + 1; l <= r.latL - 1; l += 2) {
        const x = r.x + r.tz * l;
        const z = r.z - r.tx * l;
        if (!plazas.inside(x, z)) continue;
        const top = plazas.height(x, z)!;
        const ground = world.gen.height(x, z);
        world.sampleGround(x, z, s, top + 1);
        // On a raised island the kerb height on top.
        expect(s.height).toBeCloseTo(plazas.surface(x, z)! + 0.03, 2);
        // (up to ~18 deg at the skewed slab corners, where the slab top meets the lower service road beside it)
        expect(s.normal.y).toBeGreaterThan(0.95);
        if (ground < top - 3) {
          over++;
          world.sampleGround(x, z, s, ground + 1);
          expect(s.height).toBeLessThan(top - 3);
        }
      }
    console.info(`[jackie] plaza points over the trench: ${over}`);
    expect(over).toBeGreaterThan(20);
    // A spawn on the stage road under the slab stays down on the road.
    const mid = road.at((finish.from + finish.to) / 2);
    expect(world.heightAt(mid.x, mid.z)).toBeLessThan(
      plazas.height(mid.x, mid.z)! - 3,
    );
  });

  test('islands (NYC planimetric medians / sidewalks) lie on the plaza; raised ones are a kerb above it', () => {
    expect(plazas.islands.length).toBeGreaterThan(5);
    for (const il of plazas.islands) {
      let cx = 0;
      let cz = 0;
      const n = il.pts.length / 2;
      for (let i = 0; i < il.pts.length; i += 2) {
        cx += il.pts[i] / n;
        cz += il.pts[i + 1] / n;
      }
      // On the plaza (the parts over the open cut beside the slab are not drawn; a median down in the cut is not either).
      if (
        il.pts.every(
          (_, i) =>
            i % 2 === 1 || world.gen.inOpenCut(il.pts[i], il.pts[i + 1]),
        )
      )
        continue;
      expect(
        il.pts.some(
          (_, i) => i % 2 === 0 && plazas.inside(il.pts[i], il.pts[i + 1], 0.5),
        ),
      ).toBe(true);
      if (il.kind === 'painted' || !plazas.islandAt(cx, cz)) continue;
      expect(plazas.surface(cx, cz)! - plazas.height(cx, cz)!).toBeCloseTo(
        0.15,
        3,
      );
    }
  });

  test('the tunnel echo: full under the slab, none in the open or on top of it', () => {
    const finish = portals.list.find((p) => p.from > 7000)!;
    const mid = road.at((finish.from + finish.to) / 2);
    expect(world.enclosureAt(mid.x, mid.y + 1, mid.z)).toBe(1);
    const open = road.at(finish.from - 15);
    expect(world.enclosureAt(open.x, open.y + 1, open.z)).toBe(0);
    expect(
      world.enclosureAt(mid.x, plazas.height(mid.x, mid.z)! + 1, mid.z),
    ).toBe(0);
  });

  test('no barrier runs across it (the ones down in the trench under the slab stay)', () => {
    const ctx = { road, net: world.gen.paths };
    for (const r of world.barrierRuns)
      for (let a = r.from; a <= r.to; a += 2) {
        const b = barrierPoint(ctx, world.analytic, r, a);
        if (!plazas.inside(b.x, b.z)) continue;
        expect(b.y).toBeLessThan(plazas.height(b.x, b.z)! - 3);
      }
  });

  test('no sidewalks inside it; crosswalks at the core mouths, OSM zebras at the lane start', () => {
    const net = world.gen.paths!;
    const d = world.streetDetail!;
    // On the kerb line of each run (the street's centre may cut a plaza corner while its sidewalk is outside).
    const nx = { x: 0, z: 0 };
    for (const r of d.runs) {
      const L = net.lengths[r.path];
      const lat = r.side * (net.paths[r.path].width / 2 + 0.3);
      for (let a = r.from; a <= r.to; a += 2) {
        net.pointAt(r.path, Math.max(0, a - 1.5), pt);
        net.pointAt(r.path, Math.min(L, a + 1.5), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(r.path, a, pt);
        expect(plazas.inside(pt.x + tz * lat, pt.z - tx * lat)).toBe(false);
      }
    }
    // The NYC core (one source, no ribbons inside): one automatic crosswalk per street mouth at its edge. The lane-start
    // area keeps its ribbons and the OSM zebra crossings: no automatic one at its edge.
    let core = 0;
    for (const c of d.crossings) {
      net.pointAt(c.path, c.at, pt);
      if (!plazas.inside(pt.x, pt.z, 4)) continue;
      if (plazas.insideCore(pt.x, pt.z, 4)) core++;
      else expect(plazas.insideCore(pt.x, pt.z, 4)).toBe(true);
    }
    console.info(`[jackie] core mouth crosswalks: ${core}`);
    expect(core).toBeGreaterThanOrEqual(6);
    const cw = jackieMap.plazaCrosswalks!;
    expect(cw.length).toBeGreaterThanOrEqual(4);
    // Each OSM zebra touches the lane-start area's surroundings (some cross the streets just outside it).
    for (const line of cw)
      expect(
        line.some(
          (_, i) =>
            i % 2 === 0 &&
            plazas.inside(line[i], line[i + 1], 13) &&
            !plazas.insideCore(line[i], line[i + 1]),
        ),
      ).toBe(true);
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
    const wq = newWallQuery();
    let sheer = 0;
    for (let d = 0; d < world.road.length; d += 10) {
      const s = world.road.at(d);
      for (const side of [1, -1]) {
        const lat = side * (s.halfWidth + jackieMap.road.shoulder + cw.offset);
        const x = s.x + s.tz * lat;
        const z = s.z - s.tx * lat;
        const rise = world.gen.naturalHeight(x, z, false) - s.y;
        const w = world.gen.cutWeightAt(x, z, rise);
        // ... or a surveyed retaining wall (MapDef.retainingWalls) just beyond the verge, its top a cut deep above the road
        const q = world.gen.walls?.query(x, z, 3, wq);
        const wall = !!q?.found && q.side > -1 && q.high - s.y > cw.minHeight;
        if (w > 0.99 || wall) {
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
  test('ramps get a hatched wedge with a crash cushion at its wide nose, by the road edge; no barrier on the hatching', () => {
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
    // Off the lanes, in front of the barrier that starts at the nose (on its line by the road edge, not mid-gore).
    let byStage = 0;
    for (const c of cushions) {
      road.query(c.x, c.z, q);
      expect(q.distance).toBeGreaterThan(q.halfWidth + 0.6);
      if (q.distance < q.halfWidth + 3) byStage++;
    }
    expect(byStage).toBeGreaterThan(3);
    // The stage road's barriers stop where the hatched wedge begins and start again at its nose.
    const ctx = { road, net };
    let onHatch = 0;
    for (const r of world.barrierRuns.filter((b) => b.path === undefined))
      // (a run ends AT the first sample that no longer holds: its end point touches the wedge)
      for (let a = r.from + 1; a <= r.to - 1; a += 1) {
        const b = barrierPoint(ctx, world.analytic, r, a);
        if (inGore(wedges, b.x, b.z)) onHatch++;
      }
    expect(onHatch).toBe(0);
  });
});

describe('jackie: overpass at 1 855 m (B4)', () => {
  test('twin decks (the two directions of one street) share a height line', () => {
    const net = world.gen.paths!;
    const isStreetDeck = (q: number) =>
      !!net.paths[q].bridge &&
      !world.gen.isPortalDeck(q) &&
      net.paths[q].surface === 'tarmac' &&
      !/^(motorway|trunk)/.test(net.paths[q].kind);
    let checked = 0;
    net.paths.forEach((p, pi) => {
      if (!isStreetDeck(pi)) return;
      for (let a = 0; a <= net.lengths[pi]; a += 3) {
        const t = twinAt(net, isStreetDeck, pi, a, net.halfWidthAt(pi, a));
        if (!t) continue;
        checked++;
        expect(
          Math.abs(
            world.gen.pathHeight(pi, a) -
              world.gen.pathHeight(t.other, t.along),
          ),
          // (0.3 on level decks; at a deck end on its 7 % approach the nearest point of the twin is up to ~6 m off: < 0.5 m)
        ).toBeLessThan(0.5);
      }
    });
    console.info(`[jackie] twin deck samples: ${checked}`);
    expect(checked).toBeGreaterThan(20);
  });

  test('the stage road barriers run unbroken under the overpass (no false junction at the deck ends)', () => {
    const gaps = (side: number) =>
      world.barrierRuns.filter(
        (r) =>
          r.path === undefined &&
          r.side === side &&
          r.to > 1800 &&
          r.from < 1900,
      );
    // One Jersey wall (median side) and one guard rail cover 1 800-1 900 m completely.
    for (const side of [1, -1]) {
      const runs = gaps(side);
      expect(runs.length).toBe(1);
      expect(runs[0].from).toBeLessThan(1800);
      expect(runs[0].to).toBeGreaterThan(1900);
    }
    for (const j of world.gen.junctions)
      expect(j.along < 1840 || j.along > 1880).toBe(true);
  });
});

describe('jackie: bridge starts and ends', () => {
  test('a street continuing onto a deck meets the deck end without a step (< 0.15 m)', () => {
    const net = world.gen.paths!;
    const pd = { x: 0, z: 0 };
    const pg = { x: 0, z: 0 };
    let ends = 0;
    net.paths.forEach((p, di) => {
      if (!p.bridge || world.gen.isPortalDeck(di)) return;
      const D = net.lengths[di];
      for (const atEnd of [false, true]) {
        net.pointAt(di, atEnd ? D : 0, pd);
        const yd = world.gen.pathHeight(di, atEnd ? D : 0);
        net.paths.forEach((q, gi) => {
          if (q.bridge) return;
          const G = net.lengths[gi];
          for (const gEnd of [false, true]) {
            net.pointAt(gi, gEnd ? G : 0, pg);
            if (Math.hypot(pg.x - pd.x, pg.z - pd.z) > 2.5) continue;
            ends++;
            const dy = world.gen.pathHeight(gi, gEnd ? G : 0) - yd;
            expect(Math.abs(dy)).toBeLessThan(0.15);
          }
        });
      }
    });
    expect(ends).toBeGreaterThan(30);
  });
});

describe('jackie: underpasses are drivable', () => {
  test('under a stage-road bridge a probe from street level gets the street, from the deck the deck', () => {
    const spans = (road.def.spans ?? []).filter((s) => s.kind === 'bridge');
    const out = {
      height: 0,
      normal: new Vector3(),
      surface: undefined,
    } as never as Parameters<typeof world.sampleGround>[2];
    let tall = 0;
    for (const sp of spans) {
      const mid = road.at((sp.from + sp.to) / 2);
      const street = world.heightfield.height(mid.x, mid.z);
      const deck = world.gen.deckHeightAt(mid.x, mid.z);
      expect(Number.isNaN(deck)).toBe(false);
      if (deck - street < 3) continue; // a bridge over nothing: solid ground under it
      tall++;
      world.sampleGround(mid.x, mid.z, out, street + 1);
      expect(out.height).toBeLessThan(deck - 3);
      world.sampleGround(mid.x, mid.z, out, deck + 0.5);
      expect(out.height).toBeCloseTo(deck, 1);
    }
    expect(tall).toBeGreaterThan(2);
  });
});

describe('jackie: parallel bridges line up', () => {
  test('the opposite carriageway deck covers the stage-road span (ends within 2.5 m, or past it over a street)', () => {
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const q = newRoadQuery();
    let aligned = 0;
    for (const sp of (road.def.spans ?? []).filter(
      (s) => s.kind === 'bridge',
    )) {
      net.paths.forEach((p, pi) => {
        if (!p.bridge || p.kind !== 'motorway') return;
        const L = net.lengths[pi];
        let lo = Infinity;
        let hi = -Infinity;
        for (const a of [0, L]) {
          net.pointAt(pi, a, pt);
          road.query(pt.x, pt.z, q);
          if (!q.found || q.distance > 30) return;
          lo = Math.min(lo, q.along);
          hi = Math.max(hi, q.along);
        }
        if (hi < sp.from - 3 || lo > sp.to + 3) return; // another structure
        aligned++;
        // Never shorter than the span; longer only where it must cover a street crossing just past the span end.
        expect(lo - sp.from).toBeLessThan(2.5);
        expect(sp.to - hi).toBeLessThan(2.5);
        expect(sp.from - lo).toBeLessThan(30);
        expect(hi - sp.to).toBeLessThan(30);
      });
    }
    expect(aligned).toBeGreaterThanOrEqual(6);
  });
});

describe('jackie: ground under bridges', () => {
  test('terrain never comes up through a stage-road span or a deck beside the stage road', () => {
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    const q = newRoadQuery();
    let worst = -Infinity;
    for (const sp of (road.def.spans ?? []).filter((x) => x.kind === 'bridge'))
      for (let a = sp.from; a <= sp.to; a++) {
        const s = road.at(a);
        for (let l = -s.halfWidth; l <= s.halfWidth; l += 1)
          worst = Math.max(
            worst,
            world.heightfield.height(s.x + s.tz * l, s.z - s.tx * l) - s.y,
          );
      }
    expect(worst).toBeLessThan(0.05);
    let decks = 0;
    net.paths.forEach((p, pi) => {
      if (!p.bridge || world.gen.isPortalDeck(pi)) return;
      const L = net.lengths[pi];
      net.pointAt(pi, L / 2, pt);
      road.query(pt.x, pt.z, q);
      if (!q.found || q.distance > 40) return; // the interchange beyond the finish is not part of the stage
      decks++;
      for (let a = 2; a <= L - 2; a++) {
        net.pointAt(pi, a - 1, pt);
        net.pointAt(pi, a + 1, nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        net.pointAt(pi, a, pt);
        const hw = net.halfWidthAt(pi, a) - 0.3;
        for (let l = -hw; l <= hw; l += 1) {
          const x = pt.x + ((nx.z - pt.z) / tl) * l;
          const z = pt.z - ((nx.x - pt.x) / tl) * l;
          expect(
            world.heightfield.height(x, z) - world.gen.pathHeight(pi, a),
          ).toBeLessThan(0.2);
        }
      }
    });
    expect(decks).toBeGreaterThan(8);
  });
});

describe('jackie: deck profiles', () => {
  test('no cliff along a deck, ends included (grade < 15 % over any 3 m)', () => {
    const net = world.gen.paths!;
    const bad: string[] = [];
    let decks = 0;
    const mid = { x: 0, z: 0 };
    const rq = newRoadQuery();
    net.paths.forEach((p, pi) => {
      if (!p.bridge) return;
      const L = net.lengths[pi];
      net.pointAt(pi, L / 2, mid);
      road.query(mid.x, mid.z, rq);
      if (!rq.found || rq.distance > 60) return; // the interchange beyond the finish is not part of the stage
      decks++;
      for (let a = 0; a + 3 <= L; a += 1) {
        const g =
          Math.abs(
            world.gen.pathHeight(pi, a + 3) - world.gen.pathHeight(pi, a),
          ) / 3;
        if (g > 0.15)
          bad.push(
            `deck ${pi} ${p.kind} at ${a}/${L.toFixed(0)}: ${(g * 100).toFixed(0)} %`,
          );
      }
    });
    expect(decks).toBeGreaterThan(15);
    expect(bad).toEqual([]);
  });
});

describe('jackie: path barriers', () => {
  test('no barrier of the opposite carriageway stands on an exit / entrance ramp or another road (B3)', () => {
    const net = world.gen.paths!;
    const pq = newPathQuery();
    const ctx = { road, net };
    let on = 0;
    for (const r of world.barrierRuns) {
      if (r.path === undefined) continue; // the stage road's own barriers: parapets over streets are on the deck
      for (let a = r.from; a <= r.to; a += 2) {
        const p = barrierPoint(ctx, world.heightfield as never, r, a);
        net.query(
          p.x,
          p.z,
          pq,
          'tarmac',
          (qi) => qi !== r.path && !net.paths[qi].bridge,
        );
        if (pq.found && pq.distance < pq.halfWidth - 0.4) on++;
      }
    }
    // A few 2 m overlaps at path ends remain; hundreds of samples (a wall across a ramp lane) were there before.
    expect(on).toBeLessThan(30);
  });
});

describe('jackie: twin deck ends', () => {
  test('the two directions of an overpass end on the same cross line (< 1 m stagger)', () => {
    const net = world.gen.paths!;
    const decks = net.paths
      .map((p, pi) => ({ p, pi }))
      .filter(({ p, pi }) => {
        if (
          !p.bridge ||
          p.surface !== 'tarmac' ||
          /^(motorway|trunk)/.test(p.kind) ||
          world.gen.isPortalDeck(pi)
        )
          return false;
        const m = { x: 0, z: 0 };
        net.pointAt(pi, net.lengths[pi] / 2, m);
        const rq = newRoadQuery();
        road.query(m.x, m.z, rq);
        return rq.found && rq.distance < 60; // the interchange beyond the finish is not part of the stage
      });
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    const c = { x: 0, z: 0 };
    let pairs = 0;
    for (const A of decks)
      for (const B of decks) {
        if (A.pi >= B.pi) continue;
        const LA = net.lengths[A.pi];
        const LB = net.lengths[B.pi];
        net.pointAt(A.pi, 0, a);
        net.pointAt(A.pi, LA, b);
        const cl = Math.hypot(b.x - a.x, b.z - a.z);
        const dx = (b.x - a.x) / cl;
        const dz = (b.z - a.z) / cl;
        net.pointAt(B.pi, 0, c);
        const t0 = (c.x - a.x) * dx + (c.z - a.z) * dz;
        const u0 = (c.x - a.x) * dz - (c.z - a.z) * dx;
        net.pointAt(B.pi, LB, c);
        const t1 = (c.x - a.x) * dx + (c.z - a.z) * dz;
        const u1 = (c.x - a.x) * dz - (c.z - a.z) * dx;
        const sep = Math.abs((u0 + u1) / 2);
        if (sep < 3 || sep > 14 || Math.abs(u1 - u0) > 0.25 * Math.abs(t1 - t0))
          continue;
        const overlap =
          Math.min(cl, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
        if (overlap < 0.7 * Math.min(cl, Math.abs(t1 - t0))) continue; // another structure beside it
        if (
          Math.min(cl, Math.abs(t1 - t0)) <
          0.6 * Math.max(cl, Math.abs(t1 - t0))
        )
          continue;
        pairs++;
        const info = `decks ${A.pi}/${B.pi} ${A.p.kind}/${B.p.kind} L ${LA.toFixed(0)}/${LB.toFixed(0)} t ${t0.toFixed(1)}..${t1.toFixed(1)} of ${cl.toFixed(1)} sep ${sep.toFixed(1)}`;
        expect({ info, low: Math.abs(Math.min(t0, t1)) < 1 }).toEqual({
          info,
          low: true,
        });
        expect({ info, high: Math.abs(Math.max(t0, t1) - cl) < 1 }).toEqual({
          info,
          high: true,
        });
      }
    expect(pairs).toBeGreaterThanOrEqual(1);
  });
});

describe('jackie: narrow parkway, B9, interchange signs', () => {
  test('the stage road has the real carriageway width: 5.6-7.0 m, narrowest at the Kew Gardens end', () => {
    let lo = Infinity;
    let hi = 0;
    for (let a = 0; a <= road.length; a += 25) {
      const w = 2 * road.at(a).halfWidth;
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
    expect(lo).toBeGreaterThanOrEqual(5.55);
    expect(hi).toBeLessThanOrEqual(7.05);
    expect(2 * road.at(7100).halfWidth).toBeLessThan(6);
  });

  test('Woodhaven Blvd runs under the B9 span on every way (no lane left at deck level)', () => {
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const q = newRoadQuery();
    const under = new Set<number>();
    net.paths.forEach((p, pi) => {
      if (p.name !== 'Woodhaven Boulevard' || p.bridge) return;
      for (let a = 0; a <= net.lengths[pi]; a += 2) {
        net.pointAt(pi, a, pt);
        road.query(pt.x, pt.z, q);
        if (!q.found || q.distance > q.halfWidth || !road.bridgeAt(q.along))
          continue;
        under.add(pi);
        expect(world.gen.pathHeight(pi, a)).toBeLessThan(q.height - 5);
      }
    });
    // both directions of the main lanes (the OSM tunnel pieces added in map.ts; the service roads beside them are unnamed)
    expect(under.size).toBeGreaterThanOrEqual(2);
  });

  test('the interchange gets guide signs at its splits, naming where each branch leads', () => {
    const splits = world.overheadSigns.gantries.filter((g) => g.frame);
    expect(splits.length).toBeGreaterThanOrEqual(3);
    for (const g of splits) {
      expect(g.boards.length).toBe(2);
      expect(g.frame!.x).toBeGreaterThan(2900);
      const arrows = g.boards.map((b) => b.def.arrow);
      expect(arrows).toContain('down');
    }
    const names = splits.flatMap((g) => g.boards.flatMap((b) => b.def.lines));
    expect(names.some((n) => /Grand Central/.test(n))).toBe(true);
    expect(names.some((n) => /Van Wyck/.test(n))).toBe(true);
  });

  test('driveways cross the sidewalks with a kerb cut; street trees on a sidewalk stand in a pit', () => {
    const runs = world.streetDetail!.runs;
    const cuts = runs.reduce((n, r) => n + (r.cuts?.length ?? 0), 0);
    expect(cuts).toBeGreaterThan(20);
    for (const r of runs)
      for (const [c0, c1] of r.cuts ?? []) {
        expect(c1).toBeGreaterThanOrEqual(c0);
        expect(c1 - c0).toBeLessThan(14);
      }
    const pits = [...world.scatter.fixedInstances()].filter(
      (i) => i.asset === 'tree_pit',
    ).length;
    expect(pits).toBeGreaterThan(200);
  });
});

describe('jackie: opposite carriageway width (B2a)', () => {
  test('two-lane carriageways beside the stage road are as wide as the stage road there where the median allows', () => {
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const q = newRoadQuery();
    let beside = 0;
    let same = 0;
    net.paths.forEach((p, pi) => {
      if (p.kind !== 'motorway' || p.surface !== 'tarmac' || (p.lanes ?? 2) > 2)
        return;
      net.pointAt(pi, net.lengths[pi] / 2, pt);
      road.query(pt.x, pt.z, q);
      if (!q.found || q.distance > 12 || net.lengths[pi] < 20) return;
      beside++;
      // the stage road's width varies (the real carriageway): compare with it beside the way
      const local = 2 * q.halfWidth;
      if (Math.abs(p.width - local) < 0.3) same++;
      expect(p.width).toBeGreaterThanOrEqual(Math.min(5.99, local - 0.5));
      expect(p.width).toBeLessThanOrEqual(road.def.width + 0.05);
    });
    expect(beside).toBeGreaterThan(10);
    expect(same / beside).toBeGreaterThan(0.5);
  });
});

describe('jackie: underpass trenches and walled approaches', () => {
  test('a street dipped under a bridge runs in a trench with sheer walls (flat out to the wall, then up)', () => {
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    let walled = 0;
    let flat = 0;
    net.paths.forEach((p, pi) => {
      if (!world.gen.isUnderpass(pi)) return;
      const L = net.lengths[pi];
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(pi, Math.max(0, a - 1), pt);
        net.pointAt(pi, Math.min(L, a + 1), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, a, pt);
        const y = world.gen.pathHeight(pi, a);
        const hw = net.halfWidthAt(pi, a);
        const h = (l: number) =>
          world.heightfield.height(pt.x + tz * l, pt.z - tx * l);
        for (const side of [1, -1]) {
          // Deep trench: the land 9 m beside the street is well above it ...
          if (h(side * (hw + 9)) - y < 3.5) continue;
          walled++;
          if (Math.abs(h(side * (hw + UNDERPASS_WALL - 0.5)) - y) < 0.8) flat++;
        }
      }
    });
    expect(walled).toBeGreaterThan(20);
    // The floor is level out to the wall line nearly everywhere (the ends of a trench blend into the land).
    expect(flat / walled).toBeGreaterThan(0.75);
  });

  test('overpass approaches: the fill beside the street is a sheer drop (a retaining wall), not a grass slope', () => {
    expect(world.gen.approaches.length).toBeGreaterThan(10);
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    let sheer = 0;
    let level = 0;
    net.paths.forEach((p, pi) => {
      if (
        p.bridge ||
        ![
          'tertiary',
          'secondary',
          'primary',
          'residential',
          'service',
        ].includes(p.kind)
      )
        return;
      const L = net.lengths[pi];
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(pi, Math.max(0, a - 1), pt);
        net.pointAt(pi, Math.min(L, a + 1), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, a, pt);
        if (world.gen.approachWeightAt(pt.x, pt.z) < 0.9) continue;
        const y = world.gen.pathHeight(pi, a);
        const hw = net.halfWidthAt(pi, a);
        for (const side of [1, -1]) {
          const h = (l: number) =>
            world.heightfield.height(
              pt.x + tz * l * side,
              pt.z - tx * l * side,
            );
          // The road stands on a fill: land 6 m out is >= 2.5 m lower, yet the ground is level out to the wall.
          if (y - h(hw + APPROACH_WALL + 4) < 2.5) continue;
          sheer++;
          if (Math.abs(h(hw + APPROACH_WALL - 0.6) - y) < 0.7) level++;
        }
      }
    });
    expect(sheer).toBeGreaterThan(5);
    // Most of the strong fills are level out to the wall line (partial fills on a hillside blend).
    expect(level / sheer).toBeGreaterThan(0.6);
  });
});

describe('jackie: underpass street surface', () => {
  test('the ground across the street in a trench is its own level (no curl at the edges from a neighbouring embankment)', () => {
    const net = world.gen.paths!;
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    let samples = 0;
    let bad = 0;
    // The B2 street (the one under the 1 099-1 145 m bridge): the opposite carriageway's embankment used to curl its edge up.
    const b2 = road.at(1127);
    const pq = newPathQuery();
    net.query(
      b2.x,
      b2.z,
      pq,
      'tarmac',
      (qi) => !net.paths[qi].bridge && !/^motorway/.test(net.paths[qi].kind),
    );
    net.paths.forEach((_p, pi) => {
      if (pi !== pq.path || !world.gen.isUnderpass(pi)) return;
      const L = net.lengths[pi];
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(pi, Math.max(0, a - 1), pt);
        net.pointAt(pi, Math.min(L, a + 1), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, a, pt);
        const y = world.gen.pathHeight(pi, a);
        const hw = net.halfWidthAt(pi, a);
        const h = (l: number) =>
          world.heightfield.height(pt.x + tz * l, pt.z - tx * l);
        // Only the deep part of a trench (land 3.5 m above the street beside it).
        if (Math.min(h(hw + 9), h(-hw - 9)) - y < 3.5) continue;
        for (const f of [-1, -0.5, 0, 0.5, 1]) {
          samples++;
          if (Math.abs(h(f * hw) - y) > 0.1) bad++;
        }
      }
    });
    // (the street dips ~4 m under the bridge to its real 5.7 m clearance: the deep stretch is short)
    expect(samples).toBeGreaterThan(20);
    expect(bad / samples).toBeLessThan(0.01);
  });
});
