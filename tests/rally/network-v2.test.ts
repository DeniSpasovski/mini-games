import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import tunnelFixture from './fixtures/jackie2-tunnel.json';
import { World } from '../../src/games/rally/world/world';
import {
  inPolygon,
  pointAt,
  valueAt,
} from '../../src/games/rally/world/v2/alignment';
import { barrierPlan, skirtRow } from '../../src/games/rally/world/v2/mesh';
import {
  netColliders,
  netInstances,
} from '../../src/games/rally/world/v2/dressing';
import {
  SKIRT_DEPTH,
  SKIRT_W,
  SLAB_SINKS,
} from '../../src/games/rally/world/road-slab';
import {
  ROAD_STEP,
  ST_DECK,
  ST_TUNNEL,
  WALL_CUT,
  WALL_FILL,
  WALL_NONE,
  runsOf,
  scaleAt,
  worldT,
} from '../../src/games/rally/world/v2/network';

/**
 * Road engine v2 invariants (world/v2/), for every map with a `network`: the solver's output is checked as rules, not
 * per site - one height per junction, smooth profiles, clearances at every crossing, roads on their own sections.
 */
const NET_MAPS = ALL_MAPS.filter((m) => m.network);

describe.each(NET_MAPS.map((m) => [m.id, m] as const))(
  'v2 map %s',
  (_id, map) => {
    const t0 = performance.now();
    const world = new World(map);
    const ms = performance.now() - t0;
    const net = world.gen.net!;
    const field = world.gen.netField!;

    test('network summary', () => {
      const decks = net.ways.reduce(
        (a, w) => a + runsOf(w.st, ST_DECK).length,
        0,
      );
      const tunnels = net.ways.reduce(
        (a, w) => a + runsOf(w.st, ST_TUNNEL).length,
        0,
      );
      let cut = 0;
      let fill = 0;
      for (const w of net.ways)
        for (const s of [0, 1] as const) {
          cut += runsOf(w.wall[s], WALL_CUT).length;
          fill += runsOf(w.wall[s], WALL_FILL).length;
        }
      const kinds: Record<string, number> = {};
      for (const n of net.nodes.values())
        kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
      const tpls: Record<string, number> = {};
      for (const w of net.ways) tpls[w.tpl.id] = (tpls[w.tpl.id] ?? 0) + 1;
      console.info(
        `[${map.id}] world ${ms.toFixed(0)} ms; ${net.ways.length} ways, ${net.junctions.length} junctions ` +
          `(${net.junctions.filter((j) => j.nodes.length > 1).length} clusters), ${net.crossings.length} crossings, ` +
          `${decks} decks, ${tunnels} tunnels, ${cut} cut walls, ${fill} fill walls; nodes ${JSON.stringify(kinds)}; ` +
          `templates ${JSON.stringify(tpls)}; internal ${net.ways.filter((w) => w.internal).length}; missing patches ${net.missingPatches.length}`,
      );
      expect(net.missingPatches.length).toBe(0);
    });

    test('profiles are smooth and within grade', () => {
      let worst = 0;
      let at = '';
      for (const w of net.ways) {
        const { y, al } = w;
        if (w.internal) continue;
        for (let i = 2; i < al.n; i++) {
          // inside a junction polygon the junction's own surface is driven, not the way's
          if (al.s[i - 1] < w.cut0 + 2 || al.s[i] > al.length - w.cut1 - 2)
            continue;
          const g =
            Math.abs(y[i] - y[i - 1]) /
            (al.s[i] - al.s[i - 1] || 1) /
            (w.tpl.maxGrade / 0.12);
          if (g > worst) {
            worst = g;
            at = `${w.id} @${al.s[i].toFixed(0)} (${al.x[i].toFixed(0)}, ${al.z[i].toFixed(0)})`;
          }
        }
      }
      console.info(
        `[${map.id}] steepest way grade (per 12 % allowed) ${(worst * 100).toFixed(1)}% at ${at}`,
      );
      expect(worst).toBeLessThan(0.17);
    });

    test('crossings keep their clearance', () => {
      let bad = 0;
      let worst = Infinity;
      let at = '';
      for (const c of net.crossings) {
        if (c.overSlab) continue;
        const yu =
          c.upper.y[
            Math.round(c.sU / (c.upper.al.length / (c.upper.al.n - 1)))
          ];
        const yl =
          c.lower.y[
            Math.round(c.sL / (c.lower.al.length / (c.lower.al.n - 1)))
          ];
        const gap = yu - yl;
        if (gap < worst) {
          worst = gap;
          at = `${c.upper.id} over ${c.lower.id} (${c.x.toFixed(0)}, ${c.z.toFixed(0)})`;
        }
        if (gap < 4) bad++;
      }
      console.info(
        `[${map.id}] tightest crossing ${worst.toFixed(2)} m: ${at}; ${bad} under 4 m`,
      );
      expect(bad).toBe(0);
    });

    test('walls never stand on or beside another road at its level', () => {
      let bad = 0;
      let at = '';
      for (const w of net.ways)
        for (const side of [0, 1] as const) {
          const sg = side === 0 ? 1 : -1;
          const foot = side === 0 ? w.sec.footL : w.sec.footR;
          for (let i = 0; i < w.al.n; i++) {
            if (w.wall[side][i] === WALL_NONE || w.wallLane[side][i]) continue;
            const l = foot + w.tpl.daylight.wallOffset + 0.3;
            const x = w.al.x[i] + w.al.tz[i] * l * sg;
            const z = w.al.z[i] - w.al.tx[i] * l * sg;
            const y = net.surfaceAt(w, i, 0, sg * foot);
            // (at its level = within ROAD_STEP: a wall between two roads further apart is the step between them)
            const o = field.sectionByOther(x, z, y, w, 0, ROAD_STEP);
            if (o) {
              bad++;
              if (!at)
                at = `${w.id} side ${side} @${w.al.s[i].toFixed(0)} on ${o.id} (${x.toFixed(0)}, ${z.toFixed(0)})`;
            }
          }
        }
      console.info(
        `[${map.id}] wall samples on another road: ${bad}${at ? ` (first ${at})` : ''}`,
      );
      expect(bad).toBe(0);
    });

    test('every merge end runs onto its host road at its level', () => {
      let merges = 0;
      let bad = 0;
      let at = '';
      for (const w of net.ways)
        for (const e of [0, 1] as const) {
          const host = w.into[e];
          if (!host) continue;
          merges++;
          // the last 20 m before the merge node: the way's centre reaches the host's pavement (the mesh stitches the
          // rest) at the host's height
          let ok = false;
          for (let i = 0; i < w.al.n; i++) {
            const d = e === 0 ? w.al.s[i] : w.al.length - w.al.s[i];
            if (d > 20) continue;
            const o = field.pavedByOther(
              w.al.x[i],
              w.al.z[i],
              w.y[i],
              w,
              2.5,
              0.6,
            );
            if (o === host) ok = true;
          }
          if (!ok) {
            bad++;
            let dh = Infinity;
            let dist = Infinity;
            for (let i = 0; i < w.al.n; i++) {
              const d = e === 0 ? w.al.s[i] : w.al.length - w.al.s[i];
              if (d > 12) continue;
              const t = field.top(w.al.x[i], w.al.z[i]);
              if (t) dh = Math.min(dh, Math.abs(t.h - w.y[i]));
              const o = field.pavedByOther(
                w.al.x[i],
                w.al.z[i],
                w.y[i],
                w,
                3,
                50,
              );
              if (o === host) dist = 0;
            }
            at += `${at ? '; ' : ''}${w.id} end ${e} into ${host.id} (dh ${dh.toFixed(2)}, on host within 3 m: ${dist === 0})`;
          }
        }
      console.info(
        `[${map.id}] merges ${merges}, not on their host: ${bad}${at ? ` (first ${at})` : ''}`,
      );
      expect(merges).toBeGreaterThan(0);
      expect(bad).toBe(0);
    });

    test('the other carriageway follows the stage road', () => {
      let worst = 0;
      let at = '';
      let n = 0;
      for (const w of net.ways) {
        if (!w.corr) continue;
        for (let i = 0; i < w.al.n; i++) {
          const st = w.corr[i];
          if (Number.isNaN(st)) continue;
          // not where the carriageway has a crossing of its own to clear (a ramp over it as it leaves the corridor),
          // nor past the stage road's ends
          // (a crossing over this carriageway alone holds it down over the grade cone around its dip)
          if (
            net.debug.dips.some(
              (d) => d.w === w && Math.abs(d.s - w.al.s[i]) < 260,
            )
          )
            continue;
          if (st < 20 || st > net.stage.al.length - 20) continue;
          n++;
          const d = Math.abs(w.y[i] - valueAt(net.stage.al, net.stage.y, st));
          if (d > worst) {
            worst = d;
            at = `${w.id} @${w.al.s[i].toFixed(0)} (stage ${st.toFixed(0)} m)`;
          }
        }
      }
      console.info(
        `[${map.id}] corridor samples ${n}, worst height difference ${worst.toFixed(2)} m at ${at}`,
      );
      expect(n).toBeGreaterThan(0);
      expect(worst).toBeLessThan(0.35);
    });

    test('stage width: the surveyed width per station, the template section near a tunnel or another pavement', () => {
      // network_survey.py `stage.widths` (NYC roadbed, smoothed 200 m, 5.6-7.0 m) -> Network.stageScale
      const w = net.stage;
      const ws = map.network!.data.stage.widths;
      if (!ws?.length) return;
      const tpl = w.sec.paveL + w.sec.paveR;
      // (the route's metres: the run-out past its end has no survey stations, it keeps the template)
      const scale = world.road.runoutFrom / map.network!.data.stage.length;
      let n = 0;
      let off = 0;
      let worst = 0;
      let tunnelWide = 0;
      let tunnel = 0;
      // along distance to the stage's tunnel (the hold + the ease back are not survey widths)
      const toTunnel = new Float64Array(w.al.n).fill(Infinity);
      for (let i = 0; i < w.al.n; i++)
        if (w.st[i] === ST_TUNNEL)
          for (let j = 0; j < w.al.n; j++)
            toTunnel[j] = Math.min(
              toTunnel[j],
              Math.abs(w.al.s[j] - w.al.s[i]),
            );
      for (let i = 0; i < w.al.n; i++) {
        const width = tpl * scaleAt(w, i);
        if (w.st[i] === ST_TUNNEL) {
          tunnel++;
          if (Math.abs(width - tpl) > 1e-9) tunnelWide++;
          continue;
        }
        if (toTunnel[i] < 260) continue; // held near the tunnel, easing back
        if (w.al.s[i] > world.road.runoutFrom) continue;
        // held where another pavement touches the stage edge (a ramp, a gore), easing back
        if ((net.debug.widthHeld?.[i] ?? Infinity) < 100) continue;
        const m = w.al.s[i] / scale;
        let j = 0;
        while (j + 1 < ws.length && ws[j + 1][0] < m) j++;
        const want = Math.min(tpl, ws[Math.min(j, ws.length - 1)][1]);
        const want2 = Math.min(tpl, ws[Math.min(j + 1, ws.length - 1)][1]);
        const d = Math.max(
          0,
          Math.min(Math.abs(width - want), Math.abs(width - want2)) -
            Math.abs(want2 - want),
        );
        worst = Math.max(worst, d);
        if (d > 0.05) off++;
        n++;
      }
      console.info(
        `[${map.id}] stage width: ${n} samples narrowed (worst ${worst.toFixed(3)} m off the survey), ${tunnel} tunnel samples, ${tunnelWide} not at the template`,
      );
      expect(n).toBeGreaterThan(w.al.n / 2);
      expect(off).toBe(0);
      expect(tunnelWide).toBe(0);
    });

    test('road slab: the drawn terrain sinks under the pavement, the verge drops at kerbless edges, skirts drawn', () => {
      // main's road-slab rules on v2 sections (NetField.meshSink): full SLAB_SINKS.asphalt from 1 m inside the edge,
      // a shallow drop just past a kerbless edge, nothing far out; physics (`ground`) keeps the uncut land
      const w = net.stage;
      const fr = { x: 0, z: 0, tx: 0, tz: 0 };
      let inside = 0;
      let insideBad = 0;
      let edgeBad = 0;
      let edgeAt = '';
      let n = 0;
      for (let i = 2; i < w.al.n - 2; i += 7) {
        if (w.st[i] === ST_DECK || w.st[i] === ST_TUNNEL) continue;
        const s = w.al.s[i];
        if (s < w.cut0 + 5 || s > w.al.length - w.cut1 - 5) continue;
        pointAt(w.al, s, fr);
        // (section laterals: the stage pavement is narrowed to its surveyed width per station)
        const at = (t: number): [number, number] => [
          fr.x + fr.tz * worldT(w, i, 0, t),
          fr.z - fr.tx * worldT(w, i, 0, t),
        ];
        const mid = Math.min(1.5, (w.sec.paveL * scaleAt(w, i)) / 2);
        const [xi, zi] = at(w.sec.paveL - mid);
        n++;
        const si = world.gen.sink!(xi, zi);
        inside = Math.max(inside, si);
        if (si < SLAB_SINKS.asphalt - 1e-6 && mid >= 1) insideBad++;
        if (w.sec.left[0]?.kind !== 'kerb') {
          const [xe, ze] = at(w.sec.paveL + 0.1);
          const se = field.meshSink(xe, ze);
          // past the edge: only the verge drop, unless another pavement or a junction's / plaza's paving lies there
          const inJunction =
            net.junctions.some((j) => inPolygon(j.poly, xe, ze)) ||
            field.plazaDrawn(xe, ze, 0) !== undefined;
          // (or a step: land 0.6 m further out lies STEP_MIN lower, the drawn land drops to it - NetField.stepCut)
          const [xo, zo] = at(w.sec.paveL + 0.7);
          const step = field.ground(xe, ze) - field.ground(xo, zo) > 0.3;
          if (
            se > 0.0401 &&
            !step &&
            !inJunction &&
            !field.pavedByOther(xe, ze, w.y[i], w, 0.2, 3)
          ) {
            edgeBad++;
            edgeAt ||= `${s.toFixed(0)} m (${xe.toFixed(1)}, ${ze.toFixed(1)}) sink ${se.toFixed(3)}`;
          }
        }
      }
      console.info(
        `[${map.id}] slab sink: ${n} samples, ${insideBad} shallow inside, ${edgeBad} deep past the edge ${edgeAt}`,
      );
      expect(n).toBeGreaterThan(50);
      expect(inside).toBeCloseTo(SLAB_SINKS.asphalt, 5);
      expect(insideBad).toBe(0);
      expect(edgeBad).toBe(0);
      // the skirt: the slab's side below each kerbless pavement edge - SKIRT_DEPTH down, SKIRT_W out, not the old
      // 0.45 m body; left out where its toe lies on another way's pavement
      let rows = 0;
      let closed = 0;
      let under = 0;
      let underAt = '';
      for (const s of [0, 1] as const) {
        if ((s === 0 ? w.sec.left : w.sec.right)[0]?.kind === 'kerb') continue;
        for (let d = w.cut0 + 2; d < w.al.length - w.cut1 - 2; d += 23) {
          const r = skirtRow(net, field, w, d, s === 0);
          rows++;
          if (!r.open) closed++;
          expect(r.edge[1] - r.toe[1]).toBeCloseTo(SKIRT_DEPTH, 6);
          expect(
            Math.hypot(r.toe[0] - r.edge[0], r.toe[2] - r.edge[2]),
          ).toBeCloseTo(SKIRT_W, 3);
          // the toe lies under the drawn verge (the terrain mesh covers it)
          // (on the ground, no wall on that side: a deck / wall face has its own side)
          const k = Math.round(d / (w.al.length / (w.al.n - 1)));
          const bare =
            w.st[k] !== ST_DECK &&
            w.st[k] !== ST_TUNNEL &&
            w.wall[s][k] === WALL_NONE;
          const drawn = world.gen.meshHeight(r.toe[0], r.toe[2]);
          // (over land more than 0.1 m lower - a step - the slab side goes on as a face down to it, up to 4 m)
          const faced = drawn < r.toe[1] - 0.1 && drawn > r.toe[1] - 4;
          if (r.open && bare && !faced && drawn < r.toe[1] - 0.01) {
            under++;
            underAt ||= `${d.toFixed(0)} m side ${s}: toe ${r.toe[1].toFixed(2)} drawn ${drawn.toFixed(2)}`;
          }
        }
      }
      console.info(
        `[${map.id}] skirt rows ${rows}, ${closed} on other paving, ${under} toes in the air ${underAt}`,
      );
      expect(rows).toBeGreaterThan(100);
      expect(under).toBeLessThan(rows * 0.02);
      expect(closed).toBeLessThan(rows / 2);
      // a survey plaza's paving meets a slab top / a junction's paving at its level (the shared-edge hold): no step
      // over 5 cm, but where the paving lies between two structures that disagree
      const edges = field.plazaEdgeSteps();
      const steps = edges.filter((e) => !e.between && e.step > 0.05);
      console.info(
        `[${map.id}] plaza edges ${edges.length}, ${edges.filter((e) => e.between).length} between disagreeing structures, ${steps.length} steps > 5 cm ${steps
          .slice(0, 3)
          .map((e) => `${e.x},${e.z} ${e.step.toFixed(2)}`)
          .join(' | ')}`,
      );
      if (net.plazas.length) expect(edges.length).toBeGreaterThan(100);
      // (disagreeing structures stay rare: a junction / slab rule that drifts shows up here, not as exemptions)
      expect(edges.filter((e) => e.between).length).toBeLessThan(
        edges.length * 0.1,
      );
      expect(steps).toEqual([]);
    });

    test('survey: real roadbed widths and spot heights, never near a tunnel', () => {
      const sv = map.network!.data;
      if (!sv.survey) return;
      // the template pavement is scaled to the surveyed curb-to-curb width (within the scale guard 0.75..1.4)
      let scaled = 0;
      let off = 0;
      for (const w of net.ways) {
        const want = w.tags.width;
        if (!want || w.stage || w.internal) continue;
        const have = w.sec.paveL + w.sec.paveR;
        if (Math.abs(have - want) < 0.05) scaled++;
        else if (Math.abs(have / want - 1) < 0.25) off++;
      }
      console.info(
        `[${map.id}] survey: ${scaled} ways at their surveyed width, ${off} near it; ${net.debug.surveyed} profile samples on spot heights`,
      );
      expect(scaled).toBeGreaterThan(100);
      expect(net.debug.surveyed).toBeGreaterThan(200);
    });

    test('the Queens Blvd tunnel stays as designed (fixture)', () => {
      if (map.id !== 'jackie_2') return;
      const fx = tunnelFixture.ways as Record<
        string,
        { sec: number[]; runs: number[][]; rows: number[][] }
      >;
      const tunnels = net.ways.filter((w) => runsOf(w.st, ST_TUNNEL).length);
      expect(tunnels.map((w) => w.id).sort()).toEqual(Object.keys(fx).sort());
      for (const w of tunnels) {
        const f = fx[w.id];
        expect(
          [w.sec.paveL, w.sec.paveR, w.sec.footL, w.sec.footR].map(
            (v) => +v.toFixed(3),
          ),
        ).toEqual(f.sec);
        expect(runsOf(w.st, ST_TUNNEL)).toEqual(f.runs);
        const [a] = f.runs[0];
        let worst = 0;
        f.rows.forEach(([s, x, z, y]) => {
          const i = w.al.s.findIndex((v) => Math.abs(v - s) < 0.01);
          expect(i).toBeGreaterThanOrEqual(Math.max(0, a - 15));
          worst = Math.max(
            worst,
            Math.abs(w.al.x[i] - x),
            Math.abs(w.al.z[i] - z),
            Math.abs(w.y[i] - y),
          );
        });
        expect(worst).toBeLessThan(0.02);
      }
    });

    test('parkway lamps: right side only, set back on the land (drive videos)', () => {
      const tpl = net.stage.tpl;
      if (tpl.lampSide !== 'right') return;
      const lamps = netInstances(net, field, 1, () => false).filter(
        (o) => o.asset === (tpl.lampAsset ?? 'street_lamp'),
      );
      const w = net.stage;
      const fr = { x: 0, z: 0, tx: 0, tz: 0 };
      let right = 0;
      let left = 0;
      for (let d = w.cut0; d < w.al.length - w.cut1; d += 4) {
        pointAt(w.al, d, fr);
        for (const o of lamps) {
          const dx = o.x - fr.x;
          const dz = o.z - fr.z;
          if (Math.abs(dx * fr.tx + dz * fr.tz) > 2) continue;
          const t = dx * fr.tz - dz * fr.tx;
          if (
            t < 0 &&
            -t > w.sec.paveR + 1 &&
            -t < w.sec.paveR + tpl.lampOff! + 0.6
          )
            right++;
          if (t > 0 && t < w.sec.paveL + 3) left++;
        }
      }
      console.info(
        `[${map.id}] stage lamps: ${right} right, ${left} left / on the median`,
      );
      expect(right).toBeGreaterThan(40);
      expect(left).toBe(0);
    });

    test('land between neighbouring roads follows their edges (no mound between the carriageways)', () => {
      const fr = { x: 0, z: 0, tx: 0, tz: 0 };
      let n = 0;
      let bad = 0;
      let at = '';
      for (const w of net.ways) {
        if (!w.corr) continue;
        for (let i = 0; i < w.al.n; i += 3) {
          const st = w.corr[i];
          if (Number.isNaN(st) || w.st[i] !== 0) continue;
          const k = Math.round(
            st / (net.stage.al.length / (net.stage.al.n - 1)),
          );
          if (net.stage.st[k] !== 0) continue;
          pointAt(net.stage.al, st, fr);
          const gap =
            Math.hypot(w.al.x[i] - fr.x, w.al.z[i] - fr.z) -
            Math.max(w.sec.footL, w.sec.footR) -
            Math.max(net.stage.sec.footL, net.stage.sec.footR);
          if (gap < 2 || gap > 24) continue;
          const mx = (w.al.x[i] + fr.x) / 2;
          const mz = (w.al.z[i] + fr.z) / 2;
          if (net.junctions.some((j) => inPolygon(j.poly, mx, mz))) continue;
          n++;
          const top =
            Math.max(w.y[i], valueAt(net.stage.al, net.stage.y, st)) +
            0.4 +
            0.25;
          const g = field.ground(mx, mz);
          if (g > top) {
            bad++;
            at ||= `${w.id} @${w.al.s[i].toFixed(0)}: ground ${g.toFixed(2)} > ${top.toFixed(2)}`;
          }
        }
      }
      console.info(
        `[${map.id}] between carriageways: ${n} samples, ${bad} mounds ${at}`,
      );
      expect(bad).toBeLessThanOrEqual(Math.ceil(n * 0.02));
    });

    test('colliders are never solid on another road pavement', () => {
      const cols = netColliders(net, field);
      let bad = 0;
      for (const c of cols) {
        const top = field.top(c.x, c.z, c.y + c.h);
        // a collider centre on a drivable surface that lies inside its height band (not the road it stands on)
        if (top && top.h > c.y + 0.35 && top.h < c.y + c.h - 0.2) bad++;
      }
      console.info(
        `[${map.id}] colliders ${cols.length}, ${bad} through pavement`,
      );
      expect(bad).toBeLessThanOrEqual(Math.ceil(cols.length * 0.01));
    });

    test('parkway cut walls have a concrete barrier at their foot (drive videos)', () => {
      const w = net.stage;
      if (!w.tpl.cutBarrier) return;
      let wallM = 0;
      let covered = 0;
      for (const side of [0, 1] as const) {
        // (every run of that kind: a stretch's outer barrier can be the same concrete barrier)
        const runs = {
          runs: barrierPlan(net, field, w, side)
            .filter((p) => p.kind === w.tpl.cutBarrier)
            .flatMap((p) => p.runs),
        };
        const cut = runsOf(w.wall[side], WALL_CUT);
        for (const [a, b] of cut) {
          const s0 = w.al.s[a];
          const s1 = w.al.s[b];
          if (s1 - s0 < 12) continue;
          wallM += s1 - s0;
          for (const [r0, r1] of runs?.runs ?? [])
            covered += Math.max(0, Math.min(s1, r1) - Math.max(s0, r0));
        }
      }
      console.info(
        `[${map.id}] stage cut walls ${wallM.toFixed(0)} m, barrier at the foot ${covered.toFixed(0)} m`,
      );
      if (wallM > 0) expect(covered / wallM).toBeGreaterThan(0.6);
    });

    test('the stage road surface is the physics surface', () => {
      const r = world.road;
      let worst = 0;
      for (let d = 20; d < r.length - 20; d += 37) {
        const s = r.at(d);
        const top = field.top(s.x, s.z, s.y);
        expect(top).toBeDefined();
        worst = Math.max(worst, Math.abs(top!.h - s.y));
      }
      console.info(
        `[${map.id}] stage centre vs surface: ${worst.toFixed(3)} m`,
      );
      expect(worst).toBeLessThan(0.1);
    });
  },
);
