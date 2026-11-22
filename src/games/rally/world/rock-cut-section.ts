import type { RockLook } from '../maps/shared/types';
import type { Road, RoadQuery } from './road';
import type { TerrainGenerator } from './terrain-gen';

/** Lowest face that gets a ribbon (m). */
export const MIN_FACE = 1.4;
/** ... and of a retaining wall's (m). */
export const MIN_WALL = 0.6;

/** One cross-section of a face: the road point it belongs to, the lateral span of the face and its side. */
export interface Section {
  d: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Lateral offsets of the foot and the top of the face (signed: + = left of travel). */
  lo: number;
  hi: number;
  /** A low retaining wall (RoadDef.rockCuts `walls`), not rock. */
  wall: boolean;
  look: RockLook;
}

/**
 * The rock face across the stage road at `d` on side `s` (+1 left, -1 right): foot and top offsets, or null when there is
 * none (pure: the face mesh, rock-cut-mesh.ts, and its colliders, cut-wall-colliders.ts, share it).
 */
export function rockCutSection(
  road: Road,
  gen: TerrainGenerator,
  d: number,
  s: number,
  rq: RoadQuery,
): Section | null {
  const p = road.at(d);
  const lat = (l: number) => [p.x + p.tz * l * s, p.z - p.tx * l * s];
  const foot = gen.rockCutFoot(p.halfWidth, d, s);
  // Is this stretch a rock cut at all (the carve's own weight, half-way up a typical face)?
  const [mx, mz] = lat(foot + 2);
  if (gen.rockCutWeightAt(mx, mz, gen.naturalHeight(mx, mz) - p.y, d, s) < 0.5)
    return null;
  const wall = !!gen.rockCutWall(d, s);
  // March up the face to where the carve meets the land again (the natural slope above is not cut).
  const h = (l: number) => {
    const [x, z] = lat(l);
    return gen.height(x, z);
  };
  const below = (l: number) => {
    const [x, z] = lat(l);
    return gen.naturalHeight(x, z) - gen.height(x, z);
  };
  // March up while the ground is steep (a face) and still cut below the land.
  let top = foot;
  for (
    let k = 0;
    k < 40 &&
    below(top) > 0.3 &&
    (top < foot + 1.5 || h(top + 0.5) - h(top) > 0.4);
    k++
  )
    top += 0.5;
  // (a retaining wall stands down to a low bank: its face is only as tall as the land, terrain-gen `rockCutWeightAt`)
  if (h(top) - h(foot) < (wall ? MIN_WALL : MIN_FACE)) return null;
  // The face must belong to this stretch of road (not to the other leg of a hairpin).
  const [tx, tz] = lat(top);
  road.query(tx, tz, rq);
  if (!rq.found || Math.abs(rq.along - d) > 12) return null;
  return {
    d,
    x: p.x,
    z: p.z,
    tx: p.tx,
    tz: p.tz,
    lo: (foot - 0.3) * s,
    hi: (top + (wall ? 0.15 : 0.4)) * s,
    wall,
    look: gen.rockCutStretch(d, s)?.look ?? 'schist',
  };
}
