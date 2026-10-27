import { derive } from './grammar';
import type { LeafStyle } from './leaftex';
import { mix32, type V3 } from './math';
import { buildMeshes, type Crown, type VariantMeshes } from './mesh';
import { buildSkeleton, type Skeleton } from './skeleton';
import { summerOf } from './seasons';
import {
  getSpecies,
  speciesHash,
  variantCount,
  type SpeciesDef,
} from './species';

/**
 * A species' variant pool (spec: trees/Placement.md#variants): each variant grows from its own seed through
 * grammar -> skeleton -> meshing. `generateVariant` is pure (the worker runs it, tests and tools call it directly);
 * the registry holds the summaries placement and drawing read, filled when a stage loads (trees/load.ts).
 */

/**
 * Bump when generated output changes for the same species and seed, or the leaf atlases change (trees/leaftex.ts,
 * `coverageMips`): cached variants and atlases regenerate.
 */
export const GENERATOR_VERSION = 12;

export interface TreeVariantInfo {
  species: string;
  index: number;
  seed: number;
  /** Cache key: species hash, variant seed, generator version. */
  key: string;
  height: number;
  radius: number;
  sphere: { cy: number; r: number };
  crown: Crown;
  foliageColor: V3;
  /** Collision capsules (object space), 7 floats each: ax ay az bx by bz radius. */
  capsules: Float32Array;
}

export interface GeneratedVariant {
  info: TreeVariantInfo;
  meshes: VariantMeshes;
}

/**
 * Seed of a species' variant: from the species content hash, so any change to the species gives new variants. A
 * season's species hashes as its summer one, so every season grows the same trees (trees/seasons.ts).
 */
export function variantSeed(def: SpeciesDef, index: number): number {
  return mix32(speciesHash(summerOf(def)), index + 1);
}

export function cacheKey(def: SpeciesDef, seed: number): string {
  return `${def.name}:${speciesHash(def).toString(16)}:${seed.toString(16)}:v${GENERATOR_VERSION}`;
}

/** The disk cache key of a leaf style's atlas + mips (trees/worker.ts). */
export function atlasCacheKey(style: LeafStyle): string {
  return `atlas:${style}:v${GENERATOR_VERSION}`;
}

/** Trunk and first-order limb segments at least `collisionRadius` thick, as capsules (trees/Placement.md#collision). */
export function skeletonCapsules(sk: Skeleton, def: SpeciesDef): Float32Array {
  const out: number[] = [];
  for (const s of sk.segments) {
    if (s.order > 1 || s.r0 < def.collisionRadius) continue;
    out.push(...s.start, ...s.end, s.r0);
  }
  return new Float32Array(out);
}

export function generateVariant(
  def: SpeciesDef,
  index: number,
): GeneratedVariant {
  const seed = variantSeed(def, index);
  const sk = buildSkeleton(derive(def, seed), def);
  const meshes = buildMeshes(sk, def, seed);
  return {
    info: {
      species: def.name,
      index,
      seed,
      key: cacheKey(def, seed),
      height: meshes.height,
      radius: meshes.radius,
      sphere: meshes.sphere,
      crown: meshes.crown,
      foliageColor: meshes.foliageColor,
      capsules: skeletonCapsules(sk, def),
    },
    meshes,
  };
}

const registry = new Map<string, TreeVariantInfo>();

export function registerVariant(info: TreeVariantInfo): void {
  registry.set(`${info.species}#${info.index}`, info);
}

/**
 * A variant's summary: registered at stage load; generated on the spot where nothing loaded them (node tests,
 * tools), which is the same deterministic result.
 */
export function variantInfo(species: string, index: number): TreeVariantInfo {
  const key = `${species}#${index}`;
  let info = registry.get(key);
  if (!info) {
    info = generateVariant(getSpecies(species), index).info;
    registry.set(key, info);
  }
  return info;
}

export function variantsOf(def: SpeciesDef): number[] {
  return [...Array(variantCount(def)).keys()];
}
