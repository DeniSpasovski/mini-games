/**
 * Generic service-park teams, no names, logos or lettering. The team index is the variant of every team-coloured asset
 * (trucks, vans, gazebos, flags, cars) and picks the crew's overalls. `base` / `accent` / `accent2` are the livery of the
 * team's cars and the crew's overalls; the park dressing (tents, flags, vans, trucks) wears the quieter `dress` (the team
 * colour as dyed fabric / fleet paint) next to a `neutral`, and a `plain` team keeps its tents and vans in the neutral
 * with the team colour only on the bands and stripes.
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

export const TEAMS: readonly Team[] = [
  {
    base: '#1f4fb5',
    accent: '#f2f2f2',
    accent2: '#f0c020',
    dress: '#2f4f8a',
    neutral: WHITE,
  },
  {
    base: '#c4262e',
    accent: '#f2f2f2',
    accent2: '#1a1a1a',
    dress: '#a63a3c',
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#eeeeee',
    accent: '#1f9a4a',
    accent2: '#1a1a1a',
    dress: '#3f7d55',
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#e8741a',
    accent: '#1a1a1a',
    accent2: '#f2f2f2',
    dress: '#c4703a',
    neutral: CHARCOAL,
  },
  {
    base: '#f0c020',
    accent: '#1a1a1a',
    accent2: '#1f4fb5',
    dress: '#cfa93e',
    neutral: CHARCOAL,
    plain: true,
  },
  {
    base: '#3b3f46',
    accent: '#9bd11f',
    accent2: '#f2f2f2',
    dress: '#454a52',
    neutral: WHITE,
  },
  {
    base: '#6a2fa0',
    accent: '#f2f2f2',
    accent2: '#e0409a',
    dress: '#5d437c',
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#14908c',
    accent: '#f2f2f2',
    accent2: '#e8741a',
    dress: '#357d79',
    neutral: WHITE,
  },
  {
    base: '#1b1b1f',
    accent: '#d3202a',
    accent2: '#f2f2f2',
    dress: '#26272b',
    neutral: '#c6c8ca',
  },
  {
    base: '#4aa3df',
    accent: '#14306b',
    accent2: '#f2f2f2',
    dress: '#5f93b8',
    neutral: WHITE,
    plain: true,
  },
  {
    base: '#1d6b3a',
    accent: '#f0c020',
    accent2: '#f2f2f2',
    dress: '#2f5f40',
    neutral: WHITE,
  },
  {
    base: '#7a1f2e',
    accent: '#d4a82a',
    accent2: '#f2f2f2',
    dress: '#6e2f39',
    neutral: '#dcd7cb',
    plain: true,
  },
];

/** The organiser's colour (start arch, timekeeper tent): a quiet blue next to white. */
export const EVENT_COLOR = '#2f5a9c';

/** Park dressing of a team: the colour of its tents, vans and trucks, and of the band / stripe on them. */
export function teamDress(t: Team): { main: string; band: string } {
  return t.plain
    ? { main: t.neutral, band: t.dress }
    : { main: t.dress, band: t.accent };
}

export const TEAM_COUNT = TEAMS.length;

/** The boxy car shape (vehicles.ts SHAPES index) each team runs. */
export const TEAM_SHAPE: readonly number[] = [
  0, 2, 5, 3, 1, 6, 7, 4, 3, 0, 2, 5,
];
