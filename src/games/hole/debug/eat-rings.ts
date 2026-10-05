import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { canEat } from '../sim/progression';
import type { World } from '../sim/world';

const MAX_RINGS = 160;
const SEGMENTS = 20;
const RING_Y = 0.12;
const GREEN: [number, number, number] = [0.25, 1, 0.35];
const RED: [number, number, number] = [1, 0.25, 0.25];

/**
 * Debug overlay for the eat rule (play page, F4): a ring of the item's gameplay
 * size around every idle item near the hole - green when the current hole level
 * can eat it, red when it is too big (the label next to it is the item's hole level).
 * One LineSegments with a preallocated buffer, no allocation per frame.
 */
export class EatRings {
  readonly object: LineSegments;
  /** Items drawn in the last `update`, nearest first (the game labels the first few). */
  readonly nearest: number[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private dist = new Float32Array(MAX_RINGS);
  private picked = new Int32Array(MAX_RINGS);
  private count = 0;

  constructor() {
    this.pos = new Float32Array(MAX_RINGS * SEGMENTS * 2 * 3);
    this.col = new Float32Array(MAX_RINGS * SEGMENTS * 2 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.object = new LineSegments(
      geo,
      new LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        transparent: true,
      }),
    );
    this.object.frustumCulled = false;
    this.object.renderOrder = 998;
    this.object.visible = false;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }

  update(
    world: World,
    hx: number,
    hz: number,
    diameter: number,
    level: number,
  ): void {
    if (!this.object.visible) return;
    // collect the nearest MAX_RINGS idle items (insertion into a small sorted list)
    this.count = 0;
    world.query(hx, hz, diameter * 1.2 + 14, (i) => {
      if (!world.isIdle(i)) return;
      const d = Math.hypot(world.x[i] - hx, world.z[i] - hz);
      let k = this.count;
      if (k === MAX_RINGS) {
        if (d >= this.dist[k - 1]) return;
        k--;
      } else this.count++;
      while (k > 0 && this.dist[k - 1] > d) {
        this.dist[k] = this.dist[k - 1];
        this.picked[k] = this.picked[k - 1];
        k--;
      }
      this.dist[k] = d;
      this.picked[k] = i;
    });
    this.nearest.length = 0;
    let v = 0;
    for (let n = 0; n < this.count; n++) {
      const i = this.picked[n];
      this.nearest.push(i);
      const r = world.size[i] / 2;
      const c = canEat(level, world.size[i]) ? GREEN : RED;
      for (let s = 0; s < SEGMENTS; s++) {
        const a0 = (s / SEGMENTS) * Math.PI * 2;
        const a1 = ((s + 1) / SEGMENTS) * Math.PI * 2;
        const x = world.x[i];
        const z = world.z[i];
        this.pos[v] = x + Math.cos(a0) * r;
        this.pos[v + 1] = RING_Y;
        this.pos[v + 2] = z + Math.sin(a0) * r;
        this.pos[v + 3] = x + Math.cos(a1) * r;
        this.pos[v + 4] = RING_Y;
        this.pos[v + 5] = z + Math.sin(a1) * r;
        for (let k = 0; k < 2; k++) {
          this.col[v + k * 3] = c[0];
          this.col[v + k * 3 + 1] = c[1];
          this.col[v + k * 3 + 2] = c[2];
        }
        v += 6;
      }
    }
    const geo = this.object.geometry;
    geo.setDrawRange(0, this.count * SEGMENTS * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
