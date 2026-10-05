import {
  CircleGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
} from 'three';
import { getAssetMeta } from '../assets/catalog';
import { getAsset } from '../assets/library';
import { hash3 } from '../../../shared/rng';
import type { World } from './world';

/**
 * Vegetation for aerial previews (menu stage select) as flat green circles at
 * canopy height: ONE InstancedMesh for every tree / bush on the map (no LODs,
 * no range limit). Size and colour come from each asset's own canopy.
 *
 * Built by a time-sliced job (`job()`, yields per scatter chunk); the mesh
 * appears when the whole map is collected.
 */
interface Canopy {
  /** Disc radius and height above the instance origin at scale 1 (m). */
  radius: number;
  height: number;
  color: Color;
}

const canopies = new Map<string, Canopy>();
let disc: CircleGeometry | undefined;

/** Canopy of an asset, measured from its farthest LOD (variant 0). */
function canopyOf(id: string): Canopy {
  let c = canopies.get(id);
  if (c) return c;
  const meta = getAssetMeta(id);
  let maxY = 0;
  let r = 0;
  let n = 0;
  let y = 0;
  const color = new Color(0, 0, 0);
  const parts = getAsset(id, 0, meta.lods.length - 1).parts;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  }
  // Canopy = the upper part of the asset (skips trunks).
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    const col = p.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < maxY * 0.4) continue;
      r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
      y += pos.getY(i);
      n++;
      if (col) color.r += col.getX(i);
      if (col) color.g += col.getY(i);
      if (col) color.b += col.getZ(i);
    }
  }
  if (!n || color.r + color.g + color.b === 0) color.set(0x4d6a2a);
  else color.multiplyScalar(1 / n);
  // Darken a bit: the real crowns self-shade, a flat disc is lit like open ground.
  color.multiplyScalar(0.75);
  c = { radius: r * 0.85, height: n ? y / n : maxY, color };
  canopies.set(id, c);
  return c;
}

export class AerialTrees {
  readonly mesh: InstancedMesh;
  private material = new MeshStandardMaterial({ roughness: 1 });

  constructor(
    private world: World,
    /** Radius multiplier (thinned scatter: bigger circles keep the woods' coverage). */
    private grow = 1,
  ) {
    disc ??= new CircleGeometry(1, 10).rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(disc, this.material, 0);
    this.mesh.name = 'aerial trees';
    this.mesh.frustumCulled = false;
  }

  /** Collects every vegetation instance on the map; yields after each chunk. */
  *job(): Generator<void> {
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    const b = this.world.map.bounds;
    const mats: number[] = [];
    const cols: number[] = [];
    const tint = new Color();
    for (
      let cz = Math.floor((b.minZ - 300) / cs);
      cz * cs <= b.maxZ + 300;
      cz++
    ) {
      for (
        let cx = Math.floor((b.minX - 300) / cs);
        cx * cs <= b.maxX + 300;
        cx++
      ) {
        for (const inst of scatter.chunk(cx, cz).instances) {
          if (getAssetMeta(inst.asset).category !== 'vegetation') continue;
          const c = canopyOf(inst.asset);
          const r = c.radius * inst.scale * this.grow;
          // Column-major matrix: scale (r, 1, r), translate to canopy height.
          mats.push(r, 0, 0, 0, 0, 1, 0, 0, 0, 0, r, 0);
          mats.push(inst.x, inst.y + c.height * inst.scale, inst.z, 1);
          const j =
            0.88 +
            (hash3(Math.floor(inst.x * 7), Math.floor(inst.z * 7), 9) /
              4294967296) *
              0.24;
          tint.copy(c.color).multiplyScalar(j);
          cols.push(tint.r, tint.g, tint.b);
        }
        yield;
      }
    }
    // Fill the (empty until now) mesh in one go.
    this.mesh.instanceMatrix = new InstancedBufferAttribute(
      new Float32Array(mats),
      16,
    );
    this.mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(cols),
      3,
    );
    this.mesh.count = cols.length / 3;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
