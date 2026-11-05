import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three';
import type { AssetBuilder } from '../types';
import { TREE_PACKS } from './tree-packs.data';
import pineBark from './tree-packs/pine-bark.webp';
import pineBarkN from './tree-packs/pine-bark-n.webp';
import pineLeaf from './tree-packs/pine-leaf.webp';
import pineLeafN from './tree-packs/pine-leaf-n.webp';
import lilacBark from './tree-packs/lilac-bark.webp';
import lilacBarkN from './tree-packs/lilac-bark-n.webp';
import lilacLeaf from './tree-packs/lilac-leaf.webp';
import lilacLeafN from './tree-packs/lilac-leaf-n.webp';
import bushBark from './tree-packs/bush-bark.webp';
import bushBarkN from './tree-packs/bush-bark-n.webp';
import bushLeaf from './tree-packs/bush-leaf.webp';
import bushLeafN from './tree-packs/bush-leaf-n.webp';
import pineBoard0 from './tree-packs/pine-board-0.webp';
import pineBoard1 from './tree-packs/pine-board-1.webp';
import pineBoard2 from './tree-packs/pine-board-2.webp';

/**
 * Hero trees and shrubs from three CC BY 4.0 packs by LOLIPOP (credits: THIRD-PARTY.md): Scots pines (13-31 m, a bare
 * trunk under a few needle clumps), lilac and bush shrubs. The models' own triangles, uvs and textures, three levels of
 * detail each (the pines a fourth: the pack's own far billboard), baked by `scripts/trees/bake-tree-packs.py` into
 * `tree-packs.data.ts`. They stand near the road (Vodno's trail stand, the near wood band, the understorey); the forest
 * beyond is the generated trees.
 */
export type PackKind = 'pine' | 'lilac' | 'bush';

const TEXTURES: Record<PackKind, [string, string, string, string]> = {
  pine: [pineBark, pineBarkN, pineLeaf, pineLeafN],
  lilac: [lilacBark, lilacBarkN, lilacLeaf, lilacLeafN],
  bush: [bushBark, bushBarkN, bushLeaf, bushLeafN],
};

/** Wind sway per m² of height (engine/world-shading.ts RALLY_WIND): the 30 m pine nods a little, the 1 m bush rustles. */
const WIND: Record<PackKind, number> = {
  pine: 0.0003,
  lilac: 0.0016,
  bush: 0.012,
};
/**
 * Colour over the pack's own textures (bark, leaf): Vodno's pines have dark grey-brown trunks and dark needles, the
 * pack's are a light orange plate bark and yellow-green tufts.
 */
const COLOUR: Record<PackKind, [number, number]> = {
  pine: [0x8a8580, 0x8aa595],
  lilac: [0xffffff, 0xffffff],
  bush: [0xffffff, 0xffffff],
};
/** Light through the leaves against the sun (RALLY_FOLIAGE). */
const THROUGH: Record<PackKind, number> = { pine: 0.25, lilac: 0.4, bush: 0.4 };

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
function load(url: string, colour: boolean, repeat: boolean): Texture | null {
  if (!loader) return null;
  const t = loader.load(url);
  // glTF uv: origin top left.
  t.flipY = false;
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter;
  if (colour) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

const materials = new Map<string, MeshStandardMaterial>();

/** The far billboards' textures, per pine variant. */
const BOARDS = [pineBoard0, pineBoard1, pineBoard2];

/** The far billboard of a pine variant: its own texture, alpha-tested, lit both sides, no wind (too far to see). */
function boardMaterial(variant: number): MeshStandardMaterial {
  const key = `pine:board:${variant}`;
  let m = materials.get(key);
  if (m) return m;
  m = new MeshStandardMaterial({
    color: COLOUR.pine[1],
    map: load(BOARDS[variant % BOARDS.length], true, false),
    roughness: 0.9,
    side: DoubleSide,
    alphaTest: 0.5,
  });
  m.name = `pine board ${variant}`;
  m.defines = { RALLY_FOLIAGE: THROUGH.pine };
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
  const [bark, barkN, leaf, leafN] = TEXTURES[kind];
  const isBark = part === 'bark';
  m = new MeshStandardMaterial({
    color: COLOUR[kind][isBark ? 0 : 1],
    map: load(isBark ? bark : leaf, true, isBark),
    normalMap: load(isBark ? barkN : leafN, false, isBark),
    roughness: isBark ? 0.95 : 0.85,
    side: DoubleSide,
    alphaTest: isBark ? 0 : 0.5,
  });
  m.name = `${kind} ${part}`;
  m.defines = {
    RALLY_WIND: WIND[kind],
    ...(isBark ? {} : { RALLY_FOLIAGE: THROUGH[kind] }),
  };
  materials.set(key, m);
  return m;
}

/** Variants a pack has (its models; the asset's `variants`). */
export const PACK_VARIANTS: Record<PackKind, number> = {
  pine: TREE_PACKS.pine.length,
  lilac: TREE_PACKS.lilac.length,
  bush: TREE_PACKS.bush.length,
};

/** Height (m) of a model at scale 1 (colliders, placement). */
export function packHeight(kind: PackKind, variant: number): number {
  const models = TREE_PACKS[kind];
  return models[variant % models.length].height;
}

function pack(kind: PackKind): AssetBuilder {
  return ({ variant, lod }) => {
    const models = TREE_PACKS[kind];
    const m = models[variant % models.length];
    if (lod >= m.lods.length && m.board)
      return {
        parts: [
          {
            geometry: decode(m.board),
            material: boardMaterial(variant % models.length),
          },
        ],
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
