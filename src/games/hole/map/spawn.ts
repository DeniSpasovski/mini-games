import { getItem } from '../items/catalog';
import {
  coastRadius,
  type BlockInfo,
  type DistrictId,
  type GroundRect,
} from './types';

/**
 * City Island spawn rules: which kind of ground each item may stand on. Pure data + geometry
 * (no three.js, no DOM), shared by the generator (`map/generate.ts`) and the tests.
 *
 *   road      asphalt: the 10 m strips between blocks (incl. crossings and zebras)
 *   sidewalk  the 3 m ring around a block, outside the lot
 *   lot       inside a block (buildings, yards, plazas), without parks
 *   park      inside a park block
 *   beach     the sand band along the coast (also the harbour quay)
 *   lawn      everything else on the island (edge blocks, grass between)
 *   water     the canal strip (a flat rect at `CANAL_Y`): boats only
 *
 * Rule: **only vehicles may touch a road** (items whose row lists `road`). Every other item
 * must keep its whole footprint off the asphalt. Each item lists the zones its centre may be in.
 */
export type SpawnZone =
  'road' | 'sidewalk' | 'lot' | 'park' | 'beach' | 'lawn' | 'water';

export const ROAD_HALF = 5;
/** Half size of a block cell (the sidewalk rect) and of its lot (m). */
export const BLOCK_HALF = 20;
export const LOT_HALF = 17;
/** y of the asphalt rects in `MapData.rects` (see buildRoads). */
export const ROAD_Y = 0.016;
/** y of the canal water rects (below the asphalt: the crossings are the bridges). */
export const CANAL_Y = 0.01;

const NOT_ROAD: readonly SpawnZone[] = [
  'sidewalk',
  'lot',
  'park',
  'beach',
  'lawn',
];
const GROUND_PLANTS: readonly SpawnZone[] = ['lot', 'park', 'lawn'];
const CAR: readonly SpawnZone[] = ['road', 'lot'];

/** Allowed spawn zones of every City Island item. A catalog test makes sure none is missing. */
export const SPAWN: Record<string, readonly SpawnZone[]> = {
  // litter: anywhere dry
  soda_can: NOT_ROAD,
  litter_paper: NOT_ROAD,
  trash_bag: ['sidewalk', 'lot', 'park'],
  // street furniture: the sidewalk ring
  lamp_post: ['sidewalk'],
  fire_hydrant: ['sidewalk'],
  parking_meter: ['sidewalk'],
  newspaper_box: ['sidewalk'],
  street_sign: ['sidewalk'],
  traffic_light: ['sidewalk'],
  traffic_cone: ['sidewalk', 'lot'],
  bus_stop: ['sidewalk'],
  billboard: ['sidewalk'],
  phone_booth: ['sidewalk'],
  vending_machine: ['sidewalk', 'beach'],
  bollard: ['sidewalk', 'lot'],
  trash_can: ['sidewalk', 'lot', 'park'],
  planter: ['sidewalk', 'lot'],
  mailbox: ['sidewalk', 'lot'],
  recycling_bins: ['sidewalk', 'lot'],
  shopping_cart: ['sidewalk', 'lot'],
  dumpster: ['lot'],
  hotdog_stand: ['sidewalk', 'lot', 'park', 'beach'],
  // people and small rides: never on the road
  pedestrian: ['sidewalk', 'lot', 'park', 'beach'],
  scooter: ['sidewalk', 'lot'],
  // nature
  grass_tuft: ['lot', 'park', 'lawn', 'beach'],
  flower: ['lot', 'park', 'lawn'],
  flower_bed: ['lot', 'park'],
  bush_small: GROUND_PLANTS,
  bush_large: GROUND_PLANTS,
  hedge: GROUND_PLANTS,
  tree_small: ['sidewalk', 'lot', 'park', 'lawn'],
  tree: GROUND_PLANTS,
  tree_big: ['park', 'lawn'],
  palm_tree: ['beach'],
  // parks
  statue: ['lot', 'park'],
  fountain: ['lot', 'park'],
  picnic_table: ['lot', 'park'],
  playground_slide: ['lot', 'park'],
  swing_set: ['lot', 'park'],
  bench: ['sidewalk', 'lot', 'park', 'beach'],
  // beach and harbour
  beach_chair: ['beach'],
  beach_umbrella: ['beach'],
  beach_hut: ['beach'],
  lifeguard_tower: ['beach'],
  wooden_crate: ['beach'],
  rowboat: ['beach', 'water'],
  speedboat: ['beach'],
  water_tower: ['beach'],
  lighthouse: ['beach'],
  // lots
  fence_section: ['lot'],
  garden_shed: ['lot'],
  house: ['lot'],
  house_small: ['lot'],
  townhouse_row: ['lot'],
  corner_shop: ['lot'],
  gas_station: ['lot'],
  kiosk_shop: ['lot', 'beach'],
  apartment_block: ['lot'],
  shop_row: ['lot'],
  office_lowrise: ['lot'],
  school: ['lot'],
  parking_garage: ['lot'],
  apartment_tower: ['lot'],
  hotel: ['lot'],
  skyscraper_slim: ['lot'],
  skyscraper_glass: ['lot'],
  skyscraper_stepped: ['lot'],
  skyscraper_tall: ['lot'],
  skyscraper_twin: ['lot'],
  skyscraper_needle: ['lot'],
  skyscraper_mega: ['lot'],
  landmark_tower: ['lot'],
  // vehicles: the only items allowed on the road (cars never on grass, parks or sand)
  car_compact: CAR,
  car_sedan: CAR,
  taxi: CAR,
  police_car: CAR,
  van: CAR,
  pickup: CAR,
  fire_truck: CAR,
  delivery_truck: ['road', 'lot', 'beach'],
  food_truck: ['road', 'lot', 'park', 'beach'],
  bus: ['road'],
  tram: ['road'],
};

/** True when the item may stand on the asphalt (cars, trucks, buses, trams). */
export function isRoadItem(id: string): boolean {
  return SPAWN[id]?.includes('road') ?? false;
}

export interface ZoneMap {
  /** Ground type at a point (a point outside every block / beach band is `lawn`). */
  zoneAt(x: number, z: number): SpawnZone;
  /** True when the axis-aligned box centred on (x, z) with half sizes (ex, ez) touches asphalt. */
  touchesRoad(x: number, z: number, ex: number, ez: number): boolean;
  /** Same for the canal water. */
  touchesWater(x: number, z: number, ex: number, ez: number): boolean;
}

export interface ZoneSource {
  rects: readonly GroundRect[];
  blocks: readonly BlockInfo[];
  coast: readonly number[];
  beachWidth: number;
  /** Block pitch (m). */
  pitch: number;
}

/** Zone lookup for a generated map. Road rects are bucketed on a 10 m grid so a query is a few comparisons. */
export function makeZoneMap(src: ZoneSource): ZoneMap {
  const CELL = 10;
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  const bucketize = (rects: readonly GroundRect[]) => {
    const out = new Map<number, GroundRect[]>();
    for (const r of rects)
      for (
        let cx = Math.floor(r.x0 / CELL);
        cx <= Math.floor(r.x1 / CELL);
        cx++
      )
        for (
          let cz = Math.floor(r.z0 / CELL);
          cz <= Math.floor(r.z1 / CELL);
          cz++
        ) {
          const k = key(cx, cz);
          const b = out.get(k);
          if (b) b.push(r);
          else out.set(k, [r]);
        }
    return out;
  };
  const buckets = bucketize(src.rects.filter((r) => r.y === ROAD_Y));
  const waterBuckets = bucketize(src.rects.filter((r) => r.y === CANAL_Y));

  const first = src.blocks[0];
  const shift = first ? first.cx / src.pitch - first.i : 0;
  const byIndex = new Map<string, { cx: number; cz: number; d: DistrictId }>();
  for (const b of src.blocks)
    byIndex.set(`${b.i},${b.j}`, { cx: b.cx, cz: b.cz, d: b.district });

  const touches =
    (map: Map<number, GroundRect[]>) =>
    (x: number, z: number, ex: number, ez: number) => {
      const c0 = Math.floor((x - ex) / CELL);
      const c1 = Math.floor((x + ex) / CELL);
      const z0 = Math.floor((z - ez) / CELL);
      const z1 = Math.floor((z + ez) / CELL);
      for (let cx = c0; cx <= c1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const b = map.get(key(cx, cz));
          if (!b) continue;
          for (const r of b)
            if (
              x + ex > r.x0 &&
              x - ex < r.x1 &&
              z + ez > r.z0 &&
              z - ez < r.z1
            )
              return true;
        }
      return false;
    };
  const touchesRoad = touches(buckets);
  const touchesWater = touches(waterBuckets);

  return {
    touchesRoad,
    touchesWater,
    zoneAt(x, z) {
      if (touchesRoad(x, z, 0, 0)) return 'road';
      if (touchesWater(x, z, 0, 0)) return 'water';
      const blk = byIndex.get(
        `${Math.round(x / src.pitch - shift)},${Math.round(z / src.pitch - shift)}`,
      );
      if (blk && blk.d !== 'edge') {
        const dx = Math.abs(x - blk.cx);
        const dz = Math.abs(z - blk.cz);
        if (Math.max(dx, dz) <= BLOCK_HALF) {
          if (Math.max(dx, dz) > LOT_HALF) return 'sidewalk';
          return blk.d === 'park' ? 'park' : 'lot';
        }
      }
      const edge = coastRadius(src.coast, Math.atan2(z, x)) - Math.hypot(x, z);
      return edge <= src.beachWidth ? 'beach' : 'lawn';
    },
  };
}

/** Half extents of the axis-aligned box around an item's rotated footprint. */
export function footprintHalf(
  id: string,
  rot: number,
): { ex: number; ez: number } {
  const it = getItem(id);
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return { ex: (c * it.w + s * it.d) / 2, ez: (s * it.w + c * it.d) / 2 };
}

/**
 * Why an item may not stand here, or null when it may: its centre must be in one of its zones, and
 * unless it is a vehicle its footprint must not touch asphalt.
 */
export function spawnViolation(
  zones: ZoneMap,
  id: string,
  x: number,
  z: number,
  rot: number,
): string | null {
  const allowed = SPAWN[id];
  if (!allowed) return `no spawn row for ${id}`;
  const zone = zones.zoneAt(x, z);
  if (!allowed.includes(zone)) return `${id} in ${zone} (allowed ${allowed})`;
  if (!allowed.includes('road')) {
    const { ex, ez } = footprintHalf(id, rot);
    if (zones.touchesRoad(x, z, ex, ez)) return `${id} touches the road`;
  }
  if (!allowed.includes('water')) {
    const { ex, ez } = footprintHalf(id, rot);
    if (zones.touchesWater(x, z, ex, ez)) return `${id} touches the canal`;
  }
  return null;
}
