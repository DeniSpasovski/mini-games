import { SEASONS, type Season } from '../season';
import { hexToLinear } from './math';
import type { SpeciesDef } from './species';

/**
 * Leaf colours by season (spec: trees/Species.md#seasons). A species' own `foliage.palette` is its summer look;
 * this table gives the spring and autumn palettes of the species that change (conifers barely, the juniper never).
 * A broadleaf's spring / autumn palette is a ramp, least to most turned (measured leaves: green, yellow-green, gold,
 * orange, copper / red, brown): each variant stands at its own stage on it and its outer, upper leaves run ahead.
 * Only colours differ: a season's variants grow from the same seeds, so a tree is the same tree all year.
 */
const PALETTES: Readonly<
  Record<string, Partial<Record<Exclude<Season, 'summer'>, string[]>>>
> = {
  Pine: {
    spring: ['#505e44', '#566345', '#4a5841', '#4f614a'],
    autumn: ['#495640', '#4f5b42', '#43513e', '#485946'],
  },
  'Plantation pine': {
    spring: ['#506042', '#566543', '#4a5a3f', '#4f6248'],
    autumn: ['#49583f', '#4f5d40', '#43533c', '#485b44'],
  },
  'Black pine': {
    spring: ['#46563b', '#4c5b3d', '#415139', '#465941'],
  },
  'Tall black pine': {
    spring: ['#46563b', '#4c5b3d', '#415139', '#465941'],
  },
  Oak: {
    spring: ['#5c513a', '#5c5c39', '#586437', '#4f6037', '#475a37'],
    autumn: ['#3a4f30', '#585c37', '#7e7241', '#866f4a', '#785a44', '#685444'],
  },
  Beech: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#415633', '#6f7b3a', '#9d883e', '#a3753a', '#8d603a', '#725641'],
  },
  Hornbeam: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  Walnut: {
    spring: ['#5c513a', '#5c5c39', '#586437', '#4f6037', '#475a37'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  // Blossom: white and pale pink among the first leaves.
  'Fruit tree': {
    spring: ['#5c6b38', '#606f3a', '#bd9b9f', '#c5c0bd', '#cdcac5'],
    autumn: ['#415633', '#727b3a', '#a7833a', '#ab6f37', '#9f5a37', '#80483a'],
  },
  Plane: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#4a5c37', '#727b3a', '#978344', '#927b4a', '#836b4a', '#6f5844'],
  },
  Birch: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  Sapling: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  Poplar: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  Willow: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445837', '#646f3a', '#838144', '#978d4a', '#6f5c44'],
  },
  Bush: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  Scrub: {
    spring: ['#5c513a', '#5c5c39', '#586437', '#4f6037', '#475a37'],
    autumn: ['#3e4c35', '#444f37', '#977e3e', '#a76837', '#97443a'],
  },
  Hazel: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  // Blackthorn / hawthorn blossom in spring, red and brown in autumn.
  Thicket: {
    spring: ['#546438', '#5c6b3a', '#b4b3ab', '#c5c3bd'],
    autumn: ['#415435', '#7e7241', '#977e3e', '#97643a', '#7e4e38', '#64483a'],
  },
  // Evergreen cypresses and the juniper: the same colour all year (no entry).
  Locust: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#445833', '#72813a', '#a3923e', '#a7974a', '#8b754a', '#6f5844'],
  },
  Bramble: {
    spring: ['#58563e', '#687e3e', '#64753a', '#5c6b38', '#516437'],
    autumn: ['#415435', '#645c3e', '#8d583e', '#7a4a3a', '#5e4636'],
  },
  // Yellow bloom in spring (May - June); green switches in summer, seed pods among them in autumn.
  Broom: {
    spring: ['#425730', '#bc9919', '#bf9e19', '#c4a219', '#cbaa21'],
    autumn: ['#475a37', '#4c5838', '#4a4f3a', '#4a4437'],
  },
};

/** Their crowns yellow from the inside out. */
const INSIDE_FIRST = ['Birch', 'Poplar', 'Willow'];
/** A broadleaf's leaf cover in autumn (share of its sprites) and in spring (share, size). */
const AUTUMN_LEAVES = 0.75;
const SPRING_LEAVES = { leafy: 0.8, leafSize: 0.8 };

/**
 * Late autumn (an autumn month from November on, `EnvironmentDef.months`): the broadleaves have shed most of their leaves,
 * the last ones dull ochre and brown (the turned end of the ramp, greyer), so the fine twigs show (drawn thinner, a larger
 * branch budget, as `bareSpecies`). Oak and bramble hold their dead leaves longer; broom stays green.
 */
export const LATE_AUTUMN_MONTH = 11;
const LATE_LEAVES = 0.15;
const LATE_KEEP: Readonly<Record<string, number>> = { Oak: 0.35, Bramble: 0.6 };
/** Dead leaf (a dry oak leaf's mean, sRGB): the turned colours fade this far towards it, at this value. */
const DEAD_LEAF = '#76604a';
const LATE_FADE = 0.65;
const LATE_VALUE = 0.8;
const LATE_TWIG = 0.006;
const LATE_BRANCHES = 1.6;

/** A late-autumn ramp: the turned end of the autumn one (gold to brown) faded towards the dead leaf's brown. */
function lateRamp(autumn: string[]): string[] {
  const dead = hexToLinear(DEAD_LEAF);
  const out = (v: number) =>
    Math.round(
      255 *
        (v <= 0.0031308
          ? v * 12.92
          : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055),
    )
      .toString(16)
      .padStart(2, '0');
  return autumn.slice(2).map(
    (hex) =>
      `#${hexToLinear(hex)
        .map((v, i) => out((v + (dead[i] - v) * LATE_FADE) * LATE_VALUE))
        .join('')}`,
  );
}

/** Where a season's species came from: the summer species and the season. */
const origins = new WeakMap<
  SpeciesDef,
  { summer: SpeciesDef; season: Season }
>();
const derived = new WeakMap<SpeciesDef, Map<string, SpeciesDef>>();

/**
 * The species as it looks in `season`: the same definition with that season's leaf colours (itself when it has none).
 * `month` (1-12, `seasonMonth`): an autumn from `LATE_AUTUMN_MONTH` on is late autumn.
 */
export function seasonal(
  def: SpeciesDef,
  season: Season,
  month = 0,
): SpeciesDef {
  const summer = summerOf(def);
  if (season === 'summer') return summer;
  const broad = summer.foliage.kind === 'broadleaf';
  const late =
    broad &&
    season === 'autumn' &&
    month >= LATE_AUTUMN_MONTH &&
    summer.name !== 'Broom';
  let bySeason = derived.get(summer);
  if (!bySeason) derived.set(summer, (bySeason = new Map()));
  const key = late ? 'late autumn' : season;
  let out = bySeason.get(key);
  if (!out) {
    const palette = PALETTES[summer.name]?.[season];
    // Leaves turn tree by tree (a week apart in autumn, half that in spring) and from the crown's top and outside in
    // (birch, poplar and willow from the inside); needles hardly change. Autumn crowns have shed some leaves, spring
    // ones are not full yet and their leaves still small: the same branches show through more.
    const inside = INSIDE_FIRST.includes(summer.name) ? -1 : 1;
    const change =
      broad && season === 'autumn'
        ? {
            turn: 0.5 * inside,
            stage: 0.6,
            stages: 0.35,
            hueSpread: 1.3,
            leafy: AUTUMN_LEAVES,
          }
        : broad && season === 'spring'
          ? { turn: 0.3, stages: 0.2, hueSpread: 1.2, ...SPRING_LEAVES }
          : {};
    out = palette
      ? { ...summer, foliage: { ...summer.foliage, palette, ...change } }
      : summer;
    if (late && palette)
      out = {
        ...out,
        foliage: {
          ...out.foliage,
          palette: lateRamp(palette),
          stage: 0.55,
          stages: 0.4,
          // Dead leaves differ little from tree to tree.
          hueSpread: 0.6,
          leafy: LATE_KEEP[summer.name] ?? LATE_LEAVES,
        },
        twigRadius: Math.min(summer.twigRadius, LATE_TWIG),
        maxBranchTriangles: Math.round(
          summer.maxBranchTriangles * LATE_BRANCHES,
        ),
      };
    if (out !== summer) origins.set(out, { summer, season });
    bySeason.set(key, out);
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

/** Every distinct look of a species over the year, late autumn too (what the disk cache keeps, trees/cache.ts). */
export function allSeasons(def: SpeciesDef): SpeciesDef[] {
  return [
    ...new Set([
      ...SEASONS.map((s) => seasonal(def, s)),
      seasonal(def, 'autumn', LATE_AUTUMN_MONTH),
    ]),
  ];
}

/** Species names the table has palettes for (a test checks them). */
export const SEASONAL_SPECIES: readonly string[] = Object.keys(PALETTES);
