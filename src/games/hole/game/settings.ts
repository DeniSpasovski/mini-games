import type { KV } from './storage';

export interface HoleSettings {
  color: string;
  volume: number;
  quality: 'auto' | 'low' | 'high';
  difficulty: 'easy' | 'medium' | 'hard';
  /** Last played map id. */
  map: string;
  /** Island / store seed (the menu stepper). */
  seed: number;
}

export const DEFAULT_SETTINGS: HoleSettings = {
  color: 'ocean',
  volume: 0.7,
  quality: 'auto',
  difficulty: 'medium',
  map: 'city',
  seed: 1,
};

const KEY = 'hole.settings';

const QUALITIES: readonly HoleSettings['quality'][] = ['auto', 'low', 'high'];
const DIFFICULTIES: readonly HoleSettings['difficulty'][] = [
  'easy',
  'medium',
  'hard',
];

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def;
}

function str(v: unknown, def: string): string {
  return typeof v === 'string' && v !== '' ? v : def;
}

/** Stored JSON -> settings: each field falls back to its default when missing or invalid. */
export function sanitizeSettings(raw: unknown): HoleSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_SETTINGS;
  return {
    color: str(o.color, d.color),
    volume:
      typeof o.volume === 'number' && Number.isFinite(o.volume)
        ? Math.min(1, Math.max(0, o.volume))
        : d.volume,
    quality: oneOf(o.quality, QUALITIES, d.quality),
    difficulty: oneOf(o.difficulty, DIFFICULTIES, d.difficulty),
    map: str(o.map, d.map),
    seed:
      typeof o.seed === 'number' && Number.isSafeInteger(o.seed)
        ? o.seed
        : d.seed,
  };
}

export function loadSettings(store: KV): HoleSettings {
  try {
    const raw = store.getItem(KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(store: KV, s: HoleSettings): void {
  try {
    store.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
