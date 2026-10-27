import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../../../shared/rng';
import { displaceRadial, paint } from '../engine/geo';
import { getMaterial } from '../engine/materials';

const _m = new Matrix4();
const _q = new Quaternion();
const _dq = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _axis = new Vector3();
const _c = new Color();

/**
 * Gravel spray as real stones: a pool of small faceted rocks (one InstancedMesh, one draw call) on the rock scan,
 * thrown, tumbling, bouncing on `ground` and lying there until they shrink away. Lit by the scene lights, so the
 * particle lighting calls (`setLight`, `setHeadlight`, ...) do nothing; they are here so it slots in beside the
 * dust (`ParticleSystem`).
 */
export class GravelStones {
  /** The stones (named like ParticleSystem's for the perf panel's on / off). */
  readonly points: InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private axis: Float32Array;
  private spinRate: Float32Array;
  private size: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(
    readonly max: number,
    private ground: (x: number, z: number) => number,
  ) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 4);
    this.axis = new Float32Array(max * 3);
    this.spinRate = new Float32Array(max);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    // A unit stone (1 m across): a lumpy, slightly flat icosahedron.
    const g = new IcosahedronGeometry(0.5, 0);
    const rng = new Rng(7);
    displaceRadial(g, () => (rng.next() - 0.5) * 0.18);
    g.scale(1.1, 0.75, 0.95);
    g.computeVertexNormals();
    this.points = new InstancedMesh(
      paint(g, '#ffffff'),
      getMaterial('rock'),
      max,
    );
    this.points.frustumCulled = false;
    this.points.castShadow = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.points.setMatrixAt(i, _m);
      this.points.setColorAt(i, _c.setRGB(1, 1, 1));
    }
  }

  setLight(): void {}
  setHeadlight(): void {}
  setTaillight(): void {}
  setViewport(): void {}

  /** Same arguments as `ParticleSystem.emit`; `size` is the spray sprite's size (m): a stone is half that (2.5-6 cm road gravel); `grow` and `alpha` are unused. */
  emit(
    p: Vector3,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    _grow: number,
    life: number,
    color: Color,
    _alpha?: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    _axis
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize();
    this.axis.set([_axis.x, _axis.y, _axis.z], i * 3);
    _q.setFromAxisAngle(_axis, Math.random() * Math.PI * 2);
    this.rot.set([_q.x, _q.y, _q.z, _q.w], i * 4);
    this.spinRate[i] = 8 + Math.random() * 14;
    this.size[i] = size * 0.5;
    this.age[i] = 0;
    // Stones lie on the road a while longer than the spray sprites lived.
    this.life[i] = life * 2.5;
    // The scan is already stone coloured: the spray's colour only shifts it towards the road's.
    this.points.setColorAt(
      i,
      _c.setRGB(
        Math.min(1.2, 0.55 + color.r * 1.4),
        Math.min(1.2, 0.55 + color.g * 1.4),
        Math.min(1.2, 0.55 + color.b * 1.4),
      ),
    );
    if (this.points.instanceColor) this.points.instanceColor.needsUpdate = true;
  }

  update(dt: number, drag = 0.35, gravity = -9.8): void {
    const damp = Math.exp(-drag * dt);
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const a = (this.age[i] += dt);
      const t = a / this.life[i];
      const k = i * 3;
      if (t >= 1) {
        this.life[i] = 0;
        this.points.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      alive++;
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp + gravity * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const r = this.size[i] * 0.35;
      const gy = this.ground(this.pos[k], this.pos[k + 2]) + r;
      if (this.pos[k + 1] < gy) {
        // Bounce once or twice, then lie still.
        this.pos[k + 1] = gy;
        this.vel[k + 1] =
          Math.abs(this.vel[k + 1]) > 1 ? -this.vel[k + 1] * 0.3 : 0;
        this.vel[k] *= 0.45;
        this.vel[k + 2] *= 0.45;
        this.spinRate[i] *= 0.4;
      }
      _q.fromArray(this.rot, i * 4);
      _axis.fromArray(this.axis, k);
      _dq.setFromAxisAngle(_axis, this.spinRate[i] * dt);
      _q.premultiply(_dq);
      _q.toArray(this.rot, i * 4);
      // Shrink away over the last fifth of its life.
      const s = this.size[i] * Math.min(1, (1 - t) * 5);
      _p.fromArray(this.pos, k);
      _s.setScalar(s);
      this.points.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.alive = alive;
    this.points.instanceMatrix.needsUpdate = true;
  }

  get aliveCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
  }
}
