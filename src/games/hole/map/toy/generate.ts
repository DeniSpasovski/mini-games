import { Rng } from '../../../../shared/rng';
import { TOY_ITEMS, getItem, type ItemInfo } from '../../items/catalog';
import { Occupancy } from '../generate';
import type { GroundRect, MapData, Placement, ZoneInfo } from '../types';
import { shuffledLayout, type ToyLayout, type ZoneDef } from './layouts';

/**
 * Toy Emporium generator: seed (department positions, items) -> department floor mats, every item
 * placement, a start next to the checkout. Pure data (no three.js, no DOM),
 * deterministic per seed. Like City Island, every seed holds exactly
 * `points` points (D6 in TOY-STORE.md): the layout is filled zone by zone, then
 * small filler items are trimmed or added until the total is exact.
 */
export interface ToyParams {
  seed: number;
  /** Total points on the map (before the clear bonus). */
  points: number;
}

export const DEFAULT_TOY: ToyParams = { seed: 1, points: 9000 };

export const TOY_COLORS = {
  tileA: 0xf6efe0,
  tileB: 0xeee3cc,
  tape: 0xffffff,
  tapeYellow: 0xf2c230,
  door: 0x6a5a48,
  skirt: 0x8a7a66,
};

export function toyTargetPoints(p: Pick<ToyParams, 'points'>): number {
  return p.points;
}

interface Ctx {
  rng: Rng;
  layout: ToyLayout;
  placements: Placement[];
  rects: GroundRect[];
  occ: Occupancy;
  /** Copies placed per item id (for the very-big cap). */
  count: Map<string, number>;
  /** Very big types left out of this seed's store. */
  skip: Set<string>;
}

/** Items from this size tier up are "very big" (tier 18 = 11 m and more). */
export const VERY_BIG_TIER = 18;
/** Most copies of each very big item type on the map. */
export const MAX_VERY_BIG_COPIES = 1;

/** Share of the very big types of each tier that a seed stocks (at least 2 per tier, the ladder needs them). */
export const VERY_BIG_KEEP = 0.5;

/** Floor area (m2) per scatter cluster and the cluster spread (m). */
const CLUSTER_AREA = 700;
const CLUSTER_SIGMA = 7;

const radius = (it: ItemInfo) => Math.max(it.w, it.d) / 2;
const pts = (id: string) => getItem(id).points;

/** Items that stay upright facing the shopper (+Z); everything else gets a random yaw. */
const FACING = new Set([
  'store',
  'games',
  'dolls',
  'figures',
  'landmark',
  'bricks',
]);
const AXIS = new Set(['toyveh', 'robots']);

function put(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot: number,
  o: { occ?: boolean } = {},
): void {
  const it = getItem(id);
  c.placements.push({
    item: id,
    x,
    z,
    rot,
    variant: it.variants > 1 ? c.rng.int(0, it.variants - 1) : 0,
    paint: it.paints?.length ? c.rng.int(0, it.paints.length - 1) : -1,
  });
  if (o.occ !== false) c.occ.add(x, z, radius(it));
  c.count.set(id, (c.count.get(id) ?? 0) + 1);
}

function tryPut(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot: number,
  inset = 2,
): boolean {
  const it = getItem(id);
  const { hx, hz } = c.layout;
  if (Math.abs(x) > hx - inset || Math.abs(z) > hz - inset) return false;
  if (!c.occ.free(x, z, radius(it))) return false;
  if (c.skip.has(id)) return false;
  if (it.tier >= VERY_BIG_TIER && (c.count.get(id) ?? 0) >= MAX_VERY_BIG_COPIES)
    return false;
  put(c, id, x, z, rot);
  return true;
}

function yawFor(c: Ctx, it: ItemInfo): number {
  if (FACING.has(it.group))
    return c.rng.chance(0.2) ? c.rng.range(-0.25, 0.25) : 0;
  if (AXIS.has(it.group))
    return c.rng.pick([0, 0, Math.PI, Math.PI / 2, -Math.PI / 2]);
  return c.rng.range(0, Math.PI * 2);
}

const isAtrium = (z: ZoneDef) => z.depts.includes('Atrium');

function dept(it: ItemInfo): string {
  return it.where.split(' - ')[0];
}

/** Plush families that are stocked in another department than the meadow (water animals by the pool). */
const PLUSH_ELSEWHERE = /^plush_(whale|penguin)_/;

/** Which department an item is homed in. Big showpieces live in the atrium. */
export function homeOf(it: ItemInfo): string {
  const d = dept(it);
  if (d === 'Stockroom') return d;
  if (PLUSH_ELSEWHERE.test(it.id) && it.size <= 14.5) return 'Splash Zone';
  if (it.size > 14.5) return 'Atrium';
  if (it.group === 'plush' && it.size > 20) return 'Atrium';
  return d;
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

function buildFloor(c: Ctx): void {
  const { hx, hz, zones } = c.layout;
  // big pastel checker tiles (10 m), a sense of speed and scale
  const size = 10;
  for (let gx = -Math.ceil(hx / size); gx < Math.ceil(hx / size); gx++)
    for (let gz = -Math.ceil(hz / size); gz < Math.ceil(hz / size); gz++) {
      if ((gx + gz) % 2 === 0) continue;
      rect(
        c,
        gx * size,
        gz * size,
        gx * size + size,
        gz * size + size,
        0.004,
        TOY_COLORS.tileB,
      );
    }
  // department mats with a white tape border
  zones.forEach((z, i) => {
    const e = 0.5;
    rect(c, z.x0, z.z0, z.x1, z.z1, 0.012 + i * 0.0006, z.color);
    rect(c, z.x0, z.z0, z.x1, z.z0 + e, 0.03, TOY_COLORS.tape);
    rect(c, z.x0, z.z1 - e, z.x1, z.z1, 0.03, TOY_COLORS.tape);
    rect(c, z.x0, z.z0, z.x0 + e, z.z1, 0.03, TOY_COLORS.tape);
    rect(c, z.x1 - e, z.z0, z.x1, z.z1, 0.03, TOY_COLORS.tape);
  });
  // door mat at the entrance (south wall) and yellow guide stripes from it
  const dx = c.layout.doorX;
  rect(c, dx - 12, hz - 5, dx + 12, hz, 0.034, TOY_COLORS.door);
  rect(c, dx - 0.6, -hz + 5, dx + 0.6, hz - 5, 0.036, TOY_COLORS.tapeYellow);
}

/** Random weighted pick of an item (weight ~ 1/points^0.8: roughly even points per tier). */
function weighted(rng: Rng, pool: { it: ItemInfo; w: number }[]): ItemInfo {
  let total = 0;
  for (const p of pool) total += p.w;
  let roll = rng.next() * total;
  for (const p of pool) {
    roll -= p.w;
    if (roll <= 0) return p.it;
  }
  return pool[pool.length - 1].it;
}

function poolFor(z: ZoneDef): { it: ItemInfo; w: number }[] {
  const out: { it: ItemInfo; w: number }[] = [];
  for (const it of TOY_ITEMS) {
    const home = homeOf(it);
    const everywhere = dept(it) === 'everywhere';
    const bigAtrium = isAtrium(z) && it.size >= 9 && dept(it) !== 'Stockroom';
    if (!z.depts.includes(home) && !(everywhere && !isAtrium(z)) && !bigAtrium)
      continue;
    // shelf units are placed in rows, not scattered
    if (z.shelves.includes(it.id) || it.id === 'gondola_shelf') continue;
    let w = 1;
    if (everywhere || bigAtrium) w *= 0.6;
    out.push({ it, w });
  }
  return out;
}

function zoneInfo(z: ZoneDef): ZoneInfo {
  return {
    id: z.id,
    name: z.name,
    x0: z.x0,
    z0: z.z0,
    x1: z.x1,
    z1: z.z1,
    color: z.color,
  };
}

/** Rows of department shelves along X, fronts to the south, with aisles between. */
function shelfRows(c: Ctx, z: ZoneDef, budget: number): number {
  if (isAtrium(z) || z.depts.includes('Stockroom')) return 0;
  const ids = ['gondola_shelf', ...z.shelves];
  const pitch = 15;
  let points = 0;
  const rows = Math.max(1, Math.floor((z.z1 - z.z0 - 12) / pitch));
  for (let r = 0; r < rows; r++) {
    const zz = z.z0 + 9 + r * pitch;
    let x = z.x0 + 4;
    let n = 0;
    while (points < budget * 0.35) {
      const id = ids[n++ % ids.length];
      const it = getItem(id);
      if (x + it.w > z.x1 - 3) break;
      const variant = id === 'gondola_shelf' ? z.shelfVariant : 0;
      if (c.occ.free(x + it.w / 2, zz, 0.5)) {
        c.placements.push({
          item: id,
          x: x + it.w / 2,
          z: zz,
          rot: 0,
          variant: variant % it.variants,
          paint: -1,
        });
        c.occ.add(x + it.w / 2, zz, 0.9);
        points += it.points;
      }
      x += it.w + 0.15;
    }
    if (points >= budget * 0.35) break;
  }
  return points;
}

function fillZone(
  c: Ctx,
  z: ZoneDef,
  target: number,
  start: { x: number; z: number },
): void {
  const budget = z.share * target;
  let points = 0;
  for (const [id, x, zz, rot] of z.anchors ?? []) {
    const a = getItem(id);
    if (
      c.skip.has(id) ||
      (a.tier >= VERY_BIG_TIER && (c.count.get(id) ?? 0) >= MAX_VERY_BIG_COPIES)
    )
      continue;
    put(c, id, x, zz, rot);
    points += pts(id);
  }
  // one of every large item homed here, placed before the random fill crowds the floor
  const placed = new Set(c.placements.map((q) => q.item));
  for (const it of TOY_ITEMS) {
    if (it.tier < 11 || placed.has(it.id) || !z.depts.includes(homeOf(it)))
      continue;
    for (let attempt = 0; attempt < 500; attempt++) {
      const r = Math.min(radius(it), 20);
      const x = c.rng.range(z.x0 + 2 + r, z.x1 - 2 - r);
      const zz = c.rng.range(z.z0 + 2 + r, z.z1 - 2 - r);
      if (tryPut(c, it.id, x, zz, yawFor(c, it))) {
        points += it.points;
        break;
      }
    }
  }
  points += shelfRows(c, z, budget);

  const pool = poolFor(z);
  if (!pool.length) return;
  const margin = 2;
  // loose items gather in clusters (displays, spills, bins) with empty floor between them, so the
  // hole has to travel like it does between City Island blocks
  const area = (z.x1 - z.x0) * (z.z1 - z.z0);
  const clusters = Array.from(
    { length: Math.max(3, Math.round(area / CLUSTER_AREA)) },
    () => ({
      x: c.rng.range(z.x0 + 6, z.x1 - 6),
      z: c.rng.range(z.z0 + 6, z.z1 - 6),
    }),
  );
  const tryItem = (it: ItemInfo, tries: number): boolean => {
    const r = radius(it);
    for (let attempt = 0; attempt < tries; attempt++) {
      if (r < 8 && c.rng.chance(0.9)) {
        const k = c.rng.pick(clusters);
        const cx = k.x + c.rng.gauss() * CLUSTER_SIGMA;
        const cz = k.z + c.rng.gauss() * CLUSTER_SIGMA;
        if (
          cx < z.x0 + margin ||
          cx > z.x1 - margin ||
          cz < z.z0 + margin ||
          cz > z.z1 - margin
        )
          continue;
        if (Math.hypot(cx - start.x, cz - start.z) < 3) continue;
        if (tryPut(c, it.id, cx, cz, yawFor(c, it))) return true;
        continue;
      }
      const x = c.rng.range(
        z.x0 + margin + Math.min(r, 16),
        z.x1 - margin - Math.min(r, 16),
      );
      const zz = c.rng.range(
        z.z0 + margin + Math.min(r, 16),
        z.z1 - margin - Math.min(r, 16),
      );
      if (Math.hypot(x - start.x, zz - start.z) < 3) continue;
      if (tryPut(c, it.id, x, zz, yawFor(c, it))) return true;
    }
    return false;
  };
  // type quotas: points per type ~ points^0.8, so bigger types get more points but fewer copies; big first
  const beta = 1;
  const sumW = pool.reduce((a, q) => a + Math.pow(q.it.points, beta) * q.w, 0);
  const sorted = [...pool].sort((a, b) => b.it.size - a.it.size);
  const left = Math.max(0, budget - points);
  for (const q of sorted) {
    const quota = (left * Math.pow(q.it.points, beta) * q.w) / sumW;
    const copies = Math.max(1, Math.round(quota / q.it.points));
    for (let i = 0; i < copies && points < budget + 12; i++)
      if (tryItem(q.it, 40)) points += q.it.points;
  }
  // top up what the quotas could not place
  let misses = 0;
  for (
    let guard = 0;
    guard < 8000 && points < budget && misses < 150;
    guard++
  ) {
    const it = weighted(c.rng, pool);
    if (points + it.points > budget + 12) {
      misses++;
      continue;
    }
    if (tryItem(it, 12)) {
      points += it.points;
      misses = 0;
    } else misses++;
  }
}

/** Every item type up to size tier 20 appears at least once, whatever the random layout did. */
function ensureAllTypes(c: Ctx): void {
  const have = new Set(c.placements.map((p) => p.item));
  const zones = c.layout.zones;
  for (const it of TOY_ITEMS) {
    if (have.has(it.id) || c.skip.has(it.id)) continue;
    const home =
      zones.find((z) => z.depts.includes(homeOf(it))) ??
      zones[zones.length - 1];
    const tryZone = (z: ZoneDef) => {
      for (let attempt = 0; attempt < 800; attempt++) {
        const x = c.rng.range(z.x0 + 3, z.x1 - 3);
        const zz = c.rng.range(z.z0 + 3, z.z1 - 3);
        if (tryPut(c, it.id, x, zz, yawFor(c, it), 3)) return true;
      }
      return false;
    };
    let ok = tryZone(home);
    for (const z of zones) if (!ok) ok = tryZone(z);
    if (!ok) {
      // last resort: overlap something rather than drop a type
      put(
        c,
        it.id,
        c.rng.range(home.x0 + 3, home.x1 - 3),
        c.rng.range(home.z0 + 3, home.z1 - 3),
        0,
        { occ: false },
      );
    }
  }
}

/** Light T1-T3 scatter around the start so the first seconds are busy. */
function startScatter(c: Ctx): void {
  const s = c.layout.start;
  const ids = [
    'brick_2x2',
    'brick_2x4',
    'minifigure',
    'bouncy_ball',
    'puzzle_piece',
    'alphabet_block',
    'rubber_duck',
    'brick_pile',
    'plush_keychain',
    'dino_figure',
    'action_figure',
    'toy_car_mini',
  ];
  let n = 0;
  for (let i = 0; i < 400 && n < 36; i++) {
    const a = c.rng.range(0, Math.PI * 2);
    const d = c.rng.range(3.5, 22);
    const id = c.rng.pick(ids);
    if (
      tryPut(
        c,
        id,
        s.x + Math.cos(a) * d,
        s.z + Math.sin(a) * d,
        c.rng.range(0, 6.28),
        2,
      )
    )
      n++;
  }
}

const FILL: [string, number][] = [
  ['puzzle_piece', 8],
  ['brick_2x2', 8],
  ['brick_2x4', 5],
  ['bouncy_ball', 5],
  ['packing_peanuts', 4],
  ['confetti_pile', 3],
  ['brick_pile', 3],
  ['alphabet_block', 3],
  ['minifigure', 3],
  ['rubber_duck', 2],
];

function total(c: Ctx): number {
  return c.placements.reduce((s, p) => s + pts(p.item), 0);
}

/** Trim small items when over the target, then top up with 1-point fillers until exact. */
function balancePoints(c: Ctx, target: number): void {
  const s = c.layout.start;
  let sum = total(c);
  const smallTier = (max: number) =>
    new Set(TOY_ITEMS.filter((i) => i.tier <= max).map((i) => i.id));
  for (const set of [smallTier(1), smallTier(3), smallTier(8), smallTier(14)]) {
    if (sum <= target) break;
    const idx: number[] = [];
    c.placements.forEach((p, i) => {
      if (set.has(p.item) && Math.hypot(p.x - s.x, p.z - s.z) > 28) idx.push(i);
    });
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(c.rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const drop = new Set<number>();
    // never trim the last copy of a type: every type stays on the map
    const left = new Map<string, number>();
    for (const p of c.placements) left.set(p.item, (left.get(p.item) ?? 0) + 1);
    for (const i of idx) {
      if (sum <= target) break;
      const id = c.placements[i].item;
      if ((left.get(id) ?? 0) <= 1) continue;
      left.set(id, (left.get(id) ?? 0) - 1);
      drop.add(i);
      sum -= pts(c.placements[i].item);
    }
    c.placements = c.placements.filter((_, i) => !drop.has(i));
  }

  const zones = c.layout.zones.filter((z) => !isAtrium(z));
  const area = zones.map((z) => (z.x1 - z.x0) * (z.z1 - z.z0));
  const totalArea = area.reduce((a, b) => a + b, 0);
  const totalWeight = FILL.reduce((a, [, w]) => a + w, 0);
  let guard = 0;
  while (sum < target && guard++ < 200000) {
    let roll = c.rng.next() * totalWeight;
    let id = FILL[0][0];
    for (const [fid, w] of FILL) {
      roll -= w;
      if (roll <= 0) {
        id = fid;
        break;
      }
    }
    if (pts(id) > target - sum) id = 'puzzle_piece';
    let ar = c.rng.next() * totalArea;
    let z = zones[0];
    for (let i = 0; i < zones.length; i++) {
      ar -= area[i];
      if (ar <= 0) {
        z = zones[i];
        break;
      }
    }
    let placed = false;
    for (let attempt = 0; attempt < 30 && !placed; attempt++) {
      const near = c.rng.chance(0.25);
      const x = near
        ? s.x + c.rng.range(-24, 24)
        : c.rng.range(z.x0 + 1.5, z.x1 - 1.5);
      const zz = near
        ? s.z + c.rng.range(-14, 14)
        : c.rng.range(z.z0 + 1.5, z.z1 - 1.5);
      placed = tryPut(c, id, x, zz, c.rng.range(0, 6.28), 1.5);
    }
    if (!placed) {
      // crowded: drop a 1-point piece anywhere on the floor rather than miss the target
      const x = c.rng.range(z.x0 + 1.5, z.x1 - 1.5);
      const zz = c.rng.range(z.z0 + 1.5, z.z1 - 1.5);
      put(c, 'puzzle_piece', x, zz, c.rng.range(0, 6.28), { occ: false });
      id = 'puzzle_piece';
    }
    sum += pts(id);
  }
}

/** Per seed, drop about half of the very big types of every tier (keeps >= 2 per tier). */
function pickSkipped(rng: Rng): Set<string> {
  const skip = new Set<string>();
  const byTier = new Map<number, ItemInfo[]>();
  for (const it of TOY_ITEMS)
    if (it.tier >= VERY_BIG_TIER)
      byTier.set(it.tier, [...(byTier.get(it.tier) ?? []), it]);
  for (const items of byTier.values()) {
    const keep = Math.max(2, Math.ceil(items.length * VERY_BIG_KEEP));
    const order = [...items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const it of order.slice(keep)) skip.add(it.id);
  }
  return skip;
}

export function generateToyStore(params: Partial<ToyParams> = {}): MapData {
  const p: ToyParams = { ...DEFAULT_TOY, ...params };
  const rng = new Rng(p.seed * 104729 + 77);
  const layout = shuffledLayout(() => rng.next());
  const c: Ctx = {
    rng,
    layout,
    placements: [],
    rects: [],
    occ: new Occupancy(),
    count: new Map(),
    skip: pickSkipped(rng),
  };
  buildFloor(c);
  const target = toyTargetPoints(p);
  // showpieces first so nothing else takes their spot, then the departments
  const order = [...layout.zones].sort((a, b) =>
    isAtrium(a) ? -1 : isAtrium(b) ? 1 : 0,
  );
  for (const z of order) fillZone(c, z, target, layout.start);
  startScatter(c);
  ensureAllTypes(c);
  balancePoints(c, target);
  return {
    id: 'toy',
    seed: p.seed,
    coast: new Array<number>(8).fill(Math.hypot(layout.hx, layout.hz)),
    bounds: { hx: layout.hx, hz: layout.hz, inset: 0.15, door: layout.doorX },
    beachWidth: 0,
    rects: c.rects,
    blocks: [],
    zones: layout.zones.map(zoneInfo),
    placements: c.placements,
    start: layout.start,
  };
}
