import {
  DoubleSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Color,
  type Material,
  type Texture,
} from 'three';
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  type NodeMaterial,
} from 'three/webgpu';

/**
 * The GPU trial's materials: a plain copy of each game material (colour, textures, alpha test, sides) without the
 * game's shader patches, the same for every renderer the trial compares, so the shaders cost the same and only the
 * renderer and the culling differ. Wind, wet, cloud shadows and the rest of engine/world-shading.ts are not in it.
 */

type Kind = 'standard' | 'lambert' | 'basic';

interface Plain {
  kind: Kind;
  params: Record<string, unknown>;
}

const plainCache = new Map<Material, Plain>();
/** Game materials the trial could not copy (ShaderMaterial and the like): drawn plain grey. */
export const unknownMaterials = new Set<string>();

function plainOf(m: Material): Plain {
  let p = plainCache.get(m);
  if (p) return p;
  const src = m as Material & {
    color?: Color;
    map?: Texture | null;
    normalMap?: Texture | null;
    roughness?: number;
    roughnessMap?: Texture | null;
    metalness?: number;
    metalnessMap?: Texture | null;
    aoMap?: Texture | null;
    alphaMap?: Texture | null;
    emissive?: Color;
    emissiveMap?: Texture | null;
    emissiveIntensity?: number;
    vertexColors?: boolean;
    flatShading?: boolean;
    isMeshStandardMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
    isMeshBasicMaterial?: boolean;
  };
  const kind: Kind = src.isMeshStandardMaterial
    ? 'standard'
    : src.isMeshLambertMaterial
      ? 'lambert'
      : src.isMeshBasicMaterial
        ? 'basic'
        : 'standard';
  if (
    !src.isMeshStandardMaterial &&
    !src.isMeshLambertMaterial &&
    !src.isMeshBasicMaterial
  )
    unknownMaterials.add(m.type + (m.name ? ` ${m.name}` : ''));
  const known = kind === 'standard' ? src.isMeshStandardMaterial : true;
  const params: Record<string, unknown> = {
    side: m.side,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    alphaToCoverage: m.alphaToCoverage,
    depthWrite: m.depthWrite,
  };
  if (known) {
    const copy = (k: string, v: unknown) => {
      if (v !== undefined && v !== null) params[k] = v;
    };
    copy('color', src.color);
    copy('map', src.map);
    copy('alphaMap', src.alphaMap);
    copy('vertexColors', src.vertexColors);
    if (kind !== 'basic') {
      copy('emissive', src.emissive);
      copy('emissiveMap', src.emissiveMap);
      copy('emissiveIntensity', src.emissiveIntensity);
      copy('aoMap', src.aoMap);
    }
    if (kind === 'standard') {
      copy('normalMap', src.normalMap);
      copy('roughness', src.roughness);
      copy('roughnessMap', src.roughnessMap);
      copy('metalness', src.metalness);
      copy('metalnessMap', src.metalnessMap);
      copy('flatShading', src.flatShading);
    }
  } else {
    params.color = 0x808080;
    params.side = DoubleSide;
  }
  p = { kind, params };
  plainCache.set(m, p);
  return p;
}

const classicCache = new Map<Material, Material>();

/** The plain copy for WebGLRenderer. */
export function classicMaterial(m: Material): Material {
  let c = classicCache.get(m);
  if (!c) {
    const { kind, params } = plainOf(m);
    c =
      kind === 'lambert'
        ? new MeshLambertMaterial(params)
        : kind === 'basic'
          ? new MeshBasicMaterial(params)
          : new MeshStandardMaterial(params);
    // Keeps the game's default hook (engine/world-shading.ts): its shader chunks are global in WebGLRenderer and need
    // their uniforms bound (all strengths 0 here = plain three.js shading).
    classicCache.set(m, c);
  }
  return c;
}

/** A new node material copy (callers set their own position node, so each caller gets its own). */
export function nodeMaterial(m: Material): NodeMaterial {
  const { kind, params } = plainOf(m);
  return kind === 'lambert'
    ? new MeshLambertNodeMaterial(params)
    : kind === 'basic'
      ? new MeshBasicNodeMaterial(params)
      : new MeshStandardNodeMaterial(params);
}

const nodeCache = new Map<Material, NodeMaterial>();

/** The node copy shared by every draw of a game material (instancing by three's own instance matrix). */
export function sharedNodeMaterial(m: Material): NodeMaterial {
  let c = nodeCache.get(m);
  if (!c) nodeCache.set(m, (c = nodeMaterial(m)));
  return c;
}

/** The terrain's material settings (vertex colours by slope, slice.ts). */
export const TERRAIN_PARAMS = {
  vertexColors: true,
  roughness: 1,
  metalness: 0,
};
