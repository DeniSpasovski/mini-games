import { hashString, Rng } from '../../../../shared/rng';
import type { StaticCollider } from '../../physics/types';
import type { ScatterInstance } from '../scatter';
import { pointAt, sampleAt } from './alignment';
import type { NetField } from './field';
import {
  BARRIER_OFF,
  barrierPlan,
  JERSEY_END,
  JERSEY_H,
  PARAPET_H,
  PARAPET_IN,
  PARAPET_OUT,
  parapetRuns,
  pierClear,
} from './mesh';
import {
  DECK_DEPTH,
  type Network,
  runsOf,
  ST_DECK,
  ST_GROUND,
  WALL_CUT,
  WALL_FILL,
  WALL_NONE,
  type Way,
  worldT,
} from './network';

/**
 * What the v2 template elements put along the roads: street lamps on the sidewalks, trees in the tree lawns / pits,
 * parked cars in the parking lanes, traffic signals at signalled junctions - as fixed scatter instances - and the solid
 * parts: barriers, deck parapets, retaining walls and piers as box colliders. Pure (the world tests run it).
 */

const yawAlong = (dx: number, dz: number): number => -Math.atan2(dz, dx);
const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);
/** Nothing parked / planted this close to a junction polygon (m). */
const JUNCTION_GAP = 8;
const CAR_SLOT = 6.4;

interface Fr {
  x: number;
  z: number;
  tx: number;
  tz: number;
  i: number;
  f: number;
}
function frameAt(w: Way, s: number): Fr {
  const p = pointAt(w.al, s, { x: 0, z: 0, tx: 0, tz: 0 });
  const i = sampleAt(w.al, s);
  const ds = w.al.s[i + 1] - w.al.s[i] || 1;
  return { ...p, i, f: Math.min(1, Math.max(0, (s - w.al.s[i]) / ds)) };
}

/** Lateral position (m from the reference line) of the middle of the first element of `kind` on a side, or NaN. */
function elementMid(w: Way, side: 0 | 1, kind: string): [number, number] {
  let u = side === 0 ? w.sec.paveL : w.sec.paveR;
  for (const e of side === 0 ? w.sec.left : w.sec.right) {
    if (e.kind === kind) return [u + e.w / 2, e.w];
    u += e.w;
  }
  return [NaN, 0];
}

export function netInstances(
  net: Network,
  field: NetField,
  seed: number,
  blocked: (x: number, z: number, r: number) => boolean,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const put = (
    asset: string,
    variant: number,
    x: number,
    y: number,
    z: number,
    rotY: number,
    scale = 1,
  ) => out.push({ asset, variant, x, y, z, rotY, scale, tiltX: 0, tiltZ: 0 });
  // never on another road's pavement (a street running into the side of a wider one, an overlapping carriageway)
  // (at any level: a tree on a street's sidewalk must not stand over the parkway in the cut below it either)
  const onOther = (x: number, z: number, y: number, self: Way, pad: number) =>
    !!field.pavedByOther(x, z, y, self, pad, 100);
  for (const w of net.ways) {
    if (w.internal) continue;
    const rng = new Rng(hashString(w.id) ^ seed);
    const L = w.al.length;
    const from = w.cut0 + JUNCTION_GAP;
    const to = L - w.cut1 - JUNCTION_GAP;
    if (to - from < 4) continue;
    const ground = (k: number) => w.st[Math.min(w.al.n - 1, k)] === ST_GROUND;
    // street lamps: on the sidewalk's kerb side, alternating sides
    const tpl = w.tpl;
    if (tpl.lampEvery > 0) {
      let side: 0 | 1 = 0;
      for (
        let s = from + rng.range(0, tpl.lampEvery);
        s < to;
        s += tpl.lampEvery
      ) {
        const fr = frameAt(w, s);
        if (!ground(fr.i)) continue;
        if (tpl.lampSide === 'right') side = 1;
        let t: number;
        const sg = side === 0 ? 1 : -1;
        if (tpl.lampOff !== undefined) {
          // set back on the land past the pavement edge; not where a wall stands on that side
          if (w.wall[side][fr.i] !== WALL_NONE) continue;
          t = sg * ((side === 0 ? w.sec.paveL : w.sec.paveR) + tpl.lampOff);
        } else {
          let [mid, ew] = elementMid(w, side, 'sidewalk');
          if (Number.isNaN(mid)) [mid, ew] = elementMid(w, side, 'verge');
          if (Number.isNaN(mid)) continue;
          t = sg * (mid - ew / 2 + 0.45);
        }
        const x = fr.x + fr.tz * worldT(w, fr.i, fr.f, t);
        const z = fr.z - fr.tx * worldT(w, fr.i, fr.f, t);
        if (
          !blocked(x, z, 0.5) &&
          !onOther(x, z, net.surfaceAt(w, fr.i, fr.f, t), w, 0.5)
        ) {
          const top = field.top(x, z);
          // the arm (+Z) over the street
          put(
            tpl.lampAsset ?? 'street_lamp',
            0,
            x,
            top ? top.h : field.ground(x, z),
            z,
            yawToward(-fr.tz * sg, fr.tx * sg),
          );
        }
        side = side === 0 ? 1 : 0;
      }
    }
    // street trees: in the tree lawn, else a pit in a wide sidewalk
    if (tpl.treeEvery > 0)
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1;
        let [mid] = elementMid(w, side, 'lawn');
        let pit = false;
        if (Number.isNaN(mid)) {
          const [sm, sw] = elementMid(w, side, 'sidewalk');
          if (Number.isNaN(sm) || sw < 2.8) continue;
          mid = sm - sw / 2 + 0.9;
          pit = true;
        }
        for (
          let s = from + rng.range(2, tpl.treeEvery);
          s < to;
          s += tpl.treeEvery * rng.range(0.8, 1.3)
        ) {
          if (rng.chance(0.25)) continue;
          const fr = frameAt(w, s);
          if (!ground(fr.i)) continue;
          const t = sg * mid;
          const x = fr.x + fr.tz * worldT(w, fr.i, fr.f, t);
          const z = fr.z - fr.tx * worldT(w, fr.i, fr.f, t);
          if (blocked(x, z, 1.2)) continue;
          if (onOther(x, z, net.surfaceAt(w, fr.i, fr.f, t), w, 1.0)) continue;
          const top = field.top(x, z);
          const y = top ? top.h : field.ground(x, z);
          if (pit) put('tree_pit', 0, x, y + 0.005, z, yawAlong(fr.tx, fr.tz));
          out.push({
            asset: 'oak_tree',
            variant: rng.int(0, 3),
            x,
            y,
            z,
            rotY: rng.range(0, Math.PI * 2),
            scale: rng.range(0.45, 0.8),
            tiltX: 0,
            tiltZ: 0,
          });
        }
      }
    // parked cars in the parking lanes (facing the traffic of their side)
    if (tpl.parked > 0)
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1;
        const pave = side === 0 ? w.sec.paveL : w.sec.paveR;
        // the parking lane is the outermost pavement strip of the side
        const lanesW = w.sec.oneway
          ? (w.sec.lanesF * tpl.laneW) / 2
          : side === 0
            ? w.sec.lanesB * tpl.laneW
            : w.sec.lanesF * tpl.laneW;
        if (pave - lanesW < tpl.parkW - 0.1) continue;
        const t = sg * (pave - tpl.parkW / 2 - 0.05);
        const dir = w.sec.oneway ? 1 : sg > 0 ? -1 : 1;
        for (let s = from + rng.range(0, CAR_SLOT); s < to - 2; s += CAR_SLOT) {
          if (!rng.chance(tpl.parked)) continue;
          const fr = frameAt(w, s);
          if (!ground(fr.i)) continue;
          const x = fr.x + fr.tz * worldT(w, fr.i, fr.f, t);
          const z = fr.z - fr.tx * worldT(w, fr.i, fr.f, t);
          if (blocked(x, z, 1.4)) continue;
          const y = net.surfaceAt(w, fr.i, fr.f, t);
          if (onOther(x, z, y, w, 1.2)) continue;
          const yaw = yawAlong(fr.tx * dir, fr.tz * dir);
          if (rng.chance(0.06)) put('taxi', 0, x, y, z, yaw);
          else put('street_car', rng.int(0, 11), x, y, z, yaw);
        }
      }
  }
  // traffic signals: at junctions with an OSM signal node, one per incoming arm at its right-hand kerb
  for (const j of net.junctions) {
    if (j.plaza || !j.nodes.some((n) => n.flags & 1)) continue;
    for (const a of j.arms) {
      const w = a.way;
      if (w.tpl.kerbH <= 0) continue;
      if (w.sec.oneway && !a.atEnd) continue;
      // incoming traffic drives towards the node; its right is the arm's left (looking out of the junction), on the
      // way's own line (a short curved street drifts off a straight one from the node)
      const s = a.atEnd ? w.al.length - a.cut - 1 : a.cut + 1;
      if (s < 0 || s > w.al.length) continue;
      const fr = frameAt(w, s);
      const sg = a.atEnd ? -1 : 1;
      const lw = worldT(w, fr.i, fr.f, sg * (a.hwL + 0.6));
      const x = fr.x + fr.tz * lw;
      const z = fr.z - fr.tx * lw;
      const dx = sg * fr.tx;
      const dz = sg * fr.tz;
      if (blocked(x, z, 0.4)) continue;
      const top = field.top(x, z);
      const y = top ? top.h : field.ground(x, z);
      // (never on another road's pavement: an arm's kerb corner inside the next arm's lanes)
      if (onOther(x, z, y, w, 0.4)) continue;
      // the arm (+Z) over the lanes coming in
      put('traffic_signal', 0, x, y, z, yawToward(-dz, dx));
    }
  }
  return out;
}

function boxAlong(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y: number,
  h: number,
  thick: number,
): StaticCollider | undefined {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return undefined;
  const hx = len / 2 + 0.05;
  const hz = thick / 2;
  return {
    kind: 'box',
    x: (ax + bx) / 2,
    z: (az + bz) / 2,
    y,
    h,
    hx,
    hz,
    rot: -Math.atan2(dz, dx),
    r: Math.hypot(hx, hz),
  };
}

/** Solid parts of the network: barriers, deck parapets, retaining walls, piers. */
export function netColliders(net: Network, field: NetField): StaticCollider[] {
  const out: StaticCollider[] = [];
  const push = (c: StaticCollider | undefined) => c && out.push(c);
  const along = (
    w: Way,
    s0: number,
    s1: number,
    t: number,
    h: number,
    thick: number,
    base: (fr: Fr) => number,
  ) => {
    for (let s = s0; s < s1 - 0.01; s += 3) {
      const e = Math.min(s1, s + 3);
      const a = frameAt(w, s);
      const b = frameAt(w, e);
      const y = Math.min(base(a), base(b)) - 0.1;
      // never solid through another road's pavement (a bore wall's end under the parkway above it): any pavement of
      // another way from the piece's foot up to its top
      const tm = worldT(w, a.i, a.f, t);
      const mx = (a.x + b.x) / 2 + ((a.tz + b.tz) / 2) * tm;
      const mz = (a.z + b.z) / 2 - ((a.tx + b.tx) / 2) * tm;
      if (field.pavedByOther(mx, mz, y + h / 2, w, 0.3, h / 2 + 0.6)) continue;
      push(
        boxAlong(
          a.x + a.tz * worldT(w, a.i, a.f, t),
          a.z - a.tx * worldT(w, a.i, a.f, t),
          b.x + b.tz * worldT(w, b.i, b.f, t),
          b.z - b.tx * worldT(w, b.i, b.f, t),
          y,
          h + 0.1,
          thick,
        ),
      );
    }
  };
  for (const w of net.ways) {
    if (w.internal) continue;
    // barriers
    for (const side of [0, 1] as const) {
      const sg = side === 0 ? 1 : -1;
      const t = sg * ((side === 0 ? w.sec.paveL : w.sec.paveR) + BARRIER_OFF);
      for (const { kind, runs } of barrierPlan(net, field, w, side))
        for (const [s0, s1] of runs) {
          // (a Jersey's free end turns down into the ground: its low last metres are no wall, mesh.ts JERSEY_END)
          const cut = kind === 'jersey' ? JERSEY_END * 0.6 : 0;
          const a = s0 > w.cut0 + 1 ? s0 + cut : s0;
          const b = s1 < w.al.length - w.cut1 - 1 ? s1 - cut : s1;
          if (b - a < 0.5) continue;
          along(
            w,
            a,
            b,
            t,
            kind === 'jersey' ? JERSEY_H : 0.8,
            kind === 'jersey' ? 0.6 : 0.25,
            (fr) => net.surfaceAt(w, fr.i, fr.f, t),
          );
        }
    }
    // deck parapets
    for (const [i0, i1] of runsOf(w.st, ST_DECK))
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1;
        const foot = side === 0 ? w.sec.footL : w.sec.footR;
        const t = sg * (foot + (PARAPET_IN + PARAPET_OUT) / 2);
        for (const [s0, s1] of parapetRuns(net, field, w, side, i0, i1))
          along(w, s0, s1, t, PARAPET_H, PARAPET_OUT - PARAPET_IN, (fr) =>
            net.surfaceAt(w, fr.i, fr.f, sg * foot),
          );
      }
    // retaining walls: the face is solid (the land steps up behind it only after the setback)
    for (const side of [0, 1] as const) {
      const sg = side === 0 ? 1 : -1;
      const foot = side === 0 ? w.sec.footL : w.sec.footR;
      const t = sg * (foot + w.tpl.daylight.wallOffset + 0.3);
      for (const kind of [WALL_CUT, WALL_FILL])
        for (const [i0, i1] of runsOf(w.wall[side], kind)) {
          const s0 = w.al.s[i0];
          const s1 = w.al.s[i1];
          const lane = w.wallLane[side][i0] === 1;
          along(
            w,
            s0,
            s1,
            lane ? t - sg * 0.17 : t,
            kind === WALL_CUT ? 3 : PARAPET_H,
            lane ? 0.26 : 0.6,
            (fr) => net.surfaceAt(w, fr.i, fr.f, sg * foot),
          );
        }
    }
    // piers (same rule as the mesh)
    for (const [i0, i1] of runsOf(w.st, ST_DECK)) {
      const s0 = Math.max(w.cut0, w.al.s[i0]);
      const s1 = Math.min(w.al.length - w.cut1, w.al.s[i1]);
      const len = s1 - s0;
      if (len <= 28) continue;
      const n = Math.round(len / 24);
      for (let k = 1; k < n; k++) {
        const s = s0 + (len * k) / n;
        const fr = frameAt(w, s);
        const y = net.surfaceAt(w, fr.i, fr.f, 0);
        const g = field.ground(fr.x, fr.z);
        if (y - DECK_DEPTH - g < 1.5) continue;
        const half = Math.min(
          2.5,
          (w.sec.footL + w.sec.footR + 2 * PARAPET_OUT) * 0.3,
        );
        if (!pierClear(field, w, fr, half, y - DECK_DEPTH)) continue;
        push({
          kind: 'box',
          x: fr.x,
          z: fr.z,
          y: g - 0.3,
          h: y - DECK_DEPTH - g + 0.3,
          hx: 0.7,
          hz: half,
          rot: -Math.atan2(fr.tz, fr.tx),
          r: Math.hypot(0.7, half),
        });
      }
    }
  }
  // park fountains: the basin rim (v2/mesh.ts `fountain`)
  for (const pk of net.parks)
    for (const f of pk.fountains)
      out.push({
        kind: 'cylinder',
        x: f.x,
        z: f.z,
        y: field.ground(f.x, f.z) - 0.3,
        r: f.r,
        h: 0.9,
      });
  return out;
}
