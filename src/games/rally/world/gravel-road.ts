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
import { GRAVEL_SHARP, getTerrainMaterial } from './terrain-material';

/**
 * The gravel road is the terrain's own gravel (`engine/ground-textures.ts`, the layer the verge beside it is made of),
 * laid in world space with the same second tap, brightness variation and relief rule as the terrain
 * (`world/terrain-material.ts`), so road and verge are one surface and no seam shows where they meet. What makes it a
 * road, on the road ribbon: two wheel tracks along the line cars drive (packed: the same stones pressed flat, lower
 * contrast, a little lower), the loose gravel the tyres push aside (a ridge between the tracks and a berm along each edge,
 * coarser), and an edge that thins out into the verge (dithered) instead of ending on a line.
 * Texture u runs across the road (0 = right edge, 1 = left edge), v along it (`texLength` metres).
 */

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
  /** Metres of road per texture v (road-mesh.ts `texLength('road')`). */
  GR_TEXLEN: '7.0',
  GR_SHARP: GRAVEL_SHARP.toFixed(2),
  /** Packed wheel tracks: fines pressed flat over the stones, this much darker than the loose gravel. */
  GR_TRACK_TONE: '0.8',
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
      varying vec2 vGWP;
      #ifdef GR_TRACKS
      attribute vec3 grX;
      varying vec3 vGrX;
      #endif`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vGWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
      #ifdef GR_TRACKS
      vGrX = grX;
      #endif`,
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
      #ifdef GR_TRACKS
      varying vec3 vGrX;
      #endif
      float grHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
      float grNoise( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( grHash( i ), grHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( grHash( i + vec2( 0.0, 1.0 ) ), grHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
      }
      // One scan tap by explicit gradients: p world metres, s = 1 / scan size (as the terrain's gTap).
      vec3 grTap( vec2 p, float s, vec2 dx, vec2 dy ) {
        return textureGrad( tGround, vec3( p * s, GR_LAYER ), dx * s * GR_SHARP, dy * s * GR_SHARP ).rgb;
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
      float grRut = 0.0;
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
        float u = vMapUv.x;
        float rut = 0.0;
        float loose = 0.0;
        #ifdef GR_TRACKS
        // Wheel tracks, in metres from the line cars drive (vGrX.x, + left; road-mesh.ts drivenLine): ~1.55 m apart. No
        // two drivers hold the same line, so each track is many passes of 0.2 m tyres spread ~0.6 - 0.9 m wide, and the
        // line wanders, more in bends. Fainter tracks of wider vehicles (vans, course cars) ~1.9 m apart.
        float along = vMapUv.y * GR_TEXLEN;
        // vGrX.z = how far the line cuts into the bend (m, + left): 0 on a straight.
        float bend = clamp( abs( vGrX.z ) / 1.2, 0.0, 1.0 );
        float x = vGrX.x + ( 0.36 + 0.3 * bend ) * ( grNoise( vec2( along / 27.0, 3.1 ) ) - 0.5 ) + 0.12 * ( grNoise( vec2( along / 5.3, 8.3 ) ) - 0.5 );
        float hsp = 0.775 + 0.08 * ( grNoise( vec2( along / 37.0, 1.7 ) ) - 0.5 );
        float w = 0.3 + 0.12 * grNoise( vec2( along / 11.0, 5.5 ) );
        float prof = 1.0 - smoothstep( w * 0.25, w * 1.6, min( abs( x - hsp ), abs( x + hsp ) ) );
        prof = max( prof, 0.4 * ( 1.0 - smoothstep( w * 0.3, w * 1.8, abs( abs( x + 0.1 ) - 0.95 ) ) ) );
        // Some bends also carry a looser, fainter pair out wide: cars that turned in late, ran wide or slid. It peels off
        // the line towards the outside of the bend (by about as much as the line cuts in) and only on some bends.
        float wide = bend * smoothstep( 0.45, 0.7, grNoise( vec2( along / 70.0, 12.3 ) ) );
        if ( wide > 0.0 ) {
          float xw = x + vGrX.z * ( 0.8 + 0.6 * grNoise( vec2( along / 13.0, 2.9 ) ) );
          float ww = w * 1.4;
          prof = max( prof, wide * 0.55 * ( 1.0 - smoothstep( ww * 0.2, ww * 1.6, min( abs( xw - hsp ), abs( xw + hsp ) ) ) ) );
        }
        // Patchy along the road (stones kicked back in, some stretches worn harder), and height blended: the loose stones
        // (bright = high in the fine tap) still sit on a track's edge, so it ends in stones, not on a line.
        prof *= ( 0.75 + 0.25 * grNoise( vec2( along / 2.3, x * 1.3 + 2.0 ) ) ) * ( 0.8 + 0.2 * grNoise( vec2( along / 17.0, x * 0.4 + 6.0 ) ) );
        float hs = dot( a, vec3( 0.2126, 0.7152, 0.0722 ) ) / GR_MEAN;
        rut = clamp( ( prof - 0.15 ) * 2.6 - 0.4 * ( hs - 1.0 ), 0.0, 1.0 );
        // Packed: the stones pressed flat under a skin of fines, so only a trace of the grain stays (the coarse tap), darker
        // (GR_TRACK_TONE) and flatter (relief below), with faint tyre streaks along it.
        float streak = grNoise( vec2( x * 28.0, along / 9.0 ) ) - 0.5;
        a = mix( a, mix( a, b * GR_TRACK_TONE, 0.88 ), rut ) * ( 1.0 + 0.1 * streak * rut );
        // Loose gravel the tyres push aside: a low ridge between the tracks and a berm along each edge (vGrX.y = metres
        // to the edge), coarser and a touch lighter (drier) than the road, broken up along it.
        float ridge = 1.0 - smoothstep( 0.18, 0.5, abs( x ) );
        float berm = 1.0 - smoothstep( 0.1, 0.55, vGrX.y );
        loose = max( ridge * ( 0.55 + 0.45 * grNoise( vec2( along / 6.0, 4.4 ) ) ), berm ) * ( 1.0 - rut );
        a *= mix( 1.0, clamp( hs, 0.5, 1.9 ), 0.35 * loose ) * ( 1.0 + 0.06 * loose );
        // Wet (engine/world-shading.ts wsWet.x): water stands in the packed tracks (darker, glossier: roughness below) and
        // drains out of the loose stones first.
        a *= 1.0 - 0.15 * wsWet.x * rut + 0.05 * wsWet.x * loose;
        grRut = rut;
        #endif
        // Same brightness variation as the terrain's ground.
        float macro = texture2D( tMacro, wp * 0.0031 ).r;
        diffuseColor.rgb *= a * mix( 0.78, 1.16, macro );
        // Relief height as the terrain's gravel (scale 0.5 around the mean, x 4), flatter in the ruts.
        grH = 2.0 * ( hy - 1.0 ) * ( 1.0 - 0.85 * rut ) * ( 1.0 + 0.8 * loose );
        // The tracks sit a little lower (packed): their edges catch the light.
        grH -= 0.35 * rut;
        // Lumps and dips of the road bed (about 1.3 m and 0.45 m across; the car's own bumps are the same order in
        // physics/vehicle.ts surfaceBump), lit by the normal and a little darker in the dips.
        float lump = 1.6 * ( grNoise( wp / 1.3 + 17.0 ) - 0.5 ) + 1.0 * ( grNoise( wp / 0.45 + 5.0 ) - 0.5 );
        grH += lump * ( 1.0 - 0.5 * rut );
        diffuseColor.rgb *= 1.0 + 0.07 * lump;
        ${
          fade
            ? `// Edge: from the road's edge (u 0.02 / 0.98) the stones thin out into the verge, ragged at 0.3 m / 1.5 m.
        float edge = min( u, 1.0 - u );
        float rag = 0.6 * grNoise( vec2( u * 6.0, vMapUv.y * 7.0 ) / 1.5 + 11.0 ) + 0.4 * grNoise( vec2( u * 6.0, vMapUv.y * 7.0 ) / 0.3 + 3.0 );
        float grA = smoothstep( 0.0, 1.0, ( edge - 0.012 ) / 0.075 + 0.55 * ( rag - 0.5 ) );
        // Dithered (interleaved gradient noise) instead of blended: the ribbon stays opaque, so it is drawn first and the
        // terrain under it is never shaded; where a pixel is dropped the terrain's own gravel shows, the same stones.
        if ( grA < fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) ) discard;`
            : ''
        }
      }`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor -= 0.6 * wsWet.x * grRut;`,
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

/**
 * A gravel road ribbon material: opaque with a dithered edge (it lies 2 cm over the terrain it blends into; the mesh is
 * drawn before the terrain so the terrain under it fails the depth test and is not shaded twice).
 */
export function setupGravelRibbon(m: Material & { defines?: object }): void {
  m.defines = { ...(m.defines ?? {}), ...GRAVEL_DEFINES, GR_TRACKS: 1 };
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) =>
    gravelShader(shader, true);
  m.customProgramCacheKey = () => 'gravel-road-ribbon';
  m.needsUpdate = true;
}
