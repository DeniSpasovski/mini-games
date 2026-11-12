import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { getTexture } from './textures';
import { addWorldUniforms } from './world-shading';
import renderUrl from './facades/render.webp';
import clayUrl from './facades/clay_brick.webp';
import rubbleUrl from './facades/rubble.webp';
import blockUrl from './facades/block.webp';
import sheetUrl from './facades/sheet.webp';
import roofUrl from './facades/roof_clay.webp';

/**
 * Wall and roof scans (Poly Haven, CC0) for the instanced box houses: one texture array, a layer per material. The
 * houses are unit boxes scaled per instance, so the shader takes the texture coordinates from the vertex position
 * times the instance scale (metres: one tile = one 3.2 m bay) and picks wall or roof planes from the normal. A vertex
 * `layer` of -1 keeps the old look (detail map x vertex colour): windows, frames, plinth.
 */
export const HOUSE_LAYER = {
  render: 0,
  clay: 1,
  rubble: 2,
  block: 3,
  sheet: 4,
  roof: 5,
} as const;
const URLS = [renderUrl, clayUrl, rubbleUrl, blockUrl, sheetUrl, roofUrl];
const SIZE = 512;

let array: DataArrayTexture | undefined;
function houseArray(): DataArrayTexture {
  if (array) return array;
  const data = new Uint8Array(SIZE * SIZE * 4 * URLS.length).fill(190);
  const tex = new DataArrayTexture(data, SIZE, SIZE, URLS.length);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  array = tex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof Image === 'undefined') return tex; // headless tests: plain grey layers
  URLS.forEach((url, layer) => {
    const img = new Image();
    img.src = url;
    img.decode().then(
      () => {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const row = SIZE * 4;
        // Array layers are not flipped like canvas textures: v = 0 is the first row.
        for (let y = 0; y < SIZE; y++)
          data.set(
            px.subarray((SIZE - 1 - y) * row, (SIZE - y) * row),
            (layer * SIZE + y) * row,
          );
        tex.needsUpdate = true;
      },
      () => undefined,
    );
  });
  return tex;
}

const BAY = '3.2';

/**
 * Metres on a unit box. A house is a unit box scaled per instance, so anything of a fixed real size is placed by the
 * vertex shader from the `fix` attribute (x, y, z = metres added to the scaled position; w = what the vertex is):
 * - `FIX.plain`: just the offset (eaves boards, chimneys, parapets).
 * - `houseSlot(kind, col)`: a window of a wall. Windows repeat every `HOUSE_PITCH` metres along it (`slotAt`): the
 *   columns that do not fit fold away (to the origin). The front wall's ground floor leaves its middle column to the
 *   door (`frontGround`; the door is its own instance, world/buildings.ts `buildingDoor`).
 * - `FIX.eave`: a roof edge. The offset is the overhang; the edge drops with the roof's pitch (|z| overhang x pitch),
 *   and a steep roof overhangs less so the eave never drops more than `EAVE_MAX_DROP` (`eaveScale`).
 * - `FIX.hipRidge`: a ridge end of a hip roof, moved along the ridge so the end slopes as steeply as the sides.
 *   `hipEndEave` / `hipEndRidge` are the same two on the end plane itself, whose normal the shader works out too.
 * Geometry without the attribute reads w = 1: plain, no offset.
 */
export const FIX = {
  plain: 0,
  eave: 100,
  hipRidge: 101,
  hipEndEave: 102,
  hipEndRidge: 103,
} as const;
export const SLOT = { alongX: 0, alongZ: 1, frontGround: 2 } as const;
/** Most windows along the long (x) and the short (z) walls: the builders make that many, the shader shows what fits. */
export const SLOT_COLUMNS = { long: 8, short: 4 } as const;
/** Window spacing along a wall (m). */
export const HOUSE_PITCH = 3.2;
/** `fix.w` of a window vertex. */
export const houseSlot = (
  kind: (typeof SLOT)[keyof typeof SLOT],
  col = 0,
): number => 2 + col + 16 * kind;

/** Windows shown on a wall `length` m long that has `cap` columns built. */
export const slotCount = (length: number, cap: number): number =>
  Math.min(Math.floor(length / HOUSE_PITCH + 0.35), cap);

/**
 * Where column `col` sits along a wall `length` m long (-0.5 .. 0.5 of it), null when it is folded away. The windows
 * that fit are spread evenly (about one per `HOUSE_PITCH`); a wall longer than its `cap` columns keeps them at the
 * pitch round its middle and leaves the ends blank.
 */
export function slotAt(
  col: number,
  length: number,
  cap: number,
): number | null {
  const n = slotCount(length, cap);
  if (col >= n) return null;
  const step =
    Math.floor(length / HOUSE_PITCH + 0.35) > cap
      ? HOUSE_PITCH / length
      : 1 / n;
  return (col + 0.5 - n / 2) * step;
}

/** The front wall's door: the column it takes and where that is along the wall (`slotAt` of a one-column wall at least). */
export function doorSlot(length: number): { col: number; u: number } {
  const n = Math.max(slotCount(length, SLOT_COLUMNS.long), 1);
  const col = Math.floor(n * 0.5);
  const step =
    Math.floor(length / HOUSE_PITCH + 0.35) > SLOT_COLUMNS.long
      ? HOUSE_PITCH / length
      : 1 / n;
  return { col, u: (col + 0.5 - n / 2) * step };
}

/** Roof overhang at the eaves (m) and the most an eave may drop below the wall top (m). */
export const HOUSE_EAVE = 0.5;
export const EAVE_MAX_DROP = 0.3;

/**
 * Share of the overhang a roof keeps: a steep roof (a tall house on a narrow footprint) would bring its eaves down
 * over the upper windows, so its overhang shrinks until the eave drops `EAVE_MAX_DROP` at most. `height` / `depth` =
 * the instance's scale (total height, short side), `roof` = the roof's share of the height.
 */
export const eaveScale = (
  height: number,
  depth: number,
  roof: number,
): number =>
  Math.min(1, EAVE_MAX_DROP / (HOUSE_EAVE * ((2 * roof * height) / depth)));

/** Vertex shader: `houseFix( position, instance scale )` (declarations, then the function). */
const fixGlsl = (roof: number): string => `
attribute vec4 fix;
vec3 houseScale() {
#ifdef USE_INSTANCING
  return vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
#else
  return vec3( 1.0 );
#endif
}
vec3 houseFix( vec3 p, vec3 isc ) {
  float fw = floor( fix.w + 0.5 );
  if ( fw > 99.5 ) {
    if ( mod( fw, 2.0 ) > 0.5 ) p.x = sign( p.x ) * max( 0.5 - 0.5 * isc.z / isc.x, 0.0 );
    // (eaveScale)
    float k = min( 1.0, ${EAVE_MAX_DROP.toFixed(3)} * isc.z / ( ${(HOUSE_EAVE * 2 * roof).toFixed(4)} * isc.y ) );
    p.xz += k * fix.xz / isc.xz;
    p.y += fix.y / isc.y - k * abs( fix.z ) * ${(2 * roof).toFixed(4)} / isc.z;
    return p;
  }
  if ( fw > 1.5 ) {
    // (slotAt, doorSlot)
    float code = fw - 2.0;
    float col = mod( code, 16.0 );
    float kind = floor( code / 16.0 );
    bool side = kind > 0.5 && kind < 1.5;
    float len = side ? isc.z : isc.x;
    float cap = side ? ${SLOT_COLUMNS.short.toFixed(1)} : ${SLOT_COLUMNS.long.toFixed(1)};
    float fit = floor( len / ${HOUSE_PITCH.toFixed(2)} + 0.35 );
    float n = min( fit, cap );
    float door = floor( max( n, 1.0 ) * 0.5 );
    if ( col > n - 0.5 || ( kind > 1.5 && abs( col - door ) < 0.5 ) ) return vec3( 0.0 );
    float u = ( col + 0.5 - 0.5 * n ) * ( fit > cap + 0.5 ? ${HOUSE_PITCH.toFixed(2)} / len : 1.0 / n );
    if ( side ) p.z = u; else p.x = u;
  }
  return p + fix.xyz / isc;
}`;

/** Roof height of a pitched house as a share of its unit height (the eaves drop with this pitch). */
export const ROOF_SHARE = 0.32;

/**
 * Shadow pass of the houses: the default depth material knows nothing of `fix`, so the shadows would come from the
 * unit box. `Material.userData.depthVertex` hands the same vertex code to every depth material made for it
 * (engine/materials.ts `shapedDepthMaterial`, the variant-set and LOD-fade depth materials).
 */
export interface DepthVertex {
  key: string;
  apply: (shader: { vertexShader: string }) => void;
}
const houseDepth: DepthVertex = {
  key: 'house-fix',
  apply: (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${fixGlsl(ROOF_SHARE)}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed = houseFix( transformed, houseScale() );',
      );
  },
};

export function houseMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    map: getTexture('detail'),
    roughness: 0.75,
  });
  mat.userData.depthVertex = houseDepth;
  const maps = { value: houseArray() };
  mat.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.uniforms.houseMaps = maps;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute float layer;\nvarying float vLayer;\nvarying vec2 vLayerUv;${fixGlsl(ROOF_SHARE)}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        // A hip's end plane: its slope follows the instance's proportions (the ridge end moves), so does its normal.
        `#include <beginnormal_vertex>
if ( fix.w > 101.5 ) {
  vec3 hs = houseScale();
  objectNormal = normalize( vec3( sign( objectNormal.x ) * ${ROOF_SHARE.toFixed(4)} * hs.x, sign( objectNormal.y ) * 0.5 * hs.z, 0.0 ) );
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLayer = layer;
vec3 isc = houseScale();
transformed = houseFix( transformed, isc );
vec3 mp = transformed * isc;
vec3 an = abs( objectNormal );
if ( an.y > 0.5 || fix.w > 99.5 ) vLayerUv = vec2( mp.x, mp.z * 1.2 ) / ${BAY};
else if ( an.x > an.z ) vLayerUv = vec2( mp.z, mp.y ) / ${BAY};
else vLayerUv = vec2( mp.x, mp.y ) / ${BAY};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform mediump sampler2DArray houseMaps;\nvarying float vLayer;\nvarying vec2 vLayerUv;',
      )
      .replace(
        '#include <map_fragment>',
        // Both samples outside any branch (derivatives stay valid across a layer change).
        `vec4 detailTex = texture2D( map, vMapUv );
vec4 wallTex = texture( houseMaps, vec3( vLayerUv, max( floor( vLayer + 0.5 ), 0.0 ) ) );
diffuseColor *= vLayer < -0.5 ? detailTex : wallTex;`,
      );
  };
  mat.customProgramCacheKey = () => 'house-walls-fix-2';
  return mat;
}
