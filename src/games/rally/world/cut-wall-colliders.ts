import type { RoadDef } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import { newRoadQuery, type Road } from './road';
import { rockCutSection } from './rock-cut-section';
import {
  cutShape,
  WALL_FACE,
  WALL_THICK,
  type TerrainGenerator,
} from './terrain-gen';

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

/**
 * The low masonry retaining walls of the rock cuts (RoadDef.rockCuts `walls`) as box colliders, one per 2 m of road: the
 * stone stands where rock-cut-mesh.ts draws it (`offset` + `WALL_FACE` past the road edge), from under the ground at its
 * face to over its top, so a car stops at the face instead of nosing into it up the terrain behind.
 */
export function retainingWallColliders(
  road: Road,
  gen: TerrainGenerator,
  def: RoadDef,
): StaticCollider[] {
  const out: StaticCollider[] = [];
  for (const w of def.rockCuts?.walls ?? []) {
    const n = Math.max(1, Math.round((w.to - w.from) / STEP));
    const edge = (d: number) => {
      const s = road.at(d);
      // (from the face to well behind the coping: the bank behind is the terrain's own)
      const c = w.side * (s.halfWidth + w.offset + WALL_FACE + WALL_THICK);
      const f = w.side * (s.halfWidth + w.offset + WALL_FACE);
      return {
        x: s.x + s.tz * c,
        z: s.z - s.tx * c,
        foot: gen.height(s.x + s.tz * f, s.z - s.tx * f),
        top: gen.wallTop(d, w.side)?.top ?? s.y,
      };
    };
    let prev = edge(w.from);
    for (let i = 1; i <= n; i++) {
      const cur = edge(w.from + ((w.to - w.from) * i) / n);
      const dx = cur.x - prev.x;
      const dz = cur.z - prev.z;
      const len = Math.hypot(dx, dz);
      const top = Math.max(prev.top, cur.top);
      const y = Math.min(prev.foot, cur.foot) - 0.5;
      // (only where the stone stands over the ground at its face: the drawn wall's ends sink into the bank)
      if (len > 0.05 && top - Math.min(prev.foot, cur.foot) > 0.4) {
        const hx = len / 2 + 0.05;
        out.push({
          kind: 'box',
          x: (prev.x + cur.x) / 2,
          z: (prev.z + cur.z) / 2,
          y,
          h: top + 0.3 - y,
          hx,
          hz: WALL_THICK,
          rot: -Math.atan2(dz, dx),
          r: Math.hypot(hx, WALL_THICK),
        });
      }
      prev = cur;
    }
  }
  return out;
}

/** How high over the road a rock face's colliders reach (m): past that the carved terrain stops a car. */
const FACE_REACH = 3;
/** Depth of a rock face's colliders behind its foot (m). */
const FACE_DEPTH = 1;

/**
 * The rock faces of the stage road's natural cuts (RoadDef.rockCuts) as box colliders, one per 2 m of face: the drawn
 * rock stands at the face's foot line (rock-cut-section.ts `lo`) and proud of the carve, which alone let a car's body
 * into it. From under the road to `FACE_REACH` m over it; the retaining walls are `retainingWallColliders`.
 */
export function rockFaceColliders(
  road: Road,
  gen: TerrainGenerator,
  def: RoadDef,
): StaticCollider[] {
  if (!def.rockCuts) return [];
  const rq = newRoadQuery();
  const out: StaticCollider[] = [];
  for (const side of [1, -1] as const) {
    let prev: { x: number; z: number; y: number } | undefined;
    for (let d = 0; d <= road.length; d += STEP) {
      // (outside the listed `stretches` there is no rock face: only the walls, `retainingWallColliders`)
      const sec =
        road.bridgeAt(d) ||
        (def.rockCuts.stretches && !gen.rockCutStretch(d, side))
          ? null
          : rockCutSection(road, gen, d, side, rq);
      let face: typeof prev;
      if (sec && !sec.wall) {
        const c = sec.lo + side * (FACE_DEPTH / 2);
        face = {
          x: sec.x + sec.tz * c,
          z: sec.z - sec.tx * c,
          y: road.at(d).y,
        };
      }
      if (prev && face) {
        const dx = face.x - prev.x;
        const dz = face.z - prev.z;
        const len = Math.hypot(dx, dz);
        const y = Math.min(prev.y, face.y) - 0.5;
        const hx = len / 2 + 0.05;
        out.push({
          kind: 'box',
          x: (prev.x + face.x) / 2,
          z: (prev.z + face.z) / 2,
          y,
          h: Math.max(prev.y, face.y) + FACE_REACH - y,
          hx,
          hz: FACE_DEPTH / 2,
          rot: -Math.atan2(dz, dx),
          r: Math.hypot(hx, FACE_DEPTH / 2),
        });
      }
      prev = face;
    }
  }
  return out;
}
