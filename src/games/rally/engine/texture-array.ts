import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type MeshStandardMaterialParameters,
} from 'three';
import { getTexture, type TextureId } from './textures';
import { addWorldUniforms } from './world-shading';

/**
 * Texture arrays: several canvas textures as layers of one sRGB `DataArrayTexture`, so meshes that
 * used one material per texture merge into one mesh / draw call. The layer rides on a per-vertex
 * float attribute `layer` (-1 = untextured, vertex colour only); see `layeredMaterial`.
 */
export function textureArray(ids: TextureId[], size: number): DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * ids.length);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let anisotropy = 1;
  ids.forEach((id, i) => {
    const t = getTexture(id);
    anisotropy = Math.max(anisotropy, t.anisotropy);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(t.image as CanvasImageSource, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    // Canvas textures are flipped (v = 0 at the image bottom); array textures are not.
    const row = size * 4;
    for (let y = 0; y < size; y++)
      data.set(
        px.subarray((size - 1 - y) * row, (size - y) * row),
        (i * size + y) * row,
      );
  });
  const tex = new DataArrayTexture(data, size, size, ids.length);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A MeshStandardMaterial whose map is layer `layer` (vertex attribute) of `array`; layer < 0 draws
 * the vertex colour alone. `key` names the shader variant (program cache).
 */
export function layeredMaterial(
  array: DataArrayTexture,
  key: string,
  params: MeshStandardMaterialParameters = {},
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, ...params });
  const maps = { value: array };
  mat.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.uniforms.layerMaps = maps;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float layer;\nvarying float vLayer;\nvarying vec2 vLayerUv;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLayer = layer;\nvLayerUv = uv;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform mediump sampler2DArray layerMaps;\nvarying float vLayer;\nvarying vec2 vLayerUv;',
      )
      .replace(
        '#include <map_fragment>',
        // Sampled outside any branch (a layer change across a pixel quad keeps its derivatives).
        'vec4 layerTex = texture( layerMaps, vec3( vLayerUv, max( floor( vLayer + 0.5 ), 0.0 ) ) );\n' +
          'diffuseColor *= vLayer < -0.5 ? vec4( 1.0 ) : layerTex;',
      );
  };
  mat.customProgramCacheKey = () => `layered-${key}`;
  return mat;
}
