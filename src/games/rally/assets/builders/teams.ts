/**
 * Generic service-park teams: three colours each, no names, logos or lettering. The team index is the variant of
 * every team-coloured asset (trucks, vans, gazebos, flags, cars) and picks the crew's overalls.
 */
export interface Team {
  base: string;
  accent: string;
  accent2: string;
}

export const TEAMS: readonly Team[] = [
  { base: '#1f4fb5', accent: '#f2f2f2', accent2: '#f0c020' },
  { base: '#c4262e', accent: '#f2f2f2', accent2: '#1a1a1a' },
  { base: '#eeeeee', accent: '#1f9a4a', accent2: '#1a1a1a' },
  { base: '#e8741a', accent: '#1a1a1a', accent2: '#f2f2f2' },
  { base: '#f0c020', accent: '#1a1a1a', accent2: '#1f4fb5' },
  { base: '#3b3f46', accent: '#9bd11f', accent2: '#f2f2f2' },
  { base: '#6a2fa0', accent: '#f2f2f2', accent2: '#e0409a' },
  { base: '#14908c', accent: '#f2f2f2', accent2: '#e8741a' },
  { base: '#1b1b1f', accent: '#d3202a', accent2: '#f2f2f2' },
  { base: '#4aa3df', accent: '#14306b', accent2: '#f2f2f2' },
  { base: '#1d6b3a', accent: '#f0c020', accent2: '#f2f2f2' },
  { base: '#7a1f2e', accent: '#d4a82a', accent2: '#f2f2f2' },
];

export const TEAM_COUNT = TEAMS.length;
