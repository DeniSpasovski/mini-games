import { BufferAttribute, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash3, hashString } from '../../../shared/rng';
import { variantMaterial } from '../engine/materials';
import {
  chevronSign,
  fanFlag,
  hayBale,
  markerPost,
  roadBarrier,
  spectator,
  streetLamp,
  trafficSignal,
  wallLamp,
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
import { catenaryMast, powerPole, powerPylon } from './builders/power';
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
  hazelnutTree,
  paleTree,
  youngTree,
  thicketShrub,
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
import { impostorOf } from './impostor';
import type { AssetBuilder, BuiltAsset } from './types';

/** id -> geometry builder. Metadata (LODs, colliders, variants) lives in catalog.ts. */
export const BUILDERS: Record<string, AssetBuilder> = {
  pine_tree: pineTree,
  birch_tree: birchTree,
  bush,
  grass_tuft: grassTuft,
  scrub_bush: scrubBush,
  fruit_tree: fruitTree,
  hazelnut_tree: hazelnutTree,
  pale_tree: paleTree,
  young_tree: youngTree,
  thicket_shrub: thicketShrub,
  oak_tree: oakTree,
  poplar_tree: poplarTree,
  dry_grass: dryGrass,
  spring_grass: springGrass,
  street_lamp: streetLamp,
  traffic_signal: trafficSignal,
  wall_lamp: wallLamp,
  rock_boulder: rockBoulder,
  rock_small: rockSmall,
  hay_bale: hayBale,
  spectator,
  tape_post: tapePost,
  fan_flag: fanFlag,
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
  catenary_mast: catenaryMast,
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
  const spec = getAssetMeta(id).lods[lod];
  if (spec?.oneVariant) variant = 0;
  const key = `${id}:${variant}:${lod}`;
  let a = cache.get(key);
  if (!a) {
    a = spec?.impostor
      ? impostorOf(getAsset(id, variant, lod - 1))
      : buildAsset(id, variantSeed(id, variant), variant, lod);
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

/**
 * Every variant of (id, lod) merged per material into one geometry, each vertex tagged with `variantId`
 * (engine/materials.ts `variantMaterial`): the streamer draws all variants of an asset with ONE InstancedMesh per
 * material. null when not worth it or not possible: one variant / `oneVariant` / impostor LODs, more than
 * VARIANT_SET_TRIS (vegetation: VEGETATION_SET_TRIS) triangles in all (every instance runs the vertex shader over all
 * of them), or parts whose
 * attributes differ (cannot be merged).
 */
export function getVariantSet(id: string, lod: number): BuiltAsset | null {
  const key = `${id}:${lod}`;
  if (variantSets.has(key)) return variantSets.get(key)!;
  const meta = getAssetMeta(id);
  const spec = meta.lods[lod];
  let set: BuiltAsset | null = null;
  if (VARIANT_SETS && meta.variants > 1 && !spec.oneVariant && !spec.impostor) {
    const groups = new Map<Material, BufferGeometry[]>();
    let tris = 0;
    for (let v = 0; v < meta.variants; v++)
      for (const part of getAsset(id, v, lod).parts) {
        const g = part.geometry.index
          ? part.geometry.toNonIndexed()
          : part.geometry.clone();
        const n = g.getAttribute('position').count;
        tris += n / 3;
        g.setAttribute(
          'variantId',
          new BufferAttribute(new Float32Array(n).fill(v), 1),
        );
        let list = groups.get(part.material);
        if (!list) groups.set(part.material, (list = []));
        list.push(g);
      }
    const sameAttributes = [...groups.values()].every((list) => {
      const names = (g: BufferGeometry) =>
        Object.keys(g.attributes).sort().join();
      return list.every((g) => names(g) === names(list[0]));
    });
    const cap =
      meta.category === 'vegetation' ? VEGETATION_SET_TRIS : VARIANT_SET_TRIS;
    if (tris <= cap && sameAttributes) {
      set = {
        parts: [...groups].map(([material, list]) => {
          const geometry = mergeGeometries(list, false)!;
          geometry.computeBoundingSphere();
          return { geometry, material: variantMaterial(material) };
        }),
      };
    }
    for (const list of groups.values()) for (const g of list) g.dispose();
  }
  variantSets.set(key, set);
  return set;
}

/**
 * Triangle cap of a variant set (all variants together). Vegetation is lower: a forest has 100+ near trees, and a
 * 4-variant oak crown would quadruple their vertex work (both passes) - those stay one mesh per variant.
 */
const VARIANT_SET_TRIS = 16000;
const VEGETATION_SET_TRIS = 1200;
/** `?variantsets=0` turns them off (A/B comparisons, debugging a variant); `setVariantSets` switches at runtime. */
let VARIANT_SETS =
  typeof location === 'undefined' ||
  new URLSearchParams(location.search).get('variantsets') !== '0';
const variantSets = new Map<string, BuiltAsset | null>();

/** Turn variant sets on / off (dev A/B: `InstanceStreamer.reset()` afterwards rebuilds the buckets). */
export function setVariantSets(on: boolean): void {
  VARIANT_SETS = on;
  variantSets.clear();
}
// Dev: `__setVariantSets(false); __rally.streamer.reset(__rally.camera.position)` from the console.
(globalThis as { __setVariantSets?: typeof setVariantSets }).__setVariantSets =
  setVariantSets;
