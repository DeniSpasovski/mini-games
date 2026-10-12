import { hashText } from './math';

/**
 * Tree species: DATA the tree code reads (spec: trees/Species.md), so adding or tuning a kind of tree changes no
 * code. Rules use the grammar of trees/grammar.ts (alphabet F f A B + - & ^ < > | ! [ ] L, parameters in brackets,
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
 * Trees closer than this (m) are always LOD0 with every sprite at full size, whatever their screen height, the field
 * of view or the quality setting (trees/Lod.md#selection): a player near a tree only ever sees it at full detail.
 */
export const FULL_DETAIL_DISTANCE = 60;

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
    /** Leaves (or sprays) per cluster image of the atlas, relative to the default. */
    density: number;
    palette: string[];
  };
  lod?: Partial<LodSettings>;
  /** Instance scale range. */
  scale: [number, number];
  /** Branches thinner than this (m) are left out: the foliage sprites cover them (trees/Lod.md#levels). */
  twigRadius: number;
  /** Most LOD0 branch triangles (6,000; shrubs 2,000) and sprites per crown (600; shrubs 200). */
  maxBranchTriangles: number;
  maxSprites: number;
  /** Trunk / first-order limb segments at least this thick (m) collide (trees/Placement.md#collision). */
  collisionRadius: number;
  /** Pre-generated variants (default 8). */
  variants?: number;
}

export const CONIFER: SpeciesDef = {
  name: 'Conifer',
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
    density: 1,
    palette: ['#2f4a26', '#355229', '#2a4322', '#3b5a2c'],
  },
  scale: [0.85, 1.35],
  twigRadius: 0.03,
  maxBranchTriangles: 6000,
  maxSprites: 600,
  collisionRadius: 0.1,
};

export const BROADLEAF: SpeciesDef = {
  name: 'Broadleaf',
  // A short bole with two low limbs forks into three leaders; each apex then bifurcates, throws a lateral at the
  // golden angle or just grows on, then ends in a twig spray, with leaf clusters at every node: an open, rounded
  // crown.
  axiom: '!F(1.4)A(1.1,0)',
  constants: { gold: 137.5 },
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 2',
      succ: 'F(l)>(rnd(100,160))[&(rnd(40,55))!!B(l*0.85,1)]!A(l*0.9,k+1)',
    },
    {
      pred: 'A(l,k)',
      cond: 'k >= 2',
      succ:
        'F(l*0.8)[&(rnd(22,34))!B(l*0.95,0)]>(rnd(110,130))[&(rnd(22,34))!B(l*0.95,0)]' +
        '>(rnd(110,130))[&(rnd(16,26))!B(l,0)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 6',
      p: 0.5,
      succ: 'F(l)L>(rnd(80,140))[&(rnd(25,40))!B(l*rnd(0.72,0.84),o+1)][^(rnd(5,18))!B(l*rnd(0.82,0.92),o+1)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 6',
      p: 0.35,
      succ: 'F(l)L[&(rnd(40,62))!!B(l*0.6,o+2)]>(gold)!B(l*0.9,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o < 6', p: 0.15, succ: 'F(l)L!B(l*0.94,o+1)' },
    {
      pred: 'B(l,o)',
      cond: 'o >= 6',
      succ: 'F(l*0.55)L[+(rnd(30,50))!F(l*0.4)L][-(rnd(30,50))!F(l*0.4)L]',
    },
  ],
  iterations: 10,
  segmentCap: 1600,
  angle: 30,
  lengthScale: 1,
  baseRadius: 0.28,
  radiusDecay: 0.8,
  tropism: [0, -1, 0],
  tropismStrength: 0.05,
  bark: { color: '#544c43', texture: 'smooth', tiling: 0.8 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 1.7,
    density: 1,
    palette: ['#4d6b2e', '#5a7a34', '#46642a', '#62813a', '#557230'],
  },
  scale: [0.85, 1.4],
  twigRadius: 0.03,
  maxBranchTriangles: 6000,
  maxSprites: 600,
  collisionRadius: 0.1,
};

export const SHRUB: SpeciesDef = {
  name: 'Shrub',
  // No trunk: every iteration A adds two stems of a different age from the root, which fork and arch outwards.
  axiom: 'A(0)',
  rules: [
    {
      pred: 'A(k)',
      cond: 'k < 6',
      succ: '[&(rnd(10,34))!B(rnd(0.4,0.55),0)]>(rnd(50,95))[&(rnd(18,40))!B(rnd(0.35,0.5),0)]>(rnd(60,100))A(k+1)',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 4',
      p: 0.55,
      succ: 'F(l)L[+(rnd(25,45))!B(l*0.75,o+1)][-(rnd(25,45))!B(l*0.75,o+1)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 4',
      p: 0.45,
      succ: 'F(l)L>(137.5)[&(rnd(30,50))!B(l*0.7,o+1)]!B(l*0.9,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 4', succ: 'F(l*0.7)L' },
  ],
  iterations: 6,
  segmentCap: 600,
  angle: 32,
  lengthScale: 1,
  baseRadius: 0.035,
  radiusDecay: 0.85,
  tropism: [0, -1, 0],
  tropismStrength: 0.08,
  bark: { color: '#5a4a3a', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    spriteSize: 0.85,
    density: 1.2,
    palette: ['#45602a', '#3e5826', '#52702f', '#4a5f2a'],
  },
  scale: [0.8, 1.5],
  twigRadius: 0.015,
  maxBranchTriangles: 2000,
  maxSprites: 200,
  collisionRadius: 0.12,
};

export const SPECIES: readonly SpeciesDef[] = [CONIFER, BROADLEAF, SHRUB];

const byName = new Map(SPECIES.map((s) => [s.name, s]));

export function getSpecies(name: string): SpeciesDef {
  const s = byName.get(name);
  if (!s) throw new Error(`Unknown tree species "${name}" (trees/species.ts)`);
  return s;
}

/**
 * The tree types the maps place (scatter / roadside / props `asset` ids), each grown as the species that resembles
 * it. Map data keeps using these ids; nothing else about the old tree assets remains.
 */
export const TREE_TYPES: Readonly<Record<string, string>> = {
  pine_tree: 'Conifer',
  black_pine: 'Conifer',
  birch_tree: 'Broadleaf',
  oak_tree: 'Broadleaf',
  walnut_tree: 'Broadleaf',
  willow_tree: 'Broadleaf',
  pale_tree: 'Broadleaf',
  young_tree: 'Broadleaf',
  poplar_tree: 'Broadleaf',
  fruit_tree: 'Broadleaf',
  hazelnut_tree: 'Shrub',
  juniper: 'Shrub',
  bush: 'Shrub',
  scrub_bush: 'Shrub',
  thicket_shrub: 'Shrub',
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
