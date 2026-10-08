import {
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  type DataTexture,
} from 'three';
import { Rng } from '../../../shared/rng';
import { SLAB_PAD } from './camera-rig';
import {
  buildCritter,
  footGeometry,
  hatGeometry,
  vestGeometry,
  type CritterModel,
} from './crew-parts';
import { clayMaterial, makeGrainTexture } from './materials';
import { MAX_PLAYERS } from '../sim/rules';
import type { PlayerView, SimEvent } from '../sim/types';

/** Hard-hat / vest colour per player slot. */
export const TEAM_COLORS = [
  0xe5484d, 0x3b82f6, 0x35b567, 0xff9f1c, 0x9b5de5, 0x22c3d6, 0xf472b6,
  0xf2d024,
] as const;

const SOOT = 0x59514c;
/** Critters are drawn a little bigger than their hitbox: they are small on a whole-arena view. */
export const CRITTER_SCALE = 1.14;

/** Seconds: the critter shrinks away, is gone for a moment, then pops up dazed on the slab edge. */
const KO_SHRINK = 0.18;
const KO_SEAT_AT = 0.38;
const GRAVITY = 14;

/** Per-player animation state. */
interface Vis {
  phase: number;
  walk: number;
  yaw: number;
  /** Seconds since a TNT was placed (squash), large = idle. */
  place: number;
  /** Seconds since KO, -1 = alive. */
  ko: number;
  /** Where the dazed critter sits (world). */
  seatX: number;
  seatZ: number;
  /** Seconds of cheering, -1 = not. */
  cheer: number;
  hat: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    rx: number;
    rz: number;
    vrx: number;
    vrz: number;
    rest: boolean;
  };
  koCount: number;
}

const fresh = (): Vis => ({
  phase: 0,
  walk: 0,
  yaw: 0,
  place: 99,
  ko: -1,
  seatX: 0,
  seatZ: 0,
  cheer: -1,
  hat: {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    rz: 0,
    vrx: 0,
    vrz: 0,
    rest: false,
  },
  koCount: 0,
});

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Shortest signed angle from `a` to `b`. */
const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * The Boom Crew on screen: one body mesh per player, plus ONE shared InstancedMesh each for hats, vests and feet (so the
 * whole crew is about 4 + n draw calls). Everything is animated by code from the sim's `PlayerView`s (interpolated with
 * `alpha`): waddle + bob, squash when placing TNT, hat bounce + dazed seat on the slab edge when KO, hop when winning.
 * No allocation per frame.
 */
export class Crew {
  readonly group = new Group();
  private readonly bodies: Mesh[] = [];
  private readonly mats: MeshLambertMaterial[] = [];
  private readonly models: CritterModel[];
  private readonly hats: InstancedMesh;
  private readonly vests: InstancedMesh;
  private readonly feet: InstancedMesh;
  private readonly vis: Vis[];
  private readonly grain: DataTexture = makeGrainTexture();
  private readonly geos: BufferGeometry[] = [];
  private readonly rng = new Rng(8);
  private clock = 0;
  /** The human's slot: a bobbing arrow over their head (-1 = none). */
  private youId = -1;
  private readonly arrow: Mesh;
  private readonly arrowMat = new MeshBasicMaterial({ toneMapped: false });
  // scratch
  private readonly o = new Object3D();
  private readonly body = new Matrix4();
  private readonly tmp = new Matrix4();
  private readonly local = new Matrix4();
  private readonly color = new Color();

  /** `w`, `h` = the arena size in cells (for world mapping and the dazed seats on the slab edge). */
  constructor(
    private readonly players: readonly PlayerView[],
    private readonly w: number,
    private readonly h: number,
  ) {
    const n = Math.min(players.length, MAX_PLAYERS);
    this.models = players.slice(0, n).map((p) => buildCritter(p.critter));
    this.vis = players.slice(0, n).map(fresh);

    this.models.forEach((m, i) => {
      this.geos.push(m.geometry);
      const mat = clayMaterial(this.grain, { vertexColors: true });
      const mesh = new Mesh(m.geometry, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.mats.push(mat);
      this.bodies.push(mesh);
      this.group.add(mesh);
      this.vis[i].yaw = 0;
    });

    const arrowGeo = new ConeGeometry(0.17, 0.34, 4).rotateX(Math.PI);
    this.geos.push(arrowGeo);
    this.arrow = new Mesh(arrowGeo, this.arrowMat);
    this.arrow.visible = false;
    this.arrow.frustumCulled = false;
    this.group.add(this.arrow);

    const hatGeo = hatGeometry();
    const vestGeo = vestGeometry();
    const footGeo = footGeometry();
    this.geos.push(hatGeo, vestGeo, footGeo);
    const teamMat = clayMaterial(this.grain, { vertexColors: true });
    const vestMat = new MeshLambertMaterial({
      vertexColors: true,
      side: DoubleSide,
    });
    this.mats.push(teamMat, vestMat);
    this.hats = new InstancedMesh(hatGeo, teamMat, n);
    this.vests = new InstancedMesh(vestGeo, vestMat, n);
    this.feet = new InstancedMesh(footGeo, teamMat, n * 2);
    for (const m of [this.hats, this.vests, this.feet]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    for (let i = 0; i < n; i++) {
      this.color.setHex(TEAM_COLORS[i % TEAM_COLORS.length]);
      this.hats.setColorAt(i, this.color);
      this.vests.setColorAt(i, this.color);
      this.color.setHex(this.models[i].foot);
      this.feet.setColorAt(i * 2, this.color);
      this.feet.setColorAt(i * 2 + 1, this.color);
    }
  }

  /** Mark player `id` (the human) with a bobbing arrow in their team colour; -1 removes it. */
  setYou(id: number): void {
    this.youId = id;
    if (id >= 0 && id < this.vis.length)
      this.arrowMat.color.setHex(TEAM_COLORS[id % TEAM_COLORS.length]);
    else this.arrow.visible = false;
  }

  /** Back to the start of a round: everyone upright, clean and not cheering. */
  reset(): void {
    this.vis.forEach((_, i) => {
      this.vis[i] = fresh();
      this.mats[i].color.setHex(0xffffff);
    });
  }

  /** Feed the sim's events (squash on `tntPlaced`, KO sequence, cheer for the round winner). */
  onEvent(e: SimEvent): void {
    if (e.type === 'tntPlaced') {
      const v = this.vis[e.owner];
      if (v) v.place = 0;
    } else if (e.type === 'playerKo') this.startKo(e.id);
    else if (e.type === 'roundOver' && e.winner !== null) this.cheer(e.winner);
  }

  cheer(id: number): void {
    const v = this.vis[id];
    if (v && v.ko < 0) v.cheer = 0;
  }

  /** World (x, z) of player `id` at `alpha` between the last two ticks. */
  worldPos(id: number, alpha: number, out: { x: number; z: number }): void {
    const p = this.players[id];
    out.x = p.px + (p.x - p.px) * alpha - this.w / 2;
    out.z = p.py + (p.y - p.py) * alpha - this.h / 2;
  }

  private startKo(id: number): void {
    const v = this.vis[id];
    const p = this.players[id];
    if (!v || v.ko >= 0) return;
    v.ko = 0;
    v.koCount++;
    const kx = p.x - this.w / 2;
    const kz = p.y - this.h / 2;
    const W = this.w / 2;
    const H = this.h / 2;
    const pad = SLAB_PAD * 0.5;
    const d = [kx + W, W - kx, kz + H, H - kz];
    const side = d.indexOf(Math.min(...d));
    const cx = Math.max(-W + 1, Math.min(W - 1, kx));
    const cz = Math.max(-H + 1, Math.min(H - 1, kz));
    // dazed seat: just outside the nearest wall, on the slab margin
    [v.seatX, v.seatZ] =
      side === 0
        ? [-W - pad, cz]
        : side === 1
          ? [W + pad, cz]
          : side === 2
            ? [cx, -H - pad]
            : [cx, H + pad];
    // the hard hat pops off, away from the blast and towards the edge
    const hat = v.hat;
    hat.x = kx;
    hat.y = this.models[id].hatY;
    hat.z = kz;
    hat.vx = (v.seatX - kx) * 0.7 + this.rng.range(-1, 1);
    hat.vz = (v.seatZ - kz) * 0.7 + this.rng.range(-1, 1);
    hat.vy = 4.4 + this.rng.range(0, 1);
    hat.vrx = this.rng.range(-9, 9);
    hat.vrz = this.rng.range(-9, 9);
    hat.rx = hat.rz = 0;
    hat.rest = false;
    this.mats[id].color.setHex(SOOT);
  }

  /** Pose everything for this frame. `dt` in seconds. */
  update(alpha: number, dt: number): void {
    this.clock += dt;
    const o = this.o;
    for (let i = 0; i < this.vis.length; i++) {
      const p = this.players[i];
      const v = this.vis[i];
      const model = this.models[i];
      v.place += dt;

      let x = p.px + (p.x - p.px) * alpha - this.w / 2;
      let z = p.py + (p.y - p.py) * alpha - this.h / 2;
      const alive = v.ko < 0;
      const moving = alive && p.moving;
      v.walk += ((moving ? 1 : 0) - v.walk) * Math.min(1, dt * 12);
      v.phase += dt * p.speed * 2.6 * v.walk;
      const targetYaw = Math.PI / 2 - p.facing;
      v.yaw += angleDelta(v.yaw, targetYaw) * Math.min(1, dt * 14);

      let yaw = v.yaw;
      let y = 0;
      let roll = 0;
      let pitch = 0;
      let sx = 1;
      let sy = 1;
      let sz = 1;
      let visible = 1;

      const s =
        v.place < 0.6
          ? Math.exp(-v.place * 9) * Math.cos(v.place * 28) * 0.3
          : 0;
      sy -= s;
      sx += s * 0.6;
      sz += s * 0.6;

      if (alive) {
        y +=
          Math.abs(Math.sin(v.phase)) * 0.06 * v.walk +
          Math.sin(this.clock * 2.4 + i) * 0.012 * (1 - v.walk);
        roll = Math.sin(v.phase) * 0.11 * v.walk;
        if (v.cheer >= 0) {
          v.cheer += dt;
          y += Math.abs(Math.sin(v.cheer * 7)) * 0.32;
          yaw += v.cheer * 5;
        }
      } else {
        v.ko += dt;
        const t = v.ko;
        if (t < KO_SHRINK) {
          visible = 1 - t / KO_SHRINK;
          yaw += t * 30;
        } else if (t < KO_SEAT_AT) visible = 0;
        else {
          const u = t - KO_SEAT_AT;
          visible = Math.max(0.001, easeOutBack(Math.min(1, u / 0.3))) * 0.88;
          x = v.seatX;
          z = v.seatZ;
          yaw = Math.atan2(-v.seatX, -v.seatZ);
          pitch = -0.28;
          sy *= 0.84;
          roll = Math.sin(u * 3.2) * 0.14;
          y = 0;
        }
        this.stepHat(v, dt);
      }

      o.position.set(x, y, z);
      o.rotation.set(pitch, yaw, roll, 'YXZ');
      const k = visible * CRITTER_SCALE;
      o.scale.set(sx * k, sy * k, sz * k);
      o.updateMatrix();
      this.body.copy(o.matrix);
      const mesh = this.bodies[i];
      mesh.matrix.copy(this.body);
      mesh.matrixWorldNeedsUpdate = true;
      this.vests.setMatrixAt(i, this.body);

      // hat: on the head while alive, ballistic after the KO
      if (alive) {
        this.local.makeTranslation(0, model.hatY, 0);
        this.tmp.multiplyMatrices(this.body, this.local);
        this.hats.setMatrixAt(i, this.tmp);
      } else {
        const h = v.hat;
        o.position.set(h.x, h.y, h.z);
        o.rotation.set(h.rx, 0, h.rz);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        this.hats.setMatrixAt(i, o.matrix);
      }

      // feet: alternate lift + swing
      const l = Math.max(0, Math.sin(v.phase)) * 0.09 * v.walk;
      const r = Math.max(0, -Math.sin(v.phase)) * 0.09 * v.walk;
      const swing = Math.cos(v.phase) * 0.07 * v.walk;
      this.local.makeTranslation(-0.13, l, 0.04 + swing);
      this.tmp.multiplyMatrices(this.body, this.local);
      this.feet.setMatrixAt(i * 2, this.tmp);
      this.local.makeTranslation(0.13, r, 0.04 - swing);
      this.tmp.multiplyMatrices(this.body, this.local);
      this.feet.setMatrixAt(i * 2 + 1, this.tmp);
    }
    // the arrow over the human's hat
    const you = this.youId;
    const showArrow = you >= 0 && you < this.vis.length && this.vis[you].ko < 0;
    this.arrow.visible = showArrow;
    if (showArrow) {
      const p = this.players[you];
      this.arrow.position.set(
        p.px + (p.x - p.px) * alpha - this.w / 2,
        (this.models[you].hatY + 0.5) * CRITTER_SCALE +
          Math.sin(this.clock * 5) * 0.07,
        p.py + (p.y - p.py) * alpha - this.h / 2,
      );
      this.arrow.rotation.y += dt * 2.5;
    }
    this.hats.instanceMatrix.needsUpdate = true;
    this.vests.instanceMatrix.needsUpdate = true;
    this.feet.instanceMatrix.needsUpdate = true;
  }

  private stepHat(v: Vis, dt: number): void {
    const h = v.hat;
    if (h.rest) return;
    h.vy -= GRAVITY * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.z += h.vz * dt;
    h.rx += h.vrx * dt;
    h.rz += h.vrz * dt;
    if (h.y < 0.04 && h.vy < 0) {
      h.y = 0.04;
      h.vy = -h.vy * 0.42;
      h.vx *= 0.7;
      h.vz *= 0.7;
      h.vrx *= 0.55;
      h.vrz *= 0.55;
      if (Math.abs(h.vy) < 0.7) {
        h.rest = true;
        h.vy = h.vx = h.vz = 0;
        h.rx = 0.35;
        h.rz = 0;
      }
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.arrowMat.dispose();
    this.grain.dispose();
    this.hats.dispose();
    this.vests.dispose();
    this.feet.dispose();
  }
}
