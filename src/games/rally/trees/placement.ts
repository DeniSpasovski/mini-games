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
 * Size ladder of a scattered stand (`ladder`): real woods mix ages, so a share of the trees are young (a fraction of the
 * species' size) and a few are veterans, the rest the species' own range. [share, scale from, scale to].
 */
const YOUNG: [number, number, number] = [0.16, 0.38, 0.62];
const VETERAN: [number, number, number] = [0.1, 1.12, 1.3];

/**
 * Pose of the `index`-th tree placed on stage `stageId`, a tree type from the map data. `mapScale` is the scale the
 * map gave it (its scatter rule's range, a hand-placed sapling, a street tree sized by its trunk): it multiplies the
 * species' own size range. `ladder`: a scattered tree, sized on the stand's age ladder (YOUNG / VETERAN); trees the map
 * sizes itself (measured heights, hand-placed) keep their size.
 */
export function placeTree(
  stageId: string,
  index: number,
  asset: string,
  mapScale = 1,
  ladder = false,
): PlacedTree {
  const def = speciesOfType(asset);
  const h = mix32(hashText(stageId), index);
  const u = (k: number) => unit(mix32(h, k));
  const age = u(7);
  const rung = !ladder
    ? 1
    : age < YOUNG[0]
      ? YOUNG[1] + (YOUNG[2] - YOUNG[1]) * u(8)
      : age > 1 - VETERAN[0]
        ? VETERAN[1] + (VETERAN[2] - VETERAN[1]) * u(8)
        : 1;
  return {
    variant: Math.min(
      variantCount(def) - 1,
      Math.floor(u(1) * variantCount(def)),
    ),
    rotY: u(2) * Math.PI * 2,
    scale:
      (def.scale[0] + (def.scale[1] - def.scale[0]) * u(3)) * mapScale * rung,
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

/** The leafless / dead tree a scattered tree type turns into inside a dead patch (`bareTwin`). */
export const BARE_TWINS: Readonly<Record<string, string>> = {
  oak_tree: 'bare_oak',
  hornbeam_tree: 'bare_oak',
  walnut_tree: 'bare_oak',
  locust_tree: 'bare_locust',
  black_pine: 'dead_pine',
  tall_black_pine: 'dead_pine',
  pine_tree: 'dead_pine',
  plantation_pine: 'dead_pine',
};
/** Dead patches: one in DEAD_PATCH.share of the DEAD_PATCH.cell m cells, `radius` m round its centre, `dead` of its trees bare. */
const DEAD_PATCH = { cell: 90, share: 0.05, radius: 9, dead: 0.55 };

/**
 * A scattered tree's type, or its bare twin where it stands in a dead patch (a lightning strike, a beetle or drought
 * spot): a handful of dead trees together, rare, the same on every load (hash of the stage id and the cell).
 */
export function bareTwin(
  stageId: string,
  asset: string,
  x: number,
  z: number,
  index: number,
): string {
  const twin = BARE_TWINS[asset];
  if (!twin) return asset;
  const { cell, share, radius, dead } = DEAD_PATCH;
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  const h = mix32(mix32(hashText(stageId), cx * 73856093), cz * 19349663);
  if (unit(mix32(h, 1)) >= share) return asset;
  const px = (cx + 0.2 + 0.6 * unit(mix32(h, 2))) * cell;
  const pz = (cz + 0.2 + 0.6 * unit(mix32(h, 3))) * cell;
  if (Math.hypot(x - px, z - pz) > radius) return asset;
  return unit(mix32(index, 0xdead)) < dead ? twin : asset;
}
