import {
  Color,
  DataTexture,
  MeshStandardMaterial,
  RedFormat,
  Vector4,
} from 'three';
import type { EnvironmentDef } from '../maps/shared/types';
import { getTexture } from '../engine/textures';
import {
  GROUND_LAYER,
  GROUND_MEAN,
  GROUND_SCAN,
  groundArray,
} from '../engine/ground-textures';
import { type Season } from '../season';
import { addWorldUniforms } from '../engine/world-shading';
import type { GroundMoisture } from './ground-moisture';

/**
 * Terrain splat material: MeshStandardMaterial (so it gets sun, shadows, fog and IBL for free) with the diffuse
 * replaced by a blend of tiling world-space scans (Poly Haven, `engine/ground-textures.ts`) driven by the per-vertex
 * `splat` attribute [grass, dirt, rock, gravel]:
 * - The channels are blended by height (each scan's brightness is its height: stones stand out of soil, leaves out of
 *   grass) instead of a plain cross-fade, so transitions follow the ground's own structure.
 * - Tiling is broken by a second, rotated, larger-scale tap of the same scan that only modulates the near one (3 taps
 *   per layer; far chunks one). Layers a fragment does not use are not sampled (`textureGrad`, branches are safe).
 * - Grass takes the season's scan (spring / summer / autumn) and the map's tint (`setGroundTint`); fallen leaves and
 *   forest-floor litter lie where the baked canopy texture says there are tree crowns (`wsCanopyCover`).
 * Relief: the blended scans' brightness doubles as a height map (bump from screen-space derivatives, faded out by
 * ~90 m) so a low sun picks out stones and leaves.
 * Weight the four channels leave unused (sum < 1) is drawn as ripe crop (wheat fields, stubble scan).
 * Grass moisture: lusher green in hollows / by water, straw on ridges and steep slopes (`setGroundMoisture`, a
 * baked map texture + the vertex normal + slow macro noise so flat land is not one colour either).
 *
 * One instance is shared by every near chunk and one `far` variant by every coarser chunk (beyond the first LOD
 * band, ~150 m): no relief (it fades out by 90 m anyway), one tap per layer, no specular environment lookup;
 * both read the same uniforms.
 */
let shared: MeshStandardMaterial | undefined;
let sharedFar: MeshStandardMaterial | undefined;
let sharedUniforms: Record<string, { value: unknown }> | undefined;

/** Ripe wheat. */
const DEFAULT_CROP = '#c2a552';
/** Gravel is sampled this much sharper than the mip chain asks: a scan averaged out by distance reads as blur (the gravel road shares it). */
export const GRAVEL_SHARP = 0.5;
/** 1 x 1 neutral moisture (0.5) for pages without a baked map: only slope + macro noise vary the grass. */
const NEUTRAL_MOISTURE = new DataTexture(
  new Uint8Array([128]),
  1,
  1,
  RedFormat,
);
NEUTRAL_MOISTURE.needsUpdate = true;

export function getTerrainMaterial(far = false): MeshStandardMaterial {
  if (far ? sharedFar : shared) return (far ? sharedFar : shared)!;
  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
  });
  const uniforms = sharedUniforms ?? {
    tGround: { value: groundArray() },
    /** x grass layer, y grass scan size (m), z litter under crowns 0..1, w fallen-leaf colour patches 0..1. */
    uGroundLook: { value: new Vector4(GROUND_LAYER.grassSummer, 2.51, 0.4, 0) },
    tMacro: { value: getTexture('macro') },
    uDebugSplat: { value: 0 },
    uTintGrass: { value: new Color(1, 1, 1) },
    uTintAmount: { value: 0 },
    uTintCrop: { value: new Color(DEFAULT_CROP) },
    tMoist: { value: NEUTRAL_MOISTURE },
    /** Moisture texture on the ground: x0, z0, 1 / width, 1 / depth. */
    uMoistMap: { value: new Vector4(0, 0, 1, 1) },
    /** Moisture tint strength (0 = off, `groundTint.moisture`). */
    uMoist: { value: 1 },
    /** Meadow colour patches (0 = off, `groundTint.variety`). */
    uVariety: { value: 0 },
    /** Bump strength (0 = flat, `setTerrainRelief`). */
    uRelief: { value: 1 },
    /** Distance (m) of the second taps and the relief (0 = off, `setTerrainDetail`). */
    uDetail: { value: 45 },
  };
  sharedUniforms = uniforms;
  mat.userData.uniforms = uniforms;
  // Canopy shadows beyond the shadow map (engine/world-shading.ts).
  mat.defines = {
    RALLY_GROUND: 1,
    ...(far ? { TERRAIN_FAR: 1 } : {}),
    HB_K: '0.15',
    HB_D: '0.25',
    GY_SOIL: GROUND_LAYER.soil.toFixed(1),
    GY_GRAVEL: GROUND_LAYER.gravel.toFixed(1),
    GS_SHARP: GRAVEL_SHARP.toFixed(2),
    GY_ROCK: GROUND_LAYER.rock.toFixed(1),
    GY_LITTER: GROUND_LAYER.litter.toFixed(1),
    GY_LEAVES: GROUND_LAYER.leaves.toFixed(1),
    GY_STUBBLE: GROUND_LAYER.stubble.toFixed(1),
    GM_GRASS: GROUND_MEAN.grassSummer.toFixed(4),
    GM_SOIL: GROUND_MEAN.soil.toFixed(4),
    GM_GRAVEL: GROUND_MEAN.gravel.toFixed(4),
    GM_ROCK: GROUND_MEAN.rock.toFixed(4),
    GM_LITTER: GROUND_MEAN.litter.toFixed(4),
    GM_STUBBLE: GROUND_MEAN.stubble.toFixed(4),
    GS_SOIL: (1 / GROUND_SCAN.soil).toFixed(4),
    GS_GRAVEL: (1 / GROUND_SCAN.gravel).toFixed(4),
    GS_ROCK: (1 / GROUND_SCAN.rock).toFixed(4),
    GS_LITTER: (1 / GROUND_SCAN.litter).toFixed(4),
    GS_LEAVES: (1 / GROUND_SCAN.leaves).toFixed(4),
    GS_STUBBLE: (1 / GROUND_SCAN.stubble).toFixed(4),
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    addWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying float vUpY;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        vSplat = splat;
        vUpY = normal.y; // terrain meshes are only translated: object normal = world normal
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tMacro;
        uniform mediump sampler2DArray tGround;
        uniform vec4 uGroundLook;
        uniform float uDetail;
        uniform float uDebugSplat;
        uniform vec3 uTintGrass;
        uniform float uTintAmount;
        uniform float uVariety;
        uniform vec3 uTintCrop;
        uniform float uRelief;
        uniform sampler2D tMoist;
        uniform vec4 uMoistMap;
        uniform float uMoist;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying float vUpY;
        // Bump from a screen-space height gradient (three's perturbNormalArb, Mikkelsen).
        vec3 terrainPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
          // The offsets keep a zero derivative (screen edge, a lone helper pixel) from making a NaN.
          vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) + vec3( 1e-9 ) );
          vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) + vec3( 1e-9 ) );
          vec3 R1 = cross( vSigmaY, surf_norm );
          vec3 R2 = cross( surf_norm, vSigmaX );
          float fDet = dot( vSigmaX, R1 ) * faceDirection;
          vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
          return normalize( abs( fDet ) * surf_norm - vGrad + surf_norm * 1e-6 );
        }
        // One scan tap by explicit gradients (so layers can be skipped in a branch): p world metres, s = 1 / scan size.
        vec3 gTap( float layer, vec2 p, float s, vec2 dx, vec2 dy ) {
          float sharp = layer == GY_GRAVEL ? GS_SHARP : 1.0;
          return textureGrad( tGround, vec3( p * s, layer ), dx * s * sharp, dy * s * sharp ).rgb;
        }
        // The scan with its tiling broken: a rotated, blurred tap at ~1/3 the scale modulates its brightness. ml = the scan's
        // mean linear luminance (GROUND_MEAN). hh = brightness relative to that mean (1 = average): x the near tap (the
        // height in the blend), y the blurred tap (the relief: derivatives of the fine one are 2 x 2 pixel noise).
        // near: 1 within the detail distance (uDetail), 0 beyond it: the second tap is only taken where near > 0.
        vec3 gVar( float layer, vec2 p, float s, float ml, vec2 dx, vec2 dy, float near, out vec2 hh ) {
          vec3 a = gTap( layer, p, s, dx, dy );
          hh = vec2( clamp( dot( a, vec3( 0.2126, 0.7152, 0.0722 ) ) / ml, 0.5, 1.5 ), 1.0 );
          #ifndef TERRAIN_FAR
          if ( near > 0.0 ) {
            mat2 R = mat2( 0.8, -0.6, 0.6, 0.8 );
            // Gradients x6: ~3 mip levels blurrier, so its brightness is a smooth height and a soft modulation.
            vec3 b = gTap( layer, R * p + 31.7, s * 0.31, R * dx * 6.0, R * dy * 6.0 );
            hh.y = mix( 1.0, clamp( dot( b, vec3( 0.2126, 0.7152, 0.0722 ) ) / ml, 0.0, 3.0 ), near );
            a *= mix( 1.0, clamp( hh.y, 0.45, 2.0 ), 0.55 );
          }
          #endif
          return a;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifndef TERRAIN_FAR
        // No branch: screen-space derivatives are undefined in non-uniform control flow (0 relief = same normal).
        float reliefFade = uDetail > 0.0 ? uRelief * ( 1.0 - smoothstep( uDetail * 0.55, uDetail, length( vWPos - cameraPosition ) ) ) : 0.0;
        normal = terrainPerturb( - vViewPosition, normal, vec2( dFdx( terrainH ), dFdy( terrainH ) ) * reliefFade, faceDirection );
        #endif`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        `#ifdef TERRAIN_FAR
        // Rough ground: the specular environment lookup adds next to nothing here (far chunks only).
        #define getIBLRadiance( v, n, r ) vec3( 0.0 )
        #endif
        #include <lights_fragment_maps>`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 wp = vWPos.xz;
        vec2 dpx = dFdx( wp );
        vec2 dpy = dFdy( wp );
        float macro = texture2D(tMacro, wp * 0.0031).r;
        float macro2 = texture2D(tMacro, wp * 0.027 + 0.37).r;
        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
        // Meadow patches: deeper green and yellow-green drifts tens of metres across, so a tinted meadow is not one flat colour.
        float pv = texture2D(tMacro, wp * 0.019 + 0.21).r * 0.6 + texture2D(tMacro, wp * 0.083 + 0.53).r * 0.4;
        // Moisture -1 (dry) .. 1 (wet): baked hollows / banks, minus steepness, plus slow noise.
        float wet = texture2D(tMoist, (wp - uMoistMap.xy) * uMoistMap.zw).r * 2.0 - 1.0;
        wet -= smoothstep(0.04, 0.25, 1.0 - vUpY) * 0.7;
        wet += (texture2D(tMacro, wp * 0.0017 + 0.61).r - 0.5) * 0.7;
        wet = clamp(wet * uMoist, -1.0, 1.0);
        // Ripe crop (wheat): the weight the 4 splat channels leave unused (0.02 = 8-bit rounding slack).
        float crop = max(0.0, 0.98 - (vSplat.x + vSplat.y + vSplat.z + vSplat.w)) / 0.98;
        // Patches, not gradients: the weights are normalised, then blended by height below.
        vec4 w = vSplat;
        w.y *= 0.6 + macro2 * 0.9;
        w.z *= 0.7 + macro2 * 0.8;
        float wSum = max(1e-4, w.x + w.y + w.z + w.w + crop);
        w /= wSum;
        crop /= wSum;
        // Leaf litter: under the tree crowns (baked canopy texture), broken up by noise; not on rock, little on gravel.
        float cover = wsCanopyCover(wp);
        float lit = clamp((cover - 0.08) / 0.45 + (macro2 - 0.5) * 0.9, 0.0, 1.0) * uGroundLook.z;
        lit *= (1.0 - w.z) * (1.0 - 0.6 * w.w);
        w *= 1.0 - lit;
        crop *= 1.0 - lit;
        // Scans of the layers in use only (a = weight + height, -1 = unused; r = relief height).
        vec3 cGrass = vec3(0.0), cDirt = vec3(0.0), cRock = vec3(0.0), cGravel = vec3(0.0), cLit = vec3(0.0), cCrop = vec3(0.0);
        float aG = -1.0, aD = -1.0, aR = -1.0, aV = -1.0, aL = -1.0, aC = -1.0;
        // Relief height per layer: its scale at the scan's mean height (h.y = 1) unless sampled, so a layer crossing wCut
        // (sampled on one pixel, skipped on its neighbour) does not make the height jump: that jump made a row of dark
        // pixels along splat edges (the gravel at a bank top or a road side).
        float rG = 0.12, rD = 0.35, rR = 0.5, rV = 0.5, rL = 0.4, rC = 0.1;
        vec2 h = vec2(1.0);
        // Second taps (tiling breakup, relief, fresh leaves) only within uDetail m (0 = never: medium / low quality).
        #ifdef TERRAIN_FAR
        float near = 0.0;
        #else
        float near = uDetail > 0.0 ? 1.0 - smoothstep(uDetail * 0.8, uDetail, length(vWPos - cameraPosition)) : 0.0;
        #endif
        // A layer can only show in the height blend if its weight is within ~0.5 of the strongest (heights are clamped to
        // 0.5..1.5): weaker ones are not sampled at all.
        float wCut = max(0.02, max(max(max(w.x, w.y), max(w.z, w.w)), max(lit, crop)) - 0.5);
        if (w.x > wCut) {
          cGrass = gVar(uGroundLook.x, wp, 1.0 / uGroundLook.y, GM_GRASS, dpx, dpy, near, h);
          aG = w.x + HB_K * (h.x - 1.0);
          rG = 0.12 * mix(1.0, h.y, smoothstep(wCut, wCut + 0.15, w.x));
          // Recolour (0.09 = mean linear luminance of the grass scans).
          float grassLum = dot(cGrass, LUMA) / 0.09;
          cGrass = mix(cGrass, uTintGrass * grassLum, uTintAmount);
          vec3 cPatch = mix(cGrass * vec3(0.55, 0.8, 0.45), cGrass * vec3(1.35, 1.2, 0.6), smoothstep(0.38, 0.62, pv));
          cGrass = mix(cGrass, cPatch, uVariety);
          float gLum = dot(cGrass, LUMA);
          // Wet: deeper, more saturated green. Dry: pale golden straw (brighter, or it reads as bare dirt).
          vec3 cLush = cGrass * vec3(0.62, 1.0, 0.5);
          vec3 cStraw = gLum * vec3(1.9, 1.45, 0.62);
          cGrass = mix(cGrass, wet > 0.0 ? cLush : cStraw, wet > 0.0 ? min(1.0, wet * 1.15) : -wet * 0.55);
        }
        if (w.y > wCut) {
          cDirt = gVar(GY_SOIL, wp, GS_SOIL, GM_SOIL, dpx, dpy, near, h);
          aD = w.y + HB_K * (h.x - 1.0);
          rD = 0.35 * mix(1.0, h.y, smoothstep(wCut, wCut + 0.15, w.y));
        }
        if (w.z > wCut) {
          cRock = gVar(GY_ROCK, wp, GS_ROCK, GM_ROCK, dpx, dpy, near, h);
          aR = w.z + 0.05 + HB_K * (h.x - 1.0);
          rR = 0.5 * mix(1.0, h.y, smoothstep(wCut, wCut + 0.15, w.z));
        }
        if (w.w > wCut) {
          cGravel = gVar(GY_GRAVEL, wp, GS_GRAVEL, GM_GRAVEL, dpx, dpy, near, h);
          #ifndef TERRAIN_FAR
          // Close up the 512 px scan is magnified: a third tap at about a third of the size (the gravel road has it too, world/gravel-road.ts).
          float gNear = 1.0 - smoothstep(6.0, 20.0, length(vWPos - cameraPosition));
          if (gNear > 0.0) {
            mat2 R3 = mat2(0.6, 0.8, -0.8, 0.6);
            cGravel *= mix(1.0, clamp(dot(gTap(GY_GRAVEL, R3 * wp + 7.3, GS_GRAVEL * 3.1, R3 * dpx, R3 * dpy), LUMA) / GM_GRAVEL, 0.4, 2.2), 0.6 * gNear);
          }
          #endif
          aV = w.w + 0.1 + HB_K * (h.x - 1.0);
          rV = 0.5 * mix(1.0, h.y, smoothstep(wCut, wCut + 0.15, w.w));
        }
        if (lit > wCut) {
          cLit = gVar(GY_LITTER, wp, GS_LITTER, GM_LITTER, dpx, dpy, near, h);
          // Fresh fallen leaves (autumn): golden, thickest near the trunks, in drifts further out (one tap, under crowns only).
          if (uGroundLook.w > 0.01) {
            vec3 cLeaf = gTap(GY_LEAVES, wp, GS_LEAVES, dpx, dpy) * vec3(1.3, 1.08, 0.62);
            float lp = uGroundLook.w * clamp(smoothstep(0.3, 0.6, texture2D(tMacro, wp * 0.06 + 0.77).r) + (cover - 0.55) * 1.6, 0.0, 1.0);
            cLit = mix(cLit, cLeaf, lp * 0.9);
          }
          aL = lit + 0.1 + HB_K * (h.x - 1.0);
          rL = 0.4 * mix(1.0, h.y, smoothstep(wCut, wCut + 0.15, lit));
        }
        if (crop > wCut) {
          float sl = dot(gVar(GY_STUBBLE, wp, GS_STUBBLE, GM_STUBBLE, dpx, dpy, near, h), LUMA) / 0.09;
          cCrop = uTintCrop * mix(0.8, 1.15, clamp(sl, 0.0, 2.0) * 0.5) * (0.85 + macro2 * 0.3);
          aC = crop + HB_K * (h.x - 1.0);
          rC = 0.1 * mix(1.0, h.y, smoothstep(wCut, wCut + 0.15, crop));
        }
        // Height blend: a layer shows through where it stands higher than its neighbours (band HB_D).
        float ma = max(max(max(aG, aD), max(aR, aV)), max(aL, aC));
        vec4 wb = vec4(
          aG > -0.5 ? max(aG - ma + HB_D, 0.0) : 0.0,
          aD > -0.5 ? max(aD - ma + HB_D, 0.0) : 0.0,
          aR > -0.5 ? max(aR - ma + HB_D, 0.0) : 0.0,
          aV > -0.5 ? max(aV - ma + HB_D, 0.0) : 0.0
        );
        float wbL = aL > -0.5 ? max(aL - ma + HB_D, 0.0) : 0.0;
        float wbC = aC > -0.5 ? max(aC - ma + HB_D, 0.0) : 0.0;
        float wbSum = max(1e-4, wb.x + wb.y + wb.z + wb.w + wbL + wbC);
        wb /= wbSum;
        wbL /= wbSum;
        wbC /= wbSum;
        vec3 col = cGrass * wb.x + cDirt * wb.y + cRock * wb.z + cGravel * wb.w + cLit * wbL + cCrop * wbC;
        col *= mix(0.78, 1.16, macro);
        // Debug: the blended weights, grass green, dirt red, rock blue, gravel white, litter orange, crop yellow.
        if (uDebugSplat > 0.5) col = vec3(0.0, 0.6, 0.0) * wb.x + vec3(0.6, 0.05, 0.0) * wb.y + vec3(0.0, 0.1, 0.8) * wb.z + vec3(0.7) * wb.w + vec3(0.8, 0.3, 0.0) * wbL + vec3(0.8, 0.7, 0.0) * wbC;
        diffuseColor.rgb *= col;
        #ifndef TERRAIN_FAR
        // Height for the relief: the coarse scan tap per layer (smooth), by the splat weights (not the per-pixel height blend), rock / gravel bumpiest, grass nearly flat.
        // Centred on each layer's scale (rX - its default): the scales differ per layer, so their vertex-weighted sum is a slope
        // across every splat transition that changes with each triangle: a one-pixel line along the triangle edges (at the road side).
        float terrainH = ((rG - 0.12) * w.x + (rD - 0.35) * w.y + (rR - 0.5) * w.z + (rV - 0.5) * w.w + (rL - 0.4) * lit + (rC - 0.1) * crop) * 4.0;
        #endif
        `,
      );
  };
  mat.customProgramCacheKey = () =>
    far ? 'rally-terrain-far-v6' : 'rally-terrain-v11';
  if (far) sharedFar = mat;
  else shared = mat;
  return mat;
}

/** Second scan taps (tiling breakup, fresh leaves) and relief within `metres` of the camera (0 = off: medium / low). */
export function setTerrainDetail(metres: number): void {
  getTerrainMaterial().userData.uniforms.uDetail.value = metres;
}

/** Terrain bump strength (0 = flat; low quality turns it off). */
export function setTerrainRelief(strength: number): void {
  getTerrainMaterial().userData.uniforms.uRelief.value = strength;
}

/** Grass scan, leaf litter under tree crowns and fallen-leaf patches per season (`GroundTint.litter` overrides the litter). */
const SEASON_LOOK: Record<
  Season,
  { grass: number; scan: number; litter: number; leaves: number }
> = {
  spring: {
    grass: GROUND_LAYER.grassSpring,
    scan: GROUND_SCAN.grassSpring,
    litter: 0.3,
    leaves: 0,
  },
  summer: {
    grass: GROUND_LAYER.grassSummer,
    scan: GROUND_SCAN.grassSummer,
    litter: 0.45,
    leaves: 0,
  },
  autumn: {
    grass: GROUND_LAYER.grassAutumn,
    scan: GROUND_SCAN.grassAutumn,
    litter: 1,
    leaves: 1,
  },
};

/** Per-map grass / crop recolour (EnvironmentDef.groundTint) and the season's scans; undefined = original colours. */
export function setGroundTint(
  tint: EnvironmentDef['groundTint'],
  season: Season = 'summer',
): void {
  const u = getTerrainMaterial().userData.uniforms;
  u.uTintGrass.value.set(tint?.grass ?? '#ffffff');
  u.uTintAmount.value = tint ? (tint.amount ?? 0.85) : 0;
  u.uTintCrop.value.set(tint?.crop ?? DEFAULT_CROP);
  u.uMoist.value = tint?.moisture ?? 1;
  u.uVariety.value = tint?.variety ?? 0;
  const look = SEASON_LOOK[season];
  u.uGroundLook.value.set(
    look.grass,
    look.scan,
    tint?.litter ?? look.litter,
    look.leaves,
  );
}

/** Map-wide ground moisture (world/ground-moisture.ts, `World.moisture`); null = neutral (slope + noise only). */
export function setGroundMoisture(m: GroundMoisture | null): void {
  const u = getTerrainMaterial().userData.uniforms;
  u.tMoist.value = m?.texture ?? NEUTRAL_MOISTURE;
  if (m) u.uMoistMap.value.set(m.map.x0, m.map.z0, m.map.invW, m.map.invD);
  else u.uMoistMap.value.set(0, 0, 1, 1);
}
