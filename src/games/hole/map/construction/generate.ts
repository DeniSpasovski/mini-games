import { Rng } from '../../../../shared/rng';
import {
  CONSTRUCTION_ITEMS,
  getItem,
  type ItemInfo,
} from '../../items/catalog';
import {
  CONSTRUCTION_DEFS,
  type ConstructionDef,
  type District,
} from '../../items/catalog-construction';
import { Occupancy } from '../generate';
import type { GroundRect, MapData, Placement, ZoneInfo } from '../types';
import {
  DISTRICT_NAMES,
  LANE,
  MINE,
  ROAD_W,
  SITE,
  onRoad,
  plots,
  roadNet,
  roadStrips,
  type Plot,
} from './layout';

/**
 * Construction City generator (CONSTRUCTION-CITY.md section 4): seed -> ground rects, every placement and
 * the truck road graph. Pure data (no three.js, no DOM), deterministic per seed, exactly `points` points:
 * a per-tier point budget is shared by the types of each tier, the biggest are placed first, small items
 * gather round work spots, then small items are trimmed or 1-point bricks added until the total is exact.
 */
export interface ConstructionParams {
  seed: number;
  /** Total points on the map (before the clear bonus). */
  points: number;
  /** Share of the points per size tier 1..25 (balance experiments; default `TIER_FRACTION`). */
  tiers?: number[];
}

export const DEFAULT_CONSTRUCTION: ConstructionParams = {
  seed: 1,
  points: 24000,
};

export function constructionTargetPoints(
  p: Pick<ConstructionParams, 'points'>,
): number {
  return p.points;
}

/** Share of the points of each size tier 1..25 (normalised): a long middle, lighter at the very top. */
const TIER_FRACTION = [
  0.075, 0.05, 0.05, 0.055, 0.055, 0.055, 0.055, 0.05, 0.05, 0.05, 0.045, 0.04,
  0.04, 0.04, 0.04, 0.04, 0.035, 0.035, 0.035, 0.04, 0.035, 0.03, 0.03, 0.025,
  0.025,
];

/** Ground colours of the districts, the roads and the mine terraces. */
export const SITE_COLORS = {
  dirt: 0xb08a62,
  dirtAlt: 0xa8825b,
  road: 0x9c968c,
  track: 0x878177,
  line: 0xf2efe6,
  apron: 0xc4c0b6,
  hoarding: [0x2f6fb5, 0xf2c230],
  terrace: [0xb87a4a, 0xa86d41, 0x98613a],
  district: {
    gate: 0xbab3a5,
    brickyard: 0xbf8467,
    roadworks: 0x5a5d61,
    housing: 0x8fae6a,
    yard: 0xc9c6bd,
    foundations: 0x7a5c43,
    depot: 0xbdbab2,
    towers: 0xcfccc4,
    mine: 0xc58652,
  } satisfies Record<District, number>,
};

const DEF = new Map<string, ConstructionDef>(
  CONSTRUCTION_DEFS.map((d) => [d.id, d]),
);
const radius = (it: ItemInfo) => Math.max(it.w, it.d) / 2;
const pts = (id: string) => getItem(id).points;
const homesOf = (id: string): District[] | 'everywhere' => DEF.get(id)!.homes;
const motionOf = (id: string) => DEF.get(id)!.motion;

/** Items that face the camera (+Z) give or take a little; machines park along a road axis. */
const FACING = new Set(['crew', 'site', 'structures']);
const AXIS = new Set(['plant', 'trucks', 'mining', 'cranes']);

/** Work spots (pallet piles, crews, spills) per m2 of district, and their spread (m). */
const SPOT_AREA = 900;
const SPOT_SIGMA = 8;
/** Edge margin inside the hoarding (m). */
const MARGIN = 3;
/** Road trucks that drive (the rest of their copies park in their districts). */
const MAX_DRIVERS = 44;

interface Ctx {
  rng: Rng;
  placements: Placement[];
  rects: GroundRect[];
  occ: Occupancy;
  plots: Plot[];
  spots: Map<District, { x: number; z: number }[]>;
  start: { x: number; z: number };
  /** Free lane slots of the driving trucks: arm end points, lane side and an offset along the arm. */
  slots: { fx: number; fz: number; tx: number; tz: number; t: number }[];
  drivers: number;
}

function put(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot: number,
  o: { occ?: boolean } = {},
): Placement {
  const it = getItem(id);
  const p: Placement = {
    item: id,
    x,
    z,
    rot,
    variant: it.variants > 1 ? c.rng.int(0, it.variants - 1) : 0,
    paint: it.paints?.length ? c.rng.int(0, it.paints.length - 1) : -1,
  };
  c.placements.push(p);
  if (o.occ !== false) c.occ.add(x, z, radius(it));
  return p;
}

const inPlot = (q: Plot, x: number, z: number, r: number) =>
  x - r >= q.x0 + MARGIN * 0.5 &&
  x + r <= q.x1 - MARGIN * 0.5 &&
  z - r >= q.z0 + MARGIN * 0.5 &&
  z + r <= q.z1 - MARGIN * 0.5;

function inside(x: number, z: number, r: number): boolean {
  return (
    Math.abs(x) + r <= SITE.hx - MARGIN && Math.abs(z) + r <= SITE.hz - MARGIN
  );
}

function tryPut(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot: number,
): boolean {
  const it = getItem(id);
  const r = radius(it);
  if (!inside(x, z, Math.min(r, 6))) return false;
  if (onRoad(x, z, r * 0.8)) return false;
  if (Math.hypot(x - c.start.x, z - c.start.z) < 3 + r) return false;
  if (!c.occ.free(x, z, r)) return false;
  put(c, id, x, z, rot);
  return true;
}

function yawFor(c: Ctx, it: ItemInfo): number {
  if (FACING.has(it.group))
    return c.rng.chance(0.25) ? c.rng.range(-0.4, 0.4) : 0;
  if (AXIS.has(it.group) && c.rng.chance(0.7))
    return c.rng.pick([0, Math.PI, Math.PI / 2, -Math.PI / 2]);
  return c.rng.range(0, Math.PI * 2);
}

function rect(
  c: Ctx,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  color: number,
): void {
  c.rects.push({ x0, z0, x1, z1, y, color });
}

// ------------------------------------------------------------------------------------------------ ground

function buildGround(c: Ctx): void {
  for (const q of c.plots) {
    const e = q.district === 'mine' ? 0 : 1.5;
    rect(
      c,
      q.x0 + e,
      q.z0 + e,
      q.x1 - e,
      q.z1 - e,
      0.01,
      SITE_COLORS.district[q.district],
    );
    if (q.district === 'depot')
      // parking bays: two rows of white lines along the north and south edges
      for (let x = q.x0 + 6; x <= q.x1 - 6; x += 7)
        for (const [za, zb] of [
          [q.z0 + 4, q.z0 + 16],
          [q.z1 - 16, q.z1 - 4],
        ])
          rect(c, x - 0.15, za, x + 0.15, zb, 0.016, SITE_COLORS.line);
  }
  // the mine pit: stepped terrace bands, darker towards the bottom
  SITE_COLORS.terrace.forEach((col, k) => {
    const i = 16 + k * 18;
    rect(
      c,
      MINE.x0 + i,
      MINE.z0 + i * 0.7,
      MINE.x1 - i,
      MINE.z1 - i * 0.7,
      0.012 + k * 0.002,
      col,
    );
  });
  // gravel roads with two darker wheel tracks per lane
  for (const s of roadStrips()) {
    const h = ROAD_W / 2;
    const band = (lo: number, hi: number, y: number, col: number) =>
      s.axis === 'x'
        ? rect(c, s.at + lo, s.a, s.at + hi, s.b, y, col)
        : rect(c, s.a, s.at + lo, s.b, s.at + hi, y, col);
    band(-h, h, 0.02 + (s.axis === 'z' ? 0.002 : 0), SITE_COLORS.road);
    for (const k of [-1, 1])
      for (const off of [LANE - 0.9, LANE + 0.9])
        band(k * off - 0.35, k * off + 0.35, 0.026, SITE_COLORS.track);
  }
  // the gate apron
  rect(c, -16, SITE.hz - 14, 16, SITE.hz, 0.03, SITE_COLORS.apron);
}

// ------------------------------------------------------------------------------------------- placement

function plotsOf(c: Ctx, homes: District[] | 'everywhere'): Plot[] {
  if (homes === 'everywhere') return c.plots;
  return c.plots.filter((q) => homes.includes(q.district));
}

function area(q: Plot): number {
  return (q.x1 - q.x0) * (q.z1 - q.z0);
}

function pickPlot(c: Ctx, list: Plot[]): Plot {
  let roll = c.rng.next() * list.reduce((a, q) => a + area(q), 0);
  for (const q of list) {
    roll -= area(q);
    if (roll <= 0) return q;
  }
  return list[list.length - 1];
}

/** Place one copy of `it` somewhere in its homes: small items near a work spot, big ones anywhere. */
function placeIn(c: Ctx, it: ItemInfo, list: Plot[], tries: number): boolean {
  const r = radius(it);
  for (let k = 0; k < tries; k++) {
    const q = pickPlot(c, list);
    let x: number;
    let z: number;
    const spots = c.spots.get(q.district) ?? [];
    if (it.tier <= 12 && spots.length && c.rng.chance(0.88)) {
      const s = c.rng.pick(spots);
      const sigma = SPOT_SIGMA * (it.tier <= 6 ? 0.7 : 1.2);
      x = s.x + c.rng.gauss() * sigma;
      z = s.z + c.rng.gauss() * sigma;
      if (!inPlot(q, x, z, Math.min(r, 4))) continue;
    } else {
      const m = Math.min(r, (q.x1 - q.x0) / 2 - 1, (q.z1 - q.z0) / 2 - 1);
      x = c.rng.range(q.x0 + m, q.x1 - m);
      z = c.rng.range(q.z0 + m, q.z1 - m);
    }
    if (tryPut(c, it.id, x, z, yawFor(c, it))) return true;
  }
  return false;
}

/** A road truck in a free lane slot, with its `drive` spec (as on City Island). */
function placeDriver(c: Ctx, it: ItemInfo): boolean {
  if (c.drivers >= MAX_DRIVERS) return false;
  for (let k = 0; k < 6 && c.slots.length; k++) {
    const i = c.rng.int(0, c.slots.length - 1);
    const s = c.slots[i];
    const dx = Math.sign(s.tx - s.fx);
    const dz = Math.sign(s.tz - s.fz);
    // right-hand lane: offset to the right of the driving direction
    const x = s.fx + (s.tx - s.fx) * s.t - dz * LANE;
    const z = s.fz + (s.tz - s.fz) * s.t + dx * LANE;
    const r = radius(it);
    if (!c.occ.free(x, z, r * 0.6)) {
      c.slots.splice(i, 1);
      continue;
    }
    c.slots.splice(i, 1);
    const p = put(c, it.id, x, z, -Math.atan2(dz, dx), { occ: false });
    c.occ.add(x, z, r * 0.6);
    const speedRng = new Rng(Math.round(x * 31 + z * 17) * 2654435 + 977);
    p.move = {
      kind: 'drive',
      hx: s.fx,
      hz: s.fz,
      tx: s.tx,
      tz: s.tz,
      leash: LANE,
      speed: it.size > 8 ? speedRng.range(4, 6) : speedRng.range(5.5, 8),
      delay: speedRng.range(0, 2),
      flee: false,
    };
    c.drivers++;
    return true;
  }
  return false;
}

/**
 * A machine that shuttles: haul trucks up and down the mine, forklifts across the yard. The whole path is
 * reserved in the occupancy, so nothing else stands in the way.
 */
function placePatrol(c: Ctx, it: ItemInfo, list: Plot[]): boolean {
  const r = radius(it);
  const big = it.group === 'mining';
  for (let k = 0; k < 40; k++) {
    const q = pickPlot(c, list);
    const alongX = c.rng.chance(big ? 0.7 : 0.5);
    const len = big ? c.rng.range(50, 90) : c.rng.range(8, 16);
    const m = r + 1;
    const x0 = c.rng.range(q.x0 + m, q.x1 - m - (alongX ? len : 0));
    const z0 = c.rng.range(q.z0 + m, q.z1 - m - (alongX ? 0 : len));
    const x1 = alongX ? x0 + len : x0;
    const z1 = alongX ? z0 : z0 + len;
    if (!inPlot(q, x0, z0, r) || !inPlot(q, x1, z1, r)) continue;
    const n = Math.ceil(len / Math.max(2, r * 0.8));
    let ok = true;
    for (let s = 0; s <= n && ok; s++) {
      const x = x0 + ((x1 - x0) * s) / n;
      const z = z0 + ((z1 - z0) * s) / n;
      ok = c.occ.free(x, z, r) && !onRoad(x, z, r * 0.8);
    }
    if (!ok) continue;
    for (let s = 0; s <= n; s++)
      c.occ.add(x0 + ((x1 - x0) * s) / n, z0 + ((z1 - z0) * s) / n, r);
    const back = c.rng.chance(0.5);
    const p = put(c, it.id, back ? x1 : x0, back ? z1 : z0, 0, { occ: false });
    p.rot = alongX ? (back ? Math.PI : 0) : back ? Math.PI / 2 : -Math.PI / 2;
    p.move = {
      kind: 'patrol',
      hx: p.x,
      hz: p.z,
      tx: back ? x0 : x1,
      tz: back ? z0 : z1,
      leash: len + 1,
      speed: big ? c.rng.range(3.5, 5.5) : c.rng.range(1.5, 2.5),
      delay: c.rng.range(0, 4),
      flee: false,
    };
    return true;
  }
  return false;
}

/** Copy `it` once, by its motion: drivers on the roads, shuttles on a cleared path, walkers that wander. */
function placeOne(c: Ctx, it: ItemInfo, tries = 40): boolean {
  const list = plotsOf(c, homesOf(it.id));
  const motion = motionOf(it.id);
  if (motion === 'drive' && placeDriver(c, it)) return true;
  if (motion === 'patrol' && placePatrol(c, it, list)) return true;
  if (!placeIn(c, it, list, tries)) return false;
  if (motion === 'wander') {
    const p = c.placements[c.placements.length - 1];
    p.move = {
      kind: 'wander',
      hx: p.x,
      hz: p.z,
      leash: c.rng.range(3, 6),
      speed: c.rng.range(1, 1.5),
    };
  }
  return true;
}

function initSlots(
  c: Ctx,
  net: { nodes: [number, number][]; edges: [number, number][] },
) {
  for (const [a, b] of net.edges) {
    const [ax, az] = net.nodes[a];
    const [bx, bz] = net.nodes[b];
    for (const [f, t] of [
      [a, b],
      [b, a],
    ]) {
      const [fx, fz] = net.nodes[f];
      const [tx, tz] = net.nodes[t];
      const len = Math.hypot(bx - ax, bz - az);
      // two slots per lane on a long arm, one on a short one; never in a crossing
      const n = len > 60 ? 2 : 1;
      for (let k = 0; k < n; k++)
        c.slots.push({
          fx,
          fz,
          tx,
          tz,
          t: (k + 0.5 + c.rng.range(-0.15, 0.15)) / n,
        });
    }
  }
}

function initSpots(c: Ctx): void {
  for (const q of c.plots) {
    const n = Math.max(2, Math.round(area(q) / SPOT_AREA));
    const list = c.spots.get(q.district) ?? [];
    for (let k = 0; k < n; k++)
      list.push({
        x: c.rng.range(q.x0 + 8, q.x1 - 8),
        z: c.rng.range(q.z0 + 8, q.z1 - 8),
      });
    c.spots.set(q.district, list);
  }
}

/** Per-tier point budgets shared by the types of each tier; copies are placed biggest first. */
function fill(c: Ctx, target: number, fractions: number[]): void {
  const norm = fractions.reduce((a, b) => a + b, 0);
  const plan: { it: ItemInfo; copies: number }[] = [];
  for (let t = 1; t <= 25; t++) {
    const list = CONSTRUCTION_ITEMS.filter((i) => i.tier === t);
    if (!list.length) continue;
    const budget = (fractions[t - 1] / norm) * target;
    const weight = (i: ItemInfo) =>
      i.group === 'heaps' ? 0.7 : i.group === 'crew' ? 1.4 : 1;
    const sum = list.reduce((a, i) => a + weight(i), 0);
    for (const it of list)
      plan.push({
        it,
        copies: Math.max(
          1,
          Math.round((budget * weight(it)) / sum / it.points),
        ),
      });
  }
  plan.sort((a, b) => b.it.size - a.it.size);
  // one of each first (biggest first), so every type gets a spot before the copies crowd the plots
  for (const q of plan) placeOne(c, q.it, 120);
  for (const q of plan)
    for (let k = 1; k < q.copies; k++) if (!placeOne(c, q.it)) break;
}

/** Every type appears at least once, whatever the random fill did. */
function ensureAllTypes(c: Ctx): void {
  const have = new Set(c.placements.map((p) => p.item));
  for (const it of CONSTRUCTION_ITEMS) {
    if (have.has(it.id)) continue;
    if (placeOne(c, it, 400)) continue;
    if (placeIn(c, it, c.plots, 400)) continue;
    // last resort: overlap something rather than drop a type
    const q = plotsOf(c, homesOf(it.id))[0] ?? c.plots[0];
    put(c, it.id, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, 0, { occ: false });
  }
}

/** Tier 1-3 scatter round the start so the first seconds are busy. */
function startScatter(c: Ctx): void {
  const ids = CONSTRUCTION_ITEMS.filter(
    (i) => i.tier <= 3 && motionOf(i.id) === '-',
  ).map((i) => i.id);
  let n = 0;
  for (let i = 0; i < 600 && n < 44; i++) {
    const a = c.rng.range(0, Math.PI * 2);
    const d = c.rng.range(3.5, 22);
    const id = n < 26 ? c.rng.pick(TIER1) : c.rng.pick(ids);
    if (
      tryPut(
        c,
        id,
        c.start.x + Math.cos(a) * d,
        c.start.z + Math.sin(a) * d,
        c.rng.range(0, 6.28),
      )
    )
      n++;
  }
}

const TIER1 = CONSTRUCTION_ITEMS.filter(
  (i) => i.tier === 1 && motionOf(i.id) === '-',
).map((i) => i.id);

function total(c: Ctx): number {
  return c.placements.reduce((s, p) => s + pts(p.item), 0);
}

/** Trim small items when over the target, then top up with 1-point pieces until exact. */
function balancePoints(c: Ctx, target: number): void {
  const s = c.start;
  let sum = total(c);
  const smallTier = (max: number) =>
    new Set(CONSTRUCTION_ITEMS.filter((i) => i.tier <= max).map((i) => i.id));
  for (const set of [smallTier(1), smallTier(3), smallTier(8), smallTier(14)]) {
    if (sum <= target) break;
    const idx: number[] = [];
    c.placements.forEach((p, i) => {
      if (set.has(p.item) && !p.move && Math.hypot(p.x - s.x, p.z - s.z) > 28)
        idx.push(i);
    });
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(c.rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const drop = new Set<number>();
    for (const i of idx) {
      if (sum <= target) break;
      // never step below the target: a bigger item is only dropped when the gap can be refilled
      drop.add(i);
      sum -= pts(c.placements[i].item);
    }
    c.placements = c.placements.filter((_, i) => !drop.has(i));
  }
  const live = c.plots.filter((q) => q.district !== 'mine');
  let guard = 0;
  while (sum < target && guard++ < 200000) {
    const id = c.rng.pick(TIER1);
    let placed = false;
    for (let attempt = 0; attempt < 30 && !placed; attempt++) {
      const near = c.rng.chance(0.2);
      const q = pickPlot(c, live);
      const spots = c.spots.get(q.district) ?? [];
      const sp = spots.length && c.rng.chance(0.7) ? c.rng.pick(spots) : null;
      const x = near
        ? s.x + c.rng.range(-24, 24)
        : sp
          ? sp.x + c.rng.gauss() * SPOT_SIGMA
          : c.rng.range(q.x0 + 1.5, q.x1 - 1.5);
      const z = near
        ? s.z + c.rng.range(-16, 16)
        : sp
          ? sp.z + c.rng.gauss() * SPOT_SIGMA
          : c.rng.range(q.z0 + 1.5, q.z1 - 1.5);
      placed = tryPut(c, id, x, z, c.rng.range(0, 6.28));
    }
    if (!placed) {
      const q = pickPlot(c, live);
      put(
        c,
        id,
        c.rng.range(q.x0 + 1.5, q.x1 - 1.5),
        c.rng.range(q.z0 + 1.5, q.z1 - 1.5),
        c.rng.range(0, 6.28),
        {
          occ: false,
        },
      );
    }
    sum += pts(id);
  }
}

function zoneInfo(q: Plot): ZoneInfo {
  return {
    id: `${q.district}-${q.r}-${q.c}`,
    name: DISTRICT_NAMES[q.district],
    x0: q.x0,
    z0: q.z0,
    x1: q.x1,
    z1: q.z1,
    color: SITE_COLORS.district[q.district],
  };
}

export function generateConstructionCity(
  params: Partial<ConstructionParams> = {},
): MapData {
  const p: ConstructionParams = { ...DEFAULT_CONSTRUCTION, ...params };
  const rng = new Rng(p.seed * 15485863 + 211);
  const net = roadNet();
  const c: Ctx = {
    rng,
    placements: [],
    rects: [],
    occ: new Occupancy(),
    plots: plots(),
    spots: new Map(),
    // the west plot of the Site Gate, about 30 m inside the gate
    start: { x: -30, z: SITE.hz - 30 },
    slots: [],
    drivers: 0,
  };
  buildGround(c);
  initSpots(c);
  initSlots(c, net);
  const target = constructionTargetPoints(p);
  startScatter(c);
  fill(c, target, p.tiers ?? TIER_FRACTION);
  ensureAllTypes(c);
  balancePoints(c, target);
  return {
    id: 'construction',
    seed: p.seed,
    coast: new Array<number>(8).fill(Math.hypot(SITE.hx, SITE.hz)),
    bounds: { hx: SITE.hx, hz: SITE.hz, inset: 0.15, door: 0 },
    beachWidth: 0,
    rects: c.rects,
    blocks: [],
    zones: c.plots.map(zoneInfo),
    placements: c.placements,
    start: c.start,
    roads: net,
  };
}
