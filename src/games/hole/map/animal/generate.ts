import { Noise2D } from '../../../../shared/noise';
import { Rng } from '../../../../shared/rng';
import { ANIMAL_ITEMS, getItem, type ItemInfo } from '../../items/catalog';
import {
  ANIMAL_DEFS,
  type AnimalDef,
  type Biome,
  type Motion,
} from '../../items/catalog-animal';
import { Occupancy } from '../generate';
import {
  coastRadius,
  insideIsland,
  type GroundRect,
  type MapData,
  type MoveSpec,
  type Placement,
  type Terrain,
  type WalkGrid,
} from '../types';
import { BIOMES, SEA, biomeIndex, type BiomeId } from './biomes';

/**
 * Animal Island generator: seed -> coast, biome sectors, rivers and ponds, the fenced zoo + laboratory
 * compound, hills, the farm, and every placement (animals get their `move` spec). Pure data (no three.js,
 * no DOM), deterministic per seed. Like the other maps every seed holds exactly `points` points: the
 * layout is filled by a per-tier point budget (`TIER_FRACTION`), then small items are trimmed or
 * 1-point fillers added until the total is exact. World axes: +X east, +Z south.
 */
export interface AnimalParams {
  seed: number;
  /** Total points on the map (before the clear bonus). */
  points: number;
  /** Mean island radius (m). */
  radius: number;
  /** Share of the points per size tier 1..25 (balance experiments; default `TIER_FRACTION`). */
  tiers?: number[];
}

export const DEFAULT_ANIMAL: AnimalParams = {
  seed: 1,
  points: 10500,
  radius: 150,
};

export function animalTargetPoints(p: Pick<AnimalParams, 'points'>): number {
  return p.points;
}

const BEACH = 14;
const CELL = 2;

/** Share of the points of each size tier 1..25 (normalised): a long middle, light at the top. */
const TIER_FRACTION = [
  0.075, 0.05, 0.05, 0.055, 0.055, 0.055, 0.055, 0.05, 0.05, 0.05, 0.045, 0.04,
  0.04, 0.04, 0.04, 0.04, 0.035, 0.035, 0.035, 0.04, 0.04, 0.035, 0.035, 0.035,
  0.03,
];

// ------------------------------------------------------------------------------------------ item meta
interface Meta {
  info: ItemInfo;
  biomes: Biome[];
  motion: Motion;
  pri: 'P0' | 'P1' | 'P2';
}
const SHARED_META: Record<string, [Biome[], Motion]> = {
  flower: [['everywhere'], '-'],
  grass_tuft: [['everywhere'], '-'],
  bush_small: [['everywhere'], '-'],
  bush_large: [['everywhere'], '-'],
  tree_small: [['everywhere'], '-'],
  tree: [['everywhere'], '-'],
  tree_big: [['forest', 'meadow'], '-'],
  palm_tree: [['beach', 'jungle'], '-'],
  hedge: [['zoo', 'lab'], '-'],
};
const DEF_BY_ID = new Map<string, AnimalDef>(ANIMAL_DEFS.map((d) => [d.id, d]));
const META = new Map<string, Meta>();
for (const info of ANIMAL_ITEMS) {
  const d = DEF_BY_ID.get(info.id);
  const sh = SHARED_META[info.id];
  META.set(info.id, {
    info,
    biomes: d ? d.biomes : sh[0],
    motion: d ? d.motion : sh[1],
    pri: d ? d.priority : 'P0',
  });
}
const meta = (id: string): Meta => META.get(id)!;
const pts = (id: string): number => getItem(id).points;
const radiusOf = (id: string): number => {
  const it = getItem(id);
  return Math.max(it.w, it.d) / 2;
};

/** Groups the fill plan never touches: placed by the compound / farm layout or the giant list. */
const FIXED_GROUPS = new Set(['lab', 'labveh', 'staff', 'zoo', 'giants']);
const FIXED_IDS = new Set([
  'barn',
  'beehive',
  'hay_bale',
  'fence_wood',
  'hedge',
  'hill_great',
]);
const isFixed = (m: Meta): boolean =>
  FIXED_GROUPS.has(m.info.group) || FIXED_IDS.has(m.info.id);

const GROUP_WEIGHT: Record<string, number> = {
  bugs: 2,
  critters: 3,
  animals: 2.3,
  flora: 4,
  nature: 4,
  rocks: 1.5,
  hills: 2,
};
const PRI_WEIGHT = { P0: 1, P1: 0.6, P2: 0.3 };
/** Most instances of a flexible type (default: unlimited). */
const CAP: Record<string, number> = {
  // terrain hills (hillock .. hill_30, 49 + the great hill = 50 in all)
  hillock: 5,
  knoll: 5,
  hill_5: 2,
  hill_7: 5,
  hill_9: 2,
  hill_10: 5,
  hill_12: 5,
  hill_14: 4,
  hill_16: 4,
  hill_19: 3,
  hill_22: 3,
  hill_26: 3,
  hill_30: 3,
  baobab: 8,
  redwood: 10,
  rock_arch: 4,
  boulder_huge: 8,
  crocodile_big: 3,
  elephant_big: 4,
  beetle_big: 6,
  gorilla_big: 6,
  panda_big: 5,
  tiger_big: 5,
  tortoise_big: 6,
  ant_big: 18,
  rabbit_big: 8,
  frog_big: 8,
  log_bridge: 4,
  beaver_dam: 6,
};

// giants: id, in the zoo paddock, in the wild, wild biomes
const GIANTS: [string, number, number, Biome[]][] = [
  ['rabbit_giant', 0, 1, ['meadow']],
  ['frog_giant', 0, 1, ['wetland']],
  ['mouse_giant', 1, 0, []],
  ['giraffe_giant', 1, 1, ['savanna']],
  ['ant_giant', 0, 1, ['jungle', 'meadow']],
  ['beetle_giant', 0, 1, ['forest']],
  ['snail_giant', 0, 1, ['wetland']],
  ['chicken_giant', 0, 1, ['farm', 'meadow']],
  ['bear_giant', 0, 1, ['forest']],
  ['lion_giant', 0, 1, ['savanna']],
  ['tortoise_giant', 0, 1, ['meadow', 'highlands']],
  ['hippo_giant', 1, 0, ['wetland']],
  ['rhino_giant', 0, 1, ['savanna']],
  ['crocodile_giant', 0, 1, []],
  ['gorilla_giant', 1, 0, []],
  ['elephant_giant', 1, 1, ['savanna']],
];

// ------------------------------------------------------------------------------------------ context
interface Grid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** 0 = sea, 1 = land, 2 = water. */
  land: Uint8Array;
  bio: Uint8Array;
  bank: Uint8Array;
}
interface Compound {
  /** World centre. */
  cx: number;
  cz: number;
  /** +-1: maps local (lx, lz) to world x = cx + sx * lx, z = cz + sz * lz. */
  sx: number;
  sz: number;
  /** World half sizes (design half size x k). */
  hw: number;
  hh: number;
  /** Design units -> metres. */
  k: number;
}
interface Ctx {
  p: AnimalParams;
  rng: Rng;
  noise: Noise2D;
  coast: number[];
  rot: number;
  placements: Placement[];
  rects: GroundRect[];
  occ: Occupancy;
  grid: Grid;
  terrain: Terrain;
  comp: Compound;
  zones: {
    byBiome: Map<BiomeId, number[]>;
    every: number[];
    water: number[];
    bank: number[];
    cache: Map<string, number[]>;
  };
  hillCentres: { x: number; z: number }[];
  /** Places where small things gather (displays, nests, patches): the early game feeds on them. */
  hot: { x: number; z: number; biome: BiomeId }[];
  anthills: { x: number; z: number }[];
  start: { x: number; z: number };
}

/** The compound is laid out in a 200 x 140 unit rectangle (`COMP_HW` x `COMP_HH` half sizes); positions scale by `Compound.k`. */
const COMP_HW = 100;
const COMP_HH = 70;
/** Layout scale (item sizes do not scale): the smaller island needs a tighter compound. */
const COMP_K = 0.65;
const PADDOCK_Z = -24;

// ------------------------------------------------------------------------------------------ coast
function makeCoast(p: AnimalParams, noise: Noise2D): number[] {
  const n = 128;
  const fr = new Rng(p.seed * 104729 + 17);
  const features = Array.from({ length: fr.int(3, 5) }, () => ({
    angle: fr.range(0, Math.PI * 2),
    width: fr.range(0.1, 0.24),
    amp: fr.range(8, 16) * (fr.chance(0.55) ? 1 : -1),
  }));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    let r =
      p.radius +
      13 * noise.noise2(cx * 1.2 + 3, sz * 1.2 + 7) +
      4 * noise.noise2(cx * 4 + 11, sz * 4 + 5);
    for (const f of features) {
      let df = Math.abs(a - f.angle);
      df = Math.min(df, Math.PI * 2 - df);
      r += f.amp * Math.exp(-((df / f.width) * (df / f.width)));
    }
    out.push(r);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ sectors
/** Sectors around the island starting at `rot` (degrees wide). */
const SECTORS: [string, number][] = [
  ['meadow', 85],
  ['wetland', 55],
  ['forest', 80],
  ['jungle', 45],
  ['compound', 40],
  ['savanna', 55],
];
function sectorMid(rot: number, name: string): number {
  let a = 0;
  for (const [n, w] of SECTORS) {
    if (n === name) return rot + ((a + w / 2) * Math.PI) / 180;
    a += w;
  }
  return rot;
}
function sectorAt(rot: number, angle: number): string {
  let a = (angle - rot) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const deg = (a * 180) / Math.PI;
  let acc = 0;
  for (const [n, w] of SECTORS) {
    acc += w;
    if (deg < acc) return n;
  }
  return SECTORS[0][0];
}

// ------------------------------------------------------------------------------------------ geometry helpers
const polar = (a: number, r: number): [number, number] => [
  Math.cos(a) * r,
  Math.sin(a) * r,
];

function distToSeg(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t =
    l2 > 0
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
      : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function distToRiver(pts: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++)
    best = Math.min(
      best,
      distToSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]),
    );
  return best;
}

function toWorld(c: Compound, lx: number, lz: number): [number, number] {
  return [c.cx + c.sx * lx * c.k, c.cz + c.sz * lz * c.k];
}
/** Position in design units (the 200 x 140 layout). */
function toLocal(c: Compound, x: number, z: number): [number, number] {
  return [((x - c.cx) * c.sx) / c.k, ((z - c.cz) * c.sz) / c.k];
}
/** Yaw that turns an item facing +Z to face local south (towards the gate). */
const southYaw = (c: Compound): number => (c.sz > 0 ? 0 : Math.PI);

// ------------------------------------------------------------------------------------------ the island
export function generateAnimalIsland(
  params: Partial<AnimalParams> = {},
): MapData {
  const p: AnimalParams = { ...DEFAULT_ANIMAL, ...params };
  const rng = new Rng(p.seed * 2654435761 + 12345);
  const noise = new Noise2D(p.seed * 31 + 7);
  const coast = makeCoast(p, noise);
  const rot = new Rng(p.seed * 7907 + 3).range(0, Math.PI * 2);

  const comp = placeCompound(p, coast, rot);
  const terrain = makeTerrain(p, coast, rot, noise, comp);
  const grid = makeGrid(p, coast, rot, noise, comp, terrain);
  terrain.biome = biomeTerrain(grid);

  const c: Ctx = {
    p,
    rng,
    noise,
    coast,
    rot,
    placements: [],
    rects: [],
    occ: new Occupancy(),
    grid,
    terrain,
    comp,
    zones: buildZones(grid),
    hillCentres: [],
    hot: [],
    anthills: [],
    start: { x: 0, z: 0 },
  };
  c.hillCentres = hillCentres(c);
  c.hot = hotspots(c);

  const counts = layout(c);
  fillPlan(c, counts);
  ensureTypes(c);
  startPoint(c);
  balancePoints(c);

  const walk = makeWalkGrid(c);
  return {
    id: 'animal',
    seed: p.seed,
    coast,
    beachWidth: BEACH,
    rects: c.rects,
    blocks: [],
    placements: c.placements,
    start: c.start,
    walk,
    terrain: c.terrain,
  };
}

// ------------------------------------------------------------------------------------------ compound + terrain
function placeCompound(
  p: AnimalParams,
  coast: number[],
  rot: number,
): Compound {
  const a = sectorMid(rot, 'compound');
  let r = p.radius * 0.42;
  for (;;) {
    const [cx, cz] = polar(a, r);
    const sx = cx >= 0 ? -1 : 1;
    const sz = cz >= 0 ? -1 : 1;
    const corners = [
      [-COMP_HW, -COMP_HH],
      [COMP_HW, -COMP_HH],
      [COMP_HW, COMP_HH],
      [-COMP_HW, COMP_HH],
    ];
    const ok = corners.every(([lx, lz]) =>
      insideIsland(coast, cx + sx * lx * COMP_K, cz + sz * lz * COMP_K, 20),
    );
    if (ok || r < p.radius * 0.12)
      return {
        cx,
        cz,
        sx,
        sz,
        hw: COMP_HW * COMP_K,
        hh: COMP_HH * COMP_K,
        k: COMP_K,
      };
    r -= 6;
  }
}

function riverPoints(
  from: [number, number],
  to: [number, number],
  noise: Noise2D,
  wob: number,
  phase: number,
): [number, number][] {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(4, Math.round(len / 22));
  const dx = (to[0] - from[0]) / len;
  const dz = (to[1] - from[1]) / len;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = Math.sin(Math.PI * t) ** 0.6;
    const off =
      (Math.sin(t * 7 + phase) * wob +
        noise.noise2(t * 3 + phase, phase) * wob * 0.7) *
      env;
    out.push([
      from[0] + (to[0] - from[0]) * t - dz * off,
      from[1] + (to[1] - from[1]) * t + dx * off,
    ]);
  }
  return out;
}

function makeTerrain(
  p: AnimalParams,
  coast: number[],
  rot: number,
  noise: Noise2D,
  comp: Compound,
): Terrain {
  const aw = sectorMid(rot, 'wetland');
  const source: [number, number] = polar(aw + Math.PI + 0.6, p.radius * 0.1);
  const mouthR = coastRadius(coast, aw) + 18;
  const mouth = polar(aw, mouthR);
  const main = riverPoints(source, mouth, noise, 16, 1.3);
  const afo = sectorMid(rot, 'forest');
  const joinIdx = Math.floor(main.length * 0.45);
  const stream = riverPoints(
    polar(afo, p.radius * 0.78),
    main[joinIdx],
    noise,
    9,
    4.1,
  );
  const rivers = [
    { pts: main, width: 13 },
    { pts: stream, width: 6 },
  ];
  const ponds: Terrain['ponds'] = [];
  const near = (x: number, z: number, r: number) => {
    const [lx, lz] = toLocal(comp, x, z);
    return (
      Math.abs(lx) < COMP_HW + (r + 16) / comp.k &&
      Math.abs(lz) < COMP_HH + (r + 16) / comp.k
    );
  };
  const addPond = (a: number, rr: number, r: number) => {
    const [x, z] = polar(a, rr);
    if (!insideIsland(coast, x, z, r + 20) || near(x, z, r)) return;
    if (rivers.some((rv) => distToRiver(rv.pts, x, z) < r + 14)) return;
    ponds.push({ x, z, r });
  };
  addPond(aw + 0.42, p.radius * 0.66, 22);
  addPond(aw - 0.4, p.radius * 0.72, 14);
  addPond(aw + 0.2, p.radius * 0.5, 11);
  addPond(sectorMid(rot, 'savanna'), p.radius * 0.6, 16);
  addPond(sectorMid(rot, 'meadow') + 0.5, p.radius * 0.55, 10);
  // hippo pool inside the compound (zoo side)
  const [px, pz] = toWorld(comp, -62, 40);
  ponds.push({ x: px, z: pz, r: 9 });
  const bx0 = comp.cx - comp.hw;
  const bz0 = comp.cz - comp.hh;
  return {
    rivers,
    ponds,
    biome: { x0: 0, z0: 0, cell: 10, nx: 0, nz: 0, data: new Uint8Array(0) },
    compound: {
      x0: bx0,
      z0: bz0,
      x1: bx0 + comp.hw * 2,
      z1: bz0 + comp.hh * 2,
    },
  };
}

function biomeAtRaw(
  x: number,
  z: number,
  coast: number[],
  rot: number,
  noise: Noise2D,
  farm: { x: number; z: number },
): BiomeId {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const rc = coastRadius(coast, a);
  if (rc - r < BEACH) return 'beach';
  const warp = 0.28 * noise.noise2(x / 90 + 5, z / 90 - 3);
  const hl = rc * (0.3 + 0.07 * noise.noise2(x / 70, z / 70 + 9));
  if (r < hl) return 'highlands';
  const s = sectorAt(rot, a + warp);
  if (s === 'meadow') {
    return Math.hypot(x - farm.x, z - farm.z) < 40 ? 'farm' : 'meadow';
  }
  if (s === 'compound') return 'jungle';
  return s as BiomeId;
}

function farmCentre(p: AnimalParams, rot: number): { x: number; z: number } {
  const [x, z] = polar(sectorMid(rot, 'meadow') + 0.28, p.radius * 0.62);
  return { x, z };
}

function makeGrid(
  p: AnimalParams,
  coast: number[],
  rot: number,
  noise: Noise2D,
  comp: Compound,
  terrain: Terrain,
): Grid {
  const R = Math.max(...coast) + 12;
  const n = Math.ceil((R * 2) / CELL);
  const x0 = -R;
  const z0 = -R;
  const land = new Uint8Array(n * n);
  const bio = new Uint8Array(n * n).fill(SEA);
  const bank = new Uint8Array(n * n);
  const farm = farmCentre(p, rot);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const x = x0 + (ix + 0.5) * CELL;
      const z = z0 + (iz + 0.5) * CELL;
      if (!insideIsland(coast, x, z, 0)) continue;
      const i = iz * n + ix;
      land[i] = 1;
      let b = biomeAtRaw(x, z, coast, rot, noise, farm);
      const [lx, lz] = toLocal(comp, x, z);
      if (Math.abs(lx) < COMP_HW && Math.abs(lz) < COMP_HH)
        b = lz < -14 || lx < -24 ? 'zoo' : 'lab';
      else if (
        Math.abs(lx) < COMP_HW + 14 / comp.k &&
        Math.abs(lz) < COMP_HH + 14 / comp.k
      )
        b = 'jungle';
      bio[i] = biomeIndex(b);
      let dMin = Infinity;
      for (const rv of terrain.rivers)
        dMin = Math.min(dMin, distToRiver(rv.pts, x, z) - rv.width / 2);
      for (const pd of terrain.ponds)
        dMin = Math.min(dMin, Math.hypot(x - pd.x, z - pd.z) - pd.r);
      if (dMin < 0) land[i] = 2;
      else if (dMin < 3.5) bank[i] = 1;
    }
  return { x0, z0, nx: n, nz: n, land, bio, bank };
}

function buildZones(g: Grid): Ctx['zones'] {
  const byBiome = new Map<BiomeId, number[]>();
  for (const b of BIOMES) byBiome.set(b, []);
  const every: number[] = [];
  const water: number[] = [];
  const bank: number[] = [];
  for (let i = 0; i < g.land.length; i++) {
    if (g.land[i] === 2) {
      water.push(i);
      continue;
    }
    if (g.land[i] !== 1) continue;
    const b = BIOMES[g.bio[i]];
    byBiome.get(b)!.push(i);
    if (b !== 'zoo' && b !== 'lab' && b !== 'beach') every.push(i);
    if (g.bank[i]) bank.push(i);
  }
  return { byBiome, every, water, bank, cache: new Map() };
}

// ------------------------------------------------------------------------------------------ placing
function cellPos(c: Ctx, i: number): [number, number] {
  const g = c.grid;
  const ix = i % g.nx;
  const iz = Math.floor(i / g.nx);
  return [g.x0 + (ix + c.rng.next()) * CELL, g.z0 + (iz + c.rng.next()) * CELL];
}

function zoneList(c: Ctx, m: Meta): number[] {
  const key = `${m.motion === 'swim'}|${m.biomes.join(',')}`;
  const hit = c.zones.cache.get(key);
  if (hit) return hit;
  let list: number[];
  const onlyRiver = m.biomes.every((b) => b === 'river');
  if (m.motion === 'swim' || onlyRiver) list = c.zones.water;
  else if (m.biomes.every((b) => b === 'bank')) list = c.zones.bank;
  else {
    list = [];
    const seen = new Set<BiomeId | 'every'>();
    for (const b of m.biomes) {
      if (b === 'everywhere' && !seen.has('every')) {
        seen.add('every');
        list = list.concat(c.zones.every);
      } else if (b !== 'river' && b !== 'bank' && b !== 'everywhere') {
        const bb = b as BiomeId;
        if (!seen.has(bb)) {
          seen.add(bb);
          list = list.concat(c.zones.byBiome.get(bb) ?? []);
        }
      } else if (b === 'bank') list = list.concat(c.zones.bank);
    }
  }
  c.zones.cache.set(key, list);
  return list;
}

function spotFor(c: Ctx, m: Meta): { x: number; z: number } | null {
  const list = zoneList(c, m);
  if (!list.length) return null;
  const [x, z] = cellPos(c, list[c.rng.int(0, list.length - 1)]);
  return { x, z };
}

function put(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot: number,
  move?: MoveSpec,
  occ = true,
): void {
  const it = getItem(id);
  const pl: Placement = {
    item: id,
    x,
    z,
    rot,
    variant: it.variants > 1 ? c.rng.int(0, it.variants - 1) : 0,
    paint: it.paints?.length ? c.rng.int(0, it.paints.length - 1) : -1,
  };
  if (move) pl.move = move;
  c.placements.push(pl);
  if (occ) c.occ.add(x, z, radiusOf(id));
}

function onGround(c: Ctx, m: Meta, x: number, z: number): boolean {
  const g = c.grid;
  const ix = Math.floor((x - g.x0) / CELL);
  const iz = Math.floor((z - g.z0) / CELL);
  if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return false;
  const code = g.land[iz * g.nx + ix];
  if (m.motion === 'swim' || m.biomes.every((b) => b === 'river'))
    return code === 2;
  return code === 1;
}

function tryPut(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot: number,
  move?: MoveSpec,
  checkGround = true,
): boolean {
  const m = meta(id);
  // far enough from the coast for the biggest hole to reach it (the hole centre stops 0.5 D inside the coast)
  if (!insideIsland(c.coast, x, z, 3 + 0.15 * getItem(id).size)) return false;
  if (checkGround && !onGround(c, m, x, z)) return false;
  if (!c.occ.free(x, z, radiusOf(id))) return false;
  put(c, id, x, z, rot, move);
  return true;
}

// ---- movement specs -------------------------------------------------------------------------
function speedFor(m: Meta): number {
  const s = m.info.size;
  switch (m.motion) {
    case 'crawl':
      return 0.12 + 0.04 * Math.sqrt(s);
    case 'hop':
      return 1.4;
    case 'skitter':
      return 1.8;
    case 'flutter':
      return 1.2;
    case 'swim':
      return 0.9 + 0.2 * Math.sqrt(s);
    case 'roam':
      return 1.0 + 0.04 * s;
    case 'trail':
      return 0.6;
    case 'patrol':
      return m.info.group === 'labveh' ? 3.5 : 1.3;
    default:
      return Math.min(3, 0.6 + 0.45 * Math.sqrt(s));
  }
}

function leashFor(m: Meta, herd: boolean): number {
  const g = m.info.group;
  if (g === 'giants') return 48;
  if (m.motion === 'swim') return 24;
  if (g === 'bugs') return 3 + Math.min(4, m.info.size * 10);
  if (g === 'critters') return 8 + Math.min(6, m.info.size * 6);
  return herd ? 30 : 18;
}

function moveSpec(
  m: Meta,
  x: number,
  z: number,
  o: {
    leash?: number;
    herd?: boolean;
    tx?: number;
    tz?: number;
    delay?: number;
  } = {},
): MoveSpec | undefined {
  if (m.motion === '-') return undefined;
  const kind = m.motion === 'herd' ? 'wander' : m.motion;
  const flee = m.info.group !== 'bugs' && m.info.group !== 'giants';
  return {
    kind,
    hx: x,
    hz: z,
    leash: o.leash ?? leashFor(m, !!o.herd),
    speed: speedFor(m),
    tx: o.tx,
    tz: o.tz,
    delay: o.delay,
    flee,
  };
}

function putMover(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  o: Parameters<typeof moveSpec>[3] = {},
  checkGround = true,
): boolean {
  const m = meta(id);
  return tryPut(
    c,
    id,
    x,
    z,
    c.rng.range(0, Math.PI * 2),
    moveSpec(m, x, z, o),
    checkGround,
  );
}

// ------------------------------------------------------------------------------------------ layout
/** Counts of every item the compound / farm / giant layout places (the fill plan skips these). */
function layout(c: Ctx): Map<string, number> {
  const tally = () => {
    const t = new Map<string, number>();
    for (const pl of c.placements) t.set(pl.item, (t.get(pl.item) ?? 0) + 1);
    return t;
  };
  const greatHill = polar(c.rot + 2.4, c.p.radius * 0.09);
  tryPut(c, 'hill_great', greatHill[0], greatHill[1], 0, undefined, false);
  buildCompound(c);
  buildFarm(c);
  placeGiants(c);
  return tally();
}

function localRect(
  c: Ctx,
  lx0: number,
  lz0: number,
  lx1: number,
  lz1: number,
  color: number,
  y = 0.012,
): void {
  const [ax, az] = toWorld(c.comp, lx0, lz0);
  const [bx, bz] = toWorld(c.comp, lx1, lz1);
  c.rects.push({
    x0: Math.min(ax, bx),
    z0: Math.min(az, bz),
    x1: Math.max(ax, bx),
    z1: Math.max(az, bz),
    y,
    color,
  });
}

function buildCompound(c: Ctx): void {
  const comp = c.comp;
  const W = (lx: number, lz: number) => toWorld(comp, lx, lz);
  const face = southYaw(comp);
  // ground: paddock earth + road along the paddock edge + gate road + pads
  localRect(c, -100, -70, 100, -24, 0xb59a6a);
  localRect(c, -100, -24, 100, -13, 0x8f9499, 0.016);
  localRect(c, -29, -13, -19, 70, 0x8f9499, 0.016);
  localRect(c, -19, 62, 100, 70, 0x8f9499, 0.016);
  localRect(c, -19, -13, 100, 62, 0xd5d8da, 0.014);
  localRect(c, -100, -13, -29, 70, 0xc4a878, 0.014);
  localRect(c, 56, 4, 78, 26, 0xaab0b5, 0.02);

  // perimeter: lab fence on the sides that face the island, cage bars round the giant paddock
  const step = 8.5 / comp.k;
  const gate = -24;
  for (let lx = -100 + step / 2; lx < 100; lx += step) {
    if (Math.abs(lx - gate) < 11) continue;
    const [x, z] = W(lx, 70);
    put(c, 'lab_fence', x, z, face, undefined, false);
  }
  for (let lz = 70 - step / 2; lz > PADDOCK_Z; lz -= step) {
    const [x, z] = W(100, lz);
    put(c, 'lab_fence', x, z, Math.PI / 2, undefined, false);
  }
  for (let lx = -100 + step / 2; lx < 100; lx += step) {
    const [x, z] = W(lx, PADDOCK_Z);
    put(c, 'cage_bars', x, z, face, undefined, false);
  }
  for (const lx of [-100, 100])
    for (let lz = PADDOCK_Z - step / 2; lz > -70; lz -= step) {
      const [x, z] = W(lx, lz);
      put(c, 'cage_bars', x, z, Math.PI / 2, undefined, false);
    }
  for (const [lx, lz] of [
    [-102, 72],
    [102, 72],
    [102, PADDOCK_Z],
    [-102, PADDOCK_Z],
  ] as const) {
    const [x, z] = W(lx, lz);
    put(c, 'watchtower', x, z, 0, undefined, false);
  }
  for (let k = 0; k < 10; k++) {
    const lx = -90 + k * 20;
    const [x, z] = W(lx, 66);
    put(c, 'camera_pole', x, z, 0, undefined, false);
  }
  for (const lx of [-10, 6]) {
    const [x, z] = W(lx + gate, 72);
    put(c, 'warning_sign', x, z, face, undefined, false);
  }

  // zoo pens: fence on the south and east side of three pens, animals inside
  const pens: { lz0: number; lz1: number; ids: [string, number][] }[] = [
    {
      lz0: -10,
      lz1: 10,
      ids: [
        ['rabbit_big', 2],
        ['frog_big', 2],
        ['ant_big', 6],
      ],
    },
    {
      lz0: 14,
      lz1: 36,
      ids: [
        ['tortoise_big', 2],
        ['gorilla_big', 2],
        ['beetle_big', 2],
        ['panda_big', 2],
      ],
    },
    {
      lz0: 40,
      lz1: 64,
      ids: [
        ['elephant_big', 2],
        ['tiger_big', 2],
      ],
    },
  ];
  const zstep = 5.5 / comp.k;
  for (const pen of pens) {
    for (let lx = -98 + zstep / 2; lx < -30; lx += zstep) {
      const [x, z] = W(lx, pen.lz1);
      put(c, 'zoo_fence', x, z, face, undefined, false);
    }
    for (let lz = pen.lz0 + zstep / 2; lz < pen.lz1; lz += zstep) {
      const [x, z] = W(-30, lz);
      put(c, 'zoo_fence', x, z, Math.PI / 2, undefined, false);
    }
    for (const [id, n] of pen.ids)
      for (let k = 0; k < n; k++)
        for (let t = 0; t < 30; t++) {
          const [x, z] = W(
            -92 + c.rng.range(0, 56),
            c.rng.range(pen.lz0 + 3, pen.lz1 - 3),
          );
          const anchor =
            id === 'ant_big'
              ? {
                  tx: x + c.rng.range(-8, 8),
                  tz: z + c.rng.range(-8, 8),
                  delay: k * 1.2,
                  leash: 20,
                }
              : { leash: 16 };
          if (putMover(c, id, x, z, anchor)) break;
        }
  }
  // zoo props
  const zoo = (
    id: string,
    n: number,
    lx0: number,
    lx1: number,
    lz0: number,
    lz1: number,
  ) => {
    for (let k = 0; k < n; k++)
      for (let t = 0; t < 40; t++) {
        const [x, z] = W(c.rng.range(lx0, lx1), c.rng.range(lz0, lz1));
        const m = meta(id);
        if (
          tryPut(
            c,
            id,
            x,
            z,
            face + c.rng.range(-0.2, 0.2),
            moveSpec(m, x, z),
            false,
          )
        )
          break;
      }
  };
  zoo('feeding_station', 3, -96, -34, -8, 62);
  zoo('keeper_hut', 2, -96, -34, -8, 62);
  zoo('zoo_shed', 2, -96, -34, -8, 62);
  zoo('aviary', 1, -96, -34, 40, 62);
  zoo('feeding_trough', 5, -96, -34, -8, 62);
  zoo('feed_bucket', 8, -96, -34, -8, 62);
  zoo('hay_bale', 8, -96, -34, -8, 62);
  zoo('giant_carrot', 6, -90, 90, -66, -28);
  // laboratory: key buildings at set spots, the rest random inside the lab pad
  const labAt = (id: string, lx: number, lz: number) => {
    const [x, z] = W(lx, lz);
    if (!tryPut(c, id, x, z, face, undefined, false)) zoo2(id);
  };
  const zoo2 = (id: string) => {
    for (let t = 0; t < 80; t++) {
      const [x, z] = W(c.rng.range(-14, 96), c.rng.range(-8, 62));
      if (tryPut(c, id, x, z, face, undefined, false)) return;
    }
  };
  labAt('lab_hq', 38, 34);
  labAt('lab_hangar', 80, 40);
  labAt('growth_reactor', 14, 8);
  labAt('biodome', 62, 6);
  labAt('lab_tower', 90, 54);
  labAt('lab_wing', 30, 4);
  labAt('lab_wing', 20, 56);
  labAt('lab_dome', 62, 52);
  labAt('lab_dome', 4, 40);
  labAt('greenhouse', 88, 12);
  labAt('greenhouse', 4, 24);
  const many = (id: string, n: number) => {
    for (let k = 0; k < n; k++) zoo2(id);
  };
  many('lab_block', 3);
  many('growth_chamber', 3);
  many('growth_vat', 10);
  many('container', 4);
  many('lab_generator', 3);
  many('satellite_dish', 2);
  many('serum_barrel', 22);
  many('lab_crate', 18);
  many('lab_desk', 6);
  many('lab_cart', 6);
  many('helicopter', 1);
  many('transport_truck', 1);
  many('research_jeep', 1);
  // patrolling staff and vehicles
  const patrol = (
    id: string,
    n: number,
    area: [number, number, number, number],
  ) => {
    for (let k = 0; k < n; k++)
      for (let t = 0; t < 60; t++) {
        const [x, z] = W(
          c.rng.range(area[0], area[1]),
          c.rng.range(area[2], area[3]),
        );
        const ang = c.rng.range(0, Math.PI * 2);
        const len = c.rng.range(14, 36);
        const [tx, tz] = [x + Math.cos(ang) * len, z + Math.sin(ang) * len];
        const [lx, lz] = toLocal(comp, tx, tz);
        if (Math.abs(lx) > 96 || Math.abs(lz) > 66) continue;
        if (putMover(c, id, x, z, { tx, tz, leash: len + 4 }, true)) break;
      }
  };
  patrol('scientist', 16, [-14, 96, -8, 62]);
  patrol('zookeeper', 8, [-96, -34, -8, 62]);
  patrol('research_jeep', 2, [-90, 90, -22, -15]);
}

function buildFarm(c: Ctx): void {
  const f = farmCentre(c.p, c.rot);
  const face = c.rng.range(0, Math.PI * 2);
  tryPut(c, 'barn', f.x, f.z, face, undefined, false);
  const near = (id: string, n: number, r0: number, r1: number) => {
    for (let k = 0; k < n; k++)
      for (let t = 0; t < 40; t++) {
        const a = c.rng.range(0, Math.PI * 2);
        const r = c.rng.range(r0, r1);
        if (
          tryPut(
            c,
            id,
            f.x + Math.cos(a) * r,
            f.z + Math.sin(a) * r,
            c.rng.range(0, 6.28),
          )
        )
          break;
      }
  };
  near('hay_bale', 8, 10, 26);
  near('beehive', 3, 22, 34);
  // a wooden fence ring around the yard
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2;
    const r = 30;
    tryPut(
      c,
      'fence_wood',
      f.x + Math.cos(a) * r,
      f.z + Math.sin(a) * r,
      a + Math.PI / 2,
    );
  }
}

function placeGiants(c: Ctx): void {
  const comp = c.comp;
  for (const [id, zoo, wild, biomes] of GIANTS) {
    const m = meta(id);
    const rad = radiusOf(id) * 0.7;
    const place = (
      sampler: () => [number, number],
      leash: number,
      tries = 400,
    ) => {
      // a giant must exist: after `tries` crowded spots, take the last good one ignoring neighbours
      let last: [number, number] | null = null;
      for (let t = 0; t < tries * 2; t++) {
        const [x, z] = sampler();
        if (!onGround(c, m, x, z) || !insideIsland(c.coast, x, z, 10)) continue;
        last = [x, z];
        if (t < tries && !c.occ.free(x, z, rad)) continue;
        break;
      }
      if (!last) return;
      put(
        c,
        id,
        last[0],
        last[1],
        c.rng.range(0, 6.28),
        moveSpec(m, last[0], last[1], { leash }),
        true,
      );
    };
    for (let k = 0; k < zoo; k++)
      place(
        () => toWorld(comp, c.rng.range(-84, 84), c.rng.range(-62, -32)),
        22,
      );
    for (let k = 0; k < wild; k++) {
      if (m.motion === 'swim')
        place(() => {
          const i = c.zones.water[c.rng.int(0, c.zones.water.length - 1)];
          return cellPos(c, i);
        }, 26);
      else
        place(() => {
          const b = c.rng.pick(biomes);
          const list = c.zones.byBiome.get(b as BiomeId)!;
          return cellPos(c, list[c.rng.int(0, list.length - 1)]);
        }, 48);
    }
  }
}

// ------------------------------------------------------------------------------------------ hills
function hillCentres(c: Ctx): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const pick = (b: BiomeId, n: number) => {
    const list = c.zones.byBiome.get(b)!;
    for (let k = 0; k < n && list.length; k++) {
      const [x, z] = cellPos(c, list[c.rng.int(0, list.length - 1)]);
      out.push({ x, z });
    }
  };
  pick('highlands', 7);
  pick('savanna', 3);
  pick('meadow', 3);
  pick('forest', 2);
  return out;
}

/** About one hotspot per `HOT_AREA` m2 of every land biome (not the zoo / lab / beach). */
const HOT_AREA = 2600;
function hotspots(c: Ctx): Ctx['hot'] {
  const out: Ctx['hot'] = [];
  for (const b of BIOMES) {
    if (b === 'zoo' || b === 'lab' || b === 'beach') continue;
    const list = c.zones.byBiome.get(b)!;
    const n = Math.round((list.length * CELL * CELL) / HOT_AREA);
    for (let k = 0; k < n; k++) {
      let best: [number, number] | null = null;
      // best of a few tries: not on top of another hotspot
      for (let t = 0; t < 6; t++) {
        const q = cellPos(c, list[c.rng.int(0, list.length - 1)]);
        if (!out.some((h) => Math.hypot(h.x - q[0], h.z - q[1]) < 24)) {
          best = q;
          break;
        }
        best ??= q;
      }
      if (best) out.push({ x: best[0], z: best[1], biome: b });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ fill plan
function planCounts(c: Ctx, fixed: Map<string, number>): Map<string, number> {
  const target = c.p.points;
  const fractions = c.p.tiers ?? TIER_FRACTION;
  const norm = fractions.reduce((a, b) => a + b, 0);
  const counts = new Map<string, number>();
  const flex = ANIMAL_ITEMS.map((i) => meta(i.id)).filter(
    (m) => !isFixed(m) && (GROUP_WEIGHT[m.info.group] ?? 0) > 0,
  );
  const weight = (m: Meta) =>
    PRI_WEIGHT[m.pri] * (GROUP_WEIGHT[m.info.group] ?? 0);
  const cap = (id: string) => CAP[id] ?? Infinity;
  for (let t = 1; t <= 25; t++) {
    const list = flex.filter((m) => m.info.tier === t);
    if (!list.length) continue;
    const budget = (fractions[t - 1] / norm) * target;
    let used = 0;
    for (const [id, n] of fixed)
      if (getItem(id).tier === t) used += n * pts(id);
    let rem = Math.max(0, budget - used);
    const got = new Map<string, number>(list.map((m) => [m.info.id, 0]));
    const open = new Set(list);
    for (let pass = 0; pass < 3 && open.size && rem > 0; pass++) {
      const sum = [...open].reduce((a, m) => a + weight(m), 0);
      let spent = 0;
      for (const m of [...open]) {
        const want = Math.round((rem * weight(m)) / sum / m.info.points);
        const room = cap(m.info.id) - got.get(m.info.id)!;
        const add = Math.min(want, room);
        got.set(m.info.id, got.get(m.info.id)! + add);
        spent += add * m.info.points;
        if (add >= room) open.delete(m);
      }
      rem -= spent;
      if (spent === 0) break;
    }
    for (const m of list)
      counts.set(m.info.id, Math.max(1, got.get(m.info.id)!));
  }
  const total = () => {
    let sum = 0;
    for (const [id, n] of counts) sum += n * pts(id);
    for (const [id, n] of fixed) sum += n * pts(id);
    return sum;
  };
  // spread what is still missing over the small and mid types that have room
  for (let round = 0; round < 6; round++) {
    const pool = target - total();
    if (pool < target * 0.01) break;
    const grow = flex.filter((m) => m.info.tier <= 19);
    const base = grow.reduce(
      (a, m) => a + (counts.get(m.info.id) ?? 0) * m.info.points,
      0,
    );
    const f = 1 + pool / Math.max(1, base);
    for (const m of grow)
      counts.set(
        m.info.id,
        Math.min(
          cap(m.info.id),
          Math.max(1, Math.round((counts.get(m.info.id) ?? 1) * f)),
        ),
      );
  }
  return counts;
}

const HERD_SIZE: Record<string, [number, number]> = {
  sheep: [4, 8],
  goat: [3, 6],
  deer: [3, 5],
  zebra: [4, 7],
  elephant: [3, 4],
  giraffe: [2, 4],
  wolf: [3, 5],
  bison: [4, 6],
  antelope: [5, 8],
  flamingo: [5, 9],
  alpaca: [3, 5],
  ostrich: [2, 4],
  lamb: [2, 3],
  horse: [2, 4],
  cow: [3, 5],
  giraffe_calf: [1, 2],
  elephant_calf: [1, 2],
};

function fillPlan(c: Ctx, fixed: Map<string, number>): void {
  const counts = planCounts(c, fixed);
  const ids = [...counts.keys()].sort(
    (a, b) => getItem(b).size - getItem(a).size,
  );
  for (const id of ids) {
    const m = meta(id);
    const n = counts.get(id)!;
    placeType(c, m, n);
  }
}

/** Small and mid types gather around hotspots of their own biome (most of them), the rest is scattered. */
function hotSpot(c: Ctx, m: Meta): { x: number; z: number } | null {
  if (m.info.tier > HOT_MAX_TIER || m.motion === 'swim') return null;
  if (m.biomes.every((b) => b === 'river' || b === 'bank')) return null;
  if (!c.rng.chance(HOT_SHARE)) return null;
  const any = m.biomes.includes('everywhere');
  const key = m.biomes.join(',');
  let list = hotCache.get(c)?.get(key);
  if (!list) {
    list = c.hot.filter((h) => any || m.biomes.includes(h.biome));
    if (!hotCache.has(c)) hotCache.set(c, new Map());
    hotCache.get(c)!.set(key, list);
  }
  if (!list.length) return null;
  const h = list[c.rng.int(0, list.length - 1)];
  const sigma = HOT_SIGMA + 0.8 * m.info.size;
  return { x: h.x + c.rng.gauss() * sigma, z: h.z + c.rng.gauss() * sigma };
}
const hotCache = new WeakMap<Ctx, Map<string, Ctx['hot']>>();
const HOT_MAX_TIER = 12;
const HOT_SHARE = 0.8;
const HOT_SIGMA = 8;

function placeType(c: Ctx, m: Meta, n: number): void {
  const id = m.info.id;
  const rc = c.rng;
  let placed = 0;
  let guard = 0;
  const limit = n * 40 + 200;
  if (m.motion === 'trail') {
    // ants: columns from anthills to a food spot a few metres away
    const hills = c.anthills.length ? c.anthills : [];
    while (placed < n && guard++ < limit) {
      const h = hills.length ? hills[placed % hills.length] : null;
      const base = h ?? spotFor(c, m);
      if (!base) return;
      const a = rc.range(0, Math.PI * 2);
      const len = rc.range(8, 18);
      const tx = base.x + Math.cos(a) * len;
      const tz = base.z + Math.sin(a) * len;
      const f = rc.next();
      const x = base.x + (tx - base.x) * f;
      const z = base.z + (tz - base.z) * f;
      if (
        putMover(
          c,
          id,
          x,
          z,
          { tx, tz, delay: rc.range(0, 6), leash: len + 2 },
          true,
        )
      )
        placed++;
    }
    return;
  }
  const hs = HERD_SIZE[id];
  const isHill = m.info.group === 'hills' && m.info.size >= 2;
  while (placed < n && guard++ < limit) {
    if (hs) {
      const g = Math.min(n - placed, rc.int(hs[0], hs[1]));
      const base = spotFor(c, m);
      if (!base) return;
      const leash = 26 + g * 2;
      for (let k = 0; k < g; k++) {
        const a = rc.range(0, Math.PI * 2);
        const r = rc.range(0, 3 + g * 1.4);
        if (
          putMover(c, id, base.x + Math.cos(a) * r, base.z + Math.sin(a) * r, {
            leash,
            herd: true,
          })
        )
          placed++;
      }
      continue;
    }
    let spot: { x: number; z: number } | null;
    if (isHill && c.hillCentres.length && rc.chance(0.65)) {
      const hc = rc.pick(c.hillCentres);
      spot = { x: hc.x + rc.gauss() * 32, z: hc.z + rc.gauss() * 32 };
    } else spot = hotSpot(c, m) ?? spotFor(c, m);
    if (!spot) return;
    const ok =
      m.motion === '-'
        ? tryPut(c, id, spot.x, spot.z, rc.range(0, Math.PI * 2))
        : putMover(c, id, spot.x, spot.z);
    if (ok) {
      placed++;
      if (id === 'anthill') c.anthills.push({ x: spot.x, z: spot.z });
    }
  }
}

// ------------------------------------------------------------------------------------------ start + points
function startPoint(c: Ctx): void {
  // a clear meadow spot near the river end: the spot with the most tier 1-3 items within 22 m
  const meadow = c.zones.byBiome.get('meadow')!;
  const small = c.placements.filter((p) => getItem(p.item).tier <= 3);
  let best = { x: 0, z: 0 };
  let bestN = -1;
  for (let t = 0; t < 400 && meadow.length; t++) {
    const [x, z] = cellPos(c, meadow[c.rng.int(0, meadow.length - 1)]);
    if (!insideIsland(c.coast, x, z, 30)) continue;
    let blocked = false;
    for (const p of c.placements) {
      const it = getItem(p.item);
      if (it.size > 0.9 && Math.hypot(p.x - x, p.z - z) - it.size / 2 < 1.5) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    let n = 0;
    // a level 1 hole eats tier 1 only: count those three times
    for (const p of small)
      if (Math.hypot(p.x - x, p.z - z) < 22)
        n += getItem(p.item).tier <= 1 ? 3 : 1;
    if (n > bestN) {
      bestN = n;
      best = { x, z };
    }
  }
  c.start = best;
  // make sure the first seconds are busy: a ring of tiny things around the start
  const ring = [
    'ladybug',
    'ant',
    'flower',
    'mushroom',
    'mouse',
    'grasshopper',
    'snail',
    'beetle',
  ];
  let n = 0;
  for (let t = 0; t < 300 && n < 26; t++) {
    const id = ring[t % ring.length];
    const a = c.rng.range(0, Math.PI * 2);
    const r = c.rng.range(3, 20);
    const x = best.x + Math.cos(a) * r;
    const z = best.z + Math.sin(a) * r;
    const m = meta(id);
    const ok =
      m.motion === '-' ? tryPut(c, id, x, z, a) : putMover(c, id, x, z);
    if (ok) n++;
  }
}

const FILL: [string, number][] = [
  ['grass_tuft', 6],
  ['flower', 4],
  ['clover', 3],
  ['pebble', 2],
];
const TRIM_FIRST = new Set([
  'grass_tuft',
  'flower',
  'clover',
  'pebble',
  'dandelion',
  'fern',
  'reeds',
]);

function balancePoints(c: Ctx): void {
  const target = c.p.points;
  let total = c.placements.reduce((s, pl) => s + pts(pl.item), 0);
  // trim: small scatter first, never close to the start, then any small item
  const trim = (accept: (m: Meta) => boolean, near: number) => {
    if (total <= target) return;
    const idx: number[] = [];
    c.placements.forEach((pl, i) => {
      if (
        accept(meta(pl.item)) &&
        Math.hypot(pl.x - c.start.x, pl.z - c.start.z) > near
      )
        idx.push(i);
    });
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(c.rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const drop = new Set<number>();
    for (const i of idx) {
      if (total <= target) break;
      drop.add(i);
      total -= pts(c.placements[i].item);
    }
    c.placements = c.placements.filter((_, i) => !drop.has(i));
  };
  trim((m) => TRIM_FIRST.has(m.info.id), 28);
  trim((m) => !isFixed(m) && m.info.tier <= 4 && m.motion === '-', 28);
  trim((m) => !isFixed(m) && m.info.tier <= 8, 28);
  trim((m) => !isFixed(m) && m.info.tier <= 14, 28);

  // a deficit: enrich with mid-tier flexible types first, then 1-point fillers
  const flex = ANIMAL_ITEMS.map((i) => meta(i.id)).filter(
    (m) =>
      !isFixed(m) &&
      (GROUP_WEIGHT[m.info.group] ?? 0) > 0 &&
      m.info.tier >= 2 &&
      m.info.tier <= 14 &&
      m.pri === 'P0' &&
      m.motion !== 'trail',
  );
  let tries = 0;
  while (target - total > target * 0.01 && tries++ < 60000) {
    const m = c.rng.pick(flex);
    if (m.info.points > target - total - target * 0.005) continue;
    const spot = spotFor(c, m);
    if (!spot) continue;
    const ok =
      m.motion === '-'
        ? tryPut(c, m.info.id, spot.x, spot.z, c.rng.range(0, 6.28))
        : putMover(c, m.info.id, spot.x, spot.z);
    if (ok) total += m.info.points;
  }
  const fw = FILL.reduce((a, [, w]) => a + w, 0);
  let guard = 0;
  while (total < target && guard++ < 200000) {
    let roll = c.rng.next() * fw;
    let id = FILL[0][0];
    for (const [fid, w] of FILL) {
      roll -= w;
      if (roll <= 0) {
        id = fid;
        break;
      }
    }
    const m = meta(id);
    const spot = c.rng.chance(0.25)
      ? {
          x: c.start.x + c.rng.range(-22, 22),
          z: c.start.z + c.rng.range(-22, 22),
        }
      : spotFor(c, m);
    if (!spot) continue;
    if (tryPut(c, id, spot.x, spot.z, c.rng.range(0, 6.28)))
      total += m.info.points;
    else if (
      guard % 4 === 0 &&
      insideIsland(c.coast, spot.x, spot.z, 4) &&
      onGround(c, m, spot.x, spot.z)
    ) {
      // crowded: overlap a tuft rather than miss the target
      put(
        c,
        'grass_tuft',
        spot.x,
        spot.z,
        c.rng.range(0, 6.28),
        undefined,
        false,
      );
      total += 1;
    }
  }
}

/** Every item type shows up at least once. */
function ensureTypes(c: Ctx): void {
  const have = new Set(c.placements.map((p) => p.item));
  for (const it of ANIMAL_ITEMS) {
    if (have.has(it.id)) continue;
    const m = meta(it.id);
    for (let t = 0; t < 600; t++) {
      const spot = spotFor(c, m);
      if (!spot) break;
      const ok =
        m.motion === '-'
          ? tryPut(c, it.id, spot.x, spot.z, c.rng.range(0, 6.28))
          : putMover(c, it.id, spot.x, spot.z);
      if (ok) break;
    }
  }
}

// ------------------------------------------------------------------------------------------ walk grid
function makeWalkGrid(c: Ctx): WalkGrid {
  const g = c.grid;
  const data = new Uint8Array(g.land.length);
  for (let i = 0; i < data.length; i++) data[i] = g.land[i];
  // walkers keep off the shoreline strip, so they never end up where the biggest hole cannot reach
  for (let iz = 0; iz < g.nz; iz++)
    for (let ix = 0; ix < g.nx; ix++) {
      const i = iz * g.nx + ix;
      if (
        data[i] === 1 &&
        !insideIsland(
          c.coast,
          g.x0 + (ix + 0.5) * CELL,
          g.z0 + (iz + 0.5) * CELL,
          3,
        )
      )
        data[i] = 0;
    }
  const block = (x: number, z: number, r: number) => {
    const x0 = Math.floor((x - r - g.x0) / CELL);
    const x1 = Math.floor((x + r - g.x0) / CELL);
    const z0 = Math.floor((z - r - g.z0) / CELL);
    const z1 = Math.floor((z + r - g.z0) / CELL);
    for (let iz = Math.max(0, z0); iz <= Math.min(g.nz - 1, z1); iz++)
      for (let ix = Math.max(0, x0); ix <= Math.min(g.nx - 1, x1); ix++) {
        const cx = g.x0 + (ix + 0.5) * CELL;
        const cz = g.z0 + (iz + 0.5) * CELL;
        if (Math.hypot(cx - x, cz - z) <= r && data[iz * g.nx + ix] === 1)
          data[iz * g.nx + ix] = 0;
      }
  };
  for (const pl of c.placements) {
    if (pl.move) continue;
    const it = getItem(pl.item);
    const grp = it.group;
    const big =
      grp === 'hills' ||
      grp === 'lab' ||
      grp === 'zoo' ||
      grp === 'rocks' ||
      (grp === 'farm' && it.size > 3) ||
      ((grp === 'flora' || grp === 'nature') && it.size >= 2.6);
    if (big && it.size >= 1.4) block(pl.x, pl.z, Math.max(it.w, it.d) * 0.45);
  }
  return { x0: g.x0, z0: g.z0, cell: CELL, nx: g.nx, nz: g.nz, data };
}

/** The biome grid the ground builder colours: 10 m cells sampled from the 2 m grid. */
function biomeTerrain(g: Grid): Terrain['biome'] {
  const cell = 10;
  const nx = Math.ceil((g.nx * CELL) / cell);
  const nz = Math.ceil((g.nz * CELL) / cell);
  const data = new Uint8Array(nx * nz).fill(SEA);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const gx = Math.floor(((ix + 0.5) * cell) / CELL);
      const gz = Math.floor(((iz + 0.5) * cell) / CELL);
      if (gx < g.nx && gz < g.nz) data[iz * nx + ix] = g.bio[gz * g.nx + gx];
    }
  return { x0: g.x0, z0: g.z0, cell, nx, nz, data };
}
