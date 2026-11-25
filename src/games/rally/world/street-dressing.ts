import { hash3, Rng } from '../../../shared/rng';
import { fanVariant } from './fan-variants';
import type { Country, StreetDressing } from '../maps/shared/types';
import type { Junction } from './junctions';
import { newPathQuery, type PathNetwork } from './real-data';
import { newRoadQuery, type Road } from './road';
import { nearestRoadPoint } from './road-distance';
import type { ScatterInstance } from './scatter';
import { KERB_H, KERB_W, type StreetDetail } from './street-detail';
import { STREET_CAR_MIX } from '../assets/builders/vehicles';

/**
 * City dressing placed from the road network (MapDef.streetDressing): parked cars along the kerbs of
 * the streets near the stage road, spectators on the overpasses and behind the closed junction mouths,
 * police cars and fire trucks at the junctions, village street furniture along the stage road.
 * Deterministic (seeded from the map), pure (no scene).
 *
 * Models face +X: to point a vehicle along (dx, dz) its yaw is `-atan2(dz, dx)` (three.js maps local
 * +X to (cos t, -sin t)); spectators face +Z: yaw `atan2(dx, dz)`.
 */

export interface DressingContext {
  seed: number;
  /** The map's country: its fans wave its flag (world/fan-variants.ts). */
  country?: Country;
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
  /** On a junction plaza (plazas.ts): no crowd / parked car there. */
  paved?: (x: number, z: number) => boolean;
  /** Raised islands / sidewalks on the plazas (MapDef.plazaIslands, painted ones left out) + their top height. */
  islands?: readonly { kind: string; pts: number[] }[];
  islandTop?: (x: number, z: number) => number;
  /** Traffic signals / street trees of the junction areas (MapDef.plazaSignals / plazaTrees). */
  signals?: readonly number[];
  trees?: readonly number[];
  /** Street trees over the whole map (MapDef.streetTrees): [x, z, dbh, ...]. */
  streetTrees?: readonly number[];
  sidewalk?: number;
  lampEvery?: number;
}

/** Width of a parking lane (m): streets.py / street-markings.ts PARK_W. */
const PARK_LANE = 2.2;
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
/** Half length of a fire truck, half width of a lane-parked emergency vehicle and the least distance between two of a kind (m). */
const FIRE_HALF_L = 4.6;
const LANE_VEHICLE_HALF_W = 1.2;
const LANE_VEHICLE_SPACING = 500;

const yawAlong = (dx: number, dz: number): number => -Math.atan2(dz, dx);
const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);

export function streetDressingInstances(
  rule: StreetDressing,
  ctx: DressingContext,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const { road, net } = ctx;
  const nearRoad = nearestRoadPoint(road, ROAD_STEP);
  // The top of the ground street at (x, z): its ribbon keeps the street's own height line where the land dips (a vehicle
  // in a junction mouth stood a few cm into the street it was parked on).
  const tq = newPathQuery();
  const streetTop = (x: number, z: number): number => {
    const g = ctx.height(x, z);
    if (!net) return g;
    net.query(x, z, tq, 'tarmac', (qi) => !net.paths[qi].bridge);
    return tq.found && tq.distance <= tq.halfWidth
      ? Math.max(g, ctx.pathHeight(tq.path, tq.along) + 0.03)
      : g;
  };
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
    /** Half the wheel base and half the track of the vehicle (m). */
    halfL = CAR_HALF_L,
    halfW = CAR_HALF_W,
    /** Ground under the wheels (a vehicle in a junction mouth: the street's own top, `streetTop`). */
    ground: (x: number, z: number) => number = ctx.height,
  ): void => {
    // Local +X (nose) and +Z (the side a positive roll lowers) on the ground.
    const fx = Math.cos(rotY);
    const fz = -Math.sin(rotY);
    const h = (u: number, v: number) =>
      ground(x + fx * u - fz * v, z + fz * u + fx * v);
    const L = halfL;
    const W = halfW;
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

  // --- fire trucks / ambulances parked in a street lane -----------------------------------------------
  // Standing lengthwise in the parking / traffic lane of a side street near the stage (the way they wait at a closure),
  // never across a mouth: clear of buildings along their whole length (sideways ~1.2 m), off other streets and the
  // stage road, on level ground, and `LANE_VEHICLE_SPACING` m from the last one of their kind so they spread out.
  const em = rule.emergency;
  const laneKinds =
    em && rule.parked && net
      ? [
          {
            asset: ctx.country === 'mk' ? 'fire_truck_mk' : 'fire_truck',
            share: em.fire,
            halfL: FIRE_HALF_L,
            wheels: (ctx.country === 'mk' ? [3, 1.1] : [3.5, 1.2]) as [
              number,
              number,
            ],
            at: [] as { x: number; z: number }[],
          },
          {
            asset: 'ambulance',
            share: em.ambulance ?? 0,
            halfL: 3.2,
            wheels: [2.2, 0.9] as [number, number],
            at: [] as { x: number; z: number }[],
          },
        ].filter((k) => k.share > 0)
      : [];
  type LaneKind = (typeof laneKinds)[number];
  const fq = newPathQuery();
  const rq = newRoadQuery();
  const parkInLane = (
    k: LaneKind,
    pi: number,
    at: number,
    side: 1 | -1,
    hw: number,
    inset: number,
  ): boolean => {
    if (!net) return false;
    const c = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    const f = { x: 0, z: 0 };
    // Its tail at this slot, its nose a vehicle length on (the next slot on this side stays empty).
    const mid = at - 2.3 + k.halfL;
    net.pointAt(pi, mid - k.halfL, b);
    net.pointAt(pi, mid + k.halfL, f);
    const tl = Math.hypot(f.x - b.x, f.z - b.z) || 1;
    const tx = (f.x - b.x) / tl;
    const tz = (f.z - b.z) / tl;
    net.pointAt(pi, mid, c);
    const lat = side * Math.max(0, hw - inset);
    const x = c.x + tz * lat;
    const z = c.z - tx * lat;
    for (const o of k.at)
      if (Math.hypot(o.x - x, o.z - z) < LANE_VEHICLE_SPACING) return false;
    for (let u = -k.halfL; u <= k.halfL + 0.01; u += k.halfL / 2) {
      const px = x + tx * u;
      const pz = z + tz * u;
      if (ctx.blocked(px, pz, LANE_VEHICLE_HALF_W) || ctx.paved?.(px, pz))
        return false;
      net.query(
        px,
        pz,
        fq,
        undefined,
        (qi) => qi !== pi && !net.paths[qi].bridge,
      );
      if (fq.found && fq.distance <= fq.halfWidth + LANE_VEHICLE_HALF_W)
        return false;
      road.query(px, pz, rq);
      if (rq.found && rq.distance <= rq.halfWidth + 2) return false;
    }
    const dh = Math.abs(
      ctx.height(x + tx * k.halfL, z + tz * k.halfL) -
        ctx.height(x - tx * k.halfL, z - tz * k.halfL),
    );
    if (dh > 1) return false;
    // Nose with the traffic of its side (right = along the street).
    const yaw = side < 0 ? yawAlong(tx, tz) : yawAlong(-tx, -tz);
    placeCar(k.asset, 0, x, z, yaw, k.wheels[0], k.wheels[1]);
    k.at.push({ x, z });
    return true;
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
      // Modelled streets (PathDef.layout): cars only in the real parking lanes, in the middle of the lane. Others: narrow
      // streets are parked on one side only (the other stays open for the cars driving by).
      const lay = p.layout;
      const sides: (1 | -1)[] = lay
        ? ([lay.parkL ? 1 : 0, lay.parkR ? -1 : 0].filter(Boolean) as (
            1 | -1
          )[])
        : p.width >= 7
          ? [1, -1]
          : [rng.chance(0.5) ? 1 : -1];
      if (!sides.length) return;
      const fill = lay ? Math.min(0.85, parked.fill * 2.2) : parked.fill;
      // One fire truck or ambulance at most per street, in its lane like the parked cars (a truck fits a lane lengthwise).
      let laneKind = laneKinds.find((k) => rng.chance(k.share));
      const skipSide = new Map<number, number>();
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
          if ((skipSide.get(side) ?? -1) >= a) continue;
          if (
            laneKind &&
            a + laneKind.halfL * 2 < L - 8 &&
            parkInLane(laneKind, pi, at, side, hw, lay ? PARK_LANE / 2 : 1.25)
          ) {
            laneKind = undefined;
            skipSide.set(side, a + SLOT);
            continue;
          }
          if (!rng.chance(fill)) continue;
          const lat = side * (hw - (lay ? PARK_LANE / 2 : 1.05));
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
          // Half of them face the other way (they were parked from the other direction); on a modelled street the cars
          // of a side face the traffic of that side (right = with the path, left = against it; one-way: all with it).
          const flip = lay
            ? p.oneway || side < 0
              ? 1
              : -1
            : rng.chance(0.5)
              ? 1
              : -1;
          const yaw = yawAlong(tx * flip, tz * flip);
          if (parked.taxiShare && rng.chance(parked.taxiShare))
            placeCar('taxi', 0, x, z, yaw);
          else
            placeCar(
              'street_car',
              STREET_CAR_MIX[rng.int(0, STREET_CAR_MIX.length - 1)],
              x,
              z,
              yaw,
            );
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
          fanVariant(rng.next(), ctx.country, true),
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
        // (not in a driveway's kerb cut; behind a tree lawn the pole stands at the back of the sidewalk all the same)
        if (run.cuts?.some(([c0, c1]) => a > c0 - 1.5 && a < c1 + 1.5))
          continue;
        const lawn = net.paths[run.path].lawn?.[run.side > 0 ? 0 : 1] ?? 0;
        const off = hw + KERB_W + lawn + run.width - 0.4;
        const x = pt.x + ox * off;
        const z = pt.z + oz * off;
        if (ctx.blocked(x, z, 0.5)) continue;
        // No pole under or beside a bridge deck (it would stand up through it): the light of an underpass hangs from
        // its ceiling instead (bridge-mesh.ts `underpassLamps`), elsewhere the slot stays empty.
        net.query(x, z, lq, 'tarmac', (qi) => !!net.paths[qi].bridge);
        const deck =
          nearRoad(x, z).d < road.at(0).halfWidth + 4 ||
          (lq.found && lq.distance <= lq.halfWidth + 2);
        if (deck) continue;
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

  // --- the interchange ramps: marker posts, bend chevrons ---------------------------------------
  const rm = rule.rampMarkers;
  if (rm && net) {
    const mq = newPathQuery();
    const a0 = { x: 0, z: 0 };
    const a1 = { x: 0, z: 0 };
    const a2 = { x: 0, z: 0 };
    net.paths.forEach((p, pi) => {
      if (!p.kind.endsWith('_link') || p.bridge || p.surface !== 'tarmac')
        return;
      const L = net.lengths[pi];
      if (L < 40) return;
      let mx = 0;
      for (let k = 0; k < p.pts.length; k += 2) mx += p.pts[k];
      if (mx / (p.pts.length / 2) < rm.fromX) return;
      const free = (x: number, z: number): boolean => {
        if (ctx.blocked(x, z, 0.6) || ctx.paved?.(x, z)) return false;
        net.query(x, z, mq, 'tarmac', (qi) => qi !== pi);
        return !(mq.found && mq.distance <= mq.halfWidth + 0.3);
      };
      const frame = (a: number) => {
        net.pointAt(pi, Math.max(0, a - 1.5), a0);
        net.pointAt(pi, Math.min(L, a + 1.5), a1);
        const tl = Math.hypot(a1.x - a0.x, a1.z - a0.z) || 1;
        net.pointAt(pi, a, a2);
        return {
          x: a2.x,
          z: a2.z,
          tx: (a1.x - a0.x) / tl,
          tz: (a1.z - a0.z) / tl,
        };
      };
      for (let a = 10; a < L - 10; a += rm.postEvery) {
        const f = frame(a);
        const off = net.halfWidthAt(pi, a) + 1.2;
        const x = f.x - f.tz * off; // right of travel = -(tz, -tx)
        const z = f.z + f.tx * off;
        if (free(x, z)) place('marker_post', 0, x, z, 0, ctx.height(x, z));
      }
      const DS = 16;
      for (let a = DS; a < L - DS; a += rm.chevronEvery) {
        const f0 = frame(a - DS / 2);
        const f1 = frame(a + DS / 2);
        // left turn = the later direction has a component along the earlier one's left (tz, -tx)
        const turn = f1.tx * f0.tz - f1.tz * f0.tx;
        const angle = Math.abs(Math.asin(Math.max(-1, Math.min(1, turn))));
        if (angle < 1e-3 || DS / angle > rm.maxRadius) continue;
        const f = frame(a);
        const left = turn > 0;
        const side = left ? -1 : 1; // the outside of the bend
        const off = net.halfWidthAt(pi, a) + 2.4;
        const x = f.x + f.tz * side * off;
        const z = f.z - f.tx * side * off;
        if (!free(x, z)) continue;
        const heading = Math.atan2(f.tx, f.tz);
        place(
          'chevron_sign',
          left ? 0 : 1,
          x,
          z,
          heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2),
          ctx.height(x, z),
        );
      }
    });
  }

  // --- street trees (census points): not on a road, in a building, on a plaza (those have their own) ----------------
  const st = ctx.streetTrees;
  if (st && net) {
    const tq = newPathQuery();
    for (let i = 0; i + 2 < st.length; i += 3) {
      const x = st[i];
      const z = st[i + 1];
      if (ctx.paved?.(x, z) || ctx.blocked(x, z, 0.9)) continue;
      if (nearRoad(x, z).d < road.at(0).halfWidth + 4) continue;
      net.query(x, z, tq, 'tarmac', (qi) => !net.paths[qi].bridge);
      if (tq.found && tq.distance <= tq.halfWidth + 0.3) continue;
      const rng = new Rng(
        hash3(Math.round(x * 10), Math.round(z * 10), 9, ctx.seed),
      );
      // On a sidewalk (not in a tree lawn): a soil pit round it, square to the street.
      const pathTo = tq.found ? tq.distance - tq.halfWidth : Infinity;
      const tp = tq.found ? net.paths[tq.path] : undefined;
      if (tp && pathTo < 4.5 && !MAINLINE.has(tp.kind)) {
        // (a tree in a measured tree lawn stands in the grass)
        const lawn = Math.max(...(tp.lawn ?? [0, 0]));
        if (!(lawn > 0 && pathTo < KERB_W + lawn + 0.2)) {
          const a = { x: 0, z: 0 };
          const b = { x: 0, z: 0 };
          net.pointAt(tq.path, Math.max(0, tq.along - 1), a);
          net.pointAt(tq.path, Math.min(net.lengths[tq.path], tq.along + 1), b);
          place(
            'tree_pit',
            0,
            x,
            z,
            yawAlong(b.x - a.x, b.z - a.z),
            ctx.height(x, z) + 0.03 + KERB_H + 0.005,
          );
        }
      }
      out.push({
        asset: 'oak_tree',
        variant: rng.int(0, 3),
        x,
        y: ctx.height(x, z),
        z,
        rotY: rng.range(0, Math.PI * 2),
        // trunk diameter (inch) -> size: a 4" sapling is small, a 30" plane tree full grown
        scale: Math.min(1.1, Math.max(0.4, 0.3 + st[i + 2] / 32)),
        tiltX: 0,
        tiltZ: 0,
      });
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
            fanVariant(rng.next(), ctx.country, true),
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
      const park = (
        asset: string,
        length: number,
        yawJitter: number,
        wheels: [number, number],
      ) => {
        const t =
          twoAbreast && n % 2 === 1 ? vehicleEnd : vehicleEnd + length / 2;
        const c = at(t + 0.3, lane(n) + rng.range(-0.3, 0.3));
        if (ctx.blocked(c.x, c.z, length / 2 + 0.5)) return;
        const yaw = yawAlong(-j.dx, -j.dz) + rng.range(-yawJitter, yawJitter);
        // Parked cars of the street stand clear of the vehicle (it was called there first).
        const [fx, fz] = [Math.cos(yaw), -Math.sin(yaw)];
        for (let k = out.length - 1; k >= 0; k--) {
          const o = out[k];
          if (o.asset !== 'street_car' && o.asset !== 'taxi') continue;
          const [dx, dz] = [o.x - c.x, o.z - c.z];
          if (
            Math.abs(dx * fx + dz * fz) < length / 2 + 2 &&
            Math.abs(-dx * fz + dz * fx) < wheels[1] + 2
          )
            out.splice(k, 1);
        }
        placeCar(asset, 0, c.x, c.z, yaw, wheels[0], wheels[1], streetTop);
        n++;
        if (!twoAbreast || n % 2 === 0) vehicleEnd = t + length / 2 + 1.2;
      };
      if (rng.chance(emergency.police))
        park('police_car', 4.6, 0.12, [CAR_HALF_L, CAR_HALF_W]);
      if (
        j.width >= 5 &&
        emergency.ambulance &&
        rng.chance(emergency.ambulance)
      )
        park('ambulance', 6.4, 0.08, [2.2, 0.9]);
      if (j.width >= 5 && rng.chance(emergency.fire))
        park(
          ctx.country === 'mk' ? 'fire_truck_mk' : 'fire_truck',
          9.2,
          0.05,
          ctx.country === 'mk' ? [3, 1.1] : [3.5, 1.2],
        );
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
          fanVariant(rng.next(), ctx.country, true),
          c.x,
          c.z,
          yawToward(-j.dx, -j.dz) + rng.range(-0.5, 0.5),
          streetTop(c.x, c.z),
        );
      }
    }
  });
  // --- village street furniture along the stage road ---------------------------------------------
  const vq = newPathQuery();
  const vrq = newRoadQuery();
  (rule.village ?? []).forEach((v, vi) => {
    const rng = new Rng(hash3(vi, 41, 7, ctx.seed));
    const every = v.every ?? 50;
    const offset = v.offset ?? 2.6;
    for (
      let a = v.from + rng.range(0, every);
      a < v.to;
      a += every * rng.range(0.7, 1.3)
    ) {
      const side = rng.chance(0.5) ? 1 : -1;
      const roll = rng.next();
      // Pieces: asset, variant, metres along the road from `a`, extra metres back from the edge, footprint radius.
      const pieces: [string, number, number, number, number][] =
        roll < 0.4
          ? [
              ['bench', 0, 0, 0, 1.3],
              ['street_bin', 0, rng.chance(0.5) ? 1.8 : -1.8, -0.1, 0.4],
            ]
          : roll < 0.7
            ? [['utility_box', rng.int(0, 1), 0, -0.2, 0.6]]
            : roll < 0.88
              ? [['street_bin', 0, 0, -0.2, 0.4]]
              : [['picnic_table', 0, 0, 1.2, 1.7]];
      if (
        road.bridgeAt(a) ||
        ctx.junctions.some(
          (j) => j.side === side && Math.abs(j.along - a) < j.width / 2 + 6,
        )
      )
        continue;
      const spots = pieces.map(([asset, variant, da, back, r]) => {
        const p = road.at(a + da);
        // left = (tz, -tx)
        const lat = side * (p.halfWidth + offset + back);
        const x = p.x + p.tz * lat;
        const z = p.z - p.tx * lat;
        return { asset, variant, x, z, r, yaw: yawToward(p.x - x, p.z - z) };
      });
      const clear = spots.every(({ x, z, r }) => {
        if (ctx.blocked(x, z, r)) return false;
        road.query(x, z, vrq);
        if (vrq.found && vrq.distance < vrq.halfWidth + r + 0.5) return false;
        if (net) {
          net.query(x, z, vq);
          if (vq.found && vq.distance < vq.halfWidth + r + 0.3) return false;
        }
        // Level enough to stand on (village gardens on a hillside are terraced, not dressed).
        const hs = [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
        ].map(([dx, dz]) => ctx.height(x + dx, z + dz));
        return Math.max(...hs) - Math.min(...hs) < 0.25 + 0.2 * r;
      });
      if (!clear) continue;
      for (const s of spots) place(s.asset, s.variant, s.x, s.z, s.yaw);
    }
  });

  return out;
}
