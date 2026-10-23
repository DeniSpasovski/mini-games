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
export function houseMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    map: getTexture('detail'),
    roughness: 0.75,
  });
  const maps = { value: houseArray() };
  mat.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.uniforms.houseMaps = maps;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float layer;\nvarying float vLayer;\nvarying vec2 vLayerUv;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLayer = layer;
#ifdef USE_INSTANCING
vec3 isc = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
#else
vec3 isc = vec3( 1.0 );
#endif
vec3 mp = position * isc;
vec3 an = abs( objectNormal );
if ( an.y > 0.5 ) vLayerUv = vec2( mp.x, mp.z * 1.2 ) / ${BAY};
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
  mat.customProgramCacheKey = () => 'house-walls';
  return mat;
}
