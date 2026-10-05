import { ANIMAL_DEFS, SHARED_CITY_IDS } from './catalog-animal';
import { TOY_DEFS } from './catalog-toy';
import {
  itemSize,
  levelForSize,
  pointsForTier,
  tierForSize,
} from '../sim/progression';

/**
 * Edible item catalog: data only. Size, tier, unlock level and points are derived
 * from the dimensions (see sim/progression.ts), so a new item never needs
 * hand-picked points. Procedural builders live in items/build-*.ts.
 */
export type ItemGroup =
  | 'litter'
  | 'street'
  | 'nature'
  | 'people'
  | 'park'
  | 'beach'
  | 'vehicle'
  | 'harbour'
  | 'residential'
  | 'commercial'
  | 'building'
  | 'skyscraper'
  // Toy Emporium
  | 'bricks'
  | 'figures'
  | 'toys'
  | 'plush'
  | 'dolls'
  | 'toyveh'
  | 'robots'
  | 'games'
  | 'outdoor'
  | 'store'
  | 'landmark'
  // Animal Island
  | 'bugs'
  | 'critters'
  | 'animals'
  | 'giants'
  | 'flora'
  | 'rocks'
  | 'hills'
  | 'zoo'
  | 'farm'
  | 'lab'
  | 'labveh'
  | 'staff';

/** Which map an item belongs to. City items are the default. */
export type ItemMap = 'city' | 'toy' | 'animal';

/** Which shared material an item is drawn with. `prop` = vertex colours only; others tile windows on walls. */
export type ItemStyle = 'prop' | 'punched' | 'ribbon' | 'glass';

export interface ItemDef {
  id: string;
  name: string;
  group: ItemGroup;
  /** Width (x), depth (z), height (y) in metres. */
  w: number;
  d: number;
  h: number;
  /** Number of geometry variants the builder supports. */
  variants: number;
  style: ItemStyle;
  /** Free-text placement note shown in the viewers. */
  where: string;
  /** Optional overrides for special cases. */
  sizeOverride?: number;
  pointsOverride?: number;
  /** Instance colour palette (hex) applied to `paint` parts; empty = no tint. */
  paints?: number[];
  /** Map the item belongs to (default 'city'). */
  map?: ItemMap;
}

export interface ItemInfo extends ItemDef {
  size: number;
  /** Size tier 1..25: decides the points. */
  tier: number;
  /** First hole level (1..15) that can eat it. */
  level: number;
  points: number;
}

type Opts = Partial<
  Pick<
    ItemDef,
    'variants' | 'style' | 'paints' | 'sizeOverride' | 'pointsOverride'
  >
>;

function def(
  id: string,
  name: string,
  group: ItemGroup,
  w: number,
  d: number,
  h: number,
  where: string,
  o: Opts = {},
): ItemDef {
  return {
    id,
    name,
    group,
    w,
    d,
    h,
    where,
    variants: o.variants ?? 1,
    style: o.style ?? 'prop',
    paints: o.paints,
    sizeOverride: o.sizeOverride,
    pointsOverride: o.pointsOverride,
  };
}

const CAR_PAINTS = [0xd94a3a, 0x3b82d6, 0xf2f2f2, 0x2f3438, 0x39a35a, 0xe8b32a];
const FLOWER_PAINTS = [0xff5a7a, 0xffd23f, 0xffffff, 0xb06cf5, 0xff8a3d];
const WALL_PAINTS = [0xf3e3c3, 0xe9b8a0, 0xbcd7e8, 0xc6dfb4, 0xf0d58a];

export const ITEM_DEFS: ItemDef[] = [
  // level 1
  def('soda_can', 'Soda can', 'litter', 0.12, 0.12, 0.2, 'everywhere', {
    paints: [0xe03a3a, 0x3a7be0, 0x4cb35a],
  }),
  def(
    'litter_paper',
    'Crumpled paper',
    'litter',
    0.3,
    0.3,
    0.05,
    'streets, parks',
  ),
  def('trash_bag', 'Trash bag', 'litter', 0.6, 0.5, 0.6, 'streets, dumpsters', {
    paints: [0x25282b, 0x2f6b3a],
  }),
  def('trash_can', 'Trash can', 'street', 0.6, 0.6, 1.0, 'sidewalks, parks', {
    variants: 2,
  }),
  def('flower', 'Flower', 'nature', 0.25, 0.25, 0.4, 'parks, residential', {
    paints: FLOWER_PAINTS,
  }),
  def('grass_tuft', 'Grass tuft', 'nature', 0.5, 0.5, 0.3, 'parks, verges'),
  def('traffic_cone', 'Traffic cone', 'street', 0.4, 0.4, 0.7, 'streets'),
  def('fire_hydrant', 'Fire hydrant', 'street', 0.45, 0.45, 0.8, 'sidewalks', {
    paints: [0xd33a2c, 0xe8c52a],
  }),
  def(
    'pedestrian',
    'Pedestrian',
    'people',
    0.5,
    0.35,
    1.75,
    'sidewalks, plazas, beach',
    { paints: [0xd94a3a, 0x3b82d6, 0x39a35a, 0xe8b32a, 0x8b5cf6, 0xf2f2f2] },
  ),
  def(
    'parking_meter',
    'Parking meter',
    'street',
    0.3,
    0.3,
    1.3,
    'downtown curbs',
  ),
  def('bollard', 'Bollard', 'street', 0.3, 0.3, 0.9, 'plazas'),
  def('street_sign', 'Street sign', 'street', 0.6, 0.1, 2.5, 'crossings', {
    variants: 3,
  }),
  def('newspaper_box', 'Newspaper box', 'street', 0.6, 0.5, 1.1, 'downtown', {
    paints: [0xd94a3a, 0x3b82d6, 0xe8b32a],
  }),
  // level 2
  def('mailbox', 'Mailbox', 'street', 0.95, 0.5, 1.2, 'residential', {
    variants: 2,
  }),
  def(
    'bush_small',
    'Small bush',
    'nature',
    1.0,
    1.0,
    0.8,
    'residential, parks',
  ),
  def('planter', 'Planter', 'street', 1.0, 1.0, 0.7, 'plazas, shopfronts', {
    paints: FLOWER_PAINTS,
  }),
  def(
    'shopping_cart',
    'Shopping cart',
    'street',
    1.0,
    0.6,
    1.0,
    'parking lots',
  ),
  def(
    'wooden_crate',
    'Wooden crate',
    'harbour',
    1.0,
    1.0,
    1.0,
    'harbour, shops',
  ),
  // level 3
  def('lamp_post', 'Lamp post', 'street', 0.35, 0.35, 4.5, 'every sidewalk'),
  def('phone_booth', 'Phone booth', 'street', 1.1, 1.1, 2.4, 'downtown'),
  def(
    'vending_machine',
    'Vending machine',
    'street',
    1.1,
    0.8,
    1.9,
    'shopfronts, beach',
    { paints: [0xd94a3a, 0x3b82d6, 0x39a35a] },
  ),
  def('flower_bed', 'Flower bed', 'nature', 1.2, 1.2, 0.4, 'parks', {
    paints: FLOWER_PAINTS,
  }),
  // level 4
  def('statue', 'Statue', 'park', 1.3, 1.3, 3.0, 'plaza, parks'),
  def(
    'recycling_bins',
    'Recycling bins',
    'street',
    1.4,
    0.7,
    1.2,
    'residential',
  ),
  def(
    'bush_large',
    'Large bush',
    'nature',
    1.4,
    1.4,
    1.2,
    'residential, parks',
  ),
  // level 5
  def('traffic_light', 'Traffic light', 'street', 1.5, 0.4, 4.5, 'crossings'),
  def(
    'tree_small',
    'Small tree',
    'nature',
    1.6,
    1.6,
    3.5,
    'streets, residential',
    { variants: 2 },
  ),
  def('beach_chair', 'Beach chair', 'beach', 1.6, 0.6, 0.8, 'beach', {
    paints: [0xe8543a, 0x3b82d6, 0xf2c230, 0x39a35a],
  }),
  // level 6
  def('bench', 'Bench', 'park', 1.8, 0.6, 0.9, 'parks, sidewalks, beach'),
  def('picnic_table', 'Picnic table', 'park', 1.8, 1.6, 0.8, 'parks'),
  def('scooter', 'Scooter', 'vehicle', 1.8, 0.7, 1.1, 'streets', {
    paints: CAR_PAINTS,
  }),
  def('palm_tree', 'Palm tree', 'nature', 1.8, 1.8, 7.0, 'beach'),
  def('beach_umbrella', 'Beach umbrella', 'beach', 1.9, 1.9, 2.3, 'beach', {
    paints: [0xe8543a, 0x3b82d6, 0xf2c230, 0x39a35a],
  }),
  // level 7
  def(
    'fence_section',
    'Fence',
    'residential',
    2.1,
    0.1,
    1.2,
    'residential lots',
  ),
  def('hedge', 'Hedge', 'nature', 2.1, 0.8, 1.2, 'residential, parks'),
  def('dumpster', 'Dumpster', 'street', 2.1, 1.2, 1.3, 'alleys, commercial', {
    paints: [0x2f7d46, 0x2f5fa8],
  }),
  def(
    'hotdog_stand',
    'Hot dog stand',
    'street',
    2.2,
    1.2,
    2.3,
    'plazas, beach',
    { paints: [0xe8543a, 0xf2c230, 0x3b82d6] },
  ),
  // level 8
  def('lifeguard_tower', 'Lifeguard tower', 'beach', 2.5, 2.5, 4.0, 'beach'),
  def('bus_stop', 'Bus stop', 'street', 2.6, 1.4, 2.5, 'main roads'),
  def('tree', 'Tree', 'nature', 2.6, 2.6, 6.0, 'parks, residential', {
    variants: 2,
  }),
  // level 9
  def('fountain', 'Fountain', 'park', 3.0, 3.0, 1.8, 'plaza, parks'),
  def('playground_slide', 'Playground slide', 'park', 3.0, 1.0, 2.2, 'parks'),
  def('swing_set', 'Swing set', 'park', 3.0, 2.0, 2.2, 'parks'),
  // level 10
  def(
    'car_compact',
    'Compact car',
    'vehicle',
    3.5,
    1.7,
    1.5,
    'everywhere (parked)',
    { paints: CAR_PAINTS },
  ),
  def('rowboat', 'Rowboat', 'harbour', 3.5, 1.4, 0.8, 'beach, harbour', {
    paints: [0xe8543a, 0x3b82d6, 0xf2c230],
  }),
  // level 11
  def(
    'garden_shed',
    'Garden shed',
    'residential',
    4.0,
    3.0,
    2.8,
    'residential',
    { paints: WALL_PAINTS },
  ),
  def('billboard', 'Billboard', 'commercial', 4.0, 0.6, 6.0, 'main roads', {
    variants: 3,
  }),
  // level 12
  def('car_sedan', 'Sedan', 'vehicle', 4.2, 1.8, 1.5, 'everywhere (parked)', {
    paints: CAR_PAINTS,
  }),
  def('taxi', 'Taxi', 'vehicle', 4.2, 1.8, 1.6, 'downtown'),
  def('police_car', 'Police car', 'vehicle', 4.8, 1.9, 1.7, 'downtown'),
  def('kiosk_shop', 'Kiosk', 'commercial', 4.5, 4.5, 3.2, 'plazas, beach', {
    paints: [0xe8543a, 0x3b82d6, 0xf2c230, 0x39a35a],
  }),
  // level 13
  def('van', 'Van', 'vehicle', 5.5, 2.0, 2.3, 'commercial', {
    paints: CAR_PAINTS,
  }),
  def('pickup', 'Pickup', 'vehicle', 5.4, 2.0, 1.9, 'residential', {
    paints: CAR_PAINTS,
  }),
  def('beach_hut', 'Beach hut', 'beach', 5.5, 5.0, 4.0, 'beach', {
    paints: [0xe8543a, 0x3b82d6, 0xf2c230, 0x39a35a],
  }),
  def('tree_big', 'Big tree', 'nature', 5.5, 5.5, 10, 'parks'),
  // level 14
  def('water_tower', 'Water tower', 'harbour', 6, 6, 14, 'harbour, commercial'),
  def('lighthouse', 'Lighthouse', 'harbour', 6, 6, 20, 'headland'),
  def(
    'delivery_truck',
    'Delivery truck',
    'vehicle',
    6.5,
    2.4,
    3.4,
    'commercial, harbour',
    { paints: [0xf2f2f2, 0x3b82d6, 0xe8b32a] },
  ),
  // level 15
  def('food_truck', 'Food truck', 'vehicle', 7.5, 2.4, 3.2, 'plazas, beach', {
    paints: [0xe8543a, 0x39a35a, 0xf2c230, 0x3b82d6],
  }),
  def('speedboat', 'Speedboat', 'harbour', 7.5, 2.5, 2.0, 'harbour slipway', {
    paints: [0xf2f2f2, 0xe8543a, 0x3b82d6],
  }),
  // level 16
  def(
    'house_small',
    'Small house',
    'residential',
    8.0,
    7.0,
    6.0,
    'residential',
    { paints: WALL_PAINTS },
  ),
  def('fire_truck', 'Fire truck', 'vehicle', 8.5, 2.5, 3.2, 'fire station'),
  // level 17
  def('bus', 'Bus', 'vehicle', 10, 2.5, 3.2, 'main roads', {
    paints: [0x3b82d6, 0xe8b32a, 0x39a35a],
  }),
  def('house', 'House', 'residential', 9.5, 9.0, 8.0, 'residential', {
    paints: WALL_PAINTS,
  }),
  def('corner_shop', 'Corner shop', 'commercial', 10, 8, 5, 'commercial', {
    paints: WALL_PAINTS,
  }),
  // level 18
  def(
    'townhouse_row',
    'Townhouses',
    'residential',
    12,
    8,
    9,
    'residential edge',
    { style: 'punched' },
  ),
  def('tram', 'Tram', 'vehicle', 12, 2.6, 3.4, 'downtown'),
  def('gas_station', 'Gas station', 'commercial', 12, 9, 5, 'ring road'),
  // level 19
  def(
    'apartment_block',
    'Apartment block',
    'building',
    14,
    12,
    15,
    'commercial',
    { style: 'punched', paints: WALL_PAINTS },
  ),
  def('shop_row', 'Shop row', 'building', 14, 10, 8, 'commercial', {
    style: 'punched',
    paints: WALL_PAINTS,
  }),
  // level 20
  def(
    'office_lowrise',
    'Low-rise office',
    'building',
    16,
    16,
    22,
    'downtown edge',
    { style: 'ribbon' },
  ),
  def('school', 'School', 'building', 16, 12, 9, 'residential', {
    style: 'punched',
  }),
  // levels 21-25 (points 25..50)
  def(
    'parking_garage',
    'Parking garage',
    'building',
    19,
    18,
    12,
    'commercial',
    { style: 'ribbon' },
  ),
  def(
    'apartment_tower',
    'Apartment tower',
    'building',
    18,
    18,
    40,
    'downtown edge',
    { style: 'punched', paints: WALL_PAINTS },
  ),
  def('hotel', 'Hotel', 'skyscraper', 22, 18, 50, 'downtown', {
    style: 'punched',
  }),
  def(
    'skyscraper_slim',
    'Slim skyscraper',
    'skyscraper',
    20,
    20,
    80,
    'downtown',
    { style: 'glass' },
  ),
  def(
    'skyscraper_glass',
    'Glass skyscraper',
    'skyscraper',
    26,
    24,
    90,
    'downtown',
    { style: 'glass' },
  ),
  def(
    'skyscraper_stepped',
    'Stepped skyscraper',
    'skyscraper',
    24,
    24,
    100,
    'downtown',
    { style: 'punched' },
  ),
  def(
    'skyscraper_tall',
    'Tall skyscraper',
    'skyscraper',
    28,
    28,
    120,
    'downtown',
    { style: 'ribbon' },
  ),
  def('skyscraper_twin', 'Twin tower', 'skyscraper', 30, 22, 110, 'downtown', {
    style: 'glass',
  }),
  def(
    'skyscraper_needle',
    'Needle tower',
    'skyscraper',
    22,
    22,
    128,
    'downtown centre',
    { style: 'glass' },
  ),
  def(
    'skyscraper_mega',
    'Mega tower',
    'skyscraper',
    32,
    32,
    140,
    'downtown centre',
    { style: 'ribbon' },
  ),
  def(
    'landmark_tower',
    'Landmark tower',
    'skyscraper',
    34,
    30,
    135,
    'downtown centre',
    { style: 'punched' },
  ),
];

const BY_ID = new Map<string, ItemInfo>();
function derive(
  d: ItemDef,
  over?: { size?: number; points?: number },
): ItemInfo {
  const size = over?.size ?? d.sizeOverride ?? itemSize(d.w, d.d, d.h);
  const tier = tierForSize(size);
  return {
    ...d,
    map: d.map ?? 'city',
    size,
    tier,
    level: levelForSize(size),
    points: over?.points ?? d.pointsOverride ?? pointsForTier(tier),
  };
}
for (const d of ITEM_DEFS) BY_ID.set(d.id, derive(d));
for (const d of TOY_DEFS) BY_ID.set(d.id, derive(d));
for (const d of ANIMAL_DEFS) BY_ID.set(d.id, derive(d));

/**
 * Re-derive size / tier / level / points of every item **in place** (the `ItemInfo` objects stay the
 * same, so `ITEMS`, `getItem` and everything holding one see the new values). Used by the item viewer
 * to preview a change of `SIZE_RULES` or a per-item size / points override; worlds and scenes built
 * earlier keep their copies, so rebuild them. The game never calls it.
 */
export function rederiveCatalog(
  over: Record<string, { size?: number; points?: number }> = {},
): void {
  for (const d of [...ITEM_DEFS, ...TOY_DEFS, ...ANIMAL_DEFS])
    Object.assign(BY_ID.get(d.id)!, derive(d, over[d.id]));
}

/** City Island catalog with derived `size`, `tier`, `level`, `points`, in catalog order (ascending size). */
export const ITEMS: ItemInfo[] = ITEM_DEFS.map((d) => BY_ID.get(d.id)!);

/** Toy Emporium catalog, ascending size. */
export const TOY_ITEMS: ItemInfo[] = TOY_DEFS.map((d) => BY_ID.get(d.id)!);

/** Animal Island catalog (its own items plus the City greenery it shares), ascending size. */
export const ANIMAL_ITEMS: ItemInfo[] = [
  ...ANIMAL_DEFS.map((d) => BY_ID.get(d.id)!),
  ...SHARED_CITY_IDS.map((id) => BY_ID.get(id)!),
].sort((a, b) => a.size - b.size || a.id.localeCompare(b.id));

/** Items of one map. */
export function itemsForMap(map: ItemMap): ItemInfo[] {
  return map === 'toy' ? TOY_ITEMS : map === 'animal' ? ANIMAL_ITEMS : ITEMS;
}

export function getItem(id: string): ItemInfo {
  const it = BY_ID.get(id);
  if (!it) throw new Error(`unknown item "${id}"`);
  return it;
}

export function hasItem(id: string): boolean {
  return BY_ID.has(id);
}

/** Items of one unlock level. */
export function itemsOfLevel(level: number, map: ItemMap = 'city'): ItemInfo[] {
  return itemsForMap(map).filter((i) => i.level === level);
}
