import { SEASONS, type Season } from '../season';
import type { SpeciesDef } from './species';

/**
 * Leaf colours by season (spec: trees/Species.md#seasons). A species' own `foliage.palette` is its summer look;
 * this table gives the spring and autumn palettes of the species that change (conifers barely, the juniper never).
 * Only colours differ: a season's variants grow from the same seeds, so a tree is the same tree all year.
 */
const PALETTES: Readonly<
  Record<string, Partial<Record<Exclude<Season, 'summer'>, string[]>>>
> = {
  Pine: {
    spring: ['#3a5a2c', '#41662f', '#365428', '#487035'],
    autumn: ['#2c4524', '#32502a', '#274020', '#385428'],
  },
  'Black pine': {
    spring: ['#2a4222', '#32492a', '#27391f', '#375228'],
  },
  Oak: {
    spring: ['#6f9a3a', '#7aa840', '#659032', '#84b248', '#709c3a'],
    autumn: ['#8a6a2a', '#7a5a22', '#9a7430', '#6a4a1e', '#a08034'],
  },
  Beech: {
    spring: ['#8fbf3f', '#9bcb46', '#86b438', '#a4d04e'],
    autumn: ['#c8861e', '#d89a26', '#b6701a', '#e0a830', '#a85c18'],
  },
  Hornbeam: {
    spring: ['#98c43c', '#a4cf44', '#8ab836', '#b0d44e'],
    autumn: ['#d6a626', '#e0b82e', '#c89420', '#e8c63a', '#b8821c'],
  },
  Walnut: {
    spring: ['#58782e', '#628436', '#4f6e28', '#6a8c3a'],
    autumn: ['#8a7a2a', '#7a6a22', '#9a8630', '#6a5a1e'],
  },
  'Fruit tree': {
    // Blossom: pale pink and white among the first leaves.
    spring: ['#e9dcd6', '#d9a8a8', '#8fae48', '#a6c05a', '#efe6e0'],
    autumn: ['#a88a2a', '#b87a24', '#8a7a2c', '#c09a30'],
  },
  Plane: {
    spring: ['#9fbe44', '#abca4c', '#94b23c', '#b4d055'],
    autumn: ['#c8a02a', '#d0a830', '#b88c22', '#d8b43c'],
  },
  Birch: {
    spring: ['#8ab844', '#96c44c', '#7eac3c', '#a2cc54'],
    autumn: ['#e0c030', '#ecd040', '#d4b028', '#f0d850'],
  },
  Sapling: {
    spring: ['#9ab640', '#a8c448', '#8eaa38', '#b4cc50'],
    autumn: ['#c0a030', '#cc9a2c', '#b08a28', '#d4b038'],
  },
  Poplar: {
    spring: ['#6e9a38', '#78a640', '#64902f', '#82ac46'],
    autumn: ['#c8b02c', '#d4bc34', '#b89e26', '#dcc83e'],
  },
  Willow: {
    spring: ['#a8c850', '#b4d25a', '#9cbc48', '#bede66'],
    autumn: ['#b8b04a', '#c4b852', '#a8a042', '#ccc05a'],
  },
  Bush: {
    spring: ['#5a8030', '#64883a', '#527a2c', '#6c9040'],
    autumn: ['#7a6a2c', '#6a5a26', '#8a7430', '#5c5a2a'],
  },
  Scrub: {
    spring: ['#5a6a34', '#647438', '#52622c', '#6c7a40'],
    autumn: ['#6a5a30', '#74643a', '#5c4c28', '#7e6c40'],
  },
  Hazel: {
    spring: ['#78a840', '#84b448', '#6e9c38', '#8cbc50'],
    autumn: ['#c4a42c', '#b8902a', '#d0b038', '#a88024'],
  },
  Thicket: {
    spring: ['#6a8a34', '#78963c', '#5c7a2e', '#84a044', '#527030'],
    autumn: ['#a06a24', '#b2561e', '#8a6a26', '#b88430', '#6a5a24'],
  },
  // Its summer palette is the yellow bloom; in autumn only seed pods and green stems are left.
  Broom: {
    autumn: ['#6e8e2c', '#5f7e26', '#7a8a30', '#8a8a34'],
  },
};

/** Where a season's species came from: the summer species and the season. */
const origins = new WeakMap<
  SpeciesDef,
  { summer: SpeciesDef; season: Season }
>();
const derived = new WeakMap<SpeciesDef, Map<Season, SpeciesDef>>();

/** The species as it looks in `season`: the same definition with that season's leaf colours (itself when it has none). */
export function seasonal(def: SpeciesDef, season: Season): SpeciesDef {
  const summer = summerOf(def);
  if (season === 'summer') return summer;
  let bySeason = derived.get(summer);
  if (!bySeason) derived.set(summer, (bySeason = new Map()));
  let out = bySeason.get(season);
  if (!out) {
    const palette = PALETTES[summer.name]?.[season];
    out = palette
      ? { ...summer, foliage: { ...summer.foliage, palette } }
      : summer;
    if (out !== summer) origins.set(out, { summer, season });
    bySeason.set(season, out);
  }
  return out;
}

/** The summer species a `seasonal` one was made from (the species itself otherwise). */
export function summerOf(def: SpeciesDef): SpeciesDef {
  return origins.get(def)?.summer ?? def;
}

/** The season a species definition shows its leaves in. */
export function seasonOf(def: SpeciesDef): Season {
  return origins.get(def)?.season ?? 'summer';
}

/** Every distinct look of a species over the year (what the disk cache keeps, trees/cache.ts). */
export function allSeasons(def: SpeciesDef): SpeciesDef[] {
  return [...new Set(SEASONS.map((s) => seasonal(def, s)))];
}

/** Species names the table has palettes for (a test checks them). */
export const SEASONAL_SPECIES: readonly string[] = Object.keys(PALETTES);
