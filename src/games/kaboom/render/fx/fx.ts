import { Group, type Texture } from 'three';
import { Rng } from '../../../../shared/rng';
import type { SimEvent } from '../../sim/types';
import { FlameType, FlameField } from './flames';
import {
  ParticleSystem,
  type ParticleKind,
  type TimeUniform,
} from './particles';
import { WALL_FALL_S } from '../arena';
import { Shake } from './shake';
import { WordBurst, makeWordAtlas } from './word-burst';

/** Pool sizes: the oldest particle is recycled when a pool is full, so these only bound the cost. */
export const FX_CAPACITY = {
  fire: 768,
  smoke: 640,
  dust: 512,
  splinter: 768,
  spark: 512,
  flash: 48,
  ring: 48,
  scorch: 96,
  flames: 1024,
  words: 4,
} as const;

/** Blast direction -> flame tile type of an arm's tip (order of `tntExploded.arms`: +x, -x, +z, -z). */
const TIPS = [
  FlameType.TipPosX,
  FlameType.TipNegX,
  FlameType.TipPosZ,
  FlameType.TipNegZ,
];
const DIR: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Seconds a scorch mark stays on the floor. */
const SCORCH_S = 6;

/**
 * All explosion visuals behind one object: soft GPU sprites (fire puffs, smoke, dust, flash, a shockwave ring and a
 * scorch mark on the floor), spark streaks, wood splinters, the flame tiles, the comic word bursts and the camera shake.
 * Feed it the sim's events, call `update` once per frame; every effect is a pooled InstancedMesh animated in a vertex
 * shader from one shared clock, so a blast costs the same however many go off at once (DETAILS.md "Performance").
 */
export class Fx {
  readonly group = new Group();
  /** The one clock all FX shaders read. */
  readonly time: TimeUniform = { value: 0 };
  readonly fire: ParticleSystem;
  readonly smoke: ParticleSystem;
  readonly dust: ParticleSystem;
  readonly splinters: ParticleSystem;
  readonly sparks: ParticleSystem;
  readonly flash: ParticleSystem;
  readonly ring: ParticleSystem;
  readonly scorch: ParticleSystem;
  readonly flames: FlameField;
  readonly words: WordBurst;
  readonly shake = new Shake();
  private readonly pools: ParticleSystem[];
  private readonly rng = new Rng(31337);

  /** `w`, `h` = arena size in cells; `wordAtlas` = lettering texture (default: drawn on a canvas, browser only). */
  constructor(
    private readonly w: number,
    private readonly h: number,
    wordAtlas: Texture = makeWordAtlas(),
  ) {
    const pool = (kind: ParticleKind, n: number) =>
      new ParticleSystem(kind, n, this.time);
    this.fire = pool('fire', FX_CAPACITY.fire);
    this.smoke = pool('smoke', FX_CAPACITY.smoke);
    this.dust = pool('dust', FX_CAPACITY.dust);
    this.splinters = pool('splinter', FX_CAPACITY.splinter);
    this.sparks = pool('spark', FX_CAPACITY.spark);
    this.flash = pool('flash', FX_CAPACITY.flash);
    this.ring = pool('ring', FX_CAPACITY.ring);
    this.scorch = pool('scorch', FX_CAPACITY.scorch);
    this.pools = [
      this.scorch,
      this.ring,
      this.smoke,
      this.dust,
      this.splinters,
      this.fire,
      this.sparks,
      this.flash,
    ];
    this.flames = new FlameField(FX_CAPACITY.flames, this.time);
    this.words = new WordBurst(FX_CAPACITY.words, this.time, wordAtlas);
    this.group.add(
      this.flames.mesh,
      ...this.pools.map((p) => p.mesh),
      this.words.mesh,
    );
  }

  private wx(x: number): number {
    return x + 0.5 - this.w / 2;
  }
  private wz(y: number): number {
    return y + 0.5 - this.h / 2;
  }

  /** React to one sim event (positions in cells). */
  onEvent(e: SimEvent): void {
    const t = this.time.value;
    const r = this.rng;
    switch (e.type) {
      case 'tntExploded': {
        const cx = this.wx(e.x);
        const cz = this.wz(e.y);
        // deep in a chain the extras thin out: the flames still show every tile, the screen does not drown in smoke
        const rich = e.chainDepth < 3 ? 1 : 0.5;
        const reach = Math.max(e.arms[0], e.arms[1], e.arms[2], e.arms[3]);
        this.flames.add(t, cx, cz, FlameType.Center);
        for (let d = 0; d < 4; d++) {
          const len = e.arms[d];
          const [dx, dz] = DIR[d];
          for (let k = 1; k <= len; k++) {
            const type =
              k === len ? TIPS[d] : d < 2 ? FlameType.ArmX : FlameType.ArmZ;
            this.flames.add(t, cx + dx * k, cz + dz * k, type);
          }
          if (len === 0) continue;
          // a fireball racing down the arm, and smoke curling up where it ends
          const sp = len * 2.6 + 0.8;
          this.fire.emit(
            t,
            cx,
            0.35,
            cz,
            dx * sp + r.range(-0.3, 0.3),
            r.range(0.2, 0.7),
            dz * sp + r.range(-0.3, 0.3),
            r.range(0.45, 0.6),
            r.range(0.42, 0.55),
            r.next(),
            r.range(-2, 2),
            -0.6,
          );
          this.smoke.emit(
            t + r.range(0.25, 0.4),
            cx + dx * len,
            0.45,
            cz + dz * len,
            dx * 0.3,
            r.range(0.5, 0.9),
            dz * 0.3,
            r.range(1.4, 2),
            r.range(0.4, 0.55),
            r.next(),
            r.range(-0.6, 0.6),
            -0.3,
          );
        }
        // corner branches (blast level 4+): the flames turn round the corner and run down the side
        for (let k = 0; k < e.bendCount; k++) {
          const o = k * 4;
          const bx = this.wx(e.bends[o]);
          const bz = this.wz(e.bends[o + 1]);
          const d = e.bends[o + 2];
          const len = e.bends[o + 3];
          const [dx, dz] = DIR[d];
          for (let m = 1; m <= len; m++) {
            const type =
              m === len ? TIPS[d] : d < 2 ? FlameType.ArmX : FlameType.ArmZ;
            this.flames.add(t, bx + dx * m, bz + dz * m, type);
          }
          this.fire.emit(
            t,
            bx,
            0.35,
            bz,
            dx * (len * 2.6 + 0.8),
            r.range(0.2, 0.6),
            dz * (len * 2.6 + 0.8),
            r.range(0.4, 0.55),
            r.range(0.36, 0.48),
            r.next(),
            r.range(-2, 2),
            -0.6,
          );
        }
        // the heart: a white flash, billowing fire, then a column of smoke
        this.flash.emit(
          t,
          cx,
          0.6,
          cz,
          0,
          0,
          0,
          0.2,
          1.3 + reach * 0.2,
          r.next(),
        );
        this.ring.emit(
          t,
          cx,
          0.03,
          cz,
          0,
          0,
          0,
          0.42,
          0.9 + reach * 0.45,
          r.next(),
        );
        this.scorch.emit(
          t,
          cx,
          0.012,
          cz,
          0,
          0,
          0,
          SCORCH_S,
          r.range(0.62, 0.75),
          r.next(),
        );
        const nFire = Math.round(6 * rich);
        for (let i = 0; i < nFire; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(0.5, 1.6);
          this.fire.emit(
            t,
            cx,
            0.4,
            cz,
            Math.cos(a) * sp,
            r.range(1.2, 2.8),
            Math.sin(a) * sp,
            r.range(0.5, 0.8),
            r.range(0.4, 0.62),
            r.next(),
            r.range(-2, 2),
            -1.2,
          );
        }
        const nSmoke = Math.round(5 * rich);
        for (let i = 0; i < nSmoke; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(0.2, 0.7);
          this.smoke.emit(
            t + r.range(0.15, 0.35),
            cx + Math.cos(a) * 0.15,
            0.6,
            cz + Math.sin(a) * 0.15,
            Math.cos(a) * sp,
            r.range(0.8, 1.6),
            Math.sin(a) * sp,
            r.range(1.6, 2.4),
            r.range(0.5, 0.72),
            r.next(),
            r.range(-0.8, 0.8),
            -0.35,
          );
        }
        // a skirt of dust thrown along the floor by the shockwave
        const nDust = Math.round(6 * rich);
        for (let i = 0; i < nDust; i++) {
          const a = (i / nDust) * 6.283 + r.range(-0.3, 0.3);
          const sp = r.range(2, 3.4);
          this.dust.emit(
            t,
            cx,
            0.15,
            cz,
            Math.cos(a) * sp,
            r.range(0.2, 0.5),
            Math.sin(a) * sp,
            r.range(0.7, 1.1),
            r.range(0.24, 0.34),
            r.next(),
            0,
            0,
          );
        }
        const nSparks = Math.round(10 * rich);
        for (let i = 0; i < nSparks; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(2.5, 6);
          this.sparks.emit(
            t,
            cx,
            0.45,
            cz,
            Math.cos(a) * sp,
            r.range(2.5, 6),
            Math.sin(a) * sp,
            r.range(0.4, 0.8),
            r.range(0.035, 0.055),
            r.next(),
            0,
            11,
          );
        }
        this.shake.add(0.1);
        this.words.maybeSpawn(
          t,
          cx,
          1.0,
          cz,
          e.chainDepth === 0 && r.chance(0.5) ? 0 : r.int(0, 2),
          r.next(),
        );
        break;
      }
      case 'blockBroken': {
        const x = this.wx(e.x);
        const z = this.wz(e.y);
        for (let i = 0; i < 8; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(1.2, 3.2);
          this.splinters.emit(
            t,
            x,
            0.4,
            z,
            Math.cos(a) * sp,
            r.range(2.5, 5),
            Math.sin(a) * sp,
            r.range(0.7, 1.1),
            r.range(0.1, 0.17),
            r.next(),
            r.range(-14, 14),
            16,
          );
        }
        for (let i = 0; i < 2; i++)
          this.dust.emit(
            t,
            x,
            0.3,
            z,
            r.range(-0.5, 0.5),
            r.range(0.5, 1.1),
            r.range(-0.5, 0.5),
            r.range(0.7, 1.1),
            r.range(0.2, 0.3),
            r.next(),
            0,
            0,
          );
        break;
      }
      case 'blockFell': {
        // the wall lands WALL_FALL_S later: a puff of dust then (particles may be born in the future)
        const x = this.wx(e.x);
        const z = this.wz(e.y);
        for (let i = 0; i < 6; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(0.8, 2);
          this.dust.emit(
            t + WALL_FALL_S,
            x,
            0.2,
            z,
            Math.cos(a) * sp,
            r.range(0.3, 0.9),
            Math.sin(a) * sp,
            r.range(0.5, 0.9),
            r.range(0.2, 0.32),
            r.next(),
            0,
            0,
          );
        }
        this.shake.add(0.05, 0.3);
        break;
      }
      case 'itemAppeared':
      case 'itemTaken': {
        // a burst of golden sparkles: small when a crate reveals a power-up, a ring of them when somebody grabs it
        const x = this.wx(e.x);
        const z = this.wz(e.y);
        const n = e.type === 'itemTaken' ? 12 : 7;
        for (let i = 0; i < n; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(0.8, e.type === 'itemTaken' ? 2.6 : 1.6);
          this.sparks.emit(
            t,
            x,
            0.4,
            z,
            Math.cos(a) * sp,
            r.range(1.5, 3.4),
            Math.sin(a) * sp,
            r.range(0.5, 0.9),
            r.range(0.06, 0.1),
            r.next(),
            r.range(-8, 8),
            9,
          );
        }
        break;
      }
      case 'tntPlaced': {
        const x = this.wx(e.x);
        const z = this.wz(e.y);
        for (let i = 0; i < 3; i++)
          this.dust.emit(
            t,
            x,
            0.1,
            z,
            r.range(-0.7, 0.7),
            r.range(0.2, 0.5),
            r.range(-0.7, 0.7),
            r.range(0.4, 0.7),
            r.range(0.1, 0.16),
            r.next(),
            0,
            0,
          );
        break;
      }
      default:
        break;
    }
  }

  /** A player was knocked out at cell position `(x, y)`: a poof of dust and a burst of sparkly stars. */
  onKo(x: number, y: number): void {
    const t = this.time.value;
    const r = this.rng;
    const wx = x - this.w / 2;
    const wz = y - this.h / 2;
    for (let i = 0; i < 9; i++) {
      const a = r.range(0, 6.283);
      const sp = r.range(0.6, 1.8);
      this.dust.emit(
        t,
        wx,
        0.4,
        wz,
        Math.cos(a) * sp,
        r.range(0.4, 1.3),
        Math.sin(a) * sp,
        r.range(0.6, 1),
        r.range(0.2, 0.34),
        r.next(),
        0,
        0,
      );
    }
    for (let i = 0; i < 7; i++) {
      const a = r.range(0, 6.283);
      const sp = r.range(1, 2.4);
      this.sparks.emit(
        t,
        wx,
        0.7,
        wz,
        Math.cos(a) * sp,
        r.range(3, 5),
        Math.sin(a) * sp,
        r.range(0.7, 1.1),
        r.range(0.07, 0.11),
        r.next(),
        r.range(-10, 10),
        12,
      );
    }
  }

  /** A benched critter is launched from world `(x, z)`: a kick of dust and a few sparks. */
  launch(x: number, z: number): void {
    const t = this.time.value;
    const r = this.rng;
    for (let i = 0; i < 6; i++) {
      const a = r.range(0, 6.283);
      const sp = r.range(0.6, 1.6);
      this.dust.emit(
        t,
        x,
        0.15,
        z,
        Math.cos(a) * sp,
        r.range(0.3, 0.8),
        Math.sin(a) * sp,
        r.range(0.5, 0.8),
        r.range(0.18, 0.28),
        r.next(),
      );
    }
    for (let i = 0; i < 6; i++)
      this.sparks.emit(
        t,
        x,
        0.3,
        z,
        r.range(-1, 1),
        r.range(3, 5),
        r.range(-1, 1),
        r.range(0.4, 0.7),
        r.range(0.04, 0.06),
        r.next(),
        0,
        9,
      );
  }

  /** A critter lands at world `(x, z)` (dropped back in): a ring of dust along the floor and a small thump. */
  land(x: number, z: number): void {
    const t = this.time.value;
    const r = this.rng;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.283 + r.range(-0.2, 0.2);
      const sp = r.range(1.6, 2.6);
      this.dust.emit(
        t,
        x,
        0.1,
        z,
        Math.cos(a) * sp,
        r.range(0.15, 0.4),
        Math.sin(a) * sp,
        r.range(0.5, 0.8),
        r.range(0.2, 0.3),
        r.next(),
      );
    }
    this.shake.add(0.04, 0.2);
  }

  /** Advance the shared clock and upload this frame's spawns (call once per rendered frame). */
  update(dt: number): void {
    this.time.value += dt;
    this.shake.update(dt);
    for (const p of this.pools) p.flush();
    this.flames.flush();
    this.words.flush();
  }

  /**
   * Make every pool draw one (dead) instance, so the next render builds its programs and uploads its buffers - the
   * warm-up. The next `update()` puts the real counts back.
   */
  prime(): void {
    for (const p of this.pools) p.mesh.count = 1;
    this.flames.mesh.count = 1;
  }

  /** Kill every effect (new round). */
  clear(): void {
    for (const p of this.pools) p.clear();
    this.flames.clear();
    this.words.clear();
    this.shake.trauma = 0;
  }

  dispose(): void {
    for (const p of this.pools) p.dispose();
    this.flames.dispose();
    this.words.dispose();
  }
}
