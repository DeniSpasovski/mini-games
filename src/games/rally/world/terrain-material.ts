import { Color, MeshStandardMaterial } from 'three';
import type { EnvironmentDef } from '../maps/shared/types';
import { getTexture } from '../engine/textures';
import { addWorldUniforms } from '../engine/world-shading';

/**
 * Terrain splat material: MeshStandardMaterial (so it gets sun, shadows, fog
 * and IBL for free) with the diffuse replaced by a 4-way blend of tiling
 * world-space textures driven by the per-vertex `splat` attribute
 * [grass, dirt, rock, gravel], plus two scales of macro variation to hide tiling.
 * Relief: the blended textures' brightness doubles as a height map (bump from screen-space derivatives, rock and
 * gravel strongest, faded out by ~90 m) so a low sun picks out stones and ruts.
 * Weight the four channels leave unused (sum < 1) is drawn as ripe crop (wheat fields).
 *
 * One instance is shared by every terrain chunk.
 */
let shared: MeshStandardMaterial | undefined;

/** Ripe wheat. */
const DEFAULT_CROP = '#c2a552';

export function getTerrainMaterial(): MeshStandardMaterial {
  if (shared) return shared;
  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
  });
  const uniforms = {
    tGrass: { value: getTexture('grass') },
    tDirt: { value: getTexture('dirt') },
    tRock: { value: getTexture('rock') },
    tGravel: { value: getTexture('gravel') },
    tMacro: { value: getTexture('macro') },
    uDebugSplat: { value: 0 },
    uTintGrass: { value: new Color(1, 1, 1) },
    uTintAmount: { value: 0 },
    uTintCrop: { value: new Color(DEFAULT_CROP) },
    /** Bump strength (0 = flat, `setTerrainRelief`). */
    uRelief: { value: 1 },
  };
  mat.userData.uniforms = uniforms;
  // Canopy shadows beyond the shadow map (engine/world-shading.ts).
  mat.defines = { RALLY_GROUND: 1 };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    addWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec3 vWPos;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        vSplat = splat;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tGrass, tDirt, tRock, tGravel, tMacro;
        uniform float uDebugSplat;
        uniform vec3 uTintGrass;
        uniform float uTintAmount;
        uniform vec3 uTintCrop;
        uniform float uRelief;
        varying vec4 vSplat;
        varying vec3 vWPos;
        // Bump from a screen-space height gradient (three's perturbNormalArb, Mikkelsen).
        vec3 terrainPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
          vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
          vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
          vec3 R1 = cross( vSigmaY, surf_norm );
          vec3 R2 = cross( surf_norm, vSigmaX );
          float fDet = dot( vSigmaX, R1 ) * faceDirection;
          vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
          return normalize( abs( fDet ) * surf_norm - vGrad );
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // No branch: screen-space derivatives are undefined in non-uniform control flow (0 relief = same normal).
        float reliefFade = uRelief * ( 1.0 - smoothstep( 25.0, 90.0, length( vWPos - cameraPosition ) ) );
        normal = terrainPerturb( - vViewPosition, normal, vec2( dFdx( terrainH ), dFdy( terrainH ) ) * reliefFade, faceDirection );`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 wp = vWPos.xz;
        float macro = texture2D(tMacro, wp * 0.0031).r;
        float macro2 = texture2D(tMacro, wp * 0.027 + 0.37).r;
        vec3 cGrass = mix(texture2D(tGrass, wp * 0.22).rgb, texture2D(tGrass, wp * 0.061).rgb, 0.45);
        vec3 cDirt = texture2D(tDirt, wp * 0.28).rgb;
        vec3 cRock = mix(texture2D(tRock, wp * 0.13).rgb, texture2D(tRock, wp * 0.041).rgb, 0.4);
        vec3 cGravel = texture2D(tGravel, wp * 0.33).rgb;
        // Recolour (0.09 = mean linear luminance of the grass texture).
        float grassLum = dot(cGrass, vec3(0.2126, 0.7152, 0.0722)) / 0.09;
        cGrass = mix(cGrass, uTintGrass * grassLum, uTintAmount);
        // Ripe crop (wheat): the weight the 4 splat channels leave unused (0.02 = 8-bit rounding slack).
        float crop = max(0.0, 0.98 - (vSplat.x + vSplat.y + vSplat.z + vSplat.w)) / 0.98;
        vec3 cCrop = uTintCrop * mix(0.8, 1.15, grassLum) * (0.85 + macro2 * 0.3);
        // Sharpen transitions with noise so blends look like patches, not gradients.
        vec4 w = vSplat;
        w.y *= 0.6 + macro2 * 0.9;
        w.z *= 0.7 + macro2 * 0.8;
        w = pow(max(w, vec4(0.0)), vec4(1.6));
        crop = pow(crop, 1.6);
        float wSum = max(1e-4, w.x + w.y + w.z + w.w + crop);
        w /= wSum;
        crop /= wSum;
        vec3 col = cGrass * w.x + cDirt * w.y + cRock * w.z + cGravel * w.w + cCrop * crop;
        col *= mix(0.78, 1.16, macro);
        if (uDebugSplat > 0.5) col = vec3(w.x * 0.2 + w.y * 0.6 + w.w * 0.9 + crop, w.x * 0.8 + w.y * 0.4 + w.w * 0.8 + crop * 0.8, w.z + w.w * 0.5);
        diffuseColor.rgb *= col;
        // Height for the relief: per-layer brightness, rock / gravel bumpiest, grass nearly flat.
        vec4 lum = vec4(
          dot(cGrass, vec3(0.3333)) * 0.25,
          dot(cDirt, vec3(0.3333)) * 0.6,
          dot(cRock, vec3(0.3333)),
          dot(cGravel, vec3(0.3333)) * 0.9
        );
        float terrainH = dot(lum, w) * 4.0;
        `,
      );
  };
  mat.customProgramCacheKey = () => 'rally-terrain-v3';
  shared = mat;
  return mat;
}

/** Terrain bump strength (0 = flat; low quality turns it off). */
export function setTerrainRelief(strength: number): void {
  getTerrainMaterial().userData.uniforms.uRelief.value = strength;
}

/** Per-map grass / crop recolour (EnvironmentDef.groundTint); undefined = original texture. */
export function setGroundTint(tint: EnvironmentDef['groundTint']): void {
  const u = getTerrainMaterial().userData.uniforms;
  u.uTintGrass.value.set(tint?.grass ?? '#ffffff');
  u.uTintAmount.value = tint ? (tint.amount ?? 0.85) : 0;
  u.uTintCrop.value.set(tint?.crop ?? DEFAULT_CROP);
}
