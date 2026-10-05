import type { Scene } from 'three';
import { getItem } from '../items/catalog';
import { minimalMap } from '../map/minimal';
import type { Placement } from '../map/types';
import { HoleMesh } from '../render/hole-mesh';
import { ItemInstances } from '../render/item-instances';
import { commitRadius } from '../sim/eat';
import { holeDiameter } from '../sim/progression';
import { Sim } from '../sim/sim';

/**
 * One item + one hole running the real sim. The item viewer uses stations to
 * show "single" and "compare" modes and to play falls in slow motion.
 */
export class Station {
  readonly sim: Sim;
  readonly instances: ItemInstances;
  readonly holeMesh: HoleMesh;
  /** X of the item (the hole starts beside it). */
  readonly itemX: number;
  /** Scripted hole motion: 'idle' | 'toItem' | 'across'. */
  mode: 'idle' | 'toItem' | 'across' = 'idle';
  private startX: number;
  private startLevel: number;

  constructor(
    scene: Scene,
    readonly itemId: string,
    itemX: number,
    holeLevel: number,
    holeColor: number,
    readonly variant = 0,
    readonly paint = 0,
  ) {
    const info = getItem(itemId);
    this.itemX = itemX;
    this.startLevel = holeLevel;
    // start with the hole just outside the commit radius, on the left of the item
    const d = holeDiameter(holeLevel);
    this.startX = itemX - (d / 2 + info.size * 0.6 + 1.5);
    const placement: Placement = {
      item: itemId,
      x: itemX,
      z: 0,
      rot: 0,
      variant,
      paint,
    };
    this.sim = new Sim(minimalMap([placement], { x: this.startX, z: 0 }), {
      seconds: 1e9,
      startLevel: holeLevel,
    });
    this.instances = new ItemInstances(this.sim.world);
    this.holeMesh = new HoleMesh(holeColor);
    scene.add(this.instances.group, this.holeMesh.group);
    this.syncHole();
  }

  dispose(scene: Scene): void {
    scene.remove(this.instances.group, this.holeMesh.group);
    for (const m of this.instances.group.children)
      (m as { dispose?: () => void }).dispose?.();
  }

  setColor(hex: number): void {
    this.holeMesh.setColor(hex);
  }

  /** Restore the item and the hole to their starting state. */
  reset(): void {
    const s = this.sim;
    const w = s.world;
    w.state.fill(0);
    w.t.fill(0);
    w.teeter.fill(0);
    w.fall.fill(null);
    w.active.clear();
    w.gone.length = 0;
    w.remaining = w.n;
    s.hole.x = this.startX;
    s.hole.z = 0;
    s.hole.vx = s.hole.vz = 0;
    s.hole.level = this.startLevel;
    s.hole.xp = 0;
    s.hole.diameter = holeDiameter(this.startLevel);
    s.score = 0;
    s.itemsEaten = 0;
    s.pointsEaten = 0;
    s.over = false;
    s.cleared = false;
    this.mode = 'idle';
    this.instances.resetAll();
    this.syncHole();
  }

  /** Move the hole under the item, in the sim (so the real fall plays). */
  drop(): void {
    this.mode = 'toItem';
  }

  /** Slide the hole across the item and out the other side (teeter test for items that are too big). */
  slideAcross(): void {
    this.mode = 'across';
  }

  /** Put the hole so the item is exactly at the commit radius of `level`, then grow the hole. */
  levelUp(level: number): void {
    this.reset();
    const info = getItem(this.itemId);
    const s = this.sim;
    s.hole.x = this.itemX - commitRadius(holeDiameter(level), info.size) + 0.05;
    s.setLevel(level - 1);
    s.hole.diameter = holeDiameter(level - 1);
    window.setTimeout(() => s.setLevel(level), 500);
    this.syncHole();
  }

  setHoleLevel(level: number): void {
    this.startLevel = level;
    this.reset();
  }

  step(dt: number): void {
    const s = this.sim;
    const h = s.hole;
    let dx = 0;
    if (this.mode === 'toItem') {
      const dist = this.itemX - h.x;
      if (Math.abs(dist) < 0.05) this.mode = 'idle';
      else dx = Math.sign(dist) * Math.min(1, Math.abs(dist));
      dx *= 0.3;
    } else if (this.mode === 'across') {
      dx = 0.3;
      if (h.x > this.itemX + holeDiameter(h.level) + 6) this.mode = 'idle';
    }
    s.step(dt, dx, 0);
    this.instances.update();
    this.syncHole();
    this.holeMesh.tick(dt);
    for (const e of s.drainEvents()) {
      if (e.type === 'levelup') this.holeMesh.pulse();
      else if (e.type === 'eat') this.holeMesh.kick(0.6);
    }
  }

  private syncHole(): void {
    const h = this.sim.hole;
    this.holeMesh.setPosition(h.x, h.z);
    this.holeMesh.setDiameter(h.diameter);
  }
}
