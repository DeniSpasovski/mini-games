import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../../../shared/rng';

const MAX = 256;
/** Puff colour sets: dust (outdoors), confetti (the toy store), stuffing (plush, any map). */
export const PUFF_PALETTES = {
  dust: [0xf2e8cf, 0xd9c8a0, 0xbfae8a, 0xffffff],
  confetti: [0xff5a7a, 0xffd23f, 0x4fa84a, 0x3b82d6, 0xb06cf5, 0xff8a3d],
  stuffing: [0xffffff, 0xf7f2e8, 0xfde7ef, 0xeef4fb],
  fur: [0x8a6a4a, 0xc8a878, 0xf4f1ea, 0x9a9a9a, 0x6a9a3a, 0x58b04c],
} as const;
export type PuffKind = keyof typeof PUFF_PALETTES;
const PALETTES = Object.fromEntries(
  Object.entries(PUFF_PALETTES).map(([k, v]) => [
    k,
    v.map((h) => new Color(h)),
  ]),
) as Record<PuffKind, Color[]>;
const GRAVITY = 9;

/**
 * Swallow puff: a few blocky dust cubes that pop up where an item falls in.
 * One pooled InstancedMesh (ring buffer), no allocation per puff.
 */
export class Puffs {
  readonly group = new Group();
  private mesh: InstancedMesh;
  private rng = new Rng(4242);
  private palette = PALETTES.dust;
  private next = 0;
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private age = new Float32Array(MAX).fill(1);
  private life = new Float32Array(MAX).fill(1);
  private size = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private up = new Vector3(0, 1, 0);

  constructor() {
    this.mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ toneMapped: false }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setColorAt(i, PALETTES.dust[0]);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.group.add(this.mesh);
  }

  /** The colours of ordinary puffs on this map. */
  setKind(kind: PuffKind): void {
    this.palette = PALETTES[kind];
  }

  /** Burst at (x, z) for an item of this gameplay size (m); plush burst into white stuffing. */
  spawn(x: number, z: number, itemSize: number, plush = false): void {
    const colors = plush ? PALETTES.stuffing : this.palette;
    const r = this.rng;
    const count = Math.round(Math.min(12, 6 + itemSize * 1.5));
    const cube = Math.min(2.5, Math.max(0.14, itemSize * 0.14));
    const spread = Math.max(0.2, itemSize * 0.35);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = r.next() * Math.PI * 2;
      const d = r.next() * spread;
      this.px[i] = x + Math.cos(a) * d;
      this.pz[i] = z + Math.sin(a) * d;
      this.py[i] = 0.1;
      const out = 0.5 + r.next() * (1 + itemSize * 0.15);
      this.vx[i] = Math.cos(a) * out;
      this.vz[i] = Math.sin(a) * out;
      this.vy[i] = 2 + r.next() * 2 + itemSize * 0.25;
      this.life[i] = 0.45 + r.next() * 0.35;
      this.age[i] = 0;
      this.size[i] = cube * (0.6 + r.next() * 0.8);
      this.spin[i] = r.next() * Math.PI * 2;
      this.mesh.setColorAt(i, colors[Math.floor(r.next() * colors.length)]);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) continue;
      any = true;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      this.vy[i] -= GRAVITY * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] = Math.max(0.02, this.py[i] + this.vy[i] * dt);
      this.pz[i] += this.vz[i] * dt;
      const k = 1 - this.age[i] / this.life[i];
      this.q.setFromAxisAngle(this.up, this.spin[i] + this.age[i] * 4);
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.s.setScalar(this.size[i] * Math.min(1, k * 2.5));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
