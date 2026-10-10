import type { Material, Mesh, MeshStandardMaterial, Object3D } from 'three';

/**
 * Baked vertex ambient occlusion on imported car models (`scripts/car-model/bake-ao.mjs` writes a `_DARK` attribute,
 * three exposes it as `geometry.attributes._dark`: 0 = open, 1 = occluded). The shader dims the ambient, sky and
 * reflected light there (not the sun, which has its shadow map), so recesses stop glowing. No extra draw call, one
 * extra attribute read. `?ao=0` turns it off for a before / after comparison.
 */
export const VERTEX_AO_ATTRIBUTE = '_dark';

/** How strongly the baked value dims the light, and the darkest it may get. */
const GAIN = 1.4;
const FLOOR = 0.12;

const enabled = () =>
  typeof location === 'undefined' ||
  new URLSearchParams(location.search).get('ao') !== '0';

function patch(m: MeshStandardMaterial): void {
  const prevKey = m.customProgramCacheKey();
  const prev = m.onBeforeCompile;
  m.userData.vertexAo = true;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float ${VERTEX_AO_ATTRIBUTE};
varying float vVertexDark;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vVertexDark = ${VERTEX_AO_ATTRIBUTE};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vVertexDark;`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
{
  float vertexAo = clamp( 1.0 - vVertexDark * ${GAIN.toFixed(3)}, ${FLOOR.toFixed(3)}, 1.0 );
  reflectedLight.indirectDiffuse *= vertexAo;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= vertexAo;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float vaoNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( vaoNV, vertexAo, material.roughness );
  #endif
}`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|vertexAo`;
  m.needsUpdate = true;
}

/**
 * Patch the materials of every mesh under `root` that carries the baked attribute. Materials in `own` belong to the
 * car (patched in place, so the livery code keeps its reference); any other (shared part materials) is cloned once
 * per call and the clone added to `owned` for disposal.
 */
export function applyVertexAo(
  root: Object3D,
  own: ReadonlySet<object>,
  owned: object[],
): void {
  if (!enabled()) return;
  const clones = new Map<Material, Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute(VERTEX_AO_ATTRIBUTE))
      return;
    const src = mesh.material as MeshStandardMaterial;
    if (Array.isArray(src) || !src.isMeshStandardMaterial) return;
    if (own.has(src)) {
      if (!src.userData.vertexAo) patch(src);
      return;
    }
    let c = clones.get(src);
    if (!c) {
      const copy = src.clone();
      // clone() drops the per-material shader hooks (lampDepth's recessed lamps).
      copy.onBeforeCompile = src.onBeforeCompile;
      copy.customProgramCacheKey = src.customProgramCacheKey;
      copy.userData = { ...src.userData };
      patch(copy);
      clones.set(src, copy);
      owned.push(copy);
      c = copy;
    }
    mesh.material = c;
  });
}
