import { hash3, Rng } from '../../../shared/rng';
import type { StreetDressing } from '../maps/shared/types';
import type { Junction } from './junctions';
import { newPathQuery, type PathNetwork } from './real-data';
import { newRoadQuery, type Road } from './road';
import { nearestRoadPoint } from './road-distance';
import type { ScatterInstance } from './scatter';
import { KERB_H, KERB_W, type StreetDetail } from './street-detail';
import { UNDERPASS_WALL } from './terrain-gen';

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
  /** Path `pi` at `along` m runs in an underpass trench (retaining walls `UNDERPASS_WALL` past its edge). */
  underpass?: (pi: number, along: number) => boolean;
  /** Sidewalk runs of the city streets (lamps stand on them), sidewalk width, lamp spacing (0 = none). */
  streetDetail?: StreetDetail;
  /** On a junction plaza (plazas.ts): no crowd / parked car there. */
  paved?: (x: number, z: number) => boolean;
  /** Raised islands / sidewalks on the plazas (MapDef.plazaIslands, painted ones left out) + their top height. */
  islands?: readonly { kind: string; pts: number[] }[];
  islandTop?: (x: number, z: number) => number;
  /** Traffic signals / street trees of the junction areas (MapDef.plazaSignals / plazaTrees). */
  signals?: readonly number[];
  trees?: readonly number[];
  sidewalk?: number;
  lampEvery?: number;
}

/** Spacing of the parking slots along a street (m). */
const SLOT = 6.4;
/** Distance of the stage road samples used for the "within reach" tests (m). */
const ROAD_STEP = 12;
/** Wheel base / track half sizes a parked car is fitted to the street with (m). */
const CAR_HALF_L = 1.9;
const CAR_HALF_W = 0.8;
const sq2 = newPathQuery();
/** Shortest raised island that gets lamps down its middle (m). */
const ISLAND_LAMP_MIN = 20;
/** Spacing of the spectator places along a headwall parapet (m). */
const PARAPET_SPACING = 1.6;
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
    tiltX = 0,
    tiltZ = 0,
  ): void => {
    out.push({
      asset,
      variant,
      x,
      y,
      z,
      rotY,
      scale: 1,
      tiltX,
      tiltZ,
    });
  };
  /**
   * A parked car on a sloping street: on the plane through the ground under its wheels, pitched and rolled to
   * match (level, its uphill end sank into the street). Tilts are in the car's frame (YXZ: nose = +X).
   */
  const placeCar = (
    asset: string,
    variant: number,
    x: number,
    z: number,
    rotY: number,
  ): void => {
    // Local +X (nose) and +Z (the side a positive roll lowers) on the ground.
    const fx = Math.cos(rotY);
    const fz = -Math.sin(rotY);
    const h = (u: number, v: number) =>
      ctx.height(x + fx * u - fz * v, z + fz * u + fx * v);
    const L = CAR_HALF_L;
    const W = CAR_HALF_W;
    const front = (h(L, W) + h(L, -W)) / 2;
    const rear = (h(-L, W) + h(-L, -W)) / 2;
    const sideZ = (h(L, W) + h(-L, W)) / 2;
    const sideNegZ = (h(L, -W) + h(-L, -W)) / 2;
    place(
      asset,
      variant,
      x,
      z,
      rotY,
      (front + rear) / 2,
      Math.atan2(sideNegZ - sideZ, 2 * W),
      Math.atan2(front - rear, 2 * L),
    );
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
          if (ctx.blocked(x, z, 1.4) || ctx.paved?.(x, z)) continue;
          const dh = Math.abs(
            ctx.height(x + tx * 2.2, z + tz * 2.2) -
              ctx.height(x - tx * 2.2, z - tz * 2.2),
          );
          if (dh > 0.8) continue;
          // Half of them face the other way (they were parked from the other direction).
          const flip = rng.chance(0.5) ? 1 : -1;
          const yaw = yawAlong(tx * flip, tz * flip);
          if (parked.taxiShare && rng.chance(parked.taxiShare))
            placeCar('taxi', 0, x, z, yaw);
          else placeCar('street_car', rng.int(0, 11), x, z, yaw);
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
        // Not in the middle of a junction plaza (a street deck over a portal slab is no overpass to watch from).
        if (ctx.paved?.(x, z)) continue;
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
    const lq = newPathQuery();
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
        // No pole under or beside a bridge deck (it would stand up through it): in an underpass trench the light is
        // fixed to the retaining wall instead, elsewhere the slot stays empty.
        net.query(x, z, lq, 'tarmac', (qi) => !!net.paths[qi].bridge);
        const deck =
          nearRoad(x, z).d < road.at(0).halfWidth + 4 ||
          (lq.found && lq.distance <= lq.halfWidth + 2);
        if (deck) {
          if (ctx.underpass?.(run.path, a)) {
            const wall = hw + UNDERPASS_WALL;
            place(
              'wall_lamp',
              0,
              pt.x + ox * wall,
              pt.z + oz * wall,
              yawToward(-ox, -oz),
              ctx.height(x, z),
            );
          }
          continue;
        }
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

  // --- plaza islands: lamps along the long ones, spectators at the headwall parapets --------------
  if (ctx.islands && ctx.islandTop) {
    const top = ctx.islandTop;
    const islandRq = newRoadQuery();
    ctx.islands.forEach((il, ii) => {
      if (il.kind === 'painted') return;
      const n = il.pts.length / 2;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < n; i++) {
        cx += il.pts[2 * i] / n;
        cz += il.pts[2 * i + 1] / n;
      }
      // Principal axis of the outline (the long direction of a median / sidewalk strip).
      let sxx = 0;
      let sxz = 0;
      let szz = 0;
      for (let i = 0; i < n; i++) {
        const dx = il.pts[2 * i] - cx;
        const dz = il.pts[2 * i + 1] - cz;
        sxx += dx * dx;
        sxz += dx * dz;
        szz += dz * dz;
      }
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const ax = Math.cos(ang);
      const az = Math.sin(ang);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const t = (il.pts[2 * i] - cx) * ax + (il.pts[2 * i + 1] - cz) * az;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      if (il.kind === 'island' && ctx.lampEvery && hi - lo >= ISLAND_LAMP_MIN) {
        // Lamps down the middle of a long median, the arm across it.
        const count = Math.max(
          1,
          Math.floor((hi - lo - 8) / ctx.lampEvery) + 1,
        );
        for (let k = 0; k < count; k++) {
          const t = (lo + hi) / 2 + (k - (count - 1) / 2) * ctx.lampEvery;
          const x = cx + ax * t;
          const z = cz + az * t;
          // Not over the stage road down in the tunnel (its collider would stand in the bore).
          road.query(x, z, islandRq);
          if (islandRq.found && islandRq.distance < islandRq.halfWidth + 2)
            continue;
          place('street_lamp', 0, x, z, yawToward(-az, ax), top(x, z));
        }
      }
      if (il.kind === 'sidewalk' && rule.spectators) {
        // The edge facing the stage road (the headwall parapet over the trench): a row of spectators looking down.
        const rng = new Rng(hash3(ii, 97, 13, ctx.seed));
        const samples: { x: number; z: number; d: number }[] = [];
        for (let i = 0; i < n; i++) {
          const x0 = il.pts[2 * i];
          const z0 = il.pts[2 * i + 1];
          const x1 = il.pts[(2 * i + 2) % il.pts.length];
          const z1 = il.pts[(2 * i + 3) % il.pts.length];
          const l = Math.hypot(x1 - x0, z1 - z0);
          for (let s = 0; s < l; s += PARAPET_SPACING) {
            const x = x0 + ((x1 - x0) * s) / l;
            const z = z0 + ((z1 - z0) * s) / l;
            samples.push({ x, z, d: nearRoad(x, z).d });
          }
        }
        const near = Math.min(...samples.map((s) => s.d));
        for (const s of samples) {
          if (s.d > near + 2 || !rng.chance(0.6)) continue;
          // 0.7 m in from the edge, towards the middle of the strip.
          const l = Math.hypot(cx - s.x, cz - s.z) || 1;
          const x = s.x + ((cx - s.x) / l) * 0.7;
          const z = s.z + ((cz - s.z) / l) * 0.7;
          const r = nearRoad(x, z);
          place(
            'spectator',
            rng.int(0, 5),
            x,
            z,
            yawToward(r.x - x, r.z - z) + rng.range(-0.4, 0.4),
            top(x, z) + 0.03,
          );
        }
      }
    });
  }

  // --- junction areas: signal poles over the nearest street, census street trees, sidewalk lamps ---
  if (ctx.islandTop && net) {
    const top = ctx.islandTop;
    const sq = newPathQuery();
    const sp = { x: 0, z: 0 };
    const sig = ctx.signals ?? [];
    for (let i = 0; i + 1 < sig.length; i += 2) {
      const x = sig[i];
      const z = sig[i + 1];
      net.query(x, z, sq, 'tarmac', (qi) => !MAINLINE.has(net.paths[qi].kind));
      if (!sq.found) continue;
      net.pointAt(sq.path, sq.along, sp);
      // The node lies on the street centre in OSM: the pole stands at the kerb, the arm (+Z) over the street.
      const dx = sp.x - x;
      const dz = sp.z - z;
      const d = Math.hypot(dx, dz);
      let px = x;
      let pz = z;
      let yaw: number;
      if (d < 1) {
        const q = { x: 0, z: 0 };
        net.pointAt(sq.path, Math.min(net.lengths[sq.path], sq.along + 1), q);
        const tl = Math.hypot(q.x - sp.x, q.z - sp.z) || 1;
        const ox = (q.z - sp.z) / tl;
        const oz = -(q.x - sp.x) / tl;
        const off = sq.halfWidth + 0.6;
        px = sp.x + ox * off;
        pz = sp.z + oz * off;
        yaw = yawToward(-ox, -oz);
      } else yaw = yawToward(dx, dz);
      if (ctx.blocked(px, pz, 0.4)) continue;
      place('traffic_signal', 0, px, pz, yaw, top(px, pz));
    }
    const tr = ctx.trees ?? [];
    for (let i = 0; i + 2 < tr.length; i += 3) {
      const x = tr[i];
      const z = tr[i + 1];
      // Trunk diameter (inch) -> size: a 4" sapling is small, a 30" plane tree full grown.
      const s = Math.min(1.2, Math.max(0.45, 0.35 + tr[i + 2] / 30));
      const rng = new Rng(
        hash3(Math.round(x * 10), Math.round(z * 10), 5, ctx.seed),
      );
      out.push({
        asset: 'oak_tree',
        variant: rng.int(0, 3),
        x,
        y: top(x, z),
        z,
        rotY: rng.range(0, Math.PI * 2),
        scale: s,
        tiltX: 0,
        tiltZ: 0,
      });
    }
  }
  if (ctx.islands && ctx.islandTop && ctx.lampEvery && net) {
    // Lamps along the street side of the area's sidewalks, 0.6 m in from the kerb.
    const top = ctx.islandTop;
    const lq = newRoadQuery();
    for (const il of ctx.islands) {
      if (il.kind !== 'sidewalk') continue;
      const n = il.pts.length / 2;
      let next = 0;
      for (let i = 0; i < n; i++) {
        const x0 = il.pts[2 * i];
        const z0 = il.pts[2 * i + 1];
        const x1 = il.pts[(2 * i + 2) % il.pts.length];
        const z1 = il.pts[(2 * i + 3) % il.pts.length];
        const l = Math.hypot(x1 - x0, z1 - z0);
        for (let s = next; s < l; s += ctx.lampEvery) {
          next = s + ctx.lampEvery - l;
          const tx = (x1 - x0) / l;
          const tz = (z1 - z0) / l;
          // Inward normal (the ring may run either way): towards the island's inside.
          let nx = -tz;
          let nz = tx;
          const mx = x0 + tx * s;
          const mz = z0 + tz * s;
          const probe = (k: number) =>
            ctx.islandTop!(mx + nx * k, mz + nz * k) -
            ctx.islandTop!(mx - nx * k, mz - nz * k);
          if (probe(0.5) < 0) [nx, nz] = [-nx, -nz];
          const x = mx + nx * 0.6;
          const z = mz + nz * 0.6;
          // Only on a street edge (a street ribbon beside it), never over the stage road below.
          net.query(mx - nx * 2, mz - nz * 2, sq2, 'tarmac');
          if (!sq2.found || sq2.distance > sq2.halfWidth + 1.5) continue;
          road.query(x, z, lq);
          if (lq.found && lq.distance < lq.halfWidth + 2) continue;
          if (ctx.blocked(x, z, 0.5)) continue;
          place('street_lamp', 0, x, z, yawToward(-nx, -nz), top(x, z));
        }
        if (next < 0) next = 0;
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
