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
 * Trees closer than this (m) are never the impostor, whatever the quality setting: its bake is a few dozen pixels tall,
 * which reads as a dithered blob up close (medium brings the impostor in to about 50 m for a small tree). They stay LOD1
 * with thinned sprites (trees/Lod.md#selection).
 */
export const IMPOSTOR_FROM = 80;

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

/** Bark detail tile: 'furrowed' is a scanned oak bark, 'smooth' a procedural one (birch, shrubs). */
export type BarkTexture = 'furrowed' | 'smooth';
/** A species' own scanned bark tile (trees/bark/, scripts/trees/bake-bark.py) in place of its `texture`. */
export type BarkScan =
  'pine' | 'beech' | 'plane' | 'willow' | 'cedar' | 'birch';
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
  /** Radius of a shoot where it ends in its leaves (m; trees/skeleton.ts `TIP_RADIUS`): the pipe model's thinnest. */
  tipRadius?: number;
  /** Heading bends towards this vector after every segment, by `tropismStrength`. */
  tropism: [number, number, number];
  tropismStrength: number;
  bark: {
    /** Measured albedo of the grown bark (trees/Species.md#types). */
    color: string;
    texture: BarkTexture;
    /** Own tile (a scan, or birch's procedural one) in place of `texture`. */
    scan?: BarkScan;
    /** Young shoots' bark (default `TWIG_BARK`): a branch turns from it to `color` as it thickens (trees/mesh.ts). */
    twig?: string;
    /** The trunk's foot below `height` m: birch's black fissured base. */
    foot?: { color: string; height: number };
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
    /**
     * Season colours (trees/seasons.ts). With `turn` the palette is a ramp from the least to the most turned leaf
     * (summer: shade leaf to sun leaf): each variant stands at its own stage on it (`stage`, default 0.5, +-
     * `stages`), a crown's outer, upper leaves `turn` further along (negative: the inner ones). `hueSpread`: trees
     * differ in hue this many times the summer's.
     */
    turn?: number;
    stage?: number;
    stages?: number;
    hueSpread?: number;
    /** Season leaf cover (trees/seasons.ts): the share of leaf points that still carry a sprite and their size (default 1). */
    leafy?: number;
    leafSize?: number;
  };
  lod?: Partial<LodSettings>;
  /** Instance scale range. */
  scale: [number, number];
  /** Branches thinner than this (m) are left out: the foliage sprites cover them (trees/Lod.md#levels). */
  twigRadius: number;
  /** Most LOD0 branch triangles (2,500; poplar 3,000, willow 12,000; shrubs 1,400) and leaf points with foliage per crown (broadleaf 360, conifers 400; shrubs 200; a spray is two leaf cards). */
  maxBranchTriangles: number;
  maxSprites: number;
  /** Trunk / first-order limb segments at least this thick (m) collide (trees/Placement.md#collision). */
  collisionRadius: number;
  /** Pre-generated variants (default 8). */
  variants?: number;
  /** How much sky a closed stand's canopy takes from the wood under it and the crown's underside (0..1, trees/mesh.ts
   * `occlusion`); not part of the variant seed, so it keeps the same trees. */
  shade?: number;
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
  shade?: number;
  /** Random bend per limb internode (deg, default 0): an oak's crooked limbs. */
  crook?: number;
  /**
   * Limb generations that carry leaves: from this one on (default 0, every one). Later = the inner limbs stand bare in
   * the crown's shade, so the foliage breaks into clumps round the limb ends and the limbs show between them.
   */
  leafFrom?: number;
  /** Stems from one stool (default 1: a single trunk), each leaning out a little: a coppiced hornbeam. */
  stems?: number;
}

/**
 * A deciduous tree: a bole with two low limbs forks into three leaders; each apex then bifurcates, throws a lateral
 * at the golden angle or just grows on, then ends in a twig spray, with leaf clusters at every node (from `leafFrom`).
 * The shape's numbers make it a broad crooked oak, a dense round walnut, a low fruit tree, a tall open plane or a
 * coppiced hornbeam.
 */
function broadleaf(o: BroadleafShape): SpeciesDef {
  const [l0, l1] = o.limbs;
  const [d0, d1] = o.leaders;
  const [a0, a1] = o.laterals;
  const c = crook(o.crook ?? 0);
  const from = o.leafFrom ?? 0;
  const stems = o.stems ?? 1;
  let axiom = `!F(${o.bole})A(${o.lead},0)`;
  if (stems > 1) {
    axiom = '';
    for (let i = 0; i < stems; i++)
      axiom += `[>(${((i * 360) / stems).toFixed(1)}+rnd(-25,25))&(rnd(5,11))!F(${o.bole}*rnd(0.8,1.1))A(${o.lead}*0.85,0)]`;
  }
  // The limb rules, with leaves (generation >= from) and without.
  const limbs = (cond: string, L: string): RuleDef[] => [
    {
      pred: 'B(l,o)',
      cond,
      p: 0.5,
      succ: `${c}F(l)${L}>(rnd(80,140))[&(rnd(${a0},${a1}))!B(l*rnd(0.72,0.84),o+1)][^(rnd(5,18))!B(l*rnd(0.82,0.92),o+1)]`,
    },
    {
      pred: 'B(l,o)',
      cond,
      p: 0.35,
      succ: `${c}F(l)${L}[&(rnd(${a0 + 15},${a1 + 22}))!!B(l*0.6,o+2)]>(gold)!B(l*0.9,o+1)`,
    },
    { pred: 'B(l,o)', cond, p: 0.15, succ: `${c}F(l)${L}!B(l*0.94,o+1)` },
  ];
  return {
    name: o.name,
    axiom,
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
      ...(from > 0 ? limbs(`o < ${Math.min(from, 6)}`, '') : []),
      ...limbs(from > 0 ? `o >= ${from} && o < 6` : 'o < 6', 'L'),
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
    twigRadius: 0.009,
    maxBranchTriangles: 2500,
    maxSprites: 360,
    collisionRadius: 0.1,
    variants: o.variants,
    shade: o.shade,
  };
}

/**
 * A random bend before a segment (deg): `+(rnd(-c,c))^(rnd(-c,c))`, so limbs and stems wander instead of running dead
 * straight (no roll: the side shoots keep their spread).
 */
const crook = (c: number) =>
  c > 0 ? `+(rnd(${-c},${c}))^(rnd(${-c},${c}))` : '';

/** Shared by the bushes built with `shrub` below. */
interface ShrubShape {
  name: string;
  /** Stems from the stool, and the stool's radius (m): they rise from a patch of ground, not one point. */
  stems: number;
  stool: number;
  /** First internode of the centre stems and of the rim ones (m). */
  stem: [number, number];
  /** Lean from upright of the centre stems and of the rim ones (deg): upright inside, leaning out at the rim. */
  lean: [number, number];
  /** Angle of the side shoots (deg). */
  fork: [number, number];
  /** Internodes a stem grows. */
  depth: number;
  /** How hard the stems arch over under their weight (tropism, default 0.08: bramble canes bow to the ground). */
  arch?: number;
  /** Random bend per internode (deg, default 8). */
  crook?: number;
  baseRadius: number;
  foliage: SpeciesDef['foliage'];
  bark: SpeciesDef['bark'];
  scale: [number, number];
  variants: number;
}

/**
 * A bush with no trunk (trees/Species.md#types): `stems` stems rise from a stool, spread evenly round it (golden
 * angle), upright and tall in the centre, shorter and leaning out at the rim, so the crown is a dome whose rim reaches
 * the ground. They all grow `depth` internodes, each with a leaf cluster and a side shoot, a leafy spur or a fork.
 */
function shrub(o: ShrubShape): SpeciesDef {
  const [s0, s1] = o.stem;
  const [e0, e1] = o.lean;
  const [f0, f1] = o.fork;
  const c = crook(o.crook ?? 8);
  const f = (n: number) => n.toFixed(3);
  let axiom = '';
  for (let i = 0; i < o.stems; i++) {
    // Centre -> rim; sqrt spreads the stems evenly over the stool's area.
    const t = (i + 0.5) / o.stems;
    const lean = e0 + (e1 - e0) * t;
    const len = s0 + (s1 - s0) * t;
    axiom +=
      `[>(${f(i * 137.5)})&(90)f(${f(o.stool * Math.sqrt(t))})^(90)` +
      `&(rnd(${f(lean * 0.85)},${f(lean * 1.15 + 2)}))!B(rnd(${f(len * 0.9)},${f(len * 1.1)}),0)]`;
  }
  return {
    name: o.name,
    axiom,
    rules: [
      {
        pred: 'B(l,o)',
        cond: `o < ${o.depth}`,
        p: 0.45,
        succ: `${c}F(l)L[+(rnd(${f0},${f1}))!B(l*0.72,o+1)]>(137.5)!B(l*0.9,o+1)`,
      },
      {
        pred: 'B(l,o)',
        cond: `o < ${o.depth}`,
        p: 0.35,
        succ: `${c}F(l)L[+(rnd(${f0},${f1}))F(l*0.45)L]>(137.5)!B(l*0.92,o+1)`,
      },
      {
        pred: 'B(l,o)',
        cond: `o < ${o.depth}`,
        p: 0.2,
        succ: `${c}F(l)L[+(rnd(${f0},${f1}))!B(l*0.75,o+1)][-(rnd(${f0},${f1}))!B(l*0.75,o+1)]`,
      },
      { pred: 'B(l,o)', cond: `o >= ${o.depth}`, succ: 'F(l*0.6)L' },
    ],
    iterations: o.depth + 1,
    segmentCap: 900,
    angle: 32,
    lengthScale: 1,
    baseRadius: o.baseRadius,
    radiusDecay: 0.85,
    tropism: [0, -1, 0],
    tropismStrength: o.arch ?? 0.08,
    bark: o.bark,
    foliage: o.foliage,
    scale: o.scale,
    // The thinnest twigs are left out: the leaves cover them (they streak across a bush's surface).
    tipRadius: 0.003,
    twigRadius: 0.006,
    maxBranchTriangles: 1400,
    maxSprites: 200,
    // Thicker than any stem: bushes are drive-through.
    collisionRadius: 0.12,
    variants: o.variants,
  };
}

/** Shared by the conifers built with `conifer` below. */
interface ConiferShape {
  name: string;
  /** Bare trunk under the crown (m), with dead stubs on it (a self-pruned stem). */
  bole: number;
  /** Whorls of the crown, the trunk's growth between them (m) and its shrink per whorl. */
  whorls: number;
  step: number;
  taper: number;
  /** Limbs per whorl. */
  perWhorl: number;
  /**
   * Limb length (m) at the crown's foot, and how it changes up the crown (t 0 = foot .. 1 = top): a `cone` shortens
   * steadily, an `umbrella` keeps its long limbs to near the top (with rising limbs: a flat top), a `column` keeps short
   * limbs the whole way.
   */
  limb: number;
  shape: 'cone' | 'umbrella' | 'column';
  /** Limb angle from the stem (deg) at the crown's foot and at its top: 90 = level, less = rising. */
  pitch: [number, number];
  /** Spread of a limb's side sprays (deg) and the limb generations that carry needles: from `leafFrom` on (0 = all). */
  spray: [number, number];
  leafFrom: number;
  tropism: [number, number, number];
  tropismStrength: number;
  baseRadius: number;
  bark: SpeciesDef['bark'];
  foliage: SpeciesDef['foliage'];
  scale: [number, number];
  maxSprites: number;
  maxBranchTriangles: number;
  twigRadius: number;
  collisionRadius: number;
  variants: number;
  /**
   * An open crown (the tall black pine of a closed stand), all optional, off = the dense layered crown: side sprays only
   * from limb generation `sprayFrom` on (default `leafFrom` - 2), limb lengths over `limbJitter` (default 0.85-1.15), a
   * `deadLimbs` share of the limbs died back to bare stubs (gaps in the crown), limbs curving up `curl` deg per
   * internode, and the bole's dead stubs on a `stubs.p` share of its metres, `stubs.len` m long (default every metre,
   * 0.2-0.45 m).
   */
  sprayFrom?: number;
  limbJitter?: [number, number];
  deadLimbs?: number;
  curl?: number;
  stubs?: { p: number; len: [number, number] };
}

/**
 * A conifer (trees/Species.md#types): a straight leader, bare `bole` metres with dead stubs, then `whorls` whorls of
 * `perWhorl` limbs, each limb's length from the crown `shape` and its angle rising up the crown. A limb is a main axis
 * with a pair of side sprays per internode (the sides skip a generation, so they stay short and flat) and needles on
 * its outer generations only: the inside of the crown is bare wood, the whorls read as layers.
 */
function conifer(o: ConiferShape): SpeciesDef {
  const N = o.whorls;
  const t = `(k/${N})`;
  const env =
    o.shape === 'cone'
      ? `(1-0.82*${t})`
      : o.shape === 'umbrella'
        ? `(1-0.7*${t}*${t})`
        : `(1-0.45*${t}*${t})`;
  // A limb's axis is about 3x its first internode.
  const [j0, j1] = o.limbJitter ?? [0.85, 1.15];
  const len = `${(o.limb / 3).toFixed(3)}*${env}*rnd(${j0},${j1})`;
  const [p0, p1] = o.pitch;
  const pitch = `${p0}+${p1 - p0}*${t}`;
  const turn = 360 / o.perWhorl;
  let whorl = '';
  for (let j = 0; j < o.perWhorl; j++)
    whorl += `[&(${pitch}+rnd(-6,6))!!B(${len},0)]>(${turn.toFixed(1)}+rnd(-15,15))`;
  // The bole in ~1 m pieces, a dead stub at each (a short foot has none).
  let axiom = '!';
  const pieces = o.bole > 0 ? Math.max(1, Math.round(o.bole)) : 0;
  const [u0, u1] = o.stubs?.len ?? [0.2, 0.45];
  const deadStub = `[&(rnd(70,95))!!!!!F(rnd(${u0},${u1}))]`;
  // (with `stubs`: an apex B(0,-1) that grows a stub on some metres only)
  const stub = o.bole < 1 ? '' : o.stubs ? 'B(0,-1)' : deadStub;
  for (let i = 0; i < pieces; i++)
    axiom += `F(${(o.bole / pieces).toFixed(3)})${stub}>(rnd(100,160))`;
  axiom += `A(${o.step},0)`;
  const [s0, s1] = o.spray;
  const leaf = (g: number) => (g >= o.leafFrom ? 'L' : '');
  const D = 3;
  const rules: RuleDef[] = [
    {
      pred: 'A(l,k)',
      cond: `k < ${N}`,
      succ: `F(l)${leaf(0)}${whorl}>(rnd(10,40))A(l*${o.taper},k+1)`,
    },
    { pred: 'A(l,k)', cond: `k >= ${N}`, succ: 'F(l*0.8)L' },
  ];
  if (o.stubs)
    rules.push(
      { pred: 'B(l,o)', cond: 'o < 0', p: o.stubs.p, succ: deadStub },
      { pred: 'B(l,o)', cond: 'o < 0', p: 1 - o.stubs.p, succ: 'f(0)' },
    );
  // Side sprays are needle tufts off the limb (no wood of their own): the branch budget draws every limb's axis out to
  // its needles instead of the first internodes of a thousand side shoots.
  const sprayFrom = o.sprayFrom ?? o.leafFrom - 2;
  const spray = (g: number) =>
    g >= sprayFrom
      ? `[+(rnd(${s0},${s1}))f(l*0.6)L][-(rnd(${s0},${s1}))f(l*0.6)L]`
      : '';
  const curl = o.curl ? `^(rnd(${o.curl * 0.5},${o.curl * 1.5}))` : '';
  const dead = o.deadLimbs ?? 0;
  for (let g = 0; g < D; g++)
    rules.push({
      pred: 'B(l,o)',
      cond: `o == ${g}`,
      ...(g === 0 && dead > 0 ? { p: 1 - dead } : {}),
      succ: `${curl}F(l)${leaf(g)}${spray(g)}>(rnd(-20,20))!B(l*0.82,o+1)`,
    });
  // A limb that died back in the stand's shade: a bare stub of its first internodes, a gap in the crown.
  if (dead > 0)
    rules.push({
      pred: 'B(l,o)',
      cond: 'o == 0',
      p: dead,
      succ: `${curl}F(l*rnd(0.3,0.55))!F(l*rnd(0.1,0.25))`,
    });
  rules.push({ pred: 'B(l,o)', cond: `o >= ${D}`, succ: 'F(l*0.6)L' });
  return {
    name: o.name,
    axiom,
    rules,
    iterations: N + D + 2,
    segmentCap: 2400,
    angle: 30,
    lengthScale: 1,
    baseRadius: o.baseRadius,
    radiusDecay: 0.8,
    tropism: o.tropism,
    tropismStrength: o.tropismStrength,
    bark: o.bark,
    foliage: o.foliage,
    scale: o.scale,
    twigRadius: o.twigRadius,
    maxBranchTriangles: o.maxBranchTriangles,
    maxSprites: o.maxSprites,
    collisionRadius: o.collisionRadius,
    variants: o.variants,
  };
}

/** Broadleaf summer crowns: sun leaves outside, shade leaves inside, trees a little apart (`foliage.turn`). */
const SUMMER_TURN = { turn: 0.25, stages: 0.15 };

/** Scots pine / spruce: the forest backbone, a straight leader and layered whorls of level limbs down to the foot. */
export const PINE = conifer({
  name: 'Pine',
  bole: 0.6,
  whorls: 12,
  step: 0.95,
  taper: 0.97,
  perWhorl: 5,
  limb: 2.8,
  shape: 'cone',
  pitch: [88, 62],
  spray: [38, 55],
  leafFrom: 1,
  tropism: [0, -1, 0],
  tropismStrength: 0.12,
  baseRadius: 0.22,
  bark: {
    color: '#7e6b5b',
    texture: 'furrowed',
    scan: 'pine',
    twig: '#9a6b48',
    tiling: 1.2,
  },
  foliage: {
    kind: 'needles',
    spriteSize: 0.95,
    leaf: 'pine',
    palette: ['#4c5a44', '#525f45', '#465541', '#4b5c4a'],
  },
  scale: [0.95, 1.35],
  maxSprites: 400,
  maxBranchTriangles: 2500,
  // Thin: the limbs the needles hang on show (the branch cap thickens it to fit).
  twigRadius: 0.006,
  collisionRadius: 0.1,
  variants: 6,
});

/**
 * Plantation pine: the pine's cone for the dense stands of a mountain forest, grown cheaper: four limbs to a whorl
 * and half the sprites, each larger (a pine stand costs about a third of the GPU time per tree); a full cone on
 * a short foot, like the planted hillside stands.
 */
export const PLANTATION_PINE = conifer({
  name: 'Plantation pine',
  bole: 1,
  whorls: 12,
  step: 0.95,
  taper: 0.97,
  perWhorl: 4,
  limb: 2.7,
  shape: 'cone',
  pitch: [88, 62],
  spray: [38, 55],
  leafFrom: 1,
  tropism: [0, -1, 0],
  tropismStrength: 0.12,
  baseRadius: 0.22,
  bark: PINE.bark,
  foliage: { ...PINE.foliage, spriteSize: 1.3 },
  scale: [1, 1.4],
  maxSprites: 200,
  maxBranchTriangles: 2000,
  // Thin: the limbs the needles hang on show (the branch cap thickens it to fit).
  twigRadius: 0.006,
  collisionRadius: 0.1,
  variants: 4,
});

/**
 * Austrian black pine: a long straight trunk, bare but for dead stubs, under a flat umbrella of dark needle clumps:
 * the low crown limbs rise steeply and reach out as far as the top, the needles only at their ends.
 */
export const BLACK_PINE = conifer({
  name: 'Black pine',
  bole: 4.5,
  whorls: 8,
  step: 0.55,
  taper: 0.95,
  perWhorl: 5,
  limb: 4.6,
  shape: 'umbrella',
  pitch: [42, 70],
  spray: [25, 40],
  leafFrom: 2,
  tropism: [0, -1, 0],
  tropismStrength: 0.05,
  baseRadius: 0.26,
  bark: { color: '#4a4541', texture: 'furrowed', scan: 'pine', tiling: 1.2 },
  foliage: {
    kind: 'needles',
    spriteSize: 1.3,
    leaf: 'pine',
    palette: ['#44533a', '#49583b', '#3e4e38', '#43563f'],
  },
  scale: [0.9, 1.2],
  maxSprites: 400,
  maxBranchTriangles: 2000,
  // Thin: the limbs the needles hang on show (the branch cap thickens it to fit).
  twigRadius: 0.006,
  collisionRadius: 0.1,
  variants: 4,
});

/**
 * Black pine of a closed stand, about 19-20 m: the stand shades its lower limbs off, so a slim trunk (~0.3 m) stands bare
 * to two thirds of its height under a small flat crown; the bark dark at the foot, paler grey-brown up the stem.
 */
export const TALL_BLACK_PINE = conifer({
  name: 'Tall black pine',
  bole: 13.2,
  whorls: 7,
  step: 0.85,
  taper: 0.95,
  perWhorl: 5,
  limb: 4.4,
  shape: 'umbrella',
  // Low limbs near level, curving up; the top ones rise: an irregular flat-topped crown, not a ball.
  pitch: [80, 55],
  curl: 6,
  limbJitter: [0.55, 1.15],
  deadLimbs: 0.22,
  // Needle tufts on the limbs' outer ends only: sky between the clumps, the limbs show.
  spray: [30, 55],
  leafFrom: 2,
  sprayFrom: 1,
  stubs: { p: 0.45, len: [0.3, 0.9] },
  tropism: [0, -1, 0],
  tropismStrength: 0.03,
  baseRadius: 0.16,
  bark: {
    color: '#93765c',
    texture: 'furrowed',
    scan: 'pine',
    foot: { color: '#5e4838', height: 5 },
    tiling: 1.2,
  },
  foliage: { ...BLACK_PINE.foliage, spriteSize: 0.85 },
  scale: [0.95, 1.1],
  maxSprites: 320,
  maxBranchTriangles: 2000,
  // Thin: the limbs the needles hang on show (the branch cap thickens it to fit).
  twigRadius: 0.006,
  collisionRadius: 0.1,
  variants: 4,
});

/** Juniper: a dark, dense, narrow cone of short upswept limbs, needled to the ground, 2-3.5 m; drive-through. */
export const JUNIPER = conifer({
  name: 'Juniper',
  // A short foot: the lowest sprays droop to the ground instead of sinking into it.
  bole: 0.3,
  whorls: 16,
  step: 0.17,
  taper: 0.98,
  perWhorl: 3,
  limb: 1.25,
  shape: 'cone',
  pitch: [60, 22],
  spray: [25, 40],
  leafFrom: 0,
  // Barely upturned: the low limbs keep low, so the cone is widest at the foot.
  tropism: [0, 1, 0],
  tropismStrength: 0.02,
  baseRadius: 0.07,
  bark: { color: '#706055', texture: 'furrowed', scan: 'cedar', tiling: 1.5 },
  foliage: {
    kind: 'needles',
    spriteSize: 0.3,
    leaf: 'pine',
    palette: ['#535c51', '#5a6153', '#4d564e', '#525f58'],
  },
  scale: [0.85, 1.2],
  maxSprites: 220,
  maxBranchTriangles: 1400,
  twigRadius: 0.006,
  collisionRadius: 0.12,
  variants: 4,
});

/** Oak / field tree: broad and irregular, for woods, hedgerows, gullies and village edges. */
export const OAK = broadleaf({
  name: 'Oak',
  bole: 1.9,
  lead: 1.25,
  limbs: [55, 72],
  leaders: [34, 50],
  laterals: [32, 50],
  iterations: 10,
  baseRadius: 0.34,
  tropismStrength: 0.07,
  bark: { color: '#5e564c', texture: 'furrowed', tiling: 0.8 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.5,
    leaf: 'lobed',
    palette: ['#3b4f34', '#3f5235', '#445636', '#485937', '#4c5d37'],
  },
  scale: [0.9, 1.3],
  variants: 6,
  crook: 17,
  leafFrom: 3,
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
  bark: { color: '#9c9c94', texture: 'smooth', scan: 'beech', tiling: 0.8 },
  shade: 0.6,
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.8,
    leaf: 'ovate',
    palette: ['#415637', '#475a38', '#4c5f39', '#526339'],
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
  bole: 1.2,
  lead: 1.3,
  limbs: [18, 28],
  leaders: [6, 14],
  laterals: [20, 34],
  iterations: 8,
  baseRadius: 0.13,
  tropismStrength: 0.03,
  bark: { color: '#8c8a80', texture: 'smooth', scan: 'beech', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.45,
    leaf: 'serrate',
    palette: ['#405537', '#455838', '#495c38', '#4e6039', '#526439'],
  },
  scale: [0.85, 1.3],
  variants: 6,
  stems: 3,
  crook: 9,
  leafFrom: 2,
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
  bark: { color: '#85807b', texture: 'furrowed', tiling: 0.8 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.9,
    leaf: 'round',
    palette: ['#465939', '#4c5e3a', '#52633a', '#58673a'],
  },
  scale: [0.95, 1.2],
  variants: 4,
  crook: 6,
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
    bark: { color: '#70675d', texture: 'furrowed', tiling: 1.2 },
    foliage: {
      kind: 'broadleaf',
      ...SUMMER_TURN,
      spriteSize: 1.1,
      leaf: 'round',
      palette: ['#44573c', '#495c3d', '#4f613e', '#55653e'],
    },
    scale: [0.9, 1.15],
    variants: 4,
  }),
  maxBranchTriangles: 2000,
  maxSprites: 400,
};

/** Plane / ash: a long grey-white trunk and an open, yellow-green crown (country lanes). */
export const PLANE = broadleaf({
  name: 'Plane',
  bole: 3.6,
  lead: 1.6,
  limbs: [30, 42],
  leaders: [16, 26],
  laterals: [26, 40],
  iterations: 10,
  baseRadius: 0.3,
  tropismStrength: 0.04,
  bark: { color: '#bdb8ac', texture: 'smooth', scan: 'plane', tiling: 0.6 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.6,
    leaf: 'lobed',
    palette: ['#566a3f', '#5d6f40', '#647441', '#6b7a43'],
  },
  scale: [0.95, 1.2],
  variants: 4,
  leafFrom: 1,
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
  bark: {
    color: '#dad6cc',
    texture: 'smooth',
    scan: 'birch',
    twig: '#4a3530',
    foot: { color: '#3f3c39', height: 1.2 },
    tiling: 1,
  },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.1,
    leaf: 'small',
    palette: ['#485d39', '#4e623a', '#54673a', '#5a6b3a'],
  },
  scale: [0.9, 1.2],
  twigRadius: 0.009,
  maxBranchTriangles: 2500,
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
  bark: { color: '#716d68', texture: 'smooth', tiling: 1.2 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1,
    leaf: 'ovate',
    palette: ['#48562f', '#4b5930', '#4f5d32', '#696530'],
  },
  scale: [0.9, 1.15],
  maxBranchTriangles: 1500,
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
  bark: { color: '#807e76', texture: 'furrowed', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.3,
    leaf: 'round',
    palette: ['#465b39', '#4c603a', '#52653a', '#58693a'],
  },
  scale: [0.95, 1.25],
  twigRadius: 0.009,
  maxBranchTriangles: 3000,
  maxSprites: 360,
  // The trunk alone: its many short limbs stay out of the physics.
  collisionRadius: 0.17,
  variants: 4,
};

/** Weeping willow: a short thick trunk, limbs arching out and long pale curtains of hanging shoots (canals, drains). */
export const WILLOW: SpeciesDef = {
  name: 'Willow',
  // Three limbs rise and arch out round a central one that fills the dome's top, and fork; every limb internode lets
  // fall a hanging shoot and every limb end three (B with o >= 10), whose strong downward tropism pulls them into
  // curtains a few metres long, leaves all along them.
  axiom: '!F(2.0)A(1.4)',
  rules: [
    {
      pred: 'A(l)',
      succ:
        'F(l*0.6)[&(rnd(28,40))!!B(l*1.1,0)]>(rnd(110,130))[&(rnd(28,40))!!B(l*1.1,0)]' +
        '>(rnd(110,130))[&(rnd(28,40))!!B(l*1.1,0)][&(rnd(8,16))!!B(l*1.2,0)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o < 3',
      succ:
        'F(l)[&(rnd(22,36))!B(l*0.8,o+1)]>(rnd(100,140))[^(rnd(4,14))!B(l*0.85,o+1)]' +
        '>(rnd(60,90))[T(0.45)&(rnd(60,85))!!B(rnd(0.45,0.55),10)]',
    },
    {
      pred: 'B(l,o)',
      cond: 'o >= 3 && o < 10',
      succ:
        'F(l*0.6)[T(0.45)&(70)!B(rnd(0.45,0.55),10)][T(0.45)^(70)!B(rnd(0.45,0.55),10)]' +
        '[T(0.45)+(70)!B(rnd(0.42,0.52),10)]',
    },
    // Shoots stopping a metre or so above the ground: two short internodes first, so they arch over and hang within
    // half a metre (the bend is per internode) instead of standing out stiff, then 7 long ones (more shoots, each in
    // fewer pieces: the curtains fill the dome within the triangle cap).
    { pred: 'B(l,o)', cond: 'o >= 10 && o < 12', succ: 'F(l*0.35)L!B(l,o+1)' },
    {
      pred: 'B(l,o)',
      cond: 'o >= 12 && o < 19',
      succ: 'F(l*1.4)L!B(l*0.97,o+1)',
    },
    { pred: 'B(l,o)', cond: 'o >= 19', succ: 'F(l*0.6)L' },
  ],
  iterations: 16,
  segmentCap: 2400,
  angle: 30,
  lengthScale: 1,
  baseRadius: 0.36,
  radiusDecay: 0.8,
  tropism: [0, -1, 0],
  tropismStrength: 0.03,
  // Olive-yellow young shoots: a curtain strand between its leaf cards reads as a withy, not grey wire.
  bark: {
    color: '#64594c',
    texture: 'furrowed',
    scan: 'willow',
    twig: '#7f7a44',
    tiling: 0.9,
  },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.8,
    leaf: 'narrow',
    palette: ['#4e6042', '#556643', '#5b6a44', '#626f44'],
  },
  scale: [0.9, 1.15],
  // Every curtain shoot drawn, a few mm thick, so the leaf cards hang on wood (a willow is a single yard tree, not a
  // stand: the cap fits its ~1,300 internodes).
  tipRadius: 0.003,
  twigRadius: 0.002,
  maxBranchTriangles: 12000,
  maxSprites: 1000,
  collisionRadius: 0.1,
  variants: 4,
};

/** Low leafy roadside shrub; drive-through. */
export const BUSH = shrub({
  name: 'Bush',
  stems: 14,
  stool: 0.35,
  stem: [0.5, 0.22],
  lean: [3, 36],
  fork: [28, 45],
  depth: 4,
  baseRadius: 0.02,
  bark: { color: '#5a4a3a', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.62,
    leaf: 'small',
    palette: ['#44543c', '#49583d', '#4f5c3e', '#55613e'],
  },
  scale: [0.8, 1.3],
  variants: 6,
});

/** Mediterranean hill scrub (juniper / blackthorn): dark olive, low and wide; drive-through. */
export const SCRUB = shrub({
  name: 'Scrub',
  stems: 16,
  stool: 0.5,
  stem: [0.25, 0.15],
  lean: [10, 52],
  fork: [30, 50],
  depth: 4,
  crook: 12,
  baseRadius: 0.03,
  bark: { color: '#4c4036', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.55,
    leaf: 'small',
    palette: ['#394937', '#3e4d38', '#435139', '#485439'],
  },
  scale: [0.85, 1.2],
  variants: 6,
});

/** Plantation hazelnut: a multi-stemmed bush, upright, with a low wide fresh-green crown, 3-4 m. */
export const HAZEL = shrub({
  name: 'Hazel',
  stems: 12,
  stool: 0.4,
  stem: [0.72, 0.55],
  lean: [3, 22],
  fork: [18, 34],
  depth: 4,
  crook: 5,
  baseRadius: 0.05,
  bark: { color: '#6b5a48', texture: 'smooth', tiling: 1.2 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.85,
    leaf: 'serrate',
    palette: ['#46593a', '#4c5e3b', '#52633c', '#58673c'],
  },
  scale: [0.9, 1.15],
  variants: 4,
});

/** Hawthorn / blackthorn / elm-sucker thicket in autumn colours, 2.5-4.5 m; drive-through brush. */
export const THICKET = shrub({
  name: 'Thicket',
  stems: 14,
  stool: 0.45,
  stem: [0.62, 0.4],
  lean: [5, 32],
  fork: [30, 50],
  depth: 4,
  crook: 12,
  baseRadius: 0.04,
  bark: { color: '#4f4035', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.75,
    leaf: 'small',
    palette: ['#3b4f37', '#3f5238', '#445638', '#485939', '#4c5d39'],
  },
  scale: [0.85, 1.2],
  variants: 4,
});

/** Flowering broom (Cytisus / Spartium) on the road cuttings: upright green switches covered in yellow, 1-2 m. */
export const BROOM = shrub({
  name: 'Broom',
  stems: 22,
  stool: 0.25,
  stem: [0.3, 0.24],
  lean: [3, 32],
  fork: [12, 24],
  depth: 4,
  crook: 4,
  baseRadius: 0.025,
  bark: { color: '#55603a', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.45,
    leaf: 'narrow',
    palette: ['#425730', '#bc9919', '#bf9e19', '#c4a219', '#cbaa21'],
  },
  scale: [0.8, 1.2],
  variants: 4,
});

/** A cypress limb: three generations of forks, a frond on every shoot (and halfway along the long inner ones). */
const CYPRESS_LIMBS = [
  {
    pred: 'B(l,o)',
    cond: 'o < 2',
    succ: 'F(l*0.5)LF(l*0.5)L[+(rnd(15,25))!B(l*0.6,o+1)][-(rnd(15,25))!B(l*0.55,o+1)]!B(l*0.7,o+1)',
  },
  {
    pred: 'B(l,o)',
    cond: 'o == 2',
    succ: 'F(l)L[+(rnd(15,25))!B(l*0.6,o+1)][-(rnd(15,25))!B(l*0.55,o+1)]!B(l*0.7,o+1)',
  },
  { pred: 'B(l,o)', cond: 'o >= 3', succ: 'F(l*0.5)L' },
];

/** Mediterranean cypress: a tall, dark, narrow column of short limbs close to the stem (churchyards, slopes), 8-12 m. */
export const CYPRESS: SpeciesDef = {
  name: 'Cypress',
  // The poplar's leader with two short limbs per step at the golden angle (a full column, no gaps), dark needles. The
  // fronds hang on the limbs only (none on the leader), each about as long as the limb end it grows from.
  axiom: '!F(0.5)A(0.7,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 14',
      succ:
        'F(l)[&(rnd(14,24))!!!B(rnd(0.5,0.85)*(1.05-k*0.045),0)]>(137.5)' +
        '[&(rnd(14,24))!!!B(rnd(0.45,0.8)*(1.05-k*0.045),0)]>(137.5)A(l*0.985,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 14', succ: 'F(l*0.7)L' },
    ...CYPRESS_LIMBS,
  ],
  iterations: 19,
  segmentCap: 1600,
  angle: 22,
  lengthScale: 1,
  baseRadius: 0.22,
  radiusDecay: 0.82,
  tropism: [0, 1, 0],
  tropismStrength: 0.16,
  bark: { color: '#76675d', texture: 'furrowed', scan: 'cedar', tiling: 1.2 },
  foliage: {
    kind: 'needles',
    spriteSize: 0.5,
    leaf: 'juniper',
    palette: ['#404e3a', '#46533b', '#3b4a38', '#40513f'],
  },
  scale: [0.85, 1.25],
  // Thin: the limbs the fronds hang on show between them.
  twigRadius: 0.008,
  maxBranchTriangles: 4000,
  maxSprites: 600,
  // The trunk alone: its many short limbs stay out of the physics.
  collisionRadius: 0.14,
  variants: 4,
};

/** Hedge cypress (leyland / arborvitae): the broad-based, fuller green column planted as lot screens and field rows, 6-9 m. */
export const HEDGE_CYPRESS: SpeciesDef = {
  ...CYPRESS,
  name: 'Hedge cypress',
  // The cypress leader, its limbs longer and spreading wider low down (a cone on a broad base, not a spire) and close
  // to the stem higher up.
  axiom: '!F(0.4)A(0.43,0)',
  rules: [
    {
      pred: 'A(l,k)',
      cond: 'k < 14',
      succ:
        'F(l)[&(rnd(40,52)-k*2)!!!B(rnd(0.55,0.8)*(1.3-k*0.07),0)]>(137.5)' +
        '[&(rnd(42,54)-k*2)!!!B(rnd(0.5,0.75)*(1.3-k*0.07),0)]>(137.5)A(l*0.985,k+1)',
    },
    { pred: 'A(l,k)', cond: 'k >= 14', succ: 'F(l*0.7)L' },
    ...CYPRESS_LIMBS,
  ],
  baseRadius: 0.16,
  foliage: {
    kind: 'needles',
    spriteSize: 0.5,
    leaf: 'juniper',
    palette: ['#46583a', '#4c5d3b', '#415238', '#465a3f'],
  },
  scale: [0.8, 1.15],
  maxBranchTriangles: 3000,
  maxSprites: 600,
  collisionRadius: 0.12,
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
  bark: { color: '#5e564c', texture: 'furrowed', tiling: 1 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 1.05,
    leaf: 'small',
    palette: ['#4a5d33', '#516234', '#576734', '#5d6b34'],
  },
  scale: [0.85, 1.2],
  variants: 4,
  crook: 11,
  leafFrom: 2,
});

/** Bramble and wild rose along the forest edge and the verges: a low arching tangle of green canes, 0.8-1.4 m. */
export const BRAMBLE = shrub({
  name: 'Bramble',
  stems: 12,
  stool: 0.5,
  stem: [0.3, 0.24],
  lean: [24, 52],
  fork: [28, 46],
  depth: 5,
  arch: 0.2,
  crook: 10,
  baseRadius: 0.02,
  bark: { color: '#4e5a34', texture: 'smooth', tiling: 1.5 },
  foliage: {
    kind: 'broadleaf',
    ...SUMMER_TURN,
    spriteSize: 0.5,
    leaf: 'serrate',
    palette: ['#3c4f37', '#415438', '#465839', '#4c5c39'],
  },
  scale: [0.85, 1.3],
  variants: 4,
});

export const SPECIES: readonly SpeciesDef[] = [
  PINE,
  PLANTATION_PINE,
  BLACK_PINE,
  TALL_BLACK_PINE,
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
  HEDGE_CYPRESS,
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
  tall_black_pine: 'Tall black pine',
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
  hedge_cypress: 'Hedge cypress',
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

/** Content hash of a species definition: any change invalidates cached variants (their seeds stay, trees/variants.ts). */
export function speciesHash(s: SpeciesDef): number {
  let h = hashes.get(s);
  if (h === undefined) hashes.set(s, (h = hashText(stable(s))));
  return h;
}
