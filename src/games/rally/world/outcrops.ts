import { Vector3 } from 'three';
import type { Rng } from '../../../shared/rng';
import type { ScatterRule } from '../maps/shared/types';
import type { TerrainSampler } from './heightfield';
import type { ScatterInstance } from './scatter';

/**
 * Rock bands breaking out of steep hillsides (scatter rules with `outcrop`, asset `rock_outcrop`): each accepted
 * scatter point grows a row of pieces along the contour, every piece upright with its face (+Z) looking down the slope,
 * leant back into the hill and its open back buried in it; the row ends where the ground leaves the rule's
 * `minSlope` / `maxSlope` (or the next piece would leave the chunk, the road margin or the scatter area: `ok`). The pieces step
 * down / up with the ground, overlap a little and wander off the contour line, so a band reads as broken ledges.
 */
export function outcropRow(
  rule: ScatterRule,
  x: number,
  z: number,
  scale: number,
  variants: number,
  rng: Rng,
  ground: TerrainSampler,
  ok: (x: number, z: number) => boolean,
  out: ScatterInstance[],
): void {
  const o = rule.outcrop!;
  const pieces = rng.int(o.pieces[0], o.pieces[1]);
  const step = (o.step ?? 2.6) * scale;
  // Both ways from the seed point along the contour, alternately, so the row grows round it.
  const left = { x, z, live: true };
  const right = { x, z, live: true };
  for (let k = 0; k < pieces; k++) {
    const end = k === 0 ? left : k % 2 ? right : left;
    if (!end.live) continue;
    const n = ground.normal(end.x, end.z, _n);
    // Down the slope (the normal leans that way); the contour is square to it.
    const h = Math.hypot(n.x, n.z) || 1;
    const dx = n.x / h;
    const dz = n.z / h;
    if (k > 0) {
      const s = (k % 2 ? 1 : -1) * step * rng.range(0.8, 1.05);
      const nx = end.x - dz * s;
      const nz = end.z + dx * s;
      const slope = 1 - ground.normal(nx, nz, _n).y;
      if (
        slope < (rule.minSlope ?? 0) ||
        slope > (rule.maxSlope ?? 1) ||
        !ok(nx, nz)
      ) {
        end.live = false;
        continue;
      }
      end.x = nx;
      end.z = nz;
    }
    // Off the line a little (up or down the slope) and the piece's own size and turn.
    const off = rng.range(-0.35, 0.35) * step;
    const px = end.x + dx * off;
    const pz = end.z + dz * off;
    const nn = ground.normal(px, pz, _n);
    const hh = Math.hypot(nn.x, nn.z) || 1;
    const k2 = scale * rng.range(0.75, 1.15);
    out.push({
      asset: rule.asset,
      variant: Math.floor(rng.next() * variants),
      x: px,
      y: ground.height(px, pz) - (rule.sink ?? 0) * k2,
      z: pz,
      rotY: Math.atan2(nn.x / hh, nn.z / hh) + rng.range(-0.25, 0.25),
      scale: k2,
      // Leant back into the hill by a share of the slope's angle (negative x tilt = the top towards -Z, uphill).
      tiltX: -Math.acos(Math.min(1, nn.y)) * (o.lean ?? 0.35),
      tiltZ: rng.range(-0.05, 0.05),
    });
  }
}

const _n = new Vector3();
