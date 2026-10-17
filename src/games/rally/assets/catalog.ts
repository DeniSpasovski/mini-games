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
  /** One InstancedMesh per variant, never a merged variant set (heavy variants: every instance would run the vertex shader over all of them). */
  separateVariants?: boolean;
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
  breakable?: { r: number; h: number; slow?: number };
}

/** Standing fans (variants 0-23); 24-41 sit or squat (SPECTATOR_SEATED_FROM..). */
export const SPECTATOR_VARIANTS = 24;
export const SPECTATOR_SEATED_FROM = 24;
export const SPECTATOR_SEATED_COUNT = 18;
/** Fans waving a hand flag (from variant 42): 6 outfits of North Macedonia, then 6 of the USA. */
export const SPECTATOR_FLAG_FROM = 42;
export const SPECTATOR_FLAG_COUNT = 12;

/** Service park vehicles built from boxes + wheels, a plain body far away. */
const VEHICLE_LODS: LodSpec[] = [
  { maxDistance: 140, castShadow: true },
  { maxDistance: 480, castShadow: false },
];

/** Service park small props. */
const PROP_LODS: LodSpec[] = [
  { maxDistance: 90, castShadow: true },
  { maxDistance: 260, castShadow: false },
];

/** Figures: smooth painted body close up, the jointed low-poly one, a boxy body, then a two-box silhouette. */
const PEOPLE_LODS: LodSpec[] = [
  { maxDistance: 28, castShadow: true },
  { maxDistance: 75, castShadow: true },
  { maxDistance: 220, castShadow: false },
  { maxDistance: 520, castShadow: false },
];

/** Pack cars: the full model up close, a reduced one out to the end of the shadows, then a plain one (no shadow). */
const carLods = (full: number, reduced: number, far: number): LodSpec[] => [
  { maxDistance: full, castShadow: true, separateVariants: true },
  { maxDistance: reduced, castShadow: true, separateVariants: true },
  { maxDistance: far, castShadow: false, separateVariants: true },
];

/** Service park vans and trucks (pack models, `carLods`): the full model near, shadows out to the end of the park. */
const PACK_VEHICLE_LODS = carLods(50, 140, 480);

export const ASSET_CATALOG: AssetMeta[] = [
  // --- vegetation (detail layer; trees and bushes grow from L-systems: trees/species.ts) ---
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
      'Fan made of jointed parts (assets/builders/people.ts). Variant % 6 = outfit (jacket, T-shirt + cap, hoodie, hi-vis vest, backpack, supporter shirt), variant / 6 = pose (stand, wave, camera, hands in pockets); variants 24-41: sitting on the ground, knees up, squatting; 42-53: waving a North Macedonia (42-47) or USA (48-53) hand flag.',
    variants:
      SPECTATOR_VARIANTS + SPECTATOR_SEATED_COUNT + SPECTATOR_FLAG_COUNT,
    lods: PEOPLE_LODS,
  },
  {
    id: 'mechanic',
    name: 'Mechanic',
    category: 'props',
    description:
      'Service-park mechanic in team overalls. Variant % 12 = team (builders/teams.ts), variant / 12 = pose (crouch at a wheel, bent over the nose, kneel).',
    variants: 36,
    lods: PEOPLE_LODS,
  },
  {
    id: 'crew',
    name: 'Team crew',
    category: 'props',
    description:
      'Team member in a team shirt. Variant % 12 = team, variant / 12 = pose (carrying a tyre, engineer with a laptop, manager with crossed arms).',
    variants: 36,
    lods: PEOPLE_LODS,
  },
  {
    id: 'driver',
    name: 'Driver',
    category: 'props',
    description:
      'Driver / co-driver in a race suit. Variant % 12 = team, variant / 12 = pose (helmet in hand, arms crossed).',
    variants: 24,
    lods: PEOPLE_LODS,
  },
  {
    id: 'marshal',
    name: 'Marshal',
    category: 'props',
    description:
      'Stage marshal / official in a hi-vis tabard with reflective bands (variant % 6 = tabard colour; variants 0-11: variant % 4 = pose stand, pointing, hands in pockets, phone; 12-23: yellow flag, green sign on a pole, radio, arms crossed).',
    variants: 24,
    lods: PEOPLE_LODS,
  },
  {
    id: 'photographer',
    name: 'Photographer',
    category: 'props',
    description:
      'Press photographer / camera operator in a coloured bib. Variant % 6 = pose (long lens raised, low shot, kneeling, shoulder video camera, tripod, camera lowered), variant / 6 % 4 = bib colour.',
    variants: 24,
    lods: PEOPLE_LODS,
  },
  {
    id: 'visitor',
    name: 'Visitor',
    category: 'props',
    description:
      'Casual person visiting: variant % 4 = pose (walking, drinking, on the phone, standing), variant / 4 = persona (man, woman, child, older man / woman, dress, teen, tourist, coat, big man, small child, fan).',
    variants: 48,
    lods: PEOPLE_LODS,
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
    id: 'flagpole',
    name: 'Flagpole',
    category: 'props',
    description:
      'National flag of North Macedonia on an 11 m mast (Sredno Vodno car park). Flies along +X. Solid pole.',
    variants: 1,
    lods: [
      { maxDistance: 160, castShadow: true },
      { maxDistance: 600, castShadow: false },
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
      'Village name board on two posts, "Ajvatovci / Ајватовци" (Latin + Cyrillic), front faces +Z, back plate has the red end-of-village slash. Solid posts.',
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
      'Parked car: a model of the CC BY packs with its own textures (street-car-models.ts). Variants 0-9 are the models (hatch, pickup, sport, minivan, SUV, coupe, off-road, compact, sedan, wagon) in a seeded paint; 10 = white hatch, 11 = dark sedan, 12 = white minivan (placed on purpose). Faces +X. Solid.',
    variants: 13,
    lods: carLods(40, 100, 420),
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.96, h: 1.4, r: 2.5 }],
  },
  {
    id: 'taxi',
    name: 'Taxi',
    category: 'props',
    description:
      'Yellow cab with a roof sign and a black stripe (the sedan model, faces +X). Solid.',
    variants: 1,
    lods: carLods(40, 100, 420),
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.96, h: 1.5, r: 2.5 }],
  },
  {
    id: 'police_car',
    name: 'Police car',
    category: 'props',
    description:
      'White patrol car (the sedan model), navy band, red / blue roof light bar, "POLICE" (generic, no real agency name) on the doors. Faces +X. Solid.',
    variants: 1,
    lods: carLods(50, 120, 480),
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.96, h: 1.6, r: 2.5 }],
  },
  {
    id: 'fire_truck',
    name: 'Fire truck',
    category: 'props',
    description:
      'Red fire engine (the box truck model with its textures): white stripe, roof ladder, light bar, "FIRE DEPT" (generic, no real agency name) on the box sides. Faces +X. Solid.',
    variants: 1,
    lods: carLods(50, 130, 600),
    colliders: [{ kind: 'box', hx: 4.3, hz: 1.27, h: 3, r: 4.5 }],
  },
  {
    id: 'ambulance',
    name: 'Ambulance',
    category: 'props',
    description:
      'White ambulance (the high-roof van model with its textures): red stripe, light bar, "FIRE DEPT" and "AMBULANCE" on the sides (generic words, no agency name or logos). Faces +X. Solid.',
    variants: 1,
    lods: carLods(50, 120, 520),
    colliders: [{ kind: 'box', hx: 3.2, hz: 1.17, h: 2.8, r: 3.4 }],
  },
  // --- service park (rally paddock; builders/service.ts, teams in builders/teams.ts) ---------------
  {
    id: 'service_truck',
    name: 'Service truck',
    category: 'props',
    description:
      'Team box truck (8 m) in team colours (variant = team) with a side awning on +Z. Faces +X. Solid body + awning legs.',
    variants: 12,
    lods: PACK_VEHICLE_LODS,
    colliders: [
      { kind: 'box', hx: 4.0, hz: 1.2, h: 3.1, r: 4.2 },
      { kind: 'cylinder', x: -3.8, z: 4.8, r: 0.07, h: 2.7 },
      { kind: 'cylinder', x: 0.5, z: 4.8, r: 0.07, h: 2.7 },
    ],
  },
  {
    id: 'service_semi',
    name: 'Team semi truck',
    category: 'props',
    description:
      'Team tractor-trailer (17.5 m) in team colours (variant = team), the baked lorry model with its textures, the back row of a parc. Faces +X. Solid.',
    variants: 12,
    lods: VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 8.8, hz: 1.35, h: 4, r: 9.2 }],
  },
  {
    id: 'service_tow',
    name: 'Recovery tow truck',
    category: 'props',
    description:
      'Roll-back tow truck (7 m) of a parc fermé, one colour all over (variant 0 yellow, 1 white, 2 red, 3 blue), the baked lorry cab with its textures. Faces +X. Solid.',
    variants: 4,
    lods: VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 3.5, hz: 1.35, h: 2.9, r: 3.8 }],
  },
  {
    id: 'service_van',
    name: 'Service van',
    category: 'props',
    description:
      'Team panel van (5.6 m, variant = team) with side stripes. Faces +X. Solid.',
    variants: 12,
    lods: PACK_VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 2.8, hz: 1.1, h: 2.6, r: 3.0 }],
  },
  {
    id: 'car_trailer',
    name: 'Car trailer',
    category: 'props',
    description:
      'Flat car trailer with a tow bar to +X (variant 0 grey, 1 dark). Solid.',
    variants: 2,
    lods: VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 2.6, hz: 1.05, h: 0.9, r: 2.9 }],
  },
  {
    id: 'pickup',
    name: 'Pickup',
    category: 'props',
    description:
      'Double-cab pickup in team colours (variant = team), open bed. Faces +X. Solid.',
    variants: 12,
    lods: PACK_VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 2.6, hz: 1.0, h: 1.9, r: 2.8 }],
  },
  {
    id: 'gazebo',
    name: 'Gazebo 3 x 3',
    category: 'props',
    description:
      'Pop-up tent 3 x 3 m, open sides (variant = team, 12 = white timekeeper tent). Solid legs.',
    variants: 13,
    lods: PROP_LODS,
    colliders: [-1.5, 1.5].flatMap((x) =>
      [-1.45, 1.45].map((z) => ({
        kind: 'cylinder' as const,
        x,
        z,
        r: 0.06,
        h: 2.5,
      })),
    ),
  },
  {
    id: 'gazebo_long',
    name: 'Gazebo 3 x 6',
    category: 'props',
    description:
      'Pop-up tent 6 x 3 m (long side along X), open sides (variant = team, 12 = white timekeeper tent). Solid legs.',
    variants: 13,
    lods: PROP_LODS,
    colliders: [-3, 0, 3].flatMap((x) =>
      [-1.45, 1.45].map((z) => ({
        kind: 'cylinder' as const,
        x,
        z,
        r: 0.06,
        h: 2.5,
      })),
    ),
  },
  {
    id: 'team_car',
    name: 'Team car',
    category: 'props',
    description:
      'Service-park rally car (placement + collider only: world/park-car-mesh.ts draws the real car model, world/park-cars.ts picks it per team). Variants 0-11 = team on its wheels, 12-23 = raised on axle stands with the rear wheels off. Faces +X. Solid.',
    variants: 24,
    lods: [{ maxDistance: 1, castShadow: false, oneVariant: true }],
    colliders: [{ kind: 'box', hx: 2.3, hz: 0.96, h: 1.4, r: 2.5 }],
  },
  {
    id: 'tyre_stack',
    name: 'Tyre stack',
    category: 'props',
    description: 'Stack of 2-4 rally tyres (variant % 3).',
    variants: 3,
    lods: PROP_LODS,
    colliders: [{ kind: 'cylinder', r: 0.36, h: 0.9 }],
  },
  {
    id: 'tool_chest',
    name: 'Tool chest',
    category: 'props',
    description:
      'Rolling tool chest (variant = colour). Front faces +Z. Solid.',
    variants: 4,
    lods: PROP_LODS,
    colliders: [{ kind: 'box', hx: 0.5, hz: 0.3, h: 1, r: 0.6 }],
  },
  {
    id: 'table_chairs',
    name: 'Table and chairs',
    category: 'props',
    description:
      'Folding table with two chairs on the +Z side and a laptop. Solid table.',
    variants: 1,
    lods: PROP_LODS,
    colliders: [{ kind: 'box', hx: 0.95, hz: 0.45, h: 0.9, r: 1.0 }],
  },
  {
    id: 'generator',
    name: 'Generator',
    category: 'props',
    description: 'Petrol generator on a frame. Solid.',
    variants: 1,
    lods: PROP_LODS,
    colliders: [{ kind: 'box', hx: 0.55, hz: 0.35, h: 1, r: 0.65 }],
  },
  {
    id: 'feather_flag',
    name: 'Feather flag',
    category: 'props',
    description:
      'Team feather flag on a pole (variant = team), two-sided, faces +Z. No collision.',
    variants: 12,
    lods: PROP_LODS,
  },
  {
    id: 'ground_sheet',
    name: 'Ground sheet',
    category: 'props',
    description:
      'Flat tarp 1 x 1 m, scaled by the instance (sx / sz) to a work area; variants blue, grey, green, black. No collision.',
    variants: 4,
    lods: [{ maxDistance: 160, castShadow: false }],
  },
  {
    id: 'trolley_jack',
    name: 'Trolley jack',
    category: 'props',
    description: 'Red trolley jack with a long handle (-X). No collision.',
    variants: 1,
    lods: PROP_LODS,
  },
  {
    id: 'food_truck',
    name: 'Catering van',
    category: 'props',
    description:
      'Catering van (variant = colour) with a serving hatch and awning flap on +Z. Faces +X. Solid.',
    variants: 3,
    lods: PACK_VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 2.8, hz: 1.1, h: 2.4, r: 3.0 }],
  },
  {
    id: 'porta_toilet',
    name: 'Portable toilet',
    category: 'props',
    description: 'Portable toilet cabin (variant = colour), door on +Z. Solid.',
    variants: 3,
    lods: PROP_LODS,
    colliders: [{ kind: 'box', hx: 0.6, hz: 0.6, h: 2.3, r: 0.85 }],
  },
  {
    id: 'fuel_trailer',
    name: 'Fuel trailer',
    category: 'props',
    description:
      'Refuelling trailer: lying tank on a two-wheel chassis. Faces +X. Solid.',
    variants: 1,
    lods: VEHICLE_LODS,
    colliders: [{ kind: 'box', hx: 1.7, hz: 0.75, h: 2, r: 1.9 }],
  },
  {
    id: 'control_board',
    name: 'Control board',
    category: 'props',
    description:
      'Time-control board on a post, symbols only (variant 0 yellow with a clock disc, 1 red with a white bar). Faces +Z. Solid post.',
    variants: 2,
    lods: PROP_LODS,
    colliders: [{ kind: 'cylinder', r: 0.07, h: 2.3 }],
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
    id: 'millennium_cross',
    name: 'Millennium Cross',
    category: 'structures',
    description:
      '66 m white lattice steel Latin cross (the 2002 monument above Skopje): LOD 0 full lattice, LOD 1 coarse, LOD 2 solid slabs (drawn with the horizon backdrop, world/horizon.ts). Foot 8 m below the origin. Solid.',
    variants: 1,
    lods: [
      { maxDistance: 450, castShadow: true },
      { maxDistance: 1100, castShadow: false },
      { maxDistance: 6000, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 2.2, h: 20 }],
  },
  {
    id: 'antenna_mast',
    name: 'Antenna mast',
    category: 'structures',
    description:
      '155 m red / white triangular lattice mast (the antenna tower on the Vodno ridge): LOD 2 = tapered prism for the horizon backdrop. Solid base.',
    variants: 1,
    lods: [
      { maxDistance: 500, castShadow: true },
      { maxDistance: 1500, castShadow: false },
      { maxDistance: 6000, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 3.2, h: 20 }],
  },
  {
    id: 'gondola_pylon',
    name: 'Cable car pylon',
    category: 'structures',
    description:
      'Lattice support of a gondola line, 20 m at unit scale (instances scale it), ropes along local X over two sheave trains (world/aerialway.ts, aerialway-mesh.ts). Solid legs.',
    variants: 1,
    lods: [
      { maxDistance: 300, castShadow: true },
      { maxDistance: 2800, castShadow: false },
    ],
    colliders: [{ kind: 'cylinder', r: 1.8, h: 12 }],
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
      'Corner chevron board. Variant 0 points left, 1 points right. Breakable: the car knocks it over and loses a little speed.',
    variants: 2,
    lods: [{ maxDistance: 500, castShadow: true }],
    breakable: { r: 0.65, h: 1.6, slow: 0.93 },
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
