import { hash3, hashString } from '../../../shared/rng';
import {
  chevronSign,
  hayBale,
  markerPost,
  roadBarrier,
  spectator,
  streetLamp,
  tapePost,
  villageSign,
} from './builders/props';
import { buildingFlat, housePitched } from './builders/buildings';
import { rockBoulder, rockSmall } from './builders/rocks';
import {
  ambulance,
  fireTruck,
  policeCar,
  streetCar,
  taxi,
} from './builders/vehicles';
import { powerPole, powerPylon } from './builders/power';
import {
  concreteBlock,
  crashCushion,
  guardRail,
  jerseyBarrier,
} from './builders/structures';
import {
  birchTree,
  blackPine,
  bush,
  dryGrass,
  fruitTree,
  grassTuft,
  juniper,
  oakTree,
  pineTree,
  poplarTree,
  reeds,
  scrubBush,
  springGrass,
  tallWeeds,
  walnutTree,
  willowTree,
} from './builders/vegetation';
import { getAssetMeta } from './catalog';
import type { AssetBuilder, BuiltAsset } from './types';

/** id -> geometry builder. Metadata (LODs, colliders, variants) lives in catalog.ts. */
export const BUILDERS: Record<string, AssetBuilder> = {
  pine_tree: pineTree,
  birch_tree: birchTree,
  bush,
  grass_tuft: grassTuft,
  scrub_bush: scrubBush,
  fruit_tree: fruitTree,
  oak_tree: oakTree,
  poplar_tree: poplarTree,
  dry_grass: dryGrass,
  spring_grass: springGrass,
  street_lamp: streetLamp,
  rock_boulder: rockBoulder,
  rock_small: rockSmall,
  hay_bale: hayBale,
  spectator,
  tape_post: tapePost,
  road_barrier: roadBarrier,
  marker_post: markerPost,
  chevron_sign: chevronSign,
  house_pitched: housePitched,
  building_flat: buildingFlat,
  concrete_block: concreteBlock,
  jersey_barrier: jerseyBarrier,
  guard_rail: guardRail,
  crash_cushion: crashCushion,
  street_car: streetCar,
  taxi,
  police_car: policeCar,
  fire_truck: fireTruck,
  ambulance,
  black_pine: blackPine,
  juniper,
  walnut_tree: walnutTree,
  willow_tree: willowTree,
  reeds,
  tall_weeds: tallWeeds,
  power_pylon: powerPylon,
  power_pole: powerPole,
  village_sign: villageSign,
};

/** Seed used for an in-world variant (stable across sessions). */
export function variantSeed(id: string, variant: number): number {
  return hash3(variant, 17, 0, hashString(id));
}

const cache = new Map<string, BuiltAsset>();

/**
 * Shared, cached asset geometry. Every instance of (id, variant, lod) in the
 * world references the same BuiltAsset - never clone these per instance.
 */
export function getAsset(id: string, variant: number, lod: number): BuiltAsset {
  const key = `${id}:${variant}:${lod}`;
  let a = cache.get(key);
  if (!a) {
    a = buildAsset(id, variantSeed(id, variant), variant, lod);
    cache.set(key, a);
  }
  return a;
}

/** Uncached build with an explicit seed (asset debugger). Caller disposes geometry. */
export function buildAsset(
  id: string,
  seed: number,
  variant: number,
  lod: number,
): BuiltAsset {
  const b = BUILDERS[id];
  if (!b)
    throw new Error(
      `No builder for asset "${id}" (assets/library.ts BUILDERS)`,
    );
  const meta = getAssetMeta(id);
  return b({ seed, variant, lod: Math.min(lod, meta.lods.length - 1) });
}

export function cachedAssetCount(): number {
  return cache.size;
}
