import {
  BufferGeometry,
  PlaneGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { hash3, Rng } from '../../../shared/rng';
import { gridToWorldX, gridToWorldZ } from '../sim/grid';
import { Terrain, type MapData } from '../sim/types';
import { SLAB_PAD } from './camera-rig';
import { GlowGrid } from './fx/glow-grid';
import { PALETTE, clayMaterial, makeGrainTexture } from './materials';
import type { DataTexture } from 'three';
import { bowlGeometry, ringPoints, RIM_D, RIM_H } from './bowl';
import {
  boulderGeometry,
  decorGeometry,
  floorGeometry,
  moundGeometry,
  postGeometry,
  tileGeometry,
  woodCrateGeometry,
} from './parts';
import type { Quality } from './renderer';

const UP = new Vector3(0, 1, 0);
/** Sudden death: how long a wall takes to fall, and from how high. */
export const WALL_FALL_S = 0.35;
const WALL_DROP_H = 7;

/** An InstancedMesh whose instances can be removed one by one (swap with the last, shrink `count`). */
interface Removable {
  mesh: InstancedMesh;
  /** Cell index of each live instance. */
  cells: number[];
}

/**
 * Geometry and the grain texture are built once and shared by every Arena (a new round makes a new Arena: rebuilding the
 * merged models and the noise each time cost a visible hitch). They live for the page's lifetime, so Arena.dispose leaves
 * them alone.
 */
const sharedGeos = new Map<string, BufferGeometry>();
function shared(key: string, build: () => BufferGeometry): BufferGeometry {
  let g = sharedGeos.get(key);
  if (!g) sharedGeos.set(key, (g = build()));
  return g;
}
const sharedDecors = new Map<
  string,
  { body: BufferGeometry; bulbs: BufferGeometry }
>();
function sharedDecor(
  w: number,
  h: number,
): { body: BufferGeometry; bulbs: BufferGeometry } {
  const key = `${w}x${h}`;
  let d = sharedDecors.get(key);
  if (!d) sharedDecors.set(key, (d = decorGeometry(w, h, SLAB_PAD)));
  return d;
}
let sharedSun: DirectionalLight | null = null;
let sharedGrainTex: DataTexture | null = null;
function sharedGrain(): DataTexture {
  return (sharedGrainTex ??= makeGrainTexture());
}

/**
 * The Quarry diorama (DETAILS.md "Style"): a clay floor at the bottom of a rocky bowl, sandstone tiles, granite boulders and
 * timber-propped pillars, crates and dirt mounds, decor on the margin. Every kind is one InstancedMesh or
 * one merged mesh (about ten draw calls); the sun's shadow map is static and redrawn only when a crate breaks.
 */
export class Arena {
  readonly group = new Group();
  /** One sun for the page: a new round reuses it and its shadow map (allocating a 2048 x 2048 map is a visible hitch). */
  readonly sun = (sharedSun ??= new DirectionalLight(0xfff0d8, 2.5));
  private readonly crates: (Removable | null)[] = [null, null];
  private readonly hardMeshes: InstancedMesh[];
  /** Walls in the air (sudden death): mesh, instance slot, world x / z, landing time, yaw. */
  private readonly falling: {
    mesh: InstancedMesh;
    slot: number;
    x: number;
    z: number;
    land: number;
    yaw: number;
  }[] = [];
  private readonly warn: InstancedMesh;
  private readonly crateSlot: Int32Array;
  private readonly crateKind: Int8Array;
  private shadowDirty = true;
  private readonly materials: Material[] = [];
  private readonly grain = sharedGrain();

  constructor(
    readonly map: MapData,
    quality: Quality,
    glow: GlowGrid,
  ) {
    const { w, h } = map;
    const m4 = new Matrix4();
    const quat = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3();
    const tint = new Color();

    const mat = <T extends Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };
    const flat = mat(clayMaterial(this.grain, { vertexColors: true }));
    const lit = mat(
      clayMaterial(this.grain, { vertexColors: true, glow: glow.uniforms }),
    );
    const tileMat = mat(clayMaterial(this.grain, { glow: glow.uniforms }));

    // --- the floor plate and the rocky bowl round it (the crowd stands on its terraces: `Crowd`)
    const floor = new Mesh(
      shared(`floor${w}x${h}`, () => floorGeometry(w, h, SLAB_PAD)),
      flat,
    );
    floor.receiveShadow = true;
    this.group.add(floor);
    const rng = new Rng(hash3(map.seed, w, h, 0x51ab));
    const hx = w / 2 + SLAB_PAD;
    const hz = h / 2 + SLAB_PAD;
    this.group.add(
      new Mesh(
        shared(`bowl${w}x${h}`, () => bowlGeometry(hx, hz)),
        flat,
      ),
    );
    this.addRimRocks(hx, hz, rng, flat);

    // --- floor tiles
    const tiles = new InstancedMesh(
      shared('tile', tileGeometry),
      tileMat,
      w * h,
    );
    tiles.receiveShadow = true;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = new Rng(hash3(x, y, map.seed, 11));
        tint.set(PALETTE.tiles[Math.floor(r.next() * PALETTE.tiles.length)]);
        tint
          .multiplyScalar((x + y) & 1 ? 1 : 0.93)
          .multiplyScalar(r.range(0.95, 1.05));
        tiles.setColorAt(i, tint);
        m4.makeTranslation(
          gridToWorldX(w, x + 0.5),
          0,
          gridToWorldZ(h, y + 0.5),
        );
        tiles.setMatrixAt(i, m4);
      }
    }
    this.group.add(tiles);

    // --- hard blocks (two variants) and crates (two variants)
    const hardGeos = [
      shared('boulder', boulderGeometry),
      shared('post', postGeometry),
    ];
    const crateGeos = [
      shared('crate', woodCrateGeometry),
      shared('mound', moundGeometry),
    ];
    const hardCount = [0, 0];
    const crateCount = [0, 0];
    for (let i = 0; i < map.terrain.length; i++) {
      const v = map.variant[i] % 2;
      if (map.terrain[i] === Terrain.Hard) hardCount[v]++;
      else if (map.terrain[i] === Terrain.Crate) crateCount[v]++;
    }
    const hardMeshes: InstancedMesh[] = [];
    hardGeos.forEach((g, v) => {
      // room for the walls that fall during sudden death
      const mesh = new InstancedMesh(g, lit, Math.max(1, hardCount[v]) + w * h);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      hardMeshes.push(mesh);
    });
    this.hardMeshes = hardMeshes;
    this.crateSlot = new Int32Array(w * h).fill(-1);
    this.crateKind = new Int8Array(w * h).fill(-1);
    crateGeos.forEach((g, v) => {
      const mesh = new InstancedMesh(g, lit, Math.max(1, crateCount[v]));
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.crates[v] = { mesh, cells: [] };
    });

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = map.terrain[i];
        if (t === Terrain.Empty) continue;
        const v = map.variant[i] % 2;
        const r = new Rng(hash3(x, y, map.seed, 23));
        const target =
          t === Terrain.Hard ? hardMeshes[v] : this.crates[v]!.mesh;
        const slot = target.count++;
        quat.setFromAxisAngle(
          UP,
          t === Terrain.Hard
            ? v === 0
              ? r.range(0, 6.28)
              : r.pick([0, Math.PI / 2])
            : r.range(-0.14, 0.14),
        );
        const s = r.range(0.96, 1.04);
        m4.compose(
          pos.set(gridToWorldX(w, x + 0.5), 0, gridToWorldZ(h, y + 0.5)),
          quat,
          scl.set(s, s * r.range(0.96, 1.08), s),
        );
        target.setMatrixAt(slot, m4);
        tint.setScalar(r.range(0.92, 1.05));
        target.setColorAt(slot, tint);
        if (t === Terrain.Crate) {
          this.crates[v]!.cells.push(i);
          this.crateSlot[i] = slot;
          this.crateKind[i] = v;
        }
      }
    }

    // --- decor on the margin
    const decor = sharedDecor(w, h);
    const decorMesh = new Mesh(decor.body, flat);
    decorMesh.castShadow = decorMesh.receiveShadow = true;
    const bulbMat = mat(
      new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    this.group.add(decorMesh, new Mesh(decor.bulbs, bulbMat));

    // --- warning squares on the floor where the next walls will land
    const warnGeo = shared('warn', () =>
      new PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2),
    );
    const warnMat = mat(
      new MeshBasicMaterial({
        color: 0xff4a2a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.warn = new InstancedMesh(warnGeo, warnMat, 16);
    this.warn.count = 0;
    this.warn.frustumCulled = false;
    this.warn.renderOrder = 2;
    this.group.add(this.warn);

    // --- light: warm key + cool fill; the key's shadow map is static (see `consumeShadowDirty`)
    const r = Math.hypot(w, h) / 2 + 2;
    this.sun.position.set(-0.5, 1, 0.7).normalize().multiplyScalar(40);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const cam = this.sun.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 5;
      cam.far = 90;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 3;
    }
    this.group.add(this.sun, new HemisphereLight(0xcfe6ff, 0x9a7a55, 1.25));
  }

  /** Boulders on the rim above the cliff: one instanced mesh, seeded. */
  private addRimRocks(hx: number, hz: number, rng: Rng, mat: Material): void {
    const m4 = new Matrix4();
    const quat = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3();
    const spots: [number, number, number][] = [];
    for (const d of [RIM_D + 1.2, RIM_D + 3.6, RIM_D + 7]) {
      const pts = ringPoints(hx, hz, d);
      for (let i = 0; i < pts.length; i += 2)
        if (rng.chance(0.45)) spots.push([pts[i], pts[i + 1], d]);
    }
    const mesh = new InstancedMesh(
      shared('boulder', boulderGeometry),
      mat,
      Math.max(1, spots.length),
    );
    spots.forEach(([x, z], k) => {
      const sc = rng.range(1.2, 2.8);
      m4.compose(
        pos.set(x, RIM_H - 0.2, z),
        quat.setFromAxisAngle(UP, rng.range(0, 6.28)),
        scl.set(sc * rng.range(0.9, 1.4), sc * rng.range(0.8, 1.6), sc),
      );
      mesh.setMatrixAt(k, m4);
    });
    this.group.add(mesh);
  }

  /** Animate the walls in the air (`t` = the FX clock in seconds). */
  update(t: number): void {
    if (this.falling.length === 0) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      const left = f.land - t; // seconds until it lands
      let y = 0;
      let sy = 1;
      if (left > 0) y = (left / WALL_FALL_S) ** 2 * WALL_DROP_H;
      else if (left > -0.16) {
        // a small bounce and squash on impact
        const k = -left / 0.16;
        y = Math.sin(k * Math.PI) * 0.2;
        sy = 1 - Math.sin(k * Math.PI) * 0.08;
      }
      q.setFromAxisAngle(UP, f.yaw);
      m.compose(p.set(f.x, y, f.z), q, s.set(1, sy, 1));
      f.mesh.setMatrixAt(f.slot, m);
      f.mesh.instanceMatrix.needsUpdate = true;
      if (left <= -0.16) {
        this.falling.splice(i, 1);
        this.shadowDirty = true;
      }
    }
  }

  /**
   * Sudden death: a wall falls onto cell `(x, y)`, landing `WALL_FALL_S` seconds after clock time `now`. Whatever stood there
   * (crate) must be removed by the caller first.
   */
  dropWall(x: number, y: number, now: number): void {
    const { w, h } = this.map;
    const v = (x * 7 + y * 13) % 2;
    const mesh = this.hardMeshes[v];
    if (mesh.count >= mesh.instanceMatrix.count) return;
    const slot = mesh.count++;
    const r = new Rng(hash3(x, y, this.map.seed, 77));
    const tint = new Color().setScalar(r.range(0.94, 1.04));
    mesh.setColorAt(slot, tint);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.falling.push({
      mesh,
      slot,
      x: gridToWorldX(w, x + 0.5),
      z: gridToWorldZ(h, y + 0.5),
      land: now + WALL_FALL_S,
      yaw: v === 0 ? r.range(0, 6.28) : r.pick([0, Math.PI / 2]),
    });
    // park it high until update() places it
    const m = new Matrix4().makeTranslation(0, 100, 0);
    mesh.setMatrixAt(slot, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Mark the cells where walls are about to land (at most 16 are drawn); call every frame, `n = 0` hides them. */
  setWarnings(cells: Int16Array, n: number, t: number): void {
    const { w, h } = this.map;
    const m = new Matrix4();
    const count = Math.min(n, this.warn.instanceMatrix.count);
    for (let k = 0; k < count; k++) {
      const c = cells[k];
      const x = c % w;
      const y = (c - x) / w;
      const pulse = 0.85 + 0.15 * Math.sin(t * 18);
      m.makeScale(pulse, 1, pulse);
      m.setPosition(gridToWorldX(w, x + 0.5), 0.03, gridToWorldZ(h, y + 0.5));
      this.warn.setMatrixAt(k, m);
    }
    this.warn.count = count;
    this.warn.instanceMatrix.needsUpdate = true;
  }

  /** Remove the crate on cell `(x, y)` (a `blockBroken` event). Returns false when there is none. */
  removeCrate(x: number, y: number): boolean {
    const { w } = this.map;
    const cell = y * w + x;
    const slot = this.crateSlot[cell];
    const kind = this.crateKind[cell];
    if (slot < 0 || kind < 0) return false;
    const r = this.crates[kind]!;
    const last = r.cells.length - 1;
    if (slot !== last) {
      const m = new Matrix4();
      r.mesh.getMatrixAt(last, m);
      r.mesh.setMatrixAt(slot, m);
      const c = new Color();
      r.mesh.getColorAt(last, c);
      r.mesh.setColorAt(slot, c);
      const moved = r.cells[last];
      r.cells[slot] = moved;
      this.crateSlot[moved] = slot;
    }
    r.cells.pop();
    r.mesh.count = r.cells.length;
    r.mesh.instanceMatrix.needsUpdate = true;
    if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true;
    this.crateSlot[cell] = -1;
    this.crateKind[cell] = -1;
    this.shadowDirty = true;
    return true;
  }

  /** Crates still standing. */
  get crateCount(): number {
    return (
      (this.crates[0]?.cells.length ?? 0) + (this.crates[1]?.cells.length ?? 0)
    );
  }

  /** Draw the static shadow map again at the next frame (after a lost WebGL context the map is empty). */
  markShadowDirty(): void {
    this.shadowDirty = true;
  }

  /** Casters changed since the last shadow draw (peek; `consumeShadowDirty` clears it). */
  isShadowDirty(): boolean {
    return this.shadowDirty;
  }

  /** True once after the casters changed: the game then sets `renderer.shadowMap.needsUpdate = true`. */
  consumeShadowDirty(): boolean {
    const d = this.shadowDirty;
    this.shadowDirty = false;
    return d;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
  }
}
