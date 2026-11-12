/**
 * Generic service-park teams, no names, logos or lettering. The team index is the variant of every team-coloured asset
 * (trucks, vans, gazebos, flags, cars) and picks the crew's overalls. `base` / `accent` / `accent2` are the livery of the
 * team's cars and the crew's overalls; the park dressing (tents, flags, vans, trucks) is a small palette instead: `dress`
 * is one of three quiet colours (`DRESS`, the one nearest the team's own) next to a `neutral`, and a `plain` team keeps
 * its tents and vans in the neutral with the colour only on the bands and stripes.
 */
export interface Team {
  base: string;
  accent: string;
  accent2: string;
  dress: string;
  neutral: string;
  plain?: boolean;
}

const WHITE = '#e9e9e6';
const CHARCOAL = '#2e3035';
/** The park's three dressing colours (dyed fabric / fleet paint, not livery paint). */
const DRESS = { blue: '#2f4f8a', red: '#a63a3c', green: '#2f5f40' };

export const TEAMS: readonly Team[] = [
  {
    base: '#1f4fb5',
    accent: '#f2f2f2',
    accent2: '#f0c020',
    dress: DRESS.blue,
    neutral: WHITE,
  },
  {
    base: '#c4262e',
    accent: '#f2f2f2',
    accent2: '#1a1a1a',
    dress: DRESS.red,
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#eeeeee',
    accent: '#1f9a4a',
    accent2: '#1a1a1a',
    dress: DRESS.green,
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#e8741a',
    accent: '#1a1a1a',
    accent2: '#f2f2f2',
    dress: DRESS.red,
    neutral: CHARCOAL,
  },
  {
    base: '#f0c020',
    accent: '#1a1a1a',
    accent2: '#1f4fb5',
    dress: DRESS.red,
    neutral: CHARCOAL,
    plain: true,
  },
  {
    base: '#3b3f46',
    accent: '#9bd11f',
    accent2: '#f2f2f2',
    dress: DRESS.green,
    neutral: WHITE,
  },
  {
    base: '#6a2fa0',
    accent: '#f2f2f2',
    accent2: '#e0409a',
    dress: DRESS.blue,
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#14908c',
    accent: '#f2f2f2',
    accent2: '#e8741a',
    dress: DRESS.blue,
    neutral: WHITE,
  },
  {
    base: '#1b1b1f',
    accent: '#d3202a',
    accent2: '#f2f2f2',
    dress: DRESS.red,
    neutral: WHITE,
  },
  {
    base: '#4aa3df',
    accent: '#14306b',
    accent2: '#f2f2f2',
    dress: DRESS.blue,
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#1d6b3a',
    accent: '#f0c020',
    accent2: '#f2f2f2',
    dress: DRESS.green,
    neutral: WHITE,
  },
  {
    base: '#7a1f2e',
    accent: '#d4a82a',
    accent2: '#f2f2f2',
    dress: DRESS.red,
    neutral: WHITE,
    plain: true,
  },
];

/** The organiser's colour (start arch and its banners, timekeeper tent, officials' blue tabards): the dressing blue. */
export const EVENT_COLOR = DRESS.blue;

/** Trim on the dressing (thin stripes, flag tips): a mid grey that sits on both neutrals. */
const TRIM = '#8d9096';

/**
 * Park dressing of a team: the colour of its tents, vans and trucks, of the band / stripe on them and of the thin
 * trim. Only the three `DRESS` colours and the neutrals, whatever the team's livery.
 */
export function teamDress(t: Team): {
  main: string;
  band: string;
  trim: string;
} {
  return t.plain
    ? { main: t.neutral, band: t.dress, trim: TRIM }
    : { main: t.dress, band: t.neutral, trim: TRIM };
}

export const TEAM_COUNT = TEAMS.length;

/** The boxy car shape (vehicles.ts SHAPES index) each team runs. */
export const TEAM_SHAPE: readonly number[] = [
  0, 2, 5, 3, 1, 6, 7, 4, 3, 0, 2, 5,
];
