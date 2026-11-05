import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  ImageLoader,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Texture,
} from 'three';
import { addWorldUniforms } from '../../engine/world-shading';
import type { Season } from '../../season';
import type { AssetBuilder } from '../types';
import {
  PACK_SEASON_TINT,
  PACK_SIZES,
  PACK_TEXTURES,
  TREE_PACKS,
  type LazyPackKind,
  type PackKind,
  type PackModel,
} from './tree-packs.data';

export type { PackKind } from './tree-packs.data';

/**
 * Hero trees and shrubs from seven CC BY 4.0 packs by LOLIPOP and two by Jagobo (credits: THIRD-PARTY.md): Scots pines
 * (13-31 m, a bare trunk under a few needle clumps), oaks (a 4 m sapling to a 26 m veteran), young firs (4-9 m), birches
 * (10 m), maples (5-23 m), elms (21-32 m), weeping willows (10-19 m), lilac and bush shrubs. The models' own triangles, uvs and textures, three levels of detail each and
 * (trees) a far billboard, baked by `scripts/trees/bake-tree-packs.py`. Pine, lilac and bush are in the main script; the
 * others are chunks of their own, fetched by `loadTreePacks` before a world builds them. They stand near the road; the
 * forest beyond is the generated trees. The leaves follow the world's season (`setPackSeason`).
 */

/** Wind sway per m² of height (engine/world-shading.ts RALLY_WIND): the 30 m pine nods a little, the 1 m bush rustles. */
const WIND: Record<PackKind, number> = {
  pine: 0.0003,
  lilac: 0.0016,
  bush: 0.012,
  oak: 0.0004,
  fir: 0.0012,
  birch: 0.003,
  maple: 0.0007,
  elm: 0.0005,
  willow: 0.0012,
};
/**
 * Colour over the pack's own textures (bark, leaf): Vodno's pines have dark grey-brown trunks and dark needles, the
 * pack's are a light orange plate bark and yellow-green tufts; the oak and maple leaves a little warmer, the birch's
 * bright green down to the generated birches' olive.
 */
const COLOUR: Record<PackKind, [number, number]> = {
  pine: [0x8a8580, 0x8aa595],
  lilac: [0xffffff, 0xffffff],
  bush: [0xffffff, 0xffffff],
  oak: [0xffffff, 0xf2ecd2],
  fir: [0xffffff, 0xffffff],
  birch: [0xffffff, 0xb4c8a8],
  maple: [0xffffff, 0xf0ead2],
  elm: [0xffffff, 0xffffff],
  willow: [0xffffff, 0xffffff],
};
/** Light through the leaves against the sun (RALLY_FOLIAGE). */
const THROUGH: Record<PackKind, number> = {
  pine: 0.25,
  lilac: 0.4,
  bush: 0.4,
  oak: 0.3,
  fir: 0.25,
  birch: 0.45,
  maple: 0.4,
  elm: 0.5,
  willow: 0.45,
};
/**
 * Leaf colour gain (rgb) in a season the kind has no texture for: spring's fresh, lighter flush; conifers keep their
 * needles (a little paler new growth in spring, duller in autumn).
 */
const SEASON_GAIN: Partial<
  Record<PackKind, Partial<Record<Season, [number, number, number]>>>
> = {
  pine: { spring: [1.03, 1.05, 1], autumn: [0.96, 0.96, 0.96] },
  fir: { spring: [1.06, 1.1, 1], autumn: [0.95, 0.95, 0.95] },
  bush: { spring: [1.1, 1.14, 0.85] },
  birch: { spring: [1.1, 1.15, 0.85] },
  maple: { spring: [1.12, 1.15, 0.9] },
  elm: { spring: [1.1, 1.14, 0.88] },
  willow: { spring: [1.12, 1.15, 0.85] },
};

/** The models of every kind loaded so far. */
const MODELS: Partial<Record<PackKind, PackModel[]>> = { ...TREE_PACKS };
const LOADERS: Record<LazyPackKind, () => Promise<PackModel[]>> = {
  oak: async () => (await import('./tree-packs/oak.data')).PACK_MODELS,
  fir: async () => (await import('./tree-packs/fir.data')).PACK_MODELS,
  birch: async () => (await import('./tree-packs/birch.data')).PACK_MODELS,
  maple: async () => (await import('./tree-packs/maple.data')).PACK_MODELS,
  elm: async () => (await import('./tree-packs/elm.data')).PACK_MODELS,
  willow: async () => (await import('./tree-packs/willow.data')).PACK_MODELS,
};
/** Kinds whose models are a chunk of their own. */
export const LAZY_PACK_KINDS = Object.keys(LOADERS) as LazyPackKind[];
const loading = new Map<LazyPackKind, Promise<void>>();

/**
 * Fetch the models of these kinds before anything builds them: a map's loader for the kinds it places, the asset
 * debugger for all (`LAZY_PACK_KINDS`). Pine, lilac and bush are always there.
 */
export async function loadTreePacks(...kinds: PackKind[]): Promise<void> {
  const lazy = kinds.filter((k): k is LazyPackKind => k in LOADERS);
  await Promise.all(
    lazy.map((k) => {
      let p = loading.get(k);
      if (!p) {
        p = LOADERS[k]().then((m) => {
          MODELS[k] = m;
        });
        loading.set(k, p);
      }
      return p;
    }),
  );
}

function models(kind: PackKind): PackModel[] {
  const m = MODELS[kind];
  if (!m) throw new Error(`Pack trees "${kind}": not loaded (loadTreePacks)`);
  return m;
}

/** The packed mesh (layout: scripts/trees/bake-tree-packs.py): position, normal and uv. */
function decode(packed: string): BufferGeometry {
  const bin = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
  const dv = new DataView(bin.buffer);
  const n = dv.getUint32(0, true);
  const f = (o: number) => dv.getFloat32(o, true);
  const lo = [f(4), f(8), f(12)];
  const size = [f(16), f(20), f(24)];
  const uvLo = [f(28), f(32)];
  const uvSize = [f(36), f(40)];
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++)
      pos[i * 3 + c] =
        lo[c] + (dv.getUint16(o + c * 2, true) / 65535) * size[c];
    o += 6;
    for (let c = 0; c < 3; c++) nor[i * 3 + c] = dv.getInt8(o + c) / 127;
    o += 4;
    uv[i * 2] = uvLo[0] + (dv.getUint16(o, true) / 65535) * uvSize[0];
    uv[i * 2 + 1] = uvLo[1] + (dv.getUint16(o + 2, true) / 65535) * uvSize[1];
    o += 4;
  }
  const count = dv.getUint32(o, true);
  o += 4;
  const idx = new Uint16Array(count);
  for (let k = 0; k < count; k++) idx[k] = dv.getUint16(o + k * 2, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const loader = typeof document === 'undefined' ? null : new TextureLoader();
const textures = new Map<string, Texture | null>();
/** glTF uv: origin top left. */
function setUp(t: Texture, colour: boolean, repeat: boolean): Texture {
  t.flipY = false;
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter;
  if (colour) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}
function load(url: string, colour: boolean, repeat: boolean): Texture | null {
  if (!textures.has(url))
    textures.set(url, loader ? setUp(loader.load(url), colour, repeat) : null);
  return textures.get(url)!;
}

/**
 * The season the leaves show (`setPackSeason`). The materials never change: the variant-set and level-fade copies of
 * them (engine/materials.ts) share their leaf texture object, whose picture is swapped, and their tint uniform.
 */
let season: Season = 'summer';
const leafMaps = new Map<PackKind, Texture>();
const tints = new Map<string, { value: Color }>();
const images = new Map<string, Promise<HTMLImageElement>>();
const imageLoader = typeof document === 'undefined' ? null : new ImageLoader();

/** The leaf texture of a kind: its picture follows the season (its own season texture, else the summer one). */
function leafMap(kind: PackKind): Texture | null {
  if (!imageLoader) return null;
  let t = leafMaps.get(kind);
  if (!t) {
    leafMaps.set(kind, (t = setUp(new Texture(), true, false)));
    showLeaf(kind);
  }
  return t;
}
function showLeaf(kind: PackKind): void {
  const t = leafMaps.get(kind);
  if (!t || !imageLoader) return;
  const url = leafUrl(kind);
  let p = images.get(url);
  if (!p) images.set(url, (p = imageLoader.loadAsync(url)));
  void p.then((img) => {
    // (the season changed again while it loaded)
    if (leafUrl(kind) !== url) return;
    t.image = img;
    t.needsUpdate = true;
  });
}
const leafUrl = (kind: PackKind) =>
  PACK_TEXTURES[kind].seasons?.[season as 'spring' | 'autumn'] ??
  PACK_TEXTURES[kind].leaf;

/**
 * The billboards are the crown's unlit colour on evenly lit cards: darker by this (linear) to meet the meshes, whose
 * leaves shade one another.
 */
const BOARD_SHADE = 0.55;

/**
 * Season gain (linear rgb) over a kind's leaves / billboards: none where the leaves wear the season's own texture; the
 * billboards (summer leaves) take its mean colour (`PACK_SEASON_TINT`) or the leaves' gain.
 */
function tint(kind: PackKind, part: 'leaf' | 'board'): { value: Color } {
  const key = `${kind}:${part}`;
  let u = tints.get(key);
  if (!u) tints.set(key, (u = { value: new Color() }));
  const own = PACK_TEXTURES[kind].seasons?.[season as 'spring' | 'autumn'];
  const gain =
    season === 'summer'
      ? undefined
      : part === 'leaf'
        ? own
          ? undefined
          : SEASON_GAIN[kind]?.[season]
        : (PACK_SEASON_TINT[kind]?.[season] ?? SEASON_GAIN[kind]?.[season]);
  const g = gain ?? [1, 1, 1];
  // sRGB gain -> linear
  u.value.setRGB(g[0] ** 2.2, g[1] ** 2.2, g[2] ** 2.2);
  if (part === 'board') u.value.multiplyScalar(BOARD_SHADE);
  return u;
}

/** The material's colour times its tint uniform (and the world uniforms every material gets). */
function tinted(m: MeshStandardMaterial, u: { value: Color }): void {
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.uniforms.packTint = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 packTint;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n\tdiffuseColor.rgb *= packTint;',
      )
      // No specular on the leaf cards: seen edge-on towards the sun, GGX's Fresnel turned whole clumps white.
      .replace(
        '#include <aomap_fragment>',
        'reflectedLight.directSpecular = vec3( 0.0 );\n\treflectedLight.indirectSpecular = vec3( 0.0 );\n#include <aomap_fragment>',
      );
  };
}

/**
 * The season the pack trees' leaves show (spring flush, summer, autumn colours; the pack's own season textures where it
 * has them): the world sets its map's season before it builds. Everything already built follows.
 */
export function setPackSeason(s: Season): void {
  if (s === season) return;
  season = s;
  for (const key of tints.keys()) {
    const [kind, part] = key.split(':') as [PackKind, 'leaf' | 'board'];
    tint(kind, part);
  }
  for (const kind of leafMaps.keys()) showLeaf(kind);
}

const materials = new Map<string, MeshStandardMaterial>();

/** The far billboards of a kind (one atlas): alpha-tested, each card seen from its own side, no wind (too far to see). */
function boardMaterial(kind: PackKind): MeshStandardMaterial {
  const key = `${kind}:board`;
  let m = materials.get(key);
  if (m) return m;
  m = new MeshStandardMaterial({
    color: COLOUR[kind][1],
    map: load(PACK_TEXTURES[kind].board!, true, false),
    roughness: 0.9,
    side: FrontSide,
    alphaTest: 0.5,
  });
  m.name = `${kind} board`;
  m.defines = { RALLY_FOLIAGE: THROUGH[kind] };
  tinted(m, tint(kind, 'board'));
  materials.set(key, m);
  return m;
}

/** The bark or leaf material of a pack: its own textures (leaf cards alpha-tested, lit through the leaves against the sun). */
export function packMaterial(
  kind: PackKind,
  part: 'bark' | 'leaf',
): MeshStandardMaterial {
  const key = `${kind}:${part}`;
  let m = materials.get(key);
  if (m) return m;
  const t = PACK_TEXTURES[kind];
  const isBark = part === 'bark';
  m = new MeshStandardMaterial({
    color: COLOUR[kind][isBark ? 0 : 1],
    map: isBark ? load(t.bark, true, true) : leafMap(kind),
    normalMap: load(isBark ? t.barkN : t.leafN, false, isBark),
    roughness: isBark ? 0.95 : 0.85,
    side: DoubleSide,
    alphaTest: isBark ? 0 : 0.5,
  });
  m.name = `${kind} ${part}`;
  m.defines = {
    RALLY_WIND: WIND[kind],
    ...(isBark ? {} : { RALLY_FOLIAGE: THROUGH[kind] }),
  };
  if (!isBark) tinted(m, tint(kind, 'leaf'));
  materials.set(key, m);
  return m;
}

/** Variants a pack has (its models; the asset's `variants`). */
export const PACK_VARIANTS = Object.fromEntries(
  Object.entries(PACK_SIZES).map(([k, v]) => [k, v.length]),
) as Record<PackKind, number>;

/** Height (m) of a model at scale 1 (colliders, placement). */
export function packHeight(kind: PackKind, variant: number): number {
  const sizes = PACK_SIZES[kind];
  return sizes[variant % sizes.length].height;
}

function pack(kind: PackKind): AssetBuilder {
  return ({ variant, lod }) => {
    const all = models(kind);
    const m = all[variant % all.length];
    if (lod >= m.lods.length && m.board)
      return {
        parts: [{ geometry: decode(m.board), material: boardMaterial(kind) }],
      };
    const level = m.lods[Math.min(lod, m.lods.length - 1)];
    return {
      parts: [
        { geometry: decode(level.bark), material: packMaterial(kind, 'bark') },
        { geometry: decode(level.leaf), material: packMaterial(kind, 'leaf') },
      ],
    };
  };
}

export const packPine = pack('pine');
export const packLilac = pack('lilac');
export const packBush = pack('bush');
export const packOak = pack('oak');
export const packFir = pack('fir');
export const packBirch = pack('birch');
export const packMaple = pack('maple');
export const packElm = pack('elm');
export const packWillow = pack('willow');
