import type { BufferGeometry, Material } from 'three';

/** One draw call of an asset: geometry + a SHARED material from engine/materials. */
export interface AssetPart {
  geometry: BufferGeometry;
  material: Material;
}

export interface BuiltAsset {
  parts: AssetPart[];
}

export interface BuildContext {
  /** Seed for shape randomness. In-world: derived from (asset id, variant). */
  seed: number;
  /** Variant index (some assets use it for meaning, e.g. chevron direction). */
  variant: number;
  /** LOD index into the catalog's `lods` array (0 = most detailed). */
  lod: number;
  /** Extra input of a builder that is made for one place (the crew of a car: builders/crew.ts). */
  params?: unknown;
}

export type AssetBuilder = (ctx: BuildContext) => BuiltAsset;
