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
        float w = 0.24 + 0.08 * grNoise( vec2( along / 11.0, 5.5 ) );
        float prof = 1.0 - smoothstep( w * 0.25, w * 1.6, min( abs( x - hsp ), abs( x + hsp ) ) );
        prof = max( prof, 0.4 * ( 1.0 - smoothstep( w * 0.3, w * 1.8, abs( abs( x + 0.1 ) - 0.95 ) ) ) );
        // In a bend the average line gives way to the cars' own tracks (below), over a faint tint of where most of them
        // run: three broad arcs from tighter than the average line to out wide, each fading in and out.
        float outM = 0.0;
        prof *= 1.0 - 0.8 * bend;
        if ( bend > 0.0 ) {
          for ( int i = 0; i < 3; i++ ) {
            float fi = float( i );
            float k = -0.35 + 0.6 * fi + 0.3 * ( grNoise( vec2( along / ( 19.0 + 7.0 * fi ), 4.1 + fi * 3.3 ) ) - 0.5 );
            float xi = x + vGrX.z * k + 0.25 * ( grNoise( vec2( along / ( 8.0 + 3.0 * fi ), 7.7 + fi ) ) - 0.5 );
            float wi = w * ( 0.8 + 0.2 * fi );
            float si = bend * ( 0.32 - 0.05 * fi ) * smoothstep( 0.3, 0.65, grNoise( vec2( along / ( 23.0 + 5.0 * fi ), 9.1 + fi * 2.0 ) ) );
            prof = max( prof, si * ( 1.0 - smoothstep( wi * 0.2, wi * 1.6, min( abs( xi - hsp ), abs( xi + hsp ) ) ) ) );
          }
          // On the outer edge of the bend (lat = x + line has the opposite sign to the cut): the slides throw gravel there.
          outM = ( vGrX.x + vGrX.z ) * vGrX.z < 0.0 ? bend : 0.0;
        }
        // Patchy along the road (stones kicked back in, some stretches worn harder).
        prof *= ( 0.75 + 0.25 * grNoise( vec2( along / 2.3, x * 1.3 + 2.0 ) ) ) * ( 0.8 + 0.2 * grNoise( vec2( along / 17.0, x * 0.4 + 6.0 ) ) );
        // Every car's own tracks: ten tyre-width pairs (~0.2 m, ~1.5 m apart), each on its own line that drifts
        // across the others, coming and going along the road. On a straight they keep close to the line; in a bend they
        // spread over the road, more towards the outside (late turn-ins, running wide), and a sliding car's rear tyres run
        // outside its fronts (four tracks). Thinner than a pixel far away, so they fade out beyond ~40 m.
        float camD = length( vViewPosition );
        float tyreFar = 1.0 - smoothstep( 25.0, 55.0, camD );
        float tyres = 0.0;
        if ( tyreFar > 0.0 ) {
          float outS = vGrX.z == 0.0 ? 1.0 : -sign( vGrX.z );
          float spread = 0.25 + 2.0 * bend;
          for ( int i = 0; i < 10; i++ ) {
            float fi = float( i );
            float h1 = fract( sin( fi * 12.9898 + 1.3 ) * 43758.5453 );
            float h2 = fract( sin( fi * 78.233 + 4.1 ) * 24634.6345 );
            float h3 = fract( sin( fi * 39.425 + 7.7 ) * 13758.937 );
            float off = outS * spread * ( mix( -0.45, 1.0, h1 ) + 0.5 * ( grNoise( vec2( along / ( 7.0 + 9.0 * h2 ), fi * 3.7 + 0.5 ) ) - 0.5 ) );
            float xi = x - off;
            float hp = 0.72 + 0.08 * h3;
            float tw = 0.07 + 0.04 * h2;
            float t = 1.0 - smoothstep( tw * 0.7, tw * 1.15, min( abs( xi - hp ), abs( xi + hp ) ) );
            // Sliding (some cars, in bends): the rear pair out towards the outside of the bend.
            float yawOff = outS * bend * step( 0.55, h3 ) * ( 0.25 + 0.45 * h1 );
            float xr = xi - yawOff;
            t = max( t, step( 0.001, abs( yawOff ) ) * 0.85 * ( 1.0 - smoothstep( tw * 0.7, tw * 1.3, min( abs( xr - hp ), abs( xr + hp ) ) ) ) );
            float on = smoothstep( 0.5, 0.62, grNoise( vec2( along / ( 5.0 + 10.0 * h3 ), fi * 5.1 + 1.3 ) ) );
            tyres = 1.0 - ( 1.0 - tyres ) * ( 1.0 - t * on * ( 0.5 + 0.3 * h2 ) );
          }
          tyres *= tyreFar * ( 0.5 + 0.5 * bend );
        }
        // Height blended stone by stone: the loose stones (bright = high in the fine tap) stay on a track's edge, and the
        // biggest ones lie in the track too, so it ends in stones, not on a soft line.
        float hs = dot( a, vec3( 0.2126, 0.7152, 0.0722 ) ) / GR_MEAN;
        rut = clamp( ( prof - 0.2 ) * 2.2 - 0.9 * ( hs - 1.0 ), 0.0, 1.0 ) * smoothstep( 0.2, 0.35, prof );
        // The cars' own tracks are graded, not thresholded: one track is a light print, where several cross it is packed.
        rut = max( rut, clamp( tyres - 0.35 * ( hs - 1.0 ), 0.0, 1.0 ) * smoothstep( 0.05, 0.2, tyres ) );
        rut *= 1.0 - 0.7 * smoothstep( 1.25, 1.7, hs );
        // Packed: the stones pressed flat under a skin of fines, darker (GR_TRACK_TONE), a little flatter (relief below); a third
        // of the fine grain stays, with faint tyre streaks along it.
        float streak = grNoise( vec2( x * 28.0, along / 9.0 ) ) - 0.5;
        float bl = max( dot( b, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
        vec3 packed = b * GR_TRACK_TONE * mix( 1.0, clamp( hs * GR_MEAN / bl, 0.5, 1.6 ), 0.35 );
        a = mix( a, packed, rut ) * ( 1.0 + 0.1 * streak * rut );
        // Loose gravel the tyres push aside: a low ridge between the tracks and a berm along each edge (vGrX.y = metres
        // to the edge), coarser and a touch lighter (drier) than the road, broken up along it.
        float ridge = 1.0 - smoothstep( 0.18, 0.5, abs( x ) );
        // On the outside of a bend the bank is wider: the gravel the slides throw out.
        float berm = 1.0 - smoothstep( 0.1, 0.55 + 1.4 * outM, vGrX.y );
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
        grH = 2.0 * ( hy - 1.0 ) * ( 1.0 - 0.2 * rut ) * ( 1.0 + 0.8 * loose );
        // The tracks sit a little lower (packed): their edges catch the light.
        grH -= 0.2 * rut;
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
      // Dry, the packed fines are as matte as the loose stones (fully rough, no sheen against a low sun); wet, glossier.
      roughnessFactor = mix( roughnessFactor, 1.0, grRut ) - 0.6 * wsWet.x * grRut;`,
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
