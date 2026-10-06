import type { PathDef, RailwayDef } from '../maps/shared/types';
import { newPathQuery, type PathNetwork } from './real-data';
import type { ScatterInstance } from './scatter';

/**
 * Railways of a real-world map (MapDef.railways, baked from OSM `railway=rail`). Each track joins the other
 * roads' network as a path of kind `rail` (terrain-gen.ts: a smooth, gently graded profile; the ballast bed is
 * carved into the ground, so the car drives over it; road decks crossing it are lifted to clear the wires), drawn
 * by rail-mesh.ts (ballast + sleepers strip, rails, catenary wires). Pure (no scene), the tests run it.
 */

export const RAIL_KIND = 'rail';
/** Ballast bed: toe half width (the path width / 2), crest half width and crest height over the formation (m). */
export const BED_HALF = 2.4;
export const CREST_HALF = 1.65;
export const BALLAST_H = 0.4;
/** Standard gauge (m, between the rail heads) and rail height / head width (m). */
export const GAUGE = 1.435;
export const RAIL_H = 0.16;
export const RAIL_HEAD = 0.072;
/** A road deck crossing a railway: deck surface over the formation (m). An electrified line needs ~6.5 m free under the girders. */
export const RAIL_CLEARANCE = 7.8;
/** Catenary: mast spacing along the track and mast offset from the track centre (= the cantilever's reach, m). */
export const MAST_SPACING = 58;
export const MAST_OFFSET = 3.1;
/** Contact / messenger wire over the formation (m): 5.5 / 6.7 m over the rail top. */
export const CONTACT_Y = BALLAST_H + RAIL_H + 5.5;
export const MESSENGER_Y = BALLAST_H + RAIL_H + 6.7;
/** The contact wire zig-zags this far either side of the track centre (even wear of the pantograph). */
export const STAGGER = 0.2;

/** Ballast height over the formation at `d` m from the track centre (flat crest, sloped shoulders). */
export function ballastAt(d: number): number {
  if (d <= CREST_HALF) return BALLAST_H;
  if (d >= BED_HALF) return 0;
  return (BALLAST_H * (BED_HALF - d)) / (BED_HALF - CREST_HALF);
}

/** The tracks as paths of the other-roads network (never joined to the stage road). */
export function railPaths(rails: readonly RailwayDef[]): PathDef[] {
  return rails.map((r) => ({
    kind: RAIL_KIND,
    width: BED_HALF * 2,
    surface: 'dirt',
    pts: r.pts,
    junction: false,
  }));
}

export interface CatenaryMast {
  x: number;
  z: number;
  /** Unit direction from the mast to the track it carries (the arm points that way). */
  ax: number;
  az: number;
  /** Path index of the track and the distance along it (m). */
  path: number;
  along: number;
}

/**
 * Catenary masts of the electrified tracks: every MAST_SPACING m, MAST_OFFSET m to one side (left first, the
 * right side where the left is taken by another track, a road, a channel or a building; skipped when both are).
 * `rails` = path indices of the electrified tracks.
 */
export function catenaryMasts(
  net: PathNetwork,
  rails: readonly number[],
  allRails: readonly number[],
  blocked: (x: number, z: number) => boolean,
): CatenaryMast[] {
  const out: CatenaryMast[] = [];
  const p = { x: 0, z: 0 };
  const q = { x: 0, z: 0 };
  const railSet = new Set(allRails);
  const pq = newPathQuery();
  // A mast must stand clear of every track's bed (its own and the neighbours').
  const onTrack = (x: number, z: number): boolean =>
    net.query(x, z, pq, undefined, (i) => railSet.has(i)).found &&
    pq.distance < BED_HALF + 0.3;
  const near = (x: number, z: number) =>
    out.some((m) => Math.hypot(m.x - x, m.z - z) < 8);
  for (const pi of rails) {
    const L = net.lengths[pi];
    if (L < 20) continue;
    const n = Math.max(1, Math.round(L / MAST_SPACING));
    const step = L / n;
    for (let i = 0; i <= n; i++) {
      const a = Math.min(L - 1, Math.max(1, i * step));
      net.pointAt(pi, a, p);
      net.pointAt(pi, Math.min(L, a + 2), q);
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      // Left of the direction of travel = (tz, -tx).
      const lx = dz / l;
      const lz = -dx / l;
      for (const side of [1, -1]) {
        const x = p.x + lx * MAST_OFFSET * side;
        const z = p.z + lz * MAST_OFFSET * side;
        if (onTrack(x, z) || blocked(x, z)) continue;
        if (near(x, z)) break;
        out.push({ x, z, ax: -lx * side, az: -lz * side, path: pi, along: a });
        break;
      }
    }
  }
  return out;
}

/** Instances of the masts (`catenary_mast`, its arm along local +Z); y from the caller's ground sampler. */
export function mastInstances(
  masts: readonly CatenaryMast[],
  height: (x: number, z: number) => number,
): ScatterInstance[] {
  return masts.map((m) => ({
    asset: 'catenary_mast',
    variant: 0,
    x: m.x,
    y: height(m.x, m.z) - 0.15,
    z: m.z,
    // three.js yaw maps local +Z to (sin t, cos t).
    rotY: Math.atan2(m.ax, m.az),
    scale: 1,
    tiltX: 0,
    tiltZ: 0,
  }));
}
