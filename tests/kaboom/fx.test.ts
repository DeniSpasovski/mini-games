import { expect, test } from '@rstest/core';
import { DataTexture, Mesh, Vector3 } from 'three';
import { generateMap } from '../../src/games/kaboom/map/generate';
import { FX_CAPACITY, Fx } from '../../src/games/kaboom/render/fx/fx';
import { FlameField, FlameType } from '../../src/games/kaboom/render/fx/flames';
import { ParticleSystem } from '../../src/games/kaboom/render/fx/particles';
import { Shake } from '../../src/games/kaboom/render/fx/shake';
import { WordBurst } from '../../src/games/kaboom/render/fx/word-burst';
import { QUALITY } from '../../src/games/kaboom/render/renderer';
import { WorldView } from '../../src/games/kaboom/render/world-view';
import {
  FLAME_S,
  MAX_PLAYERS,
  MAX_TNT,
  STEP,
} from '../../src/games/kaboom/sim/rules';
import { Sim } from '../../src/games/kaboom/sim/sim';
import { Terrain } from '../../src/games/kaboom/sim/types';
import { config, inputs } from './helpers';

const atlas = () => new DataTexture(new Uint8Array(4), 1, 1);
const time = () => ({ value: 0 });

test('shake: forty blasts shake no harder than a handful; it drains and is zero when calm', () => {
  const few = new Shake();
  const many = new Shake();
  for (let i = 0; i < 6; i++) few.add(0.1);
  for (let i = 0; i < 40; i++) many.add(0.1);
  expect(many.trauma).toBeLessThanOrEqual(0.6 + 1e-9);
  expect(many.trauma).toBeGreaterThanOrEqual(few.trauma - 1e-9);
  const v = new Vector3();
  expect(many.offset(v, 1.234).length()).toBeLessThan(0.2);
  for (let i = 0; i < 120; i++) many.update(1 / 60);
  expect(many.trauma).toBe(0);
  expect(many.offset(v, 3).length()).toBe(0);
});

test('particles: a ring buffer - the pool wraps, only used slots are drawn, clear empties it', () => {
  const p = new ParticleSystem('fire', 8, time());
  expect(p.mesh.count).toBe(0);
  for (let i = 0; i < 3; i++) p.emit(1, i, 0, 0, 0, 1, 0, 0.5, 0.1, i);
  p.flush();
  expect(p.mesh.count).toBe(3);
  for (let i = 0; i < 20; i++) p.emit(2, i, 0, 0, 0, 1, 0, 0.5, 0.1, i);
  p.flush();
  expect(p.mesh.count).toBe(8); // wrapped: the oldest were recycled, never more than the capacity
  p.clear();
  expect(p.mesh.count).toBe(0);
});

test('particles: every kind builds its own shader variant', () => {
  const t = time();
  for (const kind of [
    'fire',
    'dust',
    'splinter',
    'spark',
    'smoke',
    'flash',
    'ring',
    'scorch',
  ] as const) {
    const p = new ParticleSystem(kind, 4, t);
    const m = p.mesh.material as { defines: Record<string, number> };
    expect(typeof m.defines.KIND).toBe('number');
  }
});

test('flames: tiles are drawn once written, and the pool wraps', () => {
  const f = new FlameField(5, time());
  f.add(0, 1, 1, FlameType.Center);
  f.add(0, 2, 1, FlameType.ArmX);
  f.flush();
  expect(f.mesh.count).toBe(2);
  for (let i = 0; i < 12; i++) f.add(0.1, i, 0, FlameType.TipPosX);
  f.flush();
  expect(f.mesh.count).toBe(5);
});

test('word burst: throttled, so a long chain shows a few words, not one per blast', () => {
  const w = new WordBurst(4, time(), atlas(), 0.25);
  expect(w.maybeSpawn(1.0, 0, 1, 0, 0, 0.1)).toBe(true);
  expect(w.maybeSpawn(1.1, 0, 1, 0, 1, 0.2)).toBe(false);
  expect(w.maybeSpawn(1.3, 0, 1, 0, 2, 0.3)).toBe(true);
  w.clear();
  expect(w.maybeSpawn(1.31, 0, 1, 0, 0, 0.4)).toBe(true);
});

test('fx: a blast lights its cross with fire, a flash, a shockwave, smoke, sparks, a scorch mark and a word; a broken crate throws splinters', () => {
  const fx = new Fx(13, 11, atlas());
  fx.onEvent({
    type: 'tntExploded',
    x: 5,
    y: 5,
    owner: 0,
    arms: [2, 1, 0, 3],
    chainDepth: 0,
  });
  fx.update(0);
  expect(fx.flames.mesh.count).toBe(1 + 2 + 1 + 0 + 3); // centre + arm tiles of each direction
  expect(fx.fire.mesh.count).toBeGreaterThanOrEqual(6);
  expect(fx.smoke.mesh.count).toBeGreaterThanOrEqual(5);
  expect(fx.dust.mesh.count).toBe(6);
  expect(fx.sparks.mesh.count).toBe(10);
  expect([
    fx.flash.mesh.count,
    fx.ring.mesh.count,
    fx.scorch.mesh.count,
  ]).toEqual([1, 1, 1]);
  expect(fx.shake.trauma).toBeGreaterThan(0);

  fx.onEvent({ type: 'blockBroken', x: 3, y: 3 });
  fx.update(0);
  expect(fx.splinters.mesh.count).toBe(8);

  fx.onKo(4.5, 4.5);
  fx.update(0);
  expect(fx.sparks.mesh.count).toBe(10 + 7);

  fx.update(1);
  expect(fx.time.value).toBeCloseTo(1);
  fx.clear();
  expect(fx.flames.mesh.count).toBe(0);
  expect(fx.shake.trauma).toBe(0);
});

test('fx: a 64-TNT blast cannot overflow the pools', () => {
  const fx = new Fx(23, 17, atlas());
  for (let i = 0; i < MAX_TNT; i++)
    fx.onEvent({
      type: 'tntExploded',
      x: 1 + (i % 20),
      y: 1 + Math.floor(i / 20),
      owner: 0,
      arms: [2, 2, 2, 2],
      chainDepth: i,
    });
  for (let i = 0; i < 200; i++)
    fx.onEvent({ type: 'blockBroken', x: 1 + (i % 20), y: 1 + (i % 15) });
  fx.update(STEP);
  expect(fx.flames.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.flames);
  expect(fx.fire.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.fire);
  expect(fx.splinters.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.splinter);
  expect(fx.dust.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.dust);
  expect(fx.smoke.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.smoke);
  expect(fx.sparks.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.spark);
  expect(fx.scorch.mesh.count).toBeLessThanOrEqual(FX_CAPACITY.scorch);
  expect(fx.shake.trauma).toBeLessThanOrEqual(0.6 + 1e-9);
});

function openSim(): Sim {
  const map = generateMap({ size: 'l', seed: 4 });
  // a connected block of free ground: rows 1..7 minus pillars
  for (let y = 1; y <= 7; y++)
    for (let x = 1; x < map.w - 1; x++)
      if (!(x % 2 === 0 && y % 2 === 0))
        map.terrain[y * map.w + x] = Terrain.Empty;
  return new Sim(config({ bots: 7, size: 'l' }), () => map, { countdown: 0 });
}

test('world view: a chain on the large map stays within the draw-call budget and keeps every pool in range', () => {
  const sim = openSim();
  const view = new WorldView(sim, QUALITY.high, {
    background: null,
    digitAtlas: atlas(),
    wordAtlas: atlas(),
  });
  const w = sim.map.w;
  let n = 0;
  for (let y = 1; y <= 7 && n < 40; y += 2)
    for (let x = 1; x < w - 1 && n < 40; x += 2) {
      sim.plantTnt(x, y, n % 8, 2, x === 11 && y === 3 ? 0.2 : 3);
      n++;
    }
  expect(n).toBe(40);
  const cratesBefore = view.arena.crateCount;

  let exploded = 0;
  let maxDraws = 0;
  const idle = inputs(8);
  for (let t = 0; t < 240; t++) {
    const events = sim.tick(idle);
    for (const e of events) if (e.type === 'tntExploded') exploded++;
    view.onEvents(events);
    view.update(1, STEP);
    let draws = 0;
    view.root.traverse((o) => {
      const m = o as Mesh & { count?: number; isInstancedMesh?: boolean };
      if (m.isMesh && m.visible && (!m.isInstancedMesh || (m.count ?? 0) > 0))
        draws++;
    });
    maxDraws = Math.max(maxDraws, draws);
  }
  expect(exploded).toBe(40);
  expect(maxDraws).toBeLessThanOrEqual(60);
  expect(view.arena.crateCount).toBeLessThanOrEqual(cratesBefore);
  expect(view.shadows.mesh.count).toBeLessThanOrEqual(MAX_PLAYERS + MAX_TNT);
  // the heat texture followed the flames and went quiet again
  expect(Array.from(sim.flame).every((f) => f <= FLAME_S)).toBe(true);
  view.dispose();
});

test('world view: the shadow map is redrawn at most every few frames while crates keep breaking', () => {
  const sim = openSim();
  const view = new WorldView(sim, QUALITY.high, {
    background: null,
    digitAtlas: atlas(),
    wordAtlas: atlas(),
  });
  expect(view.takeShadowUpdate()).toBe(true); // first draw
  expect(view.takeShadowUpdate()).toBe(false);
  let redraws = 0;
  for (let t = 0; t < 60; t++) {
    view.arena.removeCrate(1, 9); // may or may not exist; mark casters changed every frame
    (view.arena as unknown as { shadowDirty: boolean }).shadowDirty = true;
    view.update(1, STEP);
    if (view.takeShadowUpdate()) redraws++;
  }
  expect(redraws).toBeGreaterThan(0);
  expect(redraws).toBeLessThanOrEqual(8); // 1 s at one redraw per 0.15 s
  view.dispose();
});
