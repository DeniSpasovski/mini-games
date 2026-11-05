import { Vector3 } from 'three';
import { Noise2D } from '../../../shared/noise';
import { hash3, hashString, Rng } from '../../../shared/rng';
import { getAssetMeta } from '../assets/catalog';
import type {
  Country,
  MapDef,
  RealTreesDef,
  RoadsideRule,
  ScatterRule,
} from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import {
  isTreeType,
  placeTree,
  treeColliders,
  type TreePose,
} from '../trees/placement';
import { speciesOfType, variantCount } from '../trees/species';
import { mix32 } from '../trees/math';
import { variantFoliage, variantInfo } from '../trees/variants';
import type { TerrainSampler } from './heightfield';
import { newLakeQuery, type Lakes } from './lakes';
import { newPathQuery, type Landcover, type PathNetwork } from './real-data';
import { newRoadQuery, type Road, type RoadQuery } from './road';
import { fanVariant } from './fan-variants';
import { splitRuns, tapeRun } from './tape';

/** Real-world map data the scatter respects (land cover classes, other roads, canals). */
export interface ScatterContext {
  landcover?: Landcover;
  paths?: PathNetwork;
  channels?: PathNetwork;
  lakes?: Lakes;
  /** Stage id: placed trees are posed by a hash of it and their placement index (trees/placement.ts). */
  stageId?: string;
  /** `MapDef.treeSetback`: the verge the trees keep clear along the stage road. */
  treeSetback?: MapDef['treeSetback'];
  /** `MapDef.treeCrownClear`: how far a roadside tree's crown may reach over the stage road's edge. */
  treeCrownClear?: MapDef['treeCrownClear'];
  /** The crop standing at a point (rules with `crop`; world/terrain-gen.ts `cropAt`). */
  cropAt?: (x: number, z: number) => string | undefined;
  /** Direction of the field strips (rad, `landcover.fields.angle`): `rows.fields` rules run along it. */
  fieldAngle?: number;
}

/** `MapDef.treeCrownClear`: leaves lower than this above the road (m) count as low, and a tree tries this many other poses. */
const LOW_CLEAR = 4;
const REPOSE_TRIES = 8;

/** Distance from the road edge (m) the trees keep clear at `along`: the largest of the setbacks there, eased at their ends. */
export function setbackAt(
  setbacks: NonNullable<MapDef['treeSetback']>,
  along: number,
): number {
  let best = 0;
  for (const s of setbacks) {
    if (along < s.from || along > s.to) continue;
    const fade = s.fade ?? 30;
    const k = Math.min(1, (along - s.from) / fade, (s.to - along) / fade);
    best = Math.max(best, s.dist * Math.max(0, k));
  }
  return best;
}

/** A `canopy` rule's share of its density (0-1) where the real canopy covers `share` of the ground. */
export function canopyKeep(
  c: NonNullable<ScatterRule['canopy']>,
  share: number,
): number {
  if (c.open)
    return share <= c.min
      ? 1
      : Math.max(0, (c.full - share) / (c.full - c.min));
  return share < c.min ? 0 : Math.min(1, share / c.full);
}

/** A `canopy` rule's size factor where the stand is `stand` m tall (0 = no canopy there: unchanged). */
export function canopySize(
  c: NonNullable<ScatterRule['canopy']>,
  stand: number,
): number {
  return c.height && stand > 0
    ? Math.min(1.4, Math.max(0.7, stand / c.height))
    : 1;
}

/** Cell of the real trees' density grid (m): `treeRulesAt` reports them as a density per cell. */
const REAL_CELL = 48;

/** A tree type's mean height at map scale 1 (its species' mean size; variant 0), cached. */
const typeHeights = new Map<string, number>();
function typeHeight(asset: string): number {
  let h = typeHeights.get(asset);
  if (h === undefined) {
    const def = speciesOfType(asset);
    h = (variantInfo(def.name, 0).height * (def.scale[0] + def.scale[1])) / 2;
    typeHeights.set(asset, h);
  }
  return h;
}

/** Variant count / solidity of a placed asset id: a catalog asset or a tree type (trees/species.ts). */
function assetVariants(asset: string): number {
  return isTreeType(asset)
    ? variantCount(speciesOfType(asset))
    : getAssetMeta(asset).variants;
}

function assetSolid(asset: string): boolean {
  return isTreeType(asset)
    ? variantInfo(speciesOfType(asset).name, 0).capsules.length > 0
    : !!getAssetMeta(asset).colliders?.length;
}

/**
 * Deterministic placement of assets. Two sources:
 *  - per-chunk procedural scatter (trees, rocks, grass) generated lazily
 *  - road-side / hand-placed props, generated once and bucketed into chunks
 *
 * Instances only hold numbers; rendering (InstanceStreamer) maps them to
 * shared instanced meshes, physics reads their colliders.
 */
export interface ScatterInstance {
  asset: string;
  variant: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  /** Small random tilt (rad) or ground-aligned tilt. */
  tiltX: number;
  tiltZ: number;
  /** A tree type: its species and hashed pose (variant / rotY / scale are set from the same hash). */
  tree?: TreePose;
  /** Optional per-axis scale on top of `scale` (buildings: footprint width / height / depth). */
  sx?: number;
  sy?: number;
  sz?: number;
  /** Drawn only within this distance (m) of the camera (a service lot far from the start: `ServiceLot.showWithin`). */
  showWithin?: number;
  /** Detail: within its asset's `nearRoad` of a road, so drawn with the near LOD (catalog `nearRoad`). */
  near?: boolean;
  /** Detail: the extra grass near the roads (catalog `nearBoost`), thinned by the quality preset. */
  extra?: boolean;
  /**
   * The instance streamer's cached draw data (`InstanceStreamer.dataOf`). A field, not a WeakMap: a WeakMap holding
   * every streamed instance (300k+) made 30-50 ms GC pauses while driving.
   */
  streamed?: unknown;
}

export interface ScatterChunk {
  instances: ScatterInstance[];
  colliders: StaticCollider[];
  /** Instances of breakable assets (catalog `breakable`), knocked over by the car (breakables.ts). */
  breakables: ScatterInstance[];
}

/**
 * Detail assets drawn no further than this (m, last LOD) are generated per chunk only near the camera (`nearDetail`):
 * dense short-range plants (corn rows) would otherwise be built for every grass chunk out to the grass range.
 */
export const NEAR_DETAIL_MAX = 40;

/** Boosted grass (catalog `nearBoost`) is denser this close to a road edge (m). */
export const NEAR_BOOST_ROAD = 14;

/** Candidate points `ScatterField.generateSteps` tests between yields. */
const SLICE = 256;

/** Runs a generator to its end and returns its result. */
function drain<T>(g: Generator<void, T>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

const reachOf = (asset: string) => {
  const lods = getAssetMeta(asset).lods;
  return lods[lods.length - 1].maxDistance;
};

export class ScatterField {
  private chunks = new Map<number, ScatterChunk>();
  private details = new Map<number, ScatterInstance[]>();
  private nearDetails = new Map<number, ScatterInstance[]>();
  private fixed = new Map<number, ScatterInstance[]>();
  /** Colliders of things that are drawn elsewhere (mesh buildings), registered in every chunk they overlap. */
  private fixedColliders = new Map<number, StaticCollider[]>();
  private maskNoise: Noise2D;
  private rules: ScatterRule[];
  private detailRules: ScatterRule[];
  private nearRules: ScatterRule[];
  private q = newRoadQuery();
  private pq = newPathQuery();
  private n = new Vector3();
  /** Per rule: zone -> allowed (rules with `cover`). */
  private coverMasks = new Map<ScatterRule, Uint8Array>();
  /** The extra rules of boosted grass (catalog `nearBoost`). */
  private extraRules = new WeakSet<ScatterRule>();
  /** Placement index of the next hand-placed / road-side tree. */
  private fixedTrees = 0;
  /** The real trees (`addRealTrees`) per REAL_CELL cell: asset -> [count, scale sum]. */
  private realCells = new Map<number, Map<string, [number, number]>>();

  constructor(
    private hf: TerrainSampler,
    private road: Road,
    private seed: number,
    scatter: ScatterRule[],
    private inBounds: (x: number, z: number) => boolean,
    private excluded: (x: number, z: number) => boolean,
    /** Sampler for the dense detail layer (near the camera): the cached heightfield. */
    private near: TerrainSampler = hf,
    private ctx: ScatterContext = {},
  ) {
    this.maskNoise = new Noise2D(seed + 7);
    this.rules = scatter.filter((r) => !r.detail);
    // Grass with a `nearBoost` is placed that much denser within NEAR_BOOST_ROAD of the roads (fixed, so nothing
    // thins or fills in as the car drives on); the streamer keeps the quality preset's share of the extra.
    const detail = scatter
      .filter((r) => r.detail)
      .flatMap((r) => {
        const boost = getAssetMeta(r.asset).nearBoost ?? 1;
        if (boost === 1) return [r];
        const extra = {
          ...r,
          density: r.density * (boost - 1),
          maxRoadDist: Math.min(r.maxRoadDist ?? Infinity, NEAR_BOOST_ROAD),
        };
        this.extraRules.add(extra);
        return [r, extra];
      });
    this.detailRules = detail.filter((r) => reachOf(r.asset) > NEAR_DETAIL_MAX);
    this.nearRules = detail.filter((r) => reachOf(r.asset) <= NEAR_DETAIL_MAX);
    if (ctx.landcover)
      for (const r of [...scatter, ...detail])
        if (r.cover) this.coverMasks.set(r, ctx.landcover.zoneMask(r.cover));
  }

  get chunkSize(): number {
    return this.hf.chunkSize;
  }

  /** Add a hand-placed / road-side instance (call before streaming starts). */
  addFixed(inst: ScatterInstance): void {
    if (isTreeType(inst.asset))
      this.poseTree(inst, 0x40000000 + this.fixedTrees++);
    const cs = this.chunkSize;
    const k = key(Math.floor(inst.x / cs), Math.floor(inst.z / cs));
    let list = this.fixed.get(k);
    if (!list) this.fixed.set(k, (list = []));
    list.push(inst);
  }

  /**
   * The trees where they really stand (`MapDef.realTrees`): the tree type from the land cover at each, sized to its
   * height; skipped where the scatter grows nothing (bounds, buildings, landmarks, water, the road and path margins, the
   * stage's tree setback). Within `near.dist` of the road a model tree (`near.assets`) stands in for the generated one;
   * the far forest still counts the generated type. Returns how many were placed.
   */
  addRealTrees(def: RealTreesDef): number {
    const lc = this.ctx.landcover;
    const t = def.trees;
    const minPath = def.minPathDist ?? 1.5;
    const tiltM = ((def.tilt ?? 0) * Math.PI) / 180;
    let placed = 0;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const h = hash3(i, 0x7ea1, 0, this.seed);
      const u = (k: number) => hash3(h, k, 0, 0x7ea1) / 4294967296;
      // The CHM's 1 m pixel: anywhere in it.
      const x = t[i] + u(1) - 0.5;
      const z = t[i + 1] + u(2) - 0.5;
      const cover = lc?.coverAt(x, z);
      const list = cover === undefined ? undefined : def.assets[cover];
      if (!list?.length) continue;
      if (!this.inBounds(x, z) || this.excluded(x, z)) continue;
      const asset = list[Math.floor(u(3) * list.length)];
      const q = this.road.query(x, z, this.q);
      const rd = q.found ? q.distance - q.halfWidth : Infinity;
      if (rd < def.minRoadDist) continue;
      if (
        this.ctx.treeSetback &&
        q.found &&
        assetSolid(asset) &&
        rd < setbackAt(this.ctx.treeSetback, q.along)
      )
        continue;
      if (this.nearPath(x, z, minPath)) continue;
      const tiltA = u(4) * Math.PI * 2;
      // Close to the road a model tree may stand in for the generated one (`near`): the model whose own height is
      // nearest the tree's (a young pine is a young pine's model, not a shrunk old one), turned by the hash.
      const near = def.near;
      const heroes =
        near && rd < near.dist && cover !== undefined
          ? near.assets[cover]
          : undefined;
      const hero = heroes?.[Math.floor(u(5) * heroes.length)];
      const heights = hero === undefined ? undefined : near!.heights[hero];
      if (hero !== undefined && heights?.length) {
        const want = t[i + 2] * (near!.gain ?? 1);
        let variant = 0;
        for (let v = 1; v < heights.length; v++)
          if (
            Math.abs(Math.log(want / heights[v])) <
            Math.abs(Math.log(want / heights[variant]))
          )
            variant = v;
        const scale = Math.min(1.4, Math.max(0.5, want / heights[variant]));
        this.addFixed({
          asset: hero,
          variant,
          x,
          y: this.hf.height(x, z) - (def.sink ?? 0) * scale,
          z,
          rotY: u(6) * Math.PI * 2,
          scale,
          tiltX: Math.cos(tiltA) * tiltM,
          tiltZ: Math.sin(tiltA) * tiltM,
        });
      }
      const scale = Math.min(
        def.scale[1],
        Math.max(def.scale[0], t[i + 2] / typeHeight(asset)),
      );
      const inst: ScatterInstance = {
        asset,
        variant: 0,
        x,
        y: this.hf.height(x, z) - (def.sink ?? 0) * scale,
        z,
        rotY: 0,
        scale,
        tiltX: Math.cos(tiltA) * tiltM,
        tiltZ: Math.sin(tiltA) * tiltM,
      };
      if (!heights?.length) this.addFixed(inst);
      const k = key(Math.floor(x / REAL_CELL), Math.floor(z / REAL_CELL));
      let cell = this.realCells.get(k);
      if (!cell) this.realCells.set(k, (cell = new Map()));
      const e = cell.get(asset);
      if (e) {
        e[0]++;
        e[1] += inst.scale;
      } else cell.set(asset, [1, inst.scale]);
      placed++;
    }
    return placed;
  }

  /** Every hand-placed / road-side instance (tests, tools). */
  *fixedInstances(): Generator<ScatterInstance> {
    for (const list of this.fixed.values()) yield* list;
  }

  /** A collider without an instance (the thing is drawn by its own mesh): listed in every chunk it overlaps. */
  addFixedCollider(c: StaticCollider): void {
    const cs = this.chunkSize;
    for (
      let cz = Math.floor((c.z - c.r) / cs);
      cz <= Math.floor((c.z + c.r) / cs);
      cz++
    )
      for (
        let cx = Math.floor((c.x - c.r) / cs);
        cx <= Math.floor((c.x + c.r) / cs);
        cx++
      ) {
        const k = key(cx, cz);
        let list = this.fixedColliders.get(k);
        if (!list) this.fixedColliders.set(k, (list = []));
        list.push(c);
      }
  }

  /**
   * The tree rules that can grow a tree at (x, z), with their density (per m^2) and mean scale: the far forest's
   * estimate where no chunk is generated (world/far-forest.ts). Land cover, noise mask and bounds only - the per-tree
   * tests (roads, paths, slope) matter near the road, never at a mountain kilometres away. Roadside and orchard rules
   * are left out.
   */
  treeRulesAt(
    x: number,
    z: number,
    visit: (asset: string, perM2: number, scale: number) => void,
  ): void {
    if (!this.inBounds(x, z) || this.excluded(x, z)) return;
    const lc = this.ctx.landcover;
    const zone = lc ? lc.zoneAt(x, z) : -1;
    const real = this.realCells.get(
      key(Math.floor(x / REAL_CELL), Math.floor(z / REAL_CELL)),
    );
    if (real)
      for (const [asset, [n, sum]] of real)
        visit(asset, n / (REAL_CELL * REAL_CELL), sum / n);
    for (let ri = 0; ri < this.rules.length; ri++) {
      const rule = this.rules[ri];
      if (!isTreeType(rule.asset) || rule.rows || rule.density <= 0) continue;
      if (rule.maxRoadDist !== undefined) continue;
      const cover = this.coverMasks.get(rule);
      if (cover && lc && (zone < 0 || !cover[zone])) continue;
      if (rule.mask) {
        const m = this.maskNoise.fbm(
          x / rule.mask.scale + ri * 3.1,
          z / rule.mask.scale,
          3,
        );
        if (
          rule.mask.invert ? m > rule.mask.threshold : m < rule.mask.threshold
        )
          continue;
      }
      let keep = 1;
      let size = 1;
      if (rule.canopy && lc?.canopy) {
        keep = canopyKeep(rule.canopy, lc.canopy.cover.at(x, z));
        if (keep <= 0) continue;
        size = canopySize(rule.canopy, lc.canopy.height.at(x, z));
      }
      visit(
        rule.asset,
        (rule.density / 1000) * keep,
        ((rule.scale[0] + rule.scale[1]) / 2) * size,
      );
    }
  }

  /** A chunk only if it was generated already (never generates: for background jobs that must not hitch). */
  cachedChunk(cx: number, cz: number): ScatterChunk | undefined {
    return this.chunks.get(key(cx, cz));
  }

  chunk(cx: number, cz: number): ScatterChunk {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      const instances = this.generate(cx, cz, this.rules, 0);
      instances.push(...(this.fixed.get(k) ?? []));
      c = {
        instances,
        colliders: [
          ...instances.flatMap(collidersOf),
          ...(this.fixedColliders.get(k) ?? []),
        ],
        breakables: instances.filter(
          (i) => !i.tree && getAssetMeta(i.asset).breakable,
        ),
      };
      this.chunks.set(k, c);
    }
    return c;
  }

  detail(cx: number, cz: number): ScatterInstance[] {
    return drain(this.detailSteps(cx, cz));
  }

  /** The short-range detail rules' instances (`NEAR_DETAIL_MAX`); only asked for near the camera. */
  nearDetail(cx: number, cz: number): ScatterInstance[] {
    return drain(this.nearDetailSteps(cx, cz));
  }

  /**
   * `detail` a slice at a time (the streamer's time-sliced job: one dense grass chunk took up to ~30 ms); yields
   * only while the chunk is not generated yet, the result is the same.
   */
  *detailSteps(cx: number, cz: number): Generator<void, ScatterInstance[]> {
    const k = key(cx, cz);
    let d = this.details.get(k);
    if (!d) {
      const made = yield* this.generateSteps(cx, cz, this.detailRules, 1000);
      // Made meanwhile by a plain `detail` call: keep that one (callers may hold it).
      d = this.details.get(k) ?? made;
      this.details.set(k, d);
    }
    return d;
  }

  /** `nearDetail` a slice at a time (`detailSteps`). */
  *nearDetailSteps(cx: number, cz: number): Generator<void, ScatterInstance[]> {
    const k = key(cx, cz);
    let d = this.nearDetails.get(k);
    if (!d) {
      const made = this.nearRules.length
        ? yield* this.generateSteps(cx, cz, this.nearRules, 2000)
        : [];
      d = this.nearDetails.get(k) ?? made;
      this.nearDetails.set(k, d);
    }
    return d;
  }

  /** Drop generated chunks farther than `radius` from (x,z): a long stage keeps only what is near (regenerated on return). */
  pruneChunks(x: number, z: number, radius: number): void {
    const cs = this.chunkSize;
    for (const k of this.chunks.keys()) {
      const cx = Math.floor(k / 65536) - 32768;
      const cz = (k % 65536) - 32768;
      if (Math.hypot((cx + 0.5) * cs - x, (cz + 0.5) * cs - z) > radius)
        this.chunks.delete(k);
    }
  }

  /** Drop detail data far from (x,z) to bound memory on large maps (the near layer past `nearRadius`). */
  pruneDetail(x: number, z: number, radius: number, nearRadius = radius): void {
    const cs = this.chunkSize;
    for (const [map, r] of [
      [this.details, radius],
      [this.nearDetails, nearRadius],
    ] as const)
      for (const k of map.keys()) {
        const cx = Math.floor(k / 65536) - 32768;
        const cz = (k % 65536) - 32768;
        if (Math.hypot((cx + 0.5) * cs - x, (cz + 0.5) * cs - z) > r)
          map.delete(k);
      }
  }

  private generate(
    cx: number,
    cz: number,
    rules: ScatterRule[],
    salt: number,
  ): ScatterInstance[] {
    return drain(this.generateSteps(cx, cz, rules, salt));
  }

  /** `generate`, yielding every `SLICE` candidate points. */
  private *generateSteps(
    cx: number,
    cz: number,
    rules: ScatterRule[],
    salt: number,
  ): Generator<void, ScatterInstance[]> {
    // Detail (salt 1000, near detail 2000) is only generated near the camera -> use the cached heightfield.
    const ground = salt >= 1000 ? this.near : this.hf;
    const out: ScatterInstance[] = [];
    const cs = this.chunkSize;
    const area = cs * cs;
    const x0 = cx * cs;
    const z0 = cz * cs;
    if (!this.inBounds(x0 + cs / 2, z0 + cs / 2)) return out;
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri];
      const rng = new Rng(
        hash3(cx, cz, ri + salt, this.seed ^ hashString(rule.asset)),
      );
      const variants = assetVariants(rule.asset);
      const tree = isTreeType(rule.asset);
      const coverMask = this.coverMasks.get(rule);
      const lc = this.ctx.landcover;
      // Rules limited to land cover classes that don't occur in this chunk: skip early.
      if (coverMask && lc && !this.chunkHasCover(lc, coverMask, x0, z0, cs))
        continue;
      const pts = rule.rows
        ? this.rowPoints(rule, coverMask!, x0, z0, cs, rng)
        : null;
      const count = pts
        ? pts.length / 2
        : Math.round((rule.density * area) / 1000 + rng.gauss() * 0.5);
      const solid = assetSolid(rule.asset);
      // Grass / plants never grow on other roads either (only up to their edge).
      const minPath = rule.minPathDist ?? (solid ? 1.5 : 0.4);
      const nearRoad = tree ? undefined : getAssetMeta(rule.asset).nearRoad;
      const extra = this.extraRules.has(rule);
      for (let i = 0; i < count; i++) {
        if (i % SLICE === SLICE - 1) yield;
        const x = pts ? pts[i * 2] : x0 + rng.next() * cs;
        const z = pts ? pts[i * 2 + 1] : z0 + rng.next() * cs;
        if (coverMask && lc) {
          const zone = lc.zoneAt(x, z);
          if (zone < 0 || !coverMask[zone]) continue;
        }
        if (rule.crop && this.ctx.cropAt?.(x, z) !== rule.crop) continue;
        // The real canopy: thinned by its share, sized by the stand height (one look-up each).
        let size = 1;
        if (rule.canopy && lc?.canopy) {
          const keep = canopyKeep(rule.canopy, lc.canopy.cover.at(x, z));
          if (keep <= 0 || (keep < 1 && rng.next() >= keep)) continue;
          size = canopySize(rule.canopy, lc.canopy.height.at(x, z));
        }
        const variant =
          rule.asset === 'spectator'
            ? fanVariant(rng.next(), undefined)
            : Math.floor(rng.next() * variants);
        const scale = rng.range(rule.scale[0], rule.scale[1]) * size;
        // Field rows face along the strips (either way round, a little off line); `face` rows exactly along their
        // zone's rows (vineyard segments join up).
        const rotY = rule.rows?.fields
          ? -(this.ctx.fieldAngle ?? 0) +
            (rng.next() < 0.5 ? 0 : Math.PI) +
            (rng.next() - 0.5) * 0.25
          : rule.rows?.face && this.ctx.landcover
            ? -(
                this.ctx.landcover.def.zones[this.ctx.landcover.zoneAt(x, z)]
                  ?.angle ?? 0
              ) + (rng.next() < 0.5 ? 0 : Math.PI)
            : rng.next() * Math.PI * 2;
        const tiltA = rng.next() * Math.PI * 2;
        const tiltM = ((rule.tilt ?? 0) * Math.PI) / 180;
        if (rule.mask) {
          const m = this.maskNoise.fbm(
            x / rule.mask.scale + ri * 3.1,
            z / rule.mask.scale,
            3,
          );
          if (
            rule.mask.invert ? m > rule.mask.threshold : m < rule.mask.threshold
          )
            continue;
        }
        if (!this.inBounds(x, z) || this.excluded(x, z)) continue;
        const q = this.road.query(x, z, this.q);
        const rd = q.found ? q.distance - q.halfWidth : Infinity;
        if (rule.minRoadDist !== undefined && rd < rule.minRoadDist) continue;
        // (bushes are drive-through: only the solid trees stand back)
        if (
          solid &&
          tree &&
          this.ctx.treeSetback &&
          q.found &&
          rd < setbackAt(this.ctx.treeSetback, q.along)
        )
          continue;
        if (rule.maxRoadDist !== undefined && rd > rule.maxRoadDist) continue;
        if (minPath > -Infinity && this.nearPath(x, z, minPath)) continue;
        if (rule.channelDist) {
          const cq = this.ctx.channels?.query(x, z, this.pq);
          if (!cq?.found) continue;
          const e = cq.distance - cq.halfWidth;
          if (e < rule.channelDist[0] || e > rule.channelDist[1]) continue;
        }
        const n = ground.normal(x, z, this.n);
        if (rule.maxSlope !== undefined && 1 - n.y > rule.maxSlope) continue;
        if (rule.minSlope !== undefined && 1 - n.y < rule.minSlope) continue;
        let tiltX = Math.cos(tiltA) * tiltM;
        let tiltZ = Math.sin(tiltA) * tiltM;
        if (rule.alignToGround) {
          tiltX += Math.atan2(n.z, n.y);
          tiltZ += -Math.atan2(n.x, n.y);
        }
        const inst: ScatterInstance = {
          asset: rule.asset,
          variant,
          x,
          y: ground.height(x, z) - (rule.sink ?? 0) * scale,
          z,
          rotY,
          scale,
          tiltX,
          tiltZ,
        };
        if (tree) {
          const ruleScale = inst.scale;
          const index = hash3(cx, cz, ri * 65536 + i, 0x7ee5);
          this.poseTree(inst, index, true);
          // No low limbs over the road: a solid tree whose leaves hang low over the stage road takes another pose
          // (variant, rotation, size) from the same hash: the one of REPOSE_TRIES that keeps them furthest off.
          if (solid && this.ctx.treeCrownClear !== undefined && q.found) {
            const allow = this.ctx.treeCrownClear;
            let over = this.lowOverRoad(inst, q, rd);
            const tries = over > allow ? REPOSE_TRIES : 0;
            for (let k = 1; k <= tries && over > 0; k++) {
              const v = inst.variant,
                r = inst.rotY,
                sc = inst.scale,
                pose = inst.tree;
              inst.scale = ruleScale;
              this.poseTree(inst, mix32(index, k), true);
              const o = this.lowOverRoad(inst, q, rd);
              if (o < over) over = o;
              else {
                inst.variant = v;
                inst.rotY = r;
                inst.scale = sc;
                inst.tree = pose;
              }
            }
          }
        }
        if (nearRoad !== undefined && rd < nearRoad) inst.near = true;
        if (extra) inst.extra = true;
        out.push(inst);
      }
    }
    return out;
  }

  private bq = newRoadQuery();
  /**
   * How far (m) a placed tree's low leaves (under LOW_CLEAR above the road) reach past the stage road's edge: its
   * variant's leaf points posed (rotation, scale) and projected towards the road, plus the leaf sprites' reach.
   */
  private lowOverRoad(inst: ScatterInstance, q: RoadQuery, rd: number): number {
    const f = variantFoliage(inst.tree!.species, inst.variant);
    const k = inst.scale;
    if (rd > variantInfo(inst.tree!.species, inst.variant).radius * k)
      return -Infinity;
    // Towards the road: down the gradient of the distance to its centreline.
    const e = 0.5;
    const dx =
      this.road.query(inst.x + e, inst.z, this.bq).distance -
      this.road.query(inst.x - e, inst.z, this.bq).distance;
    const dz =
      this.road.query(inst.x, inst.z + e, this.bq).distance -
      this.road.query(inst.x, inst.z - e, this.bq).distance;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return -Infinity;
    const nx = -dx / len;
    const nz = -dz / len;
    const c = Math.cos(inst.rotY);
    const s = Math.sin(inst.rotY);
    const lowY = (q.height + LOW_CLEAR - inst.y) / k;
    const p = f.points;
    let best = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] > lowY) continue;
      const ox = p[i] * c + p[i + 2] * s;
      const oz = -p[i] * s + p[i + 2] * c;
      best = Math.max(best, (ox * nx + oz * nz) * k);
    }
    return best + f.margin * k - rd;
  }

  /**
   * Variant, rotation, scale (x the map's) and tint of a placed tree from the stage id and its placement index; `ladder`:
   * a scattered tree, sized on the stand's age ladder (trees/placement.ts).
   */
  private poseTree(inst: ScatterInstance, index: number, ladder = false): void {
    const t = placeTree(
      this.ctx.stageId ?? 'stage',
      index,
      inst.asset,
      inst.scale,
      ladder,
    );
    inst.variant = t.variant;
    inst.rotY = t.rotY;
    inst.scale = t.scale;
    inst.tree = t.pose;
  }

  private lq = newLakeQuery();
  private nearPath(x: number, z: number, minDist: number): boolean {
    // Lakes: nothing grows in the water (grass stops at the shore).
    if (
      this.ctx.lakes?.query(x, z, this.lq) &&
      this.lq.sd < Math.max(minDist, 0.5)
    )
      return true;
    for (const net of [this.ctx.paths, this.ctx.channels]) {
      if (!net) continue;
      const pq = net.query(x, z, this.pq);
      if (pq.found && pq.distance - pq.halfWidth < minDist) return true;
    }
    return false;
  }

  /** Any land cover cell in the chunk (sampled every cell) allowed by `mask`? */
  private chunkHasCover(
    lc: Landcover,
    mask: Uint8Array,
    x0: number,
    z0: number,
    cs: number,
  ): boolean {
    const step = lc.def.cell;
    for (let z = z0 + step / 2; z < z0 + cs; z += step)
      for (let x = x0 + step / 2; x < x0 + cs; x += step) {
        const zone = lc.zoneAt(x, z);
        if (zone >= 0 && mask[zone]) return true;
      }
    return false;
  }

  /**
   * Planted rows: for each allowed zone in the chunk, a lattice aligned to the zone's
   * row angle (anchored at the world origin so it continues across chunks).
   */
  private rowPoints(
    rule: ScatterRule,
    mask: Uint8Array,
    x0: number,
    z0: number,
    cs: number,
    rng: Rng,
  ): number[] {
    const lc = this.ctx.landcover;
    const rows = rule.rows!;
    if (!lc) return [];
    const zones = new Set<number>();
    const step = lc.def.cell;
    for (let z = z0 + step / 2; z < z0 + cs; z += step)
      for (let x = x0 + step / 2; x < x0 + cs; x += step) {
        const zone = lc.zoneAt(x, z);
        if (zone >= 0 && mask[zone]) zones.add(zone);
      }
    const out: number[] = [];
    const jit = rows.jitter ?? 0.3;
    const keep = rows.keep ?? 0.93;
    for (const zone of zones) {
      const a = rows.fields
        ? (this.ctx.fieldAngle ?? 0)
        : (lc.def.zones[zone].angle ?? 0);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Chunk corners in the (along, across) lattice frame.
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const [cx, cz] of [
        [x0, z0],
        [x0 + cs, z0],
        [x0, z0 + cs],
        [x0 + cs, z0 + cs],
      ]) {
        const u = cx * ca + cz * sa;
        const v = -cx * sa + cz * ca;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      for (
        let iv = Math.ceil(v0 / rows.rowSpacing);
        iv * rows.rowSpacing <= v1;
        iv++
      ) {
        for (
          let iu = Math.ceil(u0 / rows.spacing);
          iu * rows.spacing <= u1;
          iu++
        ) {
          const u = iu * rows.spacing + (rng.next() - 0.5) * jit;
          const v = iv * rows.rowSpacing + (rng.next() - 0.5) * jit;
          const x = u * ca - v * sa;
          const z = u * sa + v * ca;
          if (x < x0 || x >= x0 + cs || z < z0 || z >= z0 + cs) continue;
          if (rng.next() > keep || lc.zoneAt(x, z) !== zone) continue;
          out.push(x, z);
        }
      }
    }
    return out;
  }
}

/** Expand road-side rules into instances. `junctions` = where side roads join the stage road (for `skipJunctions`). */
export function roadsideInstances(
  road: Road,
  hf: TerrainSampler,
  rules: RoadsideRule[],
  seed: number,
  junctions: readonly { along: number; width: number; side: 1 | -1 }[] = [],
  paths?: PathNetwork,
  country?: Country,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const pq = newPathQuery();
  // Never on another road (the opposite carriageway beside the median, a ramp): solid props only.
  const onPath = (x: number, z: number): boolean => {
    if (!paths) return false;
    const q = paths.query(x, z, pq, 'tarmac');
    return q.found && q.distance <= q.halfWidth + 0.6;
  };
  rules.forEach((rule, ri) => {
    const rng = new Rng(hash3(ri, 0, 0, seed ^ hashString(rule.asset)));
    const variants = assetVariants(rule.asset);
    const solid = assetSolid(rule.asset);
    const positions: number[] = [];
    if (rule.at) positions.push(...rule.at);
    if (rule.every) {
      for (
        let a = rule.from ?? rule.every / 2;
        a <= (rule.to ?? road.length);
        a += rule.every
      )
        positions.push(a);
    }
    for (const along of positions) {
      const s = road.at(along);
      if (rule.maxRadius && Math.abs(s.curvature) < 1 / rule.maxRadius)
        continue;
      if (rule.minRadius && Math.abs(s.curvature) > 1 / rule.minRadius)
        continue;
      if (
        rule.onBridge !== undefined &&
        !!road.bridgeAt(along) !== rule.onBridge
      )
        continue;
      const sides: number[] =
        rule.side === 'both'
          ? [1, -1]
          : rule.side === 'left'
            ? [1]
            : rule.side === 'right'
              ? [-1]
              : rule.side === 'outside'
                ? [s.curvature > 0 ? -1 : 1]
                : [s.curvature > 0 ? 1 : -1];
      for (const side of sides) {
        if (
          rule.skipJunctions !== undefined &&
          junctions.some(
            (j) =>
              j.side === side &&
              Math.abs(j.along - along) < rule.skipJunctions! + j.width / 2,
          )
        )
          continue;
        if (rule.asset === 'tape_post') {
          // One chained run of tape, a post about every 5 m over `spread` (`count` only sets the rule's weight).
          const spread = rule.spread ?? 0;
          const posts = Math.max(2, Math.round(spread / 5) + 1);
          const slots = Array.from({ length: posts }, (_, i) => {
            const p = road.at(along + (i / (posts - 1) - 0.5) * spread);
            const lat = side * (p.halfWidth + rule.offset);
            const x = p.x + p.tz * lat;
            const z = p.z - p.tx * lat;
            return onPath(x, z) ? null : { x, z };
          });
          for (const run of splitRuns(slots))
            out.push(...tapeRun(run, (x, z) => hf.height(x, z)));
          continue;
        }
        const count = rule.count ?? 1;
        for (let i = 0; i < count; i++) {
          const da =
            count > 1 ? (i / (count - 1) - 0.5) * (rule.spread ?? 0) : 0;
          const p = road.at(along + da);
          const lat =
            side * (p.halfWidth + rule.offset + rng.next() * (rule.depth ?? 0));
          // left = (tz, -tx)
          const x = p.x + p.tz * lat;
          const z = p.z - p.tx * lat;
          if (solid && onPath(x, z)) continue;
          const heading = Math.atan2(p.tx, p.tz);
          const rotY = rule.faceRoad
            ? heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2)
            : rule.alongRoad
              ? heading + (side > 0 ? 0 : Math.PI)
              : rng.next() * Math.PI * 2;
          const sc = rule.scale ? rng.range(rule.scale[0], rule.scale[1]) : 1;
          // Chevrons: variant 0 points left, 1 points right (as seen by the driver).
          const variant =
            rule.asset === 'chevron_sign'
              ? p.curvature > 0
                ? 0
                : 1
              : rule.asset === 'spectator'
                ? fanVariant(rng.next(), country)
                : Math.floor(rng.next() * variants);
          out.push({
            asset: rule.asset,
            variant,
            x,
            y: hf.height(x, z),
            z,
            rotY,
            scale: sc,
            tiltX: 0,
            tiltZ: 0,
          });
        }
      }
    }
  });
  return out;
}

/** World-space colliders for an instance from its asset's collider spec. */
export function collidersOf(inst: ScatterInstance): StaticCollider[] {
  if (inst.tree) return treeColliders(inst);
  const meta = getAssetMeta(inst.asset);
  if (!meta.colliders) return [];
  const c = Math.cos(inst.rotY);
  const s = Math.sin(inst.rotY);
  const sx = inst.scale * (inst.sx ?? 1);
  const sy = inst.scale * (inst.sy ?? 1);
  const sz = inst.scale * (inst.sz ?? 1);
  return meta.colliders.map((col) => {
    const lx = (col.x ?? 0) * sx;
    const lz = (col.z ?? 0) * sz;
    const c0: StaticCollider = {
      kind: col.kind,
      // rotate (lx, lz) by rotY about +Y
      x: inst.x + lx * c + lz * s,
      z: inst.z - lx * s + lz * c,
      y: inst.y + (col.y ?? 0) * sy,
      r: col.r * inst.scale,
      h: (col.h ?? 0) * sy,
    };
    if (col.kind === 'box') {
      c0.hx = (col.hx ?? 0.5) * sx;
      c0.hz = (col.hz ?? 0.5) * sz;
      c0.rot = inst.rotY;
      c0.r = Math.hypot(c0.hx, c0.hz);
    }
    return c0;
  });
}

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
