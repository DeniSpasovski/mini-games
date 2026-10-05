import { DoubleSide, MeshStandardMaterial, type Material } from 'three';
import { getTexture } from './textures';

/**
 * Shared material library. Assets reference materials by id so thousands of
 * instances / dozens of asset types share a handful of GPU programs.
 */
export type MaterialId =
  | 'vegetation'
  | 'foliage_card'
  | 'foliage_card_dry'
  | 'foliage_card_spring'
  | 'rock'
  | 'props'
  | 'chevron'
  | 'vehicle'
  | 'village_sign';

const cache = new Map<MaterialId, Material>();

/**
 * Wind sway (`RALLY_WIND`, metres of sway per m² of height) and leaf translucency (`RALLY_FOLIAGE`) for the
 * world shading (engine/world-shading.ts). Trees bend at the top, grass / reed cards at their tips.
 */
const TREE_DEFINES = { RALLY_WIND: 0.0009, RALLY_FOLIAGE: 0.3 };
const CARD_DEFINES = { RALLY_WIND: 0.1, RALLY_FOLIAGE: 0.25, RALLY_GROUND: 1 };

const FOLIAGE: MaterialId[] = [
  'foliage_card',
  'foliage_card_dry',
  'foliage_card_spring',
];
let foliageA2C = false;

/**
 * Grass / leaf cards: alpha-to-coverage when the renderer has MSAA (smooth, non-shimmering card edges at no cost;
 * three keeps the `alphaTest` cut and antialiases across it). Without MSAA it would do nothing: plain alpha test.
 * `createRenderer` calls this with the quality preset's `antialias`.
 */
export function setFoliageAntialias(on: boolean): void {
  foliageA2C = on;
  for (const id of FOLIAGE) {
    const m = cache.get(id);
    if (m && m.alphaToCoverage !== on) {
      m.alphaToCoverage = on;
      m.needsUpdate = true;
    }
  }
}

export function getMaterial(id: MaterialId): Material {
  let m = cache.get(id);
  if (m) return m;
  switch (id) {
    case 'vegetation':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('detail'),
        roughness: 0.92,
      });
      m.defines = { ...TREE_DEFINES };
      break;
    case 'foliage_card':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('grass_card'),
        alphaTest: 0.45,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_dry':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('grass_card_dry'),
        alphaTest: 0.45,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_spring':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('grass_card_spring'),
        alphaTest: 0.45,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'rock':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('rock'),
        bumpMap: getTexture('rock'),
        bumpScale: 2,
        roughness: 0.88,
      });
      break;
    case 'props':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('detail'),
        roughness: 0.7,
      });
      break;
    case 'vehicle':
      // Vertex-coloured paint; the decals atlas supplies the lettering (plain faces sample its white corner).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('vehicle_decals'),
        roughness: 0.42,
        metalness: 0.3,
      });
      break;
    case 'village_sign':
      m = new MeshStandardMaterial({
        map: getTexture('village_sign'),
        roughness: 0.55,
        side: DoubleSide,
      });
      break;
    case 'chevron':
      m = new MeshStandardMaterial({
        map: getTexture('chevron'),
        roughness: 0.55,
      });
      break;
  }
  m.name = id;
  if (FOLIAGE.includes(id)) {
    m.alphaToCoverage = foliageA2C;
    m.defines = { ...CARD_DEFINES };
  }
  cache.set(id, m);
  return m;
}

export function allMaterials(): Material[] {
  return [...cache.values()];
}
