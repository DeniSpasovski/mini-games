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
  Vector2,
  Vector3,
  type Camera,
  type DataTexture,
  type PerspectiveCamera,
  type WebGLRenderer,
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
import {
  FUR_LEN,
  FUR_SHELLS,
  furMaterial,
  shellGeometry,
  shellsFor,
  skinMaterial,
} from './fur';
import { clayMaterial, makeGrainTexture } from './materials';
import { MAX_PLAYERS } from '../sim/rules';
import type { PlayerView, SimEvent } from '../sim/types';

/** Names of the team colours (colour picker labels), same order as `TEAM_COLORS`. */
export const TEAM_COLOR_NAMES = [
  'Red',
  'Blue',
  'Green',
  'Orange',
  'Purple',
  'Teal',
  'Pink',
  'Yellow',
] as const;

/** Hard-hat / vest colour per team (`PlayerView.color` indexes it). */
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

/**
 * Gear materials: the instance (team) colour tints everything except the parts marked `aPlain` (reflective stripes,
 * the hat's inner band), which keep their own paint.
 */
function gearMaterial(m: MeshLambertMaterial): MeshLambertMaterial {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aPlain;',
      )
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, color.rgb, aPlain);',
      );
  };
  m.customProgramCacheKey = () => 'kabooom-gear-' + m.side;
  return m;
}

const tmpPos = new Vector3();
const tmpSize = new Vector2();

/** How many pixels tall a critter (about 1.2 units with its hat) is on screen; 0 when unknown (not a perspective camera). */
function critterPixels(
  renderer: WebGLRenderer,
  camera: Camera,
  mesh: Mesh,
): number {
  const cam = camera as PerspectiveCamera;
  if (!cam.isPerspectiveCamera) return 0;
  tmpPos.setFromMatrixPosition(mesh.matrixWorld);
  const dist = tmpPos.distanceTo(camera.position);
  if (dist <= 0) return 0;
  const h = renderer.getDrawingBufferSize(tmpSize).y;
  const unitPx = h / (2 * dist * Math.tan((cam.fov * Math.PI) / 360));
  return 1.2 * CRITTER_SCALE * unitPx;
}

/** A benched critter is launched into the sky over this long; a returning one drops from `DROP_H` in `DROP_S`. */
const FLY_S = 0.9;
const DROP_S = 0.55;
const DROP_H = 7;

const hex6 = (c: number): number => TEAM_COLORS[c % TEAM_COLORS.length];

/** Centre height of the torso the shared vest geometry is built round (`vestGeometry`). */
const VEST_CY = 0.36;

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
  /** Benched (`out`) as last seen; seconds since launched into the sky (-1 = not flying); seconds into the drop back in. */
  out: boolean;
  fly: number;
  drop: number;
  flyX: number;
  flyZ: number;
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
  out: false,
  fly: -1,
  drop: -1,
  flyX: 0,
  flyZ: 0,
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
 * The Boom Crew on screen: one body mesh and one shell-fur mesh (`fur.ts`) per player, plus ONE shared InstancedMesh
 * each for hats, vests and feet (so the whole crew is about 4 + 2n draw calls). Everything is animated by code from the sim's `PlayerView`s (interpolated with
 * `alpha`): waddle + bob, squash when placing TNT, hat bounce + dazed seat on the slab edge when KO, hop when winning.
 * No allocation per frame.
 */
export class Crew {
  readonly group = new Group();
  private readonly bodies: Mesh[] = [];
  private readonly furs: Mesh[] = [];
  /** Per critter: the fur tips' lag (critter space), fed to its fur material. */
  private readonly sways: Vector3[] = [];
  private readonly mats: MeshLambertMaterial[] = [];
  private readonly furMats: MeshLambertMaterial[] = [];
  private readonly models: CritterModel[];
  private readonly vestFit: Matrix4[];
  private readonly hatSize = new Vector3();
  private readonly hats: InstancedMesh;
  private readonly vests: InstancedMesh;
  private readonly feet: InstancedMesh;
  private readonly vis: Vis[];
  /** Team colour index on each slot's hat / vest right now. */
  private applied: Int16Array;
  /** World (x, z) where a benched critter leaves / a returning one lands: for dust and a thump. */
  onLaunch: ((x: number, z: number) => void) | null = null;
  onLand: ((x: number, z: number) => void) | null = null;
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

  /**
   * `w`, `h` = the arena size in cells (for world mapping and the dazed seats on the slab edge). `fur`: shells per
   * critter (quality) and whether the canvas has MSAA (soft hair edges).
   */
  constructor(
    private readonly players: readonly PlayerView[],
    private readonly w: number,
    private readonly h: number,
    fur: { shells: number; smooth: boolean } = {
      shells: FUR_SHELLS.high,
      smooth: true,
    },
  ) {
    const n = Math.min(players.length, MAX_PLAYERS);
    this.models = players.slice(0, n).map((p) => buildCritter(p.critter));
    // the shared vest, moved and scaled round each critter's torso
    this.vestFit = this.models.map(({ vest: v }) =>
      new Matrix4()
        .makeTranslation(0, v.cy, 0)
        .multiply(new Matrix4().makeScale(v.sx, v.sy, v.sz))
        .multiply(new Matrix4().makeTranslation(0, -VEST_CY, 0)),
    );
    this.vis = players.slice(0, n).map(fresh);

    this.models.forEach((m, i) => {
      const shells = shellGeometry(m.furGeometry, fur.shells);
      this.geos.push(m.geometry, m.furGeometry, shells);
      const mat = skinMaterial(this.grain);
      const mesh = new Mesh(m.geometry, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.mats.push(mat);
      this.bodies.push(mesh);
      this.group.add(mesh);
      const coat = furMaterial(this.grain, fur.shells, fur.smooth);
      const furMesh = new Mesh(shells, coat.material);
      furMesh.matrixAutoUpdate = false;
      furMesh.frustumCulled = false;
      // level of detail: as many shells as the critter's size on screen is worth, decided right before it is drawn
      furMesh.onBeforeRender = (renderer, _scene, camera) => {
        const px = critterPixels(renderer, camera, furMesh);
        const n = px > 0 ? shellsFor(px, fur.shells) : fur.shells;
        shells.instanceCount = n;
        coat.drawn.value = n;
      };
      this.furMats.push(coat.material);
      this.sways.push(coat.sway);
      this.furs.push(furMesh);
      this.group.add(furMesh);
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
    const teamMat = gearMaterial(
      clayMaterial(this.grain, { vertexColors: true }),
    );
    const vestMat = gearMaterial(
      new MeshLambertMaterial({
        map: this.grain,
        vertexColors: true,
        side: DoubleSide,
      }),
    );
    this.mats.push(teamMat, vestMat);
    this.hats = new InstancedMesh(hatGeo, teamMat, n);
    this.vests = new InstancedMesh(vestGeo, vestMat, n);
    this.feet = new InstancedMesh(footGeo, teamMat, n * 2);
    for (const m of [this.hats, this.vests, this.feet]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.applied = new Int16Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      this.applyColor(i);
      this.syncOut(i);
      this.color.setHex(this.models[i].foot);
      this.feet.setColorAt(i * 2, this.color);
      this.feet.setColorAt(i * 2 + 1, this.color);
    }
  }

  /** Team colour of slot `i` onto its hat and vest (and the arrow): at build time and whenever it changes. */
  private applyColor(i: number): void {
    const c = this.players[i].color;
    this.applied[i] = c;
    this.color.setHex(hex6(c));
    this.hats.setColorAt(i, this.color);
    this.vests.setColorAt(i, this.color);
    if (this.hats.instanceColor) this.hats.instanceColor.needsUpdate = true;
    if (this.vests.instanceColor) this.vests.instanceColor.needsUpdate = true;
    if (i === this.youId) this.arrowMat.color.setHex(hex6(c));
  }

  /** A critter already benched when the crew is (re)built is simply gone: no launch. */
  private syncOut(i: number): void {
    const out = this.players[i].state === 'out';
    this.vis[i].out = out;
    this.vis[i].fly = out ? FLY_S : -1;
  }

  /** Top of critter `id`'s hard hat above the floor (world units): portraits frame by it. */
  topOf(id: number): number {
    const m = this.models[id];
    return (m.hatY + 0.19 * m.hatScale) * CRITTER_SCALE;
  }

  /** Mark player `id` (the human) with a bobbing arrow in their team colour; -1 removes it. */
  setYou(id: number): void {
    this.youId = id;
    if (id >= 0 && id < this.vis.length)
      this.arrowMat.color.setHex(hex6(this.players[id].color));
    else this.arrow.visible = false;
  }

  /** Back to the start of a round: everyone upright, clean and not cheering. */
  reset(): void {
    this.vis.forEach((_, i) => {
      this.vis[i] = fresh();
      this.syncOut(i);
      this.mats[i].color.setHex(0xffffff);
      this.furMats[i].color.setHex(0xffffff);
    });
  }

  /** Feed the sim's events (squash on `tntPlaced`, KO sequence, cheer for the round winner). */
  onEvent(e: SimEvent): void {
    if (e.type === 'tntPlaced') {
      const v = this.vis[e.owner];
      if (v) v.place = 0;
    } else if (e.type === 'itemTaken') {
      const v = this.vis[e.id];
      if (v) v.place = 0; // a happy squash
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
    hat.z += this.models[id].hatZ;
    hat.z = kz;
    hat.vx = (v.seatX - kx) * 0.7 + this.rng.range(-1, 1);
    hat.vz = (v.seatZ - kz) * 0.7 + this.rng.range(-1, 1);
    hat.vy = 4.4 + this.rng.range(0, 1);
    hat.vrx = this.rng.range(-9, 9);
    hat.vrz = this.rng.range(-9, 9);
    hat.rx = hat.rz = 0;
    hat.rest = false;
    this.mats[id].color.setHex(SOOT);
    this.furMats[id].color.setHex(SOOT);
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

      if (p.color !== this.applied[i]) this.applyColor(i);
      let x = p.px + (p.x - p.px) * alpha - this.w / 2;
      let z = p.py + (p.y - p.py) * alpha - this.h / 2;
      // benched (the menu's background match): launched into the sky; back in: dropped onto the spawn
      if (p.state === 'out' && !v.out) {
        v.out = true;
        v.fly = 0;
        v.drop = -1;
        v.flyX = x;
        v.flyZ = z;
        this.onLaunch?.(x, z);
      } else if (p.state !== 'out' && v.out) {
        v.out = false;
        v.fly = -1;
        v.drop = 0;
        v.ko = -1;
      }
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
        if (v.fly >= 0) {
          // launched: a crouch, then up and away in a spin, shrinking into the sky
          v.fly = Math.min(FLY_S, v.fly + dt);
          const t = v.fly;
          x = v.flyX + t * t * 1.5;
          z = v.flyZ - t * t * 2;
          y = t < 0.12 ? 0 : (t - 0.12) * 5 + (t - 0.12) ** 2 * 9;
          yaw += t * t * 30;
          const crouch = t < 0.12 ? 0.25 * Math.sin((t / 0.12) * Math.PI) : 0;
          sy *= 1 - crouch + (t > 0.12 ? 0.15 : 0);
          sx *= 1 + crouch * 0.6;
          sz *= 1 + crouch * 0.6;
          visible = 1 - Math.max(0, (t - 0.45) / (FLY_S - 0.45));
        } else if (v.drop >= 0) {
          // dropped in from the sky, stretched by the speed, landing in a squash and a puff of dust
          v.drop += dt;
          const k = Math.min(1, v.drop / DROP_S);
          y += (1 - k * k) * DROP_H;
          const stretch = 0.15 * k;
          sy *= 1 + stretch;
          sx *= 1 - stretch * 0.5;
          sz *= 1 - stretch * 0.5;
          yaw += (1 - k) * (1 - k) * 9;
          if (k >= 1) {
            v.drop = -1;
            v.place = 0;
            this.onLand?.(x, z);
          }
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
      const furMesh = this.furs[i];
      furMesh.matrix.copy(this.body);
      furMesh.matrixWorldNeedsUpdate = true;
      furMesh.visible = visible > 0.01;
      // the fur lags the waddle: pushed back while walking, flung down by a squash, swinging with each step
      this.sways[i]
        .set(
          Math.cos(v.phase) * 0.35 * v.walk,
          -Math.abs(Math.sin(v.phase)) * 0.45 * v.walk - s * 2.5,
          -0.8 * v.walk,
        )
        .multiplyScalar(FUR_LEN);
      this.tmp.multiplyMatrices(this.body, this.vestFit[i]);
      this.vests.setMatrixAt(i, this.tmp);

      // hat: on the head while alive, ballistic after the KO
      if (alive) {
        this.local
          .makeRotationX(model.hatTilt)
          .scale(this.hatSize.setScalar(model.hatScale))
          .setPosition(0, model.hatY, model.hatZ);
        this.tmp.multiplyMatrices(this.body, this.local);
        this.hats.setMatrixAt(i, this.tmp);
      } else {
        const h = v.hat;
        o.position.set(h.x, h.y, h.z);
        o.rotation.set(h.rx, 0, h.rz);
        o.scale.setScalar(model.hatScale);
        o.updateMatrix();
        this.hats.setMatrixAt(i, o.matrix);
      }

      // feet: alternate lift + swing
      const l = Math.max(0, Math.sin(v.phase)) * 0.09 * v.walk;
      const r = Math.max(0, -Math.sin(v.phase)) * 0.09 * v.walk;
      const swing = Math.cos(v.phase) * 0.07 * v.walk;
      const fs = model.feet.scale;
      this.local
        .makeScale(fs, fs, fs)
        .setPosition(-model.feet.spread, l, 0.04 + swing);
      this.tmp.multiplyMatrices(this.body, this.local);
      this.feet.setMatrixAt(i * 2, this.tmp);
      this.local
        .makeScale(fs, fs, fs)
        .setPosition(model.feet.spread, r, 0.04 - swing);
      this.tmp.multiplyMatrices(this.body, this.local);
      this.feet.setMatrixAt(i * 2 + 1, this.tmp);
    }
    // the arrow over the human's hat
    const you = this.youId;
    const showArrow =
      you >= 0 &&
      you < this.vis.length &&
      this.vis[you].ko < 0 &&
      !this.vis[you].out;
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
    for (const m of this.furMats) m.dispose();
    this.arrowMat.dispose();
    this.grain.dispose();
    this.hats.dispose();
    this.vests.dispose();
    this.feet.dispose();
  }
}
