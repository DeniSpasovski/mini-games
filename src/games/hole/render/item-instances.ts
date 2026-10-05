import {
  BatchedMesh,
  Box3,
  Color,
  Frustum,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Camera,
  type DataTexture,
  type Material,
  type Object3D,
} from 'three';
import { buildItemGeometry } from '../items/builders';
import type { ItemStyle } from '../items/catalog';
import { getItemMaterials } from './materials';
import { FallState, fallPose } from '../sim/fall';
import { TEETER_MAX } from '../sim/eat';
import type { World } from '../sim/world';

const UP = new Vector3(0, 1, 0);
/** Items are culled in square cells of this size (m): one frustum test per cell, not per item. */
const CELL = 64;
/** Maps with moving items (denser, heavier animals) use smaller cells: finer culling, cell bounds follow the animals. */
const CELL_MOVERS = 32;
/** Added to a cell's bounding radius (m): items slide towards the hole while falling and tall ones tilt. */
const BOUNDS_MARGIN = 14;
/** Items smaller than `camera distance x` this are skipped (about 2 px at the game camera). */
export const TINY_K = 0.003;
/** Items smaller than `camera distance x` this cast no shadow (their shadow is a texel or two). */
export const SHADOW_TINY_K = 0.008;
/** Items at least this big (m) cast a shadow at all. */
const SHADOW_MIN_SIZE = 0.5;

/** BatchedMesh internals the cell culling writes to (three r186, `objects/BatchedMesh.js`). */
interface BatchedInternals {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _multiDrawBytesPerElement: number;
  _indirectTexture: DataTexture;
  _visibilityChanged: boolean;
  _geometryInfo: { start: number; count: number }[];
}

const _frustum = new Frustum();
const _m = new Matrix4();
const _cam = new Vector3();
const _fwd = new Vector3();

/**
 * Every item of one material that shares the shadow flag, in ONE BatchedMesh:
 * one multi-draw call per pass instead of one draw per item type and cell.
 * Instances are added cell by cell, so a cell is a contiguous id range; the
 * stock per-instance culling (a matrix read + sphere test per item, twice a
 * frame) is replaced by a frustum test per cell (front-to-back cell order),
 * a sphere test per item only in cells that cross the frustum edge (spheres
 * kept in flat arrays, no matrix reads) and a size cut for tiny items far
 * from the camera.
 */
class ItemBatch extends BatchedMesh {
  /** World item of each instance id. */
  readonly items: Int32Array;
  private size: Float32Array;
  private drawStart: Int32Array;
  private drawCount: Int32Array;
  /** Instance is drawn at all (not eaten, passes the viewer filter). */
  readonly shown: Uint8Array;
  /** Cell c owns instance ids [cellStart[c], cellStart[c + 1]). */
  readonly cellStart: Int32Array;
  /** Cell bounding spheres (x, y, z, r), local space. */
  readonly cellSphere: Float32Array;
  /** Item bounding spheres (x, y, z, r) per instance id, local space (kept current for moving items). */
  readonly itemSphere: Float32Array;
  private cellOrder: Int32Array;
  private cellDepth: Float32Array;
  private cellInside: Uint8Array;
  /** Skip items smaller than this (m) in the camera / shadow pass. */
  minSize = 0;
  shadowMinSize = 0;

  constructor(
    instances: number,
    vertices: number,
    material: Material,
    cells: number,
  ) {
    super(instances, vertices, 0, material);
    this.items = new Int32Array(instances);
    this.size = new Float32Array(instances);
    this.drawStart = new Int32Array(instances);
    this.drawCount = new Int32Array(instances);
    this.shown = new Uint8Array(instances).fill(1);
    this.cellStart = new Int32Array(cells + 1);
    this.cellSphere = new Float32Array(cells * 4);
    this.itemSphere = new Float32Array(instances * 4);
    this.cellOrder = new Int32Array(cells);
    this.cellDepth = new Float32Array(cells);
    this.cellInside = new Uint8Array(cells);
    // culling is done here per cell, the object itself is never culled
    this.frustumCulled = false;
    this.perObjectFrustumCulled = false;
    this.sortObjects = false;
  }

  /** Add one instance; `start` / `count` = the vertex range of its geometry in the batch. */
  addItem(
    geometryId: number,
    item: number,
    size: number,
    start: number,
    count: number,
  ): number {
    const id = this.addInstance(geometryId);
    this.items[id] = item;
    this.size[id] = size;
    this.drawStart[id] = start;
    this.drawCount[id] = count;
    return id;
  }

  show(id: number, on: boolean): void {
    if (this.shown[id] === +on) return;
    this.shown[id] = +on;
    this.setVisibleAt(id, on); // keeps raycasts (map viewer picking) right
  }

  onBeforeRender(
    _renderer: unknown,
    _scene: unknown,
    camera: Camera,
    geometry: BufferGeometry,
  ): void {
    this.cull(camera, false, geometry);
  }

  onBeforeShadow(
    _renderer: unknown,
    _object: unknown,
    _camera: unknown,
    shadowCamera: Camera,
    geometry: BufferGeometry,
  ): void {
    this.cull(shadowCamera, true, geometry);
  }

  private cull(
    camera: Camera,
    shadow: boolean,
    geometry: BufferGeometry,
  ): void {
    const self = this as unknown as BatchedInternals;
    _m.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ).multiply(this.matrixWorld);
    _frustum.setFromProjectionMatrix(
      _m,
      camera.coordinateSystem,
      (camera as { reversedDepth?: boolean }).reversedDepth,
    );
    const pl = _planes;
    _frustum.planes.forEach((p, k) => {
      pl[k * 4] = p.normal.x;
      pl[k * 4 + 1] = p.normal.y;
      pl[k * 4 + 2] = p.normal.z;
      pl[k * 4 + 3] = p.constant;
    });
    // camera position and view direction in the local frame (front-to-back cell order)
    _m.copy(this.matrixWorld).invert();
    _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_m);
    _fwd
      .set(0, 0, -1)
      .transformDirection(camera.matrixWorld)
      .transformDirection(_m);

    // 1) cells: frustum test, front-to-back order, "fully inside" skips the per-item test
    const sph = this.cellSphere;
    const order = this.cellOrder;
    const depth = this.cellDepth;
    const inside = this.cellInside;
    const cells = order.length;
    let visible = 0;
    for (let c = 0; c < cells; c++) {
      if (this.cellStart[c] === this.cellStart[c + 1]) continue;
      const k = c * 4;
      const t = sphereTest(pl, sph[k], sph[k + 1], sph[k + 2], sph[k + 3]);
      if (t === OUT) continue;
      // insertion sort by view depth: few visible cells, mostly sorted already
      const d =
        (sph[k] - _cam.x) * _fwd.x +
        (sph[k + 1] - _cam.y) * _fwd.y +
        (sph[k + 2] - _cam.z) * _fwd.z;
      let j = visible++;
      while (j > 0 && depth[j - 1] > d) {
        depth[j] = depth[j - 1];
        order[j] = order[j - 1];
        inside[j] = inside[j - 1];
        j--;
      }
      depth[j] = d;
      order[j] = c;
      inside[j] = t === IN ? 1 : 0;
    }

    // 2) items of the visible cells -> multi-draw list
    const starts = self._multiDrawStarts;
    const counts = self._multiDrawCounts;
    const indirect = self._indirectTexture.image.data as unknown as Uint32Array;
    const minSize = shadow ? this.shadowMinSize : this.minSize;
    const shown = this.shown;
    const size = this.size;
    const is = this.itemSphere;
    let n = 0;
    for (let v = 0; v < visible; v++) {
      const c = order[v];
      const all = inside[v] === 1;
      for (
        let id = this.cellStart[c], e = this.cellStart[c + 1];
        id < e;
        id++
      ) {
        if (!shown[id] || size[id] < minSize) continue;
        const k = id * 4;
        if (
          !all &&
          sphereTest(pl, is[k], is[k + 1], is[k + 2], is[k + 3]) === OUT
        )
          continue;
        starts[n] = this.drawStart[id];
        counts[n] = this.drawCount[id];
        indirect[n] = id;
        n++;
      }
    }
    self._indirectTexture.needsUpdate = true;
    self._multiDrawCount = n;
    self._multiDrawBytesPerElement =
      geometry.getIndex()?.array.BYTES_PER_ELEMENT ?? 1;
    self._visibilityChanged = false;
  }
}

const OUT = 0;
const CROSS = 1;
const IN = 2;
/** Frustum planes as flat (nx, ny, nz, d) x 6. */
const _planes = new Float32Array(24);

/** Sphere vs the 6 frustum planes: OUT, CROSS (touches an edge) or IN (fully inside). */
function sphereTest(
  pl: Float32Array,
  x: number,
  y: number,
  z: number,
  r: number,
): number {
  let res = IN;
  for (let k = 0; k < 24; k += 4) {
    const d = pl[k] * x + pl[k + 1] * y + pl[k + 2] * z + pl[k + 3];
    if (d < -r) return OUT;
    if (d < r) res = CROSS;
  }
  return res;
}

/**
 * Draws every item of a world: a few BatchedMeshes (one per material style,
 * split into shadow casters and non-casters), culled per 64 m map cell.
 * Instance matrices are written once; afterwards only teetering / tipping /
 * falling / walking items are updated.
 */
export class ItemInstances {
  readonly group = new Group();
  private batches: ItemBatch[] = [];
  /** Per world item: its batch and instance id. */
  private batchOf: Uint8Array;
  private idOf: Uint32Array;
  /** Per world item: its cell (within its batch) and the item's bounding radius / centre height. */
  private cellOf: Int32Array;
  private radius: Float32Array;
  private centerY: Float32Array;
  private moverCells: Set<number>[] = [];
  private dirtyCells = new Set<number>();
  private keep: ((item: number) => boolean) | null = null;
  private m = new Matrix4();
  private q = new Quaternion();
  private qt = new Quaternion();
  private p = new Vector3();
  private axis = new Vector3();
  private scale = new Vector3(1, 1, 1);
  /** Tilt of the last `poseMatrix` call. */
  private tilt = 0;

  /** `mats` defaults to the shared item materials (tests pass plain ones: the real ones need a canvas). */
  constructor(
    private world: World,
    mats: Record<ItemStyle, Material> = getItemMaterials(),
  ) {
    const n = world.n;
    this.batchOf = new Uint8Array(n);
    this.idOf = new Uint32Array(n);
    this.cellOf = new Int32Array(n);
    this.radius = new Float32Array(n);
    this.centerY = new Float32Array(n);
    const cellSize = world.movers.length ? CELL_MOVERS : CELL;

    // group items: batch (style + shadow) -> cell (+ mover flag) -> items
    const batchKeys = new Map<string, Map<string, number[]>>();
    for (let i = 0; i < n; i++) {
      const info = world.types[world.type[i]];
      const bk = `${info.style}#${info.size >= SHADOW_MIN_SIZE ? 1 : 0}`;
      const ck = `${Math.floor(world.x[i] / cellSize)}#${Math.floor(world.z[i] / cellSize)}#${world.isMover[i]}`;
      let cells = batchKeys.get(bk);
      if (!cells) batchKeys.set(bk, (cells = new Map()));
      const list = cells.get(ck);
      if (list) list.push(i);
      else cells.set(ck, [i]);
    }

    const tint = new Color();
    const box = new Box3();
    for (const [bk, cells] of batchKeys) {
      const [style, caster] = bk.split('#');
      // unique geometries of this batch
      const geos = new Map<string, BufferGeometry>();
      let count = 0;
      for (const list of cells.values())
        for (const i of list) {
          const info = world.types[world.type[i]];
          const gk = `${info.id}#${world.variant[i] % info.variants}`;
          if (!geos.has(gk))
            geos.set(
              gk,
              buildItemGeometry(info.id, world.variant[i] % info.variants),
            );
          count++;
        }
      let vertices = 0;
      for (const g of geos.values())
        vertices += g.getAttribute('position').count;
      const batch = new ItemBatch(
        count,
        vertices,
        mats[style as ItemStyle],
        cells.size,
      );
      batch.name = `items ${style}${caster === '1' ? ' shadow' : ''}`;
      batch.castShadow = caster === '1';
      batch.receiveShadow = false;
      const geoIds = new Map<
        string,
        { id: number; start: number; count: number; r: number; cy: number }
      >();
      for (const [gk, g] of geos) {
        const id = batch.addGeometry(g);
        // the draw range the stock culling would use for this geometry
        const range = (batch as unknown as BatchedInternals)._geometryInfo[id];
        if (!g.boundingBox) g.computeBoundingBox();
        box.copy(g.boundingBox!);
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        geoIds.set(gk, {
          id,
          start: range.start,
          count: range.count,
          // horizontal offset of the box centre folded into the radius: the sphere is placed at the item origin
          r: box.max.distanceTo(box.min) / 2 + Math.hypot(cx, cz),
          cy: (box.min.y + box.max.y) / 2,
        });
      }

      const bi = this.batches.length;
      const movers = new Set<number>();
      let cell = 0;
      for (const list of cells.values()) {
        batch.cellStart[cell] = batch.instanceCount;
        for (const i of list) {
          const info = world.types[world.type[i]];
          const g = geoIds.get(
            `${info.id}#${world.variant[i] % info.variants}`,
          )!;
          const id = batch.addItem(g.id, i, info.size, g.start, g.count);
          this.batchOf[i] = bi;
          this.idOf[i] = id;
          this.cellOf[i] = cell;
          this.radius[i] = g.r;
          this.centerY[i] = g.cy;
          this.poseMatrix(i, this.m);
          batch.setMatrixAt(id, this.m);
          this.placeSphere(batch, id, i);
          if (info.paints?.length && world.paint[i] >= 0) {
            tint.setHex(info.paints[world.paint[i] % info.paints.length]);
            batch.setColorAt(id, tint);
          }
          if (world.state[i] === FallState.Gone) batch.show(id, false);
        }
        if (world.isMover[list[0]]) movers.add(cell);
        cell++;
      }
      batch.cellStart[cell] = batch.instanceCount;
      for (let c = 0; c < cell; c++) this.fitCell(batch, c);
      this.batches.push(batch);
      this.moverCells.push(movers);
      this.group.add(batch);
    }
  }

  /** World index of an instance (for picking: `batchId` of a raycast hit on one of the group's meshes). */
  itemOf(mesh: Object3D, batchId: number): number {
    return (mesh as ItemBatch).items[batchId];
  }

  /** Show only items that pass `keep` (viewers: tier filter); `null` shows everything again. */
  filter(keep: ((itemIndex: number) => boolean) | null): void {
    this.keep = keep;
    for (let i = 0; i < this.world.n; i++) this.applyShown(i);
  }

  /**
   * Level of detail for the camera distance (m) of the game rig: tiny items far away are not drawn and small ones
   * cast no shadow. Viewers do not call this (everything is drawn).
   */
  setView(distance: number): void {
    for (const b of this.batches) {
      b.minSize = distance * TINY_K;
      b.shadowMinSize = distance * SHADOW_TINY_K;
    }
  }

  /** Update the instances of every active (moving) item and hide the ones that fell in. */
  update(): void {
    const w = this.world;
    for (const i of w.active) this.write(i);
    if (w.moving.size) {
      for (const i of w.moving) this.write(i);
      w.moving.clear();
    }
    if (w.gone.length) {
      for (const i of w.gone) this.write(i);
      w.gone.length = 0;
    }
    // cells with an awake animal follow it (asleep movers stand still, so this is cheap)
    for (const key of this.dirtyCells) {
      const b = key >>> 20;
      this.fitCell(this.batches[b], key & 0xfffff);
    }
    this.dirtyCells.clear();
  }

  /** Re-write one item (used by viewers that edit the world). */
  write(i: number): void {
    const b = this.batchOf[i];
    const batch = this.batches[b];
    const id = this.idOf[i];
    this.applyShown(i);
    if (batch.shown[id]) {
      this.poseMatrix(i, this.m);
      batch.setMatrixAt(id, this.m);
      this.placeSphere(batch, id, i);
    }
    if (this.world.isMover[i] && this.moverCells[b].has(this.cellOf[i]))
      this.dirtyCells.add((b << 20) | this.cellOf[i]);
  }

  /** Make every item visible and upright again. */
  resetAll(): void {
    const w = this.world;
    for (let i = 0; i < w.n; i++) this.write(i);
    this.update();
  }

  /** Free the GPU buffers (geometry copies, matrix / colour textures) of every batch. */
  dispose(): void {
    for (const b of this.batches) b.dispose();
  }

  private applyShown(i: number): void {
    const on =
      this.world.state[i] !== FallState.Gone && (!this.keep || this.keep(i));
    this.batches[this.batchOf[i]].show(this.idOf[i], on);
  }

  /** Item sphere at the pose `poseMatrix` just computed (a tilted item's centre swings around its base). */
  private placeSphere(batch: ItemBatch, id: number, i: number): void {
    const k = id * 4;
    const cy = this.centerY[i];
    batch.itemSphere[k] = this.p.x;
    batch.itemSphere[k + 1] = this.p.y + cy;
    batch.itemSphere[k + 2] = this.p.z;
    batch.itemSphere[k + 3] =
      this.radius[i] +
      (this.tilt !== 0 ? Math.abs(cy * Math.sin(this.tilt)) * 2 : 0);
  }

  /** Bounding sphere of one cell from its items' positions (+ margin for falling / tilting). */
  private fitCell(batch: ItemBatch, c: number): void {
    const w = this.world;
    const s = batch.cellStart[c];
    const e = batch.cellStart[c + 1];
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity;
    let x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;
    for (let id = s; id < e; id++) {
      const i = batch.items[id];
      const r = this.radius[i];
      const y = w.lift[i] + this.centerY[i];
      x0 = Math.min(x0, w.x[i] - r);
      x1 = Math.max(x1, w.x[i] + r);
      y0 = Math.min(y0, y - r);
      y1 = Math.max(y1, y + r);
      z0 = Math.min(z0, w.z[i] - r);
      z1 = Math.max(z1, w.z[i] + r);
    }
    const k = c * 4;
    const sph = batch.cellSphere;
    sph[k] = (x0 + x1) / 2;
    sph[k + 1] = (y0 + y1) / 2;
    sph[k + 2] = (z0 + z1) / 2;
    sph[k + 3] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + BOUNDS_MARGIN;
  }

  private poseMatrix(i: number, out: Matrix4): void {
    const w = this.world;
    const state = w.state[i];
    let x = w.x[i];
    let z = w.z[i];
    let y = w.lift[i];
    let yaw = w.rot[i];
    let tilt = 0;
    const dir = w.dir[i];
    if (state === FallState.Idle) {
      tilt = w.teeter[i] * TEETER_MAX;
    } else {
      const f = w.fall[i];
      if (f) {
        const pose = fallPose(f, w.t[i]);
        const pull = w.pull[i] * pose.slide;
        x += Math.cos(dir) * pull;
        z += Math.sin(dir) * pull;
        y += pose.y;
        yaw += pose.yaw;
        tilt = pose.tilt;
      }
    }
    this.q.setFromAxisAngle(UP, yaw);
    if (tilt !== 0) {
      this.axis.set(Math.sin(dir), 0, -Math.cos(dir));
      this.qt.setFromAxisAngle(this.axis, tilt);
      this.q.premultiply(this.qt);
    }
    this.p.set(x, y, z);
    this.tilt = tilt;
    out.compose(this.p, this.q, this.scale);
  }
}
