import { smoothstep } from '../../../shared/noise';
import { Rng } from '../../../shared/rng';
import type { CulvertsDef } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import { newRoadQuery, type Road } from './road';
import type { ScatterInstance } from './scatter';

/**
 * Culverts under the stage road (MapDef.culverts, baked by scripts/realmap/culverts.py where a drainage line of the
 * elevation data crosses it): a concrete pipe square-ish to the road with a headwall + wing walls at both ends, the
 * gully carved to the inlet and away from the outlet. Pure (node tests): `planCulverts` sizes them against the
 * carved ground, `carveCulverts` lowers the land in front of each headwall (never the road or its verge, so the
 * road surface and height stay exactly as they were); world/culvert-mesh.ts draws them.
 */

/** The pipe turns at most this far off square to the road (rad): a culvert crosses the road, it does not run along it. */
const MAX_SKEW = (30 * Math.PI) / 180;
/** Earth over the pipe crown below the road centre line (m). */
const COVER = 0.45;
/** Headwall thickness (m): its face is at the end's `u`, its back this far towards the road. */
export const WALL_T = 0.3;
/** Footing below the invert (m). */
export const FOOTING = 0.35;
/** Wall top above the pipe crown at least (m). */
const WALL_OVER = 0.35;
/** A wall retains at most this much ground above the pipe crown (m). */
const WALL_MAX_OVER = 2.2;
/** The gully stays this deep below the land at the end of its run (m), then fades out over FADE m. */
const GULLY_DEPTH = 0.35;
const FADE = 4;
/** Side slope of the gully (rise per metre across) and inside the wing walls (near vertical: the wings retain it). */
const SIDE = 0.9;
const WING_SIDE = 6;
/** Wing walls splay out from the headwall ends this many metres per metre (~30 deg). */
export const WING_FLARE = 0.58;
/** The channel floor in front of the headwall sits this far under the invert (the apron slab's top is at the invert). */
const APRON_SINK = 0.06;

export interface CulvertEnd {
  /** +1 = the outlet (downstream), -1 = the inlet. */
  side: 1 | -1;
  /** Headwall face distance from the road centre along the pipe axis (m). */
  u: number;
  /** Pipe invert (inside bottom) at the face (m). */
  invert: number;
  /** Headwall top (m). */
  top: number;
  /** Headwall half width (m) and wing wall length along the axis (m). */
  half: number;
  wing: number;
  /** Gully length in front of the wall (m). */
  run: number;
  /** Ground before the culvert along the axis from the face outward, 1 m steps (run + FADE + 2 samples). */
  prof: Float32Array;
}

export interface CulvertSite {
  /** Distance along the road and the road centre point / height there. */
  along: number;
  x: number;
  y: number;
  z: number;
  /** Pipe axis (unit, x z), pointing downstream: inlet at -u, outlet at +u. */
  ax: number;
  az: number;
  /** Pipe inside diameter (m). */
  diameter: number;
  area: number;
  ends: [CulvertEnd, CulvertEnd];
  /** Bounding radius round (x, z) of everything carved / built (m). */
  reach: number;
  /** Stones in the outlet gully: (t from the face, v across, size 0..1, yaw). */
  stones: [number, number, number, number][];
}

/** What planning needs from the terrain generator. */
export interface CulvertHost {
  road: Road;
  shoulder: number;
  /** Ground with the road carved in, without culverts. */
  ground(x: number, z: number): number;
  /** Another road (foot paths cross a gully) / water way / pad within `r` m of (x, z): no culvert there. */
  blocked(x: number, z: number, r: number): boolean;
}

/** Pipe size by catchment (ha): standard concrete pipe diameters. */
export function pipeDiameter(area: number): number {
  return area < 4
    ? 0.6
    : area < 10
      ? 0.8
      : area < 25
        ? 1.0
        : area < 60
          ? 1.2
          : 1.5;
}

/** The culvert's own channel floor at `t` m in front of the face (before the side slopes). */
function floorAt(e: CulvertEnd, t: number): number {
  const b0 = e.invert - APRON_SINK;
  const g = profAt(e.prof, t) - GULLY_DEPTH;
  const k = smoothstep(0, e.run, t);
  const f = b0 + (g - b0) * k;
  // The outlet never climbs (the water runs out), the inlet never drops below the pipe.
  return e.side > 0 ? Math.min(f, b0 - 0.01 * t) : Math.max(f, b0 + 0.005 * t);
}

function profAt(p: Float32Array, t: number): number {
  const f = Math.max(0, Math.min(p.length - 1.001, t));
  const i = Math.floor(f);
  return p[i] + (p[i + 1] - p[i]) * (f - i);
}

export function planCulverts(
  def: CulvertsDef,
  host: CulvertHost,
): CulvertSite[] {
  const { road } = host;
  const q = newRoadQuery();
  const sites: CulvertSite[] = [];
  for (const c of def.culverts) {
    road.query(c.x, c.z, q);
    if (!q.found || q.distance > q.halfWidth + 6) continue;
    const along = q.along;
    if (along < 20 || along > road.length - 20 || road.bridgeAt(along))
      continue;
    const s = road.at(along);
    const hw = s.halfWidth;
    // Square to the road on the downstream side, turned towards the flow by up to MAX_SKEW.
    let nx = -s.tz;
    let nz = s.tx;
    const dn = nx * c.dir[0] + nz * c.dir[1];
    if (dn < 0) {
      nx = -nx;
      nz = -nz;
    }
    const along_ = s.tx * c.dir[0] + s.tz * c.dir[1];
    const skew = Math.min(MAX_SKEW, Math.atan2(Math.abs(along_), Math.abs(dn)));
    const sg = Math.sign(along_) || 1;
    let ax = nx * Math.cos(skew) + s.tx * sg * Math.sin(skew);
    let az = nz * Math.cos(skew) + s.tz * sg * Math.sin(skew);
    const edge = hw + host.shoulder;
    const at = (u: number) => host.ground(s.x + ax * u, s.z + az * u);
    // Trust the land beside the road over the coarse flow direction: the inlet is on the higher side.
    const lowest = (sgn: number) => {
      let m = Infinity;
      for (let u = edge + 2; u <= edge + 12; u += 1)
        m = Math.min(m, at(sgn * u));
      return m;
    };
    let lowIn = lowest(-1);
    let lowOut = lowest(1);
    if (lowOut > lowIn + 0.3) {
      ax = -ax;
      az = -az;
      [lowIn, lowOut] = [lowOut, lowIn];
    }
    const diameter = pipeDiameter(c.area);
    const crownMax = s.y - COVER;
    const len = 2 * (edge + 3);
    const invIn = Math.min(crownMax - diameter, lowIn - 0.1);
    const invOut = Math.max(
      Math.min(invIn - 0.02 * len, lowOut - 0.1),
      invIn - 0.15 * len,
    );
    const ends: CulvertEnd[] = [];
    let ok = true;
    for (const [side, invert] of [
      [-1, invIn],
      [1, invOut],
    ] as const) {
      const minTop = invert + diameter + WALL_OVER;
      const u0 = edge + 1.9;
      // The face where the embankment has come down to the wall top (a fill), else at the ditch's outer edge.
      let u = u0;
      for (let k = u0; k <= edge + 14; k += 0.25)
        if (at(side * k) <= minTop + 0.1) {
          u = k;
          break;
        }
      const behind = at(side * (u - WALL_T - 0.2));
      const top = Math.max(
        minTop,
        Math.min(behind, invert + diameter + WALL_MAX_OVER),
      );
      const half = 0.5 * diameter + 0.55 + 0.3 * (top - minTop);
      const wing = 1.2 + diameter;
      // The gully: shorter where another leg of the road (a hairpin) or a side road comes near.
      let run = Math.min(14, Math.max(8, 6 + diameter * 6));
      const rq = newRoadQuery();
      for (let t = 0; t <= run + FADE; t += 1) {
        const uu = side * (u + t);
        const px = s.x + ax * uu;
        const pz = s.z + az * uu;
        road.query(px, pz, rq);
        const otherLeg =
          rq.found &&
          Math.abs(rq.along - along) > 25 &&
          rq.distance < rq.halfWidth + host.shoulder + 6;
        if (
          otherLeg ||
          !rq.found ||
          rq.distance > road.influence - 2 ||
          host.blocked(px, pz, half + 1.5)
        ) {
          run = t - FADE - 1;
          break;
        }
      }
      if (run < 4) {
        ok = false;
        break;
      }
      const prof = new Float32Array(Math.ceil(run + FADE) + 3);
      for (let i = 0; i < prof.length; i++) prof[i] = at(side * (u + i));
      ends.push({ side, u, invert, top, half, wing, run, prof });
    }
    if (!ok) continue;
    const out = ends[1];
    const reach =
      Math.max(ends[0].u + ends[0].run, out.u + out.run) +
      FADE +
      Math.max(ends[0].half, out.half) +
      out.wing * WING_FLARE +
      4;
    // A few field stones in the outlet gully past the apron (seeded by the site position).
    const rng = new Rng(
      ((Math.round(c.x * 10) * 73856093) ^
        (Math.round(c.z * 10) * 19349663)) >>>
        0,
    );
    const stones: [number, number, number, number][] = [];
    const n = 4 + Math.floor(rng.next() * 4);
    for (let i = 0; i < n; i++) {
      const t = out.wing + 0.4 + rng.next() * Math.max(1, out.run * 0.6);
      const v = (rng.next() - 0.5) * (diameter + 1.6);
      stones.push([t, v, rng.next(), rng.next() * Math.PI * 2]);
    }
    sites.push({
      along,
      x: s.x,
      y: s.y,
      z: s.z,
      ax,
      az,
      diameter,
      area: c.area,
      ends: [ends[0], ends[1]],
      reach,
      stones,
    });
  }
  return sites;
}

/**
 * Lower the ground `h` at (x, z) into the culverts' gullies. `roadDist` / `roadHalf`: the road query there
 * (distance from the centre line, half width): the road and its verge are never touched.
 */
export function carveCulverts(
  sites: readonly CulvertSite[],
  x: number,
  z: number,
  h: number,
  roadDist: number,
  roadHalf: number,
  shoulder: number,
): number {
  if (roadDist <= roadHalf + shoulder + 0.25) return h;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz > s.reach * s.reach) continue;
    const u = dx * s.ax + dz * s.az;
    const v = Math.abs(-dx * s.az + dz * s.ax);
    const e = s.ends[u >= 0 ? 1 : 0];
    const t = Math.abs(u) - e.u;
    if (t < -WALL_T || t > e.run + FADE) continue;
    const tt = Math.max(0, t);
    const floor = floorAt(e, tt);
    // Between the wing walls: the floor out to the wings, the ground standing behind them; past their tips the gully's
    // own side slopes.
    const tip = e.wing;
    const sw = smoothstep(tip, tip + 2.5, tt);
    const wingHalf = e.half + 0.05 + Math.min(tt, tip) * WING_FLARE;
    const halfB = wingHalf + (0.5 * s.diameter + 0.25 - wingHalf) * sw;
    const slope = WING_SIDE + (SIDE - WING_SIDE) * sw;
    // Behind the face only the wall's own footprint (its body hides the cut).
    if (t < 0 && v > e.half) continue;
    const chan = floor + Math.max(0, v - halfB) * slope;
    if (chan >= h) continue;
    const fade = 1 - smoothstep(e.run, e.run + FADE, tt);
    h += (chan - h) * fade;
  }
  return h;
}

/** Within `margin` m of a culvert's walls or gully (no trees / scatter there). */
export function nearCulvert(
  sites: readonly CulvertSite[],
  x: number,
  z: number,
  margin: number,
): boolean {
  for (const s of sites) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz > (s.reach + margin) ** 2) continue;
    const u = dx * s.ax + dz * s.az;
    const v = Math.abs(-dx * s.az + dz * s.ax);
    const e = s.ends[u >= 0 ? 1 : 0];
    const t = Math.abs(u) - e.u;
    if (t < -WALL_T - margin || t > e.run + margin) continue;
    const w =
      e.half +
      Math.min(Math.max(t, 0), e.wing) * WING_FLARE +
      Math.max(0, t - e.wing) * 0.4 +
      margin;
    if (v < w) return true;
  }
  return false;
}

/** Floor of a culvert end's channel `t` m in front of its face (the mesh's apron and wing walls). */
export function culvertFloor(e: CulvertEnd, t: number): number {
  return floorAt(e, t);
}

/** Ground before the culvert along an end's axis, `t` m in front of its face. */
export function culvertProfile(e: CulvertEnd, t: number): number {
  return profAt(e.prof, t);
}

/** A box collider per headwall (the wings stand below the ground behind them). */
export function culvertColliders(
  sites: readonly CulvertSite[],
): StaticCollider[] {
  const out: StaticCollider[] = [];
  for (const s of sites)
    for (const e of s.ends) {
      const dx = s.ax * e.side;
      const dz = s.az * e.side;
      const c = e.u - WALL_T / 2;
      out.push({
        kind: 'box',
        x: s.x + dx * c,
        y: e.invert - FOOTING,
        z: s.z + dz * c,
        h: e.top - e.invert + FOOTING + 0.1,
        hx: e.half,
        hz: WALL_T / 2,
        rot: Math.atan2(dx, dz),
        r: Math.hypot(e.half, WALL_T / 2),
      });
    }
  return out;
}

/** The field stones in the outlet gullies (`rock_small`, no collision). */
export function culvertStones(
  sites: readonly CulvertSite[],
  ground: TerrainSampler,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  for (const s of sites) {
    const e = s.ends[1];
    for (const [t, v, size, yaw] of s.stones) {
      const x = s.x + s.ax * (e.u + t) - s.az * v;
      const z = s.z + s.az * (e.u + t) + s.ax * v;
      out.push({
        asset: 'rock_small',
        variant: Math.floor(size * 4) % 4,
        x,
        y: ground.height(x, z) - 0.05,
        z,
        rotY: yaw,
        scale: 1 + size * 1.6,
        tiltX: (size - 0.5) * 0.3,
        tiltZ: (yaw / Math.PI - 1) * 0.15,
      });
    }
  }
  return out;
}
