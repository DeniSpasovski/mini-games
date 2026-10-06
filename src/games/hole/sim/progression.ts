/**
 * Single source of truth for hole levels, size tiers, points, XP, camera and
 * speed. DOM-free and three-free. The numbers match the DETAILS.md level table.
 *
 * Two ladders:
 * - **Size tiers (1..25)**: how big an item is. Tier decides the item's points
 *   (1..20, then 25/30/35/40/50). A tier-t item has `size <= tierMaxSize(t)`.
 * - **Hole levels (1..25)**: the hole grows in steps. Levels 1..15 (`ITEM_LEVELS`)
 *   each unlock a size tier: level k eats every item up to tier `LEVEL_TIERS[k-1]`.
 *   Levels 16..25 (`GROWTH_LEVELS`) unlock nothing new (every item is edible at
 *   level 15): the hole just keeps growing x1.075 per level, up to ~100 m.
 *
 * Changing points, tiers, the clear bonus or the difficulty times changes what
 * a score means on every map: bump every map in `MAP_SCORING_VERSIONS`
 * (game/scores.ts) so old high scores are erased.
 */
export const TIER_COUNT = 25;
/** Size tier that each hole level can eat up to. 15 levels, bigger jumps early on. */
export const LEVEL_TIERS = [
  1, 4, 8, 10, 12, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25,
] as const;
/** Levels that unlock a size tier (the item ladder). */
export const ITEM_LEVELS = LEVEL_TIERS.length;
/** Extra levels after the last tier: the hole only grows, fed by the points already on the map. */
export const GROWTH_LEVELS = 10;
export const MAX_LEVEL = ITEM_LEVELS + GROWTH_LEVELS;
/** Diameter factor per growth level (level 25 = 48 m x 1.075^10 = ~99 m). */
const GROWTH = 1.075;
/** Largest edible size at tier 1 and 25 (metres); in between it grows geometrically. */
const EDIBLE_MIN = 0.9;
const EDIBLE_MAX = 36;
/**
 * The two size rules. `fit`: an item can be eaten when `size <= D * fit` (0.75 means the hole is 33 %
 * wider than the biggest thing it can swallow, so it never looks like it eats something wider than
 * itself). `heightFactor`: height counts this much towards an item's gameplay size.
 * `SIZE_RULES` is the live object (only the item viewer changes it, to preview a rule change: call
 * `rederiveCatalog()` afterwards); `SIZE_RULES_DEFAULT` holds the shipped values.
 */
export const SIZE_RULES_DEFAULT = { fit: 0.75, heightFactor: 0.25 } as const;
export const SIZE_RULES: { fit: number; heightFactor: number } = {
  ...SIZE_RULES_DEFAULT,
};
/** An item starts to fall once its centre is within `D/2 - COMMIT * size` of the hole centre. */
export const COMMIT = 0.15;
/** Points for tiers 21..25; tiers 1..20 give `tier` points. */
const TOP_POINTS = [25, 30, 35, 40, 50];

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
}

export function clampTier(tier: number): number {
  return Math.max(1, Math.min(TIER_COUNT, Math.round(tier)));
}

/** Size tier a hole level can eat up to (growth levels keep the last tier). */
export function levelTier(level: number): number {
  return LEVEL_TIERS[Math.min(clampLevel(level), ITEM_LEVELS) - 1];
}

/** Largest item size (m) of a tier: 0.9 m at tier 1 growing to 36 m at tier 25. */
export function tierMaxSize(tier: number): number {
  const t = clampTier(tier);
  return (
    EDIBLE_MIN * Math.pow(EDIBLE_MAX / EDIBLE_MIN, (t - 1) / (TIER_COUNT - 1))
  );
}

/** Hole diameter in metres (1.2 m at level 1, 48 m at level 15, ~99 m at level 25). */
export function holeDiameter(level: number): number {
  const l = clampLevel(level);
  const base = tierMaxSize(levelTier(l)) / SIZE_RULES.fit;
  return l <= ITEM_LEVELS ? base : base * Math.pow(GROWTH, l - ITEM_LEVELS);
}

/** Largest item size the hole can eat at this level (growth levels: more than any item). */
export function maxEdibleSize(level: number): number {
  const l = clampLevel(level);
  return l <= ITEM_LEVELS
    ? tierMaxSize(levelTier(l))
    : holeDiameter(l) * SIZE_RULES.fit;
}

/** Points of an item of this size tier. */
export function pointsForTier(tier: number): number {
  const t = clampTier(tier);
  return t <= 20 ? t : TOP_POINTS[t - 21];
}

/** Size tier of an item: first tier whose max size fits it (Infinity when nothing does). */
export function tierForSize(size: number): number {
  for (let t = 1; t <= TIER_COUNT; t++) if (size <= tierMaxSize(t)) return t;
  return Infinity;
}

/**
 * Balance knobs (the balance page edits these live; defaults are the shipped
 * values). Eat size / tier maths (`SIZE_RULES`) is NOT here: item tiers and
 * levels are derived from it at load time (the item viewer re-derives them).
 */
export const TUNING = {
  /** Items of the current tier needed to fill the bar: at level 1 and level 14 (linear in between). */
  itemsFirst: 8,
  itemsLast: 46,
  /** Full-stick speed (m/s) = speedBase + speedPerMetre * (diameter / REF_SCALE). */
  speedBase: 6,
  speedPerMetre: 1.2,
  /** XP to leave level 15, and how much more each growth level asks (levels 16..24). */
  growthXpFirst: 800,
  growthXpStep: 80,
};

/** Camera and speed formulas were tuned for diameters this many times smaller (the fit rule used to be 0.9). */
export const REF_SCALE = 0.9 / SIZE_RULES_DEFAULT.fit;

/** Items needed to fill the bar at this level. */
export function itemsToLevel(level: number): number {
  const l = Math.min(clampLevel(level), ITEM_LEVELS);
  const t = TUNING;
  return Math.round(
    t.itemsFirst + ((t.itemsLast - t.itemsFirst) * (l - 1)) / (ITEM_LEVELS - 2),
  );
}

/** XP needed to go from `level` to `level + 1` (Infinity at the cap). */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  if (level >= ITEM_LEVELS)
    return TUNING.growthXpFirst + TUNING.growthXpStep * (level - ITEM_LEVELS);
  return pointsForTier(levelTier(level)) * itemsToLevel(level);
}

export function cumulativeXp(level: number): number {
  let sum = 0;
  for (let l = 1; l < clampLevel(level); l++) sum += xpToNext(l);
  return sum;
}

/** Gameplay size of an object (metres): footprint first, height counts a little. */
export function itemSize(w: number, d: number, h: number): number {
  return Math.max(w, d, h * SIZE_RULES.heightFactor);
}

/** First hole level that can eat an item of this size; Infinity when nothing can. */
export function levelForSize(size: number): number {
  for (let l = 1; l <= ITEM_LEVELS; l++) if (size <= maxEdibleSize(l)) return l;
  return Infinity;
}

export function canEat(level: number, size: number): boolean {
  return size <= maxEdibleSize(level);
}

/** Camera distance from the hole (metres). */
export function cameraDistance(diameter: number): number {
  return 7 + 3.2 * (diameter / REF_SCALE);
}

/** Camera pitch in degrees above the horizon: 52 at level 1, 64 at level 15, 70 at level 25. */
export function cameraPitchDeg(level: number): number {
  const l = clampLevel(level);
  if (l <= ITEM_LEVELS) return 52 + (12 * (l - 1)) / (ITEM_LEVELS - 1);
  return 64 + (6 * (l - ITEM_LEVELS)) / GROWTH_LEVELS;
}

/** Full-stick speed in m/s. */
export function moveSpeed(diameter: number): number {
  return TUNING.speedBase + (TUNING.speedPerMetre * diameter) / REF_SCALE;
}

export interface Difficulty {
  id: 'easy' | 'medium' | 'hard';
  label: string;
  seconds: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', label: 'Easy', seconds: 480 },
  { id: 'medium', label: 'Medium', seconds: 240 },
  { id: 'hard', label: 'Hard', seconds: 120 },
];

/**
 * Per-map time limits (s), where a map's pace differs from City Island's. The toy store's floor takes the good bot
 * ~15-20 % longer to clear (~175 s vs ~155 s), so it keeps City Island's timer / clear-time ratios.
 */
const MAP_SECONDS: Record<string, Record<Difficulty['id'], number>> = {
  toy: { easy: 560, medium: 280, hard: 140 },
};

/** The three difficulties with the time limits of `mapId` (City Island's when the map has no override). */
export function difficultiesFor(mapId?: string): Difficulty[] {
  const secs = mapId ? MAP_SECONDS[mapId] : undefined;
  return secs
    ? DIFFICULTIES.map((d) => ({ ...d, seconds: secs[d.id] }))
    : DIFFICULTIES;
}

export function difficultyById(id: string, mapId?: string): Difficulty {
  const all = difficultiesFor(mapId);
  return all.find((d) => d.id === id) ?? all[1];
}

/** Bonus points per remaining second when the whole island is eaten. */
export const CLEAR_BONUS_PER_SECOND = 10;
