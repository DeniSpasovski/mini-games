import type { MapDef } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import type { Road, RoadSample } from './road';

/**
 * Stage furniture of every map, derived from `StageDef` (no per-map props needed): the start and
 * finish gantries and a pair of split boards beside the
 * road at every split (the sector markings of a real stage). Pure (no three.js scene) so the world
 * tests can run it; stage-sign-mesh.ts draws it.
 */

export interface StageLayoutLike {
  start: number;
  finish: number;
  splits: number[];
}

export interface GantryPlan {
  kind: 'start' | 'finish';
  along: number;
  /** Lateral distance of each pillar centre from the road centre line (m). */
  half: number;
  /** How far the ground at the left / right pillar is below the road centre (m, + = lower). */
  drop: [left: number, right: number];
}

export interface BoardPlan {
  /** 1-based split number. */
  split: number;
  along: number;
  /** +1 = left of travel, -1 = right. */
  side: 1 | -1;
  /** Lateral distance of the board centre from the road centre line (m). */
  lateral: number;
  /** Ground below the road centre height at the board (m, + = lower). */
  drop: number;
  /** Distance from the start line (m). */
  distance: number;
}

export interface StageSigns {
  gantries: GantryPlan[];
  boards: BoardPlan[];
  colliders: StaticCollider[];
}

/** Gantry pillars stand at least this far outside the road edge, split boards this far. */
const PILLAR_CLEAR = 1.8;
const BOARD_CLEAR = 3;
/** Narrowest gantry (pillar centre to the road centre line, m). */
const MIN_HALF = 4.8;
export const PILLAR_RADIUS = 0.55;
/** Split board (temporary A-frame): its front panel turns this far from the road direction towards the road. */
export const BOARD_TURN = (35 * Math.PI) / 180;
/** Panel size (m): the board texture is 2 : 3. Panels lean by BOARD_LEAN from the ridge. */
export const BOARD_W = 1;
export const BOARD_H = 1.5;
export const BOARD_LEAN = (14 * Math.PI) / 180;

/** Yaw (about Y, road-local frame) of the front panel of the A-frame on `side`: faces the oncoming driver and the road. */
export const boardYaw = (side: 1 | -1): number =>
  Math.atan2(-side * Math.sin(BOARD_TURN), -Math.cos(BOARD_TURN));

/** World position of a road-local point: `lat` metres left of the centre line, `fwd` metres ahead. */
export function roadLocal(
  s: RoadSample,
  lat: number,
  fwd = 0,
): { x: number; z: number } {
  // left = (tz, -tx), forward = (tx, tz)
  return { x: s.x + s.tx * fwd + s.tz * lat, z: s.z + s.tz * fwd - s.tx * lat };
}

/** Lateral distance (from the centre line) beyond the barriers that run on `side` at `along`. */
function clearance(
  map: MapDef,
  s: RoadSample,
  side: 1 | -1,
  edgeGap: number,
): number {
  let lat = s.halfWidth + edgeGap;
  for (const b of map.barriers ?? []) {
    if (b.side !== 'both' && b.side !== (side === 1 ? 'left' : 'right'))
      continue;
    if (s.dist < (b.from ?? 0) || s.dist > (b.to ?? Infinity)) continue;
    lat = Math.max(lat, s.halfWidth + b.offset + 0.9);
  }
  return lat;
}

export function stageSigns(
  map: MapDef,
  road: Road,
  ground: TerrainSampler,
  stage: StageLayoutLike,
): StageSigns {
  const out: StageSigns = { gantries: [], boards: [], colliders: [] };
  const dropAt = (s: RoadSample, lat: number): number => {
    const p = roadLocal(s, lat);
    return s.y - ground.height(p.x, p.z);
  };
  const cyl = (x: number, z: number, r: number, h: number): StaticCollider => ({
    kind: 'cylinder',
    x,
    y: ground.height(x, z) - 0.2,
    z,
    r,
    h,
  });

  for (const [kind, along] of [
    ['start', stage.start],
    ['finish', stage.finish],
  ] as const) {
    const s = road.at(along);
    const half = Math.max(
      MIN_HALF,
      clearance(map, s, 1, PILLAR_CLEAR),
      clearance(map, s, -1, PILLAR_CLEAR),
    );
    out.gantries.push({
      kind,
      along,
      half,
      drop: [dropAt(s, half), dropAt(s, -half)],
    });
    for (const lat of [half, -half]) {
      const p = roadLocal(s, lat);
      out.colliders.push(cyl(p.x, p.z, PILLAR_RADIUS, 6.2));
    }
  }

  stage.splits.forEach((along, i) => {
    const s = road.at(along);
    for (const side of [1, -1] as const) {
      const lateral = clearance(map, s, side, BOARD_CLEAR);
      const p = roadLocal(s, side * lateral);
      out.boards.push({
        split: i + 1,
        along,
        side,
        lateral,
        drop: s.y - ground.height(p.x, p.z),
        distance: along - stage.start,
      });
      // The A-frame stands on a footprint of BOARD_W x (2 H sin lean), yawed like the board.
      const yaw = boardYaw(side);
      const hz = BOARD_H * Math.sin(BOARD_LEAN);
      out.colliders.push({
        kind: 'box',
        x: p.x,
        z: p.z,
        y: ground.height(p.x, p.z) - 0.1,
        h: BOARD_H,
        hx: BOARD_W / 2,
        hz,
        // road-local yaw + the road heading (three.js: rotation about +Y)
        rot: yaw + Math.atan2(s.tx, s.tz),
        r: Math.hypot(BOARD_W / 2, hz),
      });
    }
  });
  return out;
}
