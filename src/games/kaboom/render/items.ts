import {
  AdditiveBlending,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { PowerUp } from '../sim/powerups';
import { dynamitesItemGeometry, sticksItemGeometry } from './crew-parts';
import { ROUGH } from './materials';
import { bbox, merge, part } from './parts';
import { stickPaperTexture } from './tnt';

const UP = new Vector3(0, 1, 0);
/** Most power-ups that can lie around at once (`powerUpTotal` for 8 players is 22, never all uncovered at once). */
const CAPACITY = 24;
/** Power-ups are drawn bigger than their cell content suggests: they are small on a whole-arena view. */
const ITEM_SCALE = 1.55;

/** Glow colour under each kind: the colour of its pad (cyan = more dynamites, gold = more sticks). */
const GLOW = [new Color(0x38c6ff), new Color(0xffb020)];

/** The plinth a power-up hovers over: a bevelled stone slab with a lighter chamfered top and a dark inlay ring. */
function pedestalGeometry(): BufferGeometry {
  return merge([
    part(bbox(0.74, 0.07, 0.74, 0.025), 0x8d8a84, {
      y: 0.035,
      tint: 0.1,
      rough: ROUGH.stone,
    }),
    part(bbox(0.56, 0.035, 0.56, 0.015), 0xb7b2a8, {
      y: 0.085,
      ry: Math.PI / 4,
      tint: 0.08,
      rough: ROUGH.stone,
    }),
  ]);
}

const easeOutBack = (t: number): number =>
  1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

/**
 * The power-ups lying on the floor: two InstancedMeshes (twin dynamite bundles / one fat bundle of sticks) that hover, spin
 * and pop in when they appear. Stateless apart from the pop-in clock: it just reads `sim.items` every frame.
 */
export class ItemRenderer {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[];
  private readonly geos: BufferGeometry[];
  /** The stone plinths and the glow on them, one each per item (two draws for every power-up on the floor). */
  private readonly plinths: InstancedMesh;
  private readonly glows: InstancedMesh;
  private readonly glowMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly plinthMaterial = new MeshLambertMaterial({
    vertexColors: true,
  });
  private readonly material = new MeshLambertMaterial({
    vertexColors: true,
    map: stickPaperTexture(),
    emissive: 0x555555,
  });
  /** Clock time each cell's item was first seen (-1 = none). */
  private readonly seen: Float32Array;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();
  private clock = 0;

  /** `w`, `h` = arena size in cells. */
  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.geos = [dynamitesItemGeometry(), sticksItemGeometry()];
    this.meshes = this.geos.map((g) => {
      const mesh = new InstancedMesh(g, this.material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.plinths = new InstancedMesh(
      pedestalGeometry(),
      this.plinthMaterial,
      CAPACITY,
    );
    this.glows = new InstancedMesh(
      new RingGeometry(0.3, 0.62, 28).rotateX(-Math.PI / 2),
      this.glowMaterial,
      CAPACITY,
    );
    for (const m of [this.plinths, this.glows]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.plinths.receiveShadow = true;
    this.glows.renderOrder = 1;
    this.seen = new Float32Array(w * h).fill(-1);
  }

  /** Pose every item of `items` (the sim's per-cell kinds). `dt` in seconds. */
  update(items: Int8Array, dt: number): void {
    this.clock += dt;
    const t = this.clock;
    const counts = [0, 0];
    let under = 0;
    for (let i = 0; i < items.length; i++) {
      const kind = items[i];
      if (kind < 0) {
        this.seen[i] = -1;
        continue;
      }
      if (this.seen[i] < 0) this.seen[i] = t;
      const mesh = this.meshes[kind === PowerUp.Dynamites ? 0 : 1];
      const slot = counts[kind === PowerUp.Dynamites ? 0 : 1]++;
      if (slot >= CAPACITY) continue;
      const x = i % this.w;
      const z = (i - x) / this.w;
      const pop = easeOutBack(Math.min(1, (t - this.seen[i]) / 0.35));
      const bob = 0.14 + Math.sin(t * 3 + i) * 0.05;
      const s =
        Math.max(0.001, pop) * ITEM_SCALE * (1 + Math.sin(t * 5 + i) * 0.04);
      this.m.compose(
        this.pos.set(x + 0.5 - this.w / 2, bob, z + 0.5 - this.h / 2),
        this.q.setFromAxisAngle(UP, t * 1.6 + i),
        this.scl.set(s, s, s),
      );
      mesh.setMatrixAt(slot, this.m);
      if (under < CAPACITY) {
        // the plinth rises with the pop; the glow on it breathes
        const cx = x + 0.5 - this.w / 2;
        const cz = z + 0.5 - this.h / 2;
        const ps = Math.max(0.001, Math.min(1, pop));
        this.m.compose(
          this.pos.set(cx, 0, cz),
          this.q.identity(),
          this.scl.set(ps, ps, ps),
        );
        this.plinths.setMatrixAt(under, this.m);
        const gs = ps * (0.92 + 0.1 * Math.sin(t * 4 + i));
        this.m.compose(
          this.pos.set(cx, 0.11, cz),
          this.q.identity(),
          this.scl.set(gs, 1, gs),
        );
        this.glows.setMatrixAt(under, this.m);
        this.glows.setColorAt(under, GLOW[kind === PowerUp.Dynamites ? 0 : 1]);
        under++;
      }
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = Math.min(CAPACITY, counts[k]);
      mesh.instanceMatrix.needsUpdate = true;
    });
    // an instanced mesh with no instances still costs a draw call: hide the pair while nothing lies on the floor
    this.plinths.count = this.glows.count = under;
    this.plinths.visible = this.glows.visible = under > 0;
    this.plinths.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
  }

  /** Items drawn last frame (tests). */
  get count(): number {
    return this.meshes[0].count + this.meshes[1].count;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.material.dispose();
    for (const m of this.meshes) m.dispose();
    this.plinths.geometry.dispose();
    this.glows.geometry.dispose();
    this.plinthMaterial.dispose();
    this.glowMaterial.dispose();
    this.plinths.dispose();
    this.glows.dispose();
  }
}
