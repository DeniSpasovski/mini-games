import { Vector3 } from 'three';
import { Noise2D } from '../../../shared/noise';
import { hash3, hashString, Rng } from '../../../shared/rng';
import { getAssetMeta } from '../assets/catalog';
import type { RoadsideRule, ScatterRule } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import { newLakeQuery, type Lakes } from './lakes';
import { newPathQuery, type Landcover, type PathNetwork } from './real-data';
import { newRoadQuery, type Road } from './road';

/** Real-world map data the scatter respects (land cover classes, other roads, canals). */
export interface ScatterContext {
  landcover?: Landcover;
  paths?: PathNetwork;
  channels?: PathNetwork;
  lakes?: Lakes;
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
  /** Optional per-axis scale on top of `scale` (buildings: footprint width / height / depth). */
  sx?: number;
  sy?: number;
  sz?: number;
}

export interface ScatterChunk {
  instances: ScatterInstance[];
  colliders: StaticCollider[];
  /** Instances of breakable assets (catalog `breakable`), knocked over by the car (breakables.ts). */
  breakables: ScatterInstance[];
}

export class ScatterField {
  private chunks = new Map<number, ScatterChunk>();
  private details = new Map<number, ScatterInstance[]>();
  private fixed = new Map<number, ScatterInstance[]>();
  /** Colliders of things that are drawn elsewhere (mesh buildings), registered in every chunk they overlap. */
  private fixedColliders = new Map<number, StaticCollider[]>();
  private maskNoise: Noise2D;
  private rules: ScatterRule[];
  private detailRules: ScatterRule[];
  private q = newRoadQuery();
  private pq = newPathQuery();
  private n = new Vector3();
  /** Per rule: zone -> allowed (rules with `cover`). */
  private coverMasks = new Map<ScatterRule, Uint8Array>();

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
    this.detailRules = scatter.filter((r) => r.detail);
    if (ctx.landcover)
      for (const r of scatter)
        if (r.cover) this.coverMasks.set(r, ctx.landcover.zoneMask(r.cover));
  }

  get chunkSize(): number {
    return this.hf.chunkSize;
  }

  /** Add a hand-placed / road-side instance (call before streaming starts). */
  addFixed(inst: ScatterInstance): void {
    const cs = this.chunkSize;
    const k = key(Math.floor(inst.x / cs), Math.floor(inst.z / cs));
    let list = this.fixed.get(k);
    if (!list) this.fixed.set(k, (list = []));
    list.push(inst);
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
        breakables: instances.filter((i) => getAssetMeta(i.asset).breakable),
      };
      this.chunks.set(k, c);
    }
    return c;
  }

  detail(cx: number, cz: number): ScatterInstance[] {
    const k = key(cx, cz);
    let d = this.details.get(k);
    if (!d) {
      d = this.generate(cx, cz, this.detailRules, 1000);
      this.details.set(k, d);
    }
    return d;
  }

  /** Drop detail data far from (x,z) to bound memory on large maps. */
  pruneDetail(x: number, z: number, radius: number): void {
    const cs = this.chunkSize;
    for (const k of this.details.keys()) {
      const cx = Math.floor(k / 65536) - 32768;
      const cz = (k % 65536) - 32768;
      if (Math.hypot((cx + 0.5) * cs - x, (cz + 0.5) * cs - z) > radius)
        this.details.delete(k);
    }
  }

  private generate(
    cx: number,
    cz: number,
    rules: ScatterRule[],
    salt: number,
  ): ScatterInstance[] {
    // Detail (salt 1000) is only generated near the camera -> use the cached heightfield.
    const ground = salt === 1000 ? this.near : this.hf;
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
      const meta = getAssetMeta(rule.asset);
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
      const solid = !!meta.colliders;
      // Grass / plants never grow on other roads either (only up to their edge).
      const minPath = rule.minPathDist ?? (solid ? 1.5 : 0.4);
      for (let i = 0; i < count; i++) {
        const x = pts ? pts[i * 2] : x0 + rng.next() * cs;
        const z = pts ? pts[i * 2 + 1] : z0 + rng.next() * cs;
        if (coverMask && lc) {
          const zone = lc.zoneAt(x, z);
          if (zone < 0 || !coverMask[zone]) continue;
        }
        const variant = Math.floor(rng.next() * meta.variants);
        const scale = rng.range(rule.scale[0], rule.scale[1]);
        const rotY = rng.next() * Math.PI * 2;
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
        let tiltX = Math.cos(tiltA) * tiltM;
        let tiltZ = Math.sin(tiltA) * tiltM;
        if (rule.alignToGround) {
          tiltX += Math.atan2(n.z, n.y);
          tiltZ += -Math.atan2(n.x, n.y);
        }
        out.push({
          asset: rule.asset,
          variant,
          x,
          y: ground.height(x, z) - (rule.sink ?? 0) * scale,
          z,
          rotY,
          scale,
          tiltX,
          tiltZ,
        });
      }
    }
    return out;
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
      const a = lc.def.zones[zone].angle ?? 0;
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
    const meta = getAssetMeta(rule.asset);
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
          if (meta.colliders?.length && onPath(x, z)) continue;
          const heading = Math.atan2(p.tx, p.tz);
          const rotY = rule.faceRoad
            ? heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2)
            : rng.next() * Math.PI * 2;
          const sc = rule.scale ? rng.range(rule.scale[0], rule.scale[1]) : 1;
          // Chevrons: variant 0 points left, 1 points right (as seen by the driver).
          const variant =
            rule.asset === 'chevron_sign'
              ? p.curvature > 0
                ? 0
                : 1
              : Math.floor(rng.next() * meta.variants);
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
