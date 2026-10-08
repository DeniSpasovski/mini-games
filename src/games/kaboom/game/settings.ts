import { MAP_SIZES, MAP_SIZE_IDS } from '../map/sizes';
import {
  CRITTERS,
  type CritterId,
  type Difficulty,
  type MapSizeId,
  type RoundCount,
} from '../sim/types';
import { TEAM_COUNT } from '../sim/rules';
import type { KV } from './storage';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const ROUND_COUNTS: readonly RoundCount[] = [1, 3, 5];
export const QUALITIES = ['auto', 'low', 'high'] as const;
export type QualitySetting = (typeof QUALITIES)[number];

/** What the menu remembers between visits. */
export interface KaboomSettings {
  critter: CritterId;
  /** Team colour: index into the team palette (`TEAM_COLORS`). */
  color: number;
  bots: number;
  difficulty: Difficulty;
  size: MapSizeId;
  rounds: RoundCount;
  volume: number;
  quality: QualitySetting;
}

export const DEFAULT_SETTINGS: KaboomSettings = {
  critter: 'mole',
  color: 0,
  bots: 3,
  difficulty: 'normal',
  size: 'm',
  rounds: 3,
  volume: 0.7,
  quality: 'auto',
};

const SETTINGS_KEY = 'kaboom.settings';
const STATS_KEY = 'kaboom.stats';

function oneOf<T>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def;
}

/** Bots allowed on a map size: at least 1, at most its player count - 1 (you take one spawn). */
export function clampBots(size: MapSizeId, bots: number): number {
  return Math.min(
    MAP_SIZES[size].maxPlayers - 1,
    Math.max(1, Math.round(bots)),
  );
}

/** Stored JSON -> settings: each field falls back to its default when missing or invalid. */
export function sanitizeSettings(raw: unknown): KaboomSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_SETTINGS;
  const size = oneOf(o.size, MAP_SIZE_IDS, d.size);
  return {
    critter: oneOf(o.critter, CRITTERS, d.critter),
    color:
      typeof o.color === 'number' &&
      Number.isInteger(o.color) &&
      o.color >= 0 &&
      o.color < TEAM_COUNT
        ? o.color
        : d.color,
    bots: clampBots(
      size,
      typeof o.bots === 'number' && Number.isFinite(o.bots) ? o.bots : d.bots,
    ),
    difficulty: oneOf(o.difficulty, DIFFICULTIES, d.difficulty),
    size,
    rounds: oneOf(o.rounds, ROUND_COUNTS, d.rounds),
    volume:
      typeof o.volume === 'number' && Number.isFinite(o.volume)
        ? Math.min(1, Math.max(0, o.volume))
        : d.volume,
    quality: oneOf(o.quality, QUALITIES, d.quality),
  };
}

export function loadSettings(store: KV): KaboomSettings {
  try {
    const raw = store.getItem(SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(store: KV, s: KaboomSettings): void {
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full / blocked: the menu just forgets */
  }
}

/** Win counts, kept per device (no accounts): matches and match wins, overall and per critter. */
export interface KaboomStats {
  matches: number;
  wins: number;
  byCritter: Partial<Record<CritterId, { played: number; won: number }>>;
}

export function loadStats(store: KV): KaboomStats {
  const empty: KaboomStats = { matches: 0, wins: 0, byCritter: {} };
  try {
    const raw = store.getItem(STATS_KEY);
    if (!raw) return empty;
    const o = JSON.parse(raw) as Partial<KaboomStats>;
    const byCritter: KaboomStats['byCritter'] = {};
    for (const id of CRITTERS) {
      const c = o.byCritter?.[id];
      if (c && Number.isFinite(c.played) && Number.isFinite(c.won))
        byCritter[id] = {
          played: Math.max(0, c.played),
          won: Math.max(0, c.won),
        };
    }
    return {
      matches: Number.isFinite(o.matches)
        ? Math.max(0, o.matches as number)
        : 0,
      wins: Number.isFinite(o.wins) ? Math.max(0, o.wins as number) : 0,
      byCritter,
    };
  } catch {
    return empty;
  }
}

/** Count one finished match played as `critter` (against the bots). */
export function recordMatch(
  store: KV,
  critter: CritterId,
  won: boolean,
): KaboomStats {
  const s = loadStats(store);
  s.matches++;
  if (won) s.wins++;
  const c = (s.byCritter[critter] ??= { played: 0, won: 0 });
  c.played++;
  if (won) c.won++;
  try {
    store.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}
