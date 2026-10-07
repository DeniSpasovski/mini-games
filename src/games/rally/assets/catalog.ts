/**
 * Asset catalog: pure metadata (no three.js geometry here) so the world /
 * physics layer can ask about variants and colliders without building meshes.
 * Geometry lives in assets/builders/*, wired up in assets/library.ts.
 *
 * Adding an asset:
 *   1. add an entry here (id, category, variants, lods, colliders)
 *   2. add a builder in assets/builders/<category>.ts and register it in BUILDERS
 *   3. reference it from a map (scatter / roadside / props)
 *   4. inspect it at /games/rally/asset-debug.html?asset=<id>
 */
export type AssetCategory =
  | 'vegetation'
  | 'rocks'
  | 'props'
  | 'buildings'
  | 'structures'
  | 'markers'
  | 'cars'
  | 'textures';

export interface ColliderSpec {
  kind: 'cylinder' | 'sphere' | 'box';
  /** box: half extents (local X / Z), scaled by the instance's sx / sz. */
  hx?: number;
  hz?: number;
  /** Local offset (before instance rotation/scale). */
  x?: number;
  y?: number;
  z?: number;
  r: number;
  h?: number;
}

export interface LodSpec {
  /** Use this LOD while camera distance < maxDistance (m). */
  maxDistance: number;
  castShadow: boolean;
  /** Every instance uses variant 0's geometry (one draw call per asset instead of per variant: far LODs). */
  oneVariant?: boolean;
  /** Camera-facing 2-triangle diamond built from the previous LOD (assets/impostor.ts). */
  impostor?: boolean;
}

export interface AssetMeta {
  id: string;
  name: string;
  category: AssetCategory;
  description: string;
  /** How many seed variants the world uses (each is a separate shared mesh). */
  variants: number;
  /** Ordered near -> far. Instances beyond the last LOD are culled. */
  lods: LodSpec[];
  colliders?: ColliderSpec[];
  /** Per-instance colour jitter (0 = none), applied via instanceColor. */
  tint?: number;
  /**
   * Knocked over when the car drives through it (no collider, the car is not slowed): falls down and costs a time
   * penalty (world/breakables.ts). `r` = radius and `h` = height (m, unscaled) of the hit test.
   */
  breakable?: { r: number; h: number };
}

/**
 * LOD 0 must cover the sun's shadow box (quality.shadowExtent <= 75 m), so
 * farther LODs never cast shadows - they'd only cost shadow-pass draws.
 * Past ~420 m the variants share one crown, past 900 m a camera-facing impostor.
 */
const tree = (maxDist: number): LodSpec[] => [
  { maxDistance: 110, castShadow: true },
  { maxDistance: 420, castShadow: false },
  ...farTree(maxDist),
];
const farTree = (maxDist: number): LodSpec[] => [
  { maxDistance: 900, castShadow: false, oneVariant: true },
  { maxDistance: maxDist, castShadow: false, oneVariant: true, impostor: true },
];

export const ASSET_CATALOG: AssetMeta[] = [
  // --- vegetation -----------------------------------------------------------
  {
    id: 'pine_tree',
    name: 'Pine tree',
    category: 'vegetation',
    description:
      'Scots / spruce style conifer, layered jagged cones. Backbone of forest stages.',
    variants: 4,
    lods: tree(1700),
    colliders: [{ kind: 'cylinder', r: 0.28, h: 6, y: -0.5 }],
    tint: 0.12,
  },
  {
    id: 'black_pine',
    name: 'Black pine',
    category: 'vegetation',
    description:
      'Austrian black pine: straight trunk, flat-topped umbrella crown of dark clumps (hill plantations).',
    variants: 4,
    lods: tree(1700),
    colliders: [{ kind: 'cylinder', r: 0.3, h: 6, y: -0.5 }],
    tint: 0.12,
  },
  {
    id: 'juniper',
    name: 'Juniper',
    category: 'vegetation',
    description:
      'Dark conical juniper / cypress-like shrub, 2-3.5 m. No collision.',
    variants: 3,
    lods: [
      { maxDistance: 110, castShadow: true },
      { maxDistance: 400, castShadow: false },
      { maxDistance: 900, castShadow: false },
    ],
    tint: 0.12,
  },
  {
    id: 'walnut_tree',
    name: 'Walnut tree',
    category: 'vegetation',
    description:
      'Big round yard tree (walnut / mulberry): thick trunk, dense dark crown.',
    variants: 3,
    lods: tree(1100),
    colliders: [{ kind: 'cylinder', r: 0.34, h: 5, y: -0.5 }],
    tint: 0.1,
  },
  {
    id: 'willow_tree',
    name: 'Willow',
    category: 'vegetation',
    description:
      'Weeping willow: pale crown with drooping curtains, for canals / drains.',
    variants: 3,
    lods: tree(1000),
    colliders: [{ kind: 'cylinder', r: 0.3, h: 4, y: -0.5 }],
    tint: 0.1,
  },
  {
    id: 'reeds',
    name: 'Reeds',
    category: 'vegetation',
    description:
      'Tall golden reed cards for canal / drain banks (no collision, detail layer only).',
    variants: 3,
    lods: [{ maxDistance: 140, castShadow: false }],
  },
  {
    id: 'tall_weeds',
    name: 'Tall weeds',
    category: 'vegetation',
    description:
      'Tall dry weeds / thistles for field margins and ditches (no collision, detail layer only).',
    variants: 3,
    lods: [{ maxDistance: 120, castShadow: false }],
  },
  {
    id: 'birch_tree',
    name: 'Birch tree',
    category: 'vegetation',
    description: 'White-bark deciduous tree with clumped round foliage.',
    variants: 3,
    lods: tree(1300),
    colliders: [{ kind: 'cylinder', r: 0.18, h: 5, y: -0.5 }],
    tint: 0.15,
  },
  {
    id: 'bush',
    name: 'Bush',
    category: 'vegetation',
    description: 'Low leafy shrub, no collision (you drive through it).',
    variants: 3,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 450, castShadow: false },
    ],
    tint: 0.18,
  },
  {
    id: 'scrub_bush',
    name: 'Scrub bush',
    category: 'vegetation',
    description:
      'Dark olive Mediterranean hill scrub (juniper / blackthorn), low and wide. Drive-through.',
    variants: 4,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 450, castShadow: false },
    ],
    tint: 0.14,
  },
  {
    id: 'grass_tuft',
    name: 'Grass tuft',
    category: 'vegetation',
    description:
      'Alpha-tested crossed cards. Detail layer, only drawn close to the camera.',
    variants: 2,
    lods: [{ maxDistance: 110, castShadow: false }],
    tint: 0.2,
  },
  {
    id: 'fruit_tree',
    name: 'Fruit tree',
    category: 'vegetation',
    description:
      'Orchard / garden fruit tree (apple, plum): short trunk, wide round crown. Planted in rows by `rows` scatter.',
    variants: 4,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 380, castShadow: false },
      ...farTree(1100),
    ],
    colliders: [{ kind: 'cylinder', r: 0.14, h: 1.2, y: -0.3 }],
    tint: 0.14,
  },
  {
    id: 'hazelnut_tree',
    name: 'Hazelnut bush',
    category: 'vegetation',
    description:
      'Plantation hazelnut: multi-stemmed bush with a low, wide, fresh green crown. Planted in rows on `hazelnut` cover.',
    variants: 3,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 380, castShadow: false },
      ...farTree(1000),
    ],
    colliders: [{ kind: 'cylinder', r: 0.12, h: 1, y: -0.3 }],
    tint: 0.14,
  },
  {
    id: 'pale_tree',
    name: 'Pale lane tree',
    category: 'vegetation',
    description:
      'Tall plane / ash with a long grey-white trunk and an open yellow-green crown, lining country lanes (Petralica).',
    variants: 4,
    lods: tree(1700),
    colliders: [{ kind: 'cylinder', r: 0.3, h: 6, y: -0.5 }],
    tint: 0.12,
  },
  {
    id: 'young_tree',
    name: 'Young lane tree',
    category: 'vegetation',
    description:
      'Slender elm / ash sapling, crown taller than wide, starting to yellow. Fills the hedges along lanes.',
    variants: 4,
    lods: [
      { maxDistance: 100, castShadow: true },
      { maxDistance: 400, castShadow: false },
      ...farTree(1100),
    ],
    colliders: [{ kind: 'cylinder', r: 0.14, h: 2.5, y: -0.3 }],
    tint: 0.14,
  },
  {
    id: 'thicket_shrub',
    name: 'Roadside thicket',
    category: 'vegetation',
    description:
      'Dense hawthorn / blackthorn / elm-sucker shrub in autumn colours, 2.5-4.5 m, along lane edges and field borders. Drive-through (brush).',
    variants: 4,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 450, castShadow: false },
    ],
    tint: 0.16,
  },
  {
    id: 'oak_tree',
    name: 'Oak tree',
    category: 'vegetation',
    description:
      'Broad irregular broadleaf (oak / field tree) for hedgerows, gullies and village edges.',
    variants: 4,
    lods: tree(1500),
    colliders: [{ kind: 'cylinder', r: 0.3, h: 4, y: -0.5 }],
    tint: 0.14,
  },
  {
    id: 'poplar_tree',
    name: 'Lombardy poplar',
    category: 'vegetation',
    description:
      'Tall columnar poplar lining canals, roads and field edges in the Skopje plain.',
    variants: 3,
    lods: tree(1900),
    colliders: [{ kind: 'cylinder', r: 0.3, h: 6, y: -0.5 }],
    tint: 0.12,
  },
  {
    id: 'dry_grass',
    name: 'Dry grass',
    category: 'vegetation',
    description:
      'Golden summer grass cards (detail layer). Same construction as grass_tuft.',
    variants: 2,
    lods: [{ maxDistance: 110, castShadow: false }],
    tint: 0.18,
  },
  {
    id: 'spring_grass',
    name: 'Spring grass',
    category: 'vegetation',
    description:
      'Fresh bright green grass cards (detail layer) for maps with a green ground tint. Same construction as grass_tuft.',
    variants: 2,
    lods: [{ maxDistance: 110, castShadow: false }],
    tint: 0.16,
  },
  // --- rocks -------------------------------------------------------------------
  {
    id: 'rock_boulder',
    name: 'Boulder',
    category: 'rocks',
    description: 'Large displaced-icosphere boulder. Solid.',
    variants: 4,
    lods: [
      { maxDistance: 110, castShadow: true },
      { maxDistance: 1000, castShadow: false },
    ],
    colliders: [{ kind: 'sphere', r: 0.85, y: 0.35 }],
    tint: 0.1,
  },
  {
    id: 'rock_small',
    name: 'Small rock',
    category: 'rocks',
    description:
      'Fist-to-football sized rocks scattered on verges. No collision.',
    variants: 4,
    lods: [{ maxDistance: 220, castShadow: false }],
    tint: 0.12,
  },
  // --- props ---------------------------------------------------------------------
  {
    id: 'hay_bale',
    name: 'Hay bale',
    category: 'props',
    description: 'Round bale used to protect the outside of tight corners.',
    variants: 2,
    lods: [
      { maxDistance: 120, castShadow: true },
      { maxDistance: 700, castShadow: false },
    ],
    colliders: [{ kind: 'sphere', r: 0.7, y: 0.6 }],
  },
  {
    id: 'spectator',
    name: 'Spectator',
    category: 'props',
    description:
      'Low-poly standing fan with random clothing colours (variant = outfit).',
    variants: 6,
    lods: [
      { maxDistance: 100, castShadow: true },
      { maxDistance: 500, castShadow: false },
    ],
  },
  {
    id: 'tape_post',
    name: 'Tape post',
    category: 'props',
    description: 'Thin post with red/white spectator tape stub.',
    variants: 1,
    lods: [{ maxDistance: 300, castShadow: false }],
  },
  {
    id: 'fan_flag',
    name: 'Fan flag',
    category: 'props',
    description:
      'Flag on a pole stuck in the ground among the fans (variant = generic design, saturated colours). Flies along +X.',
    variants: 8,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 450, castShadow: false },
    ],
  },
  {
    id: 'road_barrier',
    name: 'Road barrier',
    category: 'props',
    description:
      'Police / marshal road-closed barrier (red-white striped rails, 2.2 m long, front faces +Z). Closes side-road mouths (MapDef.junctionBarriers). Solid.',
    variants: 1,
    lods: [
      { maxDistance: 250, castShadow: true },
      { maxDistance: 700, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 1.1, hz: 0.08, h: 1, r: 1.1 }],
  },
  {
    id: 'village_sign',
    name: 'Village sign',
    category: 'props',
    description:
      'Village name board on two posts, "Ajvatovci / Ајватовци" (Latin + Cyrillic), faces +Z. Solid posts.',
    variants: 1,
    lods: [
      { maxDistance: 140, castShadow: true },
      { maxDistance: 600, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 1, hz: 0.08, h: 2.4, r: 1.1 }],
  },
  {
    id: 'street_lamp',
    name: 'Street lamp',
    category: 'props',
    description:
      'Galvanised village street lamp, arm over the road (+Z). Solid pole.',
    variants: 1,
    lods: [
      { maxDistance: 110, castShadow: true },
      { maxDistance: 700, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 0.12, h: 8 }],
  },
  {
    id: 'tree_pit',
    name: 'Street tree pit',
    category: 'props',
    description:
      'Square soil pit with a granite edging round a street tree, flat on the sidewalk. No collider.',
    variants: 1,
    lods: [{ maxDistance: 90, castShadow: false }],
  },
  {
    id: 'traffic_signal',
    name: 'Traffic signal',
    category: 'props',
    description:
      'City traffic signal: grey pole, 5 m mast arm over the road (+Z), three-lamp heads facing +X (on the arm and the pole), a pedestrian head. Generic. Solid pole.',
    variants: 1,
    lods: [
      { maxDistance: 120, castShadow: true },
      { maxDistance: 500, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 0.14, h: 6 }],
  },
  {
    id: 'wall_lamp',
    name: 'Wall lamp',
    category: 'props',
    description:
      'Underpass light fixed to a retaining wall face (z = 0), luminaire at 3.6 m over the sidewalk (+Z).',
    variants: 1,
    lods: [
      { maxDistance: 90, castShadow: false },
      { maxDistance: 300, castShadow: false },
    ],
  },
  // --- buildings (unit footprint, scaled per instance: sx = width, sy = height, sz = depth) ---
  {
    id: 'house_pitched',
    name: 'House (sloped roof)',
    category: 'buildings',
    description:
      'Placeholder village house: rendered / brick walls, red tile hip or gable roof. Unit 1x1x1, scaled to the real footprint. Variants 0-3 one floor, 4-7 two floors.',
    variants: 8,
    lods: [
      { maxDistance: 160, castShadow: true },
      { maxDistance: 2600, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 0.5, hz: 0.5, h: 1, r: 0.71 }],
    tint: 0.06,
  },
  {
    id: 'building_flat',
    name: 'Building (flat roof)',
    category: 'buildings',
    description:
      'Placeholder flat-roofed building: 0/1 industrial hall, 2 unfinished brick block, 3 rendered block. Unit 1x1x1, scaled to the footprint. Variants 4-7 two floors of windows.',
    variants: 8,
    lods: [
      { maxDistance: 160, castShadow: true },
      { maxDistance: 2600, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 0.5, hz: 0.5, h: 1, r: 0.71 }],
    tint: 0.05,
  },
  // --- street vehicles (city maps) --------------------------------------------------
  {
    id: 'street_car',
    name: 'Street car',
    category: 'props',
    description:
      'Parked car, low poly: variants 0-11 pick the shape (0 sedan, 1 hatch, 2 SUV; variant % 3) and a paint; 12 = white hatch (placed on purpose). Faces +X. Solid.',
    variants: 13,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 420, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.92, h: 1.4, r: 2.5 }],
  },
  {
    id: 'taxi',
    name: 'Taxi',
    category: 'props',
    description:
      'Yellow cab with a roof sign and a black stripe (a sedan, faces +X). Solid.',
    variants: 1,
    lods: [
      { maxDistance: 90, castShadow: true },
      { maxDistance: 420, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.92, h: 1.5, r: 2.5 }],
  },
  {
    id: 'police_car',
    name: 'Police car',
    category: 'props',
    description:
      'White patrol sedan, navy band, red / blue roof light bar, "POLICE" (generic, no real agency name) on the doors. Faces +X. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 110, castShadow: true },
      { maxDistance: 480, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.92, h: 1.6, r: 2.5 }],
  },
  {
    id: 'fire_truck',
    name: 'Fire truck',
    category: 'props',
    description:
      'Red fire engine: cab, compartments with roller doors, white stripe, roof ladder, "FIRE DEPT" (generic, no real agency name) on the sides. Faces +X. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 130, castShadow: true },
      { maxDistance: 600, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 4.3, hz: 1.27, h: 3, r: 4.5 }],
  },
  {
    id: 'ambulance',
    name: 'Ambulance',
    category: 'props',
    description:
      'White box-body ambulance: red stripe, light bar, "FIRE DEPT" and "AMBULANCE" on the box sides (generic words, no agency name or logos). Faces +X. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 120, castShadow: true },
      { maxDistance: 520, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 3.2, hz: 1.17, h: 2.8, r: 3.4 }],
  },
  // --- highway structures ----------------------------------------------------------
  {
    id: 'power_pylon',
    name: 'Power pylon',
    category: 'structures',
    description:
      'Lattice transmission tower, 28 m, the line runs along local X (arms along Z). The cables are a line mesh (world/power-line-mesh.ts). Solid legs.',
    variants: 1,
    lods: [
      { maxDistance: 320, castShadow: true },
      { maxDistance: 2800, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 2.4, h: 12 }],
  },
  {
    id: 'power_pole',
    name: 'Power pole',
    category: 'structures',
    description:
      'Wooden distribution pole, 10 m, cross arm along local Z (the line runs along local X). Solid.',
    variants: 1,
    lods: [
      { maxDistance: 160, castShadow: true },
      { maxDistance: 900, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 0.16, h: 10 }],
  },
  {
    id: 'catenary_mast',
    name: 'Catenary mast',
    category: 'structures',
    description:
      'Railway overhead-line mast, 7.9 m H-beam, the cantilever reaches 3.1 m along local +Z to the track centre (world/railways.ts). The wires are a line mesh (world/rail-mesh.ts). Solid.',
    variants: 1,
    lods: [
      { maxDistance: 180, castShadow: true },
      { maxDistance: 1100, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 0.28, h: 8 }],
  },
  {
    id: 'concrete_block',
    name: 'Concrete block',
    category: 'structures',
    description:
      'Weathered concrete block, unit 1x1x1 scaled per instance (sx / sy / sz): bridge piers, abutments, retaining walls. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 220, castShadow: true },
      { maxDistance: 1800, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 0.5, hz: 0.5, h: 1, r: 0.71 }],
  },
  {
    id: 'jersey_barrier',
    name: 'Jersey barrier',
    category: 'structures',
    description:
      'New Jersey concrete barrier, 4 m long along local X, 0.81 m high. Median / bridge-edge barrier, placed every 4 m. Solid.',
    variants: 3,
    lods: [
      { maxDistance: 180, castShadow: true },
      { maxDistance: 900, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 2, hz: 0.3, h: 0.81, r: 2.02 }],
  },
  {
    id: 'crash_cushion',
    name: 'Crash cushion',
    category: 'structures',
    description:
      'Concrete backup block with a graduated row of yellow sand drums (black bands), 5.2 m long along local X, nose at +X. Placed at the nose of a gore area facing the traffic. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 110, castShadow: true },
      { maxDistance: 400, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 2.85, hz: 0.95, h: 0.9, r: 3 }],
  },
  {
    id: 'guard_rail',
    name: 'Guard rail',
    category: 'structures',
    description:
      'Steel W-beam guard rail on posts, 4 m long along local X (front faces +Z), placed every 4 m. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 160, castShadow: true },
      { maxDistance: 700, castShadow: false },
    ],
    colliders: [{ kind: 'box', hx: 2, hz: 0.1, h: 0.78, r: 2.0, z: 0.06 }],
  },
  // --- markers ---------------------------------------------------------------------
  {
    id: 'marker_post',
    name: 'Marker post',
    category: 'markers',
    // No collider: flimsy posts would stop the car dead. Breakable: the car knocks it over (no penalty).
    description:
      'Road-edge delineator post with reflector. Breakable: the car drives over it and it falls down.',
    variants: 1,
    lods: [{ maxDistance: 450, castShadow: false }],
    breakable: { r: 0.06, h: 1.05 },
  },
  {
    id: 'chevron_sign',
    name: 'Chevron sign',
    category: 'markers',
    description:
      'Corner chevron board. Variant 0 points left, 1 points right. Drive-through (not solid).',
    variants: 2,
    lods: [{ maxDistance: 500, castShadow: true }],
  },
];

/** house_pitched: wall top as a fraction of the total (unit) height; the roof is the rest. */
export const HOUSE_WALL_FRACTION = 0.68;

const byId = new Map(ASSET_CATALOG.map((a) => [a.id, a]));

export function getAssetMeta(id: string): AssetMeta {
  const m = byId.get(id);
  if (!m)
    throw new Error(`Unknown asset "${id}" - add it to assets/catalog.ts`);
  return m;
}

export function hasAsset(id: string): boolean {
  return byId.has(id);
}
