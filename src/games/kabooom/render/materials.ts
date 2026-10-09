import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshLambertMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { Noise2D } from '../../../shared/noise';
import type { GlowUniforms } from './fx/glow-grid';

/** Quarry palette (DETAILS.md "Style"): warm sandstone, granite, timber, with soft clay shading. */
export const PALETTE = {
  tiles: [0xe9d5a8, 0xe0c897, 0xd8bd88],
  granite: 0x9b968f,
  graniteDark: 0x85807a,
  // slate-blue pillars: their own family, apart from the grey-brown boulders and the warm wood / sand
  post: 0x8d97ad,
  postCap: 0xaeb7c9,
  timber: 0x8a5a2e,
  crate: 0xd09b56,
  crateBand: 0xb07a3c,
  crateDark: 0x8d5d2c,
  dirt: 0x8a6038,
  pebble: 0x9a958e,
  grass: 0x6fae4a,
  slab: [0xdab47e, 0xb98550, 0x8f7862, 0x6f5d50],
  rail: 0x6c6a68,
  lantern: 0xffd27a,
  cloud: 0xfaf4ec,
  skyTop: '#7db4e3',
  skyMid: '#cfe5f4',
  skyLow: '#ffe8cc',
} as const;

/** Soft grain multiplied over every clay surface: matte, hand-made, no two faces identical. */
export function makeGrainTexture(size = 128, seed = 77): DataTexture {
  const noise = new Noise2D(seed);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // tileable: sample on a torus
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const n =
        noise.fbm(Math.cos(u) * 2.2, Math.sin(u) * 2.2 + Math.cos(v) * 2.2, 3) *
          0.5 +
        noise.noise2(Math.sin(v) * 6, Math.cos(u) * 6) * 0.25;
      const g = Math.round(238 + n * 17);
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.max(200, Math.min(255, g));
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Vertical sky gradient used as the scene background (one full-screen quad, no geometry of our own). */
export function makeSkyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(0.55, PALETTE.skyMid);
  grad.addColorStop(1, PALETTE.skyLow);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * Clay material: Lambert (cheap) + grain + optional vertex colours. With `glow` the fragment shader adds a warm emissive
 * term from the heat texture at the fragment's world position, so flames light the floor and blocks without lights.
 */
export function clayMaterial(
  grain: DataTexture,
  opts: { vertexColors?: boolean; color?: number; glow?: GlowUniforms } = {},
): MeshLambertMaterial {
  const m = new MeshLambertMaterial({
    color: new Color(opts.color ?? 0xffffff),
    map: grain,
    vertexColors: opts.vertexColors ?? false,
  });
  if (opts.glow) {
    const glow = opts.glow;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glow.uGlow;
      shader.uniforms.uGlowGrid = glow.uGlowGrid;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec2 vGlowPos;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 glowP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            glowP = instanceMatrix * glowP;
          #endif
          vGlowPos = ( modelMatrix * glowP ).xz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec2 vGlowPos;\nuniform sampler2D uGlow;\nuniform vec2 uGlowGrid;',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float heat = texture2D( uGlow, ( vGlowPos + uGlowGrid * 0.5 ) / uGlowGrid ).r;
          totalEmissiveRadiance += mix( vec3( 1.0, 0.45, 0.12 ), vec3( 1.0, 0.85, 0.45 ), heat * heat ) * heat * 0.85;`,
        );
    };
    m.customProgramCacheKey = () => 'kabooom-clay-glow';
  }
  return m;
}
