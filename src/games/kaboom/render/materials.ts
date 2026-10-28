import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Material,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { Noise2D } from '../../../shared/noise';
import type { DetailUniforms } from './detail';
import type { GlowUniforms } from './fx/glow-grid';
import type { Quality } from './renderer';

/** Quarry palette (DETAILS.md "Style"): warm sandstone, granite, timber, with soft clay shading. */
export const PALETTE = {
  tiles: [0xe9d5a8, 0xe0c897, 0xd8bd88],
  granite: 0x9b968f,
  graniteDark: 0x85807a,
  postCap: 0xaeb7c9,
  timber: 0x7a4c28,
  timberLight: 0x8f5d33,
  // cut ochre sandstone (the derrick's load); the pillar is cool blue-grey stone on dark mortar, so a hard block never
  // shares the warm hue of the breakable wood and clay
  sandstone: [0xc49a66, 0xb48a5a, 0xcfa873],
  pillar: [0x8592a6, 0x76849a, 0x929eb0],
  pillarCap: 0xa9b4c4,
  mortar: 0x2c2f38,
  ironBand: 0x3b3f47,
  rope: 0xc8b083,
  // floor flags and the grit in their joints
  flags: [0xe2c99a, 0xd8bd8b, 0xe8d3a6],
  grit: 0x8a7052,
  // Quarry breakables 2: terracotta pots
  pots: [0xd06c3c, 0xbd5d36, 0xdb7d4c],
  potRim: 0xeaa274,
  potMouth: 0x24150e,
  crate: 0xd09b56,
  crateBand: 0xb07a3c,
  crateDark: 0x8d5d2c,
  pebble: 0x9a958e,
  slab: [0xdab47e, 0xb98550, 0x8f7862, 0x6f5d50],
  rail: 0x6c6a68,
  lantern: 0xffd27a,
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
export function makeSkyTexture(
  sky: readonly [string, string, string] = [
    PALETTE.skyTop,
    PALETTE.skyMid,
    PALETTE.skyLow,
  ],
): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, sky[0]);
  grad.addColorStop(0.55, sky[1]);
  grad.addColorStop(1, sky[2]);
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
    m.onBeforeCompile = (shader) => addGlow(shader, glow);
    m.customProgramCacheKey = () => 'kaboom-clay-glow';
  }
  return m;
}

/** Roughness per material (DETAILS.md "Style"): `part()` stores it per vertex, the High arena material reads it. */
export const ROUGH = {
  wood: 0.85,
  grass: 0.9,
  clay: 0.8,
  stone: 0.75,
  rope: 0.95,
  paint: 0.55,
  iron: 0.45,
} as const;

type Shader = Parameters<Material['onBeforeCompile']>[0];

/** The glow term: flames light the floor and the blocks near them through the heat texture, no lights. */
function addGlow(shader: Shader, glow: GlowUniforms): void {
  shader.uniforms.uGlow = glow.uGlow;
  shader.uniforms.uGlowGrid = glow.uGlowGrid;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGlowPos;')
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
}

/**
 * The detail texture (`detail.ts`): world-space, projected from three sides and blended by the normal, so terraces,
 * cliffs, decks and hulls all get it without UVs; each channel scales the paint by 2 x its value, as far as the vertex's
 * `aDetail` (red, green, blue weights) and the level's strength allow. Geometry without `aDetail` reads 0: untouched.
 */
function addDetail(
  shader: Shader,
  detail: DetailUniforms,
  soil: boolean,
): void {
  Object.assign(shader.uniforms, detail);
  if (soil)
    shader.fragmentShader = `#define DETAIL_SOIL\n${shader.fragmentShader}`;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      attribute vec3 aDetail;
      varying vec3 vDetail;
      varying vec3 vDetailPos;
      varying vec3 vDetailN;`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 detailP = vec4( transformed, 1.0 );
      vec3 detailN = objectNormal;
      #ifdef USE_INSTANCING
        detailP = instanceMatrix * detailP;
        detailN = mat3( instanceMatrix ) * detailN;
      #endif
      vDetailPos = ( modelMatrix * detailP ).xyz;
      vDetailN = mat3( modelMatrix ) * detailN;
      vDetail = aDetail;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform sampler2D uDetail;
      uniform float uDetailTile;
      uniform float uDetailK;
      varying vec3 vDetail;
      varying vec3 vDetailPos;
      varying vec3 vDetailN;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      if ( vDetail.x + vDetail.y + vDetail.z > 0.003 ) {
        vec3 tw = pow( abs( normalize( vDetailN ) ), vec3( 4.0 ) );
        tw /= tw.x + tw.y + tw.z;
        vec3 tp = vDetailPos / uDetailTile;
        vec3 tex = texture2D( uDetail, tp.zy ).rgb * tw.x
                 + texture2D( uDetail, tp.xz ).rgb * tw.y
                 + texture2D( uDetail, tp.xy ).rgb * tw.z;
        vec3 dw = vDetail;
        #ifdef DETAIL_SOIL
          // a warm (brown) instance is bare soil: its ground weight moves to the second channel
          float soil = clamp( ( vColor.r - vColor.g ) * 6.0 + 0.5, 0.0, 1.0 );
          dw = vec3( dw.x * ( 1.0 - soil ), dw.y + dw.x * soil, dw.z );
        #endif
        diffuseColor.rgb *= 1.0 + dot( 2.0 * tex - 1.0, dw ) * uDetailK;
      }`,
    );
}

/**
 * Material of the arena and its scenery (vertex colours = the painted look, no grain). High: physically based, with the
 * roughness `part()` wrote per vertex (`aGloss` = 1 - roughness; geometry without it is fully matte) and the level's
 * HDRI as environment light. Low: Lambert plus a faint cool rim so the forms still read without the environment. With
 * `detail` the level's detail texture is laid over the vertices that ask for it (the scenery and the margin).
 */
export function arenaMaterial(
  quality: Quality,
  opts: {
    vertexColors?: boolean;
    glow?: GlowUniforms;
    detail?: DetailUniforms;
    /** Warm-tinted instances take the detail's second channel (bare soil on a lawn). */
    soil?: boolean;
  } = {},
): MeshStandardMaterial | MeshLambertMaterial {
  const glow = opts.glow;
  const detail = opts.detail;
  const vertexColors = opts.vertexColors ?? false;
  const soil = opts.soil ?? false;
  const key = `${glow ? '-glow' : ''}${detail ? '-detail' : ''}${soil ? '-soil' : ''}`;
  if (quality.name === 'high') {
    const m = new MeshStandardMaterial({
      vertexColors,
      roughness: 1,
      metalness: 0,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aGloss;\nvarying float vGloss;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvGloss = aGloss;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vGloss;',
        )
        .replace(
          '#include <roughnessmap_fragment>',
          'float roughnessFactor = roughness * ( 1.0 - vGloss );',
        );
      if (glow) addGlow(shader, glow);
      if (detail) addDetail(shader, detail, soil);
    };
    m.customProgramCacheKey = () => `kaboom-arena-high${key}`;
    return m;
  }
  const m = new MeshLambertMaterial({ vertexColors });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `outgoingLight += vec3( 0.75, 0.85, 1.0 ) * 0.1 * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
      #include <opaque_fragment>`,
    );
    if (glow) addGlow(shader, glow);
    if (detail) addDetail(shader, detail, soil);
  };
  m.customProgramCacheKey = () => `kaboom-arena-low${key}`;
  return m;
}
