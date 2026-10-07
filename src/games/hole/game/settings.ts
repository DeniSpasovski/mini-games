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

export function loadSettings(store: KV): HoleSettings {
  try {
    const raw = store.getItem(KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
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
