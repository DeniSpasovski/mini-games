import { Group, type Texture } from 'three';
import { Rng } from '../../../../shared/rng';
import type { SimEvent } from '../../sim/types';
import { FlameType, FlameField } from './flames';
import { ParticleSystem, type TimeUniform } from './particles';
import { WALL_FALL_S } from '../arena';
import { Shake } from './shake';
import { WordBurst, makeWordAtlas } from './word-burst';

/** Pool sizes: the oldest particle is recycled when a pool is full, so these only bound the cost. */
export const FX_CAPACITY = {
  fire: 640,
  dust: 512,
  splinter: 768,
  spark: 128,
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

/**
 * All explosion visuals behind one object: GPU particles (fire embers, dust, wood splinters, KO sparks), the flame tiles,
 * the comic word bursts and the camera shake. Feed it the sim's events, call `update` once per frame; every effect is a
 * pooled InstancedMesh animated in a vertex shader from one shared clock, so a blast costs the same however many go
 * off at once (DETAILS.md "Performance").
 */
export class Fx {
  readonly group = new Group();
  /** The one clock all FX shaders read. */
  readonly time: TimeUniform = { value: 0 };
  readonly fire: ParticleSystem;
  readonly dust: ParticleSystem;
  readonly splinters: ParticleSystem;
  readonly sparks: ParticleSystem;
  readonly flames: FlameField;
  readonly words: WordBurst;
  readonly shake = new Shake();
  private readonly rng = new Rng(31337);

  /** `w`, `h` = arena size in cells; `wordAtlas` = lettering texture (default: drawn on a canvas, browser only). */
  constructor(
    private readonly w: number,
    private readonly h: number,
    wordAtlas: Texture = makeWordAtlas(),
  ) {
    this.fire = new ParticleSystem('fire', FX_CAPACITY.fire, this.time);
    this.dust = new ParticleSystem('dust', FX_CAPACITY.dust, this.time);
    this.splinters = new ParticleSystem(
      'splinter',
      FX_CAPACITY.splinter,
      this.time,
    );
    this.sparks = new ParticleSystem('spark', FX_CAPACITY.spark, this.time);
    this.flames = new FlameField(FX_CAPACITY.flames, this.time);
    this.words = new WordBurst(FX_CAPACITY.words, this.time, wordAtlas);
    this.group.add(
      this.flames.mesh,
      this.fire.mesh,
      this.dust.mesh,
      this.splinters.mesh,
      this.sparks.mesh,
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
        this.flames.add(t, cx, cz, FlameType.Center);
        for (let d = 0; d < 4; d++) {
          const len = e.arms[d];
          const [dx, dz] = DIR[d];
          for (let k = 1; k <= len; k++) {
            const type =
              k === len ? TIPS[d] : d < 2 ? FlameType.ArmX : FlameType.ArmZ;
            this.flames.add(t, cx + dx * k, cz + dz * k, type);
          }
          if (len > 0)
            for (let i = 0; i < 2; i++)
              this.fire.emit(
                t,
                cx + dx * len * 0.6,
                0.3,
                cz + dz * len * 0.6,
                dx * r.range(2, 4.5) + r.range(-0.6, 0.6),
                r.range(0.8, 2.2),
                dz * r.range(2, 4.5) + r.range(-0.6, 0.6),
                r.range(0.45, 0.8),
                r.range(0.12, 0.2),
                r.next(),
                0,
                2,
              );
        }
        for (let i = 0; i < 8; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(0.8, 2.6);
          this.fire.emit(
            t,
            cx,
            0.35,
            cz,
            Math.cos(a) * sp,
            r.range(1.6, 3.6),
            Math.sin(a) * sp,
            r.range(0.5, 0.9),
            r.range(0.13, 0.22),
            r.next(),
            0,
            4,
          );
        }
        for (let i = 0; i < 5; i++) {
          const a = r.range(0, 6.283);
          const sp = r.range(0.3, 1.1);
          this.dust.emit(
            t,
            cx,
            0.3,
            cz,
            Math.cos(a) * sp,
            r.range(0.7, 1.5),
            Math.sin(a) * sp,
            r.range(0.9, 1.4),
            r.range(0.22, 0.36),
            r.next(),
            0,
            0,
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

  /** Advance the shared clock and upload this frame's spawns (call once per rendered frame). */
  update(dt: number): void {
    this.time.value += dt;
    this.shake.update(dt);
    this.fire.flush();
    this.dust.flush();
    this.splinters.flush();
    this.sparks.flush();
    this.flames.flush();
    this.words.flush();
  }

  /**
   * Make every pool draw one (dead) instance, so the next render builds its programs and uploads its buffers - the
   * warm-up. The next `update()` puts the real counts back.
   */
  prime(): void {
    for (const m of [
      this.fire.mesh,
      this.dust.mesh,
      this.splinters.mesh,
      this.sparks.mesh,
      this.flames.mesh,
    ])
      m.count = 1;
  }

  /** Kill every effect (new round). */
  clear(): void {
    this.fire.clear();
    this.dust.clear();
    this.splinters.clear();
    this.sparks.clear();
    this.flames.clear();
    this.words.clear();
    this.shake.trauma = 0;
  }

  dispose(): void {
    this.fire.dispose();
    this.dust.dispose();
    this.splinters.dispose();
    this.sparks.dispose();
    this.flames.dispose();
    this.words.dispose();
  }
}
