import { hash3, Rng } from '../../../shared/rng';
import type { StreetDressing } from '../maps/shared/types';
import type { Junction } from './junctions';
import { newPathQuery, type PathNetwork } from './real-data';
import type { Road } from './road';
import { nearestRoadPoint } from './road-distance';
import type { ScatterInstance } from './scatter';
import { KERB_H, KERB_W, type StreetDetail } from './street-detail';

/**
 * City dressing placed from the road network (MapDef.streetDressing): parked cars along the kerbs of
 * the streets near the stage road, spectators on the overpasses and behind the closed junction mouths,
 * police cars and fire trucks at the junctions. Deterministic (seeded from the map), pure (no scene).
 *
 * Models face +X: to point a vehicle along (dx, dz) its yaw is `-atan2(dz, dx)` (three.js maps local
 * +X to (cos t, -sin t)); spectators face +Z: yaw `atan2(dx, dz)`.
 */

export interface DressingContext {
  seed: number;
  road: Road;
  net?: PathNetwork;
  junctions: readonly Junction[];
  /** Ground height (the surface the street ribbons follow). */
  height: (x: number, z: number) => number;
  /** Road surface height of path `pi` at `along` m (decks are lifted). */
  pathHeight: (pi: number, along: number) => number;
  /** Something solid (a building) within `r` m of the point. */
  blocked: (x: number, z: number, r: number) => boolean;
  /** Sidewalk runs of the city streets (lamps stand on them), sidewalk width, lamp spacing (0 = none). */
  streetDetail?: StreetDetail;
  sidewalk?: number;
  lampEvery?: number;
}

/** Spacing of the parking slots along a street (m). */
const SLOT = 6.4;
/** Distance of the stage road samples used for the "within reach" tests (m). */
const ROAD_STEP = 12;
/** Streets with a mainline role never get parked cars / crowds. */
const MAINLINE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

const yawAlong = (dx: number, dz: number): number => -Math.atan2(dz, dx);
const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);

export function streetDressingInstances(
  rule: StreetDressing,
  ctx: DressingContext,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const { road, net } = ctx;
  const nearRoad = nearestRoadPoint(road, ROAD_STEP);
  const place = (
    asset: string,
    variant: number,
    x: number,
    z: number,
    rotY: number,
    y = ctx.height(x, z),
  ): void => {
    out.push({
      asset,
      variant,
      x,
      y,
      z,
      rotY,
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    });
  };

  // --- parked cars --------------------------------------------------------------------------
  const parked = rule.parked;
  if (parked && net) {
    const pq = newPathQuery();
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    net.paths.forEach((p, pi) => {
      if (
        p.bridge ||
        p.surface !== 'tarmac' ||
        MAINLINE.has(p.kind) ||
        !parked.kinds.includes(p.kind)
      )
        return;
      const L = net.lengths[pi];
      if (L < 20) return;
      const rng = new Rng(hash3(pi, 31, 7, ctx.seed));
      const hw = p.width / 2;
      // Narrow streets are parked on one side only (the other stays open for the cars driving by).
      const sides: (1 | -1)[] =
        p.width >= 7 ? [1, -1] : [rng.chance(0.5) ? 1 : -1];
      for (let a = 8; a < L - 8; a += SLOT) {
        const at = a + rng.range(-0.8, 0.8);
        net.pointAt(pi, at - 1.5, pt);
        net.pointAt(pi, at + 1.5, nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, at, pt);
        const r = nearRoad(pt.x, pt.z);
        // Not right beside the parkway, not out of sight of it.
        if (r.d > parked.reach || r.d < 14 + road.at(0).halfWidth) continue;
        for (const side of sides) {
          if (!rng.chance(parked.fill)) continue;
          const lat = side * (hw - 1.05);
          const x = pt.x + tz * lat;
          const z = pt.z - tx * lat;
          // Another street under the car (a crossing / junction), a building, a steep bit.
          net.query(
            x,
            z,
            pq,
            undefined,
            (qi) => qi !== pi && !net.paths[qi].bridge,
          );
          if (pq.found && pq.distance <= pq.halfWidth + 2.4) continue;
          if (ctx.blocked(x, z, 1.4)) continue;
          const dh = Math.abs(
            ctx.height(x + tx * 2.2, z + tz * 2.2) -
              ctx.height(x - tx * 2.2, z - tz * 2.2),
          );
          if (dh > 0.8) continue;
          // Half of them face the other way (they were parked from the other direction).
          const flip = rng.chance(0.5) ? 1 : -1;
          const yaw = yawAlong(tx * flip, tz * flip);
          if (parked.taxiShare && rng.chance(parked.taxiShare))
            place('taxi', 0, x, z, yaw);
          else place('street_car', rng.int(0, 11), x, z, yaw);
        }
      }
    });
  }

  // --- spectators on the overpasses ---------------------------------------------------------------
  const crowd = rule.spectators;
  if (crowd && net && crowd.perDeck) {
    net.paths.forEach((p, pi) => {
      if (!p.bridge || MAINLINE.has(p.kind)) return;
      const L = net.lengths[pi];
      if (L < 14) return;
      const pt = { x: 0, z: 0 };
      // Where the deck is nearest to the stage road: the best place to watch from.
      let bestA = 0;
      let bestD = Infinity;
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(pi, a, pt);
        const d = nearRoad(pt.x, pt.z).d;
        if (d < bestD) [bestD, bestA] = [d, a];
      }
      if (bestD > crowd.reach) return;
      const rng = new Rng(hash3(pi, 53, 11, ctx.seed));
      const hw = p.width / 2;
      const nx = { x: 0, z: 0 };
      for (let i = 0; i < crowd.perDeck!; i++) {
        const at = Math.min(L - 1.5, Math.max(1.5, bestA + rng.range(-9, 9)));
        net.pointAt(pi, at - 1.5, pt);
        net.pointAt(pi, at + 1.5, nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, at, pt);
        const side = i % 2 ? 1 : -1;
        const lat = side * (hw - 0.45 - rng.next() * 0.35);
        const x = pt.x + tz * lat;
        const z = pt.z - tx * lat;
        const r = nearRoad(x, z);
        place(
          'spectator',
          rng.int(0, 5),
          x,
          z,
          yawToward(r.x - x, r.z - z) + rng.range(-0.4, 0.4),
          ctx.pathHeight(pi, at) + 0.03,
        );
      }
    });
  }

  // --- street lamps on the sidewalks ------------------------------------------------------------
  const detail = ctx.streetDetail;
  if (detail && net && ctx.lampEvery) {
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    const W = ctx.sidewalk ?? 1.5;
    for (const run of detail.runs) {
      const hw = net.paths[run.path].width / 2;
      // The two sides alternate (offset by half a spacing), every run starts on a spacing multiple.
      const first =
        Math.ceil(run.from / ctx.lampEvery) * ctx.lampEvery +
        (run.side > 0 ? 0 : ctx.lampEvery / 2);
      for (let a = first; a <= run.to; a += ctx.lampEvery) {
        if (a < run.from) continue;
        const L = net.lengths[run.path];
        net.pointAt(run.path, Math.max(0, a - 1.5), pt);
        net.pointAt(run.path, Math.min(L, a + 1.5), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(run.path, a, pt);
        const ox = tz * run.side;
        const oz = -tx * run.side;
        const off = hw + KERB_W + W - 0.4;
        const x = pt.x + ox * off;
        const z = pt.z + oz * off;
        if (ctx.blocked(x, z, 0.5)) continue;
        // The arm points +Z: turn it over the street.
        place(
          'street_lamp',
          0,
          x,
          z,
          yawToward(-ox, -oz),
          ctx.height(x, z) + KERB_H,
        );
      }
    }
  }

  // --- junction mouths: crowds, police cars, fire trucks -----------------------------------------
  ctx.junctions.forEach((j, ji) => {
    if (j.width < 3 || MAINLINE.has(j.kind)) return;
    const rng = new Rng(hash3(ji, 71, 3, ctx.seed));
    const px = -j.dz; // across the side road
    const pz = j.dx;
    const at = (t: number, off: number) => ({
      x: j.x + j.dx * t + px * off,
      z: j.z + j.dz * t + pz * off,
    });
    // Vehicles stand in the mouth behind the barrier row (which is ~4-6 m up the side road), nose to the road:
    // the police car first, the ambulance / fire truck queued behind it (a wide mouth takes two abreast).
    let vehicleEnd = 7;
    const emergency = rule.emergency;
    if (emergency) {
      const twoAbreast = j.width >= 9;
      const lane = (i: number): number =>
        twoAbreast ? (i % 2 ? 1 : -1) * (j.width / 4) : 0;
      let n = 0;
      const park = (asset: string, length: number, yawJitter: number) => {
        const t =
          twoAbreast && n % 2 === 1 ? vehicleEnd : vehicleEnd + length / 2;
        const c = at(t + 0.3, lane(n) + rng.range(-0.3, 0.3));
        if (ctx.blocked(c.x, c.z, length / 2 + 0.5)) return;
        place(
          asset,
          0,
          c.x,
          c.z,
          yawAlong(-j.dx, -j.dz) + rng.range(-yawJitter, yawJitter),
        );
        n++;
        if (!twoAbreast || n % 2 === 0) vehicleEnd = t + length / 2 + 1.2;
      };
      if (rng.chance(emergency.police)) park('police_car', 4.6, 0.12);
      if (
        j.width >= 5 &&
        emergency.ambulance &&
        rng.chance(emergency.ambulance)
      )
        park('ambulance', 6.4, 0.08);
      if (j.width >= 6 && rng.chance(emergency.fire))
        park('fire_truck', 8.6, 0.05);
    }
    // Spectators stand along the verges, behind the barrier / beside the vehicles.
    const n = crowd?.perJunction ?? 0;
    if (crowd && n > 0 && rng.chance(0.8)) {
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const c = at(
          7 + rng.range(0.5, Math.max(1, vehicleEnd - 6)) + (i >> 1) * 1.1,
          side * (j.width / 2 - 0.5 - rng.next() * 0.4),
        );
        if (ctx.blocked(c.x, c.z, 0.5)) continue;
        place(
          'spectator',
          rng.int(0, 5),
          c.x,
          c.z,
          yawToward(-j.dx, -j.dz) + rng.range(-0.5, 0.5),
        );
      }
    }
  });
  return out;
}
