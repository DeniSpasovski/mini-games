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
  /** Main menu music volume 0..1, 0 = off (own slider; the race has no music). */
  musicVolume: number;
  /** Gearbox at the start of a stage (G toggles in game). */
  automatic: boolean;
  /** Traction / stability assist at the start of a stage (T toggles in game). */
  traction: boolean;
  /** Anti-lock brakes at the start of a stage (B toggles in game). */
  abs: boolean;
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
  musicVolume: 0.2,
  automatic: true,
  traction: true,
  abs: true,
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

const CAMERAS: readonly CameraMode[] = ['chase', 'chase_far', 'hood', 'bumper'];
const DISTANCES = Object.keys(OBJECT_DISTANCE) as ObjectDistance[];

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def;
}

/** Stored JSON -> settings: each field falls back to its default when missing or invalid. */
export function sanitizeSettings(raw: unknown): RallySettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    volume:
      typeof o.volume === 'number' && Number.isFinite(o.volume)
        ? Math.min(1, Math.max(0, o.volume))
        : d.volume,
    musicVolume:
      typeof o.musicVolume === 'number' && Number.isFinite(o.musicVolume)
        ? Math.min(1, Math.max(0, o.musicVolume))
        : d.musicVolume,
    automatic: bool(o.automatic, d.automatic),
    traction: bool(o.traction, d.traction),
    abs: bool(o.abs, d.abs),
    carNumber:
      typeof o.carNumber === 'number'
        ? clampCarNumber(o.carNumber)
        : d.carNumber,
    camera: oneOf(o.camera, CAMERAS, d.camera),
    objectDistance: oneOf(o.objectDistance, DISTANCES, d.objectDistance),
    map: typeof o.map === 'string' ? o.map : d.map,
    car: typeof o.car === 'string' ? o.car : d.car,
    livery:
      typeof o.livery === 'number' &&
      Number.isSafeInteger(o.livery) &&
      o.livery >= 0
        ? o.livery
        : d.livery,
  };
}

export function loadSettings(): RallySettings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
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
