import type { LeafStyle } from './leaftex';
import { hashText } from './math';

/**
 * Tree species: DATA the tree code reads (spec: trees/Species.md), so adding or tuning a kind of tree changes no
 * code. Rules use the grammar of trees/grammar.ts (alphabet F f A B + - & ^ < > | ! [ ] L T, parameters in brackets,
 * arithmetic on the predecessor's parameters, `constants`, and `rnd(a, b)` jitter from the tree's seeded PRNG).
 * Angles are degrees, lengths metres (times `lengthScale`).
 */
export interface RuleDef {
  /** Predecessor with its parameter names, e.g. `B(l,o)`. */
  pred: string;
  /** Optional condition on the parameters, e.g. `o < 2`. */
  cond?: string;
  succ: string;
  /** Probability among the rules of the same predecessor whose condition holds (they sum to 1). */
  p?: number;
}

/** LOD budget (spec: trees/Lod.md#budget): per species, with these defaults. */
export interface LodSettings {
  /**
   * Shares of the screen height the tree's bounding sphere covers (scaled by the graphics quality setting): below
   * [0] its sprites start thinning (trees/Foliage.md#simplification), below [1] the branches go LOD0 -> LOD1, below
   * [2] the tree becomes the impostor (LOD2).
   */
  thresholds: [number, number, number];
  /** Back to the finer level only above threshold x (1 + hysteresis). */
  hysteresis: number;
  /** Cross-fade time (s). */
  fadeTime: number;
}

/** 14 %, 7 %, 3.5 % of the screen height: for a 15 m tree at a 60 deg field of view ~90, 185 and 370 m. */
export const DEFAULT_LOD: LodSettings = {
  thresholds: [0.14, 0.07, 0.035],
  hysteresis: 0.15,
  fadeTime: 0.3,
};

/**
 * Trees closer than this (m) are always LOD0 with their full-detail sprites (NEAR_SPRITES), whatever their screen
 * height, the field of view or the quality setting (trees/Lod.md#selection): a player near a tree only ever sees it at
 * full detail.
 */
export const FULL_DETAIL_DISTANCE = 40;

/**
 * Share of its rank-ordered sprites a crown draws at full detail (trees/Foliage.md#simplification): the rest are left
 * out and the kept ones are 1 / sqrt of it larger, so the crown covers the same area with half the sprites (the
 * sprites are most of the tree cost, trees/Performance.md#hotspots). Thinning then goes on from here to 25% at the
 * impostor threshold.
 */
export const NEAR_SPRITES = 0.35;

/**
 * Far crowns (trees/Foliage.md#simplification): over FAR_RAMP m past the full-detail distance the share eases from
 * NEAR_SPRITES to FAR_SPRITES[0], then on to FAR_SPRITES[1] at the impostor threshold, each sprite grown so the crown
 * keeps its coverage. Gradual on purpose: a crown that fills in over a few metres, or that is much sparser than the
 * impostor it fades into, reads as popping. Far crowns are bound by vertices (trees/Performance.md#hotspots): few, large sprites. The perf
 * panel changes both live (trees/draw.ts `setFarSprites`).
 */
export const FAR_SPRITES: [number, number] = [0.2, 0.15];
export const FAR_RAMP = 60;
/** Crowns nearer than this (m) draw their sprites' tight outlines with the depth prepass (trees/draw.ts NEAR_PART). */
export const NEAR_SPRITE_DISTANCE = FULL_DETAIL_DISTANCE + 15;

/** The distances (m) of a tree's detail zones (trees/draw.ts, trees/materials.ts `treeSpriteScale`). */
export interface Reach {
  /** LOD0 branches and the full sprite share inside it. */
  full: number;
  /** Over this many metres past `full` the sprite share eases to the far share. */
  ramp: number;
  /** Crowns nearer than this draw their tight sprite outlines with the depth prepass. */
  near: number;
}

export const FOREST_REACH: Reach = {
  full: FULL_DETAIL_DISTANCE,
  ramp: FAR_RAMP,
  near: NEAR_SPRITE_DISTANCE,
};

/**
 * The first row: trees within ROADSIDE_EDGE m of the road's edge are the ones a driver passes at arm's length and sees
 * longest, so their zones reach out farther (trees/draw.ts `reachOf`). The second row and the forest behind keep
 * FOREST_REACH. The shader learns it from the fraction of `treeInst.w` (the variant slot): ROAD_REACH_FLAG.
 */
export const ROADSIDE_EDGE = 9;
export const ROAD_REACH: Reach = {
  full: 80,
  ramp: 80,
  near: 95,
};
export const ROAD_REACH_FLAG = 0.25;

export type BarkTexture = 'furrowed' | 'smooth';
export type FoliageKind = 'needles' | 'broadleaf';

export interface SpeciesDef {
  name: string;
  axiom: string;
  rules: RuleDef[];
  constants?: Record<string, number>;
  iterations: number;
  /** Rewriting stops before the string would hold more F segments than this. */
  segmentCap: number;
  /** Turn angle of + - & ^ < > without an explicit angle (deg). */
  angle: number;
  lengthScale: number;
  /** Radius at the base (m) and the factor `!` multiplies it by. */
  baseRadius: number;
  radiusDecay: number;
  /** Heading bends towards this vector after every segment, by `tropismStrength`. */
  tropism: [number, number, number];
  tropismStrength: number;
  bark: {
    color: string;
    texture: BarkTexture;
    /** repeats per metre of branch */ tiling: number;
  };
  foliage: {
    /** Which cluster sprite atlas (trees/leaftex.ts): needle sprays or leaf bunches. */
    kind: FoliageKind;
    /** Sprite size (m) at a leaf point, before the cluster-size variation. */
    spriteSize: number;
    /** The leaf style: which atlas (trees/leaftex.ts) the cluster sprites are cut from. */
    leaf: LeafStyle;
    palette: string[];
  };
  lod?: Partial<LodSettings>;
  /** Instance scale range. */
  scale: [number, number];
  /** Branches thinner than this (m) are left out: the foliage sprites cover them (trees/Lod.md#levels). */
  twigRadius: number;
  /** Most LOD0 branch triangles (6,000; shrubs 2,000) and sprites per crown (broadleaf 360, conifers 400; shrubs 200). */
  maxBranchTriangles: number;
  maxSprites: number;
  /** Trunk / first-order limb segments at least this thick (m) collide (trees/Placement.md#collision). */
  collisionRadius: number;
  /** Pre-generated variants (default 8). */
  variants?: number;
}

/** Shared by the deciduous trees built with `broadleaf` below. */
interface BroadleafShape {
  name: string;
  /** Clear bole below the first limbs (m), and the first leader / limb length. */
  bole: number;
  lead: number;
  /** Downward pitch of the two low limbs and of the three leaders (deg). */
  limbs: [number, number];
  leaders: [number, number];
  /** Pitch of the side shoots of the crown (deg): wide = spreading, narrow = upright. */
  laterals: [number, number];
  iterations: number;
  baseRadius: number;
  tropismStrength: number;
  bark: SpeciesDef['bark'];
  foliage: SpeciesDef['foliage'];
  scale: [number, number];
  variants: number;
}

/**
 * A deciduous tree: a bole with two low limbs forks into three leaders; each apex then bifurcates, throws a lateral
 * at the golden angle or just grows on, then ends in a twig spray, with leaf clusters at every node. The shape's
 * numbers make it a broad oak, a dense round walnut, a low fruit tree or a tall open plane.
 */
function broadleaf(o: BroadleafShape): SpeciesDef {
  const [l0, l1] = o.limbs;
  const [d0, d1] = o.leaders;
  const [a0, a1] = o.laterals;
  return {
    name: o.name,
    axiom: `!F(${o.bole})A(${o.lead},0)`,
    constants: { gold: 137.5 },
    rules: [
      {
        pred: 'A(l,k)',
        cond: 'k < 2',
        succ: `F(l)>(rnd(100,160))[&(rnd(${l0},${l1}))!!B(l*0.85,1)]!A(l*0.9,k+1)`,
      },
      {
        pred: 'A(l,k)',
        cond: 'k >= 2',
        succ:
          `F(l*0.8)[&(rnd(${d0},${d1}))!B(l*0.95,0)]>(rnd(110,130))[&(rnd(${d0},${d1}))!B(l*0.95,0)]` +
          `>(rnd(110,130))[&(rnd(${d0 * 0.7},${d1 * 0.75}))!B(l,0)]`,
      },
      {
        pred: 'B(l,o)',
        cond: 'o < 6',
        p: 0.5,
        succ: `F(l)L>(rnd(80,140))[&(rnd(${a0},${a1}))!B(l*rnd(0.72,0.84),o+1)][^(rnd(5,18))!B(l*rnd(0.82,0.92),o+1)]`,
      },
      {
        pred: 'B(l,o)',
        cond: 'o < 6',
        p: 0.35,
        succ: `F(l)L[&(rnd(${a0 + 15},${a1 + 22}))!!B(l*0.6,o+2)]>(gold)!B(l*0.9,o+1)`,
      },
      { pred: 'B(l,o)', cond: 'o < 6', p: 0.15, succ: 'F(l)L!B(l*0.94,o+1)' },
      {
        pred: 'B(l,o)',
        cond: 'o >= 6',
        succ: 'F(l*0.55)L[+(rnd(30,50))!F(l*0.4)L][-(rnd(30,50))!F(l*0.4)L]',
      },
    ],
    iterations: o.iterations,
    segmentCap: 1600,
    angle: 30,
    lengthScale: 1,
    baseRadius: o.baseRadius,
    radiusDecay: 0.8,
    tropism: [0, -1, 0],
    tropismStrength: o.tropismStrength,
    bark: o.bark,
    foliage: o.foliage,
    scale: o.scale,
    twigRadius: 0.048,
    maxBranchTriangles: 6000,
    maxSprites: 360,
    collisionRadius: 0.1,
    variants: o.variants,
  };
}

/** Shared by the bushes built with `shrub` below. */
interface ShrubShape {
  name: string;
  /** Stem length (m) at the root and how far the stems lean out from upright (deg). */
  stem: [number, number];
  lean: [number, number];
  /** Fork angle of the shoots (deg). */
  fork: [number, number];
  /** Generations of stems from the root (more = denser). */
  stems: number;
  baseRadius: number;
  foliage: SpeciesDef['foliage'];
  bark: SpeciesDef['bark'];
  scale: [number, number];
  variants: number;
}

/** A bush with no trunk: every iteration adds two stems of a different age from the root, which fork and arch out. */
function shrub(o: ShrubShape): SpeciesDef {
  const [s0, s1] = o.stem;
  const [e0, e1] = o.lean;
  const [f0, f1] = o.fork;
  return {
    name: o.name,
    axiom: 'A(0)',
    rules: [
      {
        pred: 'A(k)',
        cond: `k < ${o.stems}`,
        succ:
          `[&(rnd(${e0},${e1}))!B(rnd(${s0},${s1}),0)]>(rnd(50,95))` +
          `[&(rnd(${e0 + 8},${e1 + 6}))!B(rnd(${s0 * 0.88},${s1 * 0.9}),0)]>(rnd(60,100))A(k+1)`,
      },
      {
        pred: 'B(l,o)',
        cond: 'o < 4',
        p: 0.55,
        succ: `F(l)L[+(rnd(${f0},${f1}))!B(l*0.75,o+1)][-(rnd(${f0},${f1}))!B(l*0.75,o+1)]`,
      },
      {
        pred: 'B(l,o)',
        cond: 'o < 4',
        p: 0.45,
        succ: `F(l)L>(137.5)[&(rnd(${f0 + 5},${f1 + 5}))!B(l*0.7,o+1)]!B(l*0.9,o+1)`,
      },
      { pred: 'B(l,o)', cond: 'o >= 4', succ: 'F(l*0.7)L' },
    ],
    iterations: o.stems,
    segmentCap: 600,
    angle: 32,
    lengthScale: 1,
    baseRadius: o.baseRadius,
    radiusDecay: 0.85,
    tropism: [0, -1, 0],
    tropismStrength: 0.08,
    bark: o.bark,
    foliage: o.foliage,
    scale: o.scale,
    twigRadius: 0.015,
    maxBranchTriangles: 2000,
    maxSprites: 200,
    // Thicker than any stem: bushes are drive-through.
    collisionRadius: 0.12,
    variants: o.variants,
  };
}

/** Scots pine / spruce: a conical, layered conifer (the forest backbone). */
export const PINE: SpeciesDef = {
  name: 'Pine',
  // A straight leader A adds an internode and a whorl of five limbs per iteration; the limb apices B fork into
  // flat twig sprays (the needle clusters sit on the twigs) and droop under the gravity tropism, so the oldest
  // (lowest) whorls are the longest.
  axiom: '!F(0.8)A(0.95,0)',
  rules: [
    {
      pred: 'A(l,k)',
      succ:
        'F(l)L![&(rnd(70,88))!!!B(l*0.5,0)]>(rnd(64,80))[&(rnd(70,88))!!!B(l*0.48,0)]>(rnd(64,80))' +
        '[&(rnd(70,88))!!!B(l*0.5,0)]>(rnd(64,80))[&(rnd(70,88))!!!B(l*0.46,0)]>(rnd(64,80))' +
        '[&(rnd(70,88))!!!B(l*0.48,0)]>(rnd(15,45))A(l*rnd(0.93,0.98),k+1)',
    },
    {
      pred: 'B(l,o)',
      cond: 'o == 0',
      p: 0.6,
      succ: 'F(l)[+(rnd(38,55))!!!B(l*0.55,1)][-(rnd(38,55))!!!B(l*0.55,1)]!B(l*0.87,0)',
    },
    { pred: 'B(l,o)', cond: 'o == 0', p: 0.4, succ: 'F(l)!B(l*0.88,0)' },
    { pred: 'B(l,o)', cond: 'o == 1', succ: 'F(l)L!B(l*0.8,2)' },
    { pred: 'B(l,o)', cond: 'o == 2', succ: 'F(l)L' },
  ],
  iterations: 12,
  segmentCap: 1800,
  angle: 35,
  lengthScale: 1,
  baseRadius: 0.22,
  radiusDecay: 0.8,
  tropism: [0, -1, 0],
  tropismStrength: 0.08,
  bark: { color: '#5e4a3a', texture: 'furrowed', tiling: 1.2 },
  foliage: {
    kind: 'needles',
    spriteSize: 1.3,
    leaf: 'pine',
    palette: ['#2f4a26', '#355229', '#2a4322', '#3b5a2c'],
  },
  scale: [0.95, 1.35],
  twigRadius: 0.048,
  maxBranchTriangles: 6000,
  maxSprites: 400,
  collisionRadius: 0.1,
  variants: 6,
};

/**
 * Plantation pine: the pine's cone for the dense stands of a mountain forest, grown cheaper: four limbs to a whorl
 * and half the sprites, each larger (a pine stand costs about a third of the GPU time per tree).
 */
export const PLANTATION_PINE: SpeciesDef = {
  ...PINE,
  name: 'Plantation pine',
  rules: [
    {
      pred: 'A(l,k)',
      succ:
        'F(l)L![&(rnd(70,88))!!!B(l*0.5,0)]>(rnd(84,100))[&(rnd(70,88))!!!B(l*0.48,0)]>(rnd(84,100))' +
        '[&(rnd(70,88))!!!B(l*0.5,0)]>(rnd(84,100))[&(rnd(70,88))!!!B(l*0.46,0)]>(rnd(15,45))A(l*rnd(0.93,0.98),k+1)',
    },
    ...PINE.rules.slice(1),
  ],
  foliage: { ...PINE.foliage, spriteSize: 1.35 },
  scale: [1, 1.4],
  twigRadius: 0.045,
  maxBranchTriangles: 4000,
  maxSprites: 200,
  variants: 4,
};

/** Austrian black pine: a long straight trunk, bare but for dead stubs, under a flat umbrella of dark needle clumps. */
export const BLACK_PINE: SpeciesDef = {
  name: 'Black pine',
  // The leader A climbs with a dead stub at each step, then opens into five limbs that rise, spread and fork into
  // flat sprays; needle clumps only at the spray tips.
  axiom: '!F(1.6)A(1.3,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 5',
      succ: 'F(l)[&(rnd(70,90))!!!!!F(rnd(0.3,0.6))]>(rnd(110,160))A(l*0.96,k+1)',
    },
    {
      pred: 'A(l,k)',
      cond: 'k >= 5',
      succ:
        'F(l*0.5)[&(rnd(38,52))!!B(rnd(1.8,2.3),0)]>(rnd(66,78))[&(rnd(38,52))!!B(rnd(1.8,2.3),0)]>(rnd(66,78))' +
        '[&(rnd(38,52))!!B(rnd(1.8,2.3),0)]>(rnd(66,78))[&(rnd(38,52))!!B(rnd(1.8,2.3),0)]>(rnd(66,78))' +
        '[&(rnd(12,24))!!B(rnd(1.4,1.8),0)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 3',
      succ: 'F(l)[+(rnd(25,40))!B(l*0.62,o+1)][-(rnd(25,40))!B(l*0.62,o+1)]!B(l*0.7,o+1)',
    },
    {
      pred: 'B(l,o)',
      cond: 'o >= 3',
      succ: 'F(l*0.5)L[+(rnd(25,40))F(l*0.35)L][-(rnd(25,40))F(l*0.35)L]',
    },
  ],
  iterations: 10,
  segmentCap: 1600,
  angle: 30,
  lengthScale: 1,
  baseRadius: 0.24,
  radiusDecay: 0.8,
  tropism: [0, -1, 0],
  tropismStrength: 0.1,
  bark: { color: '#4a4039', texture: 'furrowed', tiling: 1.2 },
  foliage: {
    kind: 'needles',
    spriteSize: 1.5,
    leaf: 'pine',
    palette: ['#22341c', '#2a3d20', '#1f3019', '#2e4423'],
  },
  scale: [0.9, 1.2],
  twigRadius: 0.048,
  maxBranchTriangles: 6000,
  maxSprites: 400,
  collisionRadius: 0.1,
  variants: 4,
};

/** Juniper / cypress: a dark, narrow cone of short upswept limbs, 2-3.5 m; drive-through. */
export const JUNIPER: SpeciesDef = {
  name: 'Juniper',
  // A leader with two short limbs per step at the golden angle, shorter towards the top; an upward tropism keeps
  // the limbs close to the stem.
  axiom: 'A(0.3,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 10',
      succ:
        'F(l)L[&(rnd(28,42))!!B(rnd(0.5,0.75)*(1-k*0.08),0)]>(137.5)' +
        '[&(rnd(28,42))!!B(rnd(0.45,0.7)*(1-k*0.08),0)]>(137.5)!A(l*0.98,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 10', succ: 'F(l*0.6)L' },
    {
      pred: 'B(l,o)',
      cond: 'o < 2',
      succ: 'F(l)L[+(rnd(25,35))!B(l*0.6,o+1)]!B(l*0.7,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 2', succ: 'F(l*0.6)L' },
  ],
  iterations: 11,
  segmentCap: 600,
  angle: 30,
  lengthScale: 1,
  baseRadius: 0.07,
  radiusDecay: 0.85,
  tropism: [0, 1, 0],
  tropismStrength: 0.12,
  bark: { color: '#5a4636', texture: 'furrowed', tiling: 1.5 },
  foliage: {
    kind: 'needles',
    spriteSize: 0.5,
    leaf: 'juniper',
    palette: ['#24361f', '#2b3f26', '#1f2f1c', '#2f4129'],
  },
  scale: [0.85, 1.2],
  twigRadius: 0.012,
  maxBranchTriangles: 2000,
  maxSprites: 200,
  collisionRadius: 0.12,
  variants: 4,
};

/** Oak / field tree: broad and irregular, for woods, hedgerows, gullies and village edges. */
export const OAK = broadleaf({
  name: 'Oak',
  bole: 1.4,
  lead: 1.1,
  limbs: [40, 55],
  leaders: [22, 34],
  laterals: [25, 40],
  iterations: 10,
  baseRadius: 0.28,
  tropismStrength: 0.05,
  bark: { color: '#544c43', texture: 'furrowed', tiling: 0.8 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.7,
    leaf: 'lobed',
    palette: ['#465f28', '#52702f', '#3f5824', '#5a7832', '#4c682b'],
  },
  scale: [0.9, 1.3],
  variants: 6,
});

/** Mountain beech (Galichica): tall straight smooth pale-grey trunk under a dense rounded crown turning bronze. */
export const BEECH = broadleaf({
  name: 'Beech',
  bole: 2.6,
  lead: 1.2,
  limbs: [38, 50],
  leaders: [20, 30],
  laterals: [24, 38],
  iterations: 10,
  baseRadius: 0.3,
  tropismStrength: 0.05,
  bark: { color: '#9c9c94', texture: 'smooth', tiling: 0.8 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.8,
    leaf: 'ovate',
    palette: ['#5c8a2a', '#6a9830', '#77a336', '#527e26'],
  },
  scale: [0.95, 1.25],
  variants: 4,
});

/**
 * Oriental hornbeam / oak coppice (Galichica's low and mid slopes): two or three slender smooth grey stems from one
 * stool, short upswept limbs, a narrow crown of small bright-green leaves; 6-12 m, in dense stands.
 */
export const HORNBEAM = broadleaf({
  name: 'Hornbeam',
  bole: 0.5,
  lead: 1.5,
  limbs: [18, 28],
  leaders: [14, 24],
  laterals: [32, 50],
  iterations: 10,
  baseRadius: 0.15,
  tropismStrength: 0.03,
  bark: { color: '#8c8a80', texture: 'smooth', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.65,
    leaf: 'serrate',
    palette: ['#74a42e', '#82b236', '#68982a', '#8fbc40', '#5c8a26'],
  },
  scale: [0.85, 1.3],
  variants: 6,
});

/** Walnut / mulberry yard tree: a thick short trunk under a big, dense, dark round crown. */
export const WALNUT = broadleaf({
  name: 'Walnut',
  bole: 1.8,
  lead: 1.2,
  limbs: [50, 65],
  leaders: [32, 46],
  laterals: [30, 48],
  iterations: 10,
  baseRadius: 0.38,
  tropismStrength: 0.06,
  bark: { color: '#6a645a', texture: 'furrowed', tiling: 0.8 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.9,
    leaf: 'round',
    palette: ['#36501f', '#3d5823', '#42602a', '#334a1d'],
  },
  scale: [0.95, 1.2],
  variants: 4,
});

/** Orchard / garden fruit tree (apple, plum): a short trunk and a low, wide, round crown. */
export const FRUIT_TREE: SpeciesDef = {
  ...broadleaf({
    name: 'Fruit tree',
    bole: 0.9,
    lead: 0.7,
    limbs: [50, 65],
    leaders: [38, 52],
    laterals: [30, 50],
    iterations: 9,
    baseRadius: 0.14,
    tropismStrength: 0.07,
    bark: { color: '#5b5046', texture: 'furrowed', tiling: 1.2 },
    foliage: {
      kind: 'broadleaf',
      spriteSize: 1.1,
      leaf: 'round',
      palette: ['#56752f', '#5f7f35', '#4d6a2a', '#68863a'],
    },
    scale: [0.9, 1.15],
    variants: 4,
  }),
  maxBranchTriangles: 4000,
  maxSprites: 400,
};

/** Plane / ash: a long grey-white trunk and an open, yellow-green crown (country lanes). */
export const PLANE = broadleaf({
  name: 'Plane',
  bole: 3.6,
  lead: 1.4,
  limbs: [30, 42],
  leaders: [16, 26],
  laterals: [22, 36],
  iterations: 10,
  baseRadius: 0.3,
  tropismStrength: 0.04,
  bark: { color: '#bdb8ac', texture: 'smooth', tiling: 0.6 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.6,
    leaf: 'lobed',
    palette: ['#7f9a3e', '#8ca646', '#74903a', '#97a84a'],
  },
  scale: [0.95, 1.2],
  variants: 4,
});

/** Birch: a slender white trunk to the top, short climbing limbs with drooping twigs, a light airy crown. */
export const BIRCH: SpeciesDef = {
  name: 'Birch',
  // One leader to the top (no fork), a limb at the golden angle per step, shorter higher up; the twigs hang.
  axiom: '!F(1.6)A(0.9,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 9',
      succ: 'F(l)L[&(rnd(38,58))!!!B(l*(1.6-k*0.13),0)]>(137.5)A(l*0.96,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 9', succ: 'F(l*0.6)L' },
    {
      pred: 'B(l,o)',
      cond: 'o < 3',
      succ: 'F(l)L[T(0.22)&(rnd(25,45))!B(l*0.6,o+1)]>(137.5)[T(0.22)&(rnd(25,45))!B(l*0.55,o+1)]!B(l*0.75,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 3', succ: 'F(l*0.5)L' },
  ],
  iterations: 12,
  segmentCap: 1400,
  angle: 30,
  lengthScale: 1,
  baseRadius: 0.17,
  radiusDecay: 0.8,
  tropism: [0, -1, 0],
  tropismStrength: 0.03,
  bark: { color: '#dad6cc', texture: 'smooth', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.1,
    leaf: 'small',
    palette: ['#6a8a3a', '#78963f', '#5f7f34', '#829e44'],
  },
  scale: [0.9, 1.2],
  twigRadius: 0.04,
  maxBranchTriangles: 5000,
  maxSprites: 360,
  collisionRadius: 0.1,
  variants: 4,
};

/** Elm / ash sapling: slender, its crown taller than wide, starting to yellow. */
export const SAPLING: SpeciesDef = {
  ...BIRCH,
  name: 'Sapling',
  axiom: '!F(1.0)A(0.55,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 9',
      succ: 'F(l)L[&(rnd(25,40))!!!B(l*(1.3-k*0.1),0)]>(137.5)A(l*0.97,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 9', succ: 'F(l*0.6)L' },
    {
      pred: 'B(l,o)',
      cond: 'o < 3',
      succ: 'F(l)L[&(rnd(20,35))!B(l*0.6,o+1)]>(137.5)!B(l*0.75,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 3', succ: 'F(l*0.5)L' },
  ],
  baseRadius: 0.1,
  bark: { color: '#6d6457', texture: 'smooth', tiling: 1.2 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1,
    leaf: 'ovate',
    palette: ['#8a9a3a', '#9aa640', '#7b8f36', '#a8a848'],
  },
  scale: [0.9, 1.15],
  maxBranchTriangles: 3000,
  maxSprites: 400,
  // Slender, but a trunk you hit.
  collisionRadius: 0.06,
};

/** Lombardy poplar: tall and columnar, short upswept limbs hugging the trunk (canals, roads, field edges). */
export const POPLAR: SpeciesDef = {
  name: 'Poplar',
  // A leader with a short limb per step at the golden angle; the upward tropism turns every limb skywards.
  axiom: '!F(1.0)A(1.05,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 15',
      succ: 'F(l)L[&(rnd(20,32))!!!B(rnd(0.9,1.5)*(1.05-k*0.045),0)]>(137.5)A(l*0.985,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 15', succ: 'F(l*0.7)L' },
    {
      pred: 'B(l,o)',
      cond: 'o < 2',
      succ: 'F(l)L[+(rnd(18,28))!B(l*0.6,o+1)][-(rnd(18,28))!B(l*0.55,o+1)]!B(l*0.7,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 2', succ: 'F(l*0.5)L' },
  ],
  iterations: 16,
  segmentCap: 1400,
  angle: 25,
  lengthScale: 1,
  baseRadius: 0.3,
  radiusDecay: 0.82,
  tropism: [0, 1, 0],
  tropismStrength: 0.14,
  bark: { color: '#6b665c', texture: 'furrowed', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.3,
    leaf: 'round',
    palette: ['#4f6e2c', '#5a7a32', '#47652a', '#62823a'],
  },
  scale: [0.95, 1.25],
  twigRadius: 0.048,
  maxBranchTriangles: 5000,
  maxSprites: 360,
  // The trunk alone: its many short limbs stay out of the physics.
  collisionRadius: 0.17,
  variants: 4,
};

/** Weeping willow: a short thick trunk, limbs arching out and long pale curtains of hanging shoots (canals, drains). */
export const WILLOW: SpeciesDef = {
  name: 'Willow',
  // Three limbs arch up and out and fork; every fork and limb end lets fall hanging shoots (B with o >= 10) whose
  // strong downward tropism pulls them into curtains, leaves all along them.
  axiom: '!F(2.0)A(1.4)',
  rules: [
    {
      pred: 'A(l)',
      succ:
        'F(l*0.6)[&(rnd(35,50))!!B(l*1.1,0)]>(rnd(110,130))[&(rnd(35,50))!!B(l*1.1,0)]' +
        '>(rnd(110,130))[&(rnd(18,30))!!B(l*1.2,0)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 3',
      succ:
        'F(l)[&(rnd(22,36))!B(l*0.8,o+1)]>(rnd(100,140))[^(rnd(4,14))!B(l*0.85,o+1)]' +
        '>(rnd(60,90))[T(0.5)&(rnd(60,85))!!B(0.6,11)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o >= 3 && o < 10',
      succ: 'F(l*0.6)[T(0.5)&(70)!B(0.6,10)][T(0.5)^(70)!B(0.6,10)][T(0.5)+(70)!B(0.55,10)]',
    },
    // Shoots stop a few metres down, above the ground.
    { pred: 'B(l,o)', cond: 'o >= 10 && o < 15', succ: 'F(l)L!B(l*0.97,o+1)' },
    { pred: 'B(l,o)', cond: 'o >= 15', succ: 'F(l*0.5)L' },
  ],
  iterations: 12,
  segmentCap: 1600,
  angle: 30,
  lengthScale: 1,
  baseRadius: 0.36,
  radiusDecay: 0.8,
  tropism: [0, -1, 0],
  tropismStrength: 0.03,
  bark: { color: '#5d554a', texture: 'furrowed', tiling: 0.9 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 0.9,
    leaf: 'narrow',
    palette: ['#8ea24e', '#9cb05a', '#829a48', '#a6b864'],
  },
  scale: [0.9, 1.15],
  twigRadius: 0.032,
  maxBranchTriangles: 6000,
  maxSprites: 360,
  collisionRadius: 0.1,
  variants: 4,
};

/** Low leafy roadside shrub; drive-through. */
export const BUSH = shrub({
  name: 'Bush',
  stem: [0.4, 0.55],
  lean: [10, 34],
  fork: [25, 45],
  stems: 6,
  baseRadius: 0.035,
  bark: { color: '#5a4a3a', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 0.85,
    leaf: 'small',
    palette: ['#45602a', '#3e5826', '#52702f', '#4a5f2a'],
  },
  scale: [0.8, 1.3],
  variants: 6,
});

/** Mediterranean hill scrub (juniper / blackthorn): dark olive, low and wide; drive-through. */
export const SCRUB = shrub({
  name: 'Scrub',
  stem: [0.3, 0.45],
  lean: [38, 58],
  fork: [30, 50],
  stems: 6,
  baseRadius: 0.03,
  bark: { color: '#4c4036', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 0.75,
    leaf: 'small',
    palette: ['#4a5230', '#535b34', '#434a2b', '#5a6038'],
  },
  scale: [0.85, 1.2],
  variants: 6,
});

/** Plantation hazelnut: a multi-stemmed bush, upright, with a low wide fresh-green crown, 3-4 m. */
export const HAZEL = shrub({
  name: 'Hazel',
  stem: [0.75, 1.0],
  lean: [8, 24],
  fork: [22, 38],
  stems: 6,
  baseRadius: 0.05,
  bark: { color: '#6b5a48', texture: 'smooth', tiling: 1.2 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.1,
    leaf: 'serrate',
    palette: ['#5f8a34', '#6a953a', '#557d2f', '#73a040'],
  },
  scale: [0.9, 1.15],
  variants: 4,
});

/** Hawthorn / blackthorn / elm-sucker thicket in autumn colours, 2.5-4.5 m; drive-through brush. */
export const THICKET = shrub({
  name: 'Thicket',
  stem: [0.65, 0.85],
  lean: [12, 32],
  fork: [28, 46],
  stems: 6,
  baseRadius: 0.04,
  bark: { color: '#4f4035', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1,
    leaf: 'small',
    palette: ['#8a6a2a', '#9a5a26', '#6f6a2c', '#a27a30', '#5d6a2a'],
  },
  scale: [0.85, 1.2],
  variants: 4,
});

/** Flowering broom (Cytisus / Spartium) on the road cuttings: upright green switches covered in yellow, 1-2 m. */
export const BROOM = shrub({
  name: 'Broom',
  stem: [0.38, 0.5],
  lean: [6, 22],
  fork: [16, 30],
  stems: 6,
  baseRadius: 0.025,
  bark: { color: '#55603a', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 0.6,
    leaf: 'narrow',
    palette: ['#e2c22a', '#d6b220', '#ecd23e', '#6e8e2c', '#e8c62e'],
  },
  scale: [0.8, 1.2],
  variants: 4,
});

/** Mediterranean cypress: a tall, dark, narrow column of short limbs close to the stem (churchyards, slopes), 8-12 m. */
export const CYPRESS: SpeciesDef = {
  name: 'Cypress',
  // The poplar's leader with a short limb per step at the golden angle, dark needles and a shorter, fuller column.
  axiom: '!F(0.8)A(0.7,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 14',
      succ: 'F(l)L[&(rnd(14,24))!!!B(rnd(0.5,0.85)*(1.05-k*0.045),0)]>(137.5)A(l*0.985,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 14', succ: 'F(l*0.7)L' },
    {
      pred: 'B(l,o)',
      cond: 'o < 2',
      succ: 'F(l)L[+(rnd(15,25))!B(l*0.6,o+1)][-(rnd(15,25))!B(l*0.55,o+1)]!B(l*0.7,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 2', succ: 'F(l*0.5)L' },
  ],
  iterations: 16,
  segmentCap: 1400,
  angle: 22,
  lengthScale: 1,
  baseRadius: 0.22,
  radiusDecay: 0.82,
  tropism: [0, 1, 0],
  tropismStrength: 0.16,
  bark: { color: '#5b4b3d', texture: 'furrowed', tiling: 1.2 },
  foliage: {
    kind: 'needles',
    spriteSize: 0.95,
    leaf: 'juniper',
    palette: ['#1f3a22', '#254429', '#1b3320', '#2a4a2d'],
  },
  scale: [0.85, 1.25],
  twigRadius: 0.02,
  maxBranchTriangles: 4000,
  maxSprites: 400,
  // The trunk alone: its many short limbs stay out of the physics.
  collisionRadius: 0.14,
  variants: 4,
};

/** Black locust (acacia): a street and garden tree of Skopje, a tall open crown of light feathery leaves, 9-14 m. */
export const LOCUST = broadleaf({
  name: 'Locust',
  bole: 2.4,
  lead: 1.3,
  limbs: [28, 40],
  leaders: [18, 30],
  laterals: [24, 38],
  iterations: 10,
  baseRadius: 0.2,
  tropismStrength: 0.04,
  bark: { color: '#463d35', texture: 'furrowed', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.15,
    leaf: 'small',
    palette: ['#7a9a3c', '#86a644', '#6f8f36', '#93b04c', '#7fa03e'],
  },
  scale: [0.85, 1.2],
  variants: 4,
});

/** Bramble and wild rose along the forest edge and the verges: a low arching tangle of green canes, 0.8-1.4 m. */
export const BRAMBLE = shrub({
  name: 'Bramble',
  stem: [0.35, 0.5],
  lean: [48, 70],
  fork: [28, 46],
  stems: 7,
  baseRadius: 0.02,
  bark: { color: '#4e5a34', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 0.7,
    leaf: 'serrate',
    palette: ['#3f6a2a', '#4b7830', '#36601f', '#567f33'],
  },
  scale: [0.85, 1.3],
  variants: 4,
});

export const SPECIES: readonly SpeciesDef[] = [
  PINE,
  PLANTATION_PINE,
  BLACK_PINE,
  JUNIPER,
  OAK,
  BEECH,
  HORNBEAM,
  WALNUT,
  FRUIT_TREE,
  PLANE,
  BIRCH,
  SAPLING,
  POPLAR,
  WILLOW,
  BUSH,
  SCRUB,
  HAZEL,
  THICKET,
  BROOM,
  CYPRESS,
  LOCUST,
  BRAMBLE,
];

const byName = new Map(SPECIES.map((s) => [s.name, s]));

export function getSpecies(name: string): SpeciesDef {
  const s = byName.get(name);
  if (!s) throw new Error(`Unknown tree species "${name}" (trees/species.ts)`);
  return s;
}

/**
 * The tree types the maps place (scatter / roadside / props `asset` ids), each grown as the species its map
 * description names (spec trees/Species.md#types): a pine looks like a pine, a poplar like a poplar.
 */
export const TREE_TYPES: Readonly<Record<string, string>> = {
  pine_tree: 'Pine',
  plantation_pine: 'Plantation pine',
  black_pine: 'Black pine',
  juniper: 'Juniper',
  oak_tree: 'Oak',
  beech_tree: 'Beech',
  hornbeam_tree: 'Hornbeam',
  walnut_tree: 'Walnut',
  fruit_tree: 'Fruit tree',
  pale_tree: 'Plane',
  birch_tree: 'Birch',
  young_tree: 'Sapling',
  poplar_tree: 'Poplar',
  willow_tree: 'Willow',
  bush: 'Bush',
  scrub_bush: 'Scrub',
  hazelnut_tree: 'Hazel',
  thicket_shrub: 'Thicket',
  broom_shrub: 'Broom',
  cypress_tree: 'Cypress',
  locust_tree: 'Locust',
  bramble_shrub: 'Bramble',
};

export function isTreeType(asset: string): boolean {
  return Object.prototype.hasOwnProperty.call(TREE_TYPES, asset);
}

/** Species of a placed tree type. */
export function speciesOfType(asset: string): SpeciesDef {
  return getSpecies(TREE_TYPES[asset]);
}

export function lodOf(s: SpeciesDef): LodSettings {
  return { ...DEFAULT_LOD, ...s.lod };
}

export function variantCount(s: SpeciesDef): number {
  return s.variants ?? 8;
}

/** JSON with sorted keys: the same definition always hashes the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(v);
}

const hashes = new WeakMap<SpeciesDef, number>();

/** Content hash of a species definition: any change gives new variants and invalidates cached ones. */
export function speciesHash(s: SpeciesDef): number {
  let h = hashes.get(s);
  if (h === undefined) hashes.set(s, (h = hashText(stable(s))));
  return h;
}
