import { expect, test } from '@rstest/core';
import { InstancedMesh, Mesh } from 'three';
import { generateMap } from '../../src/games/kaboom/map/generate';
import { Arena } from '../../src/games/kaboom/render/arena';
import { GlowGrid } from '../../src/games/kaboom/render/fx/glow-grid';
import { QUALITY } from '../../src/games/kaboom/render/renderer';
import { FLAME_S } from '../../src/games/kaboom/sim/rules';
import { Terrain } from '../../src/games/kaboom/sim/types';

function build(size: 's' | 'm' | 'l', quality: 'low' | 'high' = 'high') {
  const map = generateMap({ size, seed: 4 });
  const glow = new GlowGrid(map.w, map.h);
  return { map, glow, arena: new Arena(map, QUALITY[quality], glow) };
}

function drawables(arena: Arena): Mesh[] {
  const out: Mesh[] = [];
  arena.group.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

test('arena: a handful of draw calls on every size, however many blocks', () => {
  for (const size of ['s', 'm', 'l'] as const) {
    const { arena } = build(size);
    expect(drawables(arena).length).toBeLessThanOrEqual(14);
  }
});

test('arena: one crate instance per crate cell, none for hard blocks or empty cells', () => {
  const { map, arena } = build('m');
  let crates = 0;
  for (const t of map.terrain) if (t === Terrain.Crate) crates++;
  expect(arena.crateCount).toBe(crates);
});

test('arena: removing crates swaps instances and keeps the rest intact', () => {
  const { map, arena } = build('m');
  const cells: number[] = [];
  for (let i = 0; i < map.terrain.length; i++)
    if (map.terrain[i] === Terrain.Crate) cells.push(i);
  expect(arena.consumeShadowDirty()).toBe(true); // first frame draws the shadow map
  expect(arena.consumeShadowDirty()).toBe(false);

  const first = cells[0];
  const x = first % map.w;
  const y = (first - x) / map.w;
  expect(arena.removeCrate(x, y)).toBe(true);
  expect(arena.removeCrate(x, y)).toBe(false); // already gone
  expect(arena.removeCrate(0, 0)).toBe(false); // a wall
  expect(arena.crateCount).toBe(cells.length - 1);
  expect(arena.consumeShadowDirty()).toBe(true);

  // remove the rest in a scrambled order: counts stay consistent, never throws
  const rest = cells.slice(1).reverse();
  rest.forEach((c, n) => {
    const cx = c % map.w;
    expect(arena.removeCrate(cx, (c - cx) / map.w)).toBe(true);
    expect(arena.crateCount).toBe(rest.length - n - 1);
  });
  const instanced = drawables(arena).filter(
    (m): m is InstancedMesh => (m as InstancedMesh).isInstancedMesh === true,
  );
  expect(instanced.some((m) => m.count === 0)).toBe(true);
});

test('arena: the low quality tier has no shadow-casting light', () => {
  expect(build('s', 'low').arena.sun.castShadow).toBe(false);
  expect(build('s', 'high').arena.sun.castShadow).toBe(true);
});

test('glow grid: maps flame seconds to heat, uploads only while something burns', () => {
  const glow = new GlowGrid(3, 2);
  const flame = new Float32Array(6);
  flame[4] = FLAME_S;
  flame[1] = FLAME_S / 2;
  glow.update(flame);
  const data = glow.texture.image.data as Uint8Array;
  expect(data[4]).toBe(255);
  expect(data[1]).toBeCloseTo(128, -1);
  expect(data[0]).toBe(0);

  const v = glow.texture.version;
  flame.fill(0);
  glow.update(flame); // the frame that clears it still uploads
  expect(glow.texture.version).toBeGreaterThan(v);
  const v2 = glow.texture.version;
  glow.update(flame); // idle: no upload
  expect(glow.texture.version).toBe(v2);
});
