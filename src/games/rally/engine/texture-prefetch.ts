import { WorkerPool } from '../../../shared/worker-pool';
import type { TextureResult } from './texture-worker';
import {
  drawableInWorker,
  isTexture,
  madeTextures,
  primeTexture,
  type TextureId,
} from './textures';

/**
 * The textures each map draws while it loads, drawn in workers while the rest of the load runs (a texture is
 * hundreds of thousands of pixels of noise: ~1 s on the main thread). A texture not listed, or not back yet, is
 * drawn by `getTexture` as before. A browser remembers what a map really used (`rememberTextures`, when its load is
 * done) and asks for exactly that next time, so nothing needs refreshing; `BY_MAP` is only the list for the first visit.
 */
const BY_MAP: Record<string, TextureId[]> = {
  ajvatovci: [
    'barrier_jersey',
    'chevron',
    'detail',
    'dirt',
    'grass',
    'grass_card_dry',
    'grass_card_spring',
    'gravel',
    'lot_ashlar',
    'lot_asphalt',
    'lot_barrier',
    'lot_brick',
    'lot_concrete',
    'lot_fence',
    'lot_glass',
    'lot_panel',
    'lot_pavers',
    'lot_render',
    'lot_roller_door',
    'lot_roof_tiles',
    'lot_roofing',
    'lot_rubble',
    'lot_sheet',
    'lot_sign_mileks',
    'lot_sign_station',
    'lot_solar',
    'macro',
    'people',
    'people_normal',
    'rail_track',
    'road_parkway',
    'road_tarmac',
    'rock',
    'vehicle_decals',
    'village_sign',
    'water_normal',
  ],
  vodno: [
    'barrier_jersey',
    'chevron',
    'crosswalk',
    'detail',
    'dirt',
    'facade_brick',
    'facade_commercial',
    'facade_concrete',
    'facade_garage',
    'facade_industrial',
    'facade_plainstone',
    'facade_stone',
    'facade_stucco',
    'grass',
    'grass_card',
    'grass_card_dry',
    'gravel',
    'lot_ashlar',
    'lot_asphalt',
    'lot_barrier',
    'lot_brick',
    'lot_concrete',
    'lot_fence',
    'lot_glass',
    'lot_panel',
    'lot_pavers',
    'lot_render',
    'lot_roller_door',
    'lot_roof_tiles',
    'lot_roofing',
    'lot_rubble',
    'lot_sheet',
    'lot_solar',
    'macro',
    'people',
    'people_normal',
    'rail_track',
    'road',
    'road_arrow_left',
    'road_arrow_straight',
    'road_city',
    'road_paint',
    'road_street',
    'road_tarmac',
    'road_tarmac_lines',
    'rock',
    'sidewalk',
    'vehicle_decals',
    'water_normal',
  ],
  petralica: [
    'barrier_jersey',
    'chevron',
    'detail',
    'dirt',
    'grass',
    'grass_card',
    'grass_card_dry',
    'gravel',
    'lot_fence',
    'macro',
    'people',
    'people_normal',
    'road',
    'road_parkway',
    'road_tarmac',
    'rock',
    'water_normal',
  ],
  galichica: [
    'barrier_jersey',
    'chevron',
    'detail',
    'dirt',
    'grass',
    'grass_card',
    'grass_card_dry',
    'gravel',
    'macro',
    'people',
    'people_normal',
    'road',
    'road_tarmac',
    'rock',
    'vehicle_decals',
    'water_normal',
  ],
  jackie: [
    'barrier_jersey',
    'chevron',
    'crosswalk',
    'detail',
    'dirt',
    'facade_brick',
    'facade_commercial',
    'facade_concrete',
    'facade_garage',
    'facade_industrial',
    'facade_plainstone',
    'facade_stone',
    'facade_stucco',
    'gore',
    'grass',
    'grass_card',
    'grass_card_spring',
    'gravel',
    'hatch',
    'junction_asphalt',
    'macro',
    'people',
    'people_normal',
    'road_city',
    'road_parkway',
    'road_street',
    'road_street4',
    'road_tarmac',
    'rock',
    'sidewalk',
    'vehicle_decals',
    'water_normal',
  ],
  test: [
    'chevron',
    'detail',
    'dirt',
    'grass',
    'grass_card',
    'gravel',
    'macro',
    'people',
    'people_normal',
    'road',
    'rock',
    'vehicle_decals',
  ],
};

const pool = new WorkerPool<TextureResult>(
  () =>
    new Worker(new URL('./texture-worker.ts', import.meta.url), {
      type: 'module',
    }),
  undefined,
  'textures',
);

const storeKey = (mapId: string) => `rally.textures.${mapId}`;

function remembered(mapId: string): TextureId[] {
  try {
    const list: unknown = JSON.parse(
      localStorage.getItem(storeKey(mapId)) ?? '[]',
    );
    return Array.isArray(list) ? (list as TextureId[]) : [];
  } catch {
    return [];
  }
}

/** Keeps the textures this map's load made, for the next visit's `prefetchTextures`. */
export function rememberTextures(mapId: string): void {
  try {
    localStorage.setItem(storeKey(mapId), JSON.stringify(madeTextures()));
  } catch {
    // No storage: the first-visit list is used.
  }
}

export function prefetchTextures(mapId: string): void {
  if (typeof OffscreenCanvas === 'undefined') return;
  // A name that is not a texture any more (renamed since it was stored) is skipped.
  const ids = new Set([...(BY_MAP[mapId] ?? []), ...remembered(mapId)]);
  for (const texture of ids)
    if (isTexture(texture) && drawableInWorker(texture))
      pool.post({ texture }, [], (r) => {
        if (r?.bitmap) primeTexture(texture, r.bitmap);
      });
}
