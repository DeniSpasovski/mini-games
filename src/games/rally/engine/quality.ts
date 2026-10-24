/**
 * Graphics quality presets. Picked with `?quality=low|medium|high` or saved in
 * localStorage by the in-game menu. Everything perf-sensitive reads from here.
 */
export interface QualitySettings {
  name: QualityName;
  /** Cap for devicePixelRatio. */
  maxPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  /** Half-size of the shadow camera box around the focus point (m). */
  shadowExtent: number;
  /**
   * Trees cast into the shadow map within this distance of the camera (m); the shadow map fades out before a tree
   * past it could shade the ground (game/rally-game.ts `nearShadowFade`).
   */
  treeShadowDistance: number;
  /** The far shadow map (engine/far-shadow.ts): size (0 = off) and half-size of its box (m). */
  farShadowSize: number;
  farShadowExtent: number;
  /** Terrain chunks are drawn up to this distance (m). */
  viewDistance: number;
  /** Multiplies every asset LOD distance (and therefore draw distance) and the terrain LOD bands. */
  lodScale: number;
  /**
   * The procedural trees' lodScale (trees/draw.ts: divides their screen-height thresholds): lower = impostors and
   * coarser branches closer. Trees are the biggest GPU cost of a forest stage, so medium / low bring them in further
   * than the other assets; the full-detail distance (trees/species.ts) never moves.
   */
  treeLodScale: number;
  /** Trees are drawn up to this distance (m); past it the canopy shell (world/far-forest.ts). */
  forestDistance: number;
  /** Multiplies detail-layer (grass) density, 0 disables it. */
  detailDensity: number;
  /** Max dust particles alive. */
  particles: number;
}

export type QualityName = 'low' | 'medium' | 'high';

export const QUALITY: Record<QualityName, QualitySettings> = {
  low: {
    name: 'low',
    maxPixelRatio: 1,
    antialias: false,
    shadowMapSize: 1024,
    shadowExtent: 45,
    treeShadowDistance: 70,
    farShadowSize: 1024,
    farShadowExtent: 160,
    viewDistance: 1100,
    lodScale: 0.7,
    treeLodScale: 0.35,
    forestDistance: 400,
    detailDensity: 0.35,
    particles: 600,
  },
  medium: {
    name: 'medium',
    maxPixelRatio: 1.25,
    antialias: true,
    shadowMapSize: 2048,
    shadowExtent: 60,
    treeShadowDistance: 95,
    farShadowSize: 2048,
    farShadowExtent: 220,
    viewDistance: 1700,
    lodScale: 1,
    treeLodScale: 0.5,
    forestDistance: 500,
    detailDensity: 0.7,
    particles: 1200,
  },
  high: {
    name: 'high',
    maxPixelRatio: 2,
    antialias: true,
    shadowMapSize: 4096,
    shadowExtent: 75,
    treeShadowDistance: 100,
    farShadowSize: 2048,
    farShadowExtent: 280,
    viewDistance: 2400,
    lodScale: 1.3,
    treeLodScale: 1.3,
    forestDistance: 600,
    detailDensity: 1,
    particles: 2000,
  },
};

const KEY = 'rally.quality';
/** Measured pick (menu FPS probe), used only while the player has no choice of their own. */
const AUTO_KEY = 'rally.quality.auto';

function readKey(key: string): QualityName | null {
  try {
    const v = localStorage.getItem(key);
    return v && Object.prototype.hasOwnProperty.call(QUALITY, v)
      ? (v as QualityName)
      : null;
  } catch {
    return null;
  }
}

/** True while nothing picked a quality yet (no URL param, no saved choice, no earlier measurement). */
export function needsAutoQuality(): boolean {
  return (
    !new URLSearchParams(location.search).get('quality') &&
    !readKey(KEY) &&
    !readKey(AUTO_KEY)
  );
}

/** Median frame time (ms) of the medium-quality menu -> preset. Only an old phone drops to low; 100+ fps earns high. */
export function qualityForFrameMs(ms: number): QualityName {
  if (ms > 1000 / 40) return 'low';
  if (ms < 1000 / 100) return 'high';
  return 'medium';
}

export function saveAutoQuality(name: QualityName): void {
  try {
    // A manual choice made meanwhile always wins.
    if (!localStorage.getItem(KEY)) localStorage.setItem(AUTO_KEY, name);
  } catch {
    // storage unavailable - the probe just runs again next visit
  }
}

export function loadQuality(): QualitySettings {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  let name = fromUrl as QualityName | null;
  if (!name) name = readKey(KEY) ?? readKey(AUTO_KEY);
  return QUALITY[
    name && Object.prototype.hasOwnProperty.call(QUALITY, name)
      ? name
      : 'medium'
  ];
}

export function saveQuality(name: QualityName): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // storage unavailable - fine, quality just won't persist
  }
}
