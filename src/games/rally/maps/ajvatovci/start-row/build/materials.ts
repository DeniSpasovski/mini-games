import {
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  ShaderChunk,
  type DataArrayTexture,
  type Material,
} from 'three';
import { getTexture, type TextureId } from '../../../../engine/textures';
import { textureArray } from '../../../../engine/texture-array';
import { addWorldUniforms } from '../../../../engine/world-shading';

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
  /** Ilinden station name board (maps/ajvatovci/station); UVs 0..1. */
  stationSign: { map: 'lot_sign_station', tile: [1, 1], roughness: 0.55 },
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
  /** Asphalt laid over another ground decal (the hilltop gate apron over the gravel car park). */
  patchAsphalt: {
    map: 'lot_asphalt',
    tile: [5, 5],
    roughness: 0.96,
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
  /** Hilltop church (maps/ajvatovci/hilltop): rough-cut limestone walls. */
  ashlar: { map: 'lot_ashlar', tile: [2, 2], roughness: 0.92 },
  /** Hilltop bell tower: rubble stone masonry. */
  rubble: { map: 'lot_rubble', tile: [2, 2], roughness: 0.95 },
  /** Low concrete walls (the hilltop courtyard wall). */
  wall: { map: 'lot_concrete', tile: [4, 4], roughness: 0.92 },
  /** Clay roof tiles: u along the eaves, v up the slope. */
  tiles: { map: 'lot_roof_tiles', tile: [2, 2], roughness: 0.8 },
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

/**
 * Material groups: the keys of a group share ONE material (and one mesh per tile) - their textures are
 * layers of one texture array and roughness / metalness / env strength ride on a per-vertex `lotMat`
 * attribute. Cuts the row's ~20 materials per tile to a handful of draw calls. Keys outside a group
 * keep their own material: signs (wide textures), glass (casts no shadow; in 'solid' the panes shadow their
 * own frames), fence, leaf (flat shaded), markings.
 */
export type MatGroup = 'solid' | 'ground' | 'patch';
const GROUPS: Partial<Record<MatKey, MatGroup>> = {
  render: 'solid',
  panel: 'solid',
  sheet: 'solid',
  roller: 'solid',
  roofing: 'solid',
  solar: 'solid',
  barrier: 'solid',
  paint: 'solid',
  metal: 'solid',
  ashlar: 'solid',
  rubble: 'solid',
  wall: 'solid',
  tiles: 'solid',
  asphalt: 'ground',
  gravel: 'ground',
  pavers: 'ground',
  concrete: 'ground',
  lawn: 'ground',
  patchConcrete: 'patch',
  patchAsphalt: 'patch',
  patchPavers: 'patch',
};
/** Decal layer of each group (same polygon offsets as the single materials). */
const GROUP_DECAL: Record<MatGroup, number> = { solid: 0, ground: 1, patch: 2 };
/** Side of a texture-array layer (px); every texture is resampled to it. */
const LAYER = 512;

export const groupOf = (key: MatKey): MatGroup | undefined => GROUPS[key];

let layers: TextureId[] | undefined;
const layerIds = (): TextureId[] =>
  (layers ??= [
    ...new Set(
      (Object.keys(GROUPS) as MatKey[])
        .map((k) => (MATS[k] as MatDef).map)
        .filter((m): m is TextureId => !!m),
    ),
  ]);

/** Per-vertex material of a grouped key: texture layer (-1 = none), roughness, metalness, env strength. */
export function lotMatOf(key: MatKey): [number, number, number, number] {
  const def: MatDef = MATS[key];
  return [
    def.map ? layerIds().indexOf(def.map) : -1,
    def.roughness,
    def.metalness ?? 0,
    def.envMapIntensity ?? 1,
  ];
}

let array: DataArrayTexture | undefined;
/** Every grouped key's texture, resampled to LAYER x LAYER, as one sRGB texture array. */
const lotArray = (): DataArrayTexture =>
  (array ??= textureArray(layerIds(), LAYER));

const groupCache = new Map<string, Material>();

/**
 * The shared material of a group (vertex colours x array layer; PBR values per vertex). `plain`: vertex colours only,
 * no texture array - for landmarks that use only untextured keys (building the array renders every lot texture).
 */
export function groupMaterial(group: MatGroup, plain = false): Material {
  const cacheKey = plain ? `${group}-plain` : group;
  const m = groupCache.get(cacheKey);
  if (m) return m;
  const decal = GROUP_DECAL[group];
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    polygonOffset: decal > 0,
    polygonOffsetFactor: -2 * decal,
    polygonOffsetUnits: -4 * decal,
  });
  const maps = plain ? undefined : { value: lotArray() };
  mat.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    if (maps) shader.uniforms.lotMaps = maps;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 lotMat;\nvarying vec4 vLotMat;\nvarying vec2 vLotUv;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLotMat = lotMat;\nvLotUv = uv;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        plain
          ? '#include <common>\nvarying vec4 vLotMat;\nvarying vec2 vLotUv;'
          : '#include <common>\nuniform mediump sampler2DArray lotMaps;\nvarying vec4 vLotMat;\nvarying vec2 vLotUv;',
      )
      .replace(
        '#include <map_fragment>',
        plain
          ? ''
          : // Sampled outside any branch (a layer change across a pixel quad keeps its derivatives).
            'vec4 lotTex = texture( lotMaps, vec3( vLotUv, max( floor( vLotMat.x + 0.5 ), 0.0 ) ) );\n' +
              'diffuseColor *= vLotMat.x < -0.5 ? vec4( 1.0 ) : lotTex;',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = vLotMat.y;',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        'float metalnessFactor = vLotMat.z;',
      )
      .replace(
        // The uniform carries scene.environmentIntensity (scene.environment lit materials): scale it, never replace it.
        '#include <envmap_physical_pars_fragment>',
        ShaderChunk.envmap_physical_pars_fragment
          .split('envMapIntensity')
          .join('( envMapIntensity * vLotMat.w )'),
      );
  };
  mat.customProgramCacheKey = () => (plain ? 'lot-plain-v1' : 'lot-array-v2');
  mat.name = `lot_${cacheKey}`;
  groupCache.set(cacheKey, mat);
  return mat;
}

export const groupCastsShadow = (group: MatGroup): boolean => group === 'solid';

export const castsShadow = (key: MatKey): boolean => {
  const def: MatDef = MATS[key];
  return def.shadow ?? true;
};

export const tileOf = (key: MatKey): [number, number] => MATS[key].tile;
