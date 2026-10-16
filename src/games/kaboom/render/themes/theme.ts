import type { BufferGeometry, Color, Material, Object3D } from 'three';
import type { Rng } from '../../../../shared/rng';
import type { LevelId } from '../../game/levels';
import type { MapData } from '../../sim/types';
import type { DecorParts } from '../parts';
import type { Quality } from '../renderer';

/** Colours of the FX that are not fire: dust, splinters, scorch marks (the blast itself looks the same in every level). */
export type Rgb = readonly [number, number, number];
/** Colours are raw shader values (0-1, converted to sRGB on output), like the constants they replace. */
export interface FxTint {
  dustDark: Rgb;
  dustLight: Rgb;
  /** Three splinter shades (crate wood, hay, barrel staves ...). */
  wood: readonly [Rgb, Rgb, Rgb];
  scorch: Rgb;
}

/** What `Arena` hands a level when it builds the scenery round the platform. */
export interface SceneryCtx {
  map: MapData;
  w: number;
  h: number;
  /** Half extents of the floor incl. the margin (world units). */
  hx: number;
  hz: number;
  rng: Rng;
  /** Clay materials with vertex colours (`lit` also glows with the flames). */
  flat: Material;
  lit: Material;
  quality: Quality;
}

/** Everything round the platform that does not move with it: the bowl, the rim, the water, the boats. */
export interface Scenery {
  objects: Object3D[];
  /** Once per frame, `t` = the FX clock. */
  update?(t: number): void;
  /** A tile sank into the water at world `(x, z)`; the splash lands at clock time `t`. */
  ripple?(x: number, z: number, t: number): void;
  dispose?(): void;
}

/** Where the crowd sits: the rings, how high, and which stretches of a ring have seats. */
export interface CrowdLayout {
  /** `[x0, z0, x1, z1, ...]` of the ring at offset `d` (same point count for every `d`). */
  ring(hx: number, hz: number, d: number): number[];
  /** Height of terrace `tier` at `(x, z)`. */
  height(tier: number, x: number, z: number): number;
  /** Rows of spectators (one fewer on low quality). Default: the bowl's `TIERS`. */
  tiers?: number;
  /** Offset of row `t` from the floor. Default: the middle of terrace `t` of the bowl. */
  rowD?(t: number): number;
  /** Is there a seat at fractional ring-point index `i`? Default: everywhere. */
  seat?(i: number, n: number, hx: number, hz: number): boolean;
}

/** How the whole platform sits on the sea this frame (Sea Deck bobs and rolls; the others stand still). */
export interface PlatformPose {
  y: number;
  rx: number;
  rz: number;
}

export interface TileLook {
  colors: readonly number[];
  geometry(): BufferGeometry;
  /** The geometry carries its own vertex colours (planks). */
  vertexColors: boolean;
  /** Turn every second tile a quarter, so planks run both ways. */
  rotate: boolean;
  /** Tint of one tile (instance colour). */
  tint(x: number, y: number, r: Rng, out: Color): void;
}

/**
 * A level = a look: palette, models, scenery, sky, light and a few FX flavours. The rules, the generator, the bots and
 * the sim never see it (DETAILS.md "Levels"); `Arena` / `Crowd` / `WorldView` / `Fx` read it.
 */
export interface LevelTheme {
  id: LevelId;
  sky: readonly [string, string, string];
  light: {
    key: number;
    keyIntensity: number;
    sky: number;
    ground: number;
    fill: number;
  };
  fx: FxTint;
  /** Colour of the squares that mark where the next sudden-death cell falls. */
  warnColor: number;
  /** Sudden death: a wall lands on the cell (`wall`) or the tile under it sinks into the sea (`tile`). */
  fall: 'wall' | 'tile';
  /** Hard-block variants a falling wall may use. */
  wallVariants: readonly number[];
  tiles: TileLook;
  hard: readonly [() => BufferGeometry, () => BufferGeometry];
  crate: readonly [() => BufferGeometry, () => BufferGeometry];
  floor(w: number, h: number, pad: number): BufferGeometry;
  decor(w: number, h: number, pad: number): DecorParts;
  /** Extra meshes that ride on the platform (grass tufts, the raft's frame and barrels). */
  platformExtras?(ctx: SceneryCtx): Object3D[];
  scenery(ctx: SceneryCtx): Scenery;
  crowd: CrowdLayout;
  /** Platform motion; absent = fixed. */
  motion?(t: number, quality: Quality, out: PlatformPose): void;
}
