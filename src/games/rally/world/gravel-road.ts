import {
  DataTexture,
  Material,
  RGBAFormat,
  type MeshStandardMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  GROUND_LAYER,
  GROUND_MEAN,
  GROUND_SCAN,
} from '../engine/ground-textures';
import { getTexture } from '../engine/textures';
import { addWorldUniforms } from '../engine/world-shading';
import { getTerrainMaterial } from './terrain-material';

/**
 * The gravel road is the terrain's own gravel (`engine/ground-textures.ts`, the layer the verge beside it is made of),
 * laid in world space with the same second tap, brightness variation and relief rule as the terrain
 * (`world/terrain-material.ts`), so road and verge are one surface and no seam shows where they meet. What makes it a
 * road: two wheel ruts (the loose stones are replaced by the blurred tap: packed, smoother, a little darker, with tyre
 * streaks along them) and, on the road ribbon, an edge that thins out into the verge (alpha) instead of ending on a line.
 * Texture u runs across the road (0 = right edge, 1 = left edge), v along it (`texLength` metres).
 */
const RUTS = [0.29, 0.71];
const RUT_HALF = 0.085;
/** The packed ruts are this much darker than the loose gravel, and their tyre streaks vary by this much. */
const RUT_DARK = 0.3;
const RUT_STREAKS = 0.18;

/** A white 1 x 1 map: gives the material its map UVs (`vMapUv`); the shader overwrites the colour. */
const WHITE = new DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
  RGBAFormat,
);
WHITE.needsUpdate = true;

/** Constants of the gravel layer for the shader. */
export const GRAVEL_DEFINES = {
  RALLY_GROUND: 1,
  GR_LAYER: GROUND_LAYER.gravel.toFixed(1),
  GR_SCALE: (1 / GROUND_SCAN.gravel).toFixed(4),
  GR_MEAN: GROUND_MEAN.gravel.toFixed(4),
  GR_RUT_L: RUTS[0].toFixed(3),
  GR_RUT_R: RUTS[1].toFixed(3),
  GR_RUT_W: (1 / RUT_HALF).toFixed(3),
  GR_RUT_DARK: RUT_DARK.toFixed(3),
  GR_STREAKS: RUT_STREAKS.toFixed(3),
};

/** Parameters of a gravel road material (as matte as the terrain, which is 0.96). */
export function gravelBase(): MeshStandardMaterialParameters {
  return { map: WHITE, roughness: 0.96, metalness: 0 };
}

/**
 * Put the gravel on a program: call from `onBeforeCompile` after the material's own replacements. `fade` = the road
 * ribbon, whose edges thin out into the verge.
 */
export function gravelShader(
  shader: WebGLProgramParametersWithUniforms,
  fade: boolean,
): void {
  const terrain = getTerrainMaterial().userData.uniforms as Record<
    string,
    { value: unknown }
  >;
  addWorldUniforms(shader);
  Object.assign(shader.uniforms, {
    tGround: terrain.tGround,
    tMacro: { value: getTexture('macro') },
    uRelief: terrain.uRelief,
    uDetail: terrain.uDetail,
  });
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec2 vGWP;`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vGWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform mediump sampler2DArray tGround;
      uniform sampler2D tMacro;
      uniform float uRelief;
      uniform float uDetail;
      varying vec2 vGWP;
      float grHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
      float grNoise( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( grHash( i ), grHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( grHash( i + vec2( 0.0, 1.0 ) ), grHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
      }
      // One scan tap by explicit gradients: p world metres, s = 1 / scan size (as the terrain's gTap).
      vec3 grTap( vec2 p, float s, vec2 dx, vec2 dy ) {
        return textureGrad( tGround, vec3( p * s, GR_LAYER ), dx * s, dy * s ).rgb;
      }
      // Bump from a screen-space height gradient (the terrain's terrainPerturb).
      vec3 grPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
        vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) + vec3( 1e-9 ) );
        vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) + vec3( 1e-9 ) );
        vec3 R1 = cross( vSigmaY, surf_norm );
        vec3 R2 = cross( surf_norm, vSigmaX );
        float fDet = dot( vSigmaX, R1 ) * faceDirection;
        vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
        return normalize( abs( fDet ) * surf_norm - vGrad + surf_norm * 1e-6 );
      }`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float grH = 0.0;
      {
        vec2 wp = vGWP;
        vec2 dpx = dFdx( wp );
        vec2 dpy = dFdy( wp );
        // The terrain's gravel: the fine tap, and the blurred rotated one at about a third of the scale that breaks up
        // the tiling and is the relief height (the fine tap's derivatives are 2 x 2 pixel noise).
        vec3 a = grTap( wp, GR_SCALE, dpx, dpy );
        mat2 R = mat2( 0.8, -0.6, 0.6, 0.8 );
        vec3 b = grTap( R * wp + 31.7, GR_SCALE * 0.31, R * dpx * 6.0, R * dpy * 6.0 );
        float hy = clamp( dot( b, vec3( 0.2126, 0.7152, 0.0722 ) ) / GR_MEAN, 0.0, 3.0 );
        a *= mix( 1.0, clamp( hy, 0.45, 2.0 ), 0.55 );
        // Close up the 512 px scan is magnified: a third tap at about a third of the size (the terrain's gravel has it too).
        float near = 1.0 - smoothstep( 6.0, 20.0, length( vViewPosition ) );
        if ( near > 0.0 ) {
          mat2 R3 = mat2( 0.6, 0.8, -0.8, 0.6 );
          a *= mix( 1.0, clamp( dot( grTap( R3 * wp + 7.3, GR_SCALE * 3.1, R3 * dpx, R3 * dpy ), vec3( 0.2126, 0.7152, 0.0722 ) ) / GR_MEAN, 0.4, 2.2 ), 0.6 * near );
        }
        // Wheel ruts: packed (the blurred tap replaces the loose stones), a little darker, tyre streaks along them.
        float u = vMapUv.x;
        float rut = max( 1.0 - abs( u - GR_RUT_L ) * GR_RUT_W, 1.0 - abs( u - GR_RUT_R ) * GR_RUT_W );
        rut = pow( max( rut, 0.0 ), 0.7 );
        float streak = grNoise( vec2( u * 170.0, vMapUv.y * 7.0 / 9.0 ) ) - 0.5;
        a = mix( a, b, rut * 0.85 ) * ( 1.0 - GR_RUT_DARK * rut ) * ( 1.0 + GR_STREAKS * 2.0 * streak * rut );
        // Same brightness variation as the terrain's ground.
        float macro = texture2D( tMacro, wp * 0.0031 ).r;
        diffuseColor.rgb *= a * mix( 0.78, 1.16, macro );
        // Relief height as the terrain's gravel (scale 0.5 around the mean, x 4), flatter in the ruts.
        grH = 2.0 * ( hy - 1.0 ) * ( 1.0 - 0.6 * rut );
        ${
          fade
            ? `// Edge: from the road's edge (u 0.02 / 0.98) the stones thin out into the verge, ragged at 0.3 m / 1.5 m.
        float edge = min( u, 1.0 - u );
        float rag = 0.6 * grNoise( vec2( u * 6.0, vMapUv.y * 7.0 ) / 1.5 + 11.0 ) + 0.4 * grNoise( vec2( u * 6.0, vMapUv.y * 7.0 ) / 0.3 + 3.0 );
        diffuseColor.a *= smoothstep( 0.0, 1.0, ( edge - 0.012 ) / 0.075 + 0.55 * ( rag - 0.5 ) );`
            : ''
        }
      }`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        // No branch: screen-space derivatives are undefined in non-uniform control flow (0 relief = same normal).
        float grFade = uDetail > 0.0 ? uRelief * ( 1.0 - smoothstep( uDetail * 0.55, uDetail, length( vViewPosition ) ) ) : 0.0;
        normal = grPerturb( - vViewPosition, normal, vec2( dFdx( grH ), dFdy( grH ) ) * grFade, faceDirection );
      }`,
    );
}

/** A gravel road ribbon material: transparent edges, no depth write (it lies 2 cm over the terrain it blends into). */
export function setupGravelRibbon(m: Material & { defines?: object }): void {
  m.transparent = true;
  m.depthWrite = false;
  m.defines = { ...(m.defines ?? {}), ...GRAVEL_DEFINES };
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) =>
    gravelShader(shader, true);
  m.customProgramCacheKey = () => 'gravel-road-ribbon';
  m.needsUpdate = true;
}
