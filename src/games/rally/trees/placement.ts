import type { StaticCollider } from '../physics/types';
import { hashText, mix32, unit, type V3 } from './math';
import { isTreeType, speciesOfType, variantCount } from './species';
import { variantInfo } from './variants';

/**
 * Stage 5, placement (spec: trees/Placement.md): trees stand where the stage data puts its tree types (scatter /
 * roadside / props rules); each placed tree is posed by a hash of the stage id and its placement index, so a stage
 * always grows the same forest. Pure (world / physics side, runs in node).
 */

/** What a placed tree takes from its hash, besides variant / rotation / scale. */
export interface TreePose {
  species: string;
  /** Hue shift (fraction of a turn) and value multiplier within the species palette. */
  hue: number;
  value: number;
  /** Wind phase offset of the whole tree (rad). */
  phase: number;
}

export interface PlacedTree {
  variant: number;
  rotY: number;
  scale: number;
  pose: TreePose;
}

/**
 * Pose of the `index`-th tree placed on stage `stageId`, a tree type from the map data. `mapScale` is the scale the
 * map gave it (its scatter rule's range, a hand-placed sapling, a street tree sized by its trunk): it multiplies the
 * species' own size range.
 */
export function placeTree(
  stageId: string,
  index: number,
  asset: string,
  mapScale = 1,
): PlacedTree {
  const def = speciesOfType(asset);
  const h = mix32(hashText(stageId), index);
  const u = (k: number) => unit(mix32(h, k));
  return {
    variant: Math.min(
      variantCount(def) - 1,
      Math.floor(u(1) * variantCount(def)),
    ),
    rotY: u(2) * Math.PI * 2,
    scale: (def.scale[0] + (def.scale[1] - def.scale[0]) * u(3)) * mapScale,
    pose: {
      species: def.name,
      hue: (u(4) - 0.5) * 0.06,
      value: 0.86 + 0.26 * u(5),
      phase: u(6) * Math.PI * 2,
    },
  };
}

interface Placed {
  asset: string;
  variant: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
}

/** World-space collision capsules of a placed tree (the same whichever level is drawn). */
export function treeColliders(inst: Placed): StaticCollider[] {
  const def = speciesOfType(inst.asset);
  const caps = variantInfo(def.name, inst.variant).capsules;
  const c = Math.cos(inst.rotY);
  const s = Math.sin(inst.rotY);
  const k = inst.scale;
  const out: StaticCollider[] = [];
  const at = (i: number): V3 => {
    const x = caps[i] * k;
    const z = caps[i + 2] * k;
    return [
      inst.x + x * c + z * s,
      inst.y + caps[i + 1] * k,
      inst.z - x * s + z * c,
    ];
  };
  for (let i = 0; i < caps.length; i += 7) {
    const a = at(i);
    const b = at(i + 3);
    const rc = caps[i + 6] * k;
    out.push({
      kind: 'capsule',
      x: (a[0] + b[0]) / 2,
      z: (a[2] + b[2]) / 2,
      y: Math.min(a[1], b[1]) - rc,
      h: Math.abs(b[1] - a[1]) + rc * 2,
      r: Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2) / 2 + rc,
      a,
      b,
      rc,
    });
  }
  return out;
}

/** A tree type's crown seen from above at scale 1 (aerial previews, baked canopy shadows): variant 0's crown. */
export function treeCanopy(asset: string): {
  radius: number;
  /** Crown centre height and vertical radius. */
  height: number;
  ry: number;
  color: V3;
} {
  const info = variantInfo(speciesOfType(asset).name, 0);
  const f = info.foliageColor;
  return {
    radius: info.crown.r[0] * 0.85,
    height: info.crown.c[1],
    ry: info.crown.r[1],
    color: [f[0] * 0.75, f[1] * 0.75, f[2] * 0.75],
  };
}

export { isTreeType };
