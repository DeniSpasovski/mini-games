import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  RepeatWrapping,
  RGBAFormat,
  ShaderChunk,
  SRGBColorSpace,
  Texture,
  Vector2,
  type MeshStandardMaterial,
} from 'three';
import type { MapDef } from '../maps/shared/types';
import { loadQuality } from './quality';
import { getTexture } from './textures';

/**
 * Baked asphalt for the paved roads: a colour map plus a normal map with the roughness packed in its alpha, per road
 * type and per size (`./asphalt/<id>.<size>.{color,normal,rough}.webp`, drawn by `scripts/asphalt/bake.mjs`).
 * High loads the 1024 px set, Medium and Low their own 512 px set. The road material (`world/road-mesh.ts`
 * `getRoadMaterial`) takes the maps from here; until a set has loaded it is a plain dark surface, and a set that
 * fails to load falls back to the procedural tile of the same id (`engine/textures.ts`).
 */
export type RoadSurfaceId =
  | 'road_tarmac'
  | 'road_tarmac_kerbed'
  | 'road_tarmac_junction'
  | 'road_tarmac_lines'
  | 'road_tarmac_plain'
  | 'road_city'
  | 'road_street'
  | 'road_street4'
  | 'road_parkway'
  | 'junction_asphalt';

/** Metres per tile along the road: the baked tiles' `len` (scripts/asphalt/gen.js presets) and `texLength` (world/road-mesh.ts). */
export const ROAD_SURFACE_LEN: Record<RoadSurfaceId, number> = {
  road_tarmac: 7,
  road_tarmac_kerbed: 7,
  road_tarmac_junction: 7,
  road_tarmac_lines: 7,
  road_tarmac_plain: 7,
  road_city: 8,
  road_street: 8,
  road_street4: 12,
  road_parkway: 12,
  junction_asphalt: 8,
};

/**
 * Roads with pale repair patches (a shader effect, so they never repeat): Vodno's mountain road. The number scales their
 * count; they are rare near the start and come more often up the road (`rsPatch` in `applyRoadSurface`).
 */
const PATCHES: Partial<Record<RoadSurfaceId, number>> = {
  road_tarmac_lines: 1,
  road_tarmac_plain: 1,
};
/**
 * Roads that blend into the world-aligned junction asphalt (`road_tarmac_junction`, sampled by world XZ) by the mesh's
 * `jw` attribute: plain tarmac side road mouths (world/road-mesh.ts `junctionMouths`).
 */
const BLENDS = new Set<RoadSurfaceId>(['road_tarmac', 'road_tarmac_kerbed']);
/** Strength of the 9 m / 3 m blotches (1 = default): a calmer tone where the real road is even. */
const TONE: Partial<Record<RoadSurfaceId, number>> = {
  road_tarmac_lines: 0.6,
  road_tarmac_plain: 0.6,
};

export const isRoadSurface = (id: string): id is RoadSurfaceId =>
  Object.prototype.hasOwnProperty.call(ROAD_SURFACE_LEN, id);

interface Surface {
  map: Texture;
  normal: DataTexture;
}

const surfaces = new Map<RoadSurfaceId, Surface>();
const pending = new Map<RoadSurfaceId, Promise<Surface | undefined>>();

/** 1024 px set on High, the 512 px set on Medium / Low. */
const tileSize = () => (loadQuality().name === 'high' ? 1024 : 512);

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`road surface: ${url}`));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

async function loadSurface(id: RoadSurfaceId): Promise<Surface | undefined> {
  const size = tileSize();
  try {
    const urls = await Promise.all(
      (['color', 'normal', 'rough'] as const).map(async (part) => {
        const m = await import(`./asphalt/${id}.${size}.${part}.webp`);
        return (m.default ?? m) as string;
      }),
    );
    const [color, normal, rough] = await Promise.all(urls.map(image));
    const aniso = size === 1024 ? 16 : 8;
    const map = new Texture(color);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.minFilter = LinearMipmapLinearFilter;
    map.anisotropy = aniso;
    map.needsUpdate = true;
    // Normal xyz + roughness (the rough map's green) in one RGBA texture: one sampler. Rows bottom-up for a DataTexture.
    const n = pixels(normal);
    const r = pixels(rough);
    const out = new Uint8Array(n.length);
    const row = size * 4;
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * row;
      for (let x = 0; x < row; x += 4) {
        const s = src + x;
        const d = y * row + x;
        out[d] = n[s];
        out[d + 1] = n[s + 1];
        out[d + 2] = n[s + 2];
        out[d + 3] = r[s + 1];
      }
    }
    const nt = new DataTexture(out, size, size, RGBAFormat);
    nt.wrapS = nt.wrapT = RepeatWrapping;
    nt.minFilter = LinearMipmapLinearFilter;
    nt.magFilter = LinearFilter;
    nt.generateMipmaps = true;
    nt.anisotropy = aniso;
    nt.needsUpdate = true;
    return { map, normal: nt };
  } catch (e) {
    console.warn(e);
    return undefined;
  }
}

/** Load one set (once); resolves undefined when it could not be loaded. */
export function loadRoadSurface(
  id: RoadSurfaceId,
): Promise<Surface | undefined> {
  let p = pending.get(id);
  if (!p) {
    p = loadSurface(id).then((s) => {
      if (s) surfaces.set(id, s);
      return s;
    });
    pending.set(id, p);
  }
  return p;
}

/** The sets a map draws: its stage road, the paved side roads, and the city street kinds. Others load on demand. */
export function roadSurfaceIds(map: MapDef): RoadSurfaceId[] {
  const ids = new Set<RoadSurfaceId>(['road_tarmac', 'road_tarmac_junction']);
  const add = (t?: string) => {
    if (t && isRoadSurface(t)) ids.add(t);
  };
  add(map.road.texture);
  for (const s of map.road.sections ?? []) add(s.texture);
  if (map.cityStreets)
    for (const t of [
      'road_city',
      'road_street',
      'road_street4',
      'road_parkway',
      'junction_asphalt',
    ])
      add(t);
  return [...ids];
}

/** Fetch a map's road sets (behind the loading overlay), so the road never shows the placeholder. */
export async function preloadRoadSurfaces(map: MapDef): Promise<void> {
  await Promise.all(roadSurfaceIds(map).map(loadRoadSurface));
}

/**
 * Give a road material its baked maps (or the placeholder + an in-place upgrade when they are not loaded yet).
 * The tone shader multiplies the colour by blotches (9 m, 3 m) and streaks along the road that never repeat, so the
 * tile does not show along a long straight. Roads in `PATCHES` also get pale repair patches (one cell of road = 10 m,
 * at most two patches in a cell: a pale rounded block, 0.5 - 1.9 m wide and up to 7 m long, with a wobbly edge).
 */
export function applyRoadSurface(
  m: MeshStandardMaterial,
  id: RoadSurfaceId,
): void {
  const blend = BLENDS.has(id);
  const configure = (s: Surface | undefined, js?: Surface) => {
    if (!s) {
      // Not available: the procedural tile of the same id (engine/textures.ts).
      m.map = getTexture(id);
      m.bumpMap = m.map;
      m.bumpScale = 1.2;
      m.roughness = 0.86;
      m.color.setScalar(1);
      m.needsUpdate = true;
      return;
    }
    m.map = s.map;
    m.normalMap = s.normal;
    m.normalScale = new Vector2(1, 1);
    m.roughness = 1;
    m.color.setScalar(1);
    const scale = { value: new Vector2(6, ROAD_SURFACE_LEN[id]) };
    const jLen = { value: ROAD_SURFACE_LEN.road_tarmac_junction };
    const patch = { value: PATCHES[id] ?? 0 };
    const tone = { value: TONE[id] ?? 1 };
    m.onBeforeCompile = (shader, renderer) => {
      // World shading (canopy / cloud shadows) hooks the default `onBeforeCompile`: keep it.
      Material.prototype.onBeforeCompile.call(m, shader, renderer);
      shader.uniforms.rsScale = scale;
      shader.uniforms.rsPatch = patch;
      shader.uniforms.rsTone = tone;
      // Junction blend: the same asphalt laid by world XZ, mixed in by `jw` (colour, normal, roughness, tone).
      const j = !!js;
      if (js) {
        shader.uniforms.jMap = { value: js.map };
        shader.uniforms.jNormal = { value: js.normal };
        shader.uniforms.jLen = jLen;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
            attribute float jw;
            varying float vJw;
            varying vec2 vJXZ;`,
          )
          .replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            vJw = jw;
            vJXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;`,
          );
      }
      const nSample = j
        ? 'mix( texture2D( normalMap, vNormalMapUv ), texture2D( jNormal, vJXZ / jLen ), vJw )'
        : 'texture2D( normalMap, vNormalMapUv )';
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec2 rsScale;
          uniform float rsPatch;
          uniform float rsTone;
          ${j ? 'uniform sampler2D jMap; uniform sampler2D jNormal; uniform float jLen; varying float vJw; varying vec2 vJXZ;' : ''}
          float rsHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
          float rsNoise( vec2 p ) {
            vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
            return mix( mix( rsHash( i ), rsHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( rsHash( i + vec2( 0.0, 1.0 ) ), rsHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 rsM = vMapUv * rsScale;
            float rsT = 0.6 * rsNoise( rsM / 9.0 ) + 0.4 * rsNoise( rsM / 2.7 + 7.1 );
            float rsS = rsNoise( vec2( rsM.x * 1.6, rsM.y / 22.0 ) + 3.3 );
            float rsK = 0.5 * rsT - 0.25 + 0.22 * ( rsS - 0.5 );
            ${
              j
                ? `if ( vJw > 0.0 ) {
              diffuseColor.rgb = mix( diffuseColor.rgb, texture2D( jMap, vJXZ / jLen ).rgb, vJw );
              float rsJ = 0.6 * rsNoise( vJXZ / 9.0 ) + 0.4 * rsNoise( vJXZ / 2.7 + 7.1 );
              rsK = mix( rsK, 0.5 * rsJ - 0.25, vJw );
            }`
                : ''
            }
            diffuseColor.rgb *= 1.03 + rsTone * rsK;
            if ( rsPatch > 0.0 ) {
              float rsCi = floor( rsM.y / 10.0 );
              float rsFy = rsM.y - rsCi * 10.0;
              float rsDens = rsPatch * mix( 0.25, 0.8, smoothstep( 250.0, 3500.0, rsM.y ) );
              float rsCov = 0.0;
              for ( int k = 0; k < 2; k ++ ) {
                vec2 id = vec2( rsCi, float( k ) * 17.0 + 1.0 );
                if ( rsHash( id ) < rsDens * ( k == 0 ? 1.0 : 0.35 ) ) {
                  float hl = 0.8 + 1.9 * pow( rsHash( id + 3.7 ), 2.0 );
                  float hw = 0.25 + 0.7 * rsHash( id + 7.3 );
                  float cy = hl + 0.2 + ( 9.6 - 2.0 * hl ) * rsHash( id + 11.9 );
                  float rsX = rsHash( id + 19.1 );
                  float cx = rsX < 0.5 ? 1.7 + 2.6 * step( 0.25, rsX ) + 0.5 * ( rsHash( id + 23.3 ) - 0.5 ) : 0.9 + 4.2 * rsHash( id + 29.9 );
                  vec2 q = vec2( ( rsM.x - cx ) / hw, ( rsFy - cy ) / hl );
                  q += 0.1 * ( vec2( rsNoise( rsM * 2.3 ), rsNoise( rsM * 2.3 + 9.0 ) ) - 0.5 );
                  float d = pow( pow( abs( q.x ), 3.0 ) + pow( abs( q.y ), 3.0 ), 1.0 / 3.0 );
                  rsCov = max( rsCov, 1.0 - smoothstep( 0.95, 1.0, d ) );
                }
              }
              diffuseColor.rgb *= 1.0 + 0.6 * rsCov * ( 0.75 + 0.25 * rsNoise( rsM * 9.0 ) );
            }
          }`,
        )
        // Roughness rides in the normal map's alpha.
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * ${nSample}.a;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          ShaderChunk.normal_fragment_maps
            .split('texture2D( normalMap, vNormalMapUv )')
            .join(nSample),
        );
    };
    // (the blended shader is different code: its own program)
    m.customProgramCacheKey = () =>
      Material.prototype.customProgramCacheKey.call(m) +
      (js ? ':junction' : '');
    m.needsUpdate = true;
  };
  const s = surfaces.get(id);
  const js = blend ? surfaces.get('road_tarmac_junction') : undefined;
  if (s && (!blend || js)) return configure(s, js);
  // Placeholder until the set arrives: a plain dark asphalt grey.
  m.color.setRGB(0.1, 0.1, 0.1);
  m.roughness = 0.9;
  void Promise.all([
    loadRoadSurface(id),
    blend ? loadRoadSurface('road_tarmac_junction') : undefined,
  ]).then(([a, b]) => configure(a, b));
}
