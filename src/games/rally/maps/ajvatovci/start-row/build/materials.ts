import {
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { getTexture, type TextureId } from '../../../../engine/textures';

/**
 * Materials of the start row. Every material is a MeshStandardMaterial with vertex colours (the
 * geometry carries each building's paint), so a handful of materials - and draw calls - cover the
 * whole row. `tile` is the size in metres one texture repeat covers; the geometry helpers bake UVs
 * as metres / tile.
 */
interface MatDef {
  map?: TextureId;
  /** Metres one repeat of the texture covers (u, v). */
  tile: [number, number];
  roughness: number;
  metalness?: number;
  /**
   * Ground decal layer: pulled towards the camera so it never z-fights what is under it. 1 = ground
   * (yards, lawn), 2 = on top of that (patches, patio), 3 = painted markings.
   */
  decal?: 1 | 2 | 3;
  alphaTest?: number;
  doubleSided?: boolean;
  envMapIntensity?: number;
  /** Does it cast shadows (ground decals and glass do not). */
  shadow?: boolean;
  flatShading?: boolean;
  /** < 1: see-through (clear glass). */
  opacity?: number;
  /** Alpha-blended (mesh fences: thin lines that mip down to a faint haze instead of vanishing). */
  blend?: boolean;
}

export const MATS = {
  /** Painted render walls. */
  render: { map: 'lot_render', tile: [4, 4], roughness: 0.93 },
  /** Insulated sandwich-panel cladding. */
  panel: { map: 'lot_panel', tile: [4, 4], roughness: 0.55, metalness: 0.12 },
  /** Trapezoid steel sheeting (walls, hipped roofs). */
  sheet: { map: 'lot_sheet', tile: [2, 2], roughness: 0.5, metalness: 0.3 },
  /** Roller door slats. */
  roller: {
    map: 'lot_roller_door',
    tile: [1, 0.9],
    roughness: 0.45,
    metalness: 0.35,
  },
  /** Window / curtain-wall glazing; UVs 0..1 per pane. */
  glass: {
    map: 'lot_glass',
    tile: [1, 1],
    roughness: 0.06,
    metalness: 0.55,
    envMapIntensity: 4,
    shadow: false,
  },
  /** Clear balustrade glass. */
  railGlass: {
    tile: [1, 1],
    roughness: 0.04,
    metalness: 0.1,
    opacity: 0.22,
    envMapIntensity: 3,
    shadow: false,
  },
  /** Flat roofs. */
  roofing: { map: 'lot_roofing', tile: [4, 4], roughness: 0.9 },
  /** Solar panels; UVs 0..1 per panel. */
  solar: {
    map: 'lot_solar',
    tile: [1, 1],
    roughness: 0.22,
    metalness: 0.5,
    envMapIntensity: 3,
  },
  /** Fascia sign; UVs 0..1. */
  sign: { map: 'lot_sign_mileks', tile: [1, 1], roughness: 0.6 },
  /** Red-white striped barrier. */
  barrier: { map: 'lot_barrier', tile: [1, 1], roughness: 0.8 },
  /** Wire mesh fence (alpha-tested). */
  fence: {
    map: 'lot_fence',
    tile: [0.5, 0.5],
    roughness: 0.6,
    metalness: 0.6,
    blend: true,
    doubleSided: true,
    shadow: false,
  },
  /** Plain painted surfaces (trim, frames, posts): vertex colour only. */
  paint: { tile: [1, 1], roughness: 0.75 },
  /** Bare metal (frames, rails, poles, pipes). */
  metal: { tile: [1, 1], roughness: 0.4, metalness: 0.75 },
  /** Foliage and soil (flat shaded, vertex colour). */
  leaf: { tile: [1, 1], roughness: 1, flatShading: true },
  /** Yard asphalt. */
  asphalt: {
    map: 'lot_asphalt',
    tile: [5, 5],
    roughness: 0.96,
    decal: 1,
    shadow: false,
  },
  /** Loose gravel (construction sites). */
  gravel: {
    map: 'gravel',
    tile: [4, 4],
    roughness: 1,
    decal: 1,
    shadow: false,
  },
  /** Concrete block paving (yards, sidewalks). */
  pavers: {
    map: 'lot_pavers',
    tile: [3.2, 3.2],
    roughness: 0.9,
    decal: 1,
    shadow: false,
  },
  /** Concrete slabs (aprons, kerbs, patios). */
  concrete: {
    map: 'lot_concrete',
    tile: [4, 4],
    roughness: 0.92,
    decal: 1,
    shadow: false,
  },
  /** A patch of paving or slabs laid over a yard (its own layer so it never fights the yard under it). */
  patchConcrete: {
    map: 'lot_concrete',
    tile: [4, 4],
    roughness: 0.92,
    decal: 2,
    shadow: false,
  },
  patchPavers: {
    map: 'lot_pavers',
    tile: [3.2, 3.2],
    roughness: 0.9,
    decal: 2,
    shadow: false,
  },
  /** Lawn. */
  lawn: {
    map: 'grass',
    tile: [3, 3],
    roughness: 1,
    decal: 1,
    shadow: false,
  },
  /** Painted road markings / parking bays: vertex colour on a decal. */
  marking: { tile: [1, 1], roughness: 0.7, decal: 3, shadow: false },
} satisfies Record<string, MatDef>;

export type MatKey = keyof typeof MATS;

const cache = new Map<MatKey, Material>();

/** The shared material for `key` (created on first use; needs the DOM for its texture). */
export function lotMaterial(key: MatKey): Material {
  let m = cache.get(key);
  if (m) return m;
  const def: MatDef = MATS[key];
  m = new MeshStandardMaterial({
    map: def.map ? getTexture(def.map) : null,
    vertexColors: true,
    roughness: def.roughness,
    metalness: def.metalness ?? 0,
    envMapIntensity: def.envMapIntensity ?? 1,
    alphaTest: def.alphaTest ?? 0,
    side: def.doubleSided ? DoubleSide : FrontSide,
    flatShading: def.flatShading ?? false,
    transparent: def.opacity !== undefined || !!def.blend,
    opacity: def.opacity ?? 1,
    depthWrite: def.opacity === undefined && !def.blend,
    polygonOffset: !!def.decal,
    polygonOffsetFactor: -2 * (def.decal ?? 0),
    polygonOffsetUnits: -4 * (def.decal ?? 0),
  });
  m.name = `lot_${key}`;
  cache.set(key, m);
  return m;
}

export const castsShadow = (key: MatKey): boolean => {
  const def: MatDef = MATS[key];
  return def.shadow ?? true;
};

export const tileOf = (key: MatKey): [number, number] => MATS[key].tile;
