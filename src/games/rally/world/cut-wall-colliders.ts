import type { RoadDef } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { Road } from './road';
import { cutShape, type TerrainGenerator } from './terrain-gen';

/** Walls lower than this are not built (the terrain slope reads fine) (m). */
export const CUT_MIN_H = 0.9;
/** Metres of road between the points of the wall line. */
const STEP = 2;
/** Thickness of the wall (m): the collider stands behind the face. */
const THICK = 0.4;

/**
 * The stage road's `solid` retaining walls (RoadDef.cutWalls) as box colliders, one per 2 m of road along each wall
 * face, so a car stops at the wall instead of riding up the terrain's sheer cut. The face stands where
 * cut-wall-mesh.ts puts it: on the wall line, pulled back to the margin in front of where the land is seen to rise.
 */
export function cutWallColliders(
  road: Road,
  gen: TerrainGenerator,
  def: RoadDef,
): StaticCollider[] {
  const cw = def.cutWalls;
  if (!cw?.solid) return [];
  const shape = cutShape(true);
  const out: StaticCollider[] = [];
  const from = Math.max(0, (cw.range?.[0] ?? 0) - STEP);
  const to = Math.min(road.length, (cw.range?.[1] ?? road.length) + STEP);
  for (const side of [1, -1] as const) {
    let prev: { x: number; z: number; y: number; top: number } | undefined;
    for (let d = from; d <= to + 1e-6; d += STEP) {
      const s = road.at(d);
      let face: typeof prev;
      if (!road.bridgeAt(d)) {
        let lat = side * (s.halfWidth + def.shoulder + cw.offset - 0.05);
        const lq = lat + side * (shape.setback + shape.rise + shape.over + 0.1);
        const h = gen.height(s.x + s.tz * lq, s.z - s.tx * lq);
        const w = gen.cutWeightAt(
          s.x + s.tz * lat,
          s.z - s.tx * lat,
          h - s.y,
          d,
          s.y,
        );
        if (h - s.y > CUT_MIN_H && w > 0.6) {
          for (let l = s.halfWidth + 0.3; l < Math.abs(lq) + 1; l += 0.25) {
            const hx = gen.height(s.x + s.tz * l * side, s.z - s.tx * l * side);
            if (hx - s.y > 0.8) {
              lat = side * Math.max(s.halfWidth + 0.3, l - shape.margin);
              break;
            }
          }
          // The body of the wall: behind its face.
          const c = lat + side * (THICK / 2);
          face = {
            x: s.x + s.tz * c,
            z: s.z - s.tx * c,
            y: s.y - 0.2,
            top: h,
          };
        }
      }
      if (prev && face) {
        const dx = face.x - prev.x;
        const dz = face.z - prev.z;
        const len = Math.hypot(dx, dz);
        const y = Math.min(prev.y, face.y);
        const hx = len / 2 + 0.05;
        out.push({
          kind: 'box',
          x: (prev.x + face.x) / 2,
          z: (prev.z + face.z) / 2,
          y,
          h: Math.max(prev.top, face.top) - y + 0.3,
          hx,
          hz: THICK / 2,
          rot: -Math.atan2(dz, dx),
          r: Math.hypot(hx, THICK / 2),
        });
      }
      prev = face;
    }
  }
  return out;
}
