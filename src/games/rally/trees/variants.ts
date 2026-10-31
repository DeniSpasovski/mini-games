import { derive } from './grammar';
import type { LeafStyle } from './leaftex';
import { hashText, mix32, type V3 } from './math';
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
export const GENERATOR_VERSION = 19;

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
 * Every variant's seed, rolled once and kept (trees/Placement.md#variants): a tree on a stage stays the same tree when
 * the species or the generator is tuned, and in every season (trees/seasons.ts). A new species or variant appends its
 * own (`variantSeed` gives one from the name until then); never change one.
 */
export const VARIANT_SEEDS: Readonly<Record<string, readonly number[]>> = {
  Pine: [70358897, 4269693251, 1578089916, 1076235523, 683012891, 177544273],
  'Plantation pine': [3997988242, 448287570, 1952667911, 3425810768],
  'Black pine': [30515455, 2221014150, 4294701043, 2983813763],
  Juniper: [361934921, 1368382076, 1350965330, 1622798451],
  Oak: [1932688229, 2022549835, 810071768, 492729341, 128271731, 514585895],
  Beech: [3810229138, 2546762649, 1672154091, 3124777938],
  Hornbeam: [
    2404071533, 1473670604, 3485273760, 1679923533, 389003024, 3254031550,
  ],
  Walnut: [4038579136, 3383763749, 1270247989, 3007778671],
  'Fruit tree': [3853375954, 3196243622, 548633855, 379381166],
  Plane: [2207387001, 2639677162, 497512196, 2426748478],
  Birch: [3256760060, 2197522715, 384213437, 1608311229],
  Sapling: [1146873700, 533498965, 2424633801, 3078496375],
  Poplar: [3111684880, 4112212371, 3368391776, 471519129],
  Willow: [505561106, 3328646694, 886461919, 987516325],
  Bush: [65603520, 2063287230, 2716028405, 742087121, 2371281032, 3368636538],
  Scrub: [475267810, 525001194, 697908077, 4231664369, 1936238187, 1605077440],
  Hazel: [3129011351, 3794751088, 284786258, 1545100490],
  Thicket: [521185137, 1907814690, 1125057516, 2894165268],
  Broom: [2031750893, 2294386544, 827513804, 2424757531],
  Cypress: [109503874, 25088071, 2002313316, 2425597756],
  'Hedge cypress': [4129058333, 1338393590, 743902381, 2499167811],
  Locust: [1046467012, 2549771480, 820080498, 3887742723],
  Bramble: [997559168, 2581106789, 3213389530, 2692139484],
};

/** Seed of a species' variant: its kept seed, the same in every season. */
export function variantSeed(def: SpeciesDef, index: number): number {
  const name = summerOf(def).name;
  return VARIANT_SEEDS[name]?.[index] ?? mix32(hashText(name), index + 1);
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
