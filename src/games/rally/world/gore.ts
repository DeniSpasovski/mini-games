import { newRoadQuery, type Road } from './road';
import type { PathNetwork } from './real-data';
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

export function goreWedges(road: Road, net: PathNetwork): GoreWedge[] {
  const out: GoreWedge[] = [];
  const rq = newRoadQuery();
  const rq2 = newRoadQuery();
  const c = { x: 0, z: 0 };
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  net.paths.forEach((p, pi) => {
    if (!p.kind.endsWith('_link') || p.bridge || p.surface !== 'tarmac') return;
    const L = net.lengths[pi];
    if (L < 20) return;
    for (const atEnd of [false, true]) {
      net.pointAt(pi, atEnd ? L : 0, c);
      road.query(c.x, c.z, rq);
      // The ramp end was extended under the stage road by `connectPaths`.
      if (!rq.found || rq.distance > rq.halfWidth + 1.5) continue;
      if (road.bridgeAt(rq.along)) continue;
      // A ramp meeting the stage road's very start / end continues it (lead-in), it does not merge.
      if (rq.along < 1 || rq.along > road.length - 1) continue;
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
        road.query(c.x, c.z, rq);
        if (!rq.found) break;
        // The ramp's own normal, towards the stage road.
        const sr = road.at(rq.along);
        const towards = -Math.sign(rq.lateral || 1);
        let nx = tz;
        let nz = -tx;
        if (nx * sr.tz * towards + nz * -sr.tx * towards < 0) {
          nx = -nx;
          nz = -nz;
        }
        const hw = net.halfWidthAt(pi, d);
        const ex = c.x + nx * hw;
        const ez = c.z + nz * hw;
        road.query(ex, ez, rq2);
        if (!rq2.found) break;
        const gap = rq2.distance - rq2.halfWidth;
        if (gap > MAX_GAP) {
          wide = true;
          break;
        }
        if (gap < MIN_GAP) {
          // Still overlapping the road (before the nose): the wedge has not started.
          if (rows.length) break;
          continue;
        }
        const s2 = road.at(rq2.along);
        const lat = Math.sign(rq2.lateral || 1) * rq2.halfWidth;
        const rx = s2.x + s2.tz * lat;
        const rz = s2.z - s2.tx * lat;
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
        rows.push({
          ax: rx,
          az: rz,
          bx: ex,
          bz: ez,
          t,
        });
      }
      if (rows.length >= 4) out.push({ path: pi, rows, wide });
    }
  });
  return out;
}

/** A crash cushion at the wide nose of every wedge, facing the narrow end (the traffic splits / merges there). */
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
    const mx = (a.ax + a.bx) / 2 + dx * 2.9;
    const mz = (a.az + a.bz) / 2 + dz * 2.9;
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
