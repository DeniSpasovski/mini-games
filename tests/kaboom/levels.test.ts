import { expect, test } from '@rstest/core';
import { DataTexture, Mesh, type InstancedMesh, type Object3D } from 'three';
import {
  DEFAULT_LEVEL,
  LEVELS,
  LEVEL_IDS,
  isLevelId,
} from '../../src/games/kaboom/game/levels';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
} from '../../src/games/kaboom/game/settings';
import { generateMap } from '../../src/games/kaboom/map/generate';
import {
  LEVELS_LIST,
  isTestLevel,
  offeredLevels,
} from '../../src/games/kaboom/release';
import {
  Arena,
  SINK_DELAY_S,
  TILE_SPLASH_S,
} from '../../src/games/kaboom/render/arena';
import { boatAt, boatsFor } from '../../src/games/kaboom/render/boats';
import { SLAB_PAD } from '../../src/games/kaboom/render/camera-rig';
import { Crowd } from '../../src/games/kaboom/render/crowd';
import { Fx } from '../../src/games/kaboom/render/fx/fx';
import { GlowGrid } from '../../src/games/kaboom/render/fx/glow-grid';
import { QUALITY } from '../../src/games/kaboom/render/renderer';
import { levelTheme } from '../../src/games/kaboom/render/themes';
import { WorldView } from '../../src/games/kaboom/render/world-view';
import { STEP } from '../../src/games/kaboom/sim/rules';
import { Sim } from '../../src/games/kaboom/sim/sim';
import { Terrain } from '../../src/games/kaboom/sim/types';
import { config } from './helpers';

const atlas = () => new DataTexture(new Uint8Array(4), 1, 1);

/** Visible draw calls under `root` (an empty instanced mesh draws nothing). */
function draws(...roots: Object3D[]): number {
  let n = 0;
  for (const root of roots)
    root.traverse((o) => {
      const m = o as Mesh & { count?: number; isInstancedMesh?: boolean };
      if (m.isMesh && m.visible && (!m.isInstancedMesh || (m.count ?? 0) > 0))
        n++;
    });
  return n;
}

function build(level: (typeof LEVEL_IDS)[number], quality = QUALITY.high) {
  const map = generateMap({ size: 'm', seed: 4 });
  const glow = new GlowGrid(map.w, map.h);
  return { map, arena: new Arena(map, quality, glow, levelTheme(level)) };
}

// ------------------------------------------------------------------ registry, release, settings

test('levels: every level has a theme, a label and exactly one release entry', () => {
  expect(LEVEL_IDS[0]).toBe(DEFAULT_LEVEL);
  for (const id of LEVEL_IDS) {
    expect(levelTheme(id).id).toBe(id);
    expect(LEVELS[id].label.length).toBeGreaterThan(0);
    expect(LEVELS[id].blurb.length).toBeGreaterThan(0);
    expect(LEVELS_LIST.filter((e) => e.id === id)).toHaveLength(1);
  }
  expect(LEVELS_LIST).toHaveLength(LEVEL_IDS.length);
  expect(isLevelId('sea')).toBe(true);
  expect(isLevelId('lava')).toBe(false);
  expect(isLevelId(undefined)).toBe(false);
});

test('levels: the release build offers only the Quarry while the new ones are in development', () => {
  expect(offeredLevels(true)).toEqual(['quarry']);
  expect(offeredLevels(false)).toEqual([...LEVEL_IDS]);
  expect(isTestLevel('quarry')).toBe(false);
  expect(isTestLevel('valley')).toBe(true);
  expect(isTestLevel('sea')).toBe(true);
});

test('levels: the saved setting falls back to the first level when unknown or not offered', () => {
  expect(DEFAULT_SETTINGS.level).toBe(DEFAULT_LEVEL);
  expect(sanitizeSettings(null).level).toBe(DEFAULT_LEVEL);
  expect(sanitizeSettings({ level: 'lava' }).level).toBe(DEFAULT_LEVEL);
  // the dev / test build offers every level (this suite runs as one)
  expect(sanitizeSettings({ level: 'sea' }).level).toBe('sea');
  expect(sanitizeSettings({ level: 'valley' }).level).toBe('valley');
});

// ------------------------------------------------------------------ the look never touches the rules

test('levels: each theme builds the same arena (blocks, crates) in a handful of draw calls', () => {
  const quarry = build('quarry');
  for (const id of LEVEL_IDS) {
    const { arena } = build(id);
    expect(arena.crateCount).toBe(quarry.arena.crateCount);
    expect(draws(arena.group)).toBeLessThanOrEqual(16);
    expect(draws(arena.group, arena.scenery)).toBeLessThanOrEqual(24);
    // the low tier is lighter, never heavier
    const low = build(id, QUALITY.low).arena;
    expect(draws(low.group, low.scenery)).toBeLessThanOrEqual(24);
    arena.dispose();
    low.dispose();
  }
});

test('levels: a wall level lands walls, the Sea Deck sinks tiles; neither needs the other', () => {
  expect(levelTheme('quarry').fall).toBe('wall');
  expect(levelTheme('valley').fall).toBe('wall');
  expect(levelTheme('sea').fall).toBe('tile');
  expect(levelTheme('sea').wallVariants).toEqual([]);
  for (const id of ['quarry', 'valley'] as const) {
    const { arena } = build(id);
    arena.dropWall(1, 1, 0);
    arena.update(1);
    expect(arena.isSunk(1, 1)).toBe(false);
  }
});

// ------------------------------------------------------------------ Sea Deck: sinking tiles

test('sea: a tile shakes, falls with its crate, and the cell is marked sunk', () => {
  const { map, arena } = build('sea');
  const cell = map.terrain.findIndex((t) => t === Terrain.Crate);
  expect(cell).toBeGreaterThanOrEqual(0);
  const x = cell % map.w;
  const y = (cell - x) / map.w;
  const before = arena.crateCount;
  expect(arena.isSunk(x, y)).toBe(false);

  arena.sinkTile(x, y, 1);
  expect(arena.isSunk(x, y)).toBe(true);
  arena.sinkTile(x, y, 1); // a second call changes nothing
  arena.update(1 + SINK_DELAY_S / 2); // still shaking: the crate is on its tile
  expect(arena.crateCount).toBe(before);

  arena.update(1 + SINK_DELAY_S + 1); // under water
  expect(arena.crateCount).toBe(before - 1);
  arena.update(3); // nothing left to move; must not throw
  expect(arena.consumeShadowDirty()).toBe(true);
  expect(TILE_SPLASH_S).toBeGreaterThan(SINK_DELAY_S);
});

test('sea: the water ripples where a tile goes in (a ring buffer, never grows)', () => {
  const { map, arena } = build('sea');
  for (let i = 0; i < 40; i++)
    arena.sinkTile(1 + (i % (map.w - 2)), 1 + (i % 7), i * 0.05);
  arena.update(2);
  arena.update(8);
  expect(draws(arena.scenery)).toBeGreaterThan(0);
});

// ------------------------------------------------------------------ Sea Deck: boats and crowd

test('boats: separate barges with open water between them, every ring size', () => {
  for (const n of [120, 200, 340, 520]) {
    const boats = boatsFor(n);
    expect(boats.length).toBeGreaterThanOrEqual(4);
    expect(boatsFor(n)).toBe(boats); // cached: the crowd and the hulls agree
    for (let k = 0; k < boats.length; k++) {
      const b = boats[k];
      const next = boats[(k + 1) % boats.length];
      expect(b.b).toBeGreaterThan(b.a + 4);
      // a gap of open water before the next boat (the last one wraps around the ring)
      const gap = k === boats.length - 1 ? next.a + n - b.b : next.a - b.b;
      expect(gap).toBeGreaterThanOrEqual(2);
      // nobody sits in a gap, everybody in the middle of a boat
      expect(boatAt((b.a + b.b) / 2, n)).toBe(true);
      expect(boatAt(b.b + gap / 2, n)).toBe(false);
    }
  }
});

test('crowd: on boats only in the Sea Deck, so fewer spectators than on the rocky banks', () => {
  const w = 17;
  const h = 13;
  const bowl = new Crowd(w, h, SLAB_PAD, QUALITY.high);
  const sea = new Crowd(w, h, SLAB_PAD, QUALITY.high, levelTheme('sea').crowd);
  const valley = new Crowd(
    w,
    h,
    SLAB_PAD,
    QUALITY.high,
    levelTheme('valley').crowd,
  );
  expect(sea.group.children.length).toBe(sea.drawCalls);
  expect(sea.count).toBeGreaterThan(100);
  expect(sea.count).toBeLessThan(bowl.count);
  expect(valley.count).toBeGreaterThan(150);
  expect((sea.group.children[0] as InstancedMesh).count).toBe(sea.count);
});

// ------------------------------------------------------------------ the whole view

test('fx: the sea turns a falling cell into a splash and a KO into a splash without stars', () => {
  const fx = new Fx(13, 11, atlas(), levelTheme('sea').fx);
  fx.sea = true;
  fx.onEvent({ type: 'blockFell', x: 3, y: 3 });
  fx.update(STEP);
  expect(fx.shake.trauma).toBeGreaterThan(0);
  fx.onKoSplash(4, 4);
  fx.update(STEP);
  const wall = new Fx(13, 11, atlas());
  wall.onEvent({ type: 'blockFell', x: 3, y: 3 });
  wall.update(STEP);
  expect(wall.shake.trauma).toBeGreaterThan(0);
});

test('world view: every level stays in the draw-call budget through a round, and the Sea Deck survives sudden death', () => {
  for (const level of LEVEL_IDS) {
    const map = generateMap({ size: 'l', seed: 4 });
    const sim = new Sim(config({ bots: 7, size: 'l' }), () => map, {
      countdown: 0,
    });
    const view = new WorldView(sim, QUALITY.high, {
      background: null,
      digitAtlas: atlas(),
      wordAtlas: atlas(),
      level,
    });
    expect(view.theme.id).toBe(level);
    let max = 0;
    for (let t = 0; t < 60; t++) {
      if (t === 5)
        for (let y = 1; y < 4; y++) {
          view.onEvents([{ type: 'blockFell', x: 5, y }]);
        }
      view.update(1, STEP);
      max = Math.max(max, draws(view.root));
    }
    expect(max).toBeLessThanOrEqual(60);
    if (level === 'sea') {
      expect(view.arena.isSunk(5, 1)).toBe(true);
      expect(view.arena.isSunk(6, 1)).toBe(false);
    }
    view.dispose();
  }
});

test('levels: the platform bobs only in the Sea Deck and never on low quality', () => {
  const pose = { y: 0, rx: 0, rz: 0 };
  expect(levelTheme('quarry').motion).toBeUndefined();
  expect(levelTheme('valley').motion).toBeUndefined();
  const motion = levelTheme('sea').motion!;
  motion(1.7, QUALITY.high, pose);
  expect(Math.abs(pose.y)).toBeGreaterThan(0);
  expect(Math.abs(pose.y)).toBeLessThan(0.1);
  expect(Math.abs(pose.rx) + Math.abs(pose.rz)).toBeLessThan(0.05);
  motion(1.7, QUALITY.low, pose);
  expect(pose).toEqual({ y: 0, rx: 0, rz: 0 });
});
