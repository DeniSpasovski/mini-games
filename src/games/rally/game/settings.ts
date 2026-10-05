import { clampCarNumber } from '../cars/shared/rally-badge';
import type { CameraMode } from './camera-rig';

/**
 * Player options + last menu selection, persisted in localStorage
 * (`rally.settings`). Graphics quality lives in engine/quality.ts (own key,
 * also read by the tool pages).
 */
export interface RallySettings {
  /** Master volume 0..1. */
  volume: number;
  /** Gearbox at the start of a stage (G toggles in game). */
  automatic: boolean;
  /** Traction / stability assist at the start of a stage (T toggles in game). */
  traction: boolean;
  /** Start number on the rally door plates (1..99; the rally name comes from the map). */
  carNumber: number;
  /** Starting camera (C cycles in game). */
  camera: CameraMode;
  /** How far trees, buildings and props are drawn (multiplies the graphics preset's LOD distances). */
  objectDistance: ObjectDistance;
  /** Last selection in the menu, preselected next time. */
  map: string;
  car: string;
  livery: number;
}

export const DEFAULT_SETTINGS: RallySettings = {
  volume: 0.5,
  automatic: true,
  traction: true,
  carNumber: 7,
  camera: 'chase',
  objectDistance: 'normal',
  map: '',
  car: '',
  livery: 0,
};

export type ObjectDistance = 'normal' | 'far' | 'max';

/** Object draw distance option -> multiplier on the quality preset's `lodScale` (objects only, not terrain). */
export const OBJECT_DISTANCE: Record<ObjectDistance, number> = {
  normal: 1,
  far: 1.5,
  max: 2,
};

const KEY = 'rally.settings';

export function loadSettings(): RallySettings {
  try {
    const raw = localStorage.getItem(KEY);
    const s: RallySettings = {
      ...DEFAULT_SETTINGS,
      ...(raw ? JSON.parse(raw) : {}),
    };
    s.carNumber = clampCarNumber(s.carNumber);
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Merge `patch` into the stored settings and return the result. */
export function saveSettings(patch: Partial<RallySettings>): RallySettings {
  const s = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable - settings just won't persist
  }
  return s;
}
