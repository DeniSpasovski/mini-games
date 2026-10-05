import { Noise2D } from '../../../shared/noise';
import { Rng } from '../../../shared/rng';
import { ITEMS, getItem, hasItem } from '../items/catalog';
import {
  CANAL_Y,
  ROAD_Y,
  SPAWN,
  makeZoneMap,
  spawnViolation,
  type SpawnZone,
  type ZoneMap,
} from './spawn';
import {
  coastRadius,
  insideIsland,
  type BlockInfo,
  type DistrictId,
  type GroundRect,
  type MapData,
  type Placement,
} from './types';

/**
 * City Island generator: seed -> island coast, road grid, blocks, districts and
 * every item placement. Pure data (no three.js, no DOM), deterministic per seed.
 * World axes: +X east, +Z south.
 */
export interface CityParams {
  seed: number;
  /** Map size in tiles (blocks): the grid is `tiles x tiles`. */
  tiles: number;
  /**
   * Points per tile. Every seed holds exactly `tiles * tiles * pointsPerTile`
   * points in total (10 x 10 x 300 = 30000), however the tiles are filled.
   */
  pointsPerTile: number;
  /** Mean island radius (m). */
  radius: number;
  /** Radius noise amplitude (m). */
  coastNoise: number;
  /** Block pitch (m): 40 m block + 10 m road. */
  pitch: number;
  beachWidth: number;
  /** Block centre distance limits for districts (m). */
  downtownMax: number;
  commercialMax: number;
  /** Number of park blocks (the first one is near the start). */
  parks: number;
  /** Multiplies the tier 1-3 scatter density. */
  litter: number;
}

export const DEFAULT_CITY: CityParams = {
  seed: 1,
  tiles: 10,
  pointsPerTile: 300,
  radius: 255,
  coastNoise: 14,
  pitch: 50,
  beachWidth: 16,
  downtownMax: 80,
  commercialMax: 135,
  parks: 5,
  litter: 1,
};

export const COLORS = {
  grass: 0x7cc66a,
  grassAlt: 0x72bd61,
  lawn: 0x86c970,
  parkGrass: 0x6bbd5a,
  sand: 0xe8d6a0,
  road: 0x4a4e54,
  mark: 0xe9e4d2,
  markYellow: 0xe8b93a,
  sidewalk: 0xc8c3b6,
  plaza: 0xbdb7a6,
  concrete: 0x9ea3a3,
  path: 0xdccea0,
  playSand: 0xe2cf93,
  quay: 0x9a8f7e,
  water: 0x4aa3df,
  waterDeep: 0x3b92cf,
  foam: 0xeaf6ff,
  skirt: 0x8b6f52,
};

/** Coarse occupancy grid used by both map generators (8 m cells). */
export class Occupancy {
  private cells = new Map<number, [number, number, number][]>();
  private key(cx: number, cz: number) {
    return (cx + 1024) * 4096 + (cz + 1024);
  }
  add(x: number, z: number, r: number): void {
    const k = this.key(Math.floor(x / 8), Math.floor(z / 8));
    const c = this.cells.get(k);
    if (c) c.push([x, z, r]);
    else this.cells.set(k, [[x, z, r]]);
  }
  free(x: number, z: number, r: number): boolean {
    const x0 = Math.floor((x - r - 20) / 8);
    const x1 = Math.floor((x + r + 20) / 8);
    const z0 = Math.floor((z - r - 20) / 8);
    const z1 = Math.floor((z + r + 20) / 8);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(this.key(cx, cz));
        if (!c) continue;
        for (const [ox, oz, or] of c)
          if (Math.hypot(ox - x, oz - z) < (or + r) * 0.9) return false;
      }
    return true;
  }
}

interface Ctx {
  p: CityParams;
  rng: Rng;
  coast: number[];
  placements: Placement[];
  rects: GroundRect[];
  occ: Occupancy;
  /** Ground lookup for the spawn rules; set once the roads exist (before any item is placed). */
  zones: ZoneMap | null;
  /** Blocks by use, for the zone samplers. */
  lists: { live: Block[]; lots: Block[]; parks: Block[]; edges: Block[] };
}

/** Total points every map of these parameters holds (before the clear bonus). */
export function targetPoints(
  p: Pick<CityParams, 'tiles' | 'pointsPerTile'>,
): number {
  return p.tiles * p.tiles * p.pointsPerTile;
}

const rad = (id: string) => {
  const i = getItem(id);
  return Math.max(i.w, i.d) / 2;
};

/** Shuffled round-robin deck: every entry shows up before any repeats. */
function deck<T>(rng: Rng, list: T[]): () => T {
  let order: T[] = [];
  return () => {
    if (!order.length) {
      order = list.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return order.pop()!;
  };
}

function put(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot = 0,
  o: { variant?: number; paint?: number; occ?: boolean } = {},
): void {
  if (!hasItem(id)) throw new Error(`unknown item ${id}`);
  const info = getItem(id);
  c.placements.push({
    item: id,
    x,
    z,
    rot,
    variant:
      o.variant ?? (info.variants > 1 ? c.rng.int(0, info.variants - 1) : 0),
    paint:
      o.paint ??
      (info.paints?.length ? c.rng.int(0, info.paints.length - 1) : -1),
  });
  if (o.occ !== false) c.occ.add(x, z, Math.max(info.w, info.d) / 2);
}

/**
 * Place only when nothing is in the way, the item may stand on this ground (`SPAWN` in
 * map/spawn.ts: only vehicles may touch a road) and it is inside the island.
 */
function tryPut(
  c: Ctx,
  id: string,
  x: number,
  z: number,
  rot = 0,
  inset = 4,
  o: { variant?: number; paint?: number } = {},
): boolean {
  if (!insideIsland(c.coast, x, z, inset)) return false;
  if (c.zones && spawnViolation(c.zones, id, x, z, rot)) return false;
  if (!c.occ.free(x, z, rad(id))) return false;
  put(c, id, x, z, rot, o);
  return true;
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

function makeCoast(
  p: CityParams,
  noise: Noise2D,
  harbourAngle: number,
): number[] {
  const n = 128;
  const out: number[] = [];
  // own RNG: the shape of the coast never shifts the draws of the main generator
  const fr = new Rng(p.seed * 104729 + 17);
  const features = Array.from({ length: fr.int(3, 5) }, () => ({
    angle: harbourAngle + fr.range(1.0, Math.PI * 2 - 1.0),
    width: fr.range(0.1, 0.24),
    amp: fr.range(9, 18) * (fr.chance(0.55) ? 1 : -1),
  }));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    let r =
      p.radius +
      p.coastNoise * noise.noise2(cx * 1.2 + 3, sz * 1.2 + 7) +
      p.coastNoise * 0.35 * noise.noise2(cx * 4 + 11, sz * 4 + 5);
    // the harbour: a real bay (about 46 m deep, 130 m wide) with a headland on each side
    let da = Math.abs(a - harbourAngle);
    da = Math.min(da, Math.PI * 2 - da);
    r -= 46 * Math.exp(-((da / 0.3) * (da / 0.3)));
    r += 11 * Math.exp(-(((da - 0.55) / 0.15) * ((da - 0.55) / 0.15)));
    // other headlands (+) and inlets (-) around the island, away from the bay
    for (const f of features) {
      let df = Math.abs(a - f.angle);
      df = Math.min(df, Math.PI * 2 - df);
      r += f.amp * Math.exp(-((df / f.width) * (df / f.width)));
    }
    out.push(r);
  }
  return out;
}

interface Block extends BlockInfo {
  /** Distance of the block centre from the island centre. */
  d: number;
}

/**
 * The canal: one road line of the grid (a column or a row, near the middle of the island) is water
 * instead of asphalt. The crossings on it stay asphalt and are the bridges (`city-decor.ts` adds the
 * parapets); at both ends it runs on to the coast. The hole is only clamped to the coast, so it
 * crosses the canal like everything else.
 */
interface Canal {
  /** 'z' = runs north-south at x = line, 'x' = runs east-west at z = line. */
  axis: 'x' | 'z';
  line: number;
}

function pickCanal(p: CityParams): Canal {
  // own RNG: the choice never shifts the draws of the main generator
  const r = new Rng(p.seed * 6151 + 29);
  const shift = p.tiles % 2 === 0 ? 1 : 0.5;
  const lo = -Math.floor(p.tiles / 2) - 1;
  const lines: number[] = [];
  for (let i = lo; i <= lo + p.tiles; i++) {
    const l = (i + shift) * p.pitch;
    if (Math.abs(l) <= p.pitch * 2.01) lines.push(l);
  }
  return { axis: r.chance(0.5) ? 'z' : 'x', line: r.pick(lines) };
}

const SIDES = [
  { name: 'S', nx: 0, nz: 1, rot: 0 },
  { name: 'N', nx: 0, nz: -1, rot: Math.PI },
  { name: 'E', nx: 1, nz: 0, rot: Math.PI / 2 },
  { name: 'W', nx: -1, nz: 0, rot: -Math.PI / 2 },
] as const;

export function generateCity(params: Partial<CityParams> = {}): MapData {
  const p: CityParams = { ...DEFAULT_CITY, ...params };
  const rng = new Rng(p.seed * 7919 + 13);
  const noise = new Noise2D(p.seed);
  const harbourAngle = rng.range(0, Math.PI * 2);
  const coast = makeCoast(p, noise, harbourAngle);
  const c: Ctx = {
    p,
    rng,
    coast,
    placements: [],
    rects: [],
    occ: new Occupancy(),
    zones: null,
    lists: { live: [], lots: [], parks: [], edges: [] },
  };

  const canal = pickCanal(p);
  const blocks = classify(c);
  c.lists = {
    live: blocks.filter((b) => b.district !== 'edge'),
    lots: blocks.filter((b) => b.district !== 'edge' && b.district !== 'park'),
    parks: blocks.filter((b) => b.district === 'park'),
    edges: blocks.filter(
      (b) =>
        b.district === 'edge' &&
        insideIsland(coast, b.cx, b.cz, p.beachWidth + 4),
    ),
  };
  // the landmark stands in one (seeded) block of the central 2x2; the others are downtown towers
  const coreBlocks = blocks.filter((b) => b.district === 'core');
  const landmark = coreBlocks.length
    ? coreBlocks[rng.int(0, coreBlocks.length - 1)]
    : null;

  // ---- ground: roads, markings, sidewalks, lots -------------------------------------
  buildRoads(c, blocks, canal);
  c.zones = makeZoneMap({
    rects: c.rects,
    blocks,
    coast,
    beachWidth: p.beachWidth,
    pitch: p.pitch,
  });
  for (const b of blocks) {
    if (b.district === 'edge') continue;
    rect(c, b.cx - 20, b.cz - 20, b.cx + 20, b.cz + 20, 0.024, COLORS.sidewalk);
    const lot =
      b.district === 'park'
        ? COLORS.parkGrass
        : b.district === 'residential'
          ? COLORS.lawn
          : b.district === 'core'
            ? COLORS.plaza
            : b.district === 'downtown'
              ? COLORS.plaza
              : COLORS.concrete;
    rect(c, b.cx - 17, b.cz - 17, b.cx + 17, b.cz + 17, 0.032, lot);
  }

  // ---- lots ----------------------------------------------------------------------------
  const commercialDeck = deck(rng, [
    'apartment_block',
    'shop_row',
    'corner_shop',
    'office_lowrise',
    'school',
    'townhouse_row',
    'gas_station',
  ]);
  const downtownDeck = deck(rng, [
    'skyscraper_needle',
    'skyscraper_mega',
    'skyscraper_tall',
    'skyscraper_twin',
    'skyscraper_glass',
    'skyscraper_stepped',
    'skyscraper_slim',
    'hotel',
  ]);
  const bigDeck = deck(rng, [
    'parking_garage',
    'apartment_tower',
    'hotel',
    'skyscraper_slim',
    'parking_garage',
    'apartment_tower',
  ]);
  const parkKinds = deck(rng, [0, 1, 2]);
  const tier21 = ['parking_garage', 'apartment_tower'];
  for (const b of blocks) {
    switch (b.district) {
      case 'core':
        if (b === landmark) put(c, 'landmark_tower', b.cx, b.cz, 0);
        else downtownBlock(c, b, downtownDeck);
        break;
      case 'downtown':
        downtownBlock(c, b, downtownDeck);
        break;
      case 'commercial':
        // the first two commercial blocks always get a garage and an apartment tower (size tier 21)
        commercialBlock(c, b, commercialDeck, bigDeck, tier21.shift());
        break;
      case 'residential':
        residentialBlock(c, b);
        break;
      case 'park':
        parkBlock(c, b, parkKinds());
        break;
      default:
        break;
    }
  }

  // ---- streets, beach, harbour, scatter -------------------------------------------------
  for (const b of blocks) if (b.district !== 'edge') sidewalkFurniture(c, b);
  traffic(c, blocks, canal);
  canalBoats(c);
  beach(c);
  harbour(c, harbourAngle);
  edgeNature(c, blocks);
  litter(c, blocks);
  ensureAllTypes(c);
  const start = startPoint(c, blocks);
  balancePoints(c, start);
  return {
    id: 'city',
    seed: p.seed,
    coast,
    beachWidth: p.beachWidth,
    rects: c.rects,
    blocks: blocks.map(({ d: _d, ...b }) => b),
    placements: c.placements,
    start,
  };
}

// ---------------------------------------------------------------------------------------
function classify(c: Ctx): Block[] {
  const { p, rng, coast } = c;
  const blocks: Block[] = [];
  const lo = -Math.floor(p.tiles / 2);
  const hi = lo + p.tiles - 1;
  const shift = p.tiles % 2 === 0 ? 0.5 : 0;
  const dnoise = new Noise2D(p.seed + 977);
  const avenueAngle = new Rng(p.seed * 7 + 3).range(0, Math.PI);
  for (let i = lo; i <= hi; i++)
    for (let j = lo; j <= hi; j++) {
      const cx = (i + shift) * p.pitch;
      const cz = (j + shift) * p.pitch;
      const d = Math.hypot(cx, cz);
      // district rings are warped by noise (blobby, different on every seed) and a seeded avenue of
      // commercial blocks cuts through the residential part; the core stays a clean ring
      const warped =
        d < p.pitch * 0.8
          ? d
          : d + 16 * dnoise.noise2(cx / 70 + 7.3, cz / 70 + 3.1);
      const avenue =
        Math.abs(-Math.sin(avenueAngle) * cx + Math.cos(avenueAngle) * cz) <
          p.pitch * 0.6 && d <= p.commercialMax * 1.45;
      const valid = [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ].every(([dx, dz]) =>
        insideIsland(coast, cx + dx, cz + dz, p.beachWidth * 0.5),
      );
      let district: DistrictId = 'edge';
      if (valid) {
        district =
          d < p.pitch * 0.8
            ? 'core'
            : warped <= p.downtownMax
              ? 'downtown'
              : warped <= p.commercialMax || avenue
                ? 'commercial'
                : 'residential';
      }
      blocks.push({ i, j, cx, cz, district, d });
    }
  // parks: the first near the centre (the start), the rest anywhere in commercial / residential
  const candidates = blocks.filter(
    (b) => b.district === 'commercial' || b.district === 'residential',
  );
  const near = candidates
    .filter((b) => b.d > p.downtownMax && b.d < p.commercialMax)
    .sort((a, b) => a.d - b.d);
  const used = new Set<Block>();
  if (near.length) {
    const pick = near[rng.int(0, Math.min(3, near.length - 1))];
    pick.district = 'park';
    used.add(pick);
  }
  let guard = 0;
  while (used.size < p.parks && guard++ < 200) {
    const b = candidates[rng.int(0, candidates.length - 1)];
    if (used.has(b) || b.d < p.downtownMax) continue;
    b.district = 'park';
    used.add(b);
  }
  return blocks;
}

/** A clear spot in the park nearest the centre, with plenty of tier 1-3 items around it. */
function startPoint(c: Ctx, blocks: Block[]): { x: number; z: number } {
  const parks = blocks
    .filter((b) => b.district === 'park')
    .sort((a, b) => a.d - b.d);
  const b = parks[0] ?? blocks.find((q) => q.district !== 'edge')!;
  let best = { x: b.cx, z: b.cz };
  let bestScore = -Infinity;
  for (let r = 0; r <= 14; r += 2) {
    for (let k = 0; k < (r === 0 ? 1 : 12); k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = b.cx + Math.cos(a) * r;
      const z = b.cz + Math.sin(a) * r;
      let nearest = Infinity;
      let small = 0;
      for (const p of c.placements) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
        const info = getItem(p.item);
        const d = Math.hypot(dx, dz) - Math.max(info.w, info.d) / 2;
        nearest = Math.min(nearest, d);
        if (info.tier <= 3) small++;
      }
      const score =
        (nearest < 1.2 ? -100 : 0) + Math.min(nearest, 3) * 4 + small;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  return best;
}

function buildRoads(c: Ctx, blocks: Block[], canal: Canal): void {
  const { p } = c;
  /** Stretches of the canal line already covered by an arm or a crossing (t along the line). */
  const covered: [number, number][] = [];
  const onCanal = (axis: 'x' | 'z', fixed: number) =>
    canal.axis === axis && Math.abs(fixed - canal.line) < 1;
  const live = new Set(
    blocks.filter((b) => b.district !== 'edge').map((b) => `${b.i},${b.j}`),
  );
  const has = (i: number, j: number) => live.has(`${i},${j}`);
  // vertical road between block columns i and i+1, segment between rows j and j+1 etc.
  const lo = -Math.floor(p.tiles / 2) - 1;
  const hi = lo + p.tiles;
  const shift = p.tiles % 2 === 0 ? 1 : 0.5;
  for (let i = lo; i <= hi; i++) {
    for (let j = lo; j <= hi; j++) {
      const x = (i + shift) * p.pitch;
      const z = (j + shift) * p.pitch;
      // road crossing at (x, z); neighbours = four surrounding blocks
      const around = [
        has(i, j),
        has(i + 1, j),
        has(i, j + 1),
        has(i + 1, j + 1),
      ];
      if (!around.some(Boolean)) continue;
      rect(c, x - 5, z - 5, x + 5, z + 5, ROAD_Y, COLORS.road);
      if (onCanal('z', x)) covered.push([z - 5, z + 5]);
      if (onCanal('x', z)) covered.push([x - 5, x + 5]);
      // arm towards +z (between blocks (i,j+1) and (i+1,j+1))
      if (has(i, j + 1) || has(i + 1, j + 1)) {
        if (onCanal('z', x)) {
          rect(c, x - 5, z + 5, x + 5, z + p.pitch - 5, CANAL_Y, COLORS.water);
          covered.push([z + 5, z + p.pitch - 5]);
        } else {
          rect(c, x - 5, z + 5, x + 5, z + p.pitch - 5, ROAD_Y, COLORS.road);
          dashes(c, x, z + 5, z + p.pitch - 5, 'z');
          zebra(c, x, z + 5, 1, 'z');
          zebra(c, x, z + p.pitch - 5, -1, 'z');
        }
      }
      // arm towards +x
      if (has(i + 1, j) || has(i + 1, j + 1)) {
        if (onCanal('x', z)) {
          rect(c, x + 5, z - 5, x + p.pitch - 5, z + 5, CANAL_Y, COLORS.water);
          covered.push([x + 5, x + p.pitch - 5]);
        } else {
          rect(c, x + 5, z - 5, x + p.pitch - 5, z + 5, ROAD_Y, COLORS.road);
          dashes(c, z, x + 5, x + p.pitch - 5, 'x');
          zebra(c, z, x + 5, 1, 'x');
          zebra(c, z, x + p.pitch - 5, -1, 'x');
        }
      }
    }
  }
  // the canal runs on to the coast where there is no road: fill every gap of its line with water
  const at = (t: number): [number, number] =>
    canal.axis === 'z' ? [canal.line, t] : [t, canal.line];
  let t0 = Infinity;
  let t1 = -Infinity;
  for (let t = -p.radius - 60; t <= p.radius + 60; t += 1) {
    const [x, z] = at(t);
    if (insideIsland(c.coast, x, z, 0.5)) {
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  }
  if (t1 > t0) {
    covered.sort((a, b) => a[0] - b[0]);
    let cursor = t0;
    const water = (a: number, b: number) => {
      if (b - a < 0.5) return;
      if (canal.axis === 'z')
        rect(c, canal.line - 5, a, canal.line + 5, b, CANAL_Y, COLORS.water);
      else rect(c, a, canal.line - 5, b, canal.line + 5, CANAL_Y, COLORS.water);
    };
    for (const [a, b] of covered) {
      if (a > cursor) water(cursor, Math.min(a, t1));
      cursor = Math.max(cursor, b);
    }
    if (cursor < t1) water(cursor, t1);
  }
}

/**
 * Zebra crossing on a road arm, starting at `edge` and running `dir` (+1 / -1) along
 * the road axis; stripes run along the road and are spread across its 10 m width.
 */
function zebra(
  c: Ctx,
  fixed: number,
  edge: number,
  dir: 1 | -1,
  axis: 'x' | 'z',
): void {
  const a = edge + dir * 0.8;
  const b = edge + dir * 3.6;
  const [t0, t1] = a < b ? [a, b] : [b, a];
  for (let o = -4.1; o < 4; o += 1.25) {
    if (axis === 'z')
      rect(c, fixed + o, t0, fixed + o + 0.65, t1, 0.022, COLORS.mark);
    else rect(c, t0, fixed + o, t1, fixed + o + 0.65, 0.022, COLORS.mark);
  }
}

function dashes(
  c: Ctx,
  fixed: number,
  a: number,
  b: number,
  axis: 'x' | 'z',
): void {
  for (let t = a + 7; t + 2.5 < b - 7; t += 6) {
    if (axis === 'z')
      rect(c, fixed - 0.15, t, fixed + 0.15, t + 2.5, 0.02, COLORS.markYellow);
    else
      rect(c, t, fixed - 0.15, t + 2.5, fixed + 0.15, 0.02, COLORS.markYellow);
  }
}

// ---------------------------------------------------------------------------------------
function downtownBlock(c: Ctx, b: Block, next: () => string): void {
  const id = next();
  put(c, id, b.cx, b.cz, 0);
}

function commercialBlock(
  c: Ctx,
  b: Block,
  next: () => string,
  big: () => string,
  forced?: string,
): void {
  const r = forced ? 0.6 : c.rng.next();
  if (r < 0.5) {
    // four 17 m cells
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const id = next();
        put(c, id, b.cx + sx * 8.5, b.cz + sz * 8.5, sz > 0 ? 0 : Math.PI);
        lotExtras(c, b.cx + sx * 8.5, b.cz + sz * 8.5, sz, id);
      }
  } else if (r < 0.82) {
    const id = forced ?? big();
    put(c, id, b.cx, b.cz, c.rng.chance(0.5) ? 0 : Math.PI);
    for (const [dx, dz] of [
      [-15, -14],
      [15, 14],
    ]) {
      tryPut(
        c,
        c.rng.pick(['food_truck', 'van', 'kiosk_shop', 'delivery_truck']),
        b.cx + dx,
        b.cz + dz,
        0,
        2,
      );
    }
  } else {
    // two 34 x 17 halves
    for (const sz of [-1, 1]) {
      const id = next();
      const wide = [
        'shop_row',
        'apartment_block',
        'townhouse_row',
        'gas_station',
      ].includes(id);
      put(c, id, b.cx + (wide ? -6 : 0), b.cz + sz * 8.5, sz > 0 ? 0 : Math.PI);
      lotExtras(c, b.cx, b.cz + sz * 8.5, sz, id);
      tryPut(
        c,
        c.rng.pick(['car_sedan', 'car_compact', 'van']),
        b.cx + 10,
        b.cz + sz * 11,
        0,
        2,
      );
      tryPut(
        c,
        c.rng.pick(['car_sedan', 'car_compact', 'pickup']),
        b.cx + 10,
        b.cz + sz * 5,
        0,
        2,
      );
    }
  }
  if (c.rng.chance(0.3)) tryPut(c, 'fire_truck', b.cx + 8, b.cz + 15.5, 0, 2);
}

function lotExtras(
  c: Ctx,
  cx: number,
  cz: number,
  sz: number,
  id: string,
): void {
  const r = c.rng;
  const info = getItem(id);
  const frontZ = cz + sz * (Math.max(info.d, 6) / 2 + 1.2);
  if (r.chance(0.7)) tryPut(c, 'planter', cx - 4, frontZ, 0, 2);
  if (r.chance(0.5)) tryPut(c, 'trash_can', cx + 5, frontZ, 0, 2);
  if (r.chance(0.35)) tryPut(c, 'dumpster', cx + 6, cz - sz * 6.5, 0, 2);
  if (r.chance(0.4))
    tryPut(
      c,
      r.pick(['car_compact', 'car_sedan']),
      cx + 4,
      frontZ + sz * 1.2,
      0,
      2,
    );
  if (r.chance(0.25))
    tryPut(c, 'shopping_cart', cx - 7, frontZ, r.range(0, 6.28), 2);
  if (r.chance(0.14)) tryPut(c, 'delivery_truck', cx - 6, cz - sz * 6.5, 0, 2);
}

function residentialBlock(c: Ctx, b: Block): void {
  const r = c.rng;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = b.cx + sx * 8.5;
      const cz = b.cz + sz * 8.5;
      const rot = sz > 0 ? 0 : Math.PI;
      const roll = r.next();
      const id =
        roll < 0.45 ? 'house' : roll < 0.85 ? 'house_small' : 'townhouse_row';
      put(c, id, cx, cz - sz * 1.2, rot);
      // front fence with a gate gap, back hedge
      const fz = cz + sz * 8.2;
      for (let k = 0; k < 8; k++) {
        if (k === 3 || k === 4) continue;
        put(c, 'fence_section', cx - 7.35 + k * 2.1, fz, 0, { occ: false });
      }
      for (let k = 0; k < 4; k++)
        put(c, 'hedge', cx - 6.3 + k * 4.2, cz - sz * 8.2, 0, { occ: false });
      // yard
      tryPut(
        c,
        r.pick(['pickup', 'car_sedan', 'car_compact']),
        cx + sx * 1.5,
        cz + sz * 5.9,
        0,
        2,
      );
      tryPut(c, 'mailbox', cx - 7, fz + sz * 1.2, rot, 2);
      for (const dx of [-3, 3])
        tryPut(c, 'bush_small', cx + dx, cz + sz * 3.9, 0, 2);
      if (r.chance(0.6))
        tryPut(
          c,
          r.pick(['tree_small', 'tree']),
          cx + sx * 6.3,
          cz - sz * 6,
          0,
          2,
        );
      if (r.chance(0.45))
        tryPut(c, 'garden_shed', cx - sx * 5.5, cz - sz * 6.8, 0, 2);
      if (r.chance(0.1))
        tryPut(c, 'swing_set', cx + sx * 4.5, cz - sz * 5.5, 0, 2);
      else if (r.chance(0.07))
        tryPut(c, 'playground_slide', cx + sx * 4.5, cz - sz * 5.5, 0, 2);
      if (r.chance(0.5))
        tryPut(c, 'recycling_bins', cx + sx * 6.5, cz + sz * 4.2, 0, 2);
      for (let k = 0; k < 4; k++)
        tryPut(
          c,
          'flower',
          cx + r.range(-7, 7),
          cz + sz * r.range(2, 7.5),
          0,
          2,
        );
      tryPut(c, 'trash_can', cx + 7.5, fz - sz * 1.2, 0, 2);
    }
}

function parkBlock(c: Ctx, b: Block, kind: number): void {
  const r = c.rng;
  const { cx, cz } = b;
  rect(c, cx - 1.6, cz - 16, cx + 1.6, cz + 16, 0.036, COLORS.path);
  rect(c, cx - 16, cz - 1.6, cx + 16, cz + 1.6, 0.036, COLORS.path);
  const trees = ['tree', 'tree_small', 'tree', 'tree_big'];
  if (kind === 0) {
    put(c, 'fountain', cx, cz, 0);
    for (const [dx, dz, rot] of [
      [0, 4.5, 0],
      [0, -4.5, Math.PI],
      [4.5, 0, Math.PI / 2],
      [-4.5, 0, -Math.PI / 2],
    ] as const)
      put(c, 'bench', cx + dx, cz + dz, rot);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        put(c, 'flower_bed', cx + sx * 8, cz + sz * 8, 0);
        put(c, 'tree_big', cx + sx * 13, cz + sz * 13, 0);
      }
    put(c, 'statue', cx, cz + 11, 0);
    put(c, 'statue', cx, cz - 11, Math.PI);
  } else if (kind === 1) {
    rect(c, cx - 14, cz - 14, cx - 2, cz - 2, 0.04, COLORS.playSand);
    put(c, 'swing_set', cx - 8, cz - 8, 0);
    put(c, 'playground_slide', cx - 5, cz - 12, 0);
    for (const [dx, dz] of [
      [8, 8],
      [13, 7],
      [8, 13],
    ])
      put(c, 'picnic_table', cx + dx, cz + dz, r.pick([0, Math.PI / 2]));
    for (const [dx, dz, rot] of [
      [-4, 4, Math.PI],
      [4, -4, 0],
      [-12, 4, Math.PI],
      [12, -4, 0],
    ] as const)
      put(c, 'bench', cx + dx, cz + dz, rot);
    for (let k = 0; k < 7; k++)
      tryPut(
        c,
        r.pick(trees),
        cx + r.range(-15, 15),
        cz + r.range(-15, 15),
        0,
        2,
      );
  } else {
    for (let k = 0; k < 16; k++)
      tryPut(
        c,
        r.pick(trees),
        cx + r.range(-15, 15),
        cz + r.range(-15, 15),
        0,
        2,
      );
    put(c, 'picnic_table', cx + 6, cz + 6, 0);
    put(c, 'bench', cx - 6, cz - 6, 0);
    put(c, 'flower_bed', cx - 8, cz + 8, 0);
  }
  tryPut(c, r.pick(['food_truck', 'hotdog_stand']), cx + 12, cz - 14.5, 0, 2);
  for (let k = 0; k < 8; k++)
    tryPut(
      c,
      r.pick(['bush_small', 'bush_large']),
      cx + r.range(-16, 16),
      cz + r.range(-16, 16),
      0,
      2,
    );
  for (let k = 0; k < 4; k++)
    tryPut(c, 'trash_can', cx + r.range(-14, 14), cz + r.range(-14, 14), 0, 2);
  const dense = Math.round(30 * c.p.litter);
  for (let k = 0; k < dense; k++) {
    tryPut(
      c,
      'grass_tuft',
      cx + r.range(-16, 16),
      cz + r.range(-16, 16),
      r.range(0, 6.28),
      2,
    );
    tryPut(c, 'flower', cx + r.range(-16, 16), cz + r.range(-16, 16), 0, 2);
  }
}

// ---------------------------------------------------------------------------------------
function sidewalkFurniture(c: Ctx, b: Block): void {
  const r = c.rng;
  const d = b.district;
  const busy = d === 'core' || d === 'downtown';
  const comm = busy || d === 'commercial';
  for (const side of SIDES) {
    // positions along the side: t in [-16, 16]
    const off = 18.5;
    const at = (t: number, o = off) => ({
      x: b.cx + side.nx * o + (side.nx === 0 ? t : 0),
      z: b.cz + side.nz * o + (side.nz === 0 ? t : 0),
    });
    for (const t of [-16, 0, 16]) {
      const q = at(t);
      if (r.chance(0.9)) tryPut(c, 'lamp_post', q.x, q.z, side.rot, 2);
    }
    if (busy) {
      for (const t of [-12, -4, 4, 12]) {
        const q = at(t + r.range(-1, 1), 17.4);
        tryPut(
          c,
          r.pick(['parking_meter', 'newspaper_box', 'bollard', 'trash_can']),
          q.x,
          q.z,
          side.rot,
          2,
        );
      }
    }
    if (comm && r.chance(0.35)) {
      const q = at(r.range(-9, 9), 18.2);
      tryPut(c, 'bus_stop', q.x, q.z, side.rot + Math.PI, 2);
    }
    if (comm && r.chance(0.16)) {
      const q = at(r.range(-10, 10), 19.6);
      tryPut(c, 'billboard', q.x, q.z, side.rot, 1);
    }
    if (comm && r.chance(0.3)) {
      const q = at(r.range(-12, 12), 18.8);
      tryPut(c, 'vending_machine', q.x, q.z, side.rot, 2);
    }
    if (r.chance(0.45)) {
      const q = at(r.range(-12, 12), 19.0);
      tryPut(c, 'fire_hydrant', q.x, q.z, 0, 2);
    }
    if (r.chance(0.35)) {
      const q = at(r.range(-12, 12), 18.2);
      tryPut(c, 'trash_can', q.x, q.z, 0, 2);
    }
    if (r.chance(0.25)) {
      const q = at(r.range(-12, 12), 18.2);
      tryPut(c, r.pick(['street_sign', 'bollard']), q.x, q.z, side.rot, 2);
    }
    if (d === 'residential' && r.chance(0.3)) {
      const q = at(r.range(-12, 12), 17.6);
      tryPut(c, 'tree_small', q.x, q.z, 0, 2);
    }
    // pedestrians
    const pedCount = busy ? 3 : comm ? 2 : 1;
    for (let k = 0; k < pedCount; k++) {
      if (!r.chance(busy ? 0.9 : 0.6)) continue;
      const q = at(r.range(-16, 16), r.range(17.6, 19.4));
      tryPut(c, 'pedestrian', q.x, q.z, r.range(0, 6.28), 2);
    }
    // parked cars at the curb
    const carChance = busy ? 0.55 : comm ? 0.5 : 0.4;
    for (const t of [-11, 0, 11]) {
      if (!r.chance(carChance)) continue;
      const q = at(t + r.range(-2, 2), 21.0);
      const id = r.pick(
        busy
          ? ['car_sedan', 'taxi', 'car_compact', 'police_car']
          : ['car_sedan', 'car_compact', 'pickup', 'van'],
      );
      tryPut(c, id, q.x, q.z, side.nz !== 0 ? 0 : Math.PI / 2, 2);
    }
  }
  // corner details: every crossing corner of a live block gets a traffic light (busy / commercial
  // blocks) or a street sign (residential blocks, parks); the odd cone next to it
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = b.cx + sx * 19;
      const z = b.cz + sz * 19;
      tryPut(
        c,
        comm ? 'traffic_light' : 'street_sign',
        x,
        z,
        sx > 0 ? Math.PI / 2 : -Math.PI / 2,
        2,
      );
      if (r.chance(0.18))
        tryPut(c, 'traffic_cone', x - sx * 1.1, z - sz * 1.1, 0, 2);
    }
}

function traffic(c: Ctx, blocks: Block[], canal: Canal): void {
  const { p, rng: r } = c;
  const live = new Set(
    blocks
      .filter((b) => b.district !== 'edge')
      .map((b) => b.district + `:${b.i},${b.j}`),
  );
  void live;
  const byKey = new Map(blocks.map((b) => [`${b.i},${b.j}`, b]));
  let tram = 0;
  // one lane vehicle per road segment on average
  const lo = -Math.floor(p.tiles / 2) - 1;
  const hi = lo + p.tiles;
  const shift = p.tiles % 2 === 0 ? 1 : 0.5;
  for (let i = lo; i <= hi; i++)
    for (let j = lo; j <= hi; j++) {
      const x = (i + shift) * p.pitch;
      const z = (j + shift) * p.pitch;
      // horizontal segment from crossing (i, j) to (i+1, j): next to blocks (i+1, j) and (i+1, j+1)
      const nb = byKey.get(`${i + 1},${j}`) ?? byKey.get(`${i + 1},${j + 1}`);
      const canalX = canal.axis === 'x' && Math.abs(z - canal.line) < 1;
      const canalZ = canal.axis === 'z' && Math.abs(x - canal.line) < 1;
      if (nb && nb.district !== 'edge' && !canalX) {
        vehicleOn(
          c,
          nb,
          x + p.pitch / 2,
          z,
          'x',
          tram === 0 && nb.district === 'downtown',
        );
        if (nb.district === 'downtown') tram++;
      }
      const nb2 = byKey.get(`${i},${j + 1}`) ?? byKey.get(`${i + 1},${j + 1}`);
      if (nb2 && nb2.district !== 'edge' && !canalZ)
        vehicleOn(c, nb2, x, z + p.pitch / 2, 'z', false);
    }
  void r;
}

function vehicleOn(
  c: Ctx,
  b: Block,
  x: number,
  z: number,
  axis: 'x' | 'z',
  tram: boolean,
): void {
  const r = c.rng;
  if (!r.chance(0.8)) return;
  const d = b.district;
  const busy = d === 'core' || d === 'downtown';
  const pool = busy
    ? ['taxi', 'car_sedan', 'bus', 'police_car', 'taxi', 'car_compact']
    : d === 'commercial'
      ? [
          'van',
          'delivery_truck',
          'car_sedan',
          'bus',
          'car_compact',
          'food_truck',
        ]
      : ['pickup', 'car_compact', 'car_sedan', 'pickup'];
  const id = tram ? 'tram' : r.pick(pool);
  const lane = (r.chance(0.5) ? 1 : -1) * (tram ? 0 : 2.4);
  const along = r.range(-6, 6);
  const px = axis === 'x' ? x + along : x + lane;
  const pz = axis === 'x' ? z + lane : z + along;
  const rot =
    axis === 'x'
      ? lane >= 0
        ? 0
        : Math.PI
      : lane >= 0
        ? Math.PI / 2
        : -Math.PI / 2;
  tryPut(c, id, px, pz, rot, 2);
}

/** A few rowboats on the canal. */
function canalBoats(c: Ctx): void {
  const water = c.rects.filter((r) => r.y === CANAL_Y);
  if (!water.length) return;
  let placed = 0;
  for (let k = 0; k < 80 && placed < 5; k++) {
    const q = c.rng.pick(water);
    const alongX = q.x1 - q.x0 > q.z1 - q.z0;
    const x = c.rng.range(q.x0 + 1.5, q.x1 - 1.5);
    const z = c.rng.range(q.z0 + 1.5, q.z1 - 1.5);
    if (tryPut(c, 'rowboat', x, z, alongX ? 0 : Math.PI / 2, 1)) placed++;
  }
}

function beach(c: Ctx): void {
  const { p, rng: r, coast } = c;
  const pool: [string, number][] = [
    ['beach_chair', 3],
    ['beach_umbrella', 3],
    ['palm_tree', 2.2],
    ['pedestrian', 1.5],
    ['grass_tuft', 1.2],
    ['soda_can', 0.8],
    ['bench', 0.6],
    ['rowboat', 0.5],
    ['beach_hut', 0.45],
    ['lifeguard_tower', 0.3],
    ['hotdog_stand', 0.4],
    ['vending_machine', 0.3],
    ['kiosk_shop', 0.25],
    ['trash_can', 0.4],
    ['food_truck', 0.15],
  ];
  const total = pool.reduce((s, [, w]) => s + w, 0);
  const n = Math.round(coast.length * 5.2);
  for (let k = 0; k < n; k++) {
    let roll = r.next() * total;
    let id = pool[0][0];
    for (const [pid, w] of pool) {
      roll -= w;
      if (roll <= 0) {
        id = pid;
        break;
      }
    }
    const a = r.range(0, Math.PI * 2);
    const rr = coastRadius(coast, a) - r.range(2.5, p.beachWidth * 0.95);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    // face the water
    const rot = Math.atan2(Math.cos(a), Math.sin(a));
    tryPut(c, id, x, z, id === 'pedestrian' ? r.range(0, 6.28) : rot, 1);
  }
}

function harbour(c: Ctx, angle: number): void {
  const { coast, rng: r } = c;
  const R = coastRadius(coast, angle);
  const at = (da: number, inward: number) => {
    const a = angle + da;
    const rr = coastRadius(coast, a) - inward;
    return {
      x: Math.cos(a) * rr,
      z: Math.sin(a) * rr,
      rot: Math.atan2(Math.cos(a), Math.sin(a)),
    };
  };
  void R;
  // quay planks
  for (let k = -5; k <= 5; k++) {
    const q = at(k * 0.025, 6);
    rect(c, q.x - 4, q.z - 4, q.x + 4, q.z + 4, 0.04, COLORS.quay);
  }
  for (let k = 0; k < 10; k++) {
    const q = at(r.range(-0.15, 0.15), r.range(3, 10));
    tryPut(
      c,
      r.pick(['wooden_crate', 'wooden_crate', 'rowboat']),
      q.x,
      q.z,
      q.rot + r.range(-0.4, 0.4),
      1,
    );
  }
  // two speedboats on the slipway; try a few spots so crates and boats can't crowd them out
  let boats = 0;
  for (const [da, inward] of [
    [0.12, 8],
    [0.18, 9],
    [-0.16, 9],
    [0.06, 12],
    [-0.04, 14],
    [0.25, 10],
  ] as const) {
    const s = at(da, inward);
    if (tryPut(c, 'speedboat', s.x, s.z, s.rot + Math.PI / 2, 1)) boats++;
    if (boats >= 2) break;
  }
  // spots that fall on a road or a lot (spawn rules) are skipped: try random quay spots for the rest
  for (let k = 0; k < 60 && boats < 2; k++) {
    const s = at(r.range(-0.3, 0.3), r.range(5, 14));
    if (tryPut(c, 'speedboat', s.x, s.z, s.rot + Math.PI / 2, 1)) boats++;
  }
  const t1 = at(-0.1, 12);
  tryPut(c, 'delivery_truck', t1.x, t1.z, t1.rot + Math.PI / 2, 1);
  const t2 = at(0.2, 14);
  tryPut(c, 'delivery_truck', t2.x, t2.z, t2.rot + Math.PI / 2, 1);
  const w = at(-0.2, 24);
  tryPut(c, 'water_tower', w.x, w.z, 0, 1);
  // lighthouse on the opposite headland
  const l = at(Math.PI * 0.8, 6);
  tryPut(c, 'lighthouse', l.x, l.z, 0, 1);
  const l2 = at(-Math.PI * 0.55, 8);
  tryPut(c, 'water_tower', l2.x, l2.z, 0, 1);
}

function edgeNature(c: Ctx, blocks: Block[]): void {
  const r = c.rng;
  for (const b of blocks) {
    if (b.district !== 'edge') continue;
    if (!insideIsland(c.coast, b.cx, b.cz, c.p.beachWidth + 4)) continue;
    const n = r.int(6, 12);
    for (let k = 0; k < n; k++) {
      const x = b.cx + r.range(-24, 24);
      const z = b.cz + r.range(-24, 24);
      tryPut(
        c,
        r.pick([
          'tree',
          'tree_small',
          'tree_big',
          'bush_large',
          'bush_small',
          'hedge',
        ]),
        x,
        z,
        r.range(0, 6.28),
        c.p.beachWidth + 2,
      );
    }
    for (let k = 0; k < 12; k++) {
      const x = b.cx + r.range(-24, 24);
      const z = b.cz + r.range(-24, 24);
      tryPut(c, r.pick(['grass_tuft', 'flower']), x, z, 0, c.p.beachWidth + 2);
    }
  }
}

function litter(c: Ctx, blocks: Block[]): void {
  const r = c.rng;
  for (const b of blocks) {
    if (b.district === 'edge' || b.district === 'park') continue;
    const n = Math.round((b.district === 'residential' ? 8 : 12) * c.p.litter);
    for (let k = 0; k < n; k++) {
      const side = SIDES[r.int(0, 3)];
      const t = r.range(-18, 18);
      const o = r.range(17.2, 19.6);
      const x = b.cx + side.nx * o + (side.nx === 0 ? t : 0);
      const z = b.cz + side.nz * o + (side.nz === 0 ? t : 0);
      const id = r.pick([
        'soda_can',
        'soda_can',
        'litter_paper',
        'litter_paper',
        'trash_bag',
        'traffic_cone',
      ]);
      tryPut(c, id, x, z, r.range(0, 6.28), 2);
    }
    if (b.district === 'residential')
      for (let k = 0; k < 6; k++)
        tryPut(
          c,
          r.pick(['grass_tuft', 'flower']),
          b.cx + r.range(-17, 17),
          b.cz + r.range(-17, 17),
          0,
          2,
        );
  }
}

// ---------------------------------------------------------------------------------------
/** Small scatter items that can be removed to lower the total without changing the look of the map. */
const TRIM_FIRST = new Set([
  'soda_can',
  'litter_paper',
  'trash_bag',
  'flower',
  'grass_tuft',
  'traffic_cone',
  'pedestrian',
  'bush_small',
]);
/** If that is not enough: any small street / nature item. */
const TRIM_THEN = new Set([
  'trash_can',
  'bollard',
  'parking_meter',
  'newspaper_box',
  'street_sign',
  'fire_hydrant',
  'mailbox',
  'planter',
  'hedge',
  'bush_large',
  'tree_small',
]);
/** Items used to top the map up to the exact total (id, weight). Weights favour 1-point scatter so the last points are exact. */
const FILL: [string, number][] = [
  ['grass_tuft', 10],
  ['flower', 10],
  ['soda_can', 4],
  ['litter_paper', 4],
  ['bush_small', 3],
  ['bush_large', 2],
  ['bench', 1],
  ['tree_small', 1],
  ['hedge', 1],
];

/**
 * Mid-tier items (id, weight) that enrich a map whose generated content falls short of the point
 * target (e.g. 300 points per tile): street / yard / nature clutter of tiers 1-12, no big props.
 */
const ENRICH: [string, number][] = [
  ['bush_small', 3],
  ['bush_large', 2.5],
  ['tree_small', 2.5],
  ['tree', 1.5],
  ['flower_bed', 2],
  ['planter', 1.5],
  ['mailbox', 1.2],
  ['hedge', 1.5],
  ['bench', 1.5],
  ['scooter', 1.5],
  ['recycling_bins', 1.2],
  ['wooden_crate', 1],
  ['shopping_cart', 1],
  ['dumpster', 0.8],
  ['pedestrian', 2],
  ['trash_can', 1.5],
  ['fire_hydrant', 1],
  ['car_compact', 0.8],
  ['car_sedan', 0.6],
  ['picnic_table', 0.5],
  ['vending_machine', 0.5],
  ['phone_booth', 0.4],
];
/** Share of the point target left for the 1-point top-up once the enrich pass is done. */
const ENRICH_LEFT = 0.04;

function pointsOf(id: string): number {
  return getItem(id).points;
}

interface Spot {
  x: number;
  z: number;
  rot: number;
}

/** A random position on one kind of ground (see `SpawnZone`); null when the map has none. */
function spotIn(c: Ctx, zone: SpawnZone): Spot | null {
  const r = c.rng;
  const { live, lots, parks, edges } = c.lists;
  const pickBlock = (list: Block[]) => list[r.int(0, list.length - 1)];
  switch (zone) {
    case 'sidewalk':
    case 'road': {
      if (!live.length) return null;
      const b = pickBlock(live);
      const side = SIDES[r.int(0, 3)];
      const t = r.range(-18, 18);
      // sidewalk ring 17.4-19.6 m from the block centre; the curb lane (parked cars) is on the road at 21 m
      const o = zone === 'road' ? 21 : r.range(17.4, 19.6);
      return {
        x: b.cx + side.nx * o + (side.nx === 0 ? t : 0),
        z: b.cz + side.nz * o + (side.nz === 0 ? t : 0),
        rot:
          zone === 'road'
            ? side.nz !== 0
              ? 0
              : Math.PI / 2
            : r.range(0, 6.28),
      };
    }
    case 'lot':
    case 'park': {
      const list = zone === 'lot' ? lots : parks;
      if (!list.length) return null;
      const b = pickBlock(list);
      return {
        x: b.cx + r.range(-16, 16),
        z: b.cz + r.range(-16, 16),
        rot: r.range(0, 6.28),
      };
    }
    case 'lawn': {
      if (!edges.length) return null;
      const b = pickBlock(edges);
      return {
        x: b.cx + r.range(-22, 22),
        z: b.cz + r.range(-22, 22),
        rot: r.range(0, 6.28),
      };
    }
    case 'water': {
      const water = c.rects.filter((q) => q.y === CANAL_Y);
      if (!water.length) return null;
      const q = r.pick(water);
      return {
        x: r.range(q.x0 + 1.5, q.x1 - 1.5),
        z: r.range(q.z0 + 1.5, q.z1 - 1.5),
        rot: q.x1 - q.x0 > q.z1 - q.z0 ? 0 : Math.PI / 2,
      };
    }
    case 'beach': {
      const a = r.range(0, Math.PI * 2);
      const rr = coastRadius(c.coast, a) - r.range(2.5, c.p.beachWidth * 0.95);
      return {
        x: Math.cos(a) * rr,
        z: Math.sin(a) * rr,
        rot: Math.atan2(Math.cos(a), Math.sin(a)),
      };
    }
  }
}

/** A random position on ground the item may spawn on (a random one of its zones). */
function spotFor(c: Ctx, id: string): Spot | null {
  const zones = SPAWN[id];
  if (!zones?.length) return null;
  return spotIn(c, zones[c.rng.int(0, zones.length - 1)]);
}

/**
 * Make the map hold exactly `targetPoints` points: trim small scatter items when
 * the random layout came out too rich, then top up with small scatter items
 * until the total is exact. The last points are always 1-point items, so any
 * target is reachable.
 */
function balancePoints(c: Ctx, start: { x: number; z: number }): void {
  const target = targetPoints(c.p);
  let total = c.placements.reduce((s, p) => s + pointsOf(p.item), 0);

  const smallTier = (max: number) =>
    new Set(ITEMS.filter((i) => i.tier <= max).map((i) => i.id));
  // last resorts (other map sizes): trim any item up to a size tier, small ones first
  for (const set of [TRIM_FIRST, TRIM_THEN, smallTier(12), smallTier(20)]) {
    if (total <= target) break;
    const idx: number[] = [];
    c.placements.forEach((p, i) => {
      // never thin out the area around the start: the first seconds should be busy
      if (set.has(p.item) && Math.hypot(p.x - start.x, p.z - start.z) > 28)
        idx.push(i);
    });
    // shuffle, then drop from the front until we are at or under the target
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(c.rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const drop = new Set<number>();
    for (const i of idx) {
      if (total <= target) break;
      drop.add(i);
      total -= pointsOf(c.placements[i].item);
    }
    c.placements = c.placements.filter((_, i) => !drop.has(i));
  }

  // a big deficit (denser maps): enrich with mid-tier street / yard / nature items first, so the
  // map gets richer instead of being padded with thousands of 1-point tufts
  const enrichUntil = target * ENRICH_LEFT;
  if (target - total > enrichUntil) {
    const pool = ENRICH.reduce((a, [, w]) => a + w, 0);
    let tries = 0;
    while (target - total > enrichUntil && tries++ < 400000) {
      let roll = c.rng.next() * pool;
      let id = ENRICH[0][0];
      for (const [eid, w] of ENRICH) {
        roll -= w;
        if (roll <= 0) {
          id = eid;
          break;
        }
      }
      if (pointsOf(id) > target - total - enrichUntil) continue;
      const q = spotFor(c, id);
      if (q && tryPut(c, id, q.x, q.z, q.rot, 2)) total += pointsOf(id);
    }
  }

  // spots for top-up items: 30 % around the start, otherwise on ground the item may spawn on
  const pick = (id: string): Spot | null =>
    c.rng.chance(0.3)
      ? {
          x: start.x + c.rng.range(-20, 20),
          z: start.z + c.rng.range(-20, 20),
          rot: c.rng.range(0, 6.28),
        }
      : spotFor(c, id);
  const totalWeight = FILL.reduce((a, [, w]) => a + w, 0);
  let guard = 0;
  while (total < target && guard++ < 200000) {
    const left = target - total;
    let roll = c.rng.next() * totalWeight;
    let id = FILL[0][0];
    for (const [fid, w] of FILL) {
      roll -= w;
      if (roll <= 0) {
        id = fid;
        break;
      }
    }
    if (pointsOf(id) > left) id = 'grass_tuft';
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const q = pick(id);
      placed = !!q && tryPut(c, id, q.x, q.z, q.rot, c.p.beachWidth + 2);
    }
    if (!placed) {
      // crowded: drop a 1-point tuft on a lot or park (overlap allowed) rather than miss the target
      const q = spotIn(
        c,
        c.lists.parks.length && c.rng.chance(0.5) ? 'park' : 'lot',
      );
      if (q) {
        put(c, 'grass_tuft', q.x, q.z, q.rot, { occ: false });
        placed = true;
        id = 'grass_tuft';
      }
    }
    if (placed) total += pointsOf(id);
  }
}

/** Every item type up to size tier 20 shows up at least once, whatever the random layout did. */
function ensureAllTypes(c: Ctx): void {
  const have = new Set(c.placements.map((p) => p.item));
  for (const it of ITEMS) {
    if (have.has(it.id) || it.tier > 20) continue;
    for (let attempt = 0; attempt < 600; attempt++) {
      const q = spotFor(c, it.id);
      if (q && tryPut(c, it.id, q.x, q.z, q.rot, 4)) break;
    }
  }
}
