import { newRoadQuery, type Road } from './road';
import { newPathQuery, type PathNetwork } from './real-data';
import type { ScatterInstance } from './scatter';

/**
 * Gore areas: where a ramp (`*_link`) leaves or joins the stage road at a shallow angle, the strip between the road
 * edge and the ramp's near edge is paved and painted with diagonal hatching inside two edge lines (the wedge a driver
 * must not drive on). `goreWedges` finds them from the road network (pure, the world tests run it); `gore-mesh.ts` drapes
 * one textured strip per wedge over the terrain.
 */

/** Walk along the ramp this far from the road (m) and the row spacing. */
const REACH = 100;
const STEP = 2;
/** The wedge starts where the gap between the two edges reaches MIN_GAP and ends beyond MAX_GAP (m). */
const MIN_GAP = 0.4;
const MAX_GAP = 7;
/** Texture repeat along the wedge (m). */
export const GORE_TILE = 5;

export interface GoreRow {
  /** On the stage road's edge. */
  ax: number;
  az: number;
  /** On the ramp's edge nearest to the road. */
  bx: number;
  bz: number;
  /** Distance along the ramp from the junction. */
  t: number;
}

export interface GoreWedge {
  path: number;
  rows: GoreRow[];
  /** The edges drifted fully apart (the wedge ends in its wide nose), not cut short by the reach limit. */
  wide: boolean;
}

/** The edge a ramp splits from / merges into: the stage road or a carriageway of the path network. */
interface Ref {
  /** Nearest point of the reference to (x, z): `lateral` is + to the left of its travel direction. */
  at(
    x: number,
    z: number,
  ):
    | {
        distance: number;
        halfWidth: number;
        lateral: number;
        /** Centre point and unit direction of the reference there. */
        x: number;
        z: number;
        tx: number;
        tz: number;
      }
    | undefined;
}

/** The wedge of ramp `pi` at one of its ends against `ref` (undefined when the edges never open into a wedge). */
function wedgeAt(
  net: PathNetwork,
  pi: number,
  atEnd: boolean,
  ref: Ref,
): GoreWedge | undefined {
  const L = net.lengths[pi];
  const c = { x: 0, z: 0 };
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  const rows: GoreRow[] = [];
  let wide = false;
  for (let t = STEP; t <= REACH; t += STEP) {
    const d = atEnd ? L - t : t;
    if (d < 1.5 || d > L - 1.5) break;
    net.pointAt(pi, d - 1.5, a);
    net.pointAt(pi, d + 1.5, b);
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / tl;
    const tz = (b.z - a.z) / tl;
    net.pointAt(pi, d, c);
    const r = ref.at(c.x, c.z);
    if (!r) break;
    // The ramp's own normal, towards the reference.
    const towards = -Math.sign(r.lateral || 1);
    let nx = tz;
    let nz = -tx;
    if (nx * r.tz * towards + nz * -r.tx * towards < 0) {
      nx = -nx;
      nz = -nz;
    }
    const hw = net.halfWidthAt(pi, d);
    const ex = c.x + nx * hw;
    const ez = c.z + nz * hw;
    const e = ref.at(ex, ez);
    if (!e) break;
    const gap = e.distance - e.halfWidth;
    if (gap > MAX_GAP) {
      wide = true;
      break;
    }
    if (gap < MIN_GAP) {
      // Still overlapping the road (before the nose): the wedge has not started.
      if (rows.length) break;
      continue;
    }
    const lat = Math.sign(e.lateral || 1) * e.halfWidth;
    const rx = e.x + e.tz * lat;
    const rz = e.z - e.tx * lat;
    // The nose: the wedge starts as a point one step back along the ramp's direction.
    if (!rows.length) {
      const k = atEnd ? STEP : -STEP;
      rows.push({
        ax: rx + tx * k * 0.9,
        az: rz + tz * k * 0.9,
        bx: rx + tx * k * 0.9,
        bz: rz + tz * k * 0.9,
        t: t - STEP,
      });
    }
    rows.push({ ax: rx, az: rz, bx: ex, bz: ez, t });
  }
  return rows.length >= 4 ? { path: pi, rows, wide } : undefined;
}

/**
 * Wedges at the stage road, and - with `pathsFromX` - where a ramp leaves / joins a carriageway of the network
 * (`motorway` paths, the interchange imported east of the finish) on paths whose middle lies east of that x.
 */
export function goreWedges(
  road: Road,
  net: PathNetwork,
  pathsFromX?: number,
): GoreWedge[] {
  const out: GoreWedge[] = [];
  const rq = newRoadQuery();
  const c = { x: 0, z: 0 };
  const stage: Ref = {
    at(x, z) {
      road.query(x, z, rq);
      if (!rq.found) return undefined;
      const s = road.at(rq.along);
      return {
        distance: rq.distance,
        halfWidth: rq.halfWidth,
        lateral: rq.lateral,
        x: s.x,
        z: s.z,
        tx: s.tx,
        tz: s.tz,
      };
    },
  };
  const pq = newPathQuery();
  const p0 = { x: 0, z: 0 };
  const p1 = { x: 0, z: 0 };
  const qp = { x: 0, z: 0 };
  net.paths.forEach((p, pi) => {
    if (!p.kind.endsWith('_link') || p.bridge || p.surface !== 'tarmac') return;
    const L = net.lengths[pi];
    if (L < 20) return;
    for (const atEnd of [false, true]) {
      net.pointAt(pi, atEnd ? L : 0, c);
      road.query(c.x, c.z, rq);
      // The ramp end was extended under the stage road by `connectPaths`.
      if (rq.found && rq.distance <= rq.halfWidth + 1.5) {
        if (road.bridgeAt(rq.along)) continue;
        // A ramp meeting the stage road's very start / end continues it (lead-in), it does not merge.
        if (rq.along < 1 || rq.along > road.length - 1) continue;
        const w = wedgeAt(net, pi, atEnd, stage);
        if (w) out.push(w);
        continue;
      }
      if (pathsFromX === undefined || !pathsFromX) continue;
      let mx = 0;
      for (let k = 0; k < p.pts.length; k += 2) mx += p.pts[k];
      if (mx / (p.pts.length / 2) < pathsFromX) continue;
      // A carriageway of the network the ramp end lies on.
      net.query(
        c.x,
        c.z,
        pq,
        'tarmac',
        (qi) =>
          qi !== pi &&
          net.paths[qi].kind === 'motorway' &&
          !net.paths[qi].bridge,
      );
      if (!pq.found || pq.distance > pq.halfWidth + 1.5) continue;
      const qi = pq.path;
      const ref: Ref = {
        at(x, z) {
          net.query(x, z, pq, 'tarmac', (k) => k === qi);
          if (!pq.found) return undefined;
          const Lq = net.lengths[qi];
          net.pointAt(qi, pq.along, qp);
          net.pointAt(qi, Math.max(0, pq.along - 1.5), p0);
          net.pointAt(qi, Math.min(Lq, pq.along + 1.5), p1);
          const tl = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
          const tx = (p1.x - p0.x) / tl;
          const tz = (p1.z - p0.z) / tl;
          return {
            distance: pq.distance,
            halfWidth: net.halfWidthAt(qi, pq.along),
            lateral: (x - qp.x) * tz - (z - qp.z) * tx,
            x: qp.x,
            z: qp.z,
            tx,
            tz,
          };
        },
      };
      const w = wedgeAt(net, pi, atEnd, ref);
      if (w) out.push(w);
    }
  });
  return out;
}

/** A crash cushion at the wide nose of every wedge, facing the narrow end (the traffic splits / merges there). */
/** The crash cushion stands this far out from the road edge (m): in front of the barrier, which starts at the nose. */
const CUSHION_OUT = 1.1;

/** (x, z) lies on the hatched strip of a wedge (between the road edge and the ramp edge, junction to nose). */
export function inGore(
  wedges: readonly GoreWedge[],
  x: number,
  z: number,
): boolean {
  for (const w of wedges) {
    const r = w.rows;
    for (let i = 0; i + 1 < r.length; i++) {
      const q = [
        r[i].ax,
        r[i].az,
        r[i].bx,
        r[i].bz,
        r[i + 1].bx,
        r[i + 1].bz,
        r[i + 1].ax,
        r[i + 1].az,
      ];
      let inside = false;
      for (let k = 0, j = 3; k < 4; j = k++) {
        const xi = q[k * 2];
        const zi = q[k * 2 + 1];
        const xj = q[j * 2];
        const zj = q[j * 2 + 1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
          inside = !inside;
      }
      if (inside) return true;
    }
  }
  return false;
}

export function goreCushions(
  wedges: readonly GoreWedge[],
  height: (x: number, z: number) => number,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  for (const w of wedges) {
    if (!w.wide) continue;
    const a = w.rows[w.rows.length - 1];
    const b = w.rows[Math.max(0, w.rows.length - 4)];
    // Direction from the wide end towards the narrow end.
    let dx = b.ax - a.ax;
    let dz = b.az - a.az;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // on the barrier line by the road edge (the barrier starts behind it at the nose), not mid-gore
    const ox = a.bx - a.ax;
    const oz = a.bz - a.az;
    const ol = Math.hypot(ox, oz) || 1;
    const mx = a.ax + (ox / ol) * CUSHION_OUT + dx * 2.9;
    const mz = a.az + (oz / ol) * CUSHION_OUT + dz * 2.9;
    out.push({
      asset: 'crash_cushion',
      variant: 0,
      x: mx,
      y: height(mx, mz),
      z: mz,
      rotY: -Math.atan2(dz, dx),
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    });
  }
  return out;
}
